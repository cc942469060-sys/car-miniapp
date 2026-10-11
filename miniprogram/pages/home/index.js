const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
  data:{error:''},
  onShow(){U.guard(this,()=>{const x=U.base();if(!x.v){this.setData(x.data);return;}const stats=U.D.statistics(x.records,U.D.today().slice(0,7)),type=U.D.typeOf(x.v);this.setData(Object.assign(x.data,{month:U.D.today().slice(0,7),amount:U.D.money(stats.total),count:stats.count,metrics:[...(type.fuel?[{label:'本月加油量',value:(stats.fuel/100).toFixed(2),unit:'L',note:'按实际记录累计'}]:[]),...(type.charge?[{label:'本月充电量',value:(stats.charge/100).toFixed(2),unit:'kWh',note:'账单充入电量'}]:[]),...(!(type.fuel&&type.charge)?[{label:type.fuel?'完整区间油耗':'充电侧区间电耗',value:U.D.energyIntervals(x.records,type.fuel?'fuel':'charge').rate||'—',unit:type.fuel?'L/100km':'kWh/100km',note:'历史完整区间 · 详见统计'}]:[])],recent:x.records.slice(0,3).map(U.recordView),plans:x.plans.filter(p=>p.status!=='已完成').slice(0,2)}));});}
}));
