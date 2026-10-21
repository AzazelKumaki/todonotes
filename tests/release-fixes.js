/* V0.4 发版审查的回归测试（2026-10-21）
   守的都是「点了没反应」这种静默故障 —— 单独曾被 hundreds of lines 盖住，
   现在每一条都对着相应的修复点，改坏了立刻能发现。 */
const app = require('./harness.js')();
const ok = (l,c,e) => console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):''));
let fails = 0;
const t = (l,c,e) => { if(!c) fails++; ok(l,c,e); };

function click(act, v){
  const el = { dataset:{act, v:(v===undefined?undefined:String(v))}, closest(){ return el; } };
  return app.handleAct({ target:{ closest(){ return el; } } });
}

/* ---------- ① 导出不能崩（以前 ReferenceError: scope is not defined）---------- */
console.log('【1】导出 —— 以前一按就 ReferenceError，被吞掉后表现成「点了没反应」');
/* harness 里没有 Blob / URL / a.click，补上桩，让 downloadFile 那条浏览器链路能走完 */
try{
  Object.getPrototypeOf(global.document.body).click = function(){};
}catch(e){}
global.Blob = function(){};
global.URL = { createObjectURL:()=> 'blob:stub', revokeObjectURL(){} };

let exportErr = null;
try{ app.doExport(); }catch(e){ exportErr = e.message; }
t('导出没抛错', exportErr === null, exportErr || '（无异常）');

/* 顺便核一遍：导出内容里不许带密钥 */
const json = app.buildJSON(app.todos);
t('导出数据里没有 AI Key', JSON.stringify(json).indexOf('sk-') < 0);
t('导出数据里没有云同步口令', !/pwd|secret/i.test(JSON.stringify(json)));

/* ---------- ② 日期选择器不能锁死在某一年 ---------- */
console.log('\n【2】日期选择器 —— 以前年份写死 2026，跨年之后选出来的日子全是过去');
app.openDatePicker('什么时候完成','2027-02-15','10:00',()=>{});
t('打开时年份跟着选中日期走', app.S._dp.y === 2027, app.S._dp.y);
t('月份也对', app.S._dp.m === 1, app.S._dp.m + 1 + ' 月');

click('dpm','1');
t('往后翻一个月', app.S._dp.m === 2, app.S._dp.y + '-' + (app.S._dp.m + 1));
/* 一路翻到 12 月再往前 —— 旧实现会把月份钳在 0~11，永远出不了 2027 */
for(let i=0;i<10;i++) click('dpm','1');
t('12 月再往前 → 跳到下一年的 1 月（不是原地卡住）',
  app.S._dp.y === 2028 && app.S._dp.m === 0, app.S._dp.y + '-' + (app.S._dp.m + 1));
click('dpm','-1');
t('1 月往后 → 退回 2027 年 12 月',
  app.S._dp.y === 2027 && app.S._dp.m === 11, app.S._dp.y + '-' + (app.S._dp.m + 1));
/* 没给日期时默认用今天，年份也得是今年 */
app.openDatePicker('什么时候完成','','',()=>{});
t('没传日期时取今年的年份', app.S._dp.y === new Date().getFullYear(), app.S._dp.y);

/* ---------- ③ id 不能跨设备撞号 ---------- */
console.log('\n【3】发号 —— 两台设备以前会发出同一个 id，合并时互相覆盖');
const before = app.todos.length;
app.todos.push(app.T({title:'甲'}));
app.todos.push(app.T({title:'乙'}));
const [a, b] = app.todos.slice(-2);
t('同一毫秒连开两条也不重号', a.id !== b.id, a.id + ' / ' + b.id);
t('号码严格递增', b.id > a.id);
t('不与库里任何一条重复',
  app.todos.filter(x => x.id === a.id).length === 1 &&
  app.todos.filter(x => x.id === b.id).length === 1);
t('新号的量级跟老数据（1xx）不打架', a.id > 1e15, a.id);
app.todos.pop(); app.todos.pop();
t('没有污染原数据', app.todos.length === before, app.todos.length + ' 条');

/* ---------- ④ 标题兜底：remark 缺失也不能白屏 ---------- */
console.log('\n【4】标题兜底 —— 外面导入的数据没有 remark 字段时不能崩');
let titleFallback = null;
try{ titleFallback = app.titleOf({title:'', remark:undefined}); }
catch(e){ titleFallback = 'EX:' + e.message; }
t('缺 remark 也给得住', titleFallback === '', JSON.stringify(titleFallback));
t('有标题就用标题', app.titleOf({title:'周会', remark:'xxx'}) === '周会');
const long = '记得明天下午去买牛奶鸡蛋和面包';
t('没标题就取备注前 12 字', app.titleOf({title:'', remark:long}) === long.slice(0,12), long.slice(0,12));
t('前后空格不算标题', app.titleOf({title:'   ', remark:long}) === long.slice(0,12));

/* ---------- ⑤ 分类配色必须跨设备稳定 ---------- */
console.log('\n【5】分类配色 —— 以前按「已分配几个」顺延，两台分配顺序不同就会互相跳色');
t('同一个名字算出同一套配色',
  JSON.stringify(app.catStyle('周会')) === JSON.stringify(app.catStyle('周会')));
t('不同名字不会全挤到同一个颜色',
  app.catStyle('周会').color !== app.catStyle('家人').color,
  app.catStyle('周会').color + ' / ' + app.catStyle('家人').color);
/* 模拟「另一台设备按相反顺序新建」：清空后重来一遍，配色必须一模一样 */
const forward = {};
['A类','B类','C类'].forEach(n => forward[n] = app.catStyle(n).color);
Object.keys(app.CAT_STYLE).forEach(k => delete app.CAT_STYLE[k]);   /* 就地清空：catStyle 看的就是这个对象 */
['C类','B类','A类'].forEach(n => forward['反向_' + n] = app.catStyle(n).color);
t('换顺序创建，颜色依然一致',
  ['A类','B类','C类'].every(n => forward[n] === forward['反向_' + n]),
  ['A类','B类','C类'].map(n => forward[n]).join(' / '));

/* ---------- ⑥ 点击出错要看得见 ---------- */
console.log('\n【6】最后防线 —— 任何分支里抛错都要在界面上说出来，不许「点了没反应」');
/* 下面会故意制造异常，先把它记下来再静音（兜底那条 console.error 是本用例预期内的产物） */
const realError = console.error;
let consoleGot = '';
console.error = (...a) => { consoleGot = String(a[1] || a[0] || ''); };
let caught = false;
try{
  /* 故意制造一个坏元素：dataset.v 是个会炸的东西，让某个分支抛错 */
  app.handleAct({ target:{ closest(){ return null; } } });   /* 正常路径，不该报错 */
  app.handleAct({ target:{ get(){ throw new Error('故意制造的错误'); } } });
}catch(e){ caught = true; }
console.error = realError;
t('异常被兜住，不会冒到调用方', caught === false);
t('错误留在了控制台里（方便事后排查）', /closest is not a function/.test(consoleGot), consoleGot);

console.log('\n' + (fails ? ('共 ' + fails + ' 项失败') : '全部通过'));
process.exit(fails ? 1 : 0);
