export function mapAccountDbError(message: string): string {
  if (message.includes('huma_accounts_naver_id_key')) {
    return '이미 등록된 네이버 ID입니다.';
  }
  if (message.includes('huma_platform_accounts')) {
    return '이 워크스페이스에 동일한 소셜 플랫폼 계정이 이미 등록되어 있습니다.';
  }
  if (/foreign key|violates.*constraint|23503/i.test(message)) {
    return '연결된 작업·로그가 남아 계정을 삭제할 수 없습니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요.';
  }
  return message;
}
