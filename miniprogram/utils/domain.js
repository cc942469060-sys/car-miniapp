const TYPES = [
  { id: 'fuel', name: '燃油车', fuel: true, charge: false },
  { id: 'hev', name: '非插电混动 HEV', fuel: true, charge: false },
  { id: 'phev', name: '插混 / 增程', fuel: true, charge: true },
  { id: 'ev', name: '纯电车', fuel: false, charge: true }
];
const KINDS = { fuel: '加油', charge: '充电', service: '保养', other: '其他费用' };
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function assert(ok, message) { if (!ok) throw new Error(message); }
function validDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false; const d = new Date(s+'T00:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s; }
function integer(value, label, max = 9999999) { assert(String(value).trim() !== '' && /^\d+$/.test(String(value)), `${label}请输入非负整数`); const n = Number(value); assert(Number.isSafeInteger(n) && n <= max, `${label}超出范围`); return n; }
function fixed(value, label, positive = false) { assert(/^\d+(\.\d{1,2})?$/.test(String(value)), `${label}请输入最多两位小数的数字`); const n = Math.round(Number(value)*100); assert(Number.isSafeInteger(n) && n <= 999999999 && (positive ? n > 0 : n >= 0), `${label}超出范围`); return n; }
function money(cents) { return (cents/100).toFixed(2); }
function typeOf(v) { return TYPES.find(t => t.id === v.type); }
function allowedKinds(v) { const t = typeOf(v); return [ ...(t.fuel ? ['fuel'] : []), ...(t.charge ? ['charge'] : []), 'service', 'other' ]; }
function currentMileage(v, records) { return records.filter(r=>r.vehicleId===v.id).reduce((a,r)=> r.date > a.date || (r.date === a.date && r.mileage > a.mileage) ? { date:r.date, mileage:r.mileage } : a, {date:v.baseDate,mileage:v.baseMileage}); }
function validateTimeline(v, records) {
  const points = [{date:v.baseDate,mileage:v.baseMileage}].concat(records.filter(r=>r.vehicleId===v.id));
  points.sort((a,b)=>a.date.localeCompare(b.date)||a.mileage-b.mileage);
  for(let i=1;i<points.length;i++) assert(points[i].mileage >= points[i-1].mileage, '累计里程与相邻日期的记录冲突，请核对日期和里程');
}
function normalizeVehicle(input, existing, records) {
  const name = String(input.name || '').trim(); assert(name && name.length <= 30, '车辆昵称必填，最多 30 字');
  assert(TYPES.some(t=>t.id===input.type), '请选择能源类型');
  assert(validDate(input.baseDate) && input.baseDate <= today(), '里程日期无效或晚于今天');
  const v = { id:existing ? existing.id : input.id, name, type:input.type, model:String(input.model||'').trim().slice(0,50), baseDate:input.baseDate, baseMileage:integer(input.baseMileage,'累计里程'), archived:existing ? existing.archived : false };
  assert(!records.some(r=>r.vehicleId===v.id && !allowedKinds(v).includes(r.kind)), '已有与该能源类型不兼容的记录，暂不能切换能源类型');
  validateTimeline(v,records); return v;
}
function normalizeRecord(input, v) {
  assert(v && !v.archived, '车辆不存在或已归档'); assert(allowedKinds(v).includes(input.kind), '该车辆不支持此记录类型');
  assert(validDate(input.date) && input.date <= today(), '记录日期无效或晚于今天');
  const r = { id:input.id, vehicleId:v.id, kind:input.kind, date:input.date, mileage:integer(input.mileage,'累计里程'), cents:fixed(input.amount,'金额'), note:String(input.note||'').trim().slice(0,120), planId:input.planId||'', complete:!!input.complete };
  if (r.kind === 'fuel' || r.kind === 'charge') { r.quantity100 = fixed(input.quantity,'补能量',true); r.gap = !!input.gap; }
  if (r.kind === 'fuel') r.full = !!input.full;
  if (r.kind === 'charge') {
    r.socAfter = input.socAfter === '' || input.socAfter == null ? null : integer(input.socAfter,'充电后电量',100);
    r.confirmed = !!input.confirmed;
  }
  assert(!r.complete || r.kind === 'service', '只有保养记录可完成养护计划');
  return r;
}
// Only completed, explicitly valid intervals contribute; never average interval rates directly.
function energyIntervals(records, kind) {
  const sorted = records.filter(r=>r.kind===kind).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.mileage-b.mileage||a.id.localeCompare(b.id));
  let anchor=null, quantity=0, broken=false; const intervals=[];
  sorted.forEach(r=>{
    const endpoint = kind==='fuel' ? r.full : r.socAfter != null;
    if(anchor) {
      quantity += r.quantity100; broken = broken || r.gap || (kind==='charge' && !r.confirmed);
      if(endpoint) {
        const km = r.mileage-anchor.mileage;
        const comparable = kind==='fuel' || r.socAfter===anchor.socAfter;
        if(!broken && comparable && km>0) intervals.push({from:anchor.date,to:r.date,km,quantity100:quantity});
        anchor=r;quantity=0;broken=false;
      }
    } else if(endpoint) anchor=r;
  });
  const km=intervals.reduce((s,x)=>s+x.km,0), q=intervals.reduce((s,x)=>s+x.quantity100,0);
  return { intervals, km, rate:km ? (q/km).toFixed(2) : null };
}
function statistics(records, month) {
  const filtered=records.filter(r=>r.date.slice(0,7)===month), categories=Object.keys(KINDS).map(kind=>({kind,name:KINDS[kind],cents:filtered.filter(r=>r.kind===kind).reduce((s,r)=>s+r.cents,0)}));
  return { total:filtered.reduce((s,r)=>s+r.cents,0), count:filtered.length, fuel:filtered.filter(r=>r.kind==='fuel').reduce((s,r)=>s+r.quantity100,0), charge:filtered.filter(r=>r.kind==='charge').reduce((s,r)=>s+r.quantity100,0), categories };
}
function addMonths(date, count) { const [y,m,d]=date.split('-').map(Number); const end=new Date(Date.UTC(y,m-1+count+1,0)).getUTCDate(); return new Date(Date.UTC(y,m-1+count,Math.min(d,end))).toISOString().slice(0,10); }
function normalizePlan(input, vehicleId) {
  const name=String(input.name||'').trim(); assert(name && name.length<=40,'项目名称必填，最多 40 字');
  assert(!input.dueDate||validDate(input.dueDate),'到期日期无效');
  const optional=(val,label)=> val===''||val==null ? null : integer(val,label);
  const p={id:input.id,vehicleId,name,dueDate:input.dueDate||'',dueMileage:optional(input.dueMileage,'到期里程'),intervalMonths:optional(input.intervalMonths,'重复月数')||0,intervalKm:optional(input.intervalKm,'重复公里数')||0,leadDays:integer(input.leadDays==null?30:input.leadDays,'提前天数',365),leadKm:integer(input.leadKm==null?500:input.leadKm,'提前公里数')};
  assert(p.dueDate || p.dueMileage!==null,'请至少设置到期日期或到期里程');
  assert(p.intervalMonths<=120,'重复周期不能超过 120 个月'); return p;
}
function daysBetween(a,b){return Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);}
function reminder(plan, records, mileage, asOf=today()) {
  const completions=records.filter(r=>r.planId===plan.id && r.complete).sort((a,b)=>b.date.localeCompare(a.date)||b.mileage-a.mileage||b.id.localeCompare(a.id));
  const last=completions[0]; let dueDate=plan.dueDate,dueMileage=plan.dueMileage;
  if(last) { dueDate=plan.intervalMonths ? addMonths(last.date,plan.intervalMonths) : ''; dueMileage=plan.intervalKm ? last.mileage+plan.intervalKm : null; }
  const days=dueDate?daysBetween(dueDate,asOf):null, km=dueMileage==null?null:dueMileage-mileage.mileage;
  let status='正常',rank=3;
  if(last && !dueDate && dueMileage==null){status='已完成';rank=4;}
  else if((days!==null&&days<=0)||(km!==null&&km<=0)){status='已到期';rank=0;}
  else if((days!==null&&days<=plan.leadDays)||(km!==null&&km<=plan.leadKm)){status='即将到期';rank=1;}
  const stale=dueMileage!==null&&daysBetween(asOf,mileage.date)>30;
  if(stale && rank===3){status='里程待更新';rank=2;}
  return Object.assign({},plan,{dueDate,dueMileage,status,rank,days,km,stale,lastDate:last?last.date:''});
}
module.exports={TYPES,KINDS,today,assert,validDate,integer,fixed,money,typeOf,allowedKinds,currentMileage,validateTimeline,normalizeVehicle,normalizeRecord,energyIntervals,statistics,normalizePlan,reminder,addMonths};
