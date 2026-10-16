/* 待办清单 · 本地同步服务器（试用用）
   ------------------------------------------------------------------
   这是一个**零依赖**的 Node 服务，实现了 Supabase / PostgREST 的最小子集，
   唯一目的：让你 **不用注册任何账号**，就能在本机把云同步整条链路跑通。

   用法：
     node sync-server.js                         默认端口 8787，密钥 local-dev-key
     node sync-server.js --port 9000 --key abc    自己指定端口和密钥

   在 App 里填：
     服务地址  http://127.0.0.1:8787        （电脑上双击打开的那份）
     服务地址  http://192.168.x.x:8787      （手机 App 用局域网那个）
     密钥      local-dev-key
     同步口令  自己起一个（两台必须一样）

   数据在同目录的 sync-data.json 里。**这是个试用服务器，只跑在你自己电脑上，
   别把它当正式的云用。** 想用真正的云，去 Supabase 建个免费项目，
   跑 App 里【复制建表脚本】那三段 SQL，然后把地址/密钥换成它的即可 —— App 代码一行都不用改。
   ------------------------------------------------------------------ */
const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const opt  = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const PORT = parseInt(opt('port', '8787'), 10) || 8787;
const KEY  = opt('key', 'local-dev-key');
const FILE = path.join(__dirname, 'sync-data.json');

let rows = {};
try { rows = (JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}).rows || {}; } catch (e) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(FILE, JSON.stringify({ rows }, null, 2)); } catch (e) {}
  }, 200);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'apikey,authorization,content-type,x-client-info,prefer,access-control-request-private-network');
  res.setHeader('Access-Control-Max-Age', '3600');
  /* Chrome 的「本地网络保护」：网页要访问 127.0.0.1 / 192.168.x.x 这类**内网地址**时，
     预检会多问一句 Allow-Private-Network，不点头浏览器就把请求掐了。
     注意：这条只对内网地址生效 —— 换成 Supabase 那种公网 HTTPS 地址就不需要。 */
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
function json(res, code, body) {
  const s = JSON.stringify(body);
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json;charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}
function lanIP() {
  let best = '';
  Object.values(os.networkInterfaces()).forEach(list => {
    (list || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) {
        if (/^192\.168\./.test(i.address)) best = best || i.address;
        else if (!best && /^10\./.test(i.address)) best = i.address;
      }
    });
  });
  return best;
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const key = req.headers.apikey || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (url.pathname !== '/rest/v1/todo_state') {
    return json(res, 404, { message: `relation "public.${url.pathname.replace(/\//g, '.')}" does not exist` });
  }
  if (key !== KEY) return json(res, 401, { message: 'Invalid API key' });

  /* ---- 读 ---- */
  if (req.method === 'GET') {
    const f = url.searchParams.get('space_id');
    let out = Object.values(rows);
    if (f && /^eq\./.test(f)) {
      const sid = decodeURIComponent(f.slice(3));
      out = out.filter(r => r.space_id === sid);
    }
    log('GET   ' + (f ? decodeURIComponent(f.slice(3)).slice(0, 10) + '…' : '全部') + '  →  ' + out.length + ' 行');
    return json(res, 200, out);
  }

  /* ---- 写（upsert）---- */
  if (req.method === 'POST' || req.method === 'PATCH') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 8e6) req.destroy(); });
    req.on('end', () => {
      let arr = [];
      try { arr = JSON.parse(raw || '[]'); } catch (e) { return json(res, 400, { message: 'bad json' }); }
      if (!Array.isArray(arr)) arr = [arr];
      const rep = String(req.headers.prefer || '').indexOf('return=representation') >= 0;
      const out = [];
      arr.forEach(r => {
        if (!r || !r.space_id) return;
        const old = rows[r.space_id];
        rows[r.space_id] = Object.assign({}, old, r);
        out.push(rows[r.space_id]);
      });
      save();
      out.forEach(r => log('PUT   ' + String(r.space_id).slice(0, 10) + '…  ←  ' +
        ((r.payload && r.payload.todos) ? r.payload.todos.length + ' 条待办' : '?') +
        '  · 来自 ' + (r.device_id || '?')));
      return json(res, 201, rep ? out : []);
    });
    return;
  }

  /* ---- 删 ---- */
  if (req.method === 'DELETE') {
    const f = url.searchParams.get('space_id');
    if (f && /^eq\./.test(f)) delete rows[decodeURIComponent(f.slice(3))];
    else rows = {};
    save();
    log('DEL   ' + (f ? decodeURIComponent(f.slice(3)).slice(0, 10) + '…' : '全部'));
    return json(res, 200, []);
  }

  json(res, 405, { message: 'method not allowed' });
});

function log(s) {
  const t = new Date();
  const ts = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
  console.log('[' + ts + '] ' + s);
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.log('');
  console.log('  待办清单 · 本地同步服务器已启动');
  console.log('  ────────────────────────────────────────');
  console.log('  服务地址（电脑上这份 App 填） : http://127.0.0.1:' + PORT);
  console.log('  服务地址（手机 App 填这个）   : ' + (ip ? 'http://' + ip + ':' + PORT : '没查到局域网地址，用 ipconfig 看'));
  console.log('  密钥                         : ' + KEY);
  console.log('  数据文件                     : ' + FILE);
  console.log('  ────────────────────────────────────────');
  console.log('  同步口令两台设备填一样的。Ctrl+C 停止。');
  console.log('');
});
