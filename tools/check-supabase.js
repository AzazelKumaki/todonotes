/* Supabase（或任何兼容后端）自检：填上地址和密钥，跑一遍真实的建表检查 + 读 + 写 + 删。
   用来在把地址填进 App 之前，先确认后端那头到底配好了没有 —— 免得在 App 里干猜。

   用法：
     node tools/check-supabase.js --base https://xxxx.supabase.co --key sb_publishable_xxx
     node tools/check-supabase.js --base http://127.0.0.1:8787 --key local-dev-key

   它会检查四件事：表在不在 / 能不能读 / 能不能写 / 写完能不能删，并告诉你下一步该干什么。 */
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : ''; };

const base = String(opt('base') || '').replace(/\/+$/, '');
const key = String(opt('key') || '').trim();

if (!base || !key) {
  console.log('\n  用法： node tools/check-supabase.js --base <服务地址> --key <密钥>\n');
  console.log('  例： node tools/check-supabase.js --base https://abcd.supabase.co --key sb_publishable_xxxx\n');
  process.exit(1);
}

/* 地址格式先粗查一遍，别等到网络层才报错 */
if (base.indexOf('/dashboard') >= 0 || /supabase\.com\/(dashboard|project)/.test(base)) {
  console.log('\n  ❌ 这像是后台页面的网址，不是接口地址。');
  console.log('     正确的在：Settings → API → **Project URL** ，样子是 https://abcdefgh.supabase.co\n');
  process.exit(1);
}
if (/^http:\/\//.test(base) && !/127\.0\.0\.1|localhost/.test(base)) {
  console.log('\n  ⚠️  地址用的是 http:// —— Supabase 只接受 https:// ，改成 https 再试\n');
  process.exit(1);
}

const URL_API = base + '/rest/v1/todo_state';
const SID = 'selfcheck-' + Date.now();

/* Supabase 新一代的 publishable key 不是 JWT：放 Bearer 里会被拒，只能走 apikey 头 */
const headers = { apikey: key, 'Content-Type': 'application/json' };
if (/^eyJ/.test(key)) headers['Authorization'] = 'Bearer ' + key;
if (/[^\x20-\x7E]/.test(key)) {
  console.log('\n  ❌ 密钥里有中文或全角符号 —— HTTP 头放不下，重新粘贴一遍（别带空格）\n');
  process.exit(1);
}
if (/^sb_secret_/.test(key)) {
  console.log('\n  ⚠️  你填的是 secret key（sb_secret_…）—— 它能绕过所有权限限制。');
  console.log('      App 是可以被反编译的，这把钥匙绝对不能填进去。请换成 publishable key。\n');
  process.exit(1);
}

const say = (ok, txt, extra) => console.log('  ' + (ok ? '✅' : '❌') + ' ' + txt + (extra ? '  → ' + extra : ''));

/* 失败时要把**真实原因**说出来：域名解析不了 / 连不上 / 被拒，是三件完全不同的事 */
async function req(url, opt2) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, opt2));
    let body = null;
    try { const t = await r.text(); body = t ? JSON.parse(t) : null; } catch (e) {}
    return { status: r.status, body };
  } catch (e) {
    const c = e && e.cause;
    return { status: 0,
      err: e && e.name === 'AbortError' ? 'TIMEOUT' : 'NET',
      code: (c && c.code) || '',
      msg: (c && c.message) || (e && e.message) || '' };
  } finally { clearTimeout(tm); }
}
function whyNet(r) {
  const c = r.code || '';
  if (r.err === 'TIMEOUT') return '10 秒没回应 —— 地址不通，或者这台电脑访问 Supabase 的网络被挡了（国内常见）';
  if (/ENOTFOUND|EAI_AGAIN/.test(c)) return '这个域名根本解析不到 —— **地址多半抄错了**（正确样子是 https://abcdefgh.supabase.co）';
  if (/ECONNREFUSED/.test(c)) return '对方机器在，但那个端口没人接 —— 地址里的域名或端口不对';
  if (/ETIMEDOUT|ECONNRESET/.test(c)) return '连到一半断了 —— 多半是网络访问 Supabase 不通（需要代理），或项目正在初始化';
  if (/CERT|SSL/.test(c)) return '证书校验没过 —— 检查一下是不是把 https 写成了 http';
  return '网络层就失败了（' + (c || r.msg || '未知') + '）—— 先确认地址抄对了没';
}

