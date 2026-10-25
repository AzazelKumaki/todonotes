/* FR-503 重复待办补全 —— 按 PRD 的验收项逐条验
   跑法：cd tests && node recur.js */
const A = require('./harness.js')();
const S = A.S, todos = A.todos;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('✓', name, extra !== undefined ? (' →  ' + extra) : ''); pass++; }
  else { console.log('✗', name, extra !== undefined ? (' →  ' + extra) : ''); fail++; }
}
function sec(t) { console.log('\n【' + t + '】'); }
function act(a, v) {
  A.handleAct({
    target: { closest: () => ({ dataset: { act: a, v: String(v) } }) },
    stopPropagation() {}, preventDefault() {}      /* toggle 分支会调 stopPropagation */
  });
}
function cleanUp() { for (let i = todos.length - 1; i >= 0; i--) if (/^重复测试/.test(todos[i].title || '')) todos.splice(i, 1); }
const RULE_WEEK = { mode: 'week', wd: 3, time: '09:00', on: true };   /* 每周三 */
const RULE_MONTH = { mode: 'month', md: 31, time: '', on: true };     /* 每月 31 号 */

sec('1 老数据兼容：recur:true 不能炸，按一次性处理');
cleanUp();
const old = { id: A.newId(), title: '重复测试 老数据', domain: 'work', due: '2026-10-20', done: false, recur: true };
todos.push(old);
ok('布尔 true 不认作规则', A.recurObj(old) === null);
ok('recurText 返回空', A.recurText(old) === '');
ok('列表符号不挂', A.recurMark(old) === '');
let threw = false;
try { act('toggle', old.id); } catch (e) { threw = true; }
ok('勾它不会报错也不会无限生成', !threw && old_count() === 1, '匹配 ' + old_count() + ' 条');
function old_count() { return todos.filter(t => /^重复测试/.test(t.title || '')).length; }

sec('2 nextRecurDue · 每周三');
ok('从周二出发 → 第二天（周三）', A.nextRecurDue(RULE_WEEK, '2026-10-20') === '2026-10-21', A.nextRecurDue(RULE_WEEK, '2026-10-20'));
ok('周三当天出发 → 排到下周（不当天重复）', A.nextRecurDue(RULE_WEEK, '2026-10-21') === '2026-10-28', A.nextRecurDue(RULE_WEEK, '2026-10-21'));
ok('从周四出发 → 下周三', A.nextRecurDue(RULE_WEEK, '2026-10-22') === '2026-10-28', A.nextRecurDue(RULE_WEEK, '2026-10-22'));

sec('3 nextRecurDue · 每月 31 号（小月取当月最后一天）');
ok('1 月 31 → 2 月 28', A.nextRecurDue(RULE_MONTH, '2026-01-31') === '2026-02-28', A.nextRecurDue(RULE_MONTH, '2026-01-31'));
ok('2 月 28 → 3 月 31', A.nextRecurDue(RULE_MONTH, '2026-02-28') === '2026-03-31', A.nextRecurDue(RULE_MONTH, '2026-02-28'));
ok('4 月 30 → 5 月 31', A.nextRecurDue(RULE_MONTH, '2026-04-30') === '2026-05-31', A.nextRecurDue(RULE_MONTH, '2026-04-30'));
ok('跨档案年：2026-12-31 → 2027-01-31', A.nextRecurDue(RULE_MONTH, '2026-12-31') === '2027-01-31', A.nextRecurDue(RULE_MONTH, '2026-12-31'));

sec('4 nextRecurDue · 每隔 N 天');
ok('每隔 3 天', A.nextRecurDue({ mode: 'every', every: 3, on: true }, '2026-10-25') === '2026-10-28', A.nextRecurDue({ mode: 'every', every: 3, on: true }, '2026-10-25'));
ok('every 缺失按 1 天算', A.nextRecurDue({ mode: 'every', on: true }, '2026-10-25') === '2026-10-26');

sec('5 勾完成 → 自动续下一次');
cleanUp();
const mk = (t) => {
  const x = A.T({ title: '重复测试 ' + t.title, domain: 'work', due: t.due, time: t.time, imp: 1, urg: 0, cat: t.cat, remark: 'r', recur: { ...RULE_WEEK } });
  todos.push(x); return x;
};
const base = mk({ title: '周会', due: '2026-10-21', time: '09:00', cat: '会议' });
const before = todos.length;
act('toggle', base.id);
ok('原条目标完成', base.done === true);
ok('多出一条', todos.length === before + 1, before + ' → ' + todos.length);
const kid = todos[todos.length - 1];
ok('新条是 2026-10-28（下一周）', kid.due === '2026-10-28', kid.due);
ok('标题带着走', kid.title === '重复测试 周会', kid.title);
ok('分类 / 域跟着走', kid.cat === '会议' && kid.domain === 'work');
ok('时刻用规则里的', kid.time === '09:00', kid.time);
ok('新条没有继承 doneAt', !kid.done && !kid.doneAt, JSON.stringify({ done: kid.done, doneAt: kid.doneAt }));
ok('新条自己也带着规则（能一直续）', A.recurObj(kid) !== null);
const before2 = todos.length;
act('toggle', base.id);      /* 取消完成：不该重复生成 */
ok('取消完成不再多生一条', todos.length === before2, '条数 ' + todos.length);

