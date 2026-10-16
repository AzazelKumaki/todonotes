/* 交互测试：直接模拟「点按钮」，验证点了之后状态真的变了
   （修的 bug：AI.say 里误写 AI.cfg.save()，导致点了【拉取模型列表】完全没反应） */
const app = require('./harness.js')();
const ok = (l,c,e) => console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):''));

/* 造一个「点了某个 data-act 按钮」的事件 */
function click(act, v){
  const el = { dataset:{act, v:(v===undefined?undefined:String(v))}, closest(){ return el; } };
  return app.handleAct({ target:{ closest(sel){ return el; } } });
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
  console.log('【1】拉取模型列表 —— 成功后状态要真的落地');
  app.AI.cfg = {provider:'deepseek', base:'https://api.deepseek.com', key:'sk-test', model:'',
                models:[], ok:false, testedAt:'', msg:''};
  global.fetch = async()=>({ok:true, json:async()=>({data:[{id:'deepseek-chat'},{id:'deepseek-reasoner'}]})});
  click('aimodels');
  await sleep(50);
  ok('模型列表写进配置', app.AI.cfg.models.length===2, app.AI.cfg.models.join(','));
  ok('自动选中第一个模型', app.AI.cfg.model==='deepseek-chat', app.AI.cfg.model);
  ok('页面上留了可看的说明', /拉到 2 个模型/.test(app.AI.cfg.msg), app.AI.cfg.msg);

  console.log('\n【2】拉取失败 —— 也要明确说出来，不能静默');
  global.fetch = async()=>({ok:false, status:401, text:async()=>'{"error":"bad key"}'});
  click('aimodels');
  await sleep(50);
  ok('失败也写进说明', /没拉到列表/.test(app.AI.cfg.msg||''), app.AI.cfg.msg);
  ok('没连上时不允许启用', app.AI.ok===false || app.AI.cfg.ok===false);

  console.log('\n【3】测试连接 —— 成功/失败都要有结果');
  app.AI.cfg.models=['deepseek-chat']; app.AI.cfg.model='deepseek-chat';
  global.fetch = async()=>({ok:true, json:async()=>({choices:[{message:{content:'正常'}}]})});
  click('aitest');
  await sleep(50);
  ok('成功 → ok=true', app.AI.cfg.ok===true, app.AI.cfg.msg);
  app.AI.cfg.ok=false;
  global.fetch = async()=>{ throw new TypeError('Failed to fetch'); };
  click('aitest');
  await sleep(50);
  ok('跨域失败 → 有中文原因', /请求没发出去|跨域/.test(app.AI.cfg.msg||''), app.AI.cfg.msg);

  console.log('\n【4】保存 / 清除 / 换服务商');
  app.AI.cfg.ok=true; app.AI.cfg.msg='';
  click('aisave');
  ok('保存后留在 AI 页→回首页', app.S.sub===null);
  click('provider','kimi');
  ok('换服务商自动预填地址', app.AI.cfg.base.indexOf('moonshot')>0, app.AI.cfg.base);
  ok('换服务商后要重测', app.AI.cfg.ok===false);
  click('aiclear');
  ok('清除后回到未配置', app.AI.ready()===false, JSON.stringify(app.AI.cfg));

  console.log('\n【5】其她入口没被改坏');
  click('bakview'); ok('进入备份存档页', app.S.sub==='bak', app.S.sub);
  click('back');    ok('返回', app.S.sub===null);
})();
