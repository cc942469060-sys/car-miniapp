const D=require('./domain');
const {getStore}=require('./store');
function recordView(r){return Object.assign({},r,{title:D.KINDS[r.kind],amount:D.money(r.cents),quantity:r.quantity100?(r.quantity100/100).toFixed(2):'',unit:r.kind==='fuel'?'L':'kWh',symbol:{fuel:'油',charge:'电',service:'养',other:'账'}[r.kind]});}
function snapshot(){
  const s=getStore().read(),v=s.vehicles.find(x=>x.id===s.currentId)||s.vehicles.find(x=>!x.archived)||s.vehicles[0];
  const records=v?s.records.filter(r=>r.vehicleId===v.id).sort((a,b)=>b.date.localeCompare(a.date)||b.mileage-a.mileage||b.id.localeCompare(a.id)):[];
  const mileage=v?D.currentMileage(v,records):null;
  const plans=v?s.plans.filter(p=>p.vehicleId===v.id).map(p=>D.reminder(p,records,mileage)).sort((a,b)=>a.rank-b.rank||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')):[];
  return {s,v,records,mileage,plans};
}
function base(){const x=snapshot();return Object.assign(x,{data:{vehicles:x.s.vehicles.map(v=>({id:v.id,name:v.name+(v.archived?'（归档）':'')})),vehicleIndex:x.v?x.s.vehicles.findIndex(v=>v.id===x.v.id):0,vehicle:x.v?Object.assign({},x.v,{typeName:D.typeOf(x.v).name}):null,mileage:x.mileage,today:D.today(),error:''}});}
function guard(page,fn){try{return fn();}catch(e){page.setData({error:e.message||'操作失败，请重试'});return undefined;}}
function back(){wx.navigateBack({delta:1,fail:()=>wx.switchTab({url:'/pages/home/index'})});}
function saved(){wx.showToast({title:'已保存',icon:'success'});back();}
function confirm(content,action){wx.showModal({title:'请确认',content,confirmText:'确定',confirmColor:'#b91c1c',success:r=>{if(r.confirm)action();}});}
const common={
  switchVehicle(e){guard(this,()=>{const id=this.data.vehicles[Number(e.detail.value)].id;getStore().select(id);this.onShow();});},
  addVehicle(){wx.navigateTo({url:'/pages/vehicle/index'});},
  addRecord(){if(this.data.vehicle)wx.navigateTo({url:'/pages/entry/index?vehicleId='+this.data.vehicle.id});},
  openRecord(e){wx.navigateTo({url:'/pages/entry/index?id='+e.currentTarget.dataset.id});},
  viewLedger(){wx.switchTab({url:'/pages/ledger/index'});},
  viewCare(){wx.switchTab({url:'/pages/care/index'});},
  viewStats(){wx.navigateTo({url:'/pages/stats/index'});},
  input(e){this.setData({['form.'+e.currentTarget.dataset.field]:e.detail.value,error:''});},
  toggle(e){this.setData({['form.'+e.currentTarget.dataset.field]:e.detail.value,error:''});},
  cancel(){back();}
};
module.exports={D,getStore,recordView,snapshot,base,guard,back,saved,confirm,common};
