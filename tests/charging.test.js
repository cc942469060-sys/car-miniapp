const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../miniprogram/utils/charging');
const D = require('../miniprogram/utils/domain');
const VEHICLE = { id: 'v1', name: '电车', type: 'ev', batteryKwh100: 6300 };
const HOME = {
  meter: 'dedicated',
  chargerKw100: 700,
  tariffs: [
    {
      id: 't1',
      from: '2025-01-01',
      periods: [
        { start: '00:00', label: 'valley', price10000: 3000 },
        { start: '07:00', label: 'flat', price10000: 6000 },
        { start: '23:00', label: 'valley', price10000: 3000 },
      ],
    },
  ],
};
const home = tariffs => Object.assign({}, HOME, { tariffs: tariffs || HOME.tariffs });
// A charge as the store saves it: the estimate is frozen on the record and the bill fills the actual values in later.
function charge(id, input, state) {
  const s = state || { home: HOME, records: [], bills: [] },
    k = C.homeK(VEHICLE, s.records, s.bills).k,
    est = C.estimateHomeCharge(Object.assign({ id, mileage: 1200 }, input), VEHICLE, k, s.home);
  return {
    id,
    vehicleId: 'v1',
    kind: 'charge',
    date: input.date,
    mileage: 1200,
    home: true,
    settle: 'pending',
    startTime: input.startTime,
    endTime: est.endTime,
    endEstimated: est.endEstimated,
    socBefore: input.socBefore == null ? null : input.socBefore,
    socAfter: input.socAfter == null ? null : input.socAfter,
    estQuantity100: est.estQuantity100,
    estCents: est.estCents,
    estMethod: est.estMethod,
    estK10000: est.estK10000,
    alloc: [],
    quantity100: null,
    cents: null,
  };
}
const bill = (id, from, to, quantity100, cents) => ({
  id,
  from,
  to,
  quantity100,
  cents: cents == null ? null : cents,
  note: '',
});
const sum = (rows, key) => rows.reduce((s, row) => s + row[key], 0);

test('最大余数法：多的份额按小数部分从大到小、同分按输入顺序分配', () => {
  assert.deepEqual(C.largestRemainder(1000, [1, 1, 1]), [334, 333, 333]);
  assert.deepEqual(C.largestRemainder(1000, [1, 2]), [333, 667]);
  assert.deepEqual(C.largestRemainder(10, [0, 0]), [0, 0]);
  assert.deepEqual(C.largestRemainder(0, [1, 1]), [0, 0]);
  assert.deepEqual(C.largestRemainder(5, []), []);
});

test('充电时段跨零点、整 24 小时与缺少时间', () => {
  const a = C.chargeWindow({ date: '2025-11-20', startTime: '22:00', endTime: '03:00' });
  assert.equal(a.minutes, 300);
  assert.equal(a.crosses, true);
  assert.equal(C.windowText(a), '22:00–03:00（次日）');
  assert.deepEqual(C.coveredDates({ date: '2025-11-20', startTime: '22:00', endTime: '03:00' }), [
    '2025-11-20',
    '2025-11-21',
  ]);
  assert.equal(C.chargeWindow({ date: '2025-11-20', startTime: '22:00', endTime: '22:00' }).minutes, 1440);
  assert.equal(C.chargeWindow({ date: '2025-11-20', startTime: '', endTime: '' }), null);
});

test('按电价切片：零点与时段起点切开，金额按分相加（验收用例 A）', () => {
  const s = C.estimateHomeCharge(
    { date: '2025-11-20', startTime: '22:00', socBefore: 30, socAfter: 80 },
    VEHICLE,
    70,
    HOME
  );
  assert.equal(s.estQuantity100, 3500);
  assert.equal(s.estCents, 1260);
  assert.equal(s.endTime, '03:00');
  assert.equal(s.endEstimated, true);
  assert.equal(s.estMethod, 'soc');
  assert.equal(s.estK10000, 7000);
  assert.deepEqual(
    s.slice.segments.map(x => [x.date, x.label, x.quantity100, x.cents]),
    [
      ['2025-11-20', 'flat', 700, 420],
      ['2025-11-20', 'valley', 700, 210],
      ['2025-11-21', 'valley', 2100, 630],
    ]
  );
  assert.deepEqual(s.slice.byDate, { '2025-11-20': 1400, '2025-11-21': 2100 });
  assert.deepEqual(s.slice.byLabel.flat, { quantity100: 700, cents: 420 });
});

