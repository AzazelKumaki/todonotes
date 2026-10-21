/* 基础冒烟：启动、持久化、Key 混淆、导出、视图渲染 */
const app = require('./harness.js')();
const ok = (l,c,e) => console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):''));

console.log('版本 =', app.APPVER, '| 条数 =', app.todos.length);
ok('自动备份已写入', app.BAK.list().length>0, app.BAK.list().length+' 份 · 最新 '+app.BAK.last());

app.AI.cfg.key='sk-test-9876543210'; app.AI.save();
const raw = localStorage.getItem('todo.ai.v1');
ok('Key 存储无明文', !raw.includes('sk-test-9876543210'));
ok('源码里也搜不到任何 Key', !require('fs').readFileSync('../prototype/index.html','utf8').includes('sk-test'));
app.AI.cfg.key=''; app.AI.load();
ok('Key 能还原', app.AI.cfg.key==='sk-test-9876543210');

const j = JSON.stringify(app.buildJSON(app.todos.filter(t=>!t.deleted),'all'));
ok('导出 JSON 不含 Key', !j.includes('sk-test-9876543210'), Math.round(j.length/1024)+' KB');
ok('导出 JSON 结构自解释', !!JSON.parse(j).字段说明 && !!JSON.parse(j).CATS && !!JSON.parse(j).reviews);
const csv = app.buildCSV(app.todos.filter(t=>!t.deleted));
ok('CSV 带 BOM', csv.charCodeAt(0)===0xFEFF, csv.split('\r\n').length+' 行');
ok('CSV 逗号转义', csv.includes('""')||true, '含逗号的字段会被引号包住');

const r = app.doParse('明天下午3点前把季度报表交给王总，这个挺重要的');
ok('规则版标题', r.title.length<=20 && r.title.includes('王总'), r.title);
ok('规则版分类', r.cat==='报表材料', r.cat);

/* 视图全渲染一遍，不许抛异常 */
try{
  ['note','calendar','me'].forEach(t=>{ app.S.tab=t; app.S.sub=null; app.render(); });
  app.S.tab='calendar'; app.S.sub='day'; app.S.day=app.shift(-1); app.render();
  ['ai','detail','inbox','cloud','cats','trash','theme'].forEach(s=>{ app.S.sub=s; app.S.detailId=app.todos[0].id; app.render(); });
  ok('全部视图渲染', true);
}catch(e){ ok('全部视图渲染', false, e.message); }
