/* APK 真机模式布局验证：无头 Chrome + CDP，把视口Override成真实手机尺寸，
   带 DaibanApp UA 打开页面，检查：
   ① app-mode 认领成功；假状态栏/说明卡/原型标签全隐
   ② 页面撑满视口、无横向滚动、无元素溢出视口
   ③ 日历页格子/底Tab胶囊在小屏手机上不撑破
   跑法： cd tests && node apk-mode-check.js */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const CDP = 9334;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 DaibanApp/0.3';

/* 覆盖从老款小屏到少见超大屏的 CSS 像素宽度（DPR 各异）。
   安卓把 dp 映射成 CSS px，所以布局只认这里的 w/h，与屏幕密度无关。 */
const SIZES = [
  { name: 'tiny-320', w: 320, h: 568, dsf: 2 },
  { name: 'small-360', w: 360, h: 800, dsf: 3 },
  { name: 'mid-384', w: 384, h: 854, dsf: 2.75 },
  { name: 'big-412', w: 412, h: 915, dsf: 2.625 },
  { name: 'xl-480', w: 480, h: 960, dsf: 2 },
];

const MEASURE = `(function(){
  var de=document.documentElement, b=document.body;
  function disp(sel){ var e=document.querySelector(sel); return e?getComputedStyle(e).display:'missing'; }
  var ph=document.getElementById('phone').getBoundingClientRect();
  var cap=document.querySelector('.tabcapsule');
  var cell=document.querySelector('.cell');
  var sw=document.querySelector('.switch');
  var ov=[];
  document.querySelectorAll('.view *').forEach(function(e){
    var r=e.getBoundingClientRect();
    if(r.width>0 && (r.right>window.innerWidth+1 || r.left<-1)) ov.push((e.className||e.tagName)+'@'+Math.round(r.left)+'~'+Math.round(r.right));
  });
  return JSON.stringify({
    appmode:b.classList.contains('app-mode'),
    css:window.innerWidth+'x'+window.innerHeight,
    phone:Math.round(ph.width)+'x'+Math.round(ph.height),
    statusbar:disp('.statusbar'), notes:disp('.notes'),
    screentag:disp('.screentag'),
    tab:disp('.tabbar'), cap:cap?Math.round(cap.getBoundingClientRect().width):'-',
    cell:cell?Math.round(cell.getBoundingClientRect().width):'-',
    sw:sw?Math.round(sw.getBoundingClientRect().width):'-',
    hscroll:de.scrollWidth>window.innerWidth+1,
    pageH:de.scrollHeight,
    overflow:ov.slice(0,4)
  });
})()`;