test('验收用例 B：23:00 起充跨零点，全部落在谷段', () => {
  const s = C.estimateHomeCharge(
    { date: '2025-11-21', startTime: '23:00', socBefore: 40, socAfter: 70 },
    VEHICLE,
    70,
    HOME
  );
  assert.equal(s.estQuantity100, 2100);
  assert.equal(s.endTime, '02:00');
  assert.equal(s.endEstimated, true);
  assert.equal(s.estCents, 630);
  assert.deepEqual(
    s.slice.segments.map(x => [x.date, x.quantity100]),
    [
      ['2025-11-21', 700],
      ['2025-11-22', 1400],
    ]
  );
});

test('跨零点的谷段（22:00–08:00）在 01:00–05:00 全算谷段；新电价版本从生效日零点起按新价', () => {
  const valleyNight = home([
    {
      id: 't1',
      from: '2025-01-01',
      periods: [
        { start: '00:00', label: 'valley', price10000: 3000 },
        { start: '08:00', label: 'flat', price10000: 6000 },
        { start: '22:00', label: 'valley', price10000: 3000 },
      ],
    },
  ]);
  const one = C.estimateHomeCharge(
    { date: '2025-11-20', startTime: '01:00', endTime: '05:00' },
    VEHICLE,
    70,
    valleyNight
  );
  assert.equal(one.estMethod, 'power');
  assert.equal(one.estQuantity100, 2800);
  assert.deepEqual(
    one.slice.segments.map(x => [x.label, x.quantity100]),
    [['valley', 2800]]
  );
  const raised = home([
    { id: 't1', from: '2025-01-01', periods: [{ start: '00:00', label: 'flat', price10000: 6000 }] },
    { id: 't2', from: '2025-11-21', periods: [{ start: '00:00', label: 'flat', price10000: 9000 }] },
  ]);
  const two = C.estimateHomeCharge({ date: '2025-11-20', startTime: '22:00', endTime: '02:00' }, VEHICLE, 70, raised);
  assert.deepEqual(
    two.slice.segments.map(x => [x.date, x.price10000]),
    [
      ['2025-11-20', 6000],
      ['2025-11-21', 9000],
    ]
  );
  assert.equal(two.slice.cents, 2100);
});

test('没有电价版本时报错；手填估计电量与功率法按优先级取值', () => {
  assert.throws(
    () => C.estimateHomeCharge({ date: '2025-11-20', startTime: '22:00', estQuantity: '10' }, VEHICLE, 70, home([])),
    /请先在家充设置里填写电价/
  );
  const typed = C.estimateHomeCharge({ date: '2025-11-20', startTime: '22:00', estQuantity: '10' }, VEHICLE, 70, HOME);
  assert.equal(typed.estMethod, 'typed');
  assert.equal(typed.estQuantity100, 1000);
  assert.equal(typed.endTime, '23:26');
  assert.equal(typed.endEstimated, true);
  // State of charge wins over the end time; power is used when the state of charge is missing.
  const both = C.estimateHomeCharge(
    { date: '2025-11-20', startTime: '22:00', endTime: '00:00', socBefore: 30, socAfter: 80 },
    VEHICLE,
    70,
    HOME
  );
  assert.equal(both.estMethod, 'soc');
  assert.equal(both.endEstimated, false);
  assert.equal(both.estQuantity100, 3500);
  const power = C.estimateHomeCharge(
    { date: '2025-11-20', startTime: '22:00', endTime: '00:00', socBefore: 30 },
    VEHICLE,
    70,
    HOME
  );
  assert.equal(power.estMethod, 'power');
  assert.equal(power.estQuantity100, 1400);
  assert.throws(
    () => C.estimateHomeCharge({ date: '2025-11-20', startTime: '22:00' }, VEHICLE, 70, HOME),
    /请填写充电前后电量，或充满时间，或估计电量/
  );
});

