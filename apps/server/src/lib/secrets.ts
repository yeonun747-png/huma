/**
 * 보안 시크릿 해석 — 프로덕션에서 하드코딩 fallback 금지.
 * NODE_ENV=production 이거나 HUMA_REQUIRE_SECRETS=1 이면 미설정 시 즉시 throw.
 * 개발 환경에서만 명시적 dev 기본값을 허용한다.
 */

const DEV_DEFAULTS = {
  JWT_SECRET: 'dev-secret',
  ENCRYPTION_KEY: 'huma-dev-encryption-key-32chars!',
} as const;

type SecretName = keyof typeof DEV_DEFAULTS;

function secretsRequired(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.HUMA_REQUIRE_SECRETS === '1';
}

function resolveSecret(name: SecretName): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (secretsRequired()) {
    throw new Error(
      `보안 설정 누락: ${name} 환경변수가 필요합니다 (프로덕션). apps/server/.env에 강력한 무작위 값을 설정하세요.`,
    );
  }
  return DEV_DEFAULTS[name];
}

export function getJwtSecret(): string {
  return resolveSecret('JWT_SECRET');
}

export function getEncryptionKey(): string {
  return resolveSecret('ENCRYPTION_KEY');
}

/** 서버 기동 시 1회 호출 — 프로덕션이면 필수 시크릿 누락을 즉시 차단 */
export function assertSecretsConfigured(): void {
  if (!secretsRequired()) return;
  getJwtSecret();
  getEncryptionKey();
}
