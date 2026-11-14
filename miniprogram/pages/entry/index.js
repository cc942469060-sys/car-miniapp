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
      autoAmount: true,
      readingMileage: '',
      readingDate: '',
      error: '',
      saving: false,
      ready: false,
    },
    onLoad(options) {
      // Fields typed by hand; switching the record kind leaves them alone.
      this.typed = {};
      U.guard(this, () => {
        const s = U.getStore().read(),
          record = options.id ? s.records.find(r => r.id === options.id) : null;
        U.D.assert(!options.id || record, '记录不存在');
        const v = s.vehicles.find(x => x.id === (record ? record.vehicleId : options.vehicleId));
        U.D.assert(v, '车辆不存在');
        const planId = record ? record.planId : options.planId,
          plan = planId ? s.plans.find(p => p.id === planId && p.vehicleId === v.id) : null;
        U.D.assert(!planId || plan, '关联计划不存在');
        // Read today on open, not at page registration.
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
        // New fuel and charge records start from the latest reading and the last record of their kind.
        this.defaults = {};
        kinds.forEach(k => (this.defaults[k.id] = U.D.recordDefaults(v, s.records, k.id)));
        let form = Object.assign({}, this.data.form, {
          vehicleId: v.id,
          kind: kinds[0].id,
          date: today,
          full: !!(lastFuel && lastFuel.full),
          confirmed: !!(lastCharge && lastCharge.confirmed),
        });
        if (record)
          form = Object.assign(form, U.D.recordInput(record), {
            price: U.D.unitPrice(record),
            category: record.category || '其他',
          });
        else if (plan)
          form = Object.assign(
            form,
            { planId: plan.id, complete: true, note: plan.name },
            U.D.planRecordDefaults(plan, s.records)
          );
        else form = Object.assign(form, this.defaults[form.kind]);
        this.setData({
          vehicle: v,
          kinds,
          form,
          kindIndex: kinds.findIndex(k => k.id === form.kind),
          planName: plan ? plan.name : '',
          autoQuantity: !record,
          autoAmount: !record,
          today,
          mileageHint: `最近读数 ${last.mileage} km（${last.date}）`,
          readingMileage: String(last.mileage),
          readingDate: last.date,
          socHint: lastCharge && lastCharge.socAfter != null ? `上次充到 ${lastCharge.socAfter}%` : '如 80',
          ready: true,
        });
        wx.setNavigationBarTitle({ title: record ? '记录详情' : '记一笔' });
      });
    },
    // A new record takes on the defaults of the kind it switches to, except in fields typed by hand.
    pickKind(e) {
      const i = Number(e.currentTarget.dataset.index),
        kind = this.data.kinds[i].id,
        patch = { kindIndex: i, 'form.kind': kind, error: '', errorField: '' };
      if (!this.data.form.id && !this.data.form.planId) {
        const d = this.defaults[kind];
        Object.keys(d).forEach(field => {
          if (!this.typed[field]) patch['form.' + field] = d[field];
        });
        Object.assign(patch, this.fill(patch));
      }
      this.setData(patch);
    },
    // At the unit price, a typed amount fills in the quantity and a typed quantity fills in an empty amount. A filled-in
    // value follows the typed ones until it is typed by hand; clearing it hands it back.
    input(e) {
      const field = e.currentTarget.dataset.field,
        value = e.detail.value,
        patch = { ['form.' + field]: value, error: '', errorField: '' };
      this.typed[field] = true;
      if (field === 'amount') patch.autoAmount = value === '';
      if (field === 'quantity') patch.autoQuantity = value === '';
      if (field === 'amount' || field === 'price' || field === 'quantity')
        Object.assign(patch, this.fill(patch, field));
      this.setData(patch);
    },
    // The quantity and amount to fill in once `patch` applies. Only typed values are used, so a filled-in value never
    // feeds the other one, and the field being typed is never refilled under the cursor.
    fill(patch, typing) {
      const get = key => ('form.' + key in patch ? patch['form.' + key] : this.data.form[key]),
        autoAmount = 'autoAmount' in patch ? patch.autoAmount : this.data.autoAmount,
        autoQuantity = 'autoQuantity' in patch ? patch.autoQuantity : this.data.autoQuantity,
        amount = Number(get('amount')),
        price = Number(get('price')),
        quantity = Number(get('quantity')),
        filled = {};
      if (autoQuantity && !autoAmount && typing !== 'quantity' && amount > 0 && price > 0)
        filled['form.quantity'] = (amount / price).toFixed(2);
      // Half-up to the fen; the nudge undoes binary error such as 1.005 * 100 = 100.49999….
      if (autoAmount && !autoQuantity && typing !== 'amount' && quantity > 0 && price > 0)
        filled['form.amount'] = U.D.money(Math.round(quantity * price * 100 + 1e-7));
      return filled;
    },
    pickCategory(e) {
      this.setData({ 'form.category': e.currentTarget.dataset.value, error: '', errorField: '' });
    },
    // Likely typos get a confirmation rather than a block; validation errors are shown next to their field.
    save() {
      if (this.data.saving || this.confirming || !this.data.ready) return;
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
          // One confirmation at a time: a second tap before the dialog shows must not open another one.
          this.confirming = true;
          wx.showModal({
            title: '请核对',
            content: warnings.join('；') + '。确认无误再保存。',
            confirmText: '仍要保存',
            success: r => {
              this.confirming = false;
              if (r.confirm) this.commit();
            },
            fail: () => {
              this.confirming = false;
            },
          });
        },
        FIELDS
      );
    },
    // Saving twice must not write twice, whichever path calls this.
    commit() {
      if (this.data.saving) return;
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
