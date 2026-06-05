#!/usr/bin/env node
/**
 * 연운마케팅.xlsx → huma_accounts INSERT SQL
 * Usage (i7, apps/server/.env 의 ENCRYPTION_KEY 필수):
 *   cd apps/server
 *   node scripts/generate-crank-import-sql.mjs > scripts/migrations/v3_34_crank_50_yeonun.sql
 */
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function loadAccounts() {
  const xlsxPath = process.argv[2];
  if (xlsxPath) {
    const py = [
      'import openpyxl, json, sys',
      'wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)',
      'ws = wb.active',
      'rows = []',
      'for row in ws.iter_rows(min_row=3, max_row=52, values_only=True):',
      '    no, naver_id, pw, name = row[0], row[1], row[2], row[3]',
      '    if naver_id and pw and name:',
      '        rows.append({"no": no, "naver_id": str(naver_id).strip(), "password": str(pw), "name": str(name).strip()})',
      'wb.close()',
      'print(json.dumps(rows, ensure_ascii=False))',
    ].join('\n');
    const stdout = execFileSync('python3', ['-c', py, xlsxPath], { encoding: 'utf8' });
    return JSON.parse(stdout);
  }
  return JSON.parse(readFileSync(join(__dirname, 'data/crank-50-yeonun.json'), 'utf8'));
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
