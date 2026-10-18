/* V0.3 端到端：真起一个本地服务器，让 App 的 CLOUD 层走**真实 HTTP**跑一遍。
   跑法： cd tests && node e2e-local-sync.js
   这一步验证的是「服务器 + 协议」；浏览器侧的跨域能力另有探针验证（两者互不替代）。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8899, KEY = 'test-key-123', PWD = '我的口令777';
const SERVER = path.join(__dirname, '..', 'tools', 'sync-server.js');
const DATA = path.join(__dirname, '..', 'tools', 'sync-data.json');

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log('  ✅ ' + n + (e ? '  → ' + e : ''))) : (fail++, console.log('  ❌ ' + n + (e ? '  → ' + e : ''))); };

(async () => {
  console.log('\n=== V0.3 端到端 · 本地同步服务器 ===\n');
  try { fs.unlinkSync(DATA); } catch (e) {}

  const child = spawn(process.execPath, [SERVER, '--port', String(PORT), '--key', KEY], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', d => console.log('   [server] ' + String(d).trim()));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('服务器没起来')), 8000);
    child.stdout.on('data', d => { if (String(d).indexOf('已启动') >= 0) { clearTimeout(t); res(); } });
  });
  ok('本地服务器起来了', true, 'http://127.0.0.1:' + PORT);

  /* ---- 真实环境里的 App ---- */
  const app = require('./harness')();
  const { CLOUD, SYNC } = app;

  const cfg = { base: 'http://127.0.0.1:' + PORT, key: KEY, pwd: PWD };
  const t0 = await CLOUD.test(cfg);
  ok('连接测试走真实调用通过', t0.ok, t0.msg);

  const badKey = await CLOUD.test({ base: cfg.base, key: 'wrong-key', pwd: PWD });
  ok('密钥错了会被挡下', !badKey.ok && badKey.code === 'KEY', badKey.msg);

  /* 密钥里混进中文 → 不能误导成"对方不给跨域" */
  const cnKey = await CLOUD.test({ base: cfg.base, key: '错的密钥', pwd: PWD });
  ok('密钥含中文 → 明确点出来', !cnKey.ok && cnKey.code === 'KEYCHAR', cnKey.msg);

  const sid = await CLOUD.sid(PWD);
  const got0 = await CLOUD.getRow(cfg, sid);
  ok('新环境里查不到任何数据（干净起步）', got0 === null);

  /* ---- 第一次同步：把本机 15 条推上去 ---- */
  SYNC.cfg.on = true; SYNC.cfg.kind = 'supabase';
  SYNC.cfg.supabase = { base: cfg.base, key: cfg.key };
  SYNC.cfg.pwd = cfg.pwd; SYNC.cfg.space = sid;
  SYNC.cfg.at = ''; SYNC.cfg.fp = '本机改过';
  const r1 = await SYNC.run({ manual: true });
  ok('首次同步成功', r1.ok && r1.how === 'pushed', JSON.stringify(r1));

  await new Promise(r => setTimeout(r, 400));      // 服务器写盘有 200ms 防抖
  const disk = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const key = Object.keys(disk.rows)[0];
  ok('云端真的落了一行', !!key, String(key).slice(0, 12) + '…');
  ok('云端存的就是派生出来的 space_id', key === sid);
  ok('**云端查不到口令原文**', String(fs.readFileSync(DATA, 'utf8')).indexOf(PWD) < 0);
  ok('推上去的条数对得上', disk.rows[key].payload.todos.length === app.todos.length,
    disk.rows[key].payload.todos.length + ' 条');
  ok('带了版本号，将来好排错', disk.rows[key].app_ver.indexOf('V0.3') >= 0, disk.rows[key].app_ver);

  /* ---- 模拟第二台设备改了数据，本机再拉 ---- */
  const remote = disk.rows[key];
  await fetch('http://127.0.0.1:' + PORT + '/rest/v1/todo_state', {
    method: 'POST',
    headers: { apikey: KEY, authorization: 'Bearer ' + KEY, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify([{
      space_id: sid,
      payload: { todos: [{ id: 424242, title: '另一台设备新增的', updatedAt: '2099-01-01 00:00' }] },
      updated_at: new Date(Date.now() + 60000).toISOString(), device_id: 'DEVICE-B'
    }])
  });
  const before = app.todos.length;
  SYNC.cfg.at = '2000-01-01T00:00:00.000Z'; SYNC.cfg.fp = SYNC.fp();   // 本机没改
  const r2 = await SYNC.run({ manual: true });
  ok('从另一台设备拉到了数据', r2.ok && r2.how === 'pulled', JSON.stringify(r2));
  ok('是合并进来的，本机数据没被清掉', app.todos.length === before + 1, before + ' → ' + app.todos.length);
  ok('那条新待办真的在列表里了', !!app.todos.find(t => t.id === 424242));

  child.kill();
  try { fs.unlinkSync(DATA); } catch (e) {}
  console.log('\n  合计 ' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : '') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('  崩了：' + (e && e.message || e));
  try { require('child_process').execSync('taskkill /F /FI "WINDOWTITLE eq *sync-server*" 2>nul'); } catch (x) {}
  process.exit(1);
});
