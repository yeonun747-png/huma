import fs from 'fs';
import path from 'path';

const mockHtml = fs.readFileSync('e:/HUMA/huma_studio_v9_bigfont.html', 'utf8');
const styleBlock = mockHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? '';
const globals = fs.readFileSync('c:/Users/goric/huma/apps/web/app/globals.css', 'utf8');

const mockRules = {};
for (const m of styleBlock.matchAll(/\.([a-z0-9_-]+)[^{]*\{([^}]*)\}/gi)) {
  const fm = m[2].match(/font-size:\s*([\d.]+)px/);
  if (fm) mockRules[m[1]] = parseFloat(fm[1]);
}

const appRules = {};
for (const m of globals.matchAll(/\.((?:m|he)-[a-z0-9_-]+)[^{]*\{([^}]*)\}/gi)) {
  const fm = m[2].match(/font-size:\s*([\d.]+)px/);
  if (fm) appRules[m[1]] = parseFloat(fm[1]);
}

const pairs = [
  ['sc-l', 'm-sc-l'],
  ['sc-v', 'm-sc-v'],
  ['sc-s', 'm-sc-s'],
  ['st-name', 'm-st-name'],
  ['st-detail', 'm-st-detail'],
  ['st-jobs', 'm-st-jobs'],
  ['st-jobs-l', 'm-st-jobs-l'],
  ['panel-t', 'm-panel-t'],
  ['bar-label', 'm-bar-label'],
  ['tbl', 'm-tbl'],
  ['url-link', 'm-url-link'],
  ['tag', 'm-tag'],
  ['ac-name', 'm-ac-name'],
  ['ac-url', 'm-ac-url'],
  ['am-l', 'm-am-l'],
  ['am-v', 'm-am-v'],
  ['af', 'm-af'],
  ['log-t', 'm-log-t'],
  ['qi-ico', 'm-qi-ico'],
  ['qi-title', 'm-qi-title'],
  ['qi-sub', 'm-qi-sub'],
  ['q-btn', 'm-q-btn'],
  ['cal-head', 'm-cal-head'],
  ['cal-num', 'm-cal-num'],
  ['cal-ev', 'm-cal-ev'],
  ['live-box', 'm-live-box'],
  ['pub-m', 'm-pub-m'],
  ['soc-l', 'm-soc-l'],
  ['soc-v', 'm-soc-v'],
  ['cr-i', 'm-cr-i'],
  ['cr-t', 'm-cr-t'],
  ['cr-m', 'm-cr-m'],
  ['cr-a', 'm-cr-a'],
  ['kw-rank', 'm-kw-rank'],
  ['kw-word', 'm-kw-word'],
  ['kw-vol', 'm-kw-vol'],
  ['kw-chg', 'm-kw-chg'],
  ['hm-l', 'he-hm-l'],
  ['modal-label', 'm-modal-label'],
  ['type-badge', 'm-type-badge'],
  ['model-badge', 'm-model-badge'],
  ['model-select', 'm-model-select'],
  ['pipe-step-title', 'm-pipe-step-title'],
  ['pipe-step-sub', 'm-pipe-step-sub'],
  ['pipe-step-num', 'm-pipe-step-num'],
  ['ws-col-title', 'm-ws-col-title'],
];

console.log('MOCK vs APP CSS (m-/he- classes)\n');
const mismatches = [];
for (const [mockCls, appCls] of pairs) {
  const mv = mockRules[mockCls];
  const av = appRules[appCls];
  if (mv == null) continue;
  if (av == null || mv !== av) mismatches.push({ mockCls, appCls, mock: mv, app: av ?? null });
}

mismatches.sort((a, b) => a.mockCls.localeCompare(b.mockCls));
for (const x of mismatches) {
  console.log(`${x.mockCls.padEnd(16)} mock ${x.mock}px  app ${x.app ?? '—'}px`);
}

// mock-only shell elements not in globals
const shell = [
  ['logo-m', 25, 'sidebar text-[22px]'],
  ['logo-s', 9.5, 'sidebar text-[9.5px]'],
  ['ws-b', 13.5, 'sidebar text-xs (13.5px)'],
  ['ng-l', 9, 'sidebar text-[9px]'],
  ['ni', 13.5, 'sidebar nav text-xs'],
  ['tb-title', 19.5, 'topbar text-[17px]'],
  ['tb-bc', 11, 'topbar text-[11px]'],
  ['btn-p', 12.5, 'btn-primary'],
  ['btn-g', 12.5, 'btn-ghost'],
  ['btn-sm', 11.5, 'btn-sm'],
  ['notif-head', 12.5, 'topbar notif text-[11px]'],
  ['notif-t', 13, 'topbar notif text-[11.5px]'],
  ['notif-s', 11.5, 'topbar notif sub text-[10px]'],
  ['sys-s', 12, 'sidebar footer text-[10.5px]'],
  ['stat-value text-2xl', 27.5, 'stat-value text-2xl=24px'],
];

console.log('\nSHELL / COMPONENT mismatches\n');
for (const [cls, mockPx, appNote] of shell) {
  console.log(`${cls.padEnd(22)} mock ${mockPx}px  →  ${appNote}`);
}

console.log(`\nTotal CSS class mismatches: ${mismatches.length}`);
