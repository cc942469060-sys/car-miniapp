const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore, normalizeBackup } = require('../miniprogram/utils/store');
const D = require('../miniprogram/utils/domain');
const C = require('../miniprogram/utils/charging');

function fixture(raw) {
  let data = raw ? JSON.parse(JSON.stringify(raw)) : '';
  const store = createStore({
    get: () => data,
    set: v => {
      data = JSON.parse(JSON.stringify(v));
    },
  });
  return { store, raw: () => data };
}
function car(store, type = 'ev', battery = '63') {
  return store.saveVehicle({
    name: '测试车',
    type,
    model: '',
    baseDate: '2025-01-01',
    baseMileage: '1000',
    batteryKwh: battery,
  });
}
const TARIFF = {
  from: '2025-01-01',
  periods: [
    { start: '00:00', label: 'valley', price: '0.3000' },
    { start: '07:00', label: 'flat', price: '0.6000' },
    { start: '23:00', label: 'valley', price: '0.3000' },
  ],
};
function home(store) {
  store.saveHome({ meter: 'dedicated', chargerKw: '7' });
  store.saveTariff(TARIFF);
}
function homeRecord(store, vehicleId, input) {
  return store.saveRecord(
    Object.assign(
      {
        vehicleId,
        kind: 'charge',
        mileage: '1200',
        note: '',
        home: true,
        settle: 'pending',
      },
      input
    )
  );
}

test('v1 数据升级到 v2：补家充字段，旧记录一律非家充，统计与 CSV 结果不变', () => {
  const v1 = {
    version: 1,
    vehicles: [
      { id: 'v', name: '旧车', type: 'fuel', model: '', baseDate: '2025-01-01', baseMileage: 1000, archived: false },
    ],
    records: [
      {
        id: 'r',
        vehicleId: 'v',
        kind: 'fuel',
        date: '2025-01-02',
        mileage: 1100,
        cents: 30000,
        quantity100: 4000,
        price: '7.50',
        note: '',
        full: true,
        gap: false,
        complete: false,
        planId: '',
        socAfter: null,
        category: '',
      },
    ],
    plans: [],
    currentId: 'v',
  };
  const { store } = fixture(v1),
    s = store.read();
  assert.equal(s.version, 2);
  assert.deepEqual(s.home, { meter: '', chargerKw100: 700, tariffs: [] });
  assert.deepEqual(s.bills, []);
  assert.equal(s.vehicles[0].batteryKwh100, null);
  assert.deepEqual(
    [s.records[0].home, s.records[0].settle, s.records[0].startTime, s.records[0].estQuantity100, s.records[0].alloc],
    [false, '', '', null, []]
  );
  assert.equal(D.statistics(s.records, '2025-01').total, 30000);
  // The upgrade is written back on the next change, keeping the same storage key.
  store.updateMileage('v', '1200');
  assert.equal(store.read().version, 2);
});

test('电池容量只保存在可插电的车型上，范围 1–300 kWh', () => {
  const { store } = fixture(),
    fuel = car(store, 'fuel', '63'),
    ev = car(store, 'ev', '63');
  assert.equal(store.read().vehicles.find(v => v.id === fuel).batteryKwh100, null);
  assert.equal(store.read().vehicles.find(v => v.id === ev).batteryKwh100, 6300);
  assert.throws(
    () => store.saveVehicle({ name: '大电池', type: 'ev', baseDate: '2025-01-01', baseMileage: '0', batteryKwh: '301' }),
    /电池容量需在 1–300 kWh 之间/
  );
});

test('待对账的家充记录只存预估：结束时间按功率推算，电量与金额为空，标签为预估', () => {
  const { store } = fixture(),
    id = car(store);
  home(store);
  homeRecord(store, id, {
    date: '2025-11-20',
    startTime: '22:00',
    socBefore: '30',
    socAfter: '80',
  });
  const r = store.read().records[0];
  assert.deepEqual(
    [r.settle, r.quantity100, r.cents, r.endTime, r.endEstimated, r.estQuantity100, r.estCents, r.estMethod, r.estK10000],
    ['pending', null, null, '03:00', true, 3500, 1260, 'soc', 7000]
  );
  assert.equal(C.confidence(r, store.read()), 'estimate');
  const stats = D.statistics(store.read().records, '2025-11');
  assert.deepEqual([stats.total, stats.estimatedCents, stats.estimatedCharge100], [1260, 1260, 3500]);
});

