const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const U=require('../miniprogram/utils/ui');
// `raw` is the app data key; other keys (such as the last-backup marker) live in `side`. `answer` is what the next modal returns.
let raw='',side={},navigation=[],toasts=[],modals=[],files={},shared=[],scrolls=[],answer={confirm:true};
beforeEach(()=>{
 raw='';side={};navigation=[];toasts=[];modals=[];files={};shared=[];scrolls=[];answer={confirm:true};
 global.wx={pageScrollTo:o=>scrolls.push(o.selector),getStorageSync:key=>key==='car-miniapp:v1'?raw:(side[key]||''),setStorageSync:(key,v)=>{const copy=JSON.parse(JSON.stringify(v));if(key==='car-miniapp:v1')raw=copy;else side[key]=copy;},setNavigationBarTitle:()=>{},showToast:o=>toasts.push(o.title),navigateBack:()=>navigation.push('back'),navigateTo:o=>navigation.push(o.url),switchTab:o=>navigation.push(o.url),showModal:o=>{modals.push(o.content||o.placeholderText);o.success(answer);},
  env:{USER_DATA_PATH:'wxfile://usr'},getFileSystemManager:()=>({writeFileSync:(p,d)=>{files[p]=d;},readFileSync:p=>{if(!(p in files))throw Error('no such file');return files[p];}}),shareFileMessage:o=>{shared.push(o);o.success();},chooseMessageFile:o=>o.fail({errMsg:'chooseMessageFile:fail cancel'})};
});
// Registering a page runs its module once, like an app launch; opening creates an instance from that registration.
function definePage(name){let definition;global.Page=x=>{definition=x;};const file=require.resolve('../miniprogram/pages/'+name+'/index');delete require.cache[file];require(file);return definition;}
function openPage(definition,options={}){
 const page=Object.assign({},definition,{data:JSON.parse(JSON.stringify(definition.data)),setData(patch){Object.entries(patch).forEach(([key,value])=>{const parts=key.split('.');let target=this.data;while(parts.length>1){const part=parts.shift();target=target[part]||(target[part]={});}target[parts[0]]=value;});}});
 if(page.onLoad)page.onLoad(options);if(page.onShow)page.onShow();return page;
}
function loadPage(name,options={}){return openPage(definePage(name),options);}
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
test('新记录不预填里程而提示最近读数；日期在打开页面时取当天，跨零点不过期',()=>{
 const id=createCar(),RealDate=Date;let now=new RealDate(2026,10,8,23,50).getTime();
 global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
 try{
  const entry=definePage('entry'),vehicle=definePage('vehicle'),ledger=definePage('ledger');now=new RealDate(2026,10,9,0,20).getTime();
  const p=openPage(entry,{vehicleId:id});assert.equal(p.data.form.mileage,'');assert.equal(p.data.mileageHint,'最近读数 1000 km（2025-01-01）');assert.equal(p.data.form.date,'2026-11-09');assert.equal(p.data.today,'2026-11-09');
  const v=openPage(vehicle);assert.equal(v.data.form.baseDate,'2026-11-09');assert.equal(v.data.today,'2026-11-09');now=new RealDate(2026,11,1,0,5).getTime();assert.equal(openPage(ledger).data.month,'2026-12');
 }finally{global.Date=RealDate;}
});
test('账本合计随类型筛选变化；删除记录和计划提示已删除',()=>{
 const id=createCar('fuel'),today=U.D.today();U.getStore().saveRecord({vehicleId:id,kind:'fuel',date:today,mileage:'1200',amount:'300',quantity:'40',full:true});U.getStore().saveRecord({vehicleId:id,kind:'service',date:today,mileage:'1200',amount:'800'});
 const ledger=loadPage('ledger');assert.equal(ledger.data.count,2);assert.equal(ledger.data.amount,'1,100.00');ledger.filterChange({currentTarget:{dataset:{id:'fuel'}}});assert.equal(ledger.data.records.length,1);assert.equal(ledger.data.count,1);assert.equal(ledger.data.amount,'300.00');
 toasts=[];loadPage('entry',{id:raw.records[0].id}).remove();const pid=U.getStore().savePlan({vehicleId:id,name:'保养',dueMileage:'5000'});loadPage('plan',{id:pid}).remove();assert.deepEqual(toasts,['已删除','已删除']);
});
test('首页按紧急程度显示前两条计划；完成车险计划可记为其他费用并进入养护历史',()=>{
 const today=U.D.today(),later=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);},store=U.getStore();
 const id=store.saveVehicle({name:'车',type:'fuel',baseDate:today,baseMileage:'29990'});store.savePlan({vehicleId:id,name:'机油机滤',dueMileage:'30000'});const pid=store.savePlan({vehicleId:id,name:'车险续期',dueDate:later(20),intervalMonths:'12'});store.savePlan({vehicleId:id,name:'年检',dueDate:later(25)});
 const home=loadPage('home');assert.deepEqual(home.data.plans.map(p=>p.name),['机油机滤','车险续期']);assert.equal(home.data.plans[0].kmText,'还剩 10 km');
 const entry=loadPage('entry',{vehicleId:id,planId:pid});assert.deepEqual(entry.data.kinds.map(k=>k.id),['service','other']);entry.pickKind({currentTarget:{dataset:{index:1}}});entry.setData({'form.mileage':'29990','form.amount':'3800'});entry.save();
 assert.equal(raw.records[0].kind,'other');assert.equal(raw.records[0].complete,true);const care=loadPage('care');assert.equal(care.data.records.length,1);assert.equal(care.data.plans.find(p=>p.name==='车险续期').lastDate,today);
});
test('车库页导出备份并转发；恢复前校验并确认，替换数据后刷新页面',()=>{
 const id=createCar('fuel');U.getStore().saveRecord({vehicleId:id,kind:'fuel',date:'2025-01-02',mileage:'1200',amount:'300',quantity:'40',full:true});const saved=JSON.parse(JSON.stringify(raw)),garage=loadPage('garage');
 toasts=[];garage.exportBackup();assert.equal(shared.length,1);assert.match(shared[0].fileName,/^车小记备份-\d{4}-\d{2}-\d{2}\.json$/);assert.equal(JSON.parse(files[shared[0].filePath]).app,'car-miniapp');assert.deepEqual(toasts,['已导出']);
 U.getStore().deleteRecord(raw.records[0].id);U.getStore().saveVehicle({name:'第二辆',type:'ev',baseDate:'2025-01-01',baseMileage:'10'});
 wx.chooseMessageFile=o=>o.success({tempFiles:[{path:shared[0].filePath}]});garage.restoreBackup();
 assert.match(modals.at(-1),/含 1 辆车、1 条记录、0 个计划/);assert.match(modals.at(-1),/现有 2 辆车、0 条记录/);assert.deepEqual(raw,saved);assert.equal(garage.data.cars.length,1);assert.equal(toasts.at(-1),'已恢复');
});
test('选择无效文件、取消或接口失败时提示原因，不弹确认也不改数据',()=>{
 createCar();const before=JSON.parse(JSON.stringify(raw)),garage=loadPage('garage'),choose=path=>{wx.chooseMessageFile=o=>o.success({tempFiles:[{path}]});garage.restoreBackup();};
 files['wxfile://tmp/a.json']='not json';choose('wxfile://tmp/a.json');assert.match(garage.data.error,/无法读取/);
 files['wxfile://tmp/b.json']=JSON.stringify({app:'car-miniapp',version:1,vehicles:[],records:[],plans:[]});choose('wxfile://tmp/b.json');assert.match(garage.data.error,/没有车辆/);
 wx.chooseMessageFile=o=>o.fail({errMsg:'chooseMessageFile:fail cancel'});garage.restoreBackup();assert.equal(garage.data.error,'');
 wx.chooseMessageFile=o=>o.fail({errMsg:'chooseMessageFile:fail api scope is not declared in the privacy agreement'});garage.restoreBackup();assert.match(garage.data.error,/未能选择文件.*privacy/);
 wx.shareFileMessage=o=>o.fail({errMsg:'shareFileMessage:fail cancel'});garage.exportBackup();assert.equal(garage.data.error,'');
 assert.equal(modals.length,0);assert.deepEqual(raw,before);
});
test('新记录沿用上次的加满与充电完整选择，并提示上次充电后电量',()=>{
 const id=createCar();let entry=loadPage('entry',{vehicleId:id});assert.equal(entry.data.form.full,false);assert.equal(entry.data.form.confirmed,false);assert.equal(entry.data.socHint,'如 80');
 U.getStore().saveRecord({vehicleId:id,kind:'fuel',date:'2025-01-02',mileage:'1100',amount:'300',quantity:'40',full:true});U.getStore().saveRecord({vehicleId:id,kind:'charge',date:'2025-01-03',mileage:'1150',amount:'20',quantity:'30',socAfter:'80',confirmed:true});
 entry=loadPage('entry',{vehicleId:id});assert.equal(entry.data.form.full,true);assert.equal(entry.data.form.confirmed,true);assert.equal(entry.data.socHint,'上次充到 80%');
});
test('疑似录错时先确认：取消不保存，确认后保存',()=>{
 const id=createCar('fuel'),entry=loadPage('entry',{vehicleId:id});entry.setData({'form.date':'2025-01-02','form.mileage':'12000','form.amount':'300','form.quantity':'40','form.full':true});
 answer={confirm:false};entry.save();assert.match(modals.at(-1),/多出 11000 km/);assert.equal(raw.records.length,0);assert.equal(entry.data.saving,false);
 answer={confirm:true};entry.save();assert.equal(raw.records.length,1);
});
test('首页和统计页说明算不出油耗的原因；首页可直接更新里程',()=>{
 const id=createCar('fuel');let home=loadPage('home');assert.equal(home.data.metrics[1].value,'—');assert.match(home.data.metrics[1].note,/加满油后记一笔/);
 U.getStore().saveRecord({vehicleId:id,kind:'fuel',date:'2025-01-02',mileage:'1100',amount:'300',quantity:'40',full:true});home=loadPage('home');assert.match(home.data.metrics[1].note,/已有一次加满/);assert.match(loadPage('stats').data.energy[0].result.hint,/已有一次加满/);
 answer={confirm:true,content:'1,350'};home.updateMileage();assert.match(modals.at(-1),/上次 1100 km/);assert.equal(home.data.mileage.mileage,1350);assert.equal(raw.vehicles[0].baseMileage,1350);
});
test('新建计划可套用模板；车险需要选择实际到期日期',()=>{
 const id=createCar('ev'),plan=loadPage('plan',{vehicleId:id});assert.ok(!plan.data.presets.some(p=>p.name==='机油机滤'));
 plan.applyPreset({currentTarget:{dataset:{index:plan.data.presets.findIndex(p=>p.name==='轮胎换位')}}});assert.equal(plan.data.form.intervalKm,'10000');assert.equal(plan.data.form.dueMileage,'11000');assert.equal(plan.data.dateEnabled,false);plan.save();assert.equal(raw.plans[0].name,'轮胎换位');
 const next=loadPage('plan',{vehicleId:id});next.applyPreset({currentTarget:{dataset:{index:next.data.presets.findIndex(p=>p.name==='车险续期')}}});assert.equal(next.data.dateEnabled,true);assert.equal(next.data.form.dueDate,'');next.save();assert.match(next.data.error,/至少设置到期日期/);
 next.dateChange({detail:{value:'2026-12-31'}});next.save();assert.equal(raw.plans[1].intervalMonths,12);assert.equal(raw.plans[1].dueDate,'2026-12-31');
});
test('记录较多且没有备份时首页提醒；导出后车库页显示上次备份日期，提醒消失',()=>{
 const id=createCar('fuel');for(let i=0;i<10;i++)U.getStore().saveRecord({vehicleId:id,kind:'other',date:'2025-01-02',mileage:'',amount:'10'});
 assert.match(loadPage('home').data.backupNudge,/已有 10 条记录还没有备份过/);
 const garage=loadPage('garage');assert.equal(garage.data.backupAt,'');garage.exportBackup();assert.equal(garage.data.backupAt,U.D.today());assert.equal(loadPage('home').data.backupNudge,'');
});
test('账本和首页的记录显示单价与本箱油耗',()=>{
 const id=createCar('fuel'),store=U.getStore();store.saveRecord({vehicleId:id,kind:'fuel',date:'2025-01-02',mileage:'1100',amount:'300',quantity:'40',full:true});store.saveRecord({vehicleId:id,kind:'fuel',date:'2025-01-09',mileage:'1600',amount:'270',quantity:'36',full:true});
 const ledger=loadPage('ledger');ledger.monthChange({detail:{value:'2025-01'}});assert.equal(ledger.data.records[0].detail,'¥7.50/L · 油耗 7.20 L/100km');assert.equal(ledger.data.records[1].detail,'¥7.50/L');
 assert.equal(loadPage('home').data.recent[0].detail,'¥7.50/L · 油耗 7.20 L/100km');
});
test('填写金额和单价自动算出油量；手动改过油量后不再覆盖，清空后恢复',()=>{
 const id=createCar('fuel'),entry=loadPage('entry',{vehicleId:id}),type=(field,value)=>entry.input({currentTarget:{dataset:{field}},detail:{value}});
 type('amount','300');type('price','7.5');assert.equal(entry.data.form.quantity,'40.00');type('quantity','39.8');type('amount','299');assert.equal(entry.data.form.quantity,'39.8');type('quantity','');type('price','7.48');assert.equal(entry.data.form.quantity,'39.97');
});
test('其他费用可选类别；完成车险计划默认归为保险；账本标题显示类别',()=>{
 const id=createCar('fuel'),pid=U.getStore().savePlan({vehicleId:id,name:'车险续期',dueDate:'2025-02-01'});assert.equal(loadPage('entry',{vehicleId:id,planId:pid}).data.form.category,'保险');
 const entry=loadPage('entry',{vehicleId:id});entry.pickKind({currentTarget:{dataset:{index:entry.data.kinds.findIndex(k=>k.id==='other')}}});entry.pickCategory({currentTarget:{dataset:{value:'停车'}}});entry.setData({'form.date':'2025-01-02','form.amount':'15'});entry.save();
 assert.equal(raw.records[0].category,'停车');const ledger=loadPage('ledger');ledger.monthChange({detail:{value:'2025-01'}});assert.equal(ledger.data.records[0].title,'停车');
});
test('统计页：年度与累计、近 12 个月、日均里程与能源成本；多车时可看全部车辆合计；计划显示预计到达',()=>{
 const id=createCar('fuel'),store=U.getStore();store.saveRecord({vehicleId:id,kind:'fuel',date:'2025-01-02',mileage:'1100',amount:'300',quantity:'40',full:true});store.saveRecord({vehicleId:id,kind:'fuel',date:'2025-01-30',mileage:'1600',amount:'270',quantity:'36',full:true});
 const stats=loadPage('stats');stats.monthChange({detail:{value:'2025-01'}});
 assert.equal(stats.data.yearAmount,'570.00');assert.equal(stats.data.totalAmount,'570.00');assert.equal(stats.data.firstDate,'2025-01-02');assert.equal(stats.data.trend.length,12);assert.equal(stats.data.trend[11].percent,100);
 assert.equal(stats.data.miles.daily,20.7);assert.equal(stats.data.energy[0].result.costPerKm,'0.54');assert.equal(stats.data.energy[0].recent[0].rate,'7.20');assert.equal(stats.data.multi,false);
 const ev=store.saveVehicle({name:'电车',type:'ev',baseDate:'2025-01-01',baseMileage:'10'});store.saveRecord({vehicleId:ev,kind:'charge',date:'2025-01-05',mileage:'200',amount:'30',quantity:'40'});store.select(id);
 stats.onShow();assert.equal(stats.data.multi,true);stats.scopeChange({currentTarget:{dataset:{scope:'all'}}});assert.equal(stats.data.amount,'600.00');assert.equal(stats.data.energy.length,0);
 store.savePlan({vehicleId:id,name:'保养',dueMileage:'2000'});assert.match(loadPage('home').data.plans[0].predictText,/按日均 20.7 km 推算可能已到达/);
});
test('表单错误标在对应字段并滚动过去，修改后清除；程序错误只显示通用提示',()=>{
 const id=createCar('fuel'),entry=loadPage('entry',{vehicleId:id});entry.setData({'form.date':'2025-01-02','form.mileage':'1200','form.amount':'abc','form.quantity':'40'});entry.save();
 assert.equal(entry.data.errorField,'amount');assert.match(entry.data.error,/金额/);assert.deepEqual(scrolls,['#f-amount']);
 entry.input({currentTarget:{dataset:{field:'amount'}},detail:{value:'300'}});assert.equal(entry.data.errorField,'');
 entry.setData({'form.mileage':'900'});entry.save();assert.equal(entry.data.errorField,'mileage');assert.match(entry.data.error,/累计里程/);assert.equal(entry.data.saving,false);
 const home=loadPage('home'),log=console.error;console.error=()=>{};try{U.guard(home,()=>{throw new TypeError('boom');});}finally{console.error=log;}assert.match(home.data.error,/出了点问题/);assert.equal(home.data.errorField,'');
});
test('删除记录后可在列表页撤销；已完成计划折叠；新车显示开始使用清单；可转发小程序',()=>{
 const id=createCar('fuel'),store=U.getStore();let home=loadPage('home');assert.deepEqual(home.data.guide,{record:false,plan:false});assert.equal(home.onShareAppMessage().path,'/pages/home/index');
 store.saveRecord({vehicleId:id,kind:'fuel',date:'2025-01-02',mileage:'1100',amount:'300',quantity:'40',full:true});const pid=store.savePlan({vehicleId:id,name:'检查',dueDate:'2025-02-01'});
 loadPage('entry',{id:raw.records[0].id}).remove();const ledger=loadPage('ledger');assert.match(ledger.data.undo,/已删除「加油 ¥300\.00」/);ledger.undoDelete();assert.equal(raw.records.length,1);assert.equal(ledger.data.undo,'');assert.equal(loadPage('home').data.guide,null);
 const entry=loadPage('entry',{vehicleId:id,planId:pid});entry.setData({'form.date':'2025-01-03','form.mileage':'1150','form.amount':'0'});entry.save();
 const care=loadPage('care');assert.equal(care.data.plans.length,0);assert.equal(care.data.done.length,1);assert.equal(care.data.showDone,false);care.toggleDone();assert.equal(care.data.showDone,true);
});
test('编辑不重复的计划时周期显示为空；清空提前天数按默认值保存',()=>{
 const id=createCar(),pid=U.getStore().savePlan({vehicleId:id,name:'车险',dueDate:'2026-12-31'}),plan=loadPage('plan',{id:pid});
 assert.equal(plan.data.form.intervalMonths,'');assert.equal(plan.data.form.intervalKm,'');plan.setData({'form.leadDays':''});plan.save();assert.equal(raw.plans[0].leadDays,30);
});
test('所有页面含已绑定事件方法，导入模板可解析，空数据页面不报错',()=>{
 function sources(file){const text=fs.readFileSync(file,'utf8');let result=text;for(const m of text.matchAll(/<import\s+src="([^"]+)"/g))result+='\n'+sources(path.resolve(path.dirname(file),m[1]));return result;}
 for(const name of ['home','ledger','care','garage','stats','vehicle','entry','plan']){
  const p=loadPage(name);if(!['entry','plan'].includes(name))assert.equal(p.data.error,'');
  const source=sources(path.resolve(__dirname,'../miniprogram/pages',name,'index.wxml'));
  for(const m of source.matchAll(/bind(?:tap|input|change)="(\w+)"/g))assert.equal(typeof p[m[1]],'function',name+' missing '+m[1]);
 }
});
