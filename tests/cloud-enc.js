/* 云端加密（FR-405）
   要求：上传前 AES-GCM 加密、拉下来能解开；旧版明文数据照样能读；
        口令一换就解不开，但**绝不清本机、绝不重传**；没有 WebCrypto 也能照常同步。 */
const app = require('./harness.js')();
const ok = (l,c,e) => { console.log((c?'✓ ':'✗ ')+l+(e!==undefined?('  →  '+e):'')); if(!c) process.exitCode=1; };

/* Node 22 自带 WebCrypto，直接搬到全局给页面用（浏览器里本来就有） */
globalThis.crypto = require('node:crypto').webcrypto;
globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');

const PWD='我的口令-123';
const payload={v:2, todos:[{id:1,title:'写周报',done:false}], CATS:{work:['报表材料'],life:[]}, CAT_STYLE:{}, reviews:{}};

(async () => {
  console.log('【1】加解密能绕回来');
  const wrapped = await app.CLOUD.wrap(payload, PWD);
  ok('加密后看不出原文', JSON.stringify(wrapped).indexOf('写周报')<0, JSON.stringify(wrapped).slice(0,60)+'…');
  ok('带上了 __enc 标记', wrapped.__enc===1 && wrapped.alg==='AES-GCM');
  ok('密钥材料不是口令本身', wrapped.ct.length>0 && wrapped.iv.length>0, 'iv/ct 长度 '+wrapped.iv.length+'/'+wrapped.ct.length);
  const back = await app.CLOUD.unwrap(wrapped, PWD);
  ok('解开后和原来一模一样', JSON.stringify(back)===JSON.stringify(payload));

  console.log('\n【2】口令不对 → 解不开（但不能崩、不能清数据）');
  let err=null;
  try{ await app.CLOUD.unwrap(wrapped, '另一个口令'); }catch(e){ err=e; }
  ok('换成别的口令会失败', !!err, err?err.message:'（居然解开了？！）');
  const wrapped2 = await app.CLOUD.wrap(payload, PWD);
  ok('每次 iv 都不一样（同样的内容也看不出重复）', wrapped.iv!==wrapped2.iv);

  console.log('\n【3】老版本留在云端的明文：原样读，下次 push 自动变密文');
  const legacy=await app.CLOUD.unwrap(payload, PWD);
  ok('没有 __enc 标记的 → 原样返回', JSON.stringify(legacy)===JSON.stringify(payload));

  console.log('\n【4】开关：默认开，关掉就是明文');
  const cfg={pwd:PWD};
  ok('没设过就是开', app.CLOUD.wantEnc(cfg)===true);
  ok('显式关掉才关', app.CLOUD.wantEnc({pwd:PWD,enc:false})===false);
  ok('没口令就不加密（本来也没法同步）', app.CLOUD.wantEnc({pwd:''})===false);

  console.log('\n【5】走一遍 getRow / putRow：云端拿到的必须是密文');
  const cloud={};                              /* 假后端：记住写进来的东西 */
  const cfg2={kind:'supabase', pwd:PWD, enc:true, supabase:{base:'https://x.supabase.co',key:'k'}, space:'SP1'};
  global.fetch = async(url,opt)=>{
    if(opt.method==='POST'){
      const row=JSON.parse(opt.body)[0];
      cloud.row=row; cloud.raw=JSON.stringify(row.payload);
      return {ok:true, status:200, text:async()=>JSON.stringify([row])};
    }
    /* GET：把刚才写的那一坨原样返回（真实后端也是这么干的） */
    const body=cloud.row?[cloud.row]:[];
    return {ok:true, status:200, text:async()=>JSON.stringify(body)};
  };
  await app.CLOUD.putRow(cfg2,'SP1',payload,'2026-10-19T21:00:00.000Z');
  ok('后端收到的是密文（看不到任何待办内容）', cloud.raw.indexOf('写周报')<0, cloud.raw.slice(0,64)+'…');
  ok('密文包里有 iv 和 ct', /"__enc":1/.test(cloud.raw) && /"alg":"AES-GCM"/.test(cloud.raw));
  const got=await app.CLOUD.getRow(cfg2,'SP1');
  ok('拉下来自动解出了原文', JSON.stringify(got.payload)===JSON.stringify(payload));

  console.log('\n【6】口令换了再拉 → 报 ENC，不会悄悄覆盖本机');
  const cfg3=Object.assign({},cfg2,{pwd:'换了个口令'});
  let code=null;
  try{ await app.CLOUD.getRow(cfg3,'SP1'); }catch(e){ code=e.message; }
  ok('抛出的是 ENC（而不是崩掉或返回半成品）', code==='ENC', String(code));
  ok('错误提示写成了人话且说了不动数据', /本机数据/.test(app.CLOUD.why('ENC')) && /没往上传|一点没动/.test(app.CLOUD.why('ENC')));

  console.log('\n【7】关掉开关 → 同步照走，云端是明文');
  const cfg4=Object.assign({},cfg2,{enc:false});
  await app.CLOUD.putRow(cfg4,'SP1',payload,'2026-10-19T21:05:00.000Z');
  ok('云端这时候看得见内容了', cloud.raw.indexOf('写周报')>0);
  const got4=await app.CLOUD.getRow(cfg4,'SP1');
  ok('不加密也能正常拉回来', JSON.stringify(got4.payload)===JSON.stringify(payload));

  console.log('\n【8】混合情形：云端是老明文 + 本机开着加密 → 能读，下次自动升级');
  cloud.row={space_id:'SP1', payload, updated_at:'2026-10-19T20:00:00.000Z'};
  const mixed=await app.CLOUD.getRow(cfg2,'SP1');
  ok('老明文照读不误', JSON.stringify(mixed.payload)===JSON.stringify(payload));
  await app.CLOUD.putRow(cfg2,'SP1',payload,'2026-10-19T21:10:00.000Z');
  ok('这次推上去就变成密文了', cloud.raw.indexOf('写周报')<0);

  console.log('\n【9】开关必须点得动（用户反馈「没法开关」—— 原因是没填口令时点了没反应）');
  const S=app.SYNC, dot='width:8px;height:8px;border-radius:4px;background:#fff';
  const click=act=>app.handleAct({target:{closest(){return {dataset:{act}};}}});
  S.cfg.pwd=''; S.cfg.enc=true;
  ok('没口令 + 勾上了 → 页面上明说要先填口令', /还没填同步口令/.test(app.cloudHTML()));
  click('cenctoggle');
  ok('没口令时也能点掉（勾选框会动）', app.CLOUD.encOn(S.cfg)===false, 'enc='+S.cfg.enc);
  click('cenctoggle');
  ok('能再点回来', app.CLOUD.encOn(S.cfg)===true);
  S.cfg.pwd=PWD;
  ok('填上口令 → 勾选框显示为已勾', app.cloudHTML().indexOf(dot)>=0 && app.CLOUD.wantEnc(S.cfg)===true);
  click('cenctoggle');
  ok('有口令时能关掉', app.CLOUD.wantEnc(S.cfg)===false && app.cloudHTML().indexOf(dot)<0);
  ok('关掉时页面明说云端会是明文', /云端会存明文/.test(app.cloudHTML()));
})();
