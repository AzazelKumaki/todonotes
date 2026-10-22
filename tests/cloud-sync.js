/* V0.3 云同步测试（完全离线：fetch 是 mock 的，不连任何真实服务）
   跑法： cd tests && node cloud-sync.js
   覆盖：space_id 派生 · 读写 · 错误翻译 · 首传 · 拉取合并 · 冲突不覆盖 · 配置码 */
const app = require('./harness')();
const { CLOUD, SYNC } = app;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  → ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---------- mock fetch ---------- */
let MODE = 'empty';       // empty | row | keyless | notable | timeout
let LAST = [];            // 收到的请求
let remoteRow = null;
global.fetch = async (url, opt) => {
  LAST.push({ url, method: (opt.method || 'GET'), body: opt.body, headers: opt.headers });
  if (MODE === 'timeout') await new Promise(r => setTimeout(r, 30));
  if (MODE === 'cors') throw new TypeError('Failed to fetch');
  if (MODE === 'keyless') return { status: 401, text: async () => '{"message":"Invalid API key"}' };
  if (MODE === 'notable') return { status: 404, text: async () => '{"message":"relation \\"public.todo_state\\" does not exist"}' };
  if (MODE === 'boom') return { status: 500, text: async () => '{"message":"boom"}' };
  if ((opt.method || 'GET') === 'POST') {
    const arr = JSON.parse(opt.body);
    remoteRow = Object.assign({}, remoteRow, arr[0]);
    return { status: 201, text: async () => JSON.stringify([remoteRow]) };
  }
  const rows = remoteRow ? [remoteRow] : [];
  return { status: 200, text: async () => JSON.stringify(rows) };
};

