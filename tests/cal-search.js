/* 日历页筛选（FR-406 第二屏 · 弹窗形态）
   三条硬要求：
   ① 日历页只有一个按钮，筛选区在弹窗里 —— 不跟月历抢空间
   ② 条件是**独立的**（calQ/calFq/calFcat/calFst + calScope），跟首页搜索彻底断开
   ③ 范围可切：本月 = 当前翻到的月；全部 = 这个域所有条目（含没定日期的） */
const app = require('./harness.js')();
const ok = (l,c,e) => { console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):'')); if(!c) process.exitCode=1; };

function click(act,v){
  const el={dataset:{act,v:(v===undefined?undefined:String(v))},closest(){return el;}};
  return app.handleAct({target:{closest(){return el;}}});
}
const titles = () => (app.calResultHTML().match(/class="ititle">([^<]*)/g)||[])
  .map(s=>s.replace('class="ititle">','').replace(/^📌\s*/,''));

const ym=(y,m)=>y+'-'+String(m).padStart(2,'0');
const mk=(id,o)=>Object.assign({id,title:'',remark:'',done:false,deleted:false,inbox:false,
  domain:'work',imp:null,urg:null,cat:null,due:null,time:'',manual:{}},o);

(async () => {
  console.log('【0】准备：三件在月初、一件在下个月、一件没日期');
  const now=new Date(); const Y=now.getFullYear(), M=now.getMonth()+1;
  const thisYM=ym(Y,M);
  const next=new Date(Y,M,15), nextYM=ym(next.getFullYear(),next.getMonth()+1);
  app.todos.length=0;
  app.todos.push(
    mk(1,{title:'写周报',      remark:'季度报表要给老板看', due:thisYM+'-01', imp:true,  urg:true,  cat:'报表材料'}),
    mk(3,{title:'整理季度报表', remark:'交给王总',          due:thisYM+'-02', imp:true,  urg:false, cat:'报表材料'}),
    mk(2,{title:'买牛奶',      remark:'回家的路上',        due:thisYM+'-03', imp:false, urg:true}),
    mk(4,{title:'下月体检',    remark:'提前预约',          due:nextYM+'-10'}),
    mk(5,{title:'没定日子的事', remark:'想起来再做'}),
  );
  app.S.tab='calendar'; app.S.sub=null; app.S.domain='work';
  app.S.calY=Y; app.S.calM=M-1; app.S.calScope='month';
  app.S.calQ=''; app.S.calFq=''; app.S.calFcat=''; app.S.calFst='';

  console.log('\n【1】日历页只有一个按钮，筛选不占月历空间');
  const page=app.calendarHTML();
  ok('有「筛选」按钮', /data-act="calfilter"/.test(page));
  ok('页面里**没有**内联搜索框', page.indexOf('_qs')<0);
  ok('月历格子完整（没被挤掉）', (page.match(/data-act="day"/g)||[]).length>=28);
  ok('筛选区在弹窗里', /id="_cqs"/.test(app.calFilterHTML()));

  console.log('\n【2】★ 两屏断开：首页开着搜索，切到日历页不该跟着筛');
  app.S.tab='note'; app.S.q='周报'; app.S.qOpen=true;
  ok('首页确实在搜「周报」', app.hasFilter()===true);
  app.S.tab='calendar';
  ok('日历页的条件仍然是空的', app.hasFilter(app.calF())===false);
  ok('按钮显示「筛选」而不是「筛选中」', /筛选 · 按月/.test(app.calendarHTML()));
  app.S.q=''; app.S.qOpen=false;

  console.log('\n【3】弹窗里搜：本月范围');
  app.S.calQ='报表';
  const t=titles();
  ok('本月两条命中（一条标题一条备注）', t.length===2, t.join(' / '));
  ok('标题命中的排在前面', t[0]==='整理季度报表', t.join(' → '));

  console.log('\n【4】范围切「全部」：下个月的和没日期的也出来');
  click('calscope','all');
  ok('范围切到全部', app.S.calScope==='all');
  app.S.calQ='预约';
  ok('下个月的体检找到了', titles().join('')==='下月体检', titles().join(''));
  app.S.calQ='想起来再做';
  ok('没日期的那条也在', titles().join('')==='没定日子的事', titles().join(''));
  app.S.calQ='报表';
  ok('全部范围里本月的还在', titles().length===2, titles().join(' / '));

  console.log('\n【5】弹窗里的筛选条件：再点一次取消');
  click('calscope','month');
  app.S.calQ='';
  click('calfq','11');
  ok('按象限筛（马上做）', titles().join('')==='写周报', titles().join(' / '));
  click('calfq','11');
  click('calfcat','报表材料');
  ok('按分类筛', titles().length===2, titles().join(' / '));
  click('calfcat','报表材料');
  click('calfst','undone');
  const o=titles();
  ok('按状态筛 → 本月三条', o.length===3, o.join(' → '));
  ok('排序规则没变：马上做 → 计划做 → 快速处理',
     o.join('→')==='写周报→整理季度报表→买牛奶', o.join(' → '));

  console.log('\n【6】翻月 = 换范围');
  app.S.calM=(M%12); app.S.calY=(M===12?Y+1:Y);
  ok('翻到下个月 → 只剩体检', titles().join('')==='下月体检', titles().join(' ')||'（空）');
  app.S.calM=M-1; app.S.calY=Y;
  ok('翻回来 → 本月三条', titles().length===3, titles().join(' → '));

  console.log('\n【7】清空一步还原，且不动首页');
  click('calclear');
  ok('日历条件清空', app.S.calQ===''&&!app.S.calFq&&!app.S.calFcat&&!app.S.calFst);
  ok('范围回到本月', app.S.calScope==='month');
  app.S.q='周报';
  ok('清日历的筛选不会动首页搜索', app.S.q==='周报');
  app.S.q='';

  console.log('\n【8】★ 点了当场就要变（以前要退出弹窗再进来才看得见选中态）');
  const bar=()=>app.calFilterBarHTML();
  click('calfq','11');
  ok('选中「马上做」→ 条件区立刻是实底白字',
     /background:var\(--q1\);color:#fff/.test(bar()), (bar().match(/马上做[\s\S]{0,80}/)||[''])[0].replace(/\s+/g,' ').slice(0,60));
  ok('未选中的是白底彩字（不是细描边）',
     /background:#fff;color:var\(--q2\)/.test(bar()));
  click('calfq','11');
  ok('再点一次 → 立刻变回白底', /background:#fff;color:var\(--q1\)/.test(bar()));
  click('calscope','all');
  ok('范围切换也是当场生效', /background:var\(--brand\);color:#fff[^]*?全部/.test(bar()) || /全部/.test(bar()));

  console.log('\n【9】两屏样式统一：首页和日历弹窗用的是同一套规则');
  app.S.tab='note'; app.S.qOpen=true; app.S.fq='11';
  const home=app.searchHTML();
  ok('首页象限选中 = 实底白字', /background:var\(--q1\);color:#fff/.test(home));
  ok('首页未选中 = 白底彩字', /background:#fff;color:var\(--q2\)/.test(home));
  app.S.fq=''; app.S.qOpen=false; app.S.tab='calendar';

  console.log('\n【10】点按钮真的弹出来');
  const before=global.document.getElementById('phone').children.length;
  click('calfilter');
  const added=global.document.getElementById('phone').children.slice(before)
    .map(c=>c.innerHTML||'').join('');
  ok('弹窗出来了', /筛选/.test(added), (added.match(/筛选/)||[''])[0]);
  ok('弹窗里有结果区', /calmodalist/.test(added));
})();
