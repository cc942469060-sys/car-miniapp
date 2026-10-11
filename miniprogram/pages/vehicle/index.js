const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{form:{name:'',model:'',type:'fuel',baseDate:U.D.today(),baseMileage:''},types:U.D.TYPES,typeIndex:0,today:U.D.today(),error:'',saving:false,ready:false},
 onLoad(options){U.guard(this,()=>{const v=options.id?U.getStore().read().vehicles.find(x=>x.id===options.id):null;U.D.assert(!options.id||v,'车辆不存在');if(v)this.setData({form:Object.assign({},v),typeIndex:U.D.TYPES.findIndex(t=>t.id===v.type)});this.setData({ready:true});wx.setNavigationBarTitle({title:v?'编辑车辆':'添加车辆'});});},
 typeChange(e){const i=Number(e.detail.value);this.setData({typeIndex:i,'form.type':U.D.TYPES[i].id,error:''});},
 save(){if(this.data.saving||!this.data.ready)return;this.setData({saving:true});const id=U.guard(this,()=>U.getStore().saveVehicle(this.data.form));if(id)U.saved();else this.setData({saving:false});}
}));