(async () => {
  console.log('\n=== V0.3 云同步 · ' + app.APPVER + ' ===\n');

  /* 1. space_id 派生 */
  const s1 = await CLOUD.sid('abc123');
  const s2 = await CLOUD.sid('abc123');
  const s3 = await CLOUD.sid('def456');
  ok('同一个口令算出同一个 space_id', s1 === s2 && s1.length > 30, s1.slice(0, 12) + '…');
  ok('不同口令 → 完全不同的 space_id', s1 !== s3);
  ok('cloud 里查不到口令原文（只存派生串）',
    (JSON.stringify({ CLOUD }) + app.buildJSON([]).注意).indexOf('abc123') < 0);

  const cfg = { base: 'http://127.0.0.1:8787', key: 'k1', pwd: 'abc123' };

  /* 2. 读 / 写 / 错误翻译 */
  MODE = 'empty';
  ok('云端没有这行时 getRow 返回 null', (await CLOUD.getRow(cfg, s1)) === null);

  MODE = 'row';
  const now = new Date().toISOString();
  const put = await CLOUD.putRow(cfg, s1, { todos: [{ id: 1 }] }, now);
  ok('putRow 写进去并返回该行', put && put.space_id === s1 && put.payload.todos.length === 1);
  const got = await CLOUD.getRow(cfg, s1);
  ok('getRow 能读回刚写的', got && got.updated_at === now);
  const post = LAST.slice().reverse().find(r => r.method === 'POST');
  ok('写的时候带了设备号（排错用）', !!post && String(post.body).indexOf('device_id') > 0);

  MODE = 'keyless';
  await CLOUD.getRow(cfg, s1).then(() => ok('密钥错 → 抛 KEY', false))
    .catch(e => ok('密钥错 → 抛 KEY', e.message === 'KEY'));
  MODE = 'notable';
  await CLOUD.getRow(cfg, s1).then(() => ok('表没建 → 抛 TABLE', false))
    .catch(e => ok('表没建 → 抛 TABLE', e.message === 'TABLE'));
  MODE = 'cors';
  await CLOUD.getRow(cfg, s1).then(() => ok('跨域被拒 → 抛 CORS', false))
    .catch(e => ok('跨域被拒 → 抛 CORS', e.message === 'CORS'));

  ok('错误都翻成了人话',
    CLOUD.why('CORS').indexOf('跨域') >= 0 &&
    CLOUD.why('KEY').indexOf('密钥') >= 0 &&
    CLOUD.why('TABLE').indexOf('表还没建') >= 0 &&
    CLOUD.why('啥也没有').indexOf('后端返回') >= 0);

  /* 2.5 密钥头的两种形态（Supabase 2026 换了新 key 体系） */
  const hNew = CLOUD.hdr({ key: 'sb_publishable_abc123' });
  const hOld = CLOUD.hdr({ key: 'eyJhbGciOiJIUzI1NiJ9.xxx' });
  ok('新版 publishable key 只走 apikey 头（放 Bearer 会被当 JWT 拒掉）',
    hNew.apikey === 'sb_publishable_abc123' && !hNew.Authorization);
  ok('老版 JWT 密钥两个头都发（兼容）', hOld.apikey && hOld.Authorization === 'Bearer eyJhbGciOiJIUzI1NiJ9.xxx');
  try { CLOUD.hdr({ key: '密钥带中文' }); ok('密钥含中文会被拦下', false); }
  catch (e) { ok('密钥含中文会被拦下', e.message === 'KEYCHAR'); }
  ok('建表脚本里有授权那一段', SQL_SETUP.indexOf('grant select, insert, update, delete') > 0);

  /* 3. 没开启就绝不该联网 */
  LAST = [];
  SYNC.clear();
  await SYNC.run();
  ok('没开启 → 一个请求都不发', LAST.length === 0);

  /* 4. 首次同步 → 推上去 */
  MODE = 'empty'; remoteRow = null; LAST = [];
  SYNC.cfg.on = true; SYNC.cfg.kind = 'supabase';
  SYNC.cfg.supabase = { base: cfg.base, key: cfg.key };
  SYNC.cfg.pwd = cfg.pwd; SYNC.cfg.space = s1;
  SYNC.cfg.at = ''; SYNC.cfg.fp = 'x';           // 假装本机改过
  let r = await SYNC.run({ manual: true });
  ok('首次同步 → 推上去', r.ok && r.how === 'pushed', JSON.stringify(r));
  ok('推完之后记下基线，下次不用重复推', !!SYNC.cfg.at);

  /* 5. 云端更新 → 拉下来合并（且不丢本机数据）*/
  const mineCount = app.todos.length;
  const oldUpdated = app.todos[0].updatedAt;
  remoteRow = {
    space_id: s1, updated_at: new Date(Date.now() + 60000).toISOString(),
    payload: { todos: [{ id: 99001, title: '来自另一台设备的待办', updatedAt: '2099-01-01 00:00' }] }
  };
  SYNC.cfg.at = '2000-01-01T00:00:00.000Z'; SYNC.cfg.fp = SYNC.fp();   // 本机没改
  LAST = [];
  r = await SYNC.run({ manual: true });
  ok('云端更新 → 拉下来', r.ok && r.how === 'pulled', JSON.stringify(r));
  ok('拉下来的是**合并**不是覆盖', app.todos.length === mineCount + 1, '原 ' + mineCount + ' → 现 ' + app.todos.length);
  ok('另一台设备的新条目真的进来了', !!app.todos.find(t => t.id === 99001));

  /* 6. 两边都改过 → 不许偷偷覆盖，要人拍板 */
  remoteRow.updated_at = new Date(Date.now() + 120000).toISOString();
  SYNC.cfg.at = '2000-01-01T00:00:00.000Z';
  SYNC.cfg.fp = '本机改过了';      // 伪造本机有改动
  const stage = SYNC.st.state;
  r = await SYNC.run();            // 自动同步：不许自作主张
  ok('两边都改过 → 自动同步停手，等用户选', r.reason === 'conflict', JSON.stringify(r));
  ok('冲突时本机数据一条没动', app.todos.find(t => t.id === 99001) !== undefined && app.todos.length === mineCount + 1);
  ok('状态栏给的是「点这里选以哪边为准」', SYNC.st.state === 'conflict' && SYNC.st.msg.indexOf('选以哪边为准') > 0);

  LAST = [];
  r = await SYNC.run({ manual: true, prefer: 'local' });
  ok('选「以本机为准」→ 推上去，不丢本机数据', r.ok && r.how === 'pushed' && app.todos.length === mineCount + 1);

  /* 7. 断网：改动留在本地，不报错 */
  MODE = 'cors';
  SYNC.cfg.fp = '又改了';
  r = await SYNC.run({ manual: true });
  ok('连不上时降级，不抛错给用户', r.ok === false && r.reason === 'CORS', JSON.stringify(r));
  ok('失败后状态栏有中文说明', SYNC.st.state === 'err' && SYNC.st.msg.indexOf('没发出去') > 0);
  ok('失败不会动数据', app.todos.length === mineCount + 1);

  /* 8. 配置码往返 */
  MODE = 'row';
  const code = SYNC.code();
  ok('配置码带版本前缀', code.indexOf('DBSYNC1:') === 0);
  const backup = { ...SYNC.cfg };
  SYNC.clear();
  ok('断开后配置清空', SYNC.cfg.supabase.base === '' && SYNC.cfg.on === false);
  SYNC.applyCode(code);
  ok('导入配置码 → 三样都回来',
    SYNC.cfg.supabase.base === backup.supabase.base &&
    SYNC.cfg.supabase.key === backup.supabase.key &&
    SYNC.cfg.pwd === backup.pwd);
  try { SYNC.applyCode('随便一段字'); ok('乱码不会被误当配置码', false); }
  catch (e) { ok('乱码不会被误当配置码', true); }

  /* 9. 密钥不进导出文件 */
  const j = JSON.stringify(app.buildJSON(app.todos));
  SYNC.cfg.on = true; SYNC.save();
  ok('导出的数据文件里没有云密钥', j.indexOf(backup.key) < 0 && j.indexOf('apikey') < 0);

  /* 10. 界面能渲染出来 */
  ok('云同步配置页能渲染', String(app.cloudHTML()).indexOf('云同步') > 0);
  ok('「我的」页能渲染', String(app.meHTML()).indexOf('云同步') > 0);

  /* 11. 【保存并开启】的弹窗必须有收尾（2026-10-22 修）
     以前成功之后只弹 toast，「正在开启…」那张弹窗一直挂在屏上不换不掉 */
  const click = (act) => {
    const el = { dataset: { act }, closest() { return el; } };
    return app.handleAct({ target: { closest() { return el; } } });
  };
  const lastModal = () => {
    const kids = global.document.getElementById('phone').children;
    const masks = kids.filter(k => String(k.className || '').indexOf('modal-mask') >= 0);
    return masks.length ? String(masks[masks.length - 1].innerHTML) : '';
  };

  // ① 连通 + 首次同步成功 → 弹窗要变成「已开启」
  MODE = 'empty';
  SYNC.cfg = { on:false, kind:'supabase', pwd:'pwd', space:'', at:'', fp:'', enc:true,
    supabase:{ base:'https://x.supabase.co', key:'k' },
    cos:{ bucket:'', region:'ap-guangzhou', secretId:'', key:'' } };
  remoteRow = null;
  click('csave');
  await new Promise(r => setTimeout(r, 120));
  let m = lastModal();
  ok('连通并同步成功 → 弹窗换成了「已开启」', m.indexOf('云同步已开启') >= 0 && m.indexOf('正在开启') < 0,
     (m.match(/<div class="modal-t">([^<]*)/) || [, ''])[1]);

  // ② 连不上 → 弹窗要变成「没能开启」，不能停在「正在开启」
  MODE = 'keyless';
  SYNC.cfg.on = false; SYNC.cfg.pwd = 'pwd';
  click('csave');
  await new Promise(r => setTimeout(r, 120));
  m = lastModal();
  ok('连不上 → 弹窗换成了「没能开启」', m.indexOf('没能开启') >= 0 && m.indexOf('正在开启') < 0,
     (m.match(/<div class="modal-t">([^<]*)/) || [, ''])[1]);

  // ③ 测试连接那一路也不能卡在「正在测试连接…」
  click('ctest');
  await new Promise(r => setTimeout(r, 120));
  m = lastModal();
  ok('测试连接失败 → 弹窗换成了「连不上」', m.indexOf('连不上') >= 0 && m.indexOf('正在测试连接') < 0,
     (m.match(/<div class="modal-t">([^<]*)/) || [, ''])[1]);

  SYNC.clear();
  console.log('\n  合计 ' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : '') + '\n');
  process.exit(fail ? 1 : 0);
})();