test('手动填写的家充按实际值入账，缺少开始时间仍可保存', () => {
  const { store } = fixture(),
    id = car(store);
  home(store);
  homeRecord(store, id, {
    date: '2025-11-20',
    settle: 'manual',
    quantity: '20',
    amount: '12.60',
    socAfter: '80',
  });
  const r = store.read().records[0];
  assert.deepEqual([r.settle, r.quantity100, r.cents, r.confirmed], ['manual', 2000, 1260, true]);
  assert.equal(C.confidence(r, store.read()), 'actual');
});

test('同一辆车同一时段的两个家充记录不能重叠，不同车辆可以', () => {
  const { store } = fixture(),
    a = car(store),
    b = car(store, 'ev', '40');
  home(store);
  homeRecord(store, a, { date: '2025-11-20', startTime: '22:00', socBefore: '30', socAfter: '80' });
  assert.throws(
    () => homeRecord(store, a, { date: '2025-11-21', startTime: '01:00', socBefore: '30', socAfter: '50' }),
    /与已记录的家充时段重叠/
  );
  assert.doesNotThrow(() =>
    homeRecord(store, b, { date: '2025-11-21', startTime: '01:00', socBefore: '30', socAfter: '50' })
  );
});

test('录入账单后自动分摊：电量与金额按预估权重拆分，覆盖完整才转为已对账', () => {
  const { store } = fixture(),
    id = car(store);
  home(store);
  const a = homeRecord(store, id, {
      date: '2025-11-20',
      startTime: '22:00',
      socBefore: '30',
      socAfter: '80',
    }),
    b = homeRecord(store, id, {
      date: '2025-11-21',
      startTime: '23:00',
      socBefore: '40',
      socAfter: '70',
    });
  store.saveBill({ from: '2025-11-21', to: '2025-11-21', quantity: '30.80', amount: '', note: '' });
  let s = store.read(),
    ra = s.records.find(r => r.id === a),
    rb = s.records.find(r => r.id === b);
  assert.deepEqual([ra.settle, ra.quantity100, rb.settle, rb.quantity100], ['pending', null, 'pending', null]);
  assert.deepEqual(
    ra.alloc.map(x => [x.quantity100, x.cents]),
    [[2310, 693]]
  );
  assert.equal(C.allocatedPercent(ra), 66);
  store.saveBill({ from: '2025-11-20', to: '2025-11-20', quantity: '14.50', amount: '', note: '' });
  s = store.read();
  ra = s.records.find(r => r.id === a);
  assert.deepEqual([ra.settle, ra.quantity100, ra.cents, ra.confirmed], ['bill', 3760, 1346, true]);
  assert.equal(C.confidence(ra, s), 'allocated');
  assert.equal(s.bills.length, 2);
  // Deleting a bill sends the charge back to 待对账 but keeps its estimate.
  store.deleteBill(s.bills.find(b => b.from === '2025-11-20').id);
  s = store.read();
  ra = s.records.find(r => r.id === a);
  assert.deepEqual([ra.settle, ra.quantity100, ra.alloc.length, ra.estQuantity100], ['pending', null, 1, 3500]);
});

test('共用总表按预估入账，不能录账单；录入过账单后不能切回共用总表', () => {
  const { store } = fixture(),
    id = car(store);
  store.saveHome({ meter: 'shared', chargerKw: '7' });
  store.saveTariff(TARIFF);
  homeRecord(store, id, { date: '2025-11-20', startTime: '22:00', socBefore: '30', socAfter: '80' });
  let r = store.read().records[0];
  assert.deepEqual([r.settle, r.quantity100, r.cents], ['estimate', 3500, 1260]);
  assert.throws(
    () => store.saveBill({ from: '2025-11-20', to: '2025-11-20', quantity: '14.50', amount: '' }),
    /只有独立电表/
  );
  store.saveHome({ meter: 'dedicated', chargerKw: '7' });
  store.saveBill({ from: '2025-11-20', to: '2025-11-20', quantity: '14.50', amount: '' });
  assert.throws(() => store.saveHome({ meter: 'shared', chargerKw: '7' }), /已录过账单/);
  r = store.read().records[0];
  assert.deepEqual([r.settle, r.quantity100], ['pending', null]);
});