sec('6 暂停 / 继续 / 关闭');
cleanUp();
const p1 = mk({ title: '缴费', due: '2026-10-21' });
act('toggle', p1.id);                       /* 先续一次，制造子条 */
const kid2 = todos[todos.length - 1];
S.detailId = kid2.id;
ok('详情页有「重复」一栏', /重复 ·/.test(A.recurBox(kid2)), (A.recurBox(kid2).match(/重复 · [^<]*/) || [''])[0]);
act('recuron', '0');
ok('暂停后规则还在但 on=false', A.recurObj(kid2) === null || kid2.recur.on === false);
ok('暂停后列表不挂符号', A.recurMark(kid2) === '');
const cnt = todos.length;
ok('暂停时勾完成不再生成新条', (act('toggle', kid2.id), todos.length === cnt), '条数 ' + todos.length);
S.detailId = kid2.id;
act('recuron', '1');
ok('继续之后又有符号了', A.recurMark(kid2) === '🔁 ');
S.detailId = kid2.id;
act('recuroff', '');
ok('关闭后 recur 变 null（= 普通待办）', kid2.recur === null);
ok('关闭后详情页不再显示这一栏', A.recurBox(kid2) === '');

sec('7 「循环安排」创建出来的是规则而不是布尔');
cleanUp();
S.domain = 'work';
S.sub = null;
S._recur = { title: '重复测试 新规矩', mode: 'week', wd: 3, md: 1, every: 3, time: '09:00', imp: true, urg: false, cat: null };
/* genRecur 会先用 syncRecur() 从输入框读值；stub 环境里 getElementById 会返回一个假对象把标题冲掉，
   这里临时让它返回 null（真实浏览器里走的是输入框，不受影响） */
const _gid = document.getElementById;
document.getElementById = (id) => (String(id).indexOf('_r') === 0 ? null : _gid(id));
try { A.genRecur(); } catch (e) { console.log('  (genRecur 抛错：' + (e && e.message) + ')' + (e && e.stack ? '\n' + e.stack.split('\n')[1] : '')); }
const created = todos.filter(t => /^重复测试 新规矩/.test(t.title || ''));
ok('一次排出多条', created.length >= 2, created.length + ' 条');
ok('每条都带的是**规则对象**', created.length > 0 && created.every(t => t.recur && typeof t.recur === 'object' && t.recur.on === true));
ok('规则字段完整', created.length > 0 && created[0].recur.mode === 'week' && created[0].recur.wd === 3, JSON.stringify(created[0] && created[0].recur));
document.getElementById = _gid;   /* 还原 */

sec('8 列表副标题带循环符号');
cleanUp();
const m1 = mk({ title: '带符号', due: A.TODAY });
ok('规则开着 → 副标题带 🔁', A.fmtSub(m1).indexOf('🔁') === 0, A.fmtSub(m1));
m1.recur.on = false;
ok('暂停了就不挂', A.fmtSub(m1).indexOf('🔁') !== 0, A.fmtSub(m1));

sec('9 滚动窗口：一批 3 条逐条标完成 → 未完成始终 3 条且不撞日期');
cleanUp();
S.domain = 'work';
/* 只数这一批（同 rid 且标题一致）—— harness 还灌着一份种子数据，别把它算进来 */
const batchCnt = () => todos.filter(t => t.title === '重复测试 周会');
const batch = ['2026-10-28', '2026-11-04', '2026-11-11'].map(d => A.T({
  title: '重复测试 周会', domain: 'work', due: d, time: '09:00', imp: 1, urg: 0,
  cat: '', remark: 'r', recur: { mode: 'week', wd: 3, time: '09:00', on: true, rid: 'rb1' }
}));
batch.forEach(t => todos.push(t));
ok('初始未完成 3 条', batchCnt().filter(t => !t.done && !t.deleted).length === 3, batchCnt().length);
batch.forEach(t => act('toggle', t.id));
const left2 = batchCnt().filter(t => !t.done && !t.deleted);
const dues2 = left2.map(t => t.due);
ok('三条都勾完 → 未完成仍是 3 条', left2.length === 3, left2.length + ' 条 · ' + dues2.join(' '));
ok('日期各不相同（没撞车）', new Set(dues2).size === dues2.length, dues2.join(' '));
ok('续出来的都排在最后一条之后', dues2.every(d => d > '2026-11-11'), dues2.join(' '));
ok('原来三条留着（已完成，可回看）', batchCnt().filter(t => t.done && !t.deleted).length === 3);
ok('新三条也带规则（能一直续）', left2.every(t => A.recurObj(t) !== null));

cleanUp();
console.log('\n———— ' + (fail ? '✗ 有失败' : '✓ 全部通过') + ' ————  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
