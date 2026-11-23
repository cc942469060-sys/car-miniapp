// Home charging: estimated energy from state of charge or charger power, tariff slicing, and bill settlement.
// Everything here is a pure function over plain data; the store validates and writes, pages only render.
const D = require('./domain');
const { presetTariffFor } = require('./shandong-tariff');
const DAY = 1440;
const LABELS = { valley: '谷段', flat: '平段', peak: '峰段', sharp: '尖峰', deepValley: '深谷' };
const LABEL_IDS = ['valley', 'flat', 'peak', 'sharp', 'deepValley'];
const CONFIDENCE = { actual: '实际', allocated: '分摊', estimate: '预估' };
const round6 = x => Math.round(x * 1e6) / 1e6;

// Largest remainder: every share gets its floor, and the leftover units go to the largest fractions (ties in input order).
function largestRemainder(total, weights) {
  const n = weights.length;
  if (!n) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !(total > 0)) return weights.map(() => 0);
  const raw = weights.map(w => (total * w) / sum),
    parts = raw.map(x => Math.floor(x));
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, fraction: x - Math.floor(x) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) parts[order[k % n].i] += 1;
  return parts;
}

// A charge runs from its start clock time to its end clock time; an end at or before the start is the next day.
// Returns null when the record has no usable window (a manual entry without times).
function chargeWindow(record) {
  const start = D.minutes(record.startTime);
  if (start == null) return null;
  let end = D.minutes(record.endTime);
  if (end == null) return null;
  if (end <= start) end += DAY;
  const minutes = end - start;
  if (minutes < 1 || minutes > DAY) return null;
  return { date: record.date, start, end, minutes, crosses: end > DAY, endDate: D.dateAfter(record.date, end - 1) };
}
function windowText(window) {
  if (!window) return '';
  return D.clock(window.start) + '–' + D.clock(window.end) + (window.crosses ? '（次日）' : '');
}
// The dates a charge touches, in order; used to tell whether bills cover the whole charge.
function coveredDates(record) {
  const w = chargeWindow(record);
  if (!w) return [];
  const dates = [];
  for (let m = 0; m < w.end; m += DAY) dates.push(D.addDays(w.date, Math.floor(m / DAY)));
  return dates;
}

function sortedPeriods(tariff) {
  return (tariff.periods || [])
    .map(p => ({ start: D.minutes(p.start), label: p.label, price10000: p.price10000 }))
    .filter(p => p.start != null)
    .sort((a, b) => a.start - b.start);
}
function periodAt(periods, minuteOfDay) {
  let found = periods[periods.length - 1];
  for (const p of periods) if (p.start <= minuteOfDay) found = p;
  return found;
}
// The version in force on `date` is the newest one whose start date is not later.
function tariffFor(date, tariffs) {
  const custom = (tariffs || []).filter(t => t.from && t.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0];
  return custom || presetTariffFor(date);
}

// Splits a charge into tariff segments at midnight and at every period start, then divides the energy by the time
// spent in each segment. Money is rounded per segment, so the total is exact to the fen.
function sliceByDayAndTariff(window, quantity100, tariffs) {
  const segments = [];
  let cursor = window.start;
  while (cursor < window.end) {
    const day = Math.floor(cursor / DAY),
      date = D.addDays(window.date, day),
      version = tariffFor(date, tariffs);
    D.assert(version, '请先在家充设置里填写电价');
    const periods = sortedPeriods(version),
      base = day * DAY,
      stop = Math.min(base + DAY, window.end),
      cuts = [cursor];
    periods.forEach(p => {
      const at = base + p.start;
      if (at > cursor && at < stop) cuts.push(at);
    });
    cuts.push(stop);
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1],
        b = cuts[i];
      if (b <= a) continue;
      const period = periodAt(periods, a - base);
      segments.push({
        date,
        label: period.label,
        start: a - base,
        end: b - base,
        minutes: b - a,
        price10000: period.price10000,
      });
    }
    cursor = stop;
  }
  const parts = largestRemainder(
      quantity100 || 0,
      segments.map(s => s.minutes)
    ),
    byDate = {},
    byLabel = {};
  let cents = 0;
  segments.forEach((s, i) => {
    s.quantity100 = parts[i];
    s.cents = Math.round((parts[i] * s.price10000) / 10000);
    cents += s.cents;
    byDate[s.date] = (byDate[s.date] || 0) + s.quantity100;
    const row = byLabel[s.label] || (byLabel[s.label] = { quantity100: 0, cents: 0 });
    row.quantity100 += s.quantity100;
    row.cents += s.cents;
  });
  return { segments, byDate, byLabel, cents };
}

