/* 排序口径（2026-10-21 拍板）
   置顶 > **逾期组**（组内只按轻重缓急，不看逾期了几天）> 其余**按时间先后**（先日期、再当天时刻）
   > 同一时间再按轻重缓急 > 已完成沉底。
   首页列表 / 日历当天明细 / 筛选结果 / 收件箱共用 sortList，两屏口径必须一致。 */
const app = require('./harness.js')();
const ok = (l,c,e) => { console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):'')); if(!c) process.exitCode=1; };

const DAY=24*3600*1000;
const shift = n => app.fmtD(new Date(new Date(app.TODAY+'T00:00:00').getTime()+n*DAY));

(async () => {
  console.log('【0】准备数据');
  app.todos.length = 0;
  const mk=(id,o)=>Object.assign({id,title:'',remark:'',done:false,deleted:false,inbox:false,
    domain:'work',imp:null,urg:null,cat:null,due:null,time:'',manual:{}},o);
  app.todos.push(
    mk(1,{title:'今天18点马上做',    due:app.TODAY, time:'18:00', imp:true,  urg:true}),
    mk(2,{title:'今天9点有空再说',   due:app.TODAY, time:'09:00', imp:false, urg:false}),
    mk(3,{title:'明天马上做',        due:shift(1),               imp:true,  urg:true}),
    mk(4,{title:'逾期五天有空再说',  due:shift(-5),              imp:false, urg:false}),
    mk(5,{title:'逾期一天马上做',    due:shift(-1),              imp:true,  urg:true}),
    mk(6,{title:'已完成',           due:app.TODAY, time:'08:00', done:true, imp:true, urg:true}),
    mk(7,{title:'置顶的那条',        due:shift(3),               pinned:true}),
    mk(8,{title:'没填日期',          due:null,                  imp:true,  urg:true}),
    mk(9,{title:'今天9点马上做',     due:app.TODAY, time:'09:00', imp:true,  urg:true}),
  );
  app.S.tab='note'; app.S.sub=null; app.S.domain='work'; app.S.focused=false;
  app.clearFilter(); app.S.qOpen=false;

  const order = app.sortList(app.listTodos()).map(t=>t.title);
  console.log('     实际顺序：'+order.join(' → '));

  console.log('\n【1】置顶永远第一');
  ok('第一条是置顶项', order[0]==='置顶的那条', order[0]);

  console.log('\n【2】逾期组整体最前，组内**只按轻重缓急**（不看逾期了几天）');
  const i5=order.indexOf('逾期一天马上做'), i4=order.indexOf('逾期五天有空再说');
  ok('两条逾期都在未完成项之前', i5>=1 && i4>=1 && Math.max(i5,i4)<order.indexOf('今天9点马上做'),
     `逾期一天#${i5} / 逾期五天#${i4}`);
  ok('★逾期五天但「有空再说」排在逾期一天「马上做」之后', i5<i4, `马上做#${i5} < 有空再说#${i4}`);

  console.log('\n【3】其余按时间先后：先日期，再当天时刻');
  ok('今天9点排在今天18点之前（不再按象限抢位）',
     order.indexOf('今天9点马上做')<order.indexOf('今天18点马上做'));
  ok('今天排明天之前', order.indexOf('今天18点马上做')<order.indexOf('明天马上做'));
  ok('明天排没填日期之前', order.indexOf('明天马上做')<order.indexOf('没填日期'));

  console.log('\n【4】同一时间 → 再按轻重缓急');
  ok('同样 09:00：马上做排在有空再说前面',
     order.indexOf('今天9点马上做')<order.indexOf('今天9点有空再说'));

  console.log('\n【5】已完成沉底');
  ok('最后一条是已完成的', order[order.length-1]==='已完成', order[order.length-1]);

  console.log('\n【6】首页列表与日历当天明细口径一致');
  const strip = h => (h.match(/class="ititle">([^<]*)/g)||[])
    .map(s=>s.replace('class="ititle">','').replace(/^📌\s*/,''));
  app.S.day = app.TODAY;
  const daySeq  = strip(app.dayHTML());
  const homeSeq = strip(app.noteListHTML());
  const todayNames = ['今天9点马上做','今天9点有空再说','今天18点马上做'];
  const cut = seq => seq.filter(n=>todayNames.indexOf(n)>=0);
  ok('同一天里两屏顺序一模一样', cut(daySeq).join()===cut(homeSeq).join(),
     cut(daySeq).join(' → ')+'  ｜  '+cut(homeSeq).join(' → '));

  console.log('\n【7】文案：退出聚焦的按钮改叫「返回」');
  app.S.focused = true;                       /* 这个按钮只在聚焦态（A2）才出现 */
  ok('聚焦态按钮文案是「返回」', /data-act="cancel">返回</.test(app.noteHTML()));
  ok('页面提示里也跟着改了', /【返回】/.test(app.noteHTML()));
  ok('旧的「再改改」已经没有残留', app.noteHTML().indexOf('再改改')<0);
})();
