const U = require('../../utils/ui');
const C = require('../../utils/charging');
Page(
  Object.assign({}, U.common, {
    data: {
      ready: false,
      meter: '',
      meterText: '',
      today: '',
      pending: [],
      pendingAmount: '',
      bills: [],
      form: { id: '', from: '', to: '', quantity: '', amount: '', note: '' },
      preview: null,
      error: '',
      saving: false,
    },
    onShow() {
      U.guard(this, () => {
        const x = U.snapshot(),
          s = x.s,
          pending = s.records
            .filter(r => r.home && r.settle === 'pending')
            .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
          vehicles = new Map(s.vehicles.map(v => [v.id, v.name]));
        this.s = s;
        this.setData({
          ready: true,
          today: U.D.today(),
          meter: s.home.meter,
          meterText:
            s.home.meter === 'dedicated' ? '独立电表' : s.home.meter === 'shared' ? '共用总表' : '未设置电表类型',
          pending: pending.map(r => {
            const w = C.chargeWindow(r);
            return {
              id: r.id,
              date: r.date,
              range: w ? C.windowText(w) : '',
              vehicle: vehicles.get(r.vehicleId) || '',
              quantity: r.estQuantity100 ? (r.estQuantity100 / 100).toFixed(2) : '',
              amount: U.D.money(r.estCents),
              allocated: C.allocatedPercent(r),
            };
          }),
          pendingAmount: U.D.money(pending.reduce((sum, r) => sum + (r.estCents || 0), 0)),
          bills: s.bills
            .slice()
            .sort((a, b) => b.from.localeCompare(a.from) || b.to.localeCompare(a.to))
            .map(b => ({
              id: b.id,
              range: b.from === b.to ? b.from : `${b.from} ~ ${b.to}`,
              quantity: (b.quantity100 / 100).toFixed(2),
              amount: b.cents == null ? '按电价' : '¥' + U.D.money(b.cents),
              note: b.note,
            })),
          error: '',
          preview: null,
        });
      });
    },
    input(e) {
      this.setData({
        ['form.' + e.currentTarget.dataset.field]: e.detail.value,
        error: '',
        preview: null,
      });
    },
    openRecord(e) {
      wx.navigateTo({ url: '/pages/entry/index?id=' + e.currentTarget.dataset.id });
    },
    goHomeCharge() {
      wx.navigateTo({ url: '/pages/homecharge/index' });
    },
    // A new bill is one day, the oldest charge still waiting, which matches the grid app's daily usage. A longer bill
    // is a deliberate choice of its end date, so one day's usage is never spread over a week of charges by mistake.
    openNewBill() {
      const pending = this.s.records
          .filter(r => r.home && r.settle === 'pending')
          .sort((a, b) => a.date.localeCompare(b.date)),
        day = pending.length ? pending[0].date : U.D.today();
      this.setData({
        form: {
          id: '',
          from: day,
          to: day,
          quantity: '',
          amount: '',
          note: '',
        },
        error: '',
        preview: null,
      });
    },
    editBill(e) {
      const b = this.s.bills.find(x => x.id === e.currentTarget.dataset.id);
      if (!b) return;
      this.setData({
        form: {
          id: b.id,
          from: b.from,
          to: b.to,
          quantity: (b.quantity100 / 100).toFixed(2),
          amount: b.cents == null ? '' : U.D.money(b.cents),
          note: b.note || '',
        },
        error: '',
        preview: null,
      });
    },
    // Shows how the bill would be split before anything is saved.
    previewBill() {
      U.guard(this, () => {
        const bill = C.normalizeBill(Object.assign({}, this.data.form), this.s.bills, this.findBill(), this.s.home),
          result = C.allocateBill(bill, this.s.records, this.s.home.tariffs),
          vehicles = new Map(this.s.vehicles.map(v => [v.id, v.name]));
        this.pendingBill = bill;
        this.setData({
          error: '',
          preview: {
            rows: result.rows.map(row => {
              const r = this.s.records.find(x => x.id === row.recordId),
                w = C.chargeWindow(r);
              return {
                id: row.recordId,
                date: r.date,
                range: w ? C.windowText(w) : '',
                vehicle: vehicles.get(r.vehicleId) || '',
                estimate: r.estQuantity100 ? (r.estQuantity100 / 100).toFixed(2) : '',
                weight: (row.weight100 / 100).toFixed(2),
                quantity: (row.quantity100 / 100).toFixed(2),
                amount: U.D.money(row.cents),
              };
            }),
            warnings: result.warnings.map(w => w.message),
          },
        });
      });
    },
    findBill() {
      return this.data.form.id ? this.s.bills.find(b => b.id === this.data.form.id) : null;
    },
    // The split is always shown before a bill is saved: the first tap previews, the next one saves.
    saveBill() {
      if (this.data.saving) return;
      if (!this.data.preview) return this.previewBill();
      this.setData({ saving: true });
      const id = U.guard(this, () => U.getStore().saveBill(this.data.form), {
        账单电量: 'quantity',
        账单金额: 'amount',
        账单结束日期: 'to',
      });
      this.setData({ saving: false });
      if (id) {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.onShow();
      }
    },
    deleteBill(e) {
      U.confirm('删除这张账单？相关家充会回到「待对账」，金额也变回预估。', () =>
        U.guard(this, () => {
          U.getStore().deleteBill(e.currentTarget.dataset.id);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.onShow();
        })
      );
    },
  })
);
