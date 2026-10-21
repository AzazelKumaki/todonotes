/* 在线更新（FR-401）
   版本源 = GitHub Releases；核心要求：查不到 / 断网 / 404 都**静默**（规则 13），
   下载链接只认 GitHub 自家域名，网页版不做"检查更新"而是给一句说明。 */
const app = require('./harness.js')();
const ok = (l,c,e) => { console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):'')); if(!c) process.exitCode=1; };

function click(act, v){
  const el = { dataset:{act, v:(v===undefined?undefined:String(v))}, closest(){ return el; } };
  return app.handleAct({ target:{ closest(){ return el; } } });
}
const rel = (tag, apkName) => ({ tag_name:tag, body:'更新说明 mock',
  assets: apkName?[{name:apkName, browser_download_url:'https://github.com/x/y/releases/download/'+tag+'/'+apkName}]:[] });
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
  console.log('【1】版本号识别');
  ok('V0.4（M4 · xxx）能析出 0.4', app.UPD.ver('V0.4（M4 · 更新与配色）')==='0.4', app.UPD.ver('V0.4（M4 · 更新与配色）'));
  ok('v0.10 这种也能认', app.UPD.ver('v0.10')==='0.10');
  ok('0.10 > 0.4（不是按字符串排）', app.UPD.cmp('0.10','0.4')>0);
  ok('版本相同 = 0', app.UPD.cmp('0.4','0.4')===0);

  console.log('\n【2】地址白名单（防止哪天被换成野链接）');
  ok('GitHub 附件放行', app.UPD.okUrl('https://github.com/a/b/releases/download/v1/x.apk'));
  ok('对象存储域名放行', app.UPD.okUrl('https://objects.githubusercontent.com/x'));
  ok('别的域名一律拒绝', !app.UPD.okUrl('https://evil.com/x.apk') && !app.UPD.okUrl('http://github.com/x'));

  console.log('\n【3】真用一个假接口走一遍：已是最新');
  global.AppBridge = { isApp:()=>true, getVersionName:()=>'0.4' };
  global.fetch = async()=>({ok:true, json:async()=>rel('v0.4','待办清单-V0.4.apk')});
  app.UPD.st.latest=''; app.UPD.st.apk='';
  let r = await app.UPD.check();
  ok('返回「已是最新」', r==='latest', r);
  ok('记住了 apk 地址', /^https:\/\/github\.com\//.test(app.UPD.st.apk), app.UPD.st.apk);
  ok('记住了检查时间', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(app.UPD.st.checkedAt), app.UPD.st.checkedAt);

  console.log('\n【4】有新版本');
  global.fetch = async()=>({ok:true, json:async()=>rel('v0.5','待办清单-V0.5.apk')});
  r = await app.UPD.check();
  ok('返回「有新版本」', r==='new', r);
  ok('版本号对', app.UPD.st.latest==='0.5', app.UPD.st.latest);
  ok('解析到附件', app.UPD.st.apk.indexOf('V0.5.apk')>0, app.UPD.st.apk);

  console.log('\n【5】404 / 断网 / 超时 → 静默，不打扰');
  global.fetch = async()=>({ok:false, status:404, json:async()=>({})});
  ok('仓库还没发过版本 → 当没查到', await app.UPD.check()==='none');
  global.fetch = async()=>{ throw new TypeError('Failed to fetch'); };
  ok('断网 → 当没查到', await app.UPD.check()==='none');
  global.fetch = ()=>new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),10));
  ok('超时 → 当没查到', await app.UPD.check()==='none');
  ok('三种失败都没写进「有新版本」', app.UPD.st.latest==='0.5');   /* 保持上一次查到的值，不会被清成空 */

  console.log('\n【6】点「下载并安装」—— 交原生，且必须校验域名');
  const calls=[];
  global.AppBridge.installApk = u=>calls.push(u);
  app.UPD.st.apk='https://evil.com/x.apk';
  app.UPD.install();
  ok('野链接不会交给原生去下', calls.length===0, '原生没被调用');

  console.log('\n【7】网页版（非 APK）不给安装');
  global.AppBridge = { isApp:()=>false, installApk:u=>calls.push(u) };
  app.UPD.install();
  ok('网页版不会触发安装', calls.length===0, calls.join(',')||'原生没被调用');

  console.log('\n【8】入口还在，且显示的是真版本号');
  global.AppBridge = { isApp:()=>true, getVersionName:()=>'0.4' };
  const me = app.meHTML();
  ok('「我的」页有检查更新', /data-act="update"/.test(me));
  ok('显示的是 App 报的版本号', /检查更新 · 当前 0\.4/.test(me), (me.match(/检查更新[^<]*/)||[''])[0]);

  console.log('\n【9】点进去会真的去查（不再是一句空话）');
  global.fetch = async()=>({ok:true, json:async()=>rel('v0.5','待办清单-V0.5.apk')});
  const phone = global.document.getElementById('phone');
  const before = phone.children.length;
  click('update');
  await sleep(40);
  const added = phone.children.slice(before).map(c=>c.innerHTML||'').join('');
  ok('真的弹出了东西', phone.children.length>before, before+' → '+phone.children.length);
  ok('弹窗里写着有新版本', /有新版本/.test(added), (added.match(/有新版本[^<]*/)||['（没找到）'])[0]);
  ok('弹窗里给了两个按钮', /updinstall/.test(added) && /updpage/.test(added));

  console.log('\n【10】网页版也能检查更新（Release 里放了网页文件就要能对版本）');
  global.AppBridge = { isApp:()=>false };
  global.fetch = async()=>({ok:true, json:async()=>rel('v0.5','待办清单-V0.5.apk')});
  const b2 = phone.children.length;
  click('update');
  await sleep(40);
  const a2 = phone.children.slice(b2).map(c=>c.innerHTML||'').join('');
  ok('网页版也弹「有新版本」', /有新版本/.test(a2), (a2.match(/有新版本[^<]*/)||['（没找到）'])[0]);
  ok('对比的是网页自己的版本号', /当前 0\.4/.test(a2), (a2.match(/当前[^·<]*/)||[''])[0]);
  ok('网页版没有「下载并安装」按钮（电脑上装不了 APK）', !/updinstall/.test(a2));
  ok('给了「到发布页下载」兜底', /updpage/.test(a2));
  global.AppBridge = undefined;
})();
