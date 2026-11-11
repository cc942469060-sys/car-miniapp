const U = require('../../utils/ui');
Page(
  Object.assign({}, U.common, {
    data: {
      form: { name: '', model: '', type: 'fuel', baseDate: '', baseMileage: '' },
      types: U.D.TYPES,
      typeIndex: 0,
      today: '',
      error: '',
      saving: false,
      ready: false,
    },
    onLoad(options) {
      U.guard(this, () => {
        const v = options.id
            ? U.getStore()
                .read()
                .vehicles.find(x => x.id === options.id)
            : null,
          today = U.D.today();
        U.D.assert(!options.id || v, '车辆不存在');
        this.setData(
          v
            ? { form: Object.assign({}, v), typeIndex: U.D.TYPES.findIndex(t => t.id === v.type) }
            : { 'form.baseDate': today }
        );
        this.setData({ today, ready: true });
        wx.setNavigationBarTitle({ title: v ? '编辑车辆' : '添加车辆' });
      });
    },
    typeChange(e) {
      const i = Number(e.detail.value);
      this.setData({ typeIndex: i, 'form.type': U.D.TYPES[i].id, error: '', errorField: '' });
    },
    save() {
      if (this.data.saving || !this.data.ready) return;
      this.setData({ saving: true });
      const id = U.guard(this, () => U.getStore().saveVehicle(this.data.form), {
        车辆昵称: 'name',
        里程日期: 'baseDate',
        累计里程: 'baseMileage',
      });
      if (id) U.saved();
      else this.setData({ saving: false });
    },
    // Deleting a vehicle also deletes its history, so the confirmation says what goes and suggests a backup first.
    remove() {
      U.guard(this, () => {
        const s = U.getStore().read(),
          id = this.data.form.id,
          v = s.vehicles.find(x => x.id === id),
          records = s.records.filter(r => r.vehicleId === id).length,
          plans = s.plans.filter(p => p.vehicleId === id).length;
        U.D.assert(v, '车辆不存在');
        U.confirm(
          `删除「${v.name}」及其 ${records} 条记录、${plans} 个养护计划？删除后无法恢复，建议先在「车辆」页导出备份。`,
          () =>
            U.guard(this, () => {
              U.getStore().deleteVehicle(id);
              U.saved('已删除');
            })
        );
      });
    },
  })
);
