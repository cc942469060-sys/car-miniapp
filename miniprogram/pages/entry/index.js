const U = require('../../utils/ui');
const C = require('../../utils/charging');
// Validation message label → form field, for marking the field that needs fixing.
const FIELDS = {
  记录日期: 'date',
  累计里程: 'mileage',
  金额: 'amount',
  补能量: 'quantity',
  充电后电量: 'socAfter',
  充电前电量: 'socBefore',
  开始充电时间: 'startTime',
  充满时间: 'endTime',
};
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
        socBefore: '',
        confirmed: false,
        complete: false,
        planId: '',
        home: false,
        settle: '',
        startTime: '',
        endTime: '',
        estQuantity: '',
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
      homeReady: false,
      meterText: '',
      kText: '',
      preview: null,
      allocRows: [],
      locked: false,
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
          home: false,
          settle: '',
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
        if (form.kind === 'charge' && form.home && !record) form.settle = this.settleFor(true);
        this.s = s;
        this.v = v;
        this.kInfo = C.homeK(v, s.records, s.bills);
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
          homeReady: !!s.home.meter,
          meterText:
            s.home.meter === 'dedicated' ? '独立电表' : s.home.meter === 'shared' ? '共用总表' : '未设置电表类型',
          kText: this.kText(),
          locked: !!(record && record.home && record.settle === 'bill'),
          allocRows: record && record.home ? this.allocRows(record) : [],
          ready: true,
        });
        this.refresh();
        wx.setNavigationBarTitle({ title: record ? '记录详情' : '记一笔' });
      });
    },
    // 独立电表先把家充挂成待对账；共用总表按预估入账；没设置电表时只能手填实际值。
    settleFor(on) {
      if (!on) return '';
      const meter = this.s && this.s.home ? this.s.home.meter : '';
      return meter === 'dedicated' ? 'pending' : meter === 'shared' ? 'estimate' : 'manual';
    },
    kText() {
      const info = this.kInfo;
      if (!info || !info.k) return '';
      const per = (info.k / 100).toFixed(2);
      if (info.samples >= 3)
        return `每 1% ≈ ${per} kWh（近 ${info.samples} 张账单校准${info.mae == null ? '' : `，平均偏差 ${(info.mae * 100).toFixed(0)}%`}）`;
      return `每 1% ≈ ${per} kWh（电池 ${(this.v.batteryKwh100 / 100).toFixed(0)} kWh、效率 90%）`;
    },
    // Which bill paid for which part of a settled home charge, shown read-only when editing it.
    allocRows(record) {
      return (record.alloc || []).map(a => {
        const b = this.s.bills.find(x => x.id === a.billId);
        return {
          id: a.billId,
          range: b ? `${b.from} ~ ${b.to}` : '账单已删除',
          quantity: (a.quantity100 / 100).toFixed(2),
          amount: U.D.money(a.cents),
        };
      });
    },
    // Live estimate for the entry form, using the same function the store applies when saving.
    refresh(patch) {
      const form = Object.assign({}, this.data.form, patch || {});
      if (form.kind !== 'charge' || !form.home || !this.v || !this.s) {
        return this.setData({ preview: null });
      }
      try {
        const est = C.estimateHomeCharge(form, this.v, this.kInfo ? this.kInfo.k : null, this.s.home),
          byLabel = est.slice.byLabel,
          parts = C.LABEL_IDS.filter(l => byLabel[l]).map(
            l => `${C.LABELS[l]} ${(byLabel[l].quantity100 / 100).toFixed(2)} kWh`
          );
        this.est = est;
        this.setData({
          preview: {
            text: parts.join(' · '),
            quantity: (est.estQuantity100 / 100).toFixed(2),
            amount: U.D.money(est.estCents),
            end: `${est.endTime}${est.endEstimated ? '（按功率推算）' : ''}`,
            method: { soc: '按充电前后电量估算', power: '按功率与时长估算', typed: '按填写的估计电量' }[est.estMethod],
            start: form.startTime,
          },
        });
      } catch (e) {
        this.est = null;
        if (!e.user) console.error(e);
        this.setData({ preview: e.user ? { error: e.message } : null });
      }
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
        patch['form.settle'] = kind === 'charge' ? this.settleFor(!!d.home) : '';
        Object.assign(patch, this.fill(patch));
      }
      this.setData(patch);
      this.refresh(patch);
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
      if (/^(startTime|endTime|socBefore|socAfter|estQuantity|amount|quantity)$/.test(field)) this.refresh(patch);
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
    // 家充 once on stays on for the next charge, as most people charge at home every night.
    toggleHome(e) {
      const home = e.detail.value,
        patch = { 'form.home': home, 'form.settle': this.settleFor(home) };
      if (!home) Object.assign(patch, { 'form.startTime': '', 'form.endTime': '', 'form.socBefore': '' });
      this.setData(patch);
      this.refresh(patch);
    },
    // Off means the values were read from the charger and typed in by hand (actual, no estimate).
    toggleSettle(e) {
      const on = e.detail.value,
        meter = this.s.home.meter,
        settle = on ? (meter === 'shared' ? 'estimate' : 'pending') : 'manual',
        patch = { 'form.settle': settle };
      this.setData(patch);
      this.refresh(patch);
    },
    goHomeCharge() {
      wx.navigateTo({ url: '/pages/homecharge/index' });
    },
    // Likely typos get a confirmation rather than a block; validation errors are shown next to their field.
    save() {
      if (this.data.saving || this.confirming || !this.data.ready) return;
      U.guard(
        this,
        () => {
          const s = U.getStore().read(),
            v = s.vehicles.find(x => x.id === this.data.form.vehicleId),
            input = Object.assign({}, this.data.form, { id: this.data.form.id || '' }),
            est =
              input.home && input.settle !== 'bill'
                ? (() => {
                    try {
                      return C.estimateHomeCharge(
                        input,
                        v,
                        this.kInfo ? this.kInfo.k : C.homeK(v, s.records, s.bills).k,
                        s.home
                      );
                    } catch (e) {
                      if (input.settle === 'manual') return null;
                      throw e;
                    }
                  })()
                : null,
            warnings = U.D.recordWarnings(
              U.D.normalizeRecord(
                // The store fills the same estimate in again when saving; this copy is for the warnings only.
                est
                  ? Object.assign(input, {
                      estQuantity100: est.estQuantity100,
                      estCents: est.estCents,
                      estMethod: est.estMethod,
                      estK10000: est.estK10000,
                      endTime: est.endTime,
                      endEstimated: est.endEstimated,
                    })
                  : input,
                v
              ),
              v,
              s.records,
              { home: s.home, k: this.kInfo ? this.kInfo.k : null }
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
