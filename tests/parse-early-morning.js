/* 凌晨特例回归：00:00~03:59 之间说「明天/明早/明晚」= 当天；04:00 后按字面。
   做法：每个场景起一个子进程，子在加载 harness 前把全局 Date 冻在指定时刻，
   再调 doParse（规则版）。父进程汇总。AI 提示词也断言含同一条规则（口径一致）。
   跑法： cd tests && node parse-early-morning.js */
const { spawnSync } = require('child_process');
const path = require('path');

/* 冻时间：new Date() 无参 → 返回冻结时刻；带参 / Date.now() 正常 */
function freezeAt(y, mo, d, h, mi) {
  const Real = Date;
  const fixed = new Real(y, mo, d, h, mi).getTime();
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length === 0) return new Real(fixed); return new Real(...a); }
    static now() { return fixed; }
  };
}

/* ---- 子进程模式：node parse-early-morning.js --child "年,月,日,时,分" '<用例JSON>' ---- */
if (process.argv[2] === '--child') {
  const [y, mo, d, h, mi] = process.argv[3].split(',').map(Number);
  const cases = JSON.parse(process.argv[4]);
  freezeAt(y, mo, d, h, mi);
  const app = require('./harness')();
  const out = cases.map(c => {
    const r = app.doParse(c.say);
    const got = {};
    for (const k of Object.keys(c.expect)) got[k] = r[k];
    return { name: c.name, got, want: c.expect, ok: JSON.stringify(got) === JSON.stringify(c.expect) };
  });
  /* 提示词口径检查（跟时间无关，放在第一个场景里断言一次即可） */
  if (process.argv[5] === 'prompt') {
    out.push({ name: '提示词含凌晨特例', got: /凌晨特例/.test(app.PROMPTS.parseSys), want: true, ok: /凌晨特例/.test(app.PROMPTS.parseSys) });
    out.push({ name: '提示词含 00:00~03:59 窗口', got: /00:00~03:59/.test(app.PROMPTS.parseSys), want: true, ok: /00:00~03:59/.test(app.PROMPTS.parseSys) });
  }
  console.log('@@' + JSON.stringify(out));
  process.exit(0);
}

/* ---- 父进程：三个时间场景 ---- */
const SCENARIOS = [
  {
    label: '凌晨 00:30（2026-10-19 周一）', at: '2026,9,19,0,30', prompt: 'yes',
    cases: [
      { say: '明早8点交报告', expect: { due: '2026-10-19', time: '08:00' }, name: '明早8点 → 当天 08:00' },
      { say: '明天下午3点开会', expect: { due: '2026-10-19', time: '15:00' }, name: '明天下午3点 → 当天 15:00' },
      { say: '明晚8点倒垃圾', expect: { due: '2026-10-19', time: '20:00' }, name: '明晚8点 → 当天 20:00' },
      { say: '后天去体检', expect: { due: '2026-10-20' }, name: '后天 → +1 天' },
      { say: '今天要把周报了了', expect: { due: '2026-10-19' }, name: '今天 → 当天（不变）' },
    ],
  },
  {
    label: '上午 10:30（同一句话，按字面）', at: '2026,9,19,10,30',
    cases: [
      { say: '明早8点交报告', expect: { due: '2026-10-20', time: '08:00' }, name: '明早8点 → 隔天 08:00' },
      { say: '明天下午3点开会', expect: { due: '2026-10-20', time: '15:00' }, name: '明天下午3点 → 隔天' },
      { say: '后天去体检', expect: { due: '2026-10-21' }, name: '后天 → +2 天' },
      { say: '今晚8点早睡', expect: { time: '20:00' }, name: '今晚8点 → 20:00（不变）' },
    ],
  },
  {
    label: '边界 03:59 / 04:00', at: '2026,9,19,3,59',
    cases: [
      { say: '明早7点跑步', expect: { due: '2026-10-19' }, name: '03:59 明早 → 当天' },
    ],
  },
];

let bad = 0, total = 0;
for (const sc of SCENARIOS) {
  console.log('\n【' + sc.label + '】');
  const r = spawnSync(process.execPath,
    [path.join(__dirname, 'parse-early-morning.js'), '--child', sc.at,
      JSON.stringify(sc.cases), sc.prompt ? 'prompt' : ''],
    { encoding: 'utf8' });
  const line = String(r.stdout).split('\n').find(l => l.startsWith('@@'));
  if (!line) { console.log('  ✗ 子进程没输出：' + (r.stderr || '').split('\n')[0]); bad++; continue; }
  for (const c of JSON.parse(line.slice(2))) {
    total++;
    console.log('  ' + (c.ok ? '✓ ' : '✗ ') + c.name + (c.ok ? '' : '  →  实得 ' + JSON.stringify(c.got) + ' · 期望 ' + JSON.stringify(c.want)));
    if (!c.ok) bad++;
  }
}

/* 凌晨中段（02:30，以前算字面、现在算当天）和 04:00 整点各来一个子进程 */
{
  const r = spawnSync(process.execPath,
    [path.join(__dirname, 'parse-early-morning.js'), '--child', '2026,9,19,2,30',
      JSON.stringify([{ say: '明早7点跑步', expect: { due: '2026-10-19' }, name: '02:30 明早 → 当天（0~4 点窗口内）' }])],
    { encoding: 'utf8' });
  const line = String(r.stdout).split('\n').find(l => l.startsWith('@@'));
  console.log('\n【凌晨中段 02:30】');
  if (line) {
    for (const c of JSON.parse(line.slice(2))) {
      total++;
      console.log('  ' + (c.ok ? '✓ ' : '✗ ') + c.name + (c.ok ? '' : '  →  实得 ' + JSON.stringify(c.got)));
      if (!c.ok) bad++;
    }
  }
}
{
  const r = spawnSync(process.execPath,
    [path.join(__dirname, 'parse-early-morning.js'), '--child', '2026,9,19,4,0',
      JSON.stringify([{ say: '明早7点跑步', expect: { due: '2026-10-20' }, name: '04:00 明早 → 隔天' }])],
    { encoding: 'utf8' });
  const line = String(r.stdout).split('\n').find(l => l.startsWith('@@'));
  console.log('\n【边界 04:00 整】');
  if (line) {
    for (const c of JSON.parse(line.slice(2))) {
      total++;
      console.log('  ' + (c.ok ? '✓ ' : '✗ ') + c.name + (c.ok ? '' : '  →  实得 ' + JSON.stringify(c.got)));
      if (!c.ok) bad++;
    }
  }
}

console.log('\n共 ' + total + ' 项，' + (bad ? bad + ' 项失败' : '全部通过') + '\n');
process.exit(bad ? 1 : 0);
