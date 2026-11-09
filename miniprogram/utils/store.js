const D=require('./domain');
const KEY='car-miniapp:v1',APP='car-miniapp',VERSION=1;
const clone=x=>JSON.parse(JSON.stringify(x));
function empty(){return {version:VERSION,vehicles:[],records:[],plans:[],currentId:''};}
// Brings stored or backed-up data to the current schema in memory; unknown data is reported, never rewritten.
function migrate(raw,label,hint){
  D.assert(raw&&typeof raw==='object'&&Number.isInteger(raw.version)&&raw.version>=1,label+'格式不兼容'+hint);
  D.assert(raw.version<=VERSION,label+'来自更新版本的小程序，与当前版本不兼容，请先更新小程序');
  // Upgrade older schemas here one version at a time, e.g. if(raw.version===1){…;raw.version=2;}
  D.assert(Array.isArray(raw.vehicles)&&Array.isArray(raw.records)&&Array.isArray(raw.plans),label+'格式不兼容'+hint);
  return raw;
}
// Checks a backup with the same rules as editing and returns the clean data to store; nothing is written here.
function normalizeBackup(raw){
  D.assert(raw&&raw.app===APP,'这不是车小记导出的备份文件');
  const s=migrate(clone(raw),'备份文件',''),seen=new Set();D.assert(s.vehicles.length,'备份中没有车辆数据');
  const item=(label,i,x,fn)=>{try{D.assert(x&&typeof x.id==='string'&&x.id&&!seen.has(x.id),'编号缺失或重复');seen.add(x.id);return fn();}catch(e){throw new Error(`备份中第 ${i+1} ${label}无效：${e.message}`);}};
  const vehicles=s.vehicles.map((v,i)=>item('辆车',i,v,()=>D.normalizeVehicle(v,{id:v.id,archived:v.archived===true},[])));
  const plans=s.plans.map((p,i)=>item('个计划',i,p,()=>{D.assert(vehicles.some(v=>v.id===p.vehicleId),'所属车辆不存在');return D.normalizePlan(p,p.vehicleId);}));
  const records=s.records.map((r,i)=>item('条记录',i,r,()=>{
    const v=vehicles.find(x=>x.id===r.vehicleId);D.assert(v,'所属车辆不存在');
    D.assert(Number.isSafeInteger(r.cents)&&(!['fuel','charge'].includes(r.kind)||Number.isSafeInteger(r.quantity100)),'金额或补能量格式错误');
    // Archived vehicles keep their history, so their records are checked as if the vehicle were active.
    const n=D.normalizeRecord(D.recordInput(r),Object.assign({},v,{archived:false}));
    D.assert(!n.planId||plans.some(p=>p.id===n.planId&&p.vehicleId===v.id),'关联计划不存在');return n;
  }));
  vehicles.forEach(v=>{try{D.validateTimeline(v,records);}catch(e){throw new Error(`备份中「${v.name}」的${e.message}`);}});
  const currentId=vehicles.some(v=>v.id===s.currentId)?s.currentId:(vehicles.find(v=>!v.archived)||vehicles[0]).id;
  return {version:VERSION,vehicles,records,plans,currentId};
}
function createStore(storage){
  function read(){
    let raw;try{raw=storage.get();}catch(e){throw new Error('读取本地数据失败，请重新打开小程序');}
    if(raw===''||raw==null)return empty();
    return migrate(clone(raw),'本地数据','，请勿清除缓存；如有备份，可在「车辆」页从备份恢复');
  }
  function change(fn){const s=read();const result=fn(s);try{storage.set(s);}catch(e){throw new Error('保存失败，数据未更改。请检查设备存储空间后重试');}return result;}
  function uid(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);}
  return {
    read,
    exportData(){return Object.assign({app:APP,exportedAt:new Date().toISOString()},read());},
    // Replaces all data in one write, and works even when the current local data cannot be read.
    restore(raw){const data=normalizeBackup(raw);try{storage.set(data);}catch(e){throw new Error('恢复失败，本机数据未更改。请检查设备存储空间后重试');}return data;},
    select(id){return change(s=>{D.assert(s.vehicles.some(v=>v.id===id),'车辆不存在');s.currentId=id;});},
    saveVehicle(input){return change(s=>{const existing=s.vehicles.find(v=>v.id===input.id);D.assert(!input.id||existing,'车辆不存在');const v=D.normalizeVehicle(Object.assign({},input,{id:input.id||uid('v')}),existing,s.records);if(existing)s.vehicles[s.vehicles.indexOf(existing)]=v;else s.vehicles.push(v);s.currentId=v.id;return v.id;});},
    archiveVehicle(id,archived){return change(s=>{const v=s.vehicles.find(x=>x.id===id);D.assert(v,'车辆不存在');v.archived=archived;if(archived&&s.currentId===id)s.currentId=(s.vehicles.find(x=>!x.archived)||{}).id||id;});},
    // An odometer reading without an expense becomes the vehicle's manual reading for today.
    updateMileage(id,value){return change(s=>{const v=s.vehicles.find(x=>x.id===id);D.assert(v&&!v.archived,'车辆不存在或已归档');const mileage=D.integer(String(value==null?'':value).replace(/[,，\s]/g,''),'当前里程'),now=D.currentMileage(v,s.records);D.assert(mileage>=now.mileage,`当前里程不能小于已记录的 ${now.mileage} km`);v.baseDate=D.today();v.baseMileage=mileage;D.validateTimeline(v,s.records);return mileage;});},
    saveRecord(input){return change(s=>{
      const old=s.records.find(r=>r.id===input.id);D.assert(!input.id||old,'记录不存在');
      const v=s.vehicles.find(x=>x.id===input.vehicleId);const r=D.normalizeRecord(Object.assign({},input,{id:input.id||uid('r')}),v);
      D.assert(!old||old.vehicleId===v.id,'不能移动记录到其他车辆');
      if(r.planId)D.assert(s.plans.some(p=>p.id===r.planId&&p.vehicleId===v.id),'关联计划不存在');
      if(old)s.records[s.records.indexOf(old)]=r;else s.records.push(r);
      D.validateTimeline(v,s.records);return r.id;
    });},
    deleteRecord(id){return change(s=>{const old=s.records.find(r=>r.id===id);D.assert(old,'记录不存在');D.assert(s.vehicles.some(v=>v.id===old.vehicleId&&!v.archived),'车辆不存在或已归档');s.records=s.records.filter(r=>r.id!==id);});},
    savePlan(input){return change(s=>{D.assert(s.vehicles.some(v=>v.id===input.vehicleId&&!v.archived),'车辆不存在或已归档');const old=s.plans.find(p=>p.id===input.id);D.assert(!input.id||old,'计划不存在');D.assert(!old||old.vehicleId===input.vehicleId,'不能移动计划到其他车辆');const p=D.normalizePlan(Object.assign({},input,{id:input.id||uid('p')}),input.vehicleId);if(old)s.plans[s.plans.indexOf(old)]=p;else s.plans.push(p);return p.id;});},
    deletePlan(id){return change(s=>{const old=s.plans.find(p=>p.id===id);D.assert(old,'计划不存在');D.assert(s.vehicles.some(v=>v.id===old.vehicleId&&!v.archived),'车辆不存在或已归档');s.plans=s.plans.filter(p=>p.id!==id);s.records.forEach(r=>{if(r.planId===id){r.planId='';r.complete=false;}});});}
  };
}
let instance;
function getStore(){if(!instance)instance=createStore({get:()=>wx.getStorageSync(KEY),set:s=>wx.setStorageSync(KEY,s)});return instance;}
module.exports={createStore,getStore,normalizeBackup};
