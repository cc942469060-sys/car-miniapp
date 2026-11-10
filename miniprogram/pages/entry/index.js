const U = require('../../utils/ui');
// Validation message label → form field, for marking the field that needs fixing.
const FIELDS = { 记录日期: 'date', 累计里程: 'mileage', 金额: 'amount', 补能量: 'quantity', 充电后电量: 'socAfter' };
Page(
  Object.assign({}, U.common, {
    data: {
      form: {
        date: '',
        kind: 'fuel',
        mileage: '',
        amount: '',
        price: '',
        quantity: '',
        note: '',
        category: '其他',
        full: false,
        gap: false,
        socAfter: '',
        confirmed: false,
        complete: false,
        planId: '',
      },
      today: '',
      mileageHint: '',
      socHint: '',
      kinds: [],
      kindIndex: 0,
      categories: U.D.OTHER_CATEGORIES,
      autoQuantity: true,
      error: '',
      saving: false,
      ready: false,
    },
    onLoad(options) {
      U.guard(this, () => {
        const s = U.getStore().read(),
          record = options.id ? s.records.find(r => r.id === options.id) : null;
        U.D.assert(!options.id || record, '记录不存在');
        const v = s.vehicles.find(x => x.id === (record ? record.vehicleId : options.vehicleId));
        U.D.assert(v, '车辆不存在');
        const planId = record ? record.planId : options.planId,
          plan = planId ? s.plans.find(p => p.id === planId && p.vehicleId === v.id) : null;
        U.D.assert(!planId || plan, '关联计划不存在');
        // Read today on open, not at page registration. Mileage is never pre-filled: an unchanged stale reading would distort energy intervals.
        const today = U.D.today(),
          last = U.D.currentMileage(v, s.records),
          kinds = U.D.allowedKinds(v)
            .filter(id => !plan || U.D.PLAN_KINDS.includes(id))
            .map(id => ({ id, name: U.D.KINDS[id] }));
        // New records repeat the last full-tank and charging-complete choices, which most people make the same way every time.
        const mine = s.records
            .filter(r => r.vehicleId === v.id)
            .sort((a, b) => b.date.localeCompare(a.date) || b.mileage - a.mileage || b.id.localeCompare(a.id)),
          lastFuel = mine.find(r => r.kind === 'fuel'),
          lastCharge = mine.find(r => r.kind === 'charge');
        let form = Object.assign({}, this.data.form, {
          vehicleId: v.id,
          kind: kinds[0].id,
          date: today,
          full: !!(lastFuel && lastFuel.full),
          confirmed: !!(lastCharge && lastCharge.confirmed),
        });
        if (record)
          form = Object.assign(form, U.D.recordInput(record), {
            price: record.quantity100 && record.cents ? (record.cents / record.quantity100).toFixed(2) : '',
            category: record.category || '其他',
          });
        else if (plan)
          form = Object.assign(form, {
            planId: plan.id,
            complete: true,
            note: plan.name,
            category: /险/.test(plan.name) ? '保险' : /年检|年审/.test(plan.name) ? '年检' : '其他',
          });
        this.setData({
          vehicle: v,
          kinds,
          form,
          kindIndex: kinds.findIndex(k => k.id === form.kind),
          planName: plan ? plan.name : '',
          autoQuantity: !record,
          today,
          mileageHint: `最近读数 ${last.mileage} km（${last.date}）`,
          socHint: lastCharge && lastCharge.socAfter != null ? `上次充到 ${lastCharge.socAfter}%` : '如 80',
          ready: true,
        });
        wx.setNavigationBarTitle({ title: record ? '记录详情' : '记一笔' });
      });
    },
    pickKind(e) {
      const i = Number(e.currentTarget.dataset.index);
      this.setData({ kindIndex: i, 'form.kind': this.data.kinds[i].id, error: '', errorField: '' });
    },
    // Amount and unit price fill in the quantity until it is typed by hand; clearing the quantity hands it back.
    input(e) {
      const field = e.currentTarget.dataset.field,
        value = e.detail.value,
        patch = { ['form.' + field]: value, error: '', errorField: '' },
        f = Object.assign({}, this.data.form, { [field]: value }),
        amount = Number(f.amount),
        price = Number(f.price);
      if (field === 'quantity') patch.autoQuantity = value === '';
      else if ((field === 'amount' || field === 'price') && this.data.autoQuantity && amount > 0 && price > 0)
        patch['form.quantity'] = (amount / price).toFixed(2);
      this.setData(patch);
    },
    pickCategory(e) {
      this.setData({ 'form.category': e.currentTarget.dataset.value, error: '', errorField: '' });
    },
    // Likely typos get a confirmation rather than a block; validation errors are shown next to their field.
    save() {
      if (this.data.saving || !this.data.ready) return;
      U.guard(
        this,
        () => {
          const s = U.getStore().read(),
            v = s.vehicles.find(x => x.id === this.data.form.vehicleId),
            warnings = U.D.recordWarnings(
              U.D.normalizeRecord(Object.assign({}, this.data.form, { id: this.data.form.id || '' }), v),
              v,
              s.records
            );
          if (!warnings.length) return this.commit();
          wx.showModal({
            title: '请核对',
            content: warnings.join('；') + '。确认无误再保存。',
            confirmText: '仍要保存',
            success: r => {
              if (r.confirm) this.commit();
            },
          });
        },
        FIELDS
      );
    },
    commit() {
      this.setData({ saving: true });
      const id = U.guard(this, () => U.getStore().saveRecord(this.data.form), FIELDS);
      if (id) U.saved();
      else this.setData({ saving: false });
    },
    remove() {
      U.confirm('删除这笔记录？费用、能耗与关联养护计划会重新计算。删除后 1 分钟内可以在列表页撤销。', () =>
        U.guard(this, () => {
          U.rememberDeleted(U.getStore().deleteRecord(this.data.form.id));
          U.saved('已删除');
        })
      );
    },
  })
);