// How many of the record's minutes fall inside the bill's dates.
function overlapMinutes(window, from, to) {
  const start = D.daysBetween(from, window.date) * DAY,
    end = (D.daysBetween(to, window.date) + 1) * DAY;
  return Math.max(0, Math.min(window.end, end) - Math.max(window.start, start));
}
function intersectsBill(record, bill) {
  const w = chargeWindow(record);
  if (!w) return false;
  return record.date <= bill.to && D.dateAfter(w.date, w.end - 1) >= bill.from;
}
// Minutes shared by two charges, whichever is earlier.
function windowOverlap(a, b) {
  const shift = D.daysBetween(b.date, a.date) * DAY;
  return Math.max(0, Math.min(a.end, b.end + shift) - Math.max(a.start, b.start + shift));
}

// kWh per 1% of battery. k0 comes from the nominal capacity at 90% efficiency; with enough bills the measured value
// replaces it. Samples are dropped when they disagree wildly with k0, so one wrong reading cannot poison later bills.
function homeK(vehicle, records, bills) {
  const k0 = vehicle && vehicle.batteryKwh100 ? round6(vehicle.batteryKwh100 / 100 / 0.9) : null,
    mine = (records || []).filter(r => r.home && r.kind === 'charge'),
    samples = [];
  (bills || [])
    .slice()
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    .forEach(bill => {
      if (!(bill.quantity100 > 0)) return;
      const inside = mine.filter(r => intersectsBill(r, bill));
      if (!inside.length) return;
      if (inside.some(r => r.vehicleId !== vehicle.id || r.socBefore == null || r.socAfter == null)) return;
      let pct = 0,
        estimated = 0;
      for (const r of inside) {
        const w = chargeWindow(r);
        if (!w) return;
        const share = overlapMinutes(w, bill.from, bill.to) / w.minutes;
        pct += share * (r.socAfter - r.socBefore);
        estimated += share * (r.estQuantity100 || 0);
      }
      if (!(pct > 0)) return;
      const k = bill.quantity100 / pct;
      if (k0 != null && (bill.quantity100 < 0.6 * k0 * pct || bill.quantity100 > 1.5 * k0 * pct)) return;
      samples.push({ billId: bill.id, to: bill.to, quantity100: bill.quantity100, pct, k, estimated });
    });
  const recent = samples
      .slice()
      .sort((a, b) => b.to.localeCompare(a.to))
      .slice(0, 8),
    totalQuantity = recent.reduce((s, x) => s + x.quantity100, 0),
    totalPct = recent.reduce((s, x) => s + x.pct, 0),
    k = recent.length >= 3 && totalPct > 0 ? round6(totalQuantity / totalPct) : k0,
    mae = recent.length
      ? recent.reduce((s, x) => s + Math.abs(x.quantity100 - x.estimated) / x.quantity100, 0) / recent.length
      : null;
  return { k, k0, samples: recent.length, mae };
}

