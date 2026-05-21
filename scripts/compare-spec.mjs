import fs from 'fs';

const v32 = fs.readFileSync(
  'C:/Users/goric/.cursor/projects/c-Users-goric-huma/uploads/e__HUMA_HUMA_______v3.2___-L1-L1599-0.md',
  'utf8',
);
const v34 = fs.readFileSync('e:/HUMA/HUMA_개발기획서_v3.4_최종.md', 'utf8');

console.log('v3.2 lines:', v32.split('\n').length);
console.log('v3.4 lines:', v34.split('\n').length);

const sections = (s) => [...s.matchAll(/^##+ .+$/gm)].map((m) => m[0]);
const s32 = sections(v32);
const s34 = sections(v34);

console.log('\n=== Sections only in v3.4 ===');
s34.filter((x) => !s32.includes(x)).forEach((x) => console.log(x));
console.log('\n=== Sections only in v3.2 ===');
s32.filter((x) => !s34.includes(x)).forEach((x) => console.log(x));

const keys = [
  '작업 추가',
  'AI 자동',
  '콘텐츠 생성',
  'auto_content',
  'ContentGeneration',
  'modal-queue',
  '시놉',
  'reference_url',
  'sourceUrl',
  'ElevenLabs',
  'Typecast',
  '큐 관리',
  'JobSchedule',
  'repeat',
  'Higgsfield',
  'Sonnet 4.6',
  'Haiku 4.5',
  'v3.4',
  'v3.2',
  'v3.3',
];

console.log('\n=== Keyword counts (v3.2 → v3.4) ===');
for (const k of keys) {
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = (v32.match(new RegExp(esc, 'g')) || []).length;
  const b = (v34.match(new RegExp(esc, 'g')) || []).length;
  if (a !== b) console.log(`${k}: ${a} → ${b}`);
}

function paras(s) {
  return s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}
const p32 = paras(v32);
const p34 = paras(v34);
const set32 = new Set(p32);
const set34 = new Set(p34);
const only34 = p34.filter((p) => !set32.has(p));
const only32 = p32.filter((p) => !set34.has(p));

console.log('\nUnique paragraph blocks v3.4:', only34.length);
console.log('Unique paragraph blocks v3.2:', only32.length);

const queueRelated = (blocks) =>
  blocks.filter((p) => /큐|작업 추가|auto.?content|콘텐츠 생성|JobSchedule|repeat|시놉|reference|sourceUrl/i.test(p));

console.log('\n=== v3.4 queue-related new/changed blocks ===');
queueRelated(only34).forEach((p, i) => console.log(`[${i + 1}]`, p.slice(0, 300).replace(/\n/g, ' ')));

console.log('\n=== v3.4 non-queue unique blocks (sample) ===');
only34
  .filter((p) => !queueRelated([p]).length)
  .slice(0, 20)
  .forEach((p, i) => console.log(`[${i + 1}]`, p.slice(0, 200).replace(/\n/g, ' ')));

console.log('\n=== v3.2 removed blocks (sample) ===');
only32.slice(0, 15).forEach((p, i) => console.log(`[${i + 1}]`, p.slice(0, 200).replace(/\n/g, ' ')));

// line diff for section 7 (queue)
const extractSection = (doc, num) => {
  const re = new RegExp(`## ${num}\\.[^\\n]+\\n([\\s\\S]*?)(?=\\n## \\d+\\.|$)`);
  return doc.match(re)?.[1]?.trim() ?? '';
};
for (const n of ['7', '7-0', '8']) {
  const a = extractSection(v32, n);
  const b = extractSection(v34, n);
  if (a !== b) console.log(`\nSection ${n} differs (v3.2 ${a.length} chars, v3.4 ${b.length} chars)`);
}
