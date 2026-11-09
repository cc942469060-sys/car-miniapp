const D=require('./domain');
const {getStore,normalizeBackup}=require('./store');
const KEY='car-miniapp:backup';
// One local file, overwritten on each export; the chat shows the dated file name instead.
const filePath=()=>wx.env.USER_DATA_PATH+'/car-miniapp-backup.json';
const cancelled=e=>/cancel/.test((e&&e.errMsg)||'');
function writeBackup(){
  D.assert(wx.shareFileMessage,'当前微信版本不支持发送文件，请升级微信后再导出');
  const data=getStore().exportData();wx.getFileSystemManager().writeFileSync(filePath(),JSON.stringify(data),'utf8');
  return {filePath:filePath(),fileName:'车小记备份-'+D.today()+'.json',count:data.records.length};
}
function backupState(){try{return wx.getStorageSync(KEY)||null;}catch(e){return null;}}
// Remembers the last export, or the backup just restored, so the app can suggest a fresh one later.
function markBackedUp(count,exportedAt){const at=Date.parse(exportedAt);try{wx.setStorageSync(KEY,{at:isNaN(at)?D.today():D.dateOf(new Date(at)),count});}catch(e){}}
// Suggests a backup only once there is something worth losing: 10+ records never backed up, or changes since a backup 30+ days old.
function backupNudge(count){const b=backupState();if(!b)return count>=10?`已有 ${count} 条记录还没有备份过`:'';const days=D.daysBetween(D.today(),b.at);return days>=30&&count!==b.count?`距上次备份已 ${days} 天`:'';}
function readBackup(path){try{return JSON.parse(wx.getFileSystemManager().readFileSync(path,'utf8'));}catch(e){throw new Error('无法读取该文件，请选择车小记导出的 .json 备份文件');}}
// Validates before asking, so the confirmation only appears for a backup that can actually be restored.
function describeRestore(raw){
  const data=normalizeBackup(raw),at=Date.parse(raw.exportedAt);let local='';
  try{const s=getStore().read();if(s.vehicles.length)local=`（现有 ${s.vehicles.length} 辆车、${s.records.length} 条记录，建议先导出）`;}catch(e){local='';}
  return `备份导出于 ${isNaN(at)?'未知时间':D.dateOf(new Date(at))}，含 ${data.vehicles.length} 辆车、${data.records.length} 条记录、${data.plans.length} 个计划。恢复会替换本机全部数据${local}，且无法撤销。`;
}
module.exports={writeBackup,readBackup,describeRestore,cancelled,backupState,markBackedUp,backupNudge};