// The estimate for one charge, in the plan's order: state of charge, then charger power and duration, then a typed
// quantity. A missing end time is derived from the energy and the charger power, and marked as derived.
function estimateHomeCharge(input, vehicle, k, home) {
  const start = D.minutes(input.startTime);
  D.assert(start != null, '请填写开始充电时间');
  const socBefore = input.socBefore === '' || input.socBefore == null ? null : Number(input.socBefore),
    socAfter = input.socAfter === '' || input.socAfter == null ? null : Number(input.socAfter);
  D.assert(
    socBefore == null || (Number.isInteger(socBefore) && socBefore >= 0 && socBefore <= 100),
    '充电前电量需要是 0–100 的整数'
  );
  D.assert(
    socAfter == null || (Number.isInteger(socAfter) && socAfter >= 0 && socAfter <= 100),
    '充电后电量需要是 0–100 的整数'
  );
  D.assert(socBefore == null || socAfter == null || socBefore < socAfter, '充电后电量需要高于充电前电量');
  // An end time derived by an earlier estimate is not the user's reading: it is derived again from the new estimate.
  const chargerKw100 = (home && home.chargerKw100) || 0,
    given =
      input.endEstimated !== true && input.endTime != null && input.endTime !== '' && D.minutes(input.endTime) != null;
  let end = given ? D.minutes(input.endTime) : null;
  if (end != null && end <= start) end += DAY;
  D.assert(
    !given || (end - start >= 1 && end - start <= DAY),
    '充满时间需要晚于开始充电时间（跨零点时早于开始是正常的）'
  );
  const socEst =
      k != null && socBefore != null && socAfter != null && socAfter > socBefore
        ? Math.round(k * (socAfter - socBefore))
        : null,
    powerEst = given && chargerKw100 ? Math.round((chargerKw100 * (end - start)) / 60) : null,
    typed =
      input.estQuantity == null || input.estQuantity === ''
        ? Number.isSafeInteger(input.estQuantity100)
          ? input.estQuantity100
          : null
        : D.fixed(input.estQuantity, '估计电量', true),
    estQuantity100 = socEst || powerEst || typed;
  D.assert(estQuantity100, '请填写充电前后电量，或充满时间，或估计电量');
  const method = socEst ? 'soc' : powerEst ? 'power' : 'typed';
  if (end == null) {
    D.assert(chargerKw100, '请填写充电桩功率');
    end = start + Math.ceil((estQuantity100 * 60) / chargerKw100);
    D.assert(end - start <= DAY, '估算的充电时长超过 24 小时，请填写充满时间');
  }
  const window = {
      date: input.date,
      start,
      end,
      minutes: end - start,
      crosses: end > DAY,
      endDate: D.dateAfter(input.date, end - 1),
    },
    slice = sliceByDayAndTariff(window, estQuantity100, (home && home.tariffs) || []);
  return {
    estQuantity100,
    estCents: slice.cents,
    estMethod: method,
    estK10000: method === 'soc' ? Math.round(k * 100) : null,
    endTime: D.clock(end),
    endEstimated: !given,
    window,
    slice,
  };
}

// Cost of `quantity100` over a slice, using each segment's own price structure.
function segmentCost(segments, quantity100) {
  const parts = largestRemainder(
    quantity100 || 0,
    segments.map(s => s.minutes)
  );
  return segments.reduce((s, seg, i) => s + Math.round((parts[i] * seg.price10000) / 10000), 0);
}

// Splits one bill over the home charges that overlap it. Manual (already confirmed) charges take their share off the
// top; the rest is split by estimated energy in the bill's dates, by largest remainder. Money is split the same way,
// or, when the bill has no amount, derived from each charge's own tariff segments.
function allocateBill(bill, records, tariffs) {
  const warnings = [],
    candidates = [];
  (records || []).forEach(r => {
    if (!r.home || r.kind !== 'charge' || !['pending', 'bill', 'manual'].includes(r.settle)) return;
    const w = chargeWindow(r);
    if (!w || !intersectsBill(r, bill)) return;
    const slice = sliceByDayAndTariff(w, r.estQuantity100 || 0, tariffs),
      inRange = slice.segments.filter(s => s.date >= bill.from && s.date <= bill.to),
      weight100 = inRange.reduce((s, x) => s + x.quantity100, 0);
    let manualQuantity100 = 0,
      manualCents = 0;
    // A confirmed charge is spread over its whole window first, so a charge across midnight only takes the part that
    // falls in this bill's dates, not its full quantity from each daily bill.
    if (r.settle === 'manual') {
      const parts = largestRemainder(
        r.quantity100 || 0,
        slice.segments.map(s => s.minutes)
      );
      slice.segments.forEach((s, i) => {
        if (s.date < bill.from || s.date > bill.to) return;
        manualQuantity100 += parts[i];
        manualCents += Math.round((parts[i] * s.price10000) / 10000);
      });
    }
    candidates.push({ record: r, weight100, inRange, manualQuantity100, manualCents });
  });
  const manuals = candidates.filter(c => c.record.settle === 'manual'),
    others = candidates.filter(c => c.record.settle !== 'manual'),
    manualQuantity100 = manuals.reduce((s, c) => s + c.manualQuantity100, 0),
    manualCents = manuals.reduce((s, c) => s + c.manualCents, 0),
    remaining = Math.max(0, bill.quantity100 - manualQuantity100),
    totalWeight = others.reduce((s, c) => s + c.weight100, 0);
  if (bill.quantity100 < manualQuantity100) warnings.push('账单电量小于已确认记录合计，请核对');
  if (!totalWeight && remaining > 50) warnings.push('这段时间有用电，但没有对应的家充记录，可能漏记');
  const quantities =
      totalWeight > 0
        ? largestRemainder(
            remaining,
            others.map(c => c.weight100)
          )
        : others.map(() => 0),
    leftCents = bill.cents == null ? null : Math.max(0, bill.cents - manualCents);
  if (leftCents != null && bill.cents < manualCents) warnings.push('账单金额小于已确认记录合计，请核对');
  const costs =
    leftCents == null
      ? others.map((c, i) => segmentCost(c.inRange, quantities[i]))
      : totalWeight > 0
        ? largestRemainder(
            leftCents,
            others.map(c => c.weight100)
          )
        : others.map(() => 0);
  const rows = candidates.map(c => {
    const i = others.indexOf(c);
    return {
      recordId: c.record.id,
      quantity100: i < 0 ? c.manualQuantity100 : quantities[i],
      cents: i < 0 ? c.manualCents : costs[i],
      weight100: c.weight100,
    };
  });
  return { billId: bill.id, rows, warnings };
}

