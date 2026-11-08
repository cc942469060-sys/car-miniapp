const U=require('../../utils/ui');
Page(Object.assign({},U.common,{
 data:{month:'',filter:'all',error:''},
 onLoad(){this.setData({month:U.D.today().slice(0,7)});},
 onShow(){U.guard(this,()=>{const x=U.base();if(!x.v){this.setData(x.data);return;}const allowed=U.D.allowedKinds(x.v),filter=allowed.includes(this.data.filter)?this.data.filter:'all',records=x.records.filter(r=>r.date.slice(0,7)===this.data.month&&(filter==='all'||r.kind===filter));this.setData(Object.assign(x.data,{filter,filters:[{id:'all',name:'全部'}].concat(allowed.map(id=>({id,name:U.D.KINDS[id]}))),records:records.map(U.recordView),amount:U.D.money(records.reduce((s,r)=>s+r.cents,0)),count:records.length}));});},
 monthChange(e){this.setData({month:e.detail.value});this.onShow();},filterChange(e){this.setData({filter:e.currentTarget.dataset.id});this.onShow();}
}));
