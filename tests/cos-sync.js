/* V0.3 腾讯云 COS 适配层 + 两家密钥隔离
   跑法： cd tests && node cos-sync.js
   覆盖：签名算法（与腾讯云官方算法逐字节比对）· 读 · 写 · 404/403 · 两家密钥分开存 · 保存后重开不丢 · 老数据搬迁 */
const crypto = require('crypto');
const app = require('./harness')();
const { CLOUD, SYNC } = app;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  → ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};
const blank = () => ({ on:false, kind:'supabase', pwd:'', space:'', at:'', fp:'',
  supabase:{base:'', key:''}, cos:{bucket:'', region:'ap-guangzhou', secretId:'', key:''} });

/* 参照实现：腾讯云官方算法（前面已与官方 SDK 交叉验证通过） */
const hmac = (k, m) => crypto.createHmac('sha1', k).update(m).digest('hex');
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
function refSign(secretKey, method, path, host, signTime) {
  const httpString = method + '\n' + path + '\n\nhost=' + encodeURIComponent(host) + '\n';
  const sts = 'sha1\n' + signTime + '\n' + sha1(httpString) + '\n';
  return hmac(hmac(secretKey, signTime), sts);
}

const cfg = {
  kind: 'cos', pwd: '我的口令',
  supabase: { base: '', key: '' },
  cos: { bucket: 'daiban-1250000000', region: 'ap-guangzhou',
         secretId: 'AKIDTestId0000000000000000000', key: 'TestSecretKey000000000000000' }
};
const SID = 'abcDEF_-123';
const HOST = CLOUD.cosHost(cfg);
const PATH = CLOUD.cosPath(SID);

