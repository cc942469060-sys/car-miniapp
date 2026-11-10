const D=require('./domain');
const {getStore}=require('./store');
// `rates` (from intervalRates) adds the consumption of the interval a record closes; unit price comes from the record itself.
function recordView(r,rates){const unit=r.kind==='fuel'?'L':'kWh',price=r.quantity100&&r.cents?`¥${(r.cents/r.quantity100).toFixed(2)}/${unit}`:'';return Object.assign({},r,{title:r.kind==='other'&&r.category&&r.category!=='其他'?r.category:D.KINDS[r.kind],amount:D.money(r.cents),quantity:r.quantity100?(r.quantity100/100).toFixed(2):'',unit,symbol:{fuel:'油',charge:'电',service:'养',other:'账'}[r.kind],detail:[price,rates&&rates[r.id]].filter(Boolean).join(' · ')});}
function intervalRates(records){const rates={};['fuel','charge'].forEach(kind=>D.energyIntervals(records,kind).intervals.forEach(i=>{rates[i.toId]=kind==='fuel'?`油耗 ${i.rate} L/100km`:`电耗 ${i.rate} kWh/100km`;}));return rates;}
function snapshot(){
  const s=getStore().read(),v=s.vehicles.find(x=>x.id===s.currentId)||s.vehicles.find(x=>!x.archived)||s.vehicles[0];
  const records=v?s.records.filter(r=>r.vehicleId===v.id).sort((a,b)=>b.date.localeCompare(a.date)||b.mileage-a.mileage||b.id.localeCompare(a.id)):[];
  const mileage=v?D.currentMileage(v,records):null,daily=v?D.mileageStats(v,records).dailyKm:0;
  const plans=v?s.plans.filter(p=>p.vehicleId===v.id).map(p=>D.reminder(p,records,mileage,D.today(),daily)).sort((a,b)=>a.rank-b.rank||a.urgency-b.urgency):[];
  return {s,v,records,mileage,plans};
}
function base(){const x=snapshot();return Object.assign(x,{data:{vehicles:x.s.vehicles.map(v=>({id:v.id,name:v.name+(v.archived?'（归档）':'')})),vehicleIndex:x.v?x.s.vehicles.findIndex(v=>v.id===x.v.id):0,vehicle:x.v?Object.assign({},x.v,{typeName:D.typeOf(x.v).name}):null,mileage:x.mileage,today:D.today(),error:''}});}
function guard(page,fn){try{return fn();}catch(e){page.setData({error:e.message||'操作失败，请重试'});return undefined;}}
function back(){wx.navigateBack({delta:1,fail:()=>wx.switchTab({url:'/pages/home/index'})});}
function saved(title){wx.showToast({title:title||'已保存',icon:'success'});back();}
function confirm(content,action){wx.showModal({title:'请确认',content,confirmText:'确定',confirmColor:'#b91c1c',success:r=>{if(r.confirm)action();}});}
const common={
  switchVehicle(e){guard(this,()=>{const id=this.data.vehicles[Number(e.detail.value)].id;getStore().select(id);this.onShow();});},
  addVehicle(){wx.navigateTo({url:'/pages/vehicle/index'});},
  addRecord(){if(this.data.vehicle)wx.navigateTo({url:'/pages/entry/index?vehicleId='+this.data.vehicle.id});},
  openRecord(e){wx.navigateTo({url:'/pages/entry/index?id='+e.currentTarget.dataset.id});},
  viewLedger(){wx.switchTab({url:'/pages/ledger/index'});},
  viewCare(){wx.switchTab({url:'/pages/care/index'});},
  viewStats(){wx.navigateTo({url:'/pages/stats/index'});},
  viewGarage(){wx.switchTab({url:'/pages/garage/index'});},
  // Records an odometer reading without an expense, e.g. when a reminder says the last reading is old.
  updateMileage(){const v=this.data.vehicle,m=this.data.mileage;if(!v)return;wx.showModal({title:'更新当前里程',editable:true,placeholderText:`仪表上的累计里程，上次 ${m.mileage} km`,confirmText:'保存',success:r=>{if(r.confirm)guard(this,()=>{getStore().updateMileage(v.id,r.content);wx.showToast({title:'已更新',icon:'success'});this.onShow();});}});},
  input(e){this.setData({['form.'+e.currentTarget.dataset.field]:e.detail.value,error:''});},
  toggle(e){this.setData({['form.'+e.currentTarget.dataset.field]:e.detail.value,error:''});},
  cancel(){back();}
};
module.exports={D,getStore,recordView,intervalRates,snapshot,base,guard,back,saved,confirm,common};
