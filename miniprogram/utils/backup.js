const D=require('./domain');
const {getStore,normalizeBackup}=require('./store');
// One local file, overwritten on each export; the chat shows the dated file name instead.
const filePath=()=>wx.env.USER_DATA_PATH+'/car-miniapp-backup.json';
const cancelled=e=>/cancel/.test((e&&e.errMsg)||'');
function writeBackup(){
  D.assert(wx.shareFileMessage,'当前微信版本不支持发送文件，请升级微信后再导出');
  wx.getFileSystemManager().writeFileSync(filePath(),JSON.stringify(getStore().exportData()),'utf8');
  return {filePath:filePath(),fileName:'车小记备份-'+D.today()+'.json'};
}
function readBackup(path){try{return JSON.parse(wx.getFileSystemManager().readFileSync(path,'utf8'));}catch(e){throw new Error('无法读取该文件，请选择车小记导出的 .json 备份文件');}}
// Validates before asking, so the confirmation only appears for a backup that can actually be restored.
function describeRestore(raw){
  const data=normalizeBackup(raw),at=Date.parse(raw.exportedAt);let local='';
  try{const s=getStore().read();if(s.vehicles.length)local=`（现有 ${s.vehicles.length} 辆车、${s.records.length} 条记录，建议先导出）`;}catch(e){local='';}
  return `备份导出于 ${isNaN(at)?'未知时间':D.dateOf(new Date(at))}，含 ${data.vehicles.length} 辆车、${data.records.length} 条记录、${data.plans.length} 个计划。恢复会替换本机全部数据${local}，且无法撤销。`;
}
module.exports={writeBackup,readBackup,describeRestore,cancelled};
