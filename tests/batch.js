/* FR-501 批量操作 —— 按 PRD 的验收项逐条验
   跑法：cd tests && node batch.js */
const A = require('./harness.js')();
const S = A.S, todos = A.todos;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('✓', name, extra !== undefined ? (' →  ' + extra) : ''); pass++; }
  else { console.log('✗', name, extra !== undefined ? (' →  ' + extra) : ''); fail++; }
}
function sec(t) { console.log('\n【' + t + '】'); }
/* 造一批种子：全部挂在「工作」域、今天到期，方便验证批量效果 */
function mk(n, opt) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const t = {
      id: A.newId(), title: '批量测试 ' + (i + 1), note: '', domain: opt && opt.domain || 'work',
      due: opt && opt.due !== undefined ? opt.due : A.TODAY, time: '15:00',
      imp: 1, urg: 1, cat: '', done: !!(opt && opt.done), pinned: false,
      created: A.nowStamp(), updatedAt: A.nowStamp()
    };
    todos.push(t); arr.push(t);
  }
  return arr;
}
function act(a, v) {
  A.handleAct({ target: { closest: () => ({ dataset: { act: a, v: String(v) } }) } });
}
function cleanUp() { for (let i = todos.length - 1; i >= 0; i--) if (/^批量测试/.test(todos[i].title || '')) todos.splice(i, 1); }

sec('1 进入 / 退出多选态');
cleanUp();
const seed = mk(4);
S.tab = 'note'; S.sub = null; S.sel = null;
ok('初始不在多选态', A.selMode() === false);
S.sel = [seed[0].id];
ok('置上数组即进入多选态', A.selMode() === true);
ok('inSel 认得出选中项', A.inSel(seed[0].id) === true && A.inSel(seed[1].id) === false);
const html = A.itemHTML(seed[0]);
ok('选中的条目带 sel 标记', /class="item [^"]*sel/.test(html), html.match(/class="item[^"]*"/)[0]);
ok('多选态下圆圈不再切「完成」', /circle sel" data-act="open"/.test(html));
A.toggleSel(seed[1].id);
ok('toggleSel 加选', S.sel.length === 2);
A.toggleSel(seed[1].id);
ok('再 toggle 一次取消选中', S.sel.length === 1);
act('selcancel', '');
ok('取消后退出多选态', A.selMode() === false);

sec('2 选中的条目不含已删除的');
cleanUp();
const keep = mk(3);
const gone = mk(1);
gone[0].deleted = true; gone[0].deletedAt = A.nowStamp();
S.sel = [keep[0].id, gone[0].id];
ok('selTodos 滤掉回收站里的', A.selTodos().length === 1, '选中 2 条 / 有效 ' + A.selTodos().length + ' 条');
S.sel = null;

sec('3 动作 ①：标完成 / 取消完成');
cleanUp();
const g1 = mk(5);
S.sel = g1.map(t => t.id);
act('seldone', '');
ok('全部标完成', g1.every(t => t.done === true), g1.filter(t => t.done).length + '/5');
ok('完成时刻写进去了', g1.every(t => !!(t.doneAt && t.doneAt.length)));
S.sel = g1.map(t => t.id);
act('seldone', '');
ok('再点一次 = 全部取消完成', g1.every(t => t.done === false && t.doneAt === null));
ok('动作做完自动退出多选态', A.selMode() === false);

sec('4 动作 ②：顺延到明天（只改 due，不动 time）');
cleanUp();
const g2 = mk(3, { due: '2026-10-20' });
g2[2].due = '';                       // 没填日期的那条也要能排
S.sel = g2.map(t => t.id);
act('seltmr', '');
ok('有日期的 → 整体 +1 天', g2[0].due === '2026-10-21', g2[0].due);
ok('time 原样不动', g2[0].time === '15:00', g2[0].time);
ok('没填日期的 → 排到明天', g2[2].due === A.addDays('', 1), g2[2].due);

sec('5 动作 ③：改分类（跨域不动）');
cleanUp();
const inDom = mk(2, { domain: 'work' });
const cross = mk(1, { domain: 'life' });
S.domain = 'work';
S.sel = inDom.concat(cross).map(t => t.id);
if (!A.CATS.work) A.CATS.work = [];
A.CATS.work = A.CATS.work.filter(c => c !== '批量专用');
A.CATS.work.push('批量专用');
act('selcatgo', '批量专用');
ok('同归属的改了分类', inDom.every(t => t.cat === '批量专用'), inDom[0].cat);
ok('另一个归属的那条没被带动', cross[0].cat === '', JSON.stringify(cross[0].cat));
S.domain = 'work';
act('selcatgo', '');
S.sel = [inDom[0].id];
act('selcatgo', '');
ok('「不分类」会把 cat 清空', inDom[0].cat === '');

sec('6 动作 ④：删除 = 软删进回收站');
cleanUp();
const g4 = mk(3);
S.sel = g4.map(t => t.id);
act('seldel', '');
ok('三条都打上 deleted', g4.every(t => t.deleted === true));
ok('删除时刻有值（回收站 30 天靠它）', g4.every(t => !!t.deletedAt));
ok('没有直接从数组里消失（可恢复）', todos.filter(t => t.deleted).length >= 3);

sec('7 空选什么都别做（不许报错、不许误伤）');
cleanUp();
const g5 = mk(2);
S.sel = [];
let threw = false;
try { act('seldone', ''); act('seltmr', ''); act('seldel', ''); }
catch (e) { threw = true; }
ok('空选择点动作不抛错', threw === false);
ok('空选择也不会误改数据', g5.every(t => !t.done && !t.deleted && t.due === A.TODAY));
S.sel = null;

sec('8 addDays 边界');
ok('跨月：2026-10-31 +1 → 11-01', A.addDays('2026-10-31', 1) === '2026-11-01', A.addDays('2026-10-31', 1));
ok('跨年：2026-12-31 +1 → 2027-01-01', A.addDays('2026-12-31', 1) === '2027-01-01', A.addDays('2026-12-31', 1));
ok('闰年：2028-02-28 +1 → 02-29', A.addDays('2028-02-28', 1) === '2028-02-29', A.addDays('2028-02-28', 1));

sec('9 「我的」页那行文案不再写死数字');
const me = A.meHTML();
ok('分类管理这行没有写死的个数', !/分类管理 · 工作 \d+/.test(me), (me.match(/分类管理[^']{0,20}/) || [''])[0]);

cleanUp();
console.log('\n———— ' + (fail ? '✗ 有失败' : '✓ 全部通过') + ' ————  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