(async () => {
  console.log('\n=== APK 真机模式布局验证（CDP · 真实手机视口）===\n');
  if (!CHROME) { console.log('  本机没找到 Chrome，跳过'); process.exit(0); }

  const probe = path.join(ROOT, '_apk_probe.html');
  fs.writeFileSync(probe, fs.readFileSync(path.join(ROOT, 'prototype', 'index.html'), 'utf8'), 'utf8');

  const profile = path.join(os.tmpdir(), 'apkprobe-' + Date.now());
  /* 先开 about:blank：页面目标越轻，WS 握手越稳；真页面等连上 CDP 后再导航过去 */
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
    'about:blank'], { stdio: 'ignore' });
  chrome.on('exit', c => console.log('  [chrome 退出 code=' + c + ']'));
  process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

  let list = null, lastErr = '';
  for (let i = 0; i < 40 && !list; i++) {
    await sleep(400);
    try {
      const r = await fetch('http://127.0.0.1:' + CDP + '/json/list',
        { signal: AbortSignal.timeout(2000) });
      list = await r.json();
    } catch (e) { lastErr = e.message; }
  }
  if (!list) { console.log('  调试端口没开（最后一次错误：' + lastErr + '）'); process.exit(1); }
  const page = list.find(t => t.type === 'page');
  if (!page) { console.log('  没找到页面'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  ws.onerror = e => console.log('  [ws error]');
  ws.onclose = e => console.log('  [ws close code=' + e.code + ']');
  /* 连上之前先排队，避免 "Sent before connected"；
     ⚠️ onopen 只能赋值一次（再赋一次会把 opened=true 冲掉，发送就会永远卡队列） */
  let opened = false; const queue = [];
  const openPromise = new Promise(res => {
    ws.onopen = () => { opened = true; queue.forEach(f => f()); queue.length = 0; res(); };
    setTimeout(res, 5000);
  });
  const send = (method, params) => new Promise(res => {
    const doSend = () => {
      const id = ++seq;
      waiters.set(id, res);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); res({}); } }, 5000);
    };
    if (opened) doSend(); else queue.push(doSend);
  });
  const evaluate = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true });
  await openPromise;
  await send('Page.enable'); await send('Network.enable');

  const shots = [];
  let allOk = true;
  const fileUrl = 'file:///' + probe.replace(/\\/g, '/');
  for (const s of SIZES) {
    await send('Emulation.setDeviceMetricsOverride',
      { width: s.w, height: s.h, deviceScaleFactor: s.dsf, mobile: true });
    await send('Network.setUserAgentOverride', { userAgent: UA });
    await send('Page.navigate', { url: fileUrl });
    /* 等新文档就绪再量（导航后立刻求值会拿到空响应） */
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const rr = await evaluate('document.readyState');
      if (rr.result && rr.result.result && rr.result.result.value === 'complete') break;
    }
    await sleep(600);
    /* 首页度量 */
    let r = await evaluate(MEASURE);
    let m = JSON.parse((r.result && r.result.result && r.result.result.value) || '{}');
    /* 点到日历页再量一次（日历格是唯一可能被撑破的固定网格） */
    await evaluate("document.querySelector('[data-act=\"tab\"][data-v=\"calendar\"]').click()");
    await sleep(600);
    r = await evaluate(MEASURE);
    const m2 = JSON.parse((r.result && r.result.result && r.result.result.value) || '{}');
    /* 状态栏预留机制：安卓壳会把真实系统栏高度注入成 --sysbar-top / --sysbar-bottom。
       这里手动注入模拟一遍，验证 .phone 真的让出空间、内容不会被压到状态栏底下 */
    await evaluate("document.documentElement.style.setProperty('--sysbar-top','44px');"
      + "document.documentElement.style.setProperty('--sysbar-bottom','16px')");
    await sleep(200);
    const ri = await evaluate("(function(){var p=getComputedStyle(document.getElementById('phone'));"
      + "var v=document.getElementById('view').getBoundingClientRect();"
      + "return p.paddingTop+'/'+p.paddingBottom+'|viewTop='+Math.round(v.top)})()");
    const inset = (ri.result && ri.result.result && ri.result.result.value) || '';
    /* 截图留档（临时目录，看完即删） */
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(os.tmpdir(), 'apk-' + s.name + '.png');
    try { fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64')); shots.push(file); } catch (e) {}

    /* 断言：.phone 的上下预留必须等于注入值；内容起点只要 ≥44（状态栏高度）即可——
       上面还可能有固定域切换栏（2026-10-18 起），所以不能写死 44 */
    const mInset = inset.match(/^(\d+)px\/(\d+)px\|viewTop=(\d+)$/);
    const insetOk = !!mInset && mInset[1] === '44' && mInset[2] === '16' && +mInset[3] >= 44;
    /* 上限保护：注入离谱的大值（模拟 ROM 报错 / 忘了除密度），必须被 min() 压住，
       不能留出一大块空白（2026-10-18 真机踩过：物理像素当 CSS 像素注入，空白放大 2~3 倍） */
    await evaluate("document.documentElement.style.setProperty('--sysbar-top','200px');"
      + "document.documentElement.style.setProperty('--sysbar-bottom','200px')");
    await sleep(200);
    const rc = await evaluate("(function(){var p=getComputedStyle(document.getElementById('phone'));"
      + "return p.paddingTop+'/'+p.paddingBottom})()");
    const cap = (rc.result && rc.result.result && rc.result.result.value) || '';
    const capOk = cap === '96px/48px';
    /* V0.4 交付版起，原型标签（A1/A2 那个小方块）和桌面说明卡在页面里已经**不存在**了，
       量到的是 'missing' —— 比 display:none 更彻底，也算通过。 */
    const hidden = v => v === 'none' || v === 'missing';
    const ok = m.appmode && hidden(m.statusbar) && hidden(m.notes) && hidden(m.screentag)
      && !m.hscroll && m.overflow.length === 0 && m2.cell !== '-' && insetOk && capOk;
    allOk = allOk && ok;
    console.log('  [' + s.name + ' ' + s.w + 'x' + s.h + '] ' + (ok ? 'OK' : 'FAIL'));
    console.log('    首页  appmode=' + m.appmode + ' css=' + m.css + ' phone=' + m.phone
      + ' 假状态栏=' + m.statusbar + ' 说明卡=' + m.notes + ' 原型标签=' + m.screentag);
    console.log('    横向滚动=' + (m.hscroll ? '有' : '无') + ' 溢出元素=' + (m.overflow.length ? m.overflow.join(', ') : '无')
      + ' 域切换器宽=' + m.sw);
    console.log('    日历页 cell=' + m2.cell + 'px tab胶囊=' + m2.cap + 'px 页高=' + m2.pageH);
    console.log('    状态栏预留（注入 44/16px）→ ' + (insetOk ? 'OK ' + inset : 'FAIL ' + inset));
    console.log('    离谱值上限（注入 200/200px）→ ' + (capOk ? 'OK ' + cap : 'FAIL ' + cap));
  }

  try { ws.close(); } catch (e) {}
  chrome.kill();
  try { fs.unlinkSync(probe); } catch (e) {}
  console.log('\n  截图：' + shots.join(' · '));
  console.log('  ' + (allOk ? '全部通过' : '有失败项，见上面') + '\n');
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.log('  崩了：' + (e && e.message)); process.exit(1); });