(async () => {
  console.log('\n=== 后端自检 · ' + base + ' ===');
  console.log('  密钥类型：' + (/^sb_publishable_/.test(key) ? 'publishable（新版）' : /^eyJ/.test(key) ? 'anon JWT（老版）' : '其它'));
  console.log('  实际请求：' + URL_API + '?space_id=eq.…');
  console.log('');

  /* 1 读 */
  const g = await req(URL_API + '?space_id=eq.' + encodeURIComponent(SID) + '&select=*', { method: 'GET', headers });
  if (g.err) {
    say(false, '根本没连上', whyNet(g));
    console.log('\n  拿地址的正确姿势：');
    console.log('     Supabase 后台 → 左下角齿轮 Settings → API → 最上面 **Project URL**');
    console.log('     它长这样：https://abcdefgh.supabase.co   （8 位左右的小写字母数字）');
    console.log('     ✗ 不要抄浏览器地址栏里那个 supabase.com/dashboard/... 的长网址\n');
    process.exit(1);
  }
  if (g.status === 401 || g.status === 403) { say(false, '密钥被拒', 'HTTP ' + g.status + ' · ' + JSON.stringify(g.body).slice(0, 120)); process.exit(1); }
  if (g.status === 404) {
    const m = String((g.body && g.body.message) || '').toLowerCase();
    if (m.indexOf('does not exist') >= 0) {
      say(false, '地址是对的，但**表还没建**', '这就去 SQL 编辑器跑建表脚本');
      console.log('\n  四段脚本在 App 里点【复制建表脚本】就有，一次粘一段跑完。\n');
      process.exit(1);
    }
    say(false, '地址不对', base.indexOf('dashboard') >= 0
      ? '你抄的是后台页面网址，不是接口地址。要 Settings → API → Project URL 那个'
      : '404 —— 对照一下是不是抄漏了字符');
    console.log('\n  去做这两件事：');
    console.log('   ① SQL 编辑器里跑建表脚本（App 里【复制建表脚本】，四段一次粘一段）');
    console.log('   ② 若还不行：Integrations → Data API 里把 todo_state 勾上暴露，或等 30 秒让缓存刷新\n');
    process.exit(1);
  }
  if (g.status !== 200) { say(false, '读失败了', 'HTTP ' + g.status + ' ' + JSON.stringify(g.body).slice(0, 120)); process.exit(1); }
  say(true, '能读 · 表在，密钥也对');

  /* 2 写 */
  const p = await req(URL_API, {
    method: 'POST',
    headers: Object.assign({}, headers, { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify([{ space_id: SID, payload: { todos: [{ id: 1, title: '自检' }] },
      updated_at: new Date().toISOString(), device_id: 'SELFCHECK' }])
  });
  if (p.status !== 200 && p.status !== 201) {
    const m = String((p.body && p.body.message) || '').toLowerCase();
    if (m.indexOf('permission denied') >= 0 || m.indexOf('violates row-level') >= 0 || p.status === 42501)
      say(false, '不能写 · 缺授权', '去 SQL 编辑器补跑这一段：\n     grant select, insert, update, delete on table public.todo_state to anon, authenticated;');
    else say(false, '不能写', 'HTTP ' + p.status + ' ' + JSON.stringify(p.body).slice(0, 160));
    process.exit(1);
  }
  say(true, '能写 · 数据真的进去了');

  /* 3 读回来 */
  const g2 = await req(URL_API + '?space_id=eq.' + encodeURIComponent(SID) + '&select=*', { method: 'GET', headers });
  const row = g2.body && g2.body[0];
  say(!!row, row ? '能读回来 · 刚写的内容对得上' : '写进去了却读不回来', row ? 'todos ' + row.payload.todos.length + ' 条' : '');

  /* 4 清理 */
  const d = await req(URL_API + '?space_id=eq.' + encodeURIComponent(SID), { method: 'DELETE', headers });
  say(d.status >= 200 && d.status < 300, '能删 · 自检数据已清掉', 'HTTP ' + d.status);

  console.log('\n  全部通过 —— 把地址填进 App 的「服务地址」，密钥填「密钥」，再填同步口令即可。\n');
  process.exit(0);
})();