// Recomputes every home charge's allocation from the current bills. A charge becomes 已对账 (bill) once bills cover
// every date it touches; until then it stays 待对账 and keeps its estimate. Estimates are never recomputed here.
function settleAll(state) {
  const records = state.records || [],
    bills = state.bills || [],
    tariffs = (state.home && state.home.tariffs) || [],
    warnings = [];
  records.forEach(r => {
    if (r.home) r.alloc = [];
  });
  bills
    .slice()
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    .forEach(bill => {
      const result = allocateBill(bill, records, tariffs);
      result.warnings.forEach(message => warnings.push({ billId: bill.id, message }));
      result.rows.forEach(row => {
        const r = records.find(x => x.id === row.recordId);
        if (r)
          r.alloc.push({ billId: bill.id, quantity100: row.quantity100, cents: row.cents, weight100: row.weight100 });
      });
    });
  records.forEach(r => {
    if (!r.home || (r.settle !== 'pending' && r.settle !== 'bill')) return;
    const w = chargeWindow(r),
      dates = w
        ? (() => {
            try {
              return Object.keys(sliceByDayAndTariff(w, r.estQuantity100 || 0, tariffs).byDate);
            } catch (e) {
              return [];
            }
          })()
        : [],
      covered =
        dates.length > 0 &&
        dates.every(date =>
          r.alloc.some(a => {
            const bill = bills.find(b => b.id === a.billId);
            return bill && date >= bill.from && date <= bill.to;
          })
        );
    // `confirmed` is the user's own answer to 「上次以来的充电都已记录」 and is never changed by settlement.
    if (covered) {
      r.settle = 'bill';
      r.quantity100 = r.alloc.reduce((s, a) => s + a.quantity100, 0);
      r.cents = r.alloc.reduce((s, a) => s + a.cents, 0);
    } else {
      r.settle = 'pending';
      r.quantity100 = null;
      r.cents = null;
    }
  });
  return warnings;
}

// Actual when nothing was estimated and every bill covered only this charge; otherwise 分摊 for a shared bill.
function confidence(record, state) {
  if (!record.home || record.settle === 'manual') return 'actual';
  if (record.settle !== 'bill') return 'estimate';
  const bills = [...new Set((record.alloc || []).map(a => a.billId))],
    records = (state && state.records) || [];
  const only =
    bills.length > 0 && bills.every(id => records.filter(r => (r.alloc || []).some(a => a.billId === id)).length === 1);
  return only ? 'actual' : 'allocated';
}
function confidenceText(value) {
  return CONFIDENCE[value] || '';
}
// Share of the charge already covered by bills, for 「已对账 60%」.
function allocatedPercent(record) {
  if (!record.estQuantity100) return 0;
  const covered = (record.alloc || []).reduce((s, a) => s + a.quantity100, 0);
  return Math.max(0, Math.min(100, Math.round((covered / record.estQuantity100) * 100)));
}

