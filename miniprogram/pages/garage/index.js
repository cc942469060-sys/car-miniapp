const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{error:''},onShow(){U.guard(this,()=>{const x=U.base();this.setData(Object.assign(x.data,{cars:x.s.vehicles.map(v=>Object.assign({},v,{typeName:U.D.typeOf(v).name,mileage:U.D.currentMileage(v,x.s.records).mileage,selected:x.v&&x.v.id===v.id}))}));});},
 select(e){U.guard(this,()=>{U.getStore().select(e.currentTarget.dataset.id);this.onShow();});},
 edit(e){wx.navigateTo({url:'/pages/vehicle/index?id='+e.currentTarget.dataset.id});},
 archive(e){const {id,archived}=e.currentTarget.dataset;U.confirm(archived?'恢复车辆并允许继续记账？':'归档后保留历史数据，暂停新增记录，可随时恢复。',()=>U.guard(this,()=>{U.getStore().archiveVehicle(id,!archived);this.onShow();}));}
}));
