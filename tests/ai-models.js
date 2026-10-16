/* 模型列表 / CORS 诊断相关测试（mock fetch） */
const app = require('./harness.js')();
const ok = (l,c,e) => console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):''));

function mock(impl){ global.fetch = impl; }

(async () => {
  app.AI.cfg = {provider:'custom', base:'https://api.example.com/v1', key:'sk-abc', model:'', models:[], ok:false};

  console.log('【1】正常拉取模型列表');
  mock(async (url, opt) => ({
    ok:true, json: async()=>({ data:[{id:'gpt-4o-mini'},{id:'gpt-4o'},{id:'o1-preview'}] })
  }));
  let ids = await app.fetchModels();
  ok('拿到 3 个模型', ids.length===3, ids.join(', '));
  ok('按名字排好序', JSON.stringify(ids)===JSON.stringify(['gpt-4o','gpt-4o-mini','o1-preview']), ids.join(','));

  console.log('\n【2】接口不返回模型的容错');
  mock(async()=>({ok:true, json:async()=>({})}));
  try{ await app.fetchModels(); ok('空数据应报错', false); }
  catch(e){ ok('空数据 → 明确报错', /没返回模型列表/.test(e.message), e.message); }

  console.log('\n【3】Key 写错 / 地址写错');
  mock(async()=>({ok:false, status:401, text:async()=>'{"error":"invalid key"}'}));
  try{ await app.fetchModels(); ok('401 应报错', false); }
  catch(e){ ok('401 → 人话提示', /Key 不对/.test(e.message), e.message); }

  console.log('\n【4】浏览器跨域把请求拦了（fetch 直接抛 TypeError，没有 HTTP 状态码）');
  mock(async()=>{ throw new TypeError('Failed to fetch'); });
  try{ await app.fetchModels(); ok('应报错', false); }
  catch(e){ ok('TypeError → 识别出是跨域/网络，不甩 HTTP 错误码', /请求没发出去|跨域|超时/.test(e.message), e.message); }
  /* 解析链路也要能识别（这里关键：不能让界面干等或弹出看不懂的东西）*/
  app.AI.cfg.model='x';
  const r = await app.doParseAsync('明天开会');
  ok('解析同样优雅降级', r.mode==='rule', '原因='+r.reason);
  ok('降级也有标题可用', !!r.title, r.title);

  console.log('\n【5】缺 Key / 缺地址时先拦住，不发无谓请求');
  const save = app.AI.cfg.base; app.AI.cfg.base='';
  try{ await app.fetchModels(); ok('缺地址应报错', false); }
  catch(e){ ok('缺地址 → 先填的提示', /先填接口地址/.test(e.message), e.message); }
  app.AI.cfg.base = save;

  console.log('\n【6】自动备份存档页能正常渲染');
  app.S.tab='me'; app.S.sub='bak'; app.render();
  ok('存档页渲染无异常', true);
  const ks = app.BAK.list();
  ok('快照份数', ks.length>0, ks.length+' 份 · 最新 '+app.BAK.last());
})();