(async () => {
  console.log('\n=== V0.3 腾讯云 COS + 两家密钥隔离 ===\n');

  console.log('【1】签名');
  ok('桶域名拼对了', HOST === 'daiban-1250000000.cos.ap-guangzhou.myqcloud.com', HOST);
  ok('对象路径带前缀、且转义过', PATH.indexOf('/daiban/') === 0 && PATH.indexOf(SID) > 0, PATH);
  for (const m of ['get', 'put']) {
    const auth = await CLOUD.cosAuth(cfg, m, PATH);
    const st = /q-sign-time=([^&]*)/.exec(auth)[1];
    const got = /q-signature=([0-9a-f]+)/.exec(auth)[1];
    ok(m.toUpperCase() + ' 签名与官方算法一致', got === refSign(cfg.cos.key, m, PATH, HOST, st), got.slice(0, 16) + '…');
    ok(m.toUpperCase() + ' 带 SecretId', auth.indexOf('q-ak=AKIDTestId') > 0);
    ok(m.toUpperCase() + ' 只签 host（少签少错）', /q-header-list=host&/.test(auth));
  }

  console.log('\n【2】读 / 写');
  let last = null;
  global.fetch = async (url, opt) => {
    last = { url, method: opt.method || 'GET', headers: opt.headers || {}, body: opt.body };
    if (opt.method === 'PUT') return { status: 200, text: async () => '' };
    return { status: 200, text: async () => JSON.stringify({ v: 2, updatedAt: '2026-10-17 23:00', todos: [{ id: 1 }] }) };
  };
  const row = await CLOUD.getRow(cfg, SID);
  ok('读：打到正确的地址', last.url === 'https://' + HOST + PATH, last.url);
  ok('读：用了 GET 且带签名', last.method === 'GET' && !!last.headers.authorization);
  ok('读：内容解析对了', row && row.payload.todos.length === 1);
  ok('读：时间戳取自文件内部', row.updated_at === '2026-10-17 23:00');
  await CLOUD.putRow(cfg, SID, { todos: [{ id: 9 }], CATS: {}, CAT_STYLE: {}, reviews: {} }, '2026-10-17 23:10');
  ok('写：用了 PUT', last.method === 'PUT');
  ok('写：声明了 JSON', last.headers['Content-Type'] === 'application/json');
  ok('写：把时间戳写进文件里', JSON.parse(last.body).updatedAt === '2026-10-17 23:10');

  console.log('\n【3】出错怎么表现');
  global.fetch = async () => ({ status: 404, text: async () => '<Error>NoSuchKey</Error>' });
  ok('没传过 → 返回空（不算错）', (await CLOUD.getRow(cfg, SID)) === null);
  global.fetch = async () => ({ status: 403, text: async () => '<Error>AccessDenied</Error>' });
  await CLOUD.getRow(cfg, SID).then(() => ok('403 → 报密钥/权限问题', false))
    .catch(e => ok('403 → 报密钥/权限问题', e.message === 'KEY'));
  global.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await CLOUD.getRow(cfg, SID).then(() => ok('域名解析不到 → 明确说', false))
    .catch(e => ok('域名解析不到 → 明确说', e.message === 'NET_DNS'));

  console.log('\n【4】两种后端各查各的');
  SYNC.cfg = blank();
  SYNC.cfg.kind = 'cos';
  SYNC.cfg.cos = { bucket:'daiban-1250000000', region:'ap-guangzhou', secretId:'x', key:'y' };
  SYNC.cfg.pwd = 'p';
  ok('COS：桶+密钥+口令齐了才算填完', SYNC.filled() === true);
  SYNC.cfg.cos.bucket = '';
  ok('COS：少了桶名就不算', SYNC.filled() === false);
  SYNC.cfg.kind = 'supabase';
  SYNC.cfg.supabase = { base:'https://x.supabase.co', key:'k' };
  ok('Supabase：只看地址+密钥+口令', SYNC.filled() === true);

  console.log('\n【5】★ 切服务商，密钥不会串（用户报的那个问题）');
  SYNC.cfg = blank();
  SYNC.cfg.supabase = { base:'https://old.supabase.co', key:'SUPABASE-KEY-123' };
  SYNC.cfg.cos = { bucket:'', region:'ap-guangzhou', secretId:'', key:'' };
  let h = '';
  SYNC.cfg.kind = 'cos';
  h = app.cloudHTML();
  ok('切到 COS：页面上不出现 Supabase 的 Key', h.indexOf('SUPABASE-KEY-123') < 0);
  ok('切到 COS：显示的是 COS 自己的四个框', /data-cf="cos\.key"/.test(h) && !/data-cf="supabase\.key"/.test(h));
  SYNC.cfg.cos = { bucket:'daiban-1250000000', region:'ap-guangzhou', secretId:'AK', key:'COS-SECRET-456' };
  SYNC.cfg.kind = 'supabase';
  h = app.cloudHTML();
  ok('切回 Supabase：页面上不出现 COS 的密钥', h.indexOf('COS-SECRET-456') < 0);
  ok('切回 Supabase：Supabase 自己的 Key 还在框里', h.indexOf('SUPABASE-KEY-123') > 0);

  console.log('\n【6】★ 存下来了，重开不用重填');
  SYNC.cfg = blank();
  SYNC.cfg.kind = 'cos';
  SYNC.cfg.pwd = 'PP-口令';
  SYNC.cfg.supabase = { base:'https://a.supabase.co', key:'K-SUPA' };
  SYNC.cfg.cos = { bucket:'daiban-1250000000', region:'ap-shanghai', secretId:'AKID-COSTEST', key:'K-COS' };
  SYNC.save();
  const raw = JSON.parse(localStorage.getItem('todo.sync.v1'));
  ok('落盘：两家的密钥分开存', !!raw.supabase && !!raw.cos && raw.supabase.key !== raw.cos.key);
  ok('落盘：看不到明文（混淆过的）',
    JSON.stringify(raw).indexOf('K-SUPA') < 0 && JSON.stringify(raw).indexOf('K-COS') < 0
    && JSON.stringify(raw).indexOf('AKID-COSTEST') < 0);
  SYNC.cfg = blank();                       /* 模拟关掉页面重新打开 */
  SYNC.load();
  ok('重开后：Supabase 的 Key 还在', SYNC.cfg.supabase.key === 'K-SUPA', SYNC.cfg.supabase.key);
  ok('重开后：COS 的密钥还在', SYNC.cfg.cos.key === 'K-COS', SYNC.cfg.cos.key);
  ok('重开后：桶名和地域都在', SYNC.cfg.cos.bucket === 'daiban-1250000000' && SYNC.cfg.cos.region === 'ap-shanghai');
  ok('重开后：口令还在（不用重填）', SYNC.cfg.pwd === 'PP-口令');

  console.log('\n【7】老版本扁平存的数据自动搬过来');
  localStorage.setItem('todo.sync.v1', JSON.stringify(
    { on:false, kind:'supabase', base:'https://old.supabase.co', key:'OLD-FLAT-KEY', pwd:'OLD-PWD' }));
  SYNC.cfg = blank();
  SYNC.load();
  ok('老数据的地址搬进 supabase 格子', SYNC.cfg.supabase.base === 'https://old.supabase.co');
  ok('老数据的密钥搬进 supabase 格子', SYNC.cfg.supabase.key === 'OLD-FLAT-KEY');
  ok('老数据的口令也还在', SYNC.cfg.pwd === 'OLD-PWD');

  console.log('\n【8】★ 空密钥不能抛看不懂的原生错误（用户遇到的 HMAC 报错）');
  const emptyCos = { kind:'cos', pwd:'p', supabase:{base:'',key:''},
                     cos:{bucket:'daiban-1250000000', region:'ap-guangzhou', secretId:'', key:''} };
  await CLOUD.cosAuth(emptyCos, 'get', '/x.json').then(() => ok('空密钥 → 拦住', false))
    .catch(e => ok('空密钥 → 拦住并说人话', e.message === 'EMPTY', CLOUD.why(e.message)));
  const miss = CLOUD.missing(emptyCos);
  ok('能说清缺哪几样', miss.join('、') === 'SecretId、SecretKey', miss.join('、'));
  const t0 = await CLOUD.test(emptyCos);
  ok('测试连接时先查缺项，不发请求', t0.ok === false && t0.code === 'EMPTY', t0.msg);
  const missAll = CLOUD.missing({ kind:'cos', pwd:'', supabase:{base:'',key:''},
    cos:{bucket:'', region:'ap-guangzhou', secretId:'', key:''} });
  ok('全空时列全所有缺项', missAll.length === 4, missAll.join('、'));
  const okCfg = { kind:'cos', pwd:'p', supabase:{base:'',key:''},
    cos:{bucket:'b-125', region:'ap-guangzhou', secretId:'AK', key:'SK'} };
  ok('填齐了就不报缺项', CLOUD.missing(okCfg).length === 0);

  console.log('\n【9】配置码：两家一起带走');
  SYNC.cfg = blank();
  SYNC.cfg.kind = 'cos'; SYNC.cfg.pwd = 'PP';
  SYNC.cfg.supabase = { base:'https://a.supabase.co', key:'K-SUPA' };
  SYNC.cfg.cos = { bucket:'daiban-1250000000', region:'ap-shanghai', secretId:'AKID-COSTEST', key:'K-COS' };
  const code2 = SYNC.code();
  SYNC.cfg = blank();
  SYNC.applyCode(code2);
  ok('导入后 COS 那份在', SYNC.cfg.cos.key === 'K-COS' && SYNC.cfg.cos.bucket === 'daiban-1250000000');
  ok('导入后 Supabase 那份**也在**（两家一起带过去了）',
    SYNC.cfg.supabase.key === 'K-SUPA' && SYNC.cfg.supabase.base === 'https://a.supabase.co');
  ok('导入后口令在', SYNC.cfg.pwd === 'PP');
  ok('导入完整配置码后不缺项', CLOUD.missing(SYNC.cfg).length === 0, CLOUD.missing(SYNC.cfg).join('、'));

  console.log('\n【10】配置码带上 COS 的信息');
  SYNC.cfg = blank();
  SYNC.cfg.kind = 'cos';
  SYNC.cfg.cos = { bucket:'daiban-1250000000', region:'ap-shanghai', secretId:'AK1', key:'SK1' };
  SYNC.cfg.pwd = 'pwd1';
  const code = SYNC.code();
  SYNC.cfg = blank();
  SYNC.applyCode(code);
  ok('导入后桶/地域/密钥都在',
    SYNC.cfg.cos.bucket === 'daiban-1250000000' && SYNC.cfg.cos.region === 'ap-shanghai' &&
    SYNC.cfg.cos.secretId === 'AK1' && SYNC.cfg.cos.key === 'SK1');

  console.log('\n【COS 的 404 不许再套用 Supabase 的文案】（2026-10-22 修）');
  /* 以前 cosPut 抛的是 'HTTP404'，被 why() 命中 Supabase 那条「少了 /rest/v1」，
     腾讯云用户根本没填过地址，看到这句完全无从下手。 */
  ok('COS 的 404 讲的是桶名 / 地域',
    /桶名|地域/.test(CLOUD.why('COS404')) && !/rest\/v1/.test(CLOUD.why('COS404')),
    CLOUD.why('COS404').slice(0, 30));
  ok('Supabase 的 404 才讲 /rest/v1', /rest\/v1/.test(CLOUD.why('HTTP404')));

  global.fetch = async () => ({ status: 404, text: async () => '<Error>NoSuchBucket</Error>' });
  let putErr = '';
  try { await CLOUD.cosPut(cfg, SID, { todos: [] }, '2026-10-22 00:00'); }
  catch (e) { putErr = e.message; }
  ok('上传撞 404 → 报的是 COS404，不是 HTTP404', putErr === 'COS404', putErr);

  global.fetch = async () => ({ status: 404, text: async () => '<Error>NoSuchKey</Error>' });
  const get = await CLOUD.cosGet(cfg, SID);
  ok('读取撞 404 仍算正常（文件还没建）', get === null, JSON.stringify(get));

  ok('界面能拿到实际访问地址（COS 由桶名+地域拼出）',
    CLOUD.at(cfg).indexOf('https://daiban-1250000000.cos.ap-guangzhou') === 0 &&
    CLOUD.at(cfg).indexOf('/daiban/') > 0, CLOUD.at(cfg));

  console.log('\n  合计 ' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : '') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  崩了：' + (e && e.message)); process.exit(1); });
