const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const U=require('../miniprogram/utils/ui');
let raw='',navigation=[];
beforeEach(()=>{
 raw='';navigation=[];
 global.wx={getStorageSync:()=>raw,setStorageSync:(key,v)=>{raw=JSON.parse(JSON.stringify(v));},setNavigationBarTitle:()=>{},showToast:()=>{},navigateBack:()=>navigation.push('back'),navigateTo:o=>navigation.push(o.url),switchTab:o=>navigation.push(o.url),showModal:o=>o.success({confirm:true})};
});
function loadPage(name,options={}){
 let definition;global.Page=x=>{definition=x;};const file=require.resolve('../miniprogram/pages/'+name+'/index');delete require.cache[file];require(file);
 const page=Object.assign({},definition,{data:JSON.parse(JSON.stringify(definition.data)),setData(patch){Object.entries(patch).forEach(([key,value])=>{const parts=key.split('.');let target=this.data;while(parts.length>1){const part=parts.shift();target=target[part]||(target[part]={});}target[parts[0]]=value;});}});
 if(page.onLoad)page.onLoad(options);if(page.onShow)page.onShow();return page;
}
function createCar(type='phev'){const p=loadPage('vehicle');p.setData({'form.name':'我的车','form.type':type,'form.baseDate':'2025-01-01','form.baseMileage':'1000'});p.save();assert.equal(p.data.error,'');return raw.vehicles[0].id;}
test('完整页面流程：建车、记账、防重复提交、账本编辑、刷新持久数据',()=>{
 const id=createCar();const entry=loadPage('entry',{vehicleId:id});entry.setData({'form.date':'2025-01-02','form.mileage':'1200','form.amount':'200','form.quantity':'25','form.full':true});entry.save();entry.save();assert.equal(raw.records.length,1);
 const ledger=loadPage('ledger');ledger.monthChange({detail:{value:'2025-01'}});assert.equal(ledger.data.count,1);assert.equal(ledger.data.amount,'200.00');ledger.openRecord({currentTarget:{dataset:{id:raw.records[0].id}}});assert.match(navigation.at(-1),/pages\/entry/);
 const edit=loadPage('entry',{id:raw.records[0].id});edit.setData({'form.amount':'180'});edit.save();ledger.onShow();assert.equal(ledger.data.amount,'180.00');assert.equal(raw.records.length,1);
 const home=loadPage('home');assert.equal(home.data.recent[0].amount,'180.00');
});
test('录入错误和存储失败保留输入并允许修正重试',()=>{
 const id=createCar('ev'),entry=loadPage('entry',{vehicleId:id});entry.setData({'form.amount':'12.345','form.quantity':'20','form.mileage':'1200'});entry.save();assert.match(entry.data.error,/两位小数/);assert.equal(entry.data.form.amount,'12.345');assert.equal(entry.data.saving,false);
 entry.setData({'form.amount':'12.34'});const save=wx.setStorageSync;wx.setStorageSync=()=>{throw Error('quota');};entry.save();assert.match(entry.data.error,/保存失败/);assert.equal(raw.records.length,0);assert.equal(entry.data.form.amount,'12.34');wx.setStorageSync=save;entry.save();assert.equal(raw.records.length,1);
});
test('计划完成、到期顺延、删除费用后恢复提醒',()=>{
 const id=createCar();const plan=loadPage('plan',{vehicleId:id});plan.setData({'form.name':'机油机滤','form.dueDate':'2025-02-01','form.dueMileage':'2000','form.intervalMonths':'6','form.intervalKm':'5000'});plan.save();const pid=raw.plans[0].id;
 const entry=loadPage('entry',{vehicleId:id,planId:pid});assert.equal(entry.data.form.kind,'service');entry.setData({'form.date':'2025-01-31','form.mileage':'1800','form.amount':'300'});entry.save();let care=loadPage('care');assert.equal(care.data.plans[0].dueDate,'2025-07-31');assert.equal(care.data.plans[0].dueMileage,6800);
 const edit=loadPage('entry',{id:raw.records[0].id});edit.remove();care.onShow();assert.equal(care.data.plans[0].dueDate,'2025-02-01');assert.equal(raw.records.length,0);
});
test('四种车辆切换后页面、表单与费用隔离，归档可恢复',()=>{
 const ids=U.D.TYPES.map(t=>U.getStore().saveVehicle({name:t.name,type:t.id,baseDate:'2025-01-01',baseMileage:'1000'}));
 ids.forEach((id,i)=>{U.getStore().select(id);const p=loadPage('entry',{vehicleId:id});assert.deepEqual(p.data.kinds.map(k=>k.id),U.D.allowedKinds(raw.vehicles[i]));for(const name of ['home','ledger','care','garage','stats']){const view=loadPage(name);assert.equal(view.data.error,'');assert.equal(view.data.vehicle.id,id);}});
 const garage=loadPage('garage');garage.archive({currentTarget:{dataset:{id:ids[3],archived:false}}});assert.equal(raw.vehicles[3].archived,true);garage.archive({currentTarget:{dataset:{id:ids[3],archived:true}}});assert.equal(raw.vehicles[3].archived,false);
});
test('所有页面含已绑定事件方法，导入模板可解析，空数据页面不报错',()=>{
 function sources(file){const text=fs.readFileSync(file,'utf8');let result=text;for(const m of text.matchAll(/<import\s+src="([^"]+)"/g))result+='\n'+sources(path.resolve(path.dirname(file),m[1]));return result;}
 for(const name of ['home','ledger','care','garage','stats','vehicle','entry','plan']){
  const p=loadPage(name);if(!['entry','plan'].includes(name))assert.equal(p.data.error,'');
  const source=sources(path.resolve(__dirname,'../miniprogram/pages',name,'index.wxml'));
  for(const m of source.matchAll(/bind(?:tap|input|change)="(\w+)"/g))assert.equal(typeof p[m[1]],'function',name+' missing '+m[1]);
 }
});
