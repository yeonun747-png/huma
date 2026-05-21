/** API/DB 오류 메시지를 계정 관리 UI용 한글 메시지로 변환 */
export function formatAccountError(message: string, context?: { naverId?: string; platform?: string }): string {
  const lower = message.toLowerCase();

  if (message.includes('huma_accounts_naver_id_key') || (lower.includes('duplicate key') && lower.includes('naver_id'))) {
    const id = context?.naverId?.trim();
    return id
      ? `이미 등록된 네이버 ID입니다.\n\n「${id}」은(는) 다른 계정으로 등록되어 있습니다.`
      : '이미 등록된 네이버 ID입니다.\n\n동일한 네이버 ID로 중복 등록할 수 없습니다.';
  }

  if (
    message.includes('huma_platform_accounts') ||
    (lower.includes('duplicate key') && lower.includes('platform'))
  ) {
    const platform = context?.platform?.trim();
    return platform
      ? `이 워크스페이스에 ${platform} 계정이 이미 등록되어 있습니다.\n\n플랫폼당 1개 계정만 등록할 수 있습니다.`
      : '이 워크스페이스에 동일한 소셜 플랫폼 계정이 이미 등록되어 있습니다.';
  }

  return message;
}

export function alertAccountError(err: unknown, context?: { naverId?: string; platform?: string }) {
  const raw = err instanceof Error ? err.message : '계정 등록에 실패했습니다.';
  window.alert(formatAccountError(raw, context));
}
