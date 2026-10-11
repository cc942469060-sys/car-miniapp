const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{error:''},onShow(){U.guard(this,()=>{const x=U.base();this.setData(Object.assign(x.data,{plans:x.plans,records:x.records.filter(r=>r.kind==='service').map(U.recordView)}));});},
 addPlan(){wx.navigateTo({url:'/pages/plan/index?vehicleId='+this.data.vehicle.id});},
 editPlan(e){wx.navigateTo({url:'/pages/plan/index?id='+e.currentTarget.dataset.id});},
 completePlan(e){wx.navigateTo({url:'/pages/entry/index?vehicleId='+this.data.vehicle.id+'&planId='+e.currentTarget.dataset.id});}
}));
