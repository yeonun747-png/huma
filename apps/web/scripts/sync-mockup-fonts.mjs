import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const globalsPath = path.resolve(__dirname, '../app/globals.css');

/** mock v9 bigfont → app m-/he- class font-size (px) */
const CSS_MAP = {
  'm-sc-l': 9.5,
  'm-sc-v': 27.5,
  'm-sc-s': 11.5,
  'm-st-name': 12.5,
  'm-st-detail': 11,
  'm-st-jobs': 20.5,
  'm-st-jobs-l': 9.5,
  'm-svc-stop': 10.5,
  'm-panel-t': 10.5,
  'm-bar-label': 9,
  'm-tbl': 13,
  'm-url-link': 11.5,
  'm-tag': 10.5,
  'm-ac-name': 14.5,
  'm-ac-url': 11,
  'm-am-l': 9,
  'm-am-v': 13.5,
  'm-af': 11.5,
  'm-log-t': 11.5,
  'm-qi-ico': 17,
  'm-qi-title': 13.5,
  'm-qi-sub': 11,
  'm-q-btn': 11.5,
  'm-cal-head': 9.5,
  'm-cal-num': 11.5,
  'm-cal-ev': 9.5,
  'm-live-box': 11.5,
  'm-pub-m': 11,
  'm-soc-l': 13.5,
  'm-soc-v': 15,
  'm-cr-i': 15,
  'm-cr-t': 13,
  'm-cr-m': 11,
  'm-cr-a': 10.5,
  'm-kw-rank': 15,
  'm-kw-word': 14.5,
  'm-kw-vol': 12,
  'm-kw-chg': 12,
  'he-hm-l': 8,
  'm-modal-label': 12,
  'm-modal-t': 16,
  'm-modal-input': 14.5,
  'm-ai-engine-tag': 9,
  'm-ai-engine-name': 13,
  'm-ai-engine-sub': 9,
  'm-type-badge': 9.5,
  'm-model-badge': 10.5,
  'm-model-select': 12.5,
  'm-pipe-step-title': 14.5,
  'm-pipe-step-sub': 11.5,
  'm-pipe-step-num': 12.5,
  'm-ws-col-title': 9.5,
  'he-slider-label': 13.5,
  'he-slider-val': 13,
  'he-slider-static': 13,
  'he-chart-caption': 9.5,
  'he-jitter-val': 11,
  'he-meta-val': 11.5,
  'he-video-val': 11.5,
  'he-tw-label': 13.5,
  'he-panel-t': 10.5,
};

let css = fs.readFileSync(globalsPath, 'utf8');

for (const [cls, px] of Object.entries(CSS_MAP)) {
  const re = new RegExp(`(\\.${cls.replace(/-/g, '\\-')}[^{]*\\{[^}]*font-size:\\s*)[\\d.]+px`, 'g');
  if (re.test(css)) {
    css = css.replace(re, `$1${px}px`);
  } else {
    console.warn('missing font-size rule:', cls);
  }
}

css = css.replace(
  /\.btn-primary \{[^}]+\}/,
  '.btn-primary {\n    @apply rounded-md bg-huma-acc px-3 py-1.5 text-[12.5px] font-bold text-white transition hover:brightness-110;\n  }',
);
css = css.replace(
  /\.btn-ghost \{[^}]+\}/,
  '.btn-ghost {\n    @apply rounded-md border border-huma-bdr bg-transparent px-3 py-1 text-[12.5px] text-huma-t2 transition hover:border-huma-acc hover:text-huma-acc;\n  }',
);
css = css.replace(
  /\.stat-value \{[^}]+\}/,
  '.stat-value {\n    @apply my-1 font-mono text-[27.5px] font-bold text-huma-t;\n  }',
);
css = css.replace(
  /\.nav-item \{[^}]+\}/,
  '.nav-item {\n    @apply flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] text-huma-t2 transition hover:bg-[var(--glow)] hover:text-huma-t;\n  }',
);

fs.writeFileSync(globalsPath, css);
console.log('globals.css font sync done');
