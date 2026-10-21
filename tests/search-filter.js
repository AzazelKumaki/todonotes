/* 搜索与筛选（FR-406）
   口径：标题 + 备注都能搜（标题命中排前面）；可按象限 / 分类 / 状态筛；
        只做过滤不改排序；同条件再点一次 = 取消；清不掉的要一次性还原 */
const app = require('./harness.js')();
const ok = (l,c,e) => { console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):'')); if(!c) process.exitCode=1; };

function click(act, v, d){
  const el = { dataset:{act, v:(v===undefined?undefined:String(v)), d}, closest(){ return el; } };
  return app.handleAct({ target:{ closest(){ return el; } } });
}
const shown = () => {
  const h = app.noteHTML();
  return (h.match(/data-act="open"/g)||[]).length;
};
const titles = () => (app.noteHTML().match(/class="ititle">([^<]*)/g)||[])
  .map(s=>s.replace('class="ititle">','').replace(/^📌\s*/,''));

(async () => {
  console.log('【0】准备数据');
  app.todos.length = 0;
  const mk=(id,o)=>Object.assign({id,title:'',remark:'',done:false,deleted:false,inbox:false,
    domain:'work',imp:null,urg:null,cat:null,due:null,time:'',manual:{}},o);
  app.todos.push(
    mk(1,{title:'写周报',        remark:'季度报表要给老板看', due:app.TODAY, imp:true,  urg:true,  cat:'报表材料'}),
    mk(2,{title:'买牛奶',        remark:'回家的路上', due:app.TODAY, imp:false, urg:true,  cat:null}),
    mk(3,{title:'整理季度报表',  remark:'交给王总',   due:app.TODAY, imp:true,  urg:false, cat:'报表材料'}),
    mk(4,{title:'给妈打电话',    remark:'晚上',       due:app.TODAY, imp:false, urg:false, cat:null}),
    mk(5,{title:'已完成的事',    remark:'早就做完了', due:app.TODAY, done:true}),
  );
  app.S.tab='note'; app.S.sub=null; app.S.domain='work'; app.S.focused=false;
  const all = shown();
  ok('五条都在首页', all===5, all+' 条');

  console.log('\n【1】搜标题');
  app.S.q='牛奶'; 
  ok('只留下匹配的 1 条', shown()===1, shown()+' 条');
  ok('留下的就是「买牛奶」', titles().indexOf('买牛奶')>=0, titles().join(' / '));

  console.log('\n【2】搜备注（备注是原话，靠它才能找回来）');
  app.S.q='老板';
  ok('命中备注那条', titles().join('')==='写周报', titles().join(' / '));
  app.S.q='晚上';
  ok('另一条也靠备注找到了', titles().join('')==='给妈打电话', titles().join(' / '));
  app.S.q='没有这个词xyz';
  ok('搜不到时给空态提示', /没有匹配的/.test(app.noteHTML()));

  console.log('\n【3】标题命中排前面');
  app.S.q='报表';          /* 1 号只命中备注、3 号命中标题 → 3 号要排前面 */
  const order = titles();
  ok('两条都命中', order.length===2, order.join(' / '));
  ok('标题命中的排在备注命中之前',
     order.indexOf('整理季度报表') < order.indexOf('写周报'),
     order.join(' → '));

  console.log('\n【4】按象限筛');
  app.S.q='';
  click('fq','11');       /* 重要且紧急 = 马上做 */
  ok('只剩「写周报」（马上做）', titles().join('')==='写周报', titles().join(' / '));
  click('fq','11');
  ok('再点一次同一个 = 取消', titles().length===5, titles().length+' 条');

  console.log('\n【5】按分类筛');
  click('fcat','报表材料');
  ok('只剩这个分类的两条', titles().length===2, titles().join(' / '));
  click('fcat','报表材料');

  console.log('\n【6】按状态筛');
  click('fst','done');
  ok('只剩已完成的那条', titles().join('')==='已完成的事', titles().join(' / '));
  click('fst','done');
  click('fst','undone');
  ok('未完成的排除已完成的', titles().indexOf('已完成的事')<0 && titles().length===4, titles().length+' 条');
  click('fst','undone');

  console.log('\n【7】条件可以叠加，也能一步清空');
  app.S.q='报表'; click('fcat','报表材料');
  ok('关键词 + 分类叠加', titles().length<=2, titles().join(' / '));
  click('qclear');
  ok('清空后一条不少', titles().length===5, titles().length+' 条');
  ok('筛选标记也清干净了', app.S.q===''&&app.S.fq===''&&app.S.fcat===''&&app.S.fst==='');

  console.log('\n【8】过滤之后排序规则一字不改（置顶→逾期→四象限→完成沉底）');
  app.todos[0].imp=true; app.todos[0].urg=false;   /* 1 号改「计划做」，和 3 号同档；
                                                     2 号是「快速处理」，应排在这两个后面 */
  click('fst','undone');
  const o2=titles();
  ok('计划做的排在快速处理之前',
     Math.max(o2.indexOf('写周报'), o2.indexOf('整理季度报表')) < o2.indexOf('买牛奶'), o2.join(' → '));
  ok('「有空再说」仍在未完成的最后一位', o2[o2.length-1]==='给妈打电话', o2.join(' → '));
  click('qclear');

  console.log('\n【9】默认收起，不占地方');
  app.S.qOpen=false;
  const closed=app.noteHTML();
  ok('没搜索时是一行小入口', /data-act="qtoggle"/.test(closed) && !/id="_qs"/.test(closed));
  click('qtoggle');
  ok('点开才有输入框', /id="_qs"/.test(app.noteHTML()));

  console.log('\n【10】「清空」≠「退出」（2026-10-21 修的老 bug：点清空会把面板整个收掉）');
  /* 点框外 = 页面上不带 data-act 的任意空白处 */
  const clickOutside = () => app.handleAct({ target:{ closest(){ return null; } } });
  click('fst','undone');
  ok('先筛出未完成', titles().length===4, titles().length+' 条');
  click('qclear');
  ok('清空后列表恢复全部', titles().length===5, titles().length+' 条');
  ok('清空后条件真的清干净', app.S.q===''&&!app.S.fq&&!app.S.fcat&&!app.S.fst);
  ok('★清空不退出：面板还开着', /id="_qs"/.test(app.noteHTML()) && app.S.qOpen===true);
  click('fst','undone');
  ok('重新选上条件', app.S.fst==='undone', app.S.fst);
  clickOutside();
  ok('★点框外才收起面板', !/id="_qs"/.test(app.noteHTML()) && app.S.qOpen===false);
  ok('★收起不等于清空：条件还在', app.S.fst==='undone', app.S.fst);
  ok('★收起态按钮写明「筛选中 · N 条」', /筛选中 · \d+ 条/.test(app.noteHTML()));
  ok('收起后列表仍按条件筛', titles().length===4, titles().length+' 条');
  click('qtoggle');
  ok('再点小入口能重新展开', /id="_qs"/.test(app.noteHTML()));
  click('qclear');
})();
