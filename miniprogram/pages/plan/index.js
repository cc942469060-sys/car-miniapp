const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{form:{name:'',dueDate:'',dueMileage:'',intervalMonths:'',intervalKm:'',leadDays:'30',leadKm:'500'},dateEnabled:false,error:'',saving:false,ready:false},
 onLoad(options){U.guard(this,()=>{const s=U.getStore().read(),p=options.id?s.plans.find(p=>p.id===options.id):null;U.D.assert(!options.id||p,'计划不存在');const v=s.vehicles.find(v=>v.id===(p?p.vehicleId:options.vehicleId));U.D.assert(v,'车辆不存在');const form=p?Object.assign({},p,{dueMileage:p.dueMileage==null?'':String(p.dueMileage)}):Object.assign({},this.data.form,{vehicleId:v.id});this.setData({form,vehicle:v,dateEnabled:!!form.dueDate,pickerDate:form.dueDate||U.D.today(),ready:true});wx.setNavigationBarTitle({title:p?'编辑养护计划':'新建养护计划'});});},
 enableDate(e){this.setData({dateEnabled:e.detail.value,'form.dueDate':e.detail.value?this.data.pickerDate:'',error:''});},
 dateChange(e){this.setData({'form.dueDate':e.detail.value,pickerDate:e.detail.value,error:''});},
 save(){if(this.data.saving||!this.data.ready)return;this.setData({saving:true});const id=U.guard(this,()=>U.getStore().savePlan(this.data.form));if(id)U.saved();else this.setData({saving:false});},
 remove(){U.confirm('删除这个计划？已记录的保养费用会保留，计划关联会解除。',()=>U.guard(this,()=>{U.getStore().deletePlan(this.data.form.id);U.saved();}));}
}));
