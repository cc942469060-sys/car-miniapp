const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{form:{name:'',dueDate:'',dueMileage:'',intervalMonths:'',intervalKm:'',leadDays:'30',leadKm:'500'},dateEnabled:false,presets:[],presetApplied:false,current:0,error:'',saving:false,ready:false},
 onLoad(options){U.guard(this,()=>{const s=U.getStore().read(),p=options.id?s.plans.find(p=>p.id===options.id):null;U.D.assert(!options.id||p,'计划不存在');const v=s.vehicles.find(v=>v.id===(p?p.vehicleId:options.vehicleId));U.D.assert(v,'车辆不存在');const form=p?Object.assign({},p,{dueMileage:p.dueMileage==null?'':String(p.dueMileage)}):Object.assign({},this.data.form,{vehicleId:v.id});this.setData({form,vehicle:v,dateEnabled:!!form.dueDate,pickerDate:form.dueDate||U.D.today(),presets:p?[]:U.D.planPresets(v),current:U.D.currentMileage(v,s.records).mileage,ready:true});wx.setNavigationBarTitle({title:p?'编辑养护计划':'新建养护计划'});});},
 // A template fills a typical cycle; mileage-based items estimate the first due from today, while insurance and inspection ask for the real date.
 applyPreset(e){const p=this.data.presets[Number(e.currentTarget.dataset.index)],today=U.D.today();this.setData({'form.name':p.name,'form.intervalMonths':p.months?String(p.months):'','form.intervalKm':p.km?String(p.km):'','form.dueMileage':p.km?String(this.data.current+p.km):'','form.dueDate':p.km&&p.months?U.D.addMonths(today,p.months):'',dateEnabled:!!p.months||!p.km,pickerDate:today,presetApplied:true,error:''});},
 enableDate(e){this.setData({dateEnabled:e.detail.value,'form.dueDate':e.detail.value?this.data.pickerDate:'',error:''});},
 dateChange(e){this.setData({'form.dueDate':e.detail.value,pickerDate:e.detail.value,error:''});},
 save(){if(this.data.saving||!this.data.ready)return;this.setData({saving:true});const id=U.guard(this,()=>U.getStore().savePlan(this.data.form));if(id)U.saved();else this.setData({saving:false});},
 remove(){U.confirm('删除这个计划？已记录的费用会保留，计划关联会解除。',()=>U.guard(this,()=>{U.getStore().deletePlan(this.data.form.id);U.saved('已删除');}));}
}));
