/* V0.3 浏览器实测：无头 Chrome **双击打开本地 HTML**（file:// 场景），跑一遍完整同步。
   这一步验证两件只有浏览器才验得了的事：
     ① file:// 页面能不能带 apikey 头**跨域写**数据（同步最关键的那一半）
     ② PBKDF2 派生、界面渲染在这条路上是不是都正常
   结果靠 Chrome 调试协议（CDP）读出来 —— 不依赖页面自己回传，断了也能看到卡在哪一步。
   跑法： cd tests && node browser-check.js */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8899, KEY = 'demo-key-123', BASE = 'http://127.0.0.1:' + PORT, CDP = 9333;
const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'tools', 'sync-server.js');
const PROBE = path.join(ROOT, 'probe-cloud.html');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const probeScript = `
<pre id="OUT" style="position:fixed;left:0;top:0;z-index:99999;background:#fff;font-size:12px">start</pre>
<script>
window.onerror = function(m){ var o=document.getElementById('OUT');
  if(o) o.textContent += '\\nJS ERROR: ' + m; };
(async () => {
  const o = document.getElementById('OUT');
  const say = s => { o.textContent += '\\n' + s; };
  try {
    say('1 页面来源 = ' + location.origin + ' · isSecureContext=' + window.isSecureContext +
        ' · crypto.subtle=' + !!(window.crypto && crypto.subtle));
    say('  本机待办 = ' + todos.length + ' 条');

    SYNC.cfg.on = true; SYNC.cfg.kind = 'supabase';
    SYNC.cfg.supabase = { base: '${BASE}', key: '${KEY}' };
    SYNC.cfg.pwd = 'abc123'; SYNC.cfg.space = ''; SYNC.cfg.at = ''; SYNC.cfg.fp = '本机改过';
    SYNC.save();

    const sid = await SYNC.sid();
    say('2 space_id = ' + sid.slice(0, 14) + '… （口令派生，口令没上传）');

    const t = await CLOUD.test(SYNC.cfg);
    say('3 连接测试 = ' + (t.ok ? 'OK · ' + t.msg : t.code + ' · ' + t.msg));

    const r1 = await SYNC.run({ manual: true });
    say('4 第一次同步 = ' + JSON.stringify(r1));
    say('  状态栏 = ' + SYNC.st.msg);

    /* 假装另一台设备改了数据（这一步是 POST —— 验证跨域写） */
    const w = await fetch('${BASE}/rest/v1/todo_state', {
      method: 'POST',
      headers: { apikey: '${KEY}', authorization: 'Bearer ${KEY}', 'content-type': 'application/json' },
      body: JSON.stringify([{ space_id: sid,
        payload: { todos: [{ id: 777777, title: '另一台设备加的', updatedAt: '2099-01-01 00:00' }] },
        updated_at: new Date(Date.now() + 60000).toISOString(), device_id: 'DEVICE-B' }])
    });
    say('5 模拟对方写入 = HTTP ' + w.status);

    SYNC.cfg.at = '2000-01-01T00:00:00.000Z'; SYNC.cfg.fp = SYNC.fp();
    const before = todos.length;
    const r2 = await SYNC.run({ manual: true });
    say('6 第二次同步 = ' + JSON.stringify(r2));
    say('  条数 = ' + before + ' → ' + todos.length +
        (todos.find(x => x.id === 777777) ? ' · 对方那条进来了' : ' · 没进来'));

    S.tab = 'me'; S.sub = 'cloud'; render();
    say('7 配置页渲染 = ' + (document.getElementById('view').innerHTML.indexOf('云同步') >= 0 ? 'OK' : 'FAIL'));
    const cc = meHTML().replace(/<[^>]+>/g, ' ');
    say('  我的页状态 = ' + ((cc.match(/云同步 · [^ ]+/) || ['?'])[0]));
  } catch (e) {
    say('出错 -> ' + (e && e.message || e));
  }
  say('__DONE__');
})();
</script>`;

(async () => {
  console.log('\n=== V0.3 浏览器实测（无头 Chrome 打开 file:// 页面）===\n');
  if (!CHROME) { console.log('  本机没找到 Chrome，跳过'); process.exit(0); }

  const srv = spawn(process.execPath, [SERVER, '--port', String(PORT), '--key', KEY], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('服务器没起来')), 8000);
    srv.stdout.on('data', d => { if (String(d).indexOf('已启动') >= 0) { clearTimeout(to); res(); } });
  });

  const html = fs.readFileSync(path.join(ROOT, 'prototype', 'index.html'), 'utf8');
  fs.writeFileSync(PROBE, html.replace('</body>', probeScript + '\n</body>'), 'utf8');

  const profile = path.join(os.tmpdir(), 'dbprobe-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
    'file:///' + PROBE.replace(/\\/g, '/')], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 30 && !list; i++) {
    await sleep(400);
    try { const r = await fetch('http://127.0.0.1:' + CDP + '/json/list'); list = await r.json(); } catch (e) {}
  }
  if (!list) { console.log('  调试端口没开'); chrome.kill(); srv.kill(); process.exit(1); }
  const page = list.find(t => t.type === 'page');
  if (!page) { console.log('  没找到页面'); chrome.kill(); srv.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const evaluate = expr => new Promise(res => {
    const id = ++seq;
    waiters.set(id, res);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); res({}); } }, 3000);
  });
  await new Promise(res => { ws.onopen = () => res(); setTimeout(res, 3000); });

  let text = '';
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const r = await evaluate('document.getElementById("OUT").textContent');
    const v = (r.result && r.result.result && r.result.result.value) || '';
    if (v.length > text.length) text = v;
    if (text.indexOf('__DONE__') >= 0) break;
  }
  try { ws.close(); } catch (e) {}
  chrome.kill(); srv.kill();
  try { fs.unlinkSync(PROBE); } catch (e) {}
  try { fs.unlinkSync(path.join(ROOT, 'tools', 'sync-data.json')); } catch (e) {}

  const lines = String(text).split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) { console.log('  什么都没读到'); process.exit(1); }
  console.log(lines.map(s => '  ' + s).join('\n'));
  const bad = lines.some(s => /ERROR|出错|FAIL|没进来|"ok":false/.test(s));
  console.log('\n  ' + (bad ? '有失败项，见上面' : '浏览器实测通过') + '\n');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('  崩了：' + (e && e.message)); process.exit(1); });
