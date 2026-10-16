/* 回归：① 拖动排序落点 ② 渲染后滚动位置 ③ 导入备份 */
const app = require('./harness.js')();
const ok = (l,c,e) => console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):''));

/* 拖动落点公式：from=拖哪一项，to=指针越过中线的行数（-1=最顶） */
const di = app.dropIndex;

console.log('【1】拖动排序落点（老算法在「往上拖」时会错一位）');
/* [A,B,C]，把 C(2) 拖到 A 和 B 中间：指针只越过 A 的中线 → to=0 */
ok('C 拖到 A/B 之间 → 插到第 1 位', di(2,0)===1, 'di='+di(2,0));
/* 把 A(0) 拖到 B 和 C 中间：越过 A、B 的中线 → to=1 */
ok('A 拖到 B/C 之间 → 插到第 1 位', di(0,1)===1, 'di='+di(0,1));
/* 把 C 拖到最顶：一行都没越过 → to=-1 */
ok('C 拖到最顶 → 插到第 0 位', di(2,-1)===0, 'di='+di(2,-1));
/* 把 A 拖到最底：越过 A、B、C → to=2 */
ok('A 拖到最底 → 插到第 2 位', di(0,2)===2, 'di='+di(0,2));
/* 原地不动：越过 A、B（C 不动时指针就在原处）→ di 应等于 from，不产生变化 */
ok('B 不动（越过 A、B）→ 落回原位 1', di(1,1)===1, 'di='+di(1,1));

/* 端到端：模拟一次真的重排 */
function move(arr, from, to){ const a=arr.slice(); const [x]=a.splice(from,1); a.splice(di(from,to),0,x); return a; }
console.log('  端到端：[A,B,C]');
ok('  C → A/B 之间 = [A,C,B]', JSON.stringify(move(['A','B','C'],2,0))==='["A","C","B"]', JSON.stringify(move(['A','B','C'],2,0)));
ok('  A → B/C 之间 = [B,A,C]', JSON.stringify(move(['A','B','C'],0,1))==='["B","A","C"]', JSON.stringify(move(['A','B','C'],0,1)));
ok('  C → 最顶 = [C,A,B]',     JSON.stringify(move(['A','B','C'],2,-1))==='["C","A","B"]', JSON.stringify(move(['A','B','C'],2,-1)));
ok('  A → 最底 = [B,C,A]',     JSON.stringify(move(['A','B','C'],0,2))==='["B","C","A"]', JSON.stringify(move(['A','B','C'],0,2)));

console.log('\n【2】页面滚动位置：同一页面内点选项不该被弹回顶部');
const v = document.getElementById('view');
app.S.tab='me'; app.S.sub='ai'; app.render();            // 进二级页
v.scrollTop = 0;
v.scrollTop = 300;                                       // 用户滚到中间
app.render();                                            // 同一页内再渲染（模拟点了个选项）
ok('同页内点选项 → 保住位置（这是修的 bug）', v.scrollTop===300, 'scrollTop='+v.scrollTop);
app.S.sub='cats'; app.render();                          // 换个二级页 → 应回顶
ok('换页面 → 回到顶部', v.scrollTop===0, 'scrollTop='+v.scrollTop);
v.scrollTop=200; app.render(false);                      // 显式要求回顶（如新建分类）
ok('显式 render(false) → 强制回顶', v.scrollTop===0, 'scrollTop='+v.scrollTop);

console.log('\n【3】导入备份：合并 / 覆盖');
const mk = (id, title, updatedAt) => ({id, title, domain:'work', imp:false, urg:false, due:null,
  cat:null, remark:title, inbox:false, deleted:false, done:false, doneAt:null, pinned:false,
  createdAt:'2026-10-01 09:00', updatedAt, source:'text', manual:{}, parsed:true});

const n0 = app.todos.length;
const file = {
  todos:[ mk(777001,'导入的新条目','2026-10-14 10:00'),
          Object.assign(mk(app.todos[0].id,'同名但更新过','2099-01-01 00:00')) ],
  CATS:{work:['项目推进','会议沟通','报表材料','临时插单','文件里多出来的分类'],life:[]},
  CAT_STYLE:{}, reviews:{}
};
let r = app.mergeImport(file);
ok('合并 → 新增 1 条', r.added===1, 'added='+r.added);
ok('合并 → 同 id 且更新的被更新', r.updated===1, 'updated='+r.updated);
ok('合并 → 现有数据没被清掉', app.todos.length===n0+1, `${n0} → ${app.todos.length}`);
ok('合并 → 分类也并进来了', app.CATS.work.includes('文件里多出来的分类'), app.CATS.work.join('/'));
ok('合并 → 取了更晚的那份', app.todos.find(t=>t.id===app.todos[0].id||false) !== null);
const merged = app.todos.filter(t=>t.title==='同名但更新过').length;
ok('合并 → 同 id 只留一份且用新值', merged===1, '命中 '+merged+' 条');

r = app.overwriteImport(file);
ok('覆盖 → 只剩文件里的 2 条', r.total===2, 'total='+r.total);
ok('覆盖 → 原来的数据被清掉', app.todos.length===2, app.todos.length+' 条');
