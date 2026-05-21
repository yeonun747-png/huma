export function mapAccountDbError(message: string): string {
  if (message.includes('huma_accounts_naver_id_key')) {
    return '이미 등록된 네이버 ID입니다.';
  }
  if (message.includes('huma_platform_accounts')) {
    return '이 워크스페이스에 동일한 소셜 플랫폼 계정이 이미 등록되어 있습니다.';
  }
  return message;
}
