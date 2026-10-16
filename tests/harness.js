/* 测试脚手架：把 index.html 里的内联脚本在 Node 里跑起来 */
const fs = require('fs'), vm = require('vm');

class El {
  constructor(tag){ this.tag=tag; this.dataset={}; this.style={}; this.children=[];
    this.innerHTML=''; this.value=''; this.textContent=''; this.scrollTop=0;
    this.classList={add(){},remove(){},contains(){return false}}; }
  appendChild(c){ this.children.push(c); return c; }
  remove(){}
  querySelectorAll(){ return []; }
  querySelector(){ return null; }
  addEventListener(){}
  focus(){}
  setSelectionRange(){}
  closest(){ return null; }
  setAttribute(){}
  getBoundingClientRect(){ return {top:0,height:0,left:0,width:0}; }
}

module.exports = function load(){
  const nodes = {};
  global.document = {
    getElementById(id){ return nodes[id] || (nodes[id] = new El('div')); },
    createElement(t){ return new El(t); },
    querySelectorAll(){ return []; },
    addEventListener(){},
    body: new El('body'),
  };
  global.window = global;
  global.setInterval = () => 0;
  global.addEventListener = () => {};        /* V0.3：页面里监听了 window 的 online 事件 */

  /* localStorage：key 要能被 Object.keys 枚举出来（浏览器里就是这样）*/
  const store = {};
  const LS = {
    getItem(k){ return Object.prototype.hasOwnProperty.call(store,k) ? store[k] : null; },
    setItem(k,v){ store[k]=String(v); Object.defineProperty(LS,k,{value:store[k],enumerable:true,configurable:true,writable:true}); },
    removeItem(k){ delete store[k]; delete LS[k]; },
    _store: store,
  };
  global.localStorage = LS;

  const html = fs.readFileSync('../prototype/index.html','utf8');
  let code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  code += '\n;globalThis.__app={todos,CATS,CAT_STYLE,reviews,S,AI,REV,BAK,dbSave:DB.save,doParse,doParseAsync,llmChat,inboxMissing,fetchModels,bakHTML,handleAct,applyParse,keepManual,manualCount,dropIndex,prepareImport,mergeImport,overwriteImport,parseImport,posKey,backupHTML,doExport,buildJSON,buildCSV,render,PROMPTS,fmtD,nowStamp,shift,TODAY,APPVER,'
       + 'CLOUD,SYNC,DEVID,SQL_SETUP,copyText,cloudHTML,meHTML};';
  vm.runInThisContext(code, {filename:'inline.js'});
  return globalThis.__app;
};
