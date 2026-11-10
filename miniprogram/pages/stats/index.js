const U=require('../../utils/ui');
// Bars are scaled to the largest value in the list, so the busiest month fills its row.
const bars=(items,key)=>{const max=Math.max(1,...items.map(i=>i[key]));return items.map(i=>Object.assign(i,{amount:U.D.yuan(i[key]),percent:Math.round(i[key]/max*100)}));};
Page(Object.assign({},U.common,{
 data:{month:'',scope:'vehicle',error:''},onLoad(){this.setData({month:U.D.today().slice(0,7)});},
 onShow(){U.guard(this,()=>{const x=U.base();if(!x.v){this.setData(x.data);return;}
  // 「全部车辆合计」 only adds up spending; consumption and mileage stay per vehicle.
  const multi=x.s.vehicles.length>1,all=multi&&this.data.scope==='all',records=all?x.s.records:x.records,type=U.D.typeOf(x.v),month=this.data.month,year=month.slice(0,4);
  const stats=U.D.statistics(records,month),yearStats=U.D.statistics(records,year),kinds=all?Object.keys(U.D.KINDS):U.D.allowedKinds(x.v),miles=U.D.mileageStats(x.v,x.records);
  const energy=all?[]:[...(type.fuel?[{name:type.charge?'混合用车区间 · 燃油':'完整区间油耗',unit:'L/100km',result:U.D.energyIntervals(x.records,'fuel')}]:[]),...(type.charge?[{name:type.fuel?'混合用车区间 · 电量':'充电侧区间电耗',unit:'kWh/100km',result:U.D.energyIntervals(x.records,'charge')}]:[])];
  this.setData(Object.assign(x.data,{multi,scope:all?'all':'vehicle',amount:U.D.yuan(stats.total),
   categories:stats.categories.filter(c=>kinds.includes(c.kind)).map(c=>Object.assign(c,{amount:U.D.yuan(c.cents),percent:stats.total?Math.round(c.cents/stats.total*100):0})),others:stats.others.map(o=>`${o.name} ¥${U.D.yuan(o.cents)}`).join(' · '),
   year,yearAmount:U.D.yuan(yearStats.total),yearCount:yearStats.count,totalAmount:U.D.yuan(records.reduce((s,r)=>s+r.cents,0)),firstDate:records.reduce((a,r)=>!a||r.date<a?r.date:a,''),trend:bars(U.D.monthlyTrend(records,month),'cents'),
   miles:miles.dailyKm?{daily:miles.dailyKm,yearly:Math.round(miles.dailyKm*365/100)*100,from:miles.from,to:miles.to}:null,
   energy:energy.map(e=>Object.assign(e,{recent:e.result.intervals.slice(-5).reverse()}))}));});},
 monthChange(e){this.setData({month:e.detail.value});this.onShow();},
 scopeChange(e){this.setData({scope:e.currentTarget.dataset.scope});this.onShow();}
}));
