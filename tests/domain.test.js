const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../miniprogram/utils/domain');
const {createStore}=require('../miniprogram/utils/store');
function fixture(){let data='',fail=false;return {store:createStore({get:()=>data,set:v=>{if(fail)throw Error('quota');data=JSON.parse(JSON.stringify(v));}}),fail:()=>{fail=true;}};}
function car(store,type='phev'){return store.saveVehicle({name:'测试车',type,baseDate:'2025-01-01',baseMileage:'1000'});}
function record(store,vehicleId,overrides={}){return store.saveRecord(Object.assign({vehicleId,kind:'fuel',date:'2025-01-02',mileage:'1100',amount:'100.20',quantity:'20.00',full:true},overrides));}
test('满箱法包含中途未满箱和终点，排除起点油量，并按里程加权',()=>{
 const rows=[{id:'a',kind:'fuel',date:'2025-01-01',mileage:1000,quantity100:4000,full:true},{id:'b',kind:'fuel',date:'2025-01-03',mileage:1200,quantity100:1000,full:false},{id:'c',kind:'fuel',date:'2025-01-04',mileage:1500,quantity100:2000,full:true},{id:'d',kind:'fuel',date:'2025-01-07',mileage:2500,quantity100:8000,full:true}];
 const result=D.energyIntervals(rows,'fuel');assert.equal(result.intervals.length,2);assert.equal(result.km,1500);assert.equal(result.rate,'7.33');
});
test('漏记区间无油耗，下一完整区间可以恢复；单次满箱无油耗',()=>{
 const a={id:'a',kind:'fuel',date:'2025-01-01',mileage:1000,quantity100:2000,full:true};const b={...a,id:'b',date:'2025-01-02',mileage:1400,gap:true};const c={...a,id:'c',date:'2025-01-03',mileage:1800};
 assert.equal(D.energyIntervals([a],'fuel').rate,null);assert.equal(D.energyIntervals([a,b],'fuel').rate,null);assert.equal(D.energyIntervals([a,b,c],'fuel').rate,'5.00');
});
test('充电侧电耗要求相同 SOC、完整确认与有效里程',()=>{
 const a={id:'a',kind:'charge',date:'2025-01-01',mileage:1000,quantity100:4000,socAfter:80,confirmed:true};const b={...a,id:'b',date:'2025-01-03',mileage:1200,quantity100:3000};
 assert.equal(D.energyIntervals([a,b],'charge').rate,'15.00');
 for(const extra of [{socAfter:90},{socAfter:null},{confirmed:false},{gap:true},{mileage:1000}])assert.equal(D.energyIntervals([a,{...b,...extra}],'charge').rate,null);
});
test('充电区间可跨过不同 SOC 的中间充电，直到出现相同 SOC；改用新 SOC 后仍能成段',()=>{
 const a={id:'a',kind:'charge',date:'2025-01-01',mileage:1000,quantity100:3000,socAfter:80,confirmed:true},b={...a,id:'b',date:'2025-01-03',mileage:1150,quantity100:1500,socAfter:60},c={...a,id:'c',date:'2025-01-05',mileage:1300,quantity100:2000};
 assert.equal(D.energyIntervals([a,b,c],'charge').rate,'11.67');assert.equal(D.energyIntervals([a,b,{...c,socAfter:60,quantity100:2500}],'charge').rate,'16.67');assert.equal(D.energyIntervals([a,{...b,confirmed:false},c],'charge').rate,null);
});
test('与起点同里程的满箱记录并入下一区间，油量不丢失',()=>{
 const a={id:'a',kind:'fuel',date:'2025-01-01',mileage:1000,quantity100:4000,full:true},b={...a,id:'b',date:'2025-01-08',quantity100:2200},c={...a,id:'c',date:'2025-01-15',mileage:1600,quantity100:2300};
 assert.equal(D.energyIntervals([a,b],'fuel').rate,null);assert.equal(D.energyIntervals([a,b,c],'fuel').rate,'7.50');
});
test('金额与数量使用固定精度；无效金额与日期被拒绝',()=>{
 assert.equal(D.fixed('0.29','金额'),29);assert.equal(D.fixed('0','金额'),0);assert.throws(()=>D.fixed('1.001','金额'));assert.throws(()=>D.fixed('-1','金额'));assert.throws(()=>D.fixed('0','电量',true));assert.equal(D.validDate('2025-02-29'),false);assert.equal(D.validDate('2024-02-29'),true);
});
test('不同能源限制记录类型，且不允许切换到与现有记录冲突的类型',()=>{
 const {store}=fixture();const id=car(store,'hev');assert.throws(()=>record(store,id,{kind:'charge'}),/不支持/);record(store,id);
 assert.throws(()=>store.saveVehicle({id,name:'新名',type:'ev',baseDate:'2025-01-01',baseMileage:1000}),/不兼容/);
});
test('历史补录检查前后里程，失败时原数据不变',()=>{
 const {store}=fixture();const id=car(store);record(store,id,{date:'2025-01-05',mileage:1500});record(store,id,{date:'2025-01-03',mileage:1300});const before=store.read();
 assert.throws(()=>record(store,id,{date:'2025-01-04',mileage:1600}),/里程/);assert.deepEqual(store.read(),before);
 assert.throws(()=>record(store,id,{date:'2024-12-31',mileage:1100}),/里程/);
});
test('修改与删除记录会重新计算费用和当前里程，且按车隔离',()=>{
 const {store}=fixture(),id=car(store),id2=car(store,'ev');const rid=record(store,id);record(store,id2,{kind:'charge',amount:'50',quantity:'30'});
 record(store,id,{id:rid,amount:'200',mileage:1200});let s=store.read();assert.equal(D.statistics(s.records.filter(r=>r.vehicleId===id),'2025-01').total,20000);assert.equal(D.currentMileage(s.vehicles[0],s.records).mileage,1200);
 store.deleteRecord(rid);s=store.read();assert.equal(D.currentMileage(s.vehicles[0],s.records).mileage,1000);assert.equal(s.records.length,1);
});
test('日期或里程任一先到即提醒；里程过旧单独提示',()=>{
 const p=D.normalizePlan({id:'p',name:'保养',dueDate:'2025-03-01',dueMileage:2000,leadDays:10,leadKm:100},'v');
 assert.equal(D.reminder(p,[],{mileage:2100,date:'2025-02-01'},'2025-02-01').status,'已到期');assert.equal(D.reminder(p,[],{mileage:1000,date:'2025-03-01'},'2025-03-01').status,'已到期');assert.equal(D.reminder(p,[],{mileage:1950,date:'2025-02-01'},'2025-02-01').status,'即将到期');assert.equal(D.reminder(p,[],{mileage:1000,date:'2024-12-01'},'2025-02-01').status,'里程待更新');
});
test('保养计划从实际完成日期和里程顺延；删除完成记录恢复原计划',()=>{
 const {store}=fixture(),id=car(store);const pid=store.savePlan({vehicleId:id,name:'保养',dueDate:'2025-01-10',dueMileage:'1500',intervalMonths:'1',intervalKm:'5000'});const rid=record(store,id,{kind:'service',date:'2025-01-31',mileage:2000,planId:pid,complete:true,amount:'250'});let s=store.read(),p=s.plans[0];let result=D.reminder(p,s.records,{mileage:2000,date:'2025-01-31'},'2025-02-01');assert.equal(result.dueDate,'2025-02-28');assert.equal(result.dueMileage,7000);store.deleteRecord(rid);s=store.read();result=D.reminder(p,s.records,{mileage:1000,date:'2025-01-01'},'2025-02-01');assert.equal(result.dueDate,'2025-01-10');assert.equal(result.dueMileage,1500);
});
test('一次性计划完成、重复完成记录编辑及删除计划保留费用',()=>{
 const {store}=fixture(),id=car(store);const pid=store.savePlan({vehicleId:id,name:'检查',dueDate:'2025-02-01'});record(store,id,{kind:'service',planId:pid,complete:true});let s=store.read();assert.equal(D.reminder(s.plans[0],s.records,{mileage:1100,date:'2025-01-02'},'2025-02-01').status,'已完成');store.deletePlan(pid);s=store.read();assert.equal(s.records.length,1);assert.equal(s.records[0].planId,'');assert.equal(s.plans.length,0);
});
test('归档保留历史、禁止新增、可恢复；本地写入失败不提交',()=>{
 const fx=fixture(),id=car(fx.store);record(fx.store,id);fx.store.archiveVehicle(id,true);assert.throws(()=>record(fx.store,id),/归档/);assert.equal(fx.store.read().records.length,1);fx.store.archiveVehicle(id,false);const before=fx.store.read();fx.fail();assert.throws(()=>record(fx.store,id),/保存失败/);assert.deepEqual(fx.store.read(),before);
});
test('未关联计划的其他费用可不填里程且不参与里程校验；保养与计划完成仍需里程',()=>{
 const {store}=fixture(),id=car(store);record(store,id,{date:'2025-01-10',mileage:'1500'});const rid=record(store,id,{kind:'other',date:'2025-01-05',mileage:'',amount:'15'});let s=store.read();
 assert.equal(s.records.find(r=>r.id===rid).mileage,null);assert.equal(D.currentMileage(s.vehicles[0],s.records).mileage,1500);assert.throws(()=>record(store,id,{kind:'service',date:'2025-01-05',mileage:''}),/里程/);
 const pid=store.savePlan({vehicleId:id,name:'车险续期',dueDate:'2025-02-01'});assert.throws(()=>record(store,id,{kind:'other',planId:pid,complete:true,mileage:''}),/里程/);
});
test('其他费用可以完成计划并计入其他费用；补能记录不能完成计划',()=>{
 const {store}=fixture(),id=car(store);const pid=store.savePlan({vehicleId:id,name:'车险续期',dueDate:'2025-02-01',intervalMonths:'12'});record(store,id,{kind:'other',date:'2025-01-20',mileage:'1100',amount:'3800',planId:pid,complete:true});const s=store.read(),st=D.statistics(s.records,'2025-01');
 assert.equal(D.reminder(s.plans[0],s.records,{mileage:1100,date:'2025-01-20'},'2025-01-21').dueDate,'2026-01-20');assert.equal(st.categories.find(c=>c.kind==='other').cents,380000);assert.equal(st.categories.find(c=>c.kind==='service').cents,0);
 assert.throws(()=>record(store,id,{planId:pid,complete:true}),/保养或其他费用/);
});
test('计划按剩余量占提前量的比例排序，并给出剩余天数与公里数',()=>{
 const p=D.normalizePlan({id:'p',name:'保养',dueMileage:2000,leadKm:500},'v'),q=D.normalizePlan({id:'q',name:'车险',dueDate:'2025-02-21',leadDays:30},'v'),now={mileage:1990,date:'2025-02-01'};
 const a=D.reminder(p,[],now,'2025-02-01'),b=D.reminder(q,[],now,'2025-02-01');assert.equal(a.status,'即将到期');assert.equal(b.status,'即将到期');assert.ok(a.urgency<b.urgency);assert.equal(a.kmText,'还剩 10 km');assert.equal(b.daysText,'还剩 20 天');
 assert.equal(D.reminder(q,[],now,'2025-02-21').daysText,'今天到期');assert.equal(D.reminder(p,[],{mileage:2100,date:'2025-02-01'},'2025-02-01').kmText,'已超 100 km');
});
test('归档车辆的记录和计划不能删除，恢复后可以',()=>{
 const {store}=fixture(),id=car(store);const rid=record(store,id),pid=store.savePlan({vehicleId:id,name:'保养',dueMileage:'5000'});store.archiveVehicle(id,true);
 assert.throws(()=>store.deleteRecord(rid),/归档/);assert.throws(()=>store.deletePlan(pid),/归档/);assert.equal(store.read().records.length,1);assert.equal(store.read().plans.length,1);
 store.archiveVehicle(id,false);store.deleteRecord(rid);store.deletePlan(pid);assert.equal(store.read().records.length,0);assert.equal(store.read().plans.length,0);
});
test('不兼容缓存必须保留，不能静默重置',()=>{
 let writes=0;const store=createStore({get:()=>({version:99}),set:()=>writes++});assert.throws(()=>store.read(),/不兼容/);assert.throws(()=>car(store),/不兼容/);assert.equal(writes,0);
});