test('切换电表类型时预估记录在 estimate 与 pending 间转换', () => {
  const { store } = fixture(),
    id = car(store);
  store.saveHome({ meter: 'shared', chargerKw: '7' });
  store.saveTariff(TARIFF);
  homeRecord(store, id, { date: '2025-11-20', startTime: '22:00', socBefore: '30', socAfter: '80' });
  store.saveHome({ meter: 'dedicated', chargerKw: '7' });
  let r = store.read().records[0];
  assert.deepEqual([r.settle, r.quantity100, r.cents], ['pending', null, null]);
  store.saveHome({ meter: 'shared', chargerKw: '7' });
  r = store.read().records[0];
  assert.deepEqual([r.settle, r.quantity100, r.cents], ['estimate', 3500, 1260]);
});

test('删除电价版本前先检查是否还有记录或账单需要它', () => {
  const { store } = fixture(),
    id = car(store);
  home(store);
  const tariff = store.read().home.tariffs[0];
  homeRecord(store, id, { date: '2025-11-20', startTime: '22:00', socBefore: '30', socAfter: '80' });
  assert.throws(() => store.deleteTariff(tariff.id), /有家充记录将没有适用电价/);
  store.saveBill({ from: '2025-11-20', to: '2025-11-20', quantity: '14.50', amount: '' });
  store.deleteRecord(store.read().records[0].id);
  assert.throws(() => store.deleteTariff(tariff.id), /有账单将没有适用电价/);
  // With an amount on the bill, the tariff is no longer needed to cost it.
  const bill = store.read().bills[0];
  store.saveBill({ id: bill.id, from: bill.from, to: bill.to, quantity: '14.50', amount: '8.70' });
  assert.doesNotThrow(() => store.deleteTariff(tariff.id));
});

test('备份导出再恢复后分摊按账单重算，旧版备份也能恢复', () => {
  const { store } = fixture(),
    id = car(store);
  home(store);
  const a = homeRecord(store, id, { date: '2025-11-20', startTime: '22:00', socBefore: '30', socAfter: '80' });
  homeRecord(store, id, { date: '2025-11-21', startTime: '23:00', socBefore: '40', socAfter: '70' });
  store.saveBill({ from: '2025-11-21', to: '2025-11-21', quantity: '30.80', amount: '' });
  const backup = JSON.parse(JSON.stringify(store.exportData()));
  assert.equal(backup.version, 2);
  assert.equal(backup.home.meter, 'dedicated');
  assert.equal(backup.bills.length, 1);
  // A tampered allocation must not survive: it is rebuilt from the bills.
  backup.records.find(r => r.id === a).alloc = [{ billId: 'nope', quantity100: 1, cents: 1, weight100: 1 }];
  const { store: other } = fixture();
  other.restore(backup);
  const s = other.read(),
    ra = s.records.find(r => r.id === a);
  assert.deepEqual(
    ra.alloc.map(x => [x.billId, x.quantity100, x.cents]),
    [[s.bills[0].id, 2310, 693]]
  );
  assert.throws(
    () => normalizeBackup(Object.assign({}, backup, { home: Object.assign({}, backup.home, { meter: 'shared' }) })),
    /家充数据不一致/
  );
  // A version 1 backup still restores, upgraded in memory.
  const { store: third } = fixture();
  third.restore({
    app: 'car-miniapp',
    exportedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    vehicles: [
      { id: 'v', name: '旧车', type: 'fuel', model: '', baseDate: '2025-01-01', baseMileage: 1000, archived: false },
    ],
    records: [
      {
        id: 'r',
        vehicleId: 'v',
        kind: 'fuel',
        date: '2025-01-02',
        mileage: 1100,
        cents: 30000,
        quantity100: 4000,
        price: '7.50',
        note: '',
        full: true,
        gap: false,
        complete: false,
        planId: '',
        socAfter: null,
        category: '',
      },
    ],
    plans: [],
    currentId: 'v',
  });
  const t = third.read();
  assert.equal(t.version, 2);
  assert.equal(t.records[0].home, false);
  assert.deepEqual(t.bills, []);
  assert.deepEqual(t.home, { meter: '', chargerKw100: 700, tariffs: [] });
  assert.equal(t.records[0].quantity100, 4000);
});