test('每 1% 电量：无样本用电池标称值，三张账单后按实测校准，离群账单被丢弃', () => {
  const k0 = C.homeK(VEHICLE, [], []);
  assert.deepEqual([k0.k, k0.k0, k0.samples, k0.mae], [70, 70, 0, null]);
  assert.equal(C.homeK({ id: 'v1', batteryKwh100: null }, [], []).k, null);
  const state = { home: home(), records: [], bills: [] },
    a = charge('a', { date: '2025-11-20', startTime: '22:00', socBefore: 30, socAfter: 80 }, state),
    b = charge('b', { date: '2025-11-21', startTime: '23:00', socBefore: 40, socAfter: 70 }, state);
  state.records = [a, b];
  state.bills = [
    bill('b1', '2025-11-20', '2025-11-20', 1540),
    bill('b2', '2025-11-21', '2025-11-21', 3080),
    bill('b3', '2025-11-22', '2025-11-22', 1540),
  ];
  const k = C.homeK(VEHICLE, state.records, state.bills);
  assert.equal(k.samples, 3);
  assert.equal(k.k, 77);
  assert.equal(k.k0, 70);
  assert.ok(k.mae > 0);
  // A bill that implies 3 kWh per 1% is far outside 0.6–1.5 × k0 and is ignored.
  state.bills = [bill('b4', '2025-11-20', '2025-11-20', 30000)];
  assert.equal(C.homeK(VEHICLE, state.records, state.bills).samples, 0);
});

test('账单 11-21 30.80 kWh 按预估权重分给两笔记录，都不足覆盖仍待对账（验收用例）', () => {
  const state = { home: home(), records: [], bills: [] },
    a = charge('a', { date: '2025-11-20', startTime: '22:00', socBefore: 30, socAfter: 80 }, state),
    b = charge('b', { date: '2025-11-21', startTime: '23:00', socBefore: 40, socAfter: 70 }, state);
  state.records = [a, b];
  state.bills = [bill('b1', '2025-11-21', '2025-11-21', 3080)];
  const warnings = C.settleAll(state);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    a.alloc.map(x => [x.billId, x.quantity100, x.cents, x.weight100]),
    [['b1', 2310, 693, 2100]]
  );
  assert.deepEqual(
    b.alloc.map(x => [x.billId, x.quantity100, x.cents, x.weight100]),
    [['b1', 770, 231, 700]]
  );
  assert.equal(a.settle, 'pending');
  assert.equal(a.quantity100, null);
  assert.equal(b.settle, 'pending');
  assert.equal(C.allocatedPercent(a), 66);
  assert.equal(C.allocatedPercent(b), 37);
  assert.equal(C.confidence(a, state), 'estimate');
  assert.equal(C.confidenceText(C.confidence(a, state)), '预估');
});

test('再录账单 11-20 14.50 kWh 后，A 被两张账单覆盖成为已对账并合计到分', () => {
  const state = { home: home(), records: [], bills: [] },
    a = charge('a', { date: '2025-11-20', startTime: '22:00', socBefore: 30, socAfter: 80 }, state),
    b = charge('b', { date: '2025-11-21', startTime: '23:00', socBefore: 40, socAfter: 70 }, state);
  state.records = [a, b];
  state.bills = [bill('b1', '2025-11-21', '2025-11-21', 3080), bill('b0', '2025-11-20', '2025-11-20', 1450)];
  C.settleAll(state);
  assert.equal(a.settle, 'bill');
  assert.equal(a.quantity100, 3760);
  assert.equal(a.cents, 1346);
  assert.deepEqual(
    a.alloc.map(x => [x.billId, x.quantity100, x.cents]),
    [
      ['b0', 1450, 653],
      ['b1', 2310, 693],
    ]
  );
  assert.equal(C.confidence(a, state), 'allocated');
  assert.equal(C.confidence(b, state), 'estimate');
  // 14.50 kWh over the flat and valley half of 11-20: 7.25 × 0.60 + 7.25 × 0.30 = 4.35 + 2.18.
  assert.deepEqual([a.alloc[0].cents, a.alloc[1].cents], [653, 693]);
});

