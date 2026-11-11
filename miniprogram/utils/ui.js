const D = require('./domain');
const { getStore } = require('./store');
// `rates` (from intervalRates) adds the consumption of the interval a record closes; unit price comes from the record itself.
function recordView(r, rates) {
  const unit = r.kind === 'fuel' ? 'L' : 'kWh',
    price = r.quantity100 && r.cents ? `¥${(r.cents / r.quantity100).toFixed(2)}/${unit}` : '';
  return Object.assign({}, r, {
    title: r.kind === 'other' && r.category && r.category !== '其他' ? r.category : D.KINDS[r.kind],
    amount: D.yuan(r.cents),
    quantity: r.quantity100 ? (r.quantity100 / 100).toFixed(2) : '',
    unit,
    symbol: { fuel: '油', charge: '电', service: '养', other: '账' }[r.kind],
    detail: [price, rates && rates[r.id]].filter(Boolean).join(' · '),
  });
}
function intervalRates(records) {
  const rates = {};
  ['fuel', 'charge'].forEach(kind =>
    D.energyIntervals(records, kind).intervals.forEach(i => {
      rates[i.toId] = kind === 'fuel' ? `油耗 ${i.rate} L/100km` : `电耗 ${i.rate} kWh/100km`;
    })
  );
  return rates;
}
function snapshot() {
  const s = getStore().read(),
    v = s.vehicles.find(x => x.id === s.currentId) || s.vehicles.find(x => !x.archived) || s.vehicles[0];
  const records = v
    ? s.records
        .filter(r => r.vehicleId === v.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.mileage - a.mileage || b.id.localeCompare(a.id))
    : [];
  const mileage = v ? D.currentMileage(v, records) : null,
    daily = v ? D.mileageStats(v, records).dailyKm : 0;
  const plans = v
    ? s.plans
        .filter(p => p.vehicleId === v.id)
        .map(p => D.reminder(p, records, mileage, D.today(), daily))
        .sort((a, b) => a.rank - b.rank || a.urgency - b.urgency)
    : [];
  return { s, v, records, mileage, plans };
}
// The record deleted last can be put back for a minute from the list pages.
let lastDeleted = null;
function rememberDeleted(record) {
  lastDeleted = { record, at: Date.now() };
}
// The offer lapses after a minute, or when the record's vehicle has been deleted since.
function undoText(s) {
  if (!lastDeleted || Date.now() - lastDeleted.at > 60000) return '';
  if (!s.vehicles.some(v => v.id === lastDeleted.record.vehicleId)) return '';
  const r = recordView(lastDeleted.record);
  return `已删除「${r.title} ¥${r.amount}」`;
}
function base() {
  const x = snapshot();
  return Object.assign(x, {
    data: {
      vehicles: x.s.vehicles.map(v => ({ id: v.id, name: v.name + (v.archived ? '（归档）' : '') })),
      vehicleIndex: x.v ? x.s.vehicles.findIndex(v => v.id === x.v.id) : 0,
      vehicle: x.v ? Object.assign({}, x.v, { typeName: D.typeOf(x.v).name }) : null,
      mileage: x.mileage,
      today: D.today(),
      undo: undoText(x.s),
      error: '',
      errorField: '',
    },
  });
}
// Validation messages start with the label of their field, so `labels` (label → field) finds the field to mark and scroll to.
// Anything that is not a user-facing error is a bug: log it and show a generic message instead of the raw one.
function guard(page, fn, labels) {
  try {
    return fn();
  } catch (e) {
    const user = !!(e && e.user),
      message = user ? e.message : '出了点问题，请重试；如果反复出现，请导出备份后反馈',
      label = user && labels ? Object.keys(labels).find(l => message.startsWith(l)) : '',
      field = label ? labels[label] : '';
    if (!user) console.error(e);
    page.setData({ error: message, errorField: field });
    if (field) wx.pageScrollTo({ selector: '#f-' + field, duration: 200 });
    return undefined;
  }
}
function back() {
  wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/home/index' }) });
}
function saved(title) {
  wx.showToast({ title: title || '已保存', icon: 'success' });
  back();
}
function confirm(content, action) {
  wx.showModal({
    title: '请确认',
    content,
    confirmText: '确定',
    confirmColor: '#b91c1c',
    success: r => {
      if (r.confirm) action();
    },
  });
}
const common = {
  switchVehicle(e) {
    guard(this, () => {
      const id = this.data.vehicles[Number(e.detail.value)].id;
      getStore().select(id);
      this.onShow();
    });
  },
  addVehicle() {
    wx.navigateTo({ url: '/pages/vehicle/index' });
  },
  addRecord() {
    if (this.data.vehicle) wx.navigateTo({ url: '/pages/entry/index?vehicleId=' + this.data.vehicle.id });
  },
  addPlan() {
    if (this.data.vehicle) wx.navigateTo({ url: '/pages/plan/index?vehicleId=' + this.data.vehicle.id });
  },
  openRecord(e) {
    wx.navigateTo({ url: '/pages/entry/index?id=' + e.currentTarget.dataset.id });
  },
  viewLedger() {
    wx.switchTab({ url: '/pages/ledger/index' });
  },
  viewCare() {
    wx.switchTab({ url: '/pages/care/index' });
  },
  viewStats() {
    wx.navigateTo({ url: '/pages/stats/index' });
  },
  viewGarage() {
    wx.switchTab({ url: '/pages/garage/index' });
  },
  // Records an odometer reading without an expense, e.g. when a reminder says the last reading is old.
  updateMileage() {
    const v = this.data.vehicle,
      m = this.data.mileage;
    if (!v) return;
    wx.showModal({
      title: '更新当前里程',
      editable: true,
      placeholderText: `仪表上的累计里程，上次 ${m.mileage} km`,
      confirmText: '保存',
      success: r => {
        if (r.confirm)
          guard(this, () => {
            getStore().updateMileage(v.id, r.content);
            wx.showToast({ title: '已更新', icon: 'success' });
            this.onShow();
          });
      },
    });
  },
  undoDelete() {
    guard(this, () => {
      if (!lastDeleted) return;
      getStore().undoDelete(lastDeleted.record);
      lastDeleted = null;
      wx.showToast({ title: '已撤销', icon: 'success' });
      this.onShow();
    });
  },
  input(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value, error: '', errorField: '' });
  },
  toggle(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value, error: '', errorField: '' });
  },
  // Forwards the mini program itself; no ledger data leaves the device.
  onShareAppMessage() {
    return { title: '车小记 · 加油、充电、保养一本账', path: '/pages/home/index' };
  },
  cancel() {
    back();
  },
};
module.exports = {
  D,
  getStore,
  recordView,
  intervalRates,
  snapshot,
  base,
  guard,
  back,
  saved,
  confirm,
  rememberDeleted,
  common,
};
