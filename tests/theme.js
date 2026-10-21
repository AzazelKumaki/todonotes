/* 配色测试（FR-402/403 · V0.4 替换原「自定义背景图」）
   覆盖：预设取色 / 自定义派生 / 两个域各一套 / 明暗判定 / 不进导出 / 「我的」页还原中性 */
const app = require('./harness.js')();
const ok = (l,c,e) => { console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):'')); if(!c) process.exitCode=1; };

const HEX = /^#[0-9A-Fa-f]{6}$/;
function click(act, v, d){
  const el = { dataset:{act, v:(v===undefined?undefined:String(v)), d}, closest(){ return el; } };
  return app.handleAct({ target:{ closest(){ return el; } } });
}
const bodyVar = k => global.document.body.style.getPropertyValue(k);

(async () => {
  console.log('【1】八套预设');
  ok('预设数量不少于 6 套', app.THEMES.length>=6, app.THEMES.length+' 套');
  const bad = app.THEMES.filter(t=>!HEX.test(t.brand)||!HEX.test(t.brand2)||!HEX.test(t.bg)||!HEX.test(t.soft)||!HEX.test(t.brandink));
  ok('每套颜色都齐全且是合法色值', bad.length===0, bad.map(t=>t.k).join(',')||'全部正常');
  ok('预设背景都是浅底（保证白底卡片可读）', app.THEMES.every(t=>app.themeLum(t.bg)>0.9),
     app.THEMES.map(t=>app.themeLum(t.bg).toFixed(2)).join(' '));

  console.log('\n【2】自定义主色 → 自动配一套');
  const p = app.themeFromHex('#E11D48');
  ok('主色就是选的那个', p.brand==='#E11D48', p.brand);
  ok('浅色版比主色亮', app.themeLum(p.brand2)>app.themeLum(p.brand), p.brand2);
  ok('深字版比主色暗', app.themeLum(p.brandink)<app.themeLum(p.brand), p.brandink);
  ok('页面底色依然很浅（不刺眼）', app.themeLum(p.bg)>0.85, p.bg);
  ok('派生出来的四个值都是合法色值', [p.brand2,p.bg,p.soft,p.brandink].every(c=>HEX.test(c)),
     [p.brand2,p.bg,p.soft,p.brandink].join(' '));
  ok('中文 Percent 计算不走样（#000 派生）', app.themeFromHex('#000000').bg!=='#NaN', app.themeFromHex('#000000').bg);

  console.log('\n【3】点按钮换配色');
  click('settheme','violet','work');
  ok('工作域换成紫藤', app.THEME_CFG.work.k==='violet', JSON.stringify(app.THEME_CFG.work));
  ok('落盘了（换设备重开还在）', /violet/.test(global.localStorage.getItem('todo.theme.v1')||''));
  click('settheme','teal','life');
  ok('生活域独立一套，互不影响', app.THEME_CFG.life.k==='teal' && app.THEME_CFG.work.k==='violet',
     'work='+app.THEME_CFG.work.k+' life='+app.THEME_CFG.life.k);

  const picker = global.document.getElementById('cp-work');
  picker.value = '#0099A8';
  click('customtheme', undefined, 'work');
  ok('取色器的颜色被采用', app.THEME_CFG.work.custom===true && app.THEME_CFG.work.brand==='#0099A8',
     JSON.stringify(app.THEME_CFG.work));

  click('resettheme','work');
  ok('还原后回到默认预设', app.THEME_CFG.work.custom===false && app.THEME_CFG.work.k==='blue',
     JSON.stringify(app.THEME_CFG.work));

  console.log('\n【4】渲染时真的套到页面上');
  app.S.tab='note'; app.S.sub=null; app.S.domain='work'; app.render();
  const workBrand = bodyVar('--brand');
  ok('工作域用工作配色', HEX.test(workBrand), workBrand);
  app.S.domain='life'; app.render();
  ok('切到生活域整站换色', bodyVar('--brand')!==workBrand, workBrand+' → '+bodyVar('--brand'));
  ok('背景色变量也跟着换了', bodyVar('--bg').length===7, bodyVar('--bg'));
  app.S.tab='me'; app.render();
  ok('「我的」页回到中性灰（设置与域无关）', bodyVar('--brand')==='' && bodyVar('--bg')==='',
     'brand='+(bodyVar('--brand')||'（未设置）'));

  console.log('\n【5】状态栏图标跟着明暗走（FR-403）');
  const calls=[];
  global.AppBridge = { setBarsDark(v){ calls.push(v); } };
  app.S.tab='note'; app.S.domain='work'; app.render();
  ok('浅底 → 通知原生用深色图标', calls.length>0 && calls[calls.length-1]===true, String(calls[calls.length-1]));
  global.AppBridge = undefined;

  console.log('\n【6】配色不进备份 / 导出 / 同步');
  const json = JSON.stringify(app.buildJSON(app.todos.filter(t=>!t.deleted),'all'));
  ok('导出文件里没有配色数据', json.indexOf('0099A8')<0 && json.indexOf('todo.theme')<0, json.length+' 字节');
  ok('主数据仍然完整', json.indexOf('"todos"')>=0 && json.indexOf('"CATS"')>=0);

  console.log('\n【7】入口没断');
  const me = app.meHTML();
  ok('「我的」页有「换配色」入口', /data-act="theme"/.test(me) && /换配色/.test(me));
  ok('旧入口「背景图」已彻底移除', me.indexOf('背景图')<0 && me.indexOf('pickbg')<0);
})();