test('账单有金额时按权重精确分配，合计等于账单金额；删除账单后回到待对账', () => {
  const state = { home: home(), records: [], bills: [] },
    a = charge('a', { date: '2025-11-20', startTime: '22:00', socBefore: 30, socAfter: 80 }, state),
    b = charge('b', { date: '2025-11-21', startTime: '23:00', socBefore: 40, socAfter: 70 }, state);
  state.records = [a, b];
  state.bills = [bill('b1', '2025-11-21', '2025-11-21', 3080, 1001)];
  C.settleAll(state);
  assert.equal(sum(a.alloc, 'quantity100') + sum(b.alloc, 'quantity100'), 3080);
  assert.equal(sum(a.alloc, 'cents') + sum(b.alloc, 'cents'), 1001);
  assert.equal(a.alloc[0].cents, 751);
  assert.equal(b.alloc[0].cents, 250);
  state.bills = [];
  C.settleAll(state);
  assert.deepEqual([a.settle, a.quantity100, a.cents, a.alloc.length], ['pending', null, null, 0]);
  assert.equal(sum(a.alloc, 'quantity100'), 0);
});

test('已确认（manual）记录先按时间占比扣除，账单电量更小时给出提示', () => {
  const state = { home: home(), records: [], bills: [] },
    manual = charge(
      'm',
      { date: '2025-11-21', startTime: '00:00', endTime: '06:00', socBefore: 20, socAfter: 80 },
      state
    );
  manual.settle = 'manual';
  manual.quantity100 = 800;
  manual.cents = 2000;
  const other = charge('a', { date: '2025-11-21', startTime: '08:00', endTime: '12:00' }, state);
  state.records = [manual, other];
  state.bills = [bill('b1', '2025-11-21', '2025-11-21', 2000)];
  C.settleAll(state);
  assert.equal(other.alloc[0].quantity100, 1200);
  assert.equal(other.alloc[0].cents, 720);
  // A bill smaller than the confirmed charge leaves nothing for the other charge, and the user is warned.
  manual.quantity100 = 2500;
  state.bills = [bill('b1', '2025-11-21', '2025-11-21', 2000)];
  const warnings = C.settleAll(state);
  assert.deepEqual(
    warnings.map(w => w.message),
    ['账单电量小于已确认记录合计，请核对']
  );
  assert.equal(other.alloc[0].quantity100, 0);
});

test('账单期间没有对应家充记录时，超过 0.5 kWh 提示可能漏记，待机用电不提示', () => {
  const state = { home: home(), records: [], bills: [bill('b1', '2025-11-10', '2025-11-12', 30)] };
  assert.deepEqual(C.settleAll(state), []);
  state.bills = [bill('b1', '2025-11-10', '2025-11-12', 3000)];
  assert.match(C.settleAll(state)[0].message, /没有对应的家充记录，可能漏记/);
});

test('对账后费用、能耗与统计都改用分摊到的实际电量', () => {
  const state = { home: home(), records: [], bills: [] },
    a = charge('a', { date: '2025-11-18', startTime: '23:00', socBefore: 20, socAfter: 80 }, state),
    b = charge('b', { date: '2025-11-20', startTime: '23:00', socBefore: 20, socAfter: 80 }, state);
  state.records = [a, b];
  state.bills = [bill('b1', '2025-11-18', '2025-11-19', 3500), bill('b0', '2025-11-20', '2025-11-21', 3500)];
  C.settleAll(state);
  assert.deepEqual([a.settle, a.quantity100, a.cents], ['bill', 3500, 1050]);
  const stats = D.statistics(state.records, '2025-11');
  assert.equal(stats.total, 2100);
  assert.equal(stats.charge, 7000);
  assert.equal(stats.estimatedCents, 0);
});
