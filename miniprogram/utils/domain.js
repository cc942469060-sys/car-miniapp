const TYPES = [
  { id: 'fuel', name: '燃油车', fuel: true, charge: false },
  { id: 'hev', name: '非插电混动 HEV', fuel: true, charge: false },
  { id: 'phev', name: '插混 / 增程', fuel: true, charge: true },
  { id: 'ev', name: '纯电车', fuel: false, charge: true },
];
const KINDS = { fuel: '加油', charge: '充电', service: '保养', other: '其他费用' };
const PLAN_KINDS = ['service', 'other'];
const OTHER_CATEGORIES = ['停车', '通行', '洗车', '保险', '年检', '维修', '罚款', '其他'];
function dateOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function today() {
  return dateOf(new Date());
}
// Errors raised here are written for the user; any other error is a bug and is shown as a generic message.
function fail(message) {
  const e = new Error(message);
  e.user = true;
  throw e;
}
function assert(ok, message) {
  if (!ok) fail(message);
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function integer(value, label, max = 9999999) {
  assert(String(value).trim() !== '' && /^\d+$/.test(String(value)), `${label}请输入非负整数`);
  const n = Number(value);
  assert(Number.isSafeInteger(n) && n <= max, `${label}超出范围`);
  return n;
}
// Accepts what a decimal keyboard produces mid-typing too, such as "12." or ".5".
function fixed(value, label, positive = false) {
  const s = String(value).trim();
  assert(/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s), `${label}请输入最多两位小数的数字`);
  const n = Math.round(Number(s) * 100);
  assert(Number.isSafeInteger(n) && n <= 999999999 && (positive ? n > 0 : n >= 0), `${label}超出范围`);
  return n;
}
function money(cents) {
  return (cents / 100).toFixed(2);
}
// For display only; `money` stays plain because it also fills form inputs.
function yuan(cents) {
  const [whole, part] = money(cents).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + part;
}
function typeOf(v) {
  return TYPES.find(t => t.id === v.type);
}
function allowedKinds(v) {
  const t = typeOf(v);
  return [...(t.fuel ? ['fuel'] : []), ...(t.charge ? ['charge'] : []), 'service', 'other'];
}
function currentMileage(v, records) {
  return records
    .filter(r => r.vehicleId === v.id && r.mileage != null)
    .reduce(
      (a, r) =>
        r.date > a.date || (r.date === a.date && r.mileage > a.mileage) ? { date: r.date, mileage: r.mileage } : a,
      { date: v.baseDate, mileage: v.baseMileage }
    );
}
function validateTimeline(v, records) {
  const points = [{ date: v.baseDate, mileage: v.baseMileage }].concat(
    records.filter(r => r.vehicleId === v.id && r.mileage != null)
  );
  points.sort((a, b) => a.date.localeCompare(b.date) || a.mileage - b.mileage);
  for (let i = 1; i < points.length; i++)
    assert(points[i].mileage >= points[i - 1].mileage, '累计里程与相邻日期的记录冲突，请核对日期和里程');
}
function normalizeVehicle(input, existing, records) {
  const name = String(input.name || '').trim();
  assert(name && name.length <= 30, '车辆昵称必填，最多 30 字');
  assert(
    TYPES.some(t => t.id === input.type),
    '请选择能源类型'
  );
  assert(validDate(input.baseDate) && input.baseDate <= today(), '里程日期无效或晚于今天');
  const v = {
    id: existing ? existing.id : input.id,
    name,
    type: input.type,
    model: String(input.model || '')
      .trim()
      .slice(0, 50),
    baseDate: input.baseDate,
    baseMileage: integer(input.baseMileage, '累计里程'),
    archived: existing ? existing.archived : false,
  };
  assert(
    !records.some(r => r.vehicleId === v.id && !allowedKinds(v).includes(r.kind)),
    '已有与该能源类型不兼容的记录，暂不能切换能源类型'
  );
  validateTimeline(v, records);
  return v;
}
function normalizeRecord(input, v) {
  assert(v && !v.archived, '车辆不存在或已归档');
  assert(allowedKinds(v).includes(input.kind), '该车辆不支持此记录类型');
  assert(validDate(input.date) && input.date <= today(), '记录日期无效或晚于今天');
  // Other expenses (parking, tolls...) may omit mileage unless they complete a plan; such records stay out of the mileage timeline.
  const planId = input.planId || '',
    noMileage = input.kind === 'other' && !planId && (input.mileage === '' || input.mileage == null);
  const r = {
    id: input.id,
    vehicleId: v.id,
    kind: input.kind,
    date: input.date,
    mileage: noMileage ? null : integer(input.mileage, '累计里程'),
    cents: fixed(input.amount, '金额'),
    note: String(input.note || '')
      .trim()
      .slice(0, 120),
    planId,
    complete: !!input.complete,
  };
  if (r.kind === 'fuel' || r.kind === 'charge') r.quantity100 = fixed(input.quantity, '补能量', true);
  if (r.kind === 'fuel') {
    r.full = !!input.full;
    r.gap = !!input.gap;
  }
  if (r.kind === 'charge') {
    r.socAfter = input.socAfter === '' || input.socAfter == null ? null : integer(input.socAfter, '充电后电量', 100);
    // A single switch covers completeness for charging: every charge since the previous one is recorded.
    r.confirmed = !!input.confirmed;
  }
  // Records saved before categories existed, or with an unknown one, count as 其他.
  if (r.kind === 'other') r.category = OTHER_CATEGORIES.includes(input.category) ? input.category : '其他';
  assert((!r.planId && !r.complete) || PLAN_KINDS.includes(r.kind), '只有保养或其他费用可完成养护计划');
  return r;
}
// A stored record as form input, so edited records and restored backups pass the same validation as new entries.
function recordInput(r) {
  return Object.assign({}, r, {
    mileage: r.mileage == null ? '' : String(r.mileage),
    amount: money(r.cents),
    quantity: r.quantity100 ? (r.quantity100 / 100).toFixed(2) : '',
    socAfter: r.socAfter == null ? '' : String(r.socAfter),
  });
}
// Records keep the amount and quantity, not the unit price. The shortest price (2 to 4 decimals) that gives back the
// stored amount is the one that was typed in nearly every case, e.g. 0.617 元/kWh rather than 0.62.
function unitPrice(r) {
  if (!r.cents || !r.quantity100) return '';
  const exact = r.cents / r.quantity100,
    digits = [2, 3].find(d => Math.round(Number(exact.toFixed(d)) * r.quantity100) === r.cents);
  return exact.toFixed(digits || 4);
}
// A new fuel or charge record starts from the latest reading and repeats the unit price, note and state of charge of
// the last record of its kind. Other kinds start empty, so parking fees and the like keep their mileage optional.
function recordDefaults(v, records, kind) {
  if (kind !== 'fuel' && kind !== 'charge') return { mileage: '', price: '', note: '', socAfter: '' };
  const last = records
    .filter(r => r.vehicleId === v.id && r.kind === kind)
    .sort((a, b) => b.date.localeCompare(a.date) || b.mileage - a.mileage || b.id.localeCompare(a.id))[0];
  return {
    mileage: String(currentMileage(v, records).mileage),
    price: last ? unitPrice(last) : '',
    note: last ? last.note || '' : '',
    socAfter: last && last.socAfter != null ? String(last.socAfter) : '',
  };
}
// Soft checks for likely typos in a normalized record; the user confirms and may still save.
function recordWarnings(r, v, records) {
  const warnings = [],
    quantity = r.quantity100 ? r.quantity100 / 100 : 0;
  if (r.mileage != null) {
    const prev = records
      .concat([{ vehicleId: v.id, date: v.baseDate, mileage: v.baseMileage }])
      .filter(x => x.vehicleId === v.id && x.id !== r.id && x.mileage != null && x.date <= r.date)
      .reduce((a, x) => (!a || x.mileage > a.mileage ? x : a), null);
    const km = prev ? r.mileage - prev.mileage : 0;
    if (km > 2000 && km > Math.max(1, daysBetween(r.date, prev.date)) * 800)
      warnings.push(`里程比 ${prev.date} 的 ${prev.mileage} km 多出 ${km} km`);
    // New fuel and charge records start at the latest reading (recordDefaults). Keeping it on another day usually
    // means it was not updated; on the same day, refuelling or charging again without driving is normal.
    const latest = currentMileage(v, records),
      isNew = !records.some(x => x.id === r.id);
    if (isNew && (r.kind === 'fuel' || r.kind === 'charge') && r.mileage === latest.mileage && r.date !== latest.date)
      warnings.push(`累计里程与 ${latest.date} 的最近读数相同，可能还没改成仪表上的当前里程`);
  }
  if (quantity > (r.kind === 'fuel' ? 120 : 150))
    warnings.push(
      r.kind === 'fuel' ? `一次加油 ${quantity} L，超过常见油箱容量` : `一次充入 ${quantity} kWh，超过常见电池容量`
    );
  const price = quantity && r.cents ? r.cents / 100 / quantity : 0;
  if (price && (r.kind === 'fuel' ? price < 4 || price > 15 : price > 5))
    warnings.push(`单价约 ¥${price.toFixed(2)}/${r.kind === 'fuel' ? 'L' : 'kWh'}，与常见价格差别较大`);
  return warnings;
}
// Only completed, explicitly valid intervals contribute; never average interval rates directly.
// An interval closes at the next endpoint in the same state (full tank, or the same SOC after charging).
// Endpoints in another state stay open as anchors; an endpoint at the anchor's mileage is folded into the next interval.
function energyIntervals(records, kind) {
  const sorted = records
    .filter(r => r.kind === kind)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.mileage - b.mileage || a.id.localeCompare(b.id));
  let open = [],
    endpoints = 0;
  const intervals = [];
  sorted.forEach(r => {
    const broken = r.gap || (kind === 'charge' && !r.confirmed);
    open = broken
      ? []
      : open.map(a => ({ record: a.record, quantity: a.quantity + r.quantity100, cents: a.cents + (r.cents || 0) }));
    if (!(kind === 'fuel' ? r.full : r.socAfter != null)) return;
    endpoints++;
    const anchor = open.find(a => kind === 'fuel' || a.record.socAfter === r.socAfter);
    if (anchor && r.mileage <= anchor.record.mileage) return;
    if (anchor) {
      const km = r.mileage - anchor.record.mileage;
      intervals.push({
        from: anchor.record.date,
        to: r.date,
        toId: r.id,
        km,
        quantity100: anchor.quantity,
        cents: anchor.cents,
        rate: (anchor.quantity / km).toFixed(2),
      });
      open = [];
    }
    open.push({ record: r, quantity: 0, cents: 0 });
  });
  // Energy cost per km uses the same complete intervals, so it never mixes in spending without matching mileage.
  const km = intervals.reduce((s, x) => s + x.km, 0),
    q = intervals.reduce((s, x) => s + x.quantity100, 0),
    c = intervals.reduce((s, x) => s + x.cents, 0),
    rate = km ? (q / km).toFixed(2) : null;
  return {
    intervals,
    km,
    rate,
    costPerKm: km ? (c / km / 100).toFixed(2) : null,
    hint: rate ? '' : energyHint(kind, sorted.length, endpoints, open),
  };
}
// Why no rate is shown yet, and which record would produce one.
function energyHint(kind, count, endpoints, open) {
  const fuel = kind === 'fuel';
  if (!count) return fuel ? '加满油后记一笔，再加满一次即可算出油耗' : '充电时填写充电后电量，两次相同即可算出电耗';
  if (open.length)
    return fuel
      ? '已有一次加满，下次加满后即可算出油耗'
      : `下次充到 ${open.map(a => a.record.socAfter).join('% 或 ')}% 并打开「充电都已记录」，即可算出电耗`;
  if (!endpoints) return fuel ? '加满时打开「本次已加满」，两次加满即可算出油耗' : '填写「充电后电量」后才能算出电耗';
  return fuel ? '最近一次标记了漏记，下次加满后重新开始计算' : '最近一次充电未确认都已记录，下次充电后重新开始计算';
}
// `period` is a month (YYYY-MM) or a year (YYYY).
function statistics(records, period) {
  const filtered = records.filter(r => r.date.startsWith(period)),
    categories = Object.keys(KINDS).map(kind => ({
      kind,
      name: KINDS[kind],
      cents: filtered.filter(r => r.kind === kind).reduce((s, r) => s + r.cents, 0),
    }));
  const others = OTHER_CATEGORIES.map(name => ({
    name,
    cents: filtered.filter(r => r.kind === 'other' && (r.category || '其他') === name).reduce((s, r) => s + r.cents, 0),
  })).filter(x => x.cents);
  return {
    total: filtered.reduce((s, r) => s + r.cents, 0),
    count: filtered.length,
    fuel: filtered.filter(r => r.kind === 'fuel').reduce((s, r) => s + r.quantity100, 0),
    charge: filtered.filter(r => r.kind === 'charge').reduce((s, r) => s + r.quantity100, 0),
    categories,
    others,
  };
}
function addMonths(date, count) {
  const [y, m, d] = date.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + count + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + count, Math.min(d, end))).toISOString().slice(0, 10);
}
function addDays(date, count) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
// Spending per month for the `count` months ending at `month`, oldest first.
function monthlyTrend(records, month, count = 12) {
  return Array.from({ length: count }, (_, i) => addMonths(month + '-01', i - count + 1).slice(0, 7)).map(m => ({
    month: m,
    cents: records.filter(r => r.date.slice(0, 7) === m).reduce((s, r) => s + r.cents, 0),
  }));
}
// Average daily distance from odometer readings: from the last reading at least 90 days before the latest one (or the first reading),
// and only once the readings span 14+ days.
function mileageStats(v, records) {
  const points = [{ date: v.baseDate, mileage: v.baseMileage }]
      .concat(records.filter(r => r.vehicleId === v.id && r.mileage != null))
      .sort((a, b) => a.date.localeCompare(b.date) || a.mileage - b.mileage),
    last = points[points.length - 1];
  const start = addDays(last.date, -90),
    from = points.filter(p => p.date <= start).pop() || points[0],
    days = daysBetween(last.date, from.date);
  return days >= 14 && last.mileage > from.mileage
    ? { dailyKm: Math.round(((last.mileage - from.mileage) / days) * 10) / 10, from: from.date, to: last.date }
    : { dailyKm: 0, from: '', to: '' };
}
// Common starting points only: real intervals come from the owner's manual, so every field stays editable.
const PLAN_PRESETS = [
  { name: '机油机滤', months: 6, km: 5000, engine: true },
  { name: '空调滤芯', months: 12, km: 20000 },
  { name: '轮胎换位', months: 0, km: 10000 },
  { name: '刹车油', months: 24, km: 40000 },
  { name: '车险续期', months: 12, km: 0 },
  { name: '年检', months: 0, km: 0 },
];
function planPresets(v) {
  return PLAN_PRESETS.filter(p => !p.engine || typeOf(v).fuel);
}
// A new record that completes `plan` starts like the last completion of that plan. With none yet, insurance and
// inspection plans default to other expenses (DESIGN.md files them there) and everything else to maintenance.
function planRecordDefaults(plan, records) {
  const last = records
    .filter(r => r.planId === plan.id && r.complete && PLAN_KINDS.includes(r.kind))
    .sort((a, b) => b.date.localeCompare(a.date) || b.mileage - a.mileage || b.id.localeCompare(a.id))[0];
  if (last) return { kind: last.kind, category: last.kind === 'other' ? last.category || '其他' : '其他' };
  const category = /险/.test(plan.name) ? '保险' : /年检|年审/.test(plan.name) ? '年检' : '';
  return category ? { kind: 'other', category } : { kind: 'service', category: '其他' };
}
function normalizePlan(input, vehicleId) {
  const name = String(input.name || '').trim();
  assert(name && name.length <= 40, '项目名称必填，最多 40 字');
  assert(!input.dueDate || validDate(input.dueDate), '到期日期无效');
  const optional = (val, label) => (val === '' || val == null ? null : integer(val, label));
  const p = {
    id: input.id,
    vehicleId,
    name,
    dueDate: input.dueDate || '',
    dueMileage: optional(input.dueMileage, '到期里程'),
    intervalMonths: optional(input.intervalMonths, '重复月数') || 0,
    intervalKm: optional(input.intervalKm, '重复公里数') || 0,
    leadDays: integer(input.leadDays === '' || input.leadDays == null ? 30 : input.leadDays, '提前天数', 365),
    leadKm: integer(input.leadKm === '' || input.leadKm == null ? 500 : input.leadKm, '提前公里数'),
  };
  assert(p.dueDate || p.dueMileage !== null, '请至少设置到期日期或到期里程');
  assert(p.intervalMonths <= 120, '重复周期不能超过 120 个月');
  return p;
}
function daysBetween(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
// Logic compares `state`; pages show `status` and sort by `rank`.
const PLAN_STATES = {
  overdue: ['已到期', 0],
  soon: ['即将到期', 1],
  stale: ['里程待更新', 2],
  ok: ['正常', 3],
  done: ['已完成', 4],
};
function reminder(plan, records, mileage, asOf = today(), dailyKm = 0) {
  const completions = records
    .filter(r => r.planId === plan.id && r.complete)
    .sort((a, b) => b.date.localeCompare(a.date) || b.mileage - a.mileage || b.id.localeCompare(a.id));
  const last = completions[0];
  let dueDate = plan.dueDate,
    dueMileage = plan.dueMileage;
  if (last) {
    dueDate = plan.intervalMonths ? addMonths(last.date, plan.intervalMonths) : '';
    dueMileage = plan.intervalKm ? last.mileage + plan.intervalKm : null;
  }
  const days = dueDate ? daysBetween(dueDate, asOf) : null,
    km = dueMileage == null ? null : dueMileage - mileage.mileage;
  let state = 'ok';
  if (last && !dueDate && dueMileage == null) state = 'done';
  else if ((days !== null && days <= 0) || (km !== null && km <= 0)) state = 'overdue';
  else if ((days !== null && days <= plan.leadDays) || (km !== null && km <= plan.leadKm)) state = 'soon';
  const stale = dueMileage !== null && daysBetween(asOf, mileage.date) > 30;
  if (stale && state === 'ok') state = 'stale';
  const [status, rank] = PLAN_STATES[state];
  // Rank date and mileage conditions by the share of their lead still left, so a nearly due mileage plan is not buried.
  const share = (left, lead) => (left === null ? 1e9 : left / Math.max(lead, 1)),
    urgency = Math.min(share(days, plan.leadDays), share(km, plan.leadKm));
  const daysText = days === null ? '' : days > 0 ? `还剩 ${days} 天` : days === 0 ? '今天到期' : `已超 ${-days} 天`,
    kmText = km === null ? '' : km > 0 ? `还剩 ${km} km` : km === 0 ? '已到达' : `已超 ${-km} km`;
  // The remaining distance is projected from the latest reading at the average daily distance, and always labelled as an estimate.
  const reach = km !== null && km > 0 && dailyKm > 0 ? addDays(mileage.date, Math.ceil(km / dailyKm)) : '';
  const predictText = !reach
    ? ''
    : reach >= asOf
      ? `预计 ${reach} 前后到达，按日均 ${dailyKm} km 估算`
      : `按日均 ${dailyKm} km 推算可能已到达，请更新里程`;
  return Object.assign({}, plan, {
    dueDate,
    dueMileage,
    state,
    status,
    rank,
    urgency,
    days,
    km,
    daysText,
    kmText,
    predictText,
    stale,
    lastDate: last ? last.date : '',
  });
}
module.exports = {
  TYPES,
  KINDS,
  PLAN_KINDS,
  OTHER_CATEGORIES,
  dateOf,
  today,
  fail,
  assert,
  validDate,
  integer,
  fixed,
  money,
  yuan,
  typeOf,
  allowedKinds,
  currentMileage,
  validateTimeline,
  normalizeVehicle,
  normalizeRecord,
  recordInput,
  unitPrice,
  recordDefaults,
  recordWarnings,
  energyIntervals,
  statistics,
  monthlyTrend,
  mileageStats,
  planPresets,
  planRecordDefaults,
  normalizePlan,
  daysBetween,
  reminder,
  addMonths,
  addDays,
};
