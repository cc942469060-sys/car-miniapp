const D=require('./domain');
const KEY='car-miniapp:v1';
const clone=x=>JSON.parse(JSON.stringify(x));
function empty(){return {version:1,vehicles:[],records:[],plans:[],currentId:''};}
function createStore(storage){
  function read(){
    let raw;try{raw=storage.get();}catch(e){throw new Error('读取本地数据失败，请重新打开小程序');}
    if(raw===''||raw==null)return empty();
    D.assert(raw.version===1&&Array.isArray(raw.vehicles)&&Array.isArray(raw.records)&&Array.isArray(raw.plans),'本地数据格式不兼容，请勿清除缓存，先备份后恢复');
    return clone(raw);
  }
  function change(fn){const s=read();const result=fn(s);try{storage.set(s);}catch(e){throw new Error('保存失败，数据未更改。请检查设备存储空间后重试');}return result;}
  function uid(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);}
  return {
    read,
    select(id){return change(s=>{D.assert(s.vehicles.some(v=>v.id===id),'车辆不存在');s.currentId=id;});},
    saveVehicle(input){return change(s=>{const existing=s.vehicles.find(v=>v.id===input.id);D.assert(!input.id||existing,'车辆不存在');const v=D.normalizeVehicle(Object.assign({},input,{id:input.id||uid('v')}),existing,s.records);if(existing)s.vehicles[s.vehicles.indexOf(existing)]=v;else s.vehicles.push(v);s.currentId=v.id;return v.id;});},
    archiveVehicle(id,archived){return change(s=>{const v=s.vehicles.find(x=>x.id===id);D.assert(v,'车辆不存在');v.archived=archived;if(archived&&s.currentId===id)s.currentId=(s.vehicles.find(x=>!x.archived)||{}).id||id;});},
    saveRecord(input){return change(s=>{
      const old=s.records.find(r=>r.id===input.id);D.assert(!input.id||old,'记录不存在');
      const v=s.vehicles.find(x=>x.id===input.vehicleId);const r=D.normalizeRecord(Object.assign({},input,{id:input.id||uid('r')}),v);
      D.assert(!old||old.vehicleId===v.id,'不能移动记录到其他车辆');
      if(r.planId)D.assert(s.plans.some(p=>p.id===r.planId&&p.vehicleId===v.id),'关联计划不存在');
      if(old)s.records[s.records.indexOf(old)]=r;else s.records.push(r);
      D.validateTimeline(v,s.records);return r.id;
    });},
    deleteRecord(id){return change(s=>{D.assert(s.records.some(r=>r.id===id),'记录不存在');s.records=s.records.filter(r=>r.id!==id);});},
    savePlan(input){return change(s=>{D.assert(s.vehicles.some(v=>v.id===input.vehicleId&&!v.archived),'车辆不存在或已归档');const old=s.plans.find(p=>p.id===input.id);D.assert(!input.id||old,'计划不存在');D.assert(!old||old.vehicleId===input.vehicleId,'不能移动计划到其他车辆');const p=D.normalizePlan(Object.assign({},input,{id:input.id||uid('p')}),input.vehicleId);if(old)s.plans[s.plans.indexOf(old)]=p;else s.plans.push(p);return p.id;});},
    deletePlan(id){return change(s=>{s.plans=s.plans.filter(p=>p.id!==id);s.records.forEach(r=>{if(r.planId===id){r.planId='';r.complete=false;}});});}
  };
}
let instance;
function getStore(){if(!instance)instance=createStore({get:()=>wx.getStorageSync(KEY),set:s=>wx.setStorageSync(KEY,s)});return instance;}
module.exports={createStore,getStore};
