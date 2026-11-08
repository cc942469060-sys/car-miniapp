const U=require('../../utils/ui');
const B=require('../../utils/backup');
Page(Object.assign({},U.common,{
 data:{error:''},onShow(){U.guard(this,()=>{const x=U.base();this.setData(Object.assign(x.data,{cars:x.s.vehicles.map(v=>Object.assign({},v,{typeName:U.D.typeOf(v).name,mileage:U.D.currentMileage(v,x.s.records).mileage,selected:x.v&&x.v.id===v.id}))}));});},
 select(e){U.guard(this,()=>{U.getStore().select(e.currentTarget.dataset.id);this.onShow();});},
 edit(e){wx.navigateTo({url:'/pages/vehicle/index?id='+e.currentTarget.dataset.id});},
 archive(e){const {id,archived}=e.currentTarget.dataset;U.confirm(archived?'恢复车辆并允许继续记账？':'归档后保留历史数据，暂停新增记录，可随时恢复。',()=>U.guard(this,()=>{U.getStore().archiveVehicle(id,!archived);this.onShow();}));},
 // shareFileMessage only works directly inside a tap handler, so the file is written synchronously first.
 exportBackup(){this.setData({error:''});U.guard(this,()=>{wx.shareFileMessage(Object.assign(B.writeBackup(),{success:()=>wx.showToast({title:'已导出',icon:'success'}),fail:e=>{if(!B.cancelled(e))this.setData({error:'未能发送备份文件，请重试'});}}));});},
 restoreBackup(){this.setData({error:''});wx.chooseMessageFile({count:1,type:'file',extension:['json'],success:res=>U.guard(this,()=>{const raw=B.readBackup(res.tempFiles[0].path);U.confirm(B.describeRestore(raw),()=>U.guard(this,()=>{U.getStore().restore(raw);wx.showToast({title:'已恢复',icon:'success'});this.onShow();}));}),fail:e=>{if(!B.cancelled(e))this.setData({error:'未能选择文件：'+e.errMsg});}});}
}));
