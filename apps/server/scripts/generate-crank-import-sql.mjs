#!/usr/bin/env node
/**
 * 연운마케팅.xlsx → huma_accounts INSERT SQL (Node만 사용, Python 불필요)
 * Usage (i7, apps/server/.env 의 ENCRYPTION_KEY 필수):
 *   cd apps/server && npm install
 *   node scripts/generate-crank-import-sql.mjs ~/Downloads/연운마케팅.xlsx \
 *     > scripts/migrations/v3_34_crank_50_yeonun.sql
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

function encrypt(text) {
  const secret = process.env.ENCRYPTION_KEY ?? 'huma-dev-encryption-key-32chars!';
  const key = scryptSync(secret, 'huma-salt', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

/** B=네이버ID, C=비번, D=이름 · 3행~52행 */
function loadAccountsFromXlsx(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const accounts = [];
  for (let i = 2; i < 52 && i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;
    const no = row[0];
    const naverId = String(row[1] ?? '').trim();
    const password = String(row[2] ?? '');
    const name = String(row[3] ?? '').trim();
    if (!naverId || !password || !name) continue;
    accounts.push({ no: no || accounts.length + 1, naver_id: naverId, password, name });
  }
  if (accounts.length === 0) {
    throw new Error(`엑셀에서 계정을 읽지 못했습니다: ${xlsxPath} (3행~ B/C/D 열 확인)`);
  }
  return accounts;
}

function loadAccounts() {
  const xlsxPath = process.argv[2];
  if (xlsxPath) return loadAccountsFromXlsx(xlsxPath);
  const jsonPath = join(__dirname, 'data/crank-50-yeonun.json');
  return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

const accounts = loadAccounts();

const keyHint = process.env.ENCRYPTION_KEY
  ? '-- ENCRYPTION_KEY: i7/production (.env)'
  : '-- WARNING: ENCRYPTION_KEY 없음 — dev 기본키 사용. i7 .env 로 재생성 후 실행하세요!';

const lines = [
  '-- v3_34 C-Rank 계정 50개 (연운마케팅.xlsx · B=네이버ID C=비번 D=이름)',
  keyHint,
  '-- Supabase SQL Editor 에서 실행',
  '',
  'INSERT INTO huma_accounts (name, naver_id, naver_pw_enc, workspace, account_type, slot_label, is_active)',
  'VALUES',
];

const valueRows = accounts.map((ac, idx) => {
  const enc = encrypt(ac.password);
  const slot = `C-Rank ${ac.no}`;
  const tail = idx < accounts.length - 1 ? ',' : '';
  return `  ('${sqlEscape(ac.name)}', '${sqlEscape(ac.naver_id)}', '${enc}', 'yeonun', 'crank', '${sqlEscape(slot)}', true)${tail}`;
});

lines.push(...valueRows);
lines.push(
  'ON CONFLICT (naver_id) DO UPDATE SET',
  '  name = EXCLUDED.name,',
  '  naver_pw_enc = EXCLUDED.naver_pw_enc,',
  '  workspace = EXCLUDED.workspace,',
  '  account_type = EXCLUDED.account_type,',
  '  slot_label = EXCLUDED.slot_label,',
  '  is_active = EXCLUDED.is_active,',
  '  updated_at = now();',
  '',
  `-- ${accounts.length} accounts`,
);

process.stdout.write(`${lines.join('\n')}\n`);
