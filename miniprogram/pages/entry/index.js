const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{form:{date:U.D.today(),kind:'fuel',mileage:'',amount:'',quantity:'',note:'',full:false,gap:false,socAfter:'',confirmed:false,complete:false,planId:''},today:U.D.today(),kinds:[],kindIndex:0,error:'',saving:false,ready:false},
 onLoad(options){U.guard(this,()=>{const s=U.getStore().read(),record=options.id?s.records.find(r=>r.id===options.id):null;U.D.assert(!options.id||record,'记录不存在');const v=s.vehicles.find(x=>x.id===(record?record.vehicleId:options.vehicleId));U.D.assert(v,'车辆不存在');const kinds=U.D.allowedKinds(v).map(id=>({id,name:U.D.KINDS[id]}));let form=Object.assign({},this.data.form,{vehicleId:v.id,kind:kinds[0].id,mileage:String(U.D.currentMileage(v,s.records).mileage)});
 if(record)form=Object.assign(form,record,{amount:U.D.money(record.cents),quantity:record.quantity100?(record.quantity100/100).toFixed(2):'',socAfter:record.socAfter==null?'':String(record.socAfter)});
 const planId=record?record.planId:options.planId,plan=planId?s.plans.find(p=>p.id===planId&&p.vehicleId===v.id):null;U.D.assert(!planId||plan,'关联计划不存在');if(plan&&!record)form=Object.assign(form,{kind:'service',planId:plan.id,complete:true,note:plan.name});
 this.setData({vehicle:v,kinds,form,kindIndex:kinds.findIndex(k=>k.id===form.kind),planName:plan?plan.name:'',ready:true});wx.setNavigationBarTitle({title:record?'记录详情':'记一笔'});
 });},
 kindChange(e){if(this.data.form.planId)return;const i=Number(e.detail.value);this.setData({kindIndex:i,'form.kind':this.data.kinds[i].id,error:''});},
 save(){if(this.data.saving||!this.data.ready)return;this.setData({saving:true});const id=U.guard(this,()=>U.getStore().saveRecord(this.data.form));if(id)U.saved();else this.setData({saving:false});},
 remove(){U.confirm('删除这笔记录？费用、能耗与关联养护计划会重新计算，此操作无法撤销。',()=>U.guard(this,()=>{U.getStore().deleteRecord(this.data.form.id);U.saved();}));}
}));
