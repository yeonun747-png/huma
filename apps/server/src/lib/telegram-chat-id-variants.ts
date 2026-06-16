/** env 그룹 id ↔ 슈퍼그룹 id (-558… ↔ -100558…) 등 답장 lookup 후보 */
export function telegramChatIdLookupVariants(chatId: string | number): string[] {
  const id = String(chatId)
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!id) return [];

  const out = new Set<string>([id]);
  if (id.startsWith('-100') && id.length > 4) {
    out.add(`-${id.slice(4)}`);
  } else if (id.startsWith('-') && !id.startsWith('-100')) {
    out.add(`-100${id.slice(1)}`);
  }
  return [...out];
}
