import { isOpaquePublicValue } from "./public-response-validation";

export type PublicChannelParam = string | string[] | null | undefined;

const ORGANIC_CHANNEL_ID = "organic";
const RELATIVE_URL_ORIGIN = "https://five.invalid";

export function parsePublicChannelId(value: PublicChannelParam): string | null {
  return isOpaquePublicValue(value, 64) ? value : null;
}

export function withPublicChannelId(href: string, value: PublicChannelParam): string {
  const channelId = parsePublicChannelId(value);
  if (channelId === null || !href.startsWith("/") || href.startsWith("//")) {
    return href;
  }

  try {
    const url = new URL(href, RELATIVE_URL_ORIGIN);
    if (url.origin !== RELATIVE_URL_ORIGIN) {
      return href;
    }
    if (channelId === ORGANIC_CHANNEL_ID && !url.searchParams.has("channelId")) {
      return href;
    }
    url.searchParams.set("channelId", channelId);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}
