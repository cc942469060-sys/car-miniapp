const U = require('../../utils/ui');
Page(
  Object.assign({}, U.common, {
    data: { showDone: false, error: '' },
    onShow() {
      U.guard(this, () => {
        const x = U.base();
        this.setData(
          Object.assign(x.data, {
            plans: x.plans.filter(p => p.state !== 'done'),
            done: x.plans.filter(p => p.state === 'done'),
            records: x.records.filter(r => r.kind === 'service' || r.planId).map(r => U.recordView(r)),
          })
        );
      });
    },
    // Completed one-off plans stay available for editing but are folded away from the active list.
    toggleDone() {
      this.setData({ showDone: !this.data.showDone });
    },
    editPlan(e) {
      wx.navigateTo({ url: '/pages/plan/index?id=' + e.currentTarget.dataset.id });
    },
    completePlan(e) {
      wx.navigateTo({
        url: '/pages/entry/index?vehicleId=' + this.data.vehicle.id + '&planId=' + e.currentTarget.dataset.id,
      });
    },
  })
);
