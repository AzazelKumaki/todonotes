/* 回收站自动清理（FR-404）
   口径：超过 30 天真删；每月最多扫一次；没有删除时间的老数据**永远不删**（保守，宁留不误删） */
const app = require('./harness.js')();
const ok = (l,c,e) => { console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):'')); if(!c) process.exitCode=1; };

const fmt = n => { const d=new Date(); d.setDate(d.getDate()+n);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' 09:00'; };
const mk = (id, daysAgo, hasAt) => {
  const t={id, title:'测试'+id, done:false, domain:'work', deleted:true, manual:{}};
  if(hasAt!==false) t.deletedAt = fmt(-daysAgo);
  return t;
};

(async () => {
  console.log('【1】到期条目被真删，没到期的留着');
  app.todos.length = 0;
  app.todos.push(mk(1,31), mk(2,31), mk(3,10), mk(9,40));
  app.DB.lastPurge = '';
  const n = app.TRASH.purge();
  const ids = app.todos.map(t=>t.id);
  ok('清掉了 3 条超期的', n===3, '清掉 '+n+' 条');
  ok('31 天前的没了', ids.indexOf(1)<0 && ids.indexOf(2)<0);
  ok('40 天前的没了', ids.indexOf(9)<0);
  ok('10 天前的还在（还能恢复）', ids.indexOf(3)>=0, '剩下 '+ids.join(','));

  console.log('\n【2】本月扫过就不再扫（不拖慢开机）');
  const again = app.TRASH.purge();
  ok('第二次直接跳过', again===0, String(again));
  ok('记了本月已扫', app.DB.lastPurge.slice(0,7)===app.TODAY.slice(0,7), app.DB.lastPurge);

  console.log('\n【3】没有删除时间的老数据：留着不动');
  app.todos.length = 0;
  app.todos.push(mk(4,50,false));           /* 老版本删的，没记时间 */
  app.DB.lastPurge = '';
  const n2 = app.TRASH.purge();
  ok('一条都没删', n2===0 && app.todos.length===1, '剩 '+app.todos.length+' 条');

  console.log('\n【4】正常条目不受影响');
  app.todos.length = 0;
  app.todos.push({id:5,title:'正常待办',deleted:false,deletedAt:fmt(-100),domain:'work',manual:{}});
  app.DB.lastPurge = '';
  const n3 = app.TRASH.purge();
  ok('没被误伤', n3===0 && app.todos.length===1);

  console.log('\n【5】删除的分界点：30 天刚好留，再多一天就删');
  app.todos.length = 0;
  app.todos.push(mk(6,29), mk(7,30), mk(8,31));
  app.DB.lastPurge = '';
  app.TRASH.purge();
  const left = app.todos.map(t=>t.id);
  ok('29 / 30 天留着', left.indexOf(6)>=0 && left.indexOf(7)>=0, '剩下 '+left.join(','));
  ok('31 天删掉', left.indexOf(8)<0);

  console.log('\n【6】删除时要记下真实删除时刻');
  app.todos.length = 0;
  app.todos.push({id:11,title:'待会删',done:false,deleted:false,domain:'work',manual:{}});
  app.S.detailId = 11;
  app.handleAct({ target:{ closest(){ return {dataset:{act:'del'}}; } } });
  ok('删除即写入 deletedAt', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(app.todos[0].deletedAt||''), app.todos[0].deletedAt);
  ok('进回收站了', app.todos[0].deleted===true);
})();
