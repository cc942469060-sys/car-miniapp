const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{month:U.D.today().slice(0,7),filter:'all',error:''},
 onShow(){U.guard(this,()=>{const x=U.base();if(!x.v){this.setData(x.data);return;}const allowed=U.D.allowedKinds(x.v),filter=allowed.includes(this.data.filter)?this.data.filter:'all',stats=U.D.statistics(x.records,this.data.month);this.setData(Object.assign(x.data,{filter,filters:[{id:'all',name:'全部'}].concat(allowed.map(id=>({id,name:U.D.KINDS[id]}))),records:x.records.filter(r=>r.date.slice(0,7)===this.data.month&&(filter==='all'||r.kind===filter)).map(U.recordView),amount:U.D.money(stats.total),count:stats.count}));});},
 monthChange(e){this.setData({month:e.detail.value});this.onShow();},filterChange(e){this.setData({filter:e.currentTarget.dataset.id});this.onShow();}
}));
