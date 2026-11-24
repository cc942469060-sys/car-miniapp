const U = require('../../utils/ui');
const C = require('../../utils/charging');
const P = require('../../utils/shandong-tariff');
const periodText = periods =>
  periods.map(p => `${p.start} ${C.LABELS[p.label]} ${(p.price10000 / 10000).toFixed(4)}`).join(' · ');
Page(
  Object.assign({}, U.common, {
    data: {
      ready: false,
      meter: '',
      meterText: '',
      chargerKw: '',
      today: '',
      tariffs: [],
      presetName: P.PRESET_NAME,
      presets: [],
      presetNote: '',
      kRows: [],
      labels: C.LABEL_IDS.map(id => ({ id, name: C.LABELS[id] })),
      editing: false,
      form: { id: '', from: '', periods: [] },
      error: '',
      saving: false,
    },
    onShow() {
      U.guard(this, () => this.load());
    },
    load() {
      const s = U.getStore().read(),
        tariffs = s.home.tariffs
          .slice()
          .sort((a, b) => b.from.localeCompare(a.from))
          .map(t => ({
            id: t.id,
            from: t.from,
            text: periodText(t.periods),
          })),
        kRows = s.vehicles
          .filter(v => U.D.typeOf(v).charge)
          .map(v => {
            const k = C.homeK(v, s.records, s.bills);
            return {
              id: v.id,
              name: v.name,
              k: k.k ? (k.k / 100).toFixed(2) : '—',
              source: k.samples >= 3 ? `近 ${k.samples} 张账单校准` : k.k ? '电池容量默认（效率 90%）' : '未填电池容量',
              mae: k.mae == null ? '' : `平均偏差 ${(k.mae * 100).toFixed(0)}%`,
            };
          });
      // The built-in schedules of this year. One of them is in force today unless a custom version overrides it.
      const today = U.D.today(),
        month = Number(today.slice(5, 7)),
        custom = s.home.tariffs.filter(t => t.from <= today).sort((a, b) => b.from.localeCompare(a.from))[0],
        presets = P.presetSchedules(today.slice(0, 4)).map(p => ({
          from: p.from,
          months: p.months,
          text: periodText(p.periods),
          current: !custom && month >= p.firstMonth && month <= p.lastMonth,
        }));
      this.setData({
        ready: true,
        today,
        presets,
        presetNote: custom
          ? `今天使用的是 ${custom.from} 起的自定义电价；没有自定义电价覆盖的日期仍按下面的默认电价。`
          : '今天使用的是下面标为「生效中」的默认电价。',
        meter: s.home.meter,
        meterText: s.home.meter === 'dedicated' ? '独立电表' : s.home.meter === 'shared' ? '共用总表' : '未设置',
        chargerKw: (s.home.chargerKw100 / 100).toFixed(2),
        tariffs,
        kRows,
        error: '',
      });
    },
    pickMeter(e) {
      const meter = e.currentTarget.dataset.value;
      U.guard(this, () => {
        U.getStore().saveHome({ meter, chargerKw: this.data.chargerKw });
        wx.showToast({ title: '已保存', icon: 'success' });
        this.load();
      });
    },
    input(e) {
      this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value, error: '' });
    },
    inputTop(e) {
      this.setData({ [e.currentTarget.dataset.field]: e.detail.value, error: '' });
    },
    savePower() {
      U.guard(this, () => {
        U.getStore().saveHome({ meter: this.data.meter, chargerKw: this.data.chargerKw });
        wx.showToast({ title: '已保存', icon: 'success' });
        this.load();
      });
    },
    // A new version either starts from today with one flat period, or copies the prices in effect now.
    addTariff(e) {
      const copy = e.currentTarget.dataset.copy === '1',
        current = C.tariffFor(this.data.today, U.getStore().read().home.tariffs);
      const periods =
        copy && current
          ? current.periods.map(p => ({
              start: p.start,
              label: p.label,
              labelIndex: C.LABEL_IDS.indexOf(p.label),
              price: (p.price10000 / 10000).toFixed(4),
            }))
          : [{ start: '00:00', label: 'flat', labelIndex: C.LABEL_IDS.indexOf('flat'), price: '' }];
      this.setData({ editing: true, form: { id: '', from: this.data.today, periods }, error: '' });
    },
    sTariff(id) {
      const s = U.getStore().read();
      return s.home.tariffs.find(t => t.id === id);
    },
    editTariff(e) {
      const t = this.sTariff(e.currentTarget.dataset.id);
      if (!t) return;
      this.setData({
        editing: true,
        error: '',
        form: {
          id: t.id,
          from: t.from,
          periods: t.periods.map(p => ({
            start: p.start,
            label: p.label,
            labelIndex: C.LABEL_IDS.indexOf(p.label),
            price: (p.price10000 / 10000).toFixed(4),
          })),
        },
      });
    },
    cancelTariff() {
      this.setData({ editing: false, form: { id: '', from: '', periods: [] }, error: '' });
    },
    editFrom(e) {
      this.setData({ 'form.from': e.detail.value, error: '' });
    },
    editPeriod(e) {
      const { index, field } = e.currentTarget.dataset;
      this.setData({ [`form.periods[${index}].${field}`]: e.detail.value, error: '' });
    },
    editPeriodLabel(e) {
      const index = e.currentTarget.dataset.index,
        label = this.data.labels[Number(e.detail.value)].id;
      this.setData({
        [`form.periods[${index}].label`]: label,
        [`form.periods[${index}].labelIndex`]: Number(e.detail.value),
      });
    },
    addPeriod() {
      const periods = this.data.form.periods.concat([
        { start: '', label: 'flat', labelIndex: C.LABEL_IDS.indexOf('flat'), price: '' },
      ]);
      this.setData({ 'form.periods': periods });
    },
    removePeriod(e) {
      const periods = this.data.form.periods.filter((_, i) => i !== Number(e.currentTarget.dataset.index));
      this.setData({ 'form.periods': periods });
    },
    saveTariff() {
      if (this.data.saving) return;
      this.setData({ saving: true });
      const id = U.guard(this, () => U.getStore().saveTariff(this.data.form), {
        电价生效日期: 'from',
        电价时段: 'periods',
        电价: 'periods',
      });
      this.setData({ saving: false });
      if (id) {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.setData({ editing: false, form: { id: '', from: '', periods: [] } });
        this.load();
      }
    },
    deleteTariff(e) {
      U.confirm('删除这个电价版本？删除后，对应日期将使用其他已生效的自定义电价或内置电价。', () =>
        U.guard(this, () => {
          U.getStore().deleteTariff(e.currentTarget.dataset.id);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.load();
        })
      );
    },
  })
);