function price10000(value) {
  const s = String(value).trim();
  D.assert(/^(\d+(\.\d{0,4})?|\.\d{1,4})$/.test(s), '电价请输入最多四位小数的数字');
  const n = Math.round(Number(s) * 10000);
  D.assert(n >= 1 && n <= 50000, '电价需在 0.0001–5 元/kWh 之间');
  return n;
}

function normalizeHome(input) {
  D.assert(['', 'dedicated', 'shared'].includes(input.meter), '请选择电表类型');
  const kw = input.chargerKw === '' || input.chargerKw == null ? '' : D.fixed(input.chargerKw, '充电桩功率', true);
  D.assert(kw === '' || (kw >= 100 && kw <= 5000), '充电桩功率需在 1–50 kW 之间');
  return { meter: input.meter, chargerKw100: kw === '' ? 700 : kw };
}

function normalizeTariff(input, tariffs, existing) {
  D.assert(D.validDate(input.from), '电价生效日期无效');
  const others = (tariffs || []).filter(t => !existing || t.id !== existing.id);
  D.assert(!others.some(t => t.from === input.from), '电价生效日期与已有版本重复');
  D.assert(Array.isArray(input.periods) && input.periods.length, '电价至少需要一段');
  const seen = new Set();
  const periods = input.periods
    .map(p => {
      const start = D.minutes(p.start);
      D.assert(start != null, '电价时段的开始时间无效');
      const text = D.clock(start);
      D.assert(!seen.has(text), '电价时段的开始时间不能重复');
      seen.add(text);
      D.assert(LABEL_IDS.includes(p.label), '请选择电价时段类型');
      let value;
      if (Number.isSafeInteger(p.price10000)) {
        D.assert(p.price10000 >= 1 && p.price10000 <= 50000, '电价需在 0.0001–5 元/kWh 之间');
        value = p.price10000;
      } else value = price10000(p.price);
      return { start: text, label: p.label, price10000: value };
    })
    .sort((a, b) => D.minutes(a.start) - D.minutes(b.start));
  return { id: existing ? existing.id : input.id, from: input.from, periods };
}

function normalizeBill(input, bills, existing, home) {
  D.assert(home && home.meter === 'dedicated', '只有独立电表可以录入账单，请先在家充设置里切换电表类型');
  D.assert(D.validDate(input.from) && D.validDate(input.to), '账单日期无效');
  D.assert(input.from <= input.to, '账单开始日期不能晚于结束日期');
  D.assert(input.to <= D.today(), '账单结束日期不能晚于今天');
  D.assert(D.daysBetween(input.to, input.from) <= 62, '一张账单最多 62 天');
  const quantity100 = Number.isSafeInteger(input.quantity100)
      ? (D.assert(input.quantity100 > 0, '账单电量请填写大于 0 的数字'), input.quantity100)
      : D.fixed(input.quantity, '账单电量', true),
    cents = Number.isSafeInteger(input.cents)
      ? (D.assert(input.cents >= 0 && input.cents <= 999999999, '账单金额超出范围'), input.cents)
      : input.amount === '' || input.amount == null
        ? null
        : D.fixed(input.amount, '账单金额'),
    others = (bills || []).filter(b => !existing || b.id !== existing.id);
  D.assert(!others.some(b => !(input.to < b.from || input.from > b.to)), '账单日期与已有账单重叠，请先核对');
  return {
    id: existing ? existing.id : input.id,
    from: input.from,
    to: input.to,
    quantity100,
    cents,
    note: String(input.note || '')
      .trim()
      .slice(0, 120),
  };
}

module.exports = {
  DAY,
  LABELS,
  LABEL_IDS,
  CONFIDENCE,
  largestRemainder,
  chargeWindow,
  windowText,
  coveredDates,
  sortedPeriods,
  tariffFor,
  sliceByDayAndTariff,
  overlapMinutes,
  intersectsBill,
  windowOverlap,
  homeK,
  estimateHomeCharge,
  segmentCost,
  allocateBill,
  settleAll,
  confidence,
  confidenceText,
  allocatedPercent,
  price10000,
  normalizeHome,
  normalizeTariff,
  normalizeBill,
};
