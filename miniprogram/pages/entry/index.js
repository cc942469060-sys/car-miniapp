const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{form:{date:'',kind:'fuel',mileage:'',amount:'',quantity:'',note:'',full:false,gap:false,socAfter:'',confirmed:false,complete:false,planId:''},today:'',mileageHint:'',socHint:'',kinds:[],kindIndex:0,error:'',saving:false,ready:false},
 onLoad(options){U.guard(this,()=>{const s=U.getStore().read(),record=options.id?s.records.find(r=>r.id===options.id):null;U.D.assert(!options.id||record,'记录不存在');const v=s.vehicles.find(x=>x.id===(record?record.vehicleId:options.vehicleId));U.D.assert(v,'车辆不存在');
 const planId=record?record.planId:options.planId,plan=planId?s.plans.find(p=>p.id===planId&&p.vehicleId===v.id):null;U.D.assert(!planId||plan,'关联计划不存在');
 // Read today on open, not at page registration. Mileage is never pre-filled: an unchanged stale reading would distort energy intervals.
 const today=U.D.today(),last=U.D.currentMileage(v,s.records),kinds=U.D.allowedKinds(v).filter(id=>!plan||U.D.PLAN_KINDS.includes(id)).map(id=>({id,name:U.D.KINDS[id]}));
 // New records repeat the last full-tank and charging-complete choices, which most people make the same way every time.
 const mine=s.records.filter(r=>r.vehicleId===v.id).sort((a,b)=>b.date.localeCompare(a.date)||b.mileage-a.mileage||b.id.localeCompare(a.id)),lastFuel=mine.find(r=>r.kind==='fuel'),lastCharge=mine.find(r=>r.kind==='charge');
 let form=Object.assign({},this.data.form,{vehicleId:v.id,kind:kinds[0].id,date:today,full:!!(lastFuel&&lastFuel.full),confirmed:!!(lastCharge&&lastCharge.confirmed)});
 if(record)form=Object.assign(form,U.D.recordInput(record));
 else if(plan)form=Object.assign(form,{planId:plan.id,complete:true,note:plan.name});
 this.setData({vehicle:v,kinds,form,kindIndex:kinds.findIndex(k=>k.id===form.kind),planName:plan?plan.name:'',today,mileageHint:`最近读数 ${last.mileage} km（${last.date}）`,socHint:lastCharge&&lastCharge.socAfter!=null?`上次充到 ${lastCharge.socAfter}%`:'如 80',ready:true});wx.setNavigationBarTitle({title:record?'记录详情':'记一笔'});
 });},
 kindChange(e){const i=Number(e.detail.value);this.setData({kindIndex:i,'form.kind':this.data.kinds[i].id,error:''});},
 // Likely typos get a confirmation rather than a block; validation errors still show as before.
 save(){if(this.data.saving||!this.data.ready)return;U.guard(this,()=>{const s=U.getStore().read(),v=s.vehicles.find(x=>x.id===this.data.form.vehicleId),warnings=U.D.recordWarnings(U.D.normalizeRecord(Object.assign({},this.data.form,{id:this.data.form.id||''}),v),v,s.records);if(!warnings.length)return this.commit();wx.showModal({title:'请核对',content:warnings.join('；')+'。确认无误再保存。',confirmText:'仍要保存',success:r=>{if(r.confirm)this.commit();}});});},
 commit(){this.setData({saving:true});const id=U.guard(this,()=>U.getStore().saveRecord(this.data.form));if(id)U.saved();else this.setData({saving:false});},
 remove(){U.confirm('删除这笔记录？费用、能耗与关联养护计划会重新计算，此操作无法撤销。',()=>U.guard(this,()=>{U.getStore().deleteRecord(this.data.form.id);U.saved('已删除');}));}
}));
