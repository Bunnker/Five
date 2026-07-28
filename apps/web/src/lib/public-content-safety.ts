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

export function isSafeImageCopy(value: unknown, maxLength: number): value is string {
  return (
    isSafeOutfitCopy(value, maxLength) && value.trim() === value && !hasAsciiControlCharacter(value)
  );
}
