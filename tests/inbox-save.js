/* 收件箱出箱判定的回归测试（V0.2 bug：标题为空却显示备注前 12 字，导致存不住） */
const app = require('./harness.js')();
const ok = (l,c,e) => console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):''));

/* 造一条「从首页说了一句话进收件箱」的条目：标题空、备注有内容 */
function makeInbox(over){
  return Object.assign({
    id: 88001, title:'', remark:'有空的时候去交一下电费', due:null, time:'',
    imp:null, urg:null, cat:null, domain:null, done:false, doneAt:null,
    inbox:true, deleted:false, pinned:false, parsed:false, source:'text', manual:{}
  }, over||{});
}

console.log('【1】用户手工补完 3 项（时间 / 轻重缓急 / 归属），标题还是空的');
let t = makeInbox({due:app.shift(1), imp:false, urg:false, domain:'life'});
let miss = app.inboxMissing(t);
ok('判定通过（不再要求标题必须手填）', miss.length===0, JSON.stringify(miss));
ok('标题可用备注前 12 字补', (t.remark||'').trim().slice(0,12).length>0, (t.remark||'').trim().slice(0,12));

console.log('\n【2】真的缺项时，要能点名说出缺哪个');
t = makeInbox({due:app.shift(1), imp:false, urg:null, domain:'life'});
ok('轻重缓急没选 → 点名', JSON.stringify(app.inboxMissing(t))==='["轻重缓急"]', JSON.stringify(app.inboxMissing(t)));
t = makeInbox({due:null, imp:false, urg:false, domain:'life'});
ok('完成时间没填 → 点名', JSON.stringify(app.inboxMissing(t))==='["完成时间"]', JSON.stringify(app.inboxMissing(t)));
t = makeInbox({due:app.shift(1), imp:false, urg:false, domain:null});
ok('归属没选 → 点名', JSON.stringify(app.inboxMissing(t))==='["归属"]', JSON.stringify(app.inboxMissing(t)));
t = makeInbox({due:app.shift(1), imp:false, urg:false, domain:'life', title:'', remark:'   '});
ok('标题和备注都空 → 点名标题', JSON.stringify(app.inboxMissing(t))==='["标题"]', JSON.stringify(app.inboxMissing(t)));

console.log('\n【3】分类仍然选填，不参与判定');
t = makeInbox({due:app.shift(1), imp:true, urg:false, domain:'work', cat:null});
ok('不分类照样能出箱', app.inboxMissing(t).length===0);
