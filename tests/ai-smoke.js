/* AI 路径测试：mock 掉 fetch，验证成功解析 / 分类白名单 / 超时降级 / 复盘生成 */
const app = require('./harness.js')();

/* 假的服务商：按我们给的回复内容返回 */
function mockFetch(reply, opts){
  opts = opts || {};
  global.fetch = async (url, opt) => {
    if(opts.hang) { return new Promise(()=>{}); }                    /* 永远不回来 = 超时 */
    if(opts.status) return { ok:false, status:opts.status, text:async()=>'{"error":"bad key"}' };
    const body = JSON.parse(opt.body);
    mockFetch.lastRequest = body;
    return { ok:true, json: async () => ({ choices:[{ message:{ content: reply } }] }) };
  };
}

const ok = (label, cond, extra) => console.log((cond?'✓ ':'✗ ') + label + (extra!==undefined?('  →  '+extra):''));

(async () => {
  const yesterday = app.shift(-1);

  console.log('\n【1】AI 解析成功（带代码块围栏 + 自造分类）');
  app.AI.cfg = {provider:'deepseek', base:'https://api.deepseek.com/v1', key:'sk-abc', model:'deepseek-chat', ok:true};
  mockFetch('```json\n{"title":"把季度报表交给王总","due":"'+app.shift(1)+'","time":"15:00","dueText":"明天 15:00","imp":true,"urg":false,"cat":"AI瞎编的分类","domain":"work"}\n```');
  let r = await app.doParseAsync('明天下午3点前把季度报表交给王总，这个挺重要的');
  ok('走了 AI 分支', r.mode==='ai', r.mode);
  ok('标题正确', r.title==='把季度报表交给王总', r.title);
  ok('时间正确', r.due===app.shift(1) && r.time==='15:00', r.due+' '+r.time);
  ok('重要=是 紧急=否', r.imp===true && r.urg===false, 'imp='+r.imp+' urg='+r.urg);
  ok('自造分类被拦下', r.cat===null, String(r.cat));
  ok('契约字段齐全', ['title','due','time','dueText','imp','urg','cat','domain'].every(k=>k in r), Object.keys(r).join(','));
  ok('请求里带了当前时间', /现在时刻/.test(mockFetch.lastRequest.messages[0].content + mockFetch.lastRequest.messages[1].content));
  ok('system 提示词含红线', /不能/.test(mockFetch.lastRequest.messages[0].content));

  console.log('\n【2】AI 擅自标重要 → 也要能过 alphabet 关卡（模型怎么说就怎么存，提示词负责约束）');
  mockFetch('{"title":"整理报表","due":"","imp":true,"urg":true,"cat":"报表材料","domain":"work"}');
  r = await app.doParseAsync('整理一下报表');
  ok('没日期时 dueText 有人话', r.dueText && r.dueText!=='', r.dueText);

  console.log('\n【3】AI 超时 → 自动降级成本机规则，界面不卡');
  mockFetch('', {hang:true});
  const t0 = Date.now();
  r = await app.doParseAsync('后天上午交房租');
  const dt = Date.now()-t0;
  ok('降级成功', r.mode==='rule', r.mode+' 原因='+r.reason);
  ok('3 秒就撒手', dt<3600, dt+'ms');
  ok('降级结果有标题', !!r.title, r.title);

  console.log('\n【4】Key 写错 → 同样降级，且给出人话原因');
  mockFetch('', {status:401});
  r = await app.doParseAsync('明天开会');
  ok('降级', r.mode==='rule', r.reason);

  console.log('\n【5】复盘生成（有 AI）');
  mockFetch('昨天把一季度数据和买菜办了，季度报表还拖着一天 —— 明早先把报表发给王总，十分钟的事。');
  await app.REV.build(yesterday, false);
  const rv = app.reviews[yesterday];
  ok('生成了一句话', !!(rv && rv.text), rv && rv.text);
  ok('带跨域统计', rv.total>0 && rv.done>=0, `total=${rv.total} done=${rv.done} overdue=${rv.overdue}`);
  ok('不带百分号（报告腔红线）', !/%/.test(rv.text));
  ok('记了生成时间', !!rv.genAt, rv.genAt);
  const first = rv.text;
  mockFetch('完全不同的另一句总结，用来验证锁定。');
  await app.REV.build(yesterday, false);
  ok('再次自动生成 → 锁定不覆盖', app.reviews[yesterday].text===first);
  mockFetch('手动重算的第三版。');
  await app.REV.build(yesterday, true);
  ok('手动【重新生成】→ 才重写', app.reviews[yesterday].text!==first && app.reviews[yesterday].manual===true, app.reviews[yesterday].text);

  console.log('\n【6】复盘失败 → 标记待生成，不放假文案');
  console.log('   （先验证：没动静的日子连记录都不留）');
  const quietDay = app.shift(-9);
  await app.REV.build(quietDay, false);
  ok('当天没动静 → 不生成、也不留空壳', !app.reviews[quietDay], JSON.stringify(app.reviews[quietDay]));
  /* 给前天塞一条待办，让它「有动静」 */
  const d2 = app.shift(-2);
  app.todos.push({id:99001,done:false,due:d2,time:'',title:'回访王总',cat:null,domain:'work',
    remark:'回访王总',inbox:false,deleted:false,pinned:false,imp:false,urg:false,doneAt:null,
    createdAt:d2+' 10:00',updatedAt:d2+' 10:00',source:'text',manual:{},parsed:true});
  mockFetch('', {status:429});
  await app.REV.build(d2, false);
  const p = app.reviews[d2];
  ok('有动静但 AI 失败 → 标记 pending', !!(p && p.pending), JSON.stringify(p));
  ok('没有假文案', !p.text);
  /* 下次打开重试成功 → 顶掉 pending */
  mockFetch('王总那边的回访还没打，明天上午抽十分钟补上。');
  await app.REV.build(d2, false);
  ok('下次自动重试成功 → 顶掉 pending', !!app.reviews[d2].text && !app.reviews[d2].pending, app.reviews[d2].text);

  console.log('\n【7】AI 未配置 → 老路照常');
  app.AI.cfg = {provider:'builtin', base:'', key:'', model:'', ok:false};
  r = await app.doParseAsync('明天开会');
  ok('直接走规则版', r.mode==='rule');
})();
