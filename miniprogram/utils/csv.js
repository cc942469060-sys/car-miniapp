const D = require('./domain');
// One row per record, for reimbursement or for analysing in a spreadsheet; it is not a backup format.
const HEADER = [
  '车辆',
  '日期',
  '类型',
  '类别',
  '金额(元)',
  '累计里程(km)',
  '补能量',
  '单位',
  '单价(元)',
  '本次加满',
  '充电后电量(%)',
  '关联计划',
  '备注',
];
// Quotes a field when needed, and keeps typed text that starts like a formula from running in the spreadsheet.
function cell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// All records of all vehicles, oldest first. The BOM and CRLF line ends let Excel open the UTF-8 file directly.
function recordsCsv(state) {
  const vehicles = new Map(state.vehicles.map(v => [v.id, v.name])),
    plans = new Map(state.plans.map(p => [p.id, p.name]));
  const rows = state.records
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.mileage || 0) - (b.mileage || 0) || a.id.localeCompare(b.id))
    .map(r => {
      const quantity = r.quantity100 ? (r.quantity100 / 100).toFixed(2) : '';
      return [
        cell(vehicles.get(r.vehicleId)),
        r.date,
        D.KINDS[r.kind],
        cell(r.kind === 'other' ? r.category || '其他' : ''),
        D.money(r.cents),
        r.mileage == null ? '' : r.mileage,
        quantity,
        quantity ? (r.kind === 'fuel' ? 'L' : 'kWh') : '',
        quantity && r.cents ? (r.cents / r.quantity100).toFixed(2) : '',
        r.kind === 'fuel' ? (r.full ? '是' : '否') : '',
        r.kind === 'charge' && r.socAfter != null ? r.socAfter : '',
        cell(r.planId ? plans.get(r.planId) : ''),
        cell(r.note),
      ].join(',');
    });
  return '\uFEFF' + [HEADER.join(',')].concat(rows).join('\r\n') + '\r\n';
}
module.exports = { recordsCsv };
