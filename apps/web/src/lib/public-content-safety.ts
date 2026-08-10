const forbiddenPublicCopyPattern = /保证|必然|转运|暴富|破财|大凶|灾|一定有效/u;
const forbiddenAttentionCopyPattern =
  /好运|贵人|助运|加分|事半功倍|运程|吉凶|化解|较差|不利|不推荐|倒霉|晦气|厄运|凶险|灾祸|危险|警告|百分百|绝对|肯定|必定|必会|必能|一定会|确保|见效|有效|灵验|应验|受伤|伤害|出事|生病|失败|损失|坏事|祸事|不顺|出问题/u;
const forbiddenOutfitCopyPattern =
  /收藏|购买|商品|吉祥物|登录|账户|账号|出生|八字|个人运势|拍照试搭/u;

export const reviewedAiImageDisclosure = "AI 生成穿搭示意图";

export function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function hasForbiddenPublicCopy(value: string): boolean {
  return forbiddenPublicCopyPattern.test(value);
}

export function isSafeAttentionCopy(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !hasForbiddenPublicCopy(value) &&
    !forbiddenAttentionCopyPattern.test(value)
  );
}

export function isSafeOutfitCopy(value: unknown, maxLength: number): value is string {
  return isSafeAttentionCopy(value, maxLength) && !forbiddenOutfitCopyPattern.test(value);
}

/**
 * Operator-edited balance copy may vary, but it must keep the reviewed public meaning:
 * today's da-ji colour, an ordinary accessory, and a small-area suggestion without promises.
 */
export function isSafeBalanceSuggestionCopy(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  const compact = value.replace(/\s+/gu, "");
  if (!isSafeOutfitCopy(compact, 300)) return false;
  if (!/(?:当日|今日)(?:的)?大吉色/u.test(compact)) return false;
  if (!/普通配饰/u.test(compact) || !/(?:小面积|少量|点缀)/u.test(compact)) return false;
  if (/(?:明天|次日)(?:的)?大吉色/u.test(compact)) return false;
  if (/(?:不建议|不可以|不可|不要|不宜)[^。！？]{0,24}(?:当日|今日)(?:的)?大吉色/u.test(compact)) {
    return false;
  }
  if (/(?:不是|并非)(?:小面积|少量|点缀)/u.test(compact)) return false;

  const withoutSafeFullOutfitNegation = compact.replace(
    /(?:不需要|无需|不必|不用)整套(?:换衣|更换|换装)/gu,
    "",
  );
  return !/(?:更换|换成|需要|建议|应该|必须|要)[^。！？]{0,12}整套|整套换装/u.test(
    withoutSafeFullOutfitNegation,
  );
}

export function isSafeImageCopy(value: unknown, maxLength: number): value is string {
  return (
    isSafeOutfitCopy(value, maxLength) && value.trim() === value && !hasAsciiControlCharacter(value)
  );
}
