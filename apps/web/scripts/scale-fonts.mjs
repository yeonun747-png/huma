import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve('apps/web');
const REPO = path.resolve('.');
const EXT = new Set(['.tsx', '.ts', '.css']);

const map = {
  34: '39',
  28: '32',
  12: '13.5',
  9.5: '11',
  8.5: '9.5',
  9: '10.5',
  8: '9',
  7: '8',
};

function scaleSize(size) {
  return map[size] ?? size;
}

function scaleContent(content) {
  let out = content;
  out = out.replace(/font-size:\s*([\d.]+)px/g, (_, s) => `font-size: ${scaleSize(s)}px`);
  out = out.replace(/text-\[([\d.]+)px\]/g, (_, s) => `text-[${scaleSize(s)}px]`);
  return out;
}

const modalBlock = `
  .m-modal-bg { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); z-index: 200; display: none; align-items: center; justify-content: center; }
  .m-modal-bg.open { display: flex; }
  .m-modal { background: var(--bg2); border: 1px solid var(--bdr); border-radius: 12px; padding: 22px; width: 380px; max-width: 95vw; max-height: 92vh; overflow-y: auto; }
  .m-modal-queue { width: 520px; }
  .m-modal-t { font-size: 16px; font-weight: 700; color: var(--t); margin-bottom: 16px; }
  .m-modal-field { margin-bottom: 12px; }
  .m-modal-label { font-size: 12px; color: var(--t3); font-family: var(--font-jetbrains), monospace; letter-spacing: 0.05em; margin-bottom: 5px; }
  .m-modal-input { width: 100%; background: var(--bg3); border: 1px solid var(--bdr); border-radius: 6px; padding: 8px 10px; color: var(--t); font-size: 14.5px; outline: none; }
  .m-modal-input:focus { border-color: var(--acc); }
  .m-modal-textarea { height: 72px; resize: none; }
  .m-modal-drop { width: 100%; background: var(--bg3); border: 1px dashed var(--bdr); border-radius: 6px; padding: 12px; text-align: center; cursor: pointer; transition: border-color 0.2s; }
  .m-modal-drop:hover { border-color: var(--acc); }
  .m-modal-foot { display: flex; gap: 8px; margin-top: 16px; }
  .m-modal-cost { background: var(--bg3); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
  .m-ai-engine-row { display: flex; gap: 6px; margin-bottom: 14px; }
  .m-ai-engine { flex: 1; border-radius: 6px; padding: 8px 10px; }
  .m-ai-engine.main { background: var(--glow); border: 1px solid var(--acc); }
  .m-ai-engine.sub { background: rgba(255, 165, 0, 0.08); border: 1px solid rgba(255, 165, 0, 0.22); }
  .m-ai-engine-tag { font-size: 9px; color: var(--t3); font-family: var(--font-jetbrains), monospace; margin-bottom: 2px; }
  .m-ai-engine-name { font-size: 13px; font-weight: 600; }
  .m-ai-engine.main .m-ai-engine-name { color: var(--acc); }
  .m-ai-engine.sub .m-ai-engine-name { color: #e8a040; }
  .m-ai-engine-sub { font-size: 9px; color: var(--t3); font-family: var(--font-jetbrains), monospace; }
`;

const globalsPath = path.join(ROOT, 'app/globals.css');
const headGlobals = execSync('git show HEAD:apps/web/app/globals.css', {
  cwd: REPO,
  encoding: 'utf8',
});
let globals = headGlobals.replace(/\}\s*$/, `${modalBlock}\n}`);
globals = scaleContent(globals);
fs.writeFileSync(globalsPath, globals);
console.log('globals.css restored + font scaled');

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory() && ent.name !== 'node_modules' && ent.name !== '.next' && ent.name !== 'scripts') {
      walk(p, files);
    } else if (EXT.has(path.extname(ent.name)) && p !== globalsPath) {
      files.push(p);
    }
  }
  return files;
}

let count = 0;
for (const file of walk(ROOT)) {
  const raw = fs.readFileSync(file, 'utf8');
  const next = scaleContent(raw);
  if (next !== raw) {
    fs.writeFileSync(file, next);
    count += 1;
    console.log('updated', path.relative(ROOT, file));
  }
}
console.log('other files updated:', count);
