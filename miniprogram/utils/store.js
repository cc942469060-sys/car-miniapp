const D = require('./domain');
const C = require('./charging');
const KEY = 'car-miniapp:v1',
  APP = 'car-miniapp',
  VERSION = 2,
  DEFAULT_HOME = { meter: '', chargerKw100: 700, tariffs: [] };
const clone = x => JSON.parse(JSON.stringify(x));
function empty() {
  return {
    version: VERSION,
    vehicles: [],
    records: [],
    plans: [],
    currentId: '',
    home: clone(DEFAULT_HOME),
    bills: [],
  };
}
// Brings stored or backed-up data to the current schema in memory; unknown data is reported, never rewritten.
function migrate(raw, label, hint) {
  D.assert(
    raw && typeof raw === 'object' && Number.isInteger(raw.version) && raw.version >= 1,
    label + '格式不兼容' + hint
  );
  D.assert(raw.version <= VERSION, label + '来自更新版本的小程序，与当前版本不兼容，请先更新小程序');
  // Upgrade older schemas here one version at a time. Version 2 adds home charging and its bills; every existing
  // record stays a non-home charge, so statistics, consumption and CSV rows are unchanged by the upgrade.
  if (raw.version === 1) {
    raw.version = 2;
    raw.home = clone(DEFAULT_HOME);
    raw.bills = [];
    raw.vehicles = (raw.vehicles || []).map(v => Object.assign({ batteryKwh100: null }, v));
    raw.records = (raw.records || []).map(r =>
      Object.assign(
        {
          home: false,
          settle: '',
          startTime: '',
          endTime: '',
          endEstimated: false,
          socBefore: null,
          estQuantity100: null,
          estCents: null,
          estMethod: '',
          estK10000: null,
          alloc: [],
        },
        r
      )
    );
  }
  D.assert(
    Array.isArray(raw.vehicles) &&
      Array.isArray(raw.records) &&
      Array.isArray(raw.plans) &&
      Array.isArray(raw.bills) &&
      raw.home &&
      typeof raw.home === 'object' &&
      Array.isArray(raw.home.tariffs),
    label + '格式不兼容' + hint
  );
  return raw;
}
// Checks a backup with the same rules as editing and returns the clean data to store; nothing is written here.
function normalizeBackup(raw) {
  D.assert(raw && raw.app === APP, '这不是车小记导出的备份文件');
  const s = migrate(clone(raw), '备份文件', ''),
    seen = new Set();
  D.assert(s.vehicles.length, '备份中没有车辆数据');
  const item = (label, i, x, fn) => {
    try {
      D.assert(x && typeof x.id === 'string' && x.id && !seen.has(x.id), '编号缺失或重复');
      seen.add(x.id);
      return fn();
    } catch (e) {
      D.fail(`备份中第 ${i + 1} ${label}无效` + (e.user ? '：' + e.message : ''));
    }
  };
  const vehicles = s.vehicles.map((v, i) =>
    item('辆车', i, v, () =>
      D.normalizeVehicle(
        Object.assign({}, v, {
          batteryKwh: v.batteryKwh100 == null ? '' : (v.batteryKwh100 / 100).toFixed(2),
        }),
        { id: v.id, archived: v.archived === true },
        []
      )
    )
  );
  const plans = s.plans.map((p, i) =>
    item('个计划', i, p, () => {
      D.assert(
        vehicles.some(v => v.id === p.vehicleId),
        '所属车辆不存在'
      );
      return D.normalizePlan(p, p.vehicleId);
    })
  );
  const records = s.records.map((r, i) =>
    item('条记录', i, r, () => {
      const v = vehicles.find(x => x.id === r.vehicleId);
      D.assert(v, '所属车辆不存在');
      D.assert(
        (r.cents == null || Number.isSafeInteger(r.cents)) &&
          (!['fuel', 'charge'].includes(r.kind) || r.quantity100 == null || Number.isSafeInteger(r.quantity100)),
        '金额或补能量格式错误'
      );
      // Archived vehicles keep their history, so their records are checked as if the vehicle were active.
      const n = D.normalizeRecord(D.recordInput(r), Object.assign({}, v, { archived: false }));
      D.assert(!n.planId || plans.some(p => p.id === n.planId && p.vehicleId === v.id), '关联计划不存在');
      // Allocation is always recomputed from the bills after restoring, never trusted from the file.
      n.alloc = [];
      return n;
    })
  );
  const meter = ['', 'dedicated', 'shared'].includes(s.home.meter) ? s.home.meter : null;
  D.assert(meter !== null, '备份中的家充电表类型无效');
  D.assert(!s.bills.length || meter === 'dedicated', '备份中的家充数据不一致，请检查电表类型');
  D.assert(
    Number.isSafeInteger(s.home.chargerKw100) && s.home.chargerKw100 >= 100 && s.home.chargerKw100 <= 5000,
    '备份中的充电桩功率无效'
  );
  const tariffs = [];
  s.home.tariffs.forEach((t, i) =>
    item('个电价版本', i, t, () => {
      tariffs.push(C.normalizeTariff(t, tariffs, null));
    })
  );
  const bills = [];
  s.bills.forEach((b, i) =>
    item('张账单', i, b, () => {
      bills.push(C.normalizeBill(b, bills, null, { meter }));
    })
  );
  D.assert(!bills.length || meter === 'dedicated', '备份中的家充数据不一致，请检查电表类型');
  const home = { meter, chargerKw100: s.home.chargerKw100, tariffs };
  vehicles.forEach(v => {
    try {
      D.validateTimeline(v, records);
    } catch (e) {
      D.fail(`备份中「${v.name}」的${e.message}`);
    }
  });
  const currentId = vehicles.some(v => v.id === s.currentId)
    ? s.currentId
    : (vehicles.find(v => !v.archived) || vehicles[0]).id;
  const state = { version: VERSION, vehicles, records, plans, currentId, home, bills };
  try {
    C.settleAll(state);
  } catch (e) {
    D.fail('备份中的家充数据无效' + (e.user ? '：' + e.message : ''));
  }
  return state;
}
function createStore(storage) {
  function read() {
    let raw;
    try {
      raw = storage.get();
    } catch (e) {
      D.fail('读取本地数据失败，请重新打开小程序');
    }
    if (raw === '' || raw == null) return empty();
    return migrate(clone(raw), '本地数据', '，请勿清除缓存；如有备份，可在「车辆」页从备份恢复');
  }
  // A failed write of a large ledger most likely hit WeChat's 1MB per-key limit, which freeing device space does not fix.
  function write(s, action) {
    try {
      storage.set(s);
    } catch (e) {
      D.fail(
        JSON.stringify(s).length > 500000
          ? `${action}失败，本机数据未更改：账本数据较大，可能已达到微信单项存储上限（约 1MB）。请先导出备份，并反馈此问题`
          : `${action}失败，本机数据未更改。请检查设备存储空间后重试`
      );
    }
  }
  function change(fn) {
    const s = read();
    const result = fn(s);
    write(s, '保存');
    return result;
  }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }
  return {
    read,
    exportData() {
      return Object.assign({ app: APP, exportedAt: new Date().toISOString() }, read());
    },
    // Replaces all data in one write, and works even when the current local data cannot be read.
    restore(raw) {
      const data = normalizeBackup(raw);
      write(data, '恢复');
      return data;
    },
    select(id) {
      return change(s => {
        D.assert(
          s.vehicles.some(v => v.id === id),
          '车辆不存在'
        );
        s.currentId = id;
      });
    },
    saveVehicle(input) {
      return change(s => {
        const existing = s.vehicles.find(v => v.id === input.id);
        D.assert(!input.id || existing, '车辆不存在');
        const v = D.normalizeVehicle(Object.assign({}, input, { id: input.id || uid('v') }), existing, s.records);
        if (existing) s.vehicles[s.vehicles.indexOf(existing)] = v;
        else s.vehicles.push(v);
        s.currentId = v.id;
        return v.id;
      });
    },
    archiveVehicle(id, archived) {
      return change(s => {
        const v = s.vehicles.find(x => x.id === id);
        D.assert(v, '车辆不存在');
        v.archived = archived;
        if (archived && s.currentId === id) s.currentId = (s.vehicles.find(x => !x.archived) || {}).id || id;
      });
    },
    // Removes a vehicle together with its records and plans; the page confirms first and suggests a backup.
    deleteVehicle(id) {
      return change(s => {
        D.assert(
          s.vehicles.some(v => v.id === id),
          '车辆不存在'
        );
        const removed = {
          records: s.records.filter(r => r.vehicleId === id).length,
          plans: s.plans.filter(p => p.vehicleId === id).length,
        };
        s.vehicles = s.vehicles.filter(v => v.id !== id);
        s.records = s.records.filter(r => r.vehicleId !== id);
        s.plans = s.plans.filter(p => p.vehicleId !== id);
        C.settleAll(s);
        if (s.currentId === id) s.currentId = (s.vehicles.find(v => !v.archived) || s.vehicles[0] || {}).id || '';
        return removed;
      });
    },
    // An odometer reading without an expense becomes the vehicle's manual reading for today.
    updateMileage(id, value) {
      return change(s => {
        const v = s.vehicles.find(x => x.id === id);
        D.assert(v && !v.archived, '车辆不存在或已归档');
        const mileage = D.integer(String(value == null ? '' : value).replace(/[,，\s]/g, ''), '当前里程'),
          now = D.currentMileage(v, s.records);
        D.assert(mileage >= now.mileage, `当前里程不能小于已记录的 ${now.mileage} km`);
        v.baseDate = D.today();
        v.baseMileage = mileage;
        D.validateTimeline(v, s.records);
        return mileage;
      });
    },
    saveRecord(input) {
      return change(s => {
        const old = s.records.find(r => r.id === input.id);
        D.assert(!input.id || old, '记录不存在');
        const v = s.vehicles.find(x => x.id === input.vehicleId);
        // Estimate first: an estimated record has to carry its quantity and amount into validation.
        const draft = Object.assign({}, input, { id: input.id || uid('r') });
        if (draft.kind === 'charge' && draft.home === true && draft.settle !== 'bill') {
          const k = C.homeK(v, s.records, s.bills).k;
          try {
            const est = C.estimateHomeCharge(draft, v, k, s.home);
            Object.assign(draft, {
              estQuantity100: est.estQuantity100,
              estCents: est.estCents,
              estMethod: est.estMethod,
              estK10000: est.estK10000,
              endTime: est.endTime,
              endEstimated: est.endEstimated,
            });
            if (draft.settle === 'estimate') {
              draft.quantity = (est.estQuantity100 / 100).toFixed(2);
              draft.amount = D.money(est.estCents);
            }
          } catch (e) {
            if (draft.settle !== 'manual') throw e;
          }
        }
        const r = D.normalizeRecord(draft, v);
        D.assert(!old || old.vehicleId === v.id, '不能移动记录到其他车辆');
        if (r.planId)
          D.assert(
            s.plans.some(p => p.id === r.planId && p.vehicleId === v.id),
            '关联计划不存在'
          );
        // The meter type decides how a home charge is booked; a pending charge on a shared meter is booked as estimated.
        if (r.home && r.settle !== 'bill') {
          if (r.settle === 'pending' && s.home.meter === 'shared') r.settle = 'estimate';
          if (r.settle === 'estimate' && s.home.meter === 'dedicated') r.settle = 'pending';
          if (r.settle === 'pending' || r.settle === 'estimate') D.assert(s.home.meter, '请先在家充设置里选择电表类型');
        }
        // Home charges keep an estimate next to the real values, so a bill can fill the gap later.
        if (r.home && r.settle !== 'bill') {
          if (r.settle === 'estimate' && r.estQuantity100 && r.estCents != null) {
            r.quantity100 = r.estQuantity100;
            r.cents = r.estCents;
          }
          if (r.settle === 'pending') {
            r.quantity100 = null;
            r.cents = null;
          }
          const window = C.chargeWindow(r);
          if (window) {
            const clash = s.records.some(x => {
              if (x.id === r.id || x.vehicleId !== v.id || !x.home || x.kind !== 'charge') return false;
              const other = C.chargeWindow(x);
              return other && C.windowOverlap(window, other) > 0;
            });
            D.assert(!clash, '这段充电时间与已记录的家充时段重叠，请核对');
          }
        }
        if (old) s.records[s.records.indexOf(old)] = r;
        else s.records.push(r);
        D.validateTimeline(v, s.records);
        if (r.home) C.settleAll(s);
        return r.id;
      });
    },
    deleteRecord(id) {
      return change(s => {
        const old = s.records.find(r => r.id === id);
        D.assert(old, '记录不存在');
        D.assert(
          s.vehicles.some(v => v.id === old.vehicleId && !v.archived),
          '车辆不存在或已归档'
        );
        s.records = s.records.filter(r => r.id !== id);
        if (old.home) C.settleAll(s);
        return old;
      });
    },
    // Puts back a record deleted moments ago under its old id, with the same checks as saving it.
    undoDelete(record) {
      return change(s => {
        D.assert(!s.records.some(r => r.id === record.id), '这条记录已经恢复');
        const v = s.vehicles.find(x => x.id === record.vehicleId),
          r = D.normalizeRecord(D.recordInput(record), v);
        if (r.planId)
          D.assert(
            s.plans.some(p => p.id === r.planId && p.vehicleId === v.id),
            '关联的计划已删除，无法撤销'
          );
        s.records.push(r);
        D.validateTimeline(v, s.records);
        if (r.home) C.settleAll(s);
        return r.id;
      });
    },
    saveHome(input) {
      return change(s => {
        const home = C.normalizeHome(input);
        D.assert(!(home.meter === 'shared' && s.bills.length), '已录过账单，不能切换到共用总表；请先删除账单');
        home.tariffs = s.home.tariffs;
        s.records.forEach(r => {
          if (!r.home) return;
          if (home.meter === 'dedicated' && r.settle === 'estimate') {
            r.settle = 'pending';
            r.quantity100 = null;
            r.cents = null;
          }
          if (home.meter === 'shared' && r.settle === 'pending') {
            D.assert(r.estQuantity100 && r.estCents != null, '有家充记录缺少预估，无法按预估入账，请先编辑该记录');
            r.settle = 'estimate';
            r.quantity100 = r.estQuantity100;
            r.cents = r.estCents;
          }
        });
        s.home = home;
        C.settleAll(s);
      });
    },
    saveTariff(input) {
      return change(s => {
        const existing = input.id ? s.home.tariffs.find(t => t.id === input.id) : null;
        D.assert(!input.id || existing, '电价版本不存在');
        const tariff = C.normalizeTariff(
          Object.assign({}, input, { id: input.id || uid('t') }),
          s.home.tariffs,
          existing
        );
        if (existing) s.home.tariffs[s.home.tariffs.indexOf(existing)] = tariff;
        else s.home.tariffs.push(tariff);
        s.home.tariffs.sort((a, b) => a.from.localeCompare(b.from));
        C.settleAll(s);
        return tariff.id;
      });
    },
    deleteTariff(id) {
      return change(s => {
        D.assert(
          s.home.tariffs.some(t => t.id === id),
          '电价版本不存在'
        );
        const rest = s.home.tariffs.filter(t => t.id !== id);
        s.records.forEach(r => {
          if (!r.home || (r.settle !== 'pending' && r.settle !== 'estimate')) return;
          C.coveredDates(r).forEach(date =>
            D.assert(C.tariffFor(date, rest), '删除后，有家充记录将没有适用电价，请先调整记录')
          );
        });
        s.bills.forEach(b => {
          if (b.cents != null) return;
          for (let date = b.from; date <= b.to; date = D.addDays(date, 1))
            D.assert(C.tariffFor(date, rest), '删除后，有账单将没有适用电价，请先调整账单');
        });
        s.home.tariffs = rest;
        C.settleAll(s);
      });
    },
    saveBill(input) {
      return change(s => {
        const existing = s.bills.find(b => b.id === input.id);
        D.assert(!input.id || existing, '账单不存在');
        const b = C.normalizeBill(Object.assign({}, input, { id: input.id || uid('b') }), s.bills, existing, s.home);
        if (existing) s.bills[s.bills.indexOf(existing)] = b;
        else s.bills.push(b);
        s.bills.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
        C.settleAll(s);
        return b.id;
      });
    },
    deleteBill(id) {
      return change(s => {
        D.assert(
          s.bills.some(b => b.id === id),
          '账单不存在'
        );
        s.bills = s.bills.filter(b => b.id !== id);
        C.settleAll(s);
      });
    },
    savePlan(input) {
      return change(s => {
        D.assert(
          s.vehicles.some(v => v.id === input.vehicleId && !v.archived),
          '车辆不存在或已归档'
        );
        const old = s.plans.find(p => p.id === input.id);
        D.assert(!input.id || old, '计划不存在');
        D.assert(!old || old.vehicleId === input.vehicleId, '不能移动计划到其他车辆');
        const p = D.normalizePlan(Object.assign({}, input, { id: input.id || uid('p') }), input.vehicleId);
        if (old) s.plans[s.plans.indexOf(old)] = p;
        else s.plans.push(p);
        return p.id;
      });
    },
    deletePlan(id) {
      return change(s => {
        const old = s.plans.find(p => p.id === id);
        D.assert(old, '计划不存在');
        D.assert(
          s.vehicles.some(v => v.id === old.vehicleId && !v.archived),
          '车辆不存在或已归档'
        );
        s.plans = s.plans.filter(p => p.id !== id);
        s.records.forEach(r => {
          if (r.planId === id) {
            r.planId = '';
            r.complete = false;
          }
        });
      });
    },
  };
}
let instance;
function getStore() {
  if (!instance) instance = createStore({ get: () => wx.getStorageSync(KEY), set: s => wx.setStorageSync(KEY, s) });
  return instance;
}
module.exports = { createStore, getStore, normalizeBackup };
