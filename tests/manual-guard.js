/* 回归：手动填过的字段，重新解析不许被覆盖（用户报的 bug：手填的时间一解析就没了） */
const app = require('./harness.js')();
const ok = (l,c,e) => console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):''));

function mkTodo(over){
  return Object.assign({id:90001, title:'', remark:'明天下午3点前把季度报表交给王总',
    due:null, time:'', imp:null, urg:null, cat:null, domain:'work',
    inbox:true, deleted:false, done:false, doneAt:null, pinned:false,
    createdAt:'2026-10-15 09:00', updatedAt:'2026-10-15 09:00',
    source:'text', manual:{}, parsed:false}, over||{});
}
/* AI 解析出来的结果 */
const AI = {title:'把季度报表交给王总', due:'2026-10-20', time:'15:00', dueText:'10月20日 15:00',
            imp:true, urg:false, cat:'报表材料', domain:'work'};

console.log('【1】手动填了时间 → 再解析，时间不能变');
let t = mkTodo({due:'2026-10-18', time:'09:30', manual:{due:true, time:true}});
app.applyParse(t, AI);
ok('时间保持手填值', t.due==='2026-10-18' && t.time==='09:30', t.due+' '+t.time);
ok('标题仍可被补全', t.title==='把季度报表交给王总', t.title);

console.log('\n【2】手动填了轻重缓急 → 再解析，象限不能变');
t = mkTodo({imp:false, urg:false, manual:{imp:true, urg:true}});
app.applyParse(t, AI);
ok('重要/紧急保持手填', t.imp===false && t.urg===false, 'imp='+t.imp+' urg='+t.urg);

console.log('\n【3】手动选了分类 → 再解析，分类不能变');
t = mkTodo({cat:'临时插单', manual:{cat:true}});
app.applyParse(t, AI);
ok('分类保持手填', t.cat==='临时插单', t.cat);

console.log('\n【4】什么都没手动填 → 全部照解析结果写');
t = mkTodo();
app.applyParse(t, AI);
ok('时间写入', t.due==='2026-10-20' && t.time==='15:00', t.due+' '+t.time);
ok('象限写入', t.imp===true && t.urg===false);
ok('分类写入', t.cat==='报表材料', t.cat);
ok('标记已解析', t.parsed===true);

console.log('\n【5】keepManual：重新解析时把手动项带回来');
const oldP = {title:'', due:'2026-10-18', time:'09:30', imp:null, urg:null, cat:null,
              domain:'work', manual:{due:true, time:true}};
const newP = app.keepManual(oldP, Object.assign({}, AI));
ok('手填的时间被带回来', newP.due==='2026-10-18' && newP.time==='09:30', newP.due+' '+newP.time);
ok('非手填的仍用新结果', newP.title==='把季度报表交给王总', newP.title);
ok('手填标记也跟着走', newP.manual.due===true && app.manualCount(newP)===2, '共 '+app.manualCount(newP)+' 项受保护');

console.log('\n【6】只手填了时间、没手填标题 → 标题要能被补上');
t = mkTodo({due:'2026-10-18', manual:{due:true}});
app.applyParse(t, AI);
ok('时间不动', t.due==='2026-10-18', t.due);
ok('标题补上', t.title==='把季度报表交给王总', t.title);
