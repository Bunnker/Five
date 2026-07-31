import type { components } from "@five/api-contract";
import QRCode from "qrcode";
import { BlockList, isIP } from "node:net";

type DailyContent = components["schemas"]["DailyContent"];
type OutfitFormula = components["schemas"]["OutfitFormula"];
type PublicImageAsset = components["schemas"]["PublicImageAsset"];
type PublicLook = components["schemas"]["PublicLook"];
type Tier = components["schemas"]["Tier"];

export const POSTER_RENDERER = Symbol("POSTER_RENDERER");
export const CONTRACT_POSTER_TEMPLATE_VERSION = "poster-template-v3";
export const DEMO_POSTER_TEMPLATE_VERSION = "demo-poster-v1";

const MAX_REVIEWED_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_RENDERED_POSTER_BYTES = 10 * 1024 * 1024;
const REVIEWED_IMAGE_FETCH_TIMEOUT_MS = 10_000;
const QR_QUIET_ZONE_MODULES = 4;
const TIER_LABELS = ["大吉", "次吉", "平", "较差", "不利"] as const;
const ALLOWED_IMAGE_MEDIA_TYPES = new Set<PublicImageAsset["mediaType"]>([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const PRIVATE_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, "ipv6");
}

interface PosterTemplateDefinition {
  layoutIdentity: string;
  version: string;
}

const CONTRACT_POSTER_TEMPLATE: Readonly<PosterTemplateDefinition> = Object.freeze({
  layoutIdentity: "five-fixed-portrait-v3",
  version: CONTRACT_POSTER_TEMPLATE_VERSION,
});
const DEMO_POSTER_TEMPLATE: Readonly<PosterTemplateDefinition> = Object.freeze({
  layoutIdentity: "five-demo-portrait-v1",
  version: DEMO_POSTER_TEMPLATE_VERSION,
});
const POSTER_TEMPLATES = new Map<string, Readonly<PosterTemplateDefinition>>([
  [CONTRACT_POSTER_TEMPLATE.version, CONTRACT_POSTER_TEMPLATE],
  [DEMO_POSTER_TEMPLATE.version, DEMO_POSTER_TEMPLATE],
]);

export interface RenderPosterInput {
  content: DailyContent;
  landingUrl: string;
  posterTemplateVersion: string;
  sourceContentVersion: string;
}

export interface RenderedPoster {
  body: Buffer;
  mediaType: "image/svg+xml";
}

export interface PosterRenderer {
  render(input: RenderPosterInput): Promise<RenderedPoster>;
}

export type PosterImageFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface PosterImageOriginPolicy {
  assertAllowed(value: string): URL;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalizedWithPossibleDot =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : hostname.toLowerCase();
  const normalized = normalizedWithPossibleDot.replace(/\.+$/u, "");
  const family = isIP(normalized);
  if (family === 4) {
    return PRIVATE_NETWORKS.check(normalized, "ipv4");
  }
  if (family === 6) {
    return PRIVATE_NETWORKS.check(normalized, "ipv6");
  }
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa")
  );
}

function publicImageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError("Published reviewed image URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw new RangeError("Published reviewed image URL must be a credential-free HTTPS URL");
  }
  if (isPrivateOrLocalHostname(url.hostname)) {
    throw new RangeError("Published reviewed image origin targets a private or local network");
  }
  return url;
}

export class StrictPosterImageOriginPolicy implements PosterImageOriginPolicy {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(origins: readonly string[]) {
    this.allowedOrigins = new Set(
      origins.map((origin) => {
        const url = publicImageUrl(origin);
        if (url.pathname !== "/" || url.search.length > 0) {
          throw new RangeError("Published image allowlist entries must be origins without paths");
        }
        return url.origin;
      }),
    );
  }

  assertAllowed(value: string): URL {
    const url = publicImageUrl(value);
    if (!this.allowedOrigins.has(url.origin)) {
      throw new RangeError("Published reviewed image origin is not allowed");
    }
    return url;
  }
}

interface ReviewedPosterSource {
  formula: OutfitFormula;
  image: PublicImageAsset;
  look: PublicLook;
}

interface TextBlockOptions {
  blockName: string;
  fill: string;
  fontFamily: "sans-serif" | "serif";
  fontSize: number;
  fontWeight?: number;
  lineHeight: number;
  maxLines: number;
  maxUnits: number;
  text: string;
  x: number;
  y: number;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeText(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function textUnitWidth(character: string): number {
  return (character.codePointAt(0) ?? 0) <= 0xff ? 1 : 2;
}

function lineUnitWidth(value: string): number {
  return Array.from(value).reduce((total, character) => total + textUnitWidth(character), 0);
}

function addEllipsis(value: string, maxUnits: number): string {
  const characters = Array.from(value.trimEnd());
  while (characters.length > 0 && lineUnitWidth(`${characters.join("")}…`) > maxUnits) {
    characters.pop();
  }
  return `${characters.join("")}…`;
}

function wrapText(value: string, maxUnits: number, maxLines: number): string[] {
  const characters = Array.from(normalizeText(value));
  if (characters.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";
  let currentUnits = 0;
  let truncated = false;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === undefined) {
      continue;
    }
    const width = textUnitWidth(character);
    if (current.length > 0 && currentUnits + width > maxUnits) {
      lines.push(current.trimEnd());
      current = "";
      currentUnits = 0;
      if (lines.length === maxLines) {
        truncated = true;
        break;
      }
    }
    if (!(current.length === 0 && character === " ")) {
      current += character;
      currentUnits += width;
    }
  }

  if (!truncated && current.length > 0) {
    lines.push(current.trimEnd());
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }
  if (truncated) {
    const lastIndex = maxLines - 1;
    const lastLine = lines[lastIndex] ?? "";
    lines[lastIndex] = addEllipsis(lastLine, maxUnits);
  }
  return lines;
}

function renderTextBlock({
  blockName,
  fill,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  maxLines,
  maxUnits,
  text,
  x,
  y,
}: TextBlockOptions): string {
  const weightAttribute = fontWeight === undefined ? "" : ` font-weight="${fontWeight}"`;
  const lines = wrapText(text, maxUnits, maxLines);
  const spans = lines
    .map(
      (line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<text data-text-block="${escapeXml(blockName)}" fill="${fill}" font-family="${fontFamily}" font-size="${fontSize}"${weightAttribute}>${spans}</text>`;
}

function posterTemplate(version: string): Readonly<PosterTemplateDefinition> {
  const template = POSTER_TEMPLATES.get(version);
  if (template === undefined) {
    throw new RangeError(`Unsupported poster template version: ${version}`);
  }
  return template;
}

function reviewedPosterSource(content: DailyContent): ReviewedPosterSource {
  const look = [...content.looks]
    .filter((candidate) => candidate.requiredForPublish)
    .sort((left, right) => left.sortOrder - right.sortOrder)[0];
  if (look === undefined) {
    throw new RangeError("Published content does not contain a required reviewed cover image");
  }
  const formula = content.outfitFormulas.find(
    (candidate) => candidate.formulaId === look.formulaId,
  );
  if (formula === undefined) {
    throw new RangeError("Published reviewed image is missing its published outfit formula");
  }
  return { formula, image: look.coverImage, look };
}

function orderedTiers(content: DailyContent): Tier[] {
  const tiers = [...content.tiers].sort((left, right) => left.rank - right.rank);
  if (
    tiers.length !== TIER_LABELS.length ||
    TIER_LABELS.some((label, index) => tiers[index]?.algorithmLabel !== label)
  ) {
    throw new RangeError("Published content must provide all five ordered algorithm tiers");
  }
  return tiers;
}

function responseMediaType(response: Response): string | null {
  const header = response.headers.get("content-type");
  return header?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function validateDeclaredLength(response: Response): void {
  const header = response.headers.get("content-length");
  if (header === null) {
    return;
  }
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_REVIEWED_IMAGE_BYTES) {
    throw new RangeError("Published reviewed image exceeds the poster source size limit");
  }
}

async function readBoundedResponseBody(response: Response): Promise<Buffer> {
  if (response.body === null) {
    throw new RangeError("Published reviewed image response has no body");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    totalBytes += result.value.byteLength;
    if (totalBytes > MAX_REVIEWED_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RangeError("Published reviewed image exceeds the poster source size limit");
    }
    chunks.push(result.value);
  }
  if (totalBytes === 0) {
    throw new RangeError("Published reviewed image response is empty");
  }
  return Buffer.concat(chunks, totalBytes);
}

async function embeddedReviewedImage(
  image: PublicImageAsset,
  fetchImage: PosterImageFetch,
  originPolicy: PosterImageOriginPolicy,
): Promise<string> {
  if (!ALLOWED_IMAGE_MEDIA_TYPES.has(image.mediaType)) {
    throw new RangeError("Published reviewed image declares an unsupported media type");
  }
  const url = originPolicy.assertAllowed(image.url);
  const response = await fetchImage(url.toString(), {
    redirect: "error",
    signal: AbortSignal.timeout(REVIEWED_IMAGE_FETCH_TIMEOUT_MS),
  });
  if (response.redirected) {
    throw new RangeError("Published reviewed image redirect is not allowed");
  }
  if (response.url.length === 0) {
    throw new RangeError("Published reviewed image response URL is missing");
  }
  const responseUrl = originPolicy.assertAllowed(response.url);
  if (responseUrl.toString() !== url.toString()) {
    throw new RangeError("Published reviewed image redirect is not allowed");
  }
  if (!response.ok) {
    throw new RangeError(`Published reviewed image fetch failed with status ${response.status}`);
  }
  validateDeclaredLength(response);
  if (responseMediaType(response) !== image.mediaType) {
    throw new RangeError("Published reviewed image response media type does not match its record");
  }
  const body = await readBoundedResponseBody(response);
  return `data:${image.mediaType};base64,${body.toString("base64")}`;
}

function tierColorNames(tier: Tier): string {
  return tier.colors.map((color) => color.name).join("、");
}

function formulaSlotText(slot: OutfitFormula["slots"][number], tiers: readonly Tier[]): string {
  const tier = tiers.find((candidate) => candidate.tierCode === slot.tierCode);
  if (tier === undefined) {
    throw new RangeError(`Published outfit formula references missing tier ${slot.tierCode}`);
  }
  const namesByCode = new Map(
    tiers.flatMap((candidate) => candidate.colors.map((color) => [color.colorCode, color.name])),
  );
  const colorNames = slot.colorCodes.map((code) => namesByCode.get(code) ?? code).join("/");
  const ratio = slot.ratioPercent === null ? "" : ` ${slot.ratioPercent}%`;
  return `${slot.roleLabel}${ratio} · ${tier.algorithmLabel} · ${colorNames} · ${slot.garmentParts.join("/")}`;
}

function landingChannel(landingUrl: string): string {
  try {
    return new URL(landingUrl).searchParams.get("channelId") ?? "organic";
  } catch {
    throw new RangeError("Poster landing URL is invalid");
  }
}

interface PortraitTemplateContext {
  content: DailyContent;
  embeddedImage: string;
  qrData: string;
  source: ReviewedPosterSource;
  sourceContentVersion: string;
  template: Readonly<PosterTemplateDefinition>;
  tiers: readonly Tier[];
  channelId: string;
}

function renderPortraitTemplate({
  channelId,
  content,
  embeddedImage,
  qrData,
  source,
  sourceContentVersion,
  template,
  tiers,
}: PortraitTemplateContext): string {
  const [year = "", month = "", day = ""] = content.fortuneDate.split("-");
  const aiDisclosure = source.image.aiGenerated
    ? (source.image.aiDisclosure ?? "AI 生成图片")
    : "图片非 AI 生成";
  const accessibleDescription = wrapText(
    `${content.basis.disclaimer} ${aiDisclosure}`,
    160,
    2,
  ).join(" ");
  const tierColumns = tiers
    .map((tier, index) => {
      const x = 106 + index * 177;
      return `<g data-tier-code="${escapeXml(tier.tierCode)}">
      <text x="${x}" y="850" fill="#28251f" font-family="serif" font-size="27" font-weight="700">${escapeXml(tier.algorithmLabel)}</text>
      ${renderTextBlock({ blockName: `tier-${tier.tierCode}-relation`, fill: "#776d5f", fontFamily: "sans-serif", fontSize: 20, lineHeight: 22, maxLines: 1, maxUnits: 13, text: `${tier.elementLabel} · ${tier.relationText}`, x, y: 882 })}
      ${renderTextBlock({ blockName: `tier-${tier.tierCode}-colors`, fill: "#4a463e", fontFamily: "sans-serif", fontSize: 21, lineHeight: 26, maxLines: 2, maxUnits: 13, text: tierColorNames(tier), x, y: 914 })}
    </g>`;
    })
    .join("\n");
  const formulaLines = source.formula.slots
    .slice(0, 3)
    .map((slot, index) =>
      renderTextBlock({
        blockName: `formula-slot-${index + 1}`,
        fill: "#4a463e",
        fontFamily: "sans-serif",
        fontSize: 22,
        lineHeight: 25,
        maxLines: 1,
        maxUnits: 43,
        text: formulaSlotText(slot, tiers),
        x: 100,
        y: 1192 + index * 29,
      }),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440" role="img" aria-labelledby="poster-title poster-description" data-template-version="${escapeXml(template.version)}" data-template-layout="${escapeXml(template.layoutIdentity)}" data-content-version="${escapeXml(sourceContentVersion)}" data-source-asset-id="${escapeXml(source.image.assetId)}">
  <title id="poster-title">${escapeXml(content.fortuneDate)} 五行穿搭日签</title>
  <desc id="poster-description">${escapeXml(accessibleDescription)}</desc>
  <rect width="1080" height="1440" fill="#f4efe4"/>
  <rect x="54" y="44" width="972" height="1352" rx="38" fill="#fffaf0" stroke="#c9b99b" stroke-width="2"/>
  <text x="92" y="112" fill="#263c31" font-family="serif" font-size="31" letter-spacing="8">FIVE · 今日五行穿搭</text>
  <text x="92" y="235" fill="#28251f" font-family="serif" font-size="116" font-weight="700">${escapeXml(day)}</text>
  <text x="250" y="179" fill="#776d5f" font-family="sans-serif" font-size="28">${escapeXml(year)}年 ${escapeXml(month)}月 · ${escapeXml(content.calendar.weekdayText)}</text>
  <text x="250" y="225" fill="#776d5f" font-family="sans-serif" font-size="25">农历 ${escapeXml(content.calendar.lunarDateText)}</text>
  <text x="984" y="171" text-anchor="end" fill="#8e3028" font-family="serif" font-size="42" font-weight="700">${escapeXml(content.calendar.ganzhiDay)}日</text>
  <text x="984" y="226" text-anchor="end" fill="#263c31" font-family="serif" font-size="42" font-weight="700">${escapeXml(content.calendar.dayElementLabel)}日</text>
  <defs><clipPath id="photo-clip"><rect x="72" y="270" width="936" height="452" rx="26"/></clipPath></defs>
  <image href="${embeddedImage}" x="72" y="270" width="936" height="452" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo-clip)"/>
  <rect x="72" y="270" width="936" height="452" rx="26" fill="none" stroke="#d4c7b0" stroke-width="2"/>
  <rect x="72" y="746" width="936" height="226" rx="24" fill="#f5f0e5" stroke="#d4c7b0" stroke-width="2"/>
  <text x="100" y="797" fill="#263c31" font-family="serif" font-size="28" font-weight="700">今日五档</text>
  ${tierColumns}
  ${renderTextBlock({ blockName: "summary", fill: "#28251f", fontFamily: "serif", fontSize: 27, fontWeight: 700, lineHeight: 32, maxLines: 2, maxUnits: 55, text: content.share.summaryText, x: 92, y: 1018 })}
  <rect x="72" y="1080" width="684" height="229" rx="24" fill="#f5f0e5" stroke="#d4c7b0" stroke-width="2"/>
  ${renderTextBlock({ blockName: "look-title", fill: "#776d5f", fontFamily: "sans-serif", fontSize: 20, lineHeight: 22, maxLines: 1, maxUnits: 48, text: `今日搭配公式 · ${source.look.title}`, x: 100, y: 1125 })}
  ${renderTextBlock({ blockName: "formula-title", fill: "#28251f", fontFamily: "serif", fontSize: 27, fontWeight: 700, lineHeight: 30, maxLines: 1, maxUnits: 36, text: source.formula.title, x: 100, y: 1155 })}
  ${formulaLines}
  ${renderTextBlock({ blockName: "formula-disclaimer", fill: "#776d5f", fontFamily: "sans-serif", fontSize: 18, lineHeight: 22, maxLines: 1, maxUnits: 61, text: source.formula.disclaimer, x: 100, y: 1284 })}
  <image id="web-qr" href="data:image/svg+xml;base64,${qrData}" x="790" y="1082" width="190" height="190"/>
  <text x="885" y="1301" text-anchor="middle" fill="#776d5f" font-family="sans-serif" font-size="19">扫码查看今日详情</text>
  ${renderTextBlock({ blockName: "channel", fill: "#776d5f", fontFamily: "sans-serif", fontSize: 17, lineHeight: 20, maxLines: 1, maxUnits: 20, text: `渠道 · ${channelId}`, x: 806, y: 1327 })}
  <line x1="92" y1="1340" x2="988" y2="1340" stroke="#d4c7b0" stroke-width="2"/>
  ${renderTextBlock({ blockName: "disclaimer", fill: "#776d5f", fontFamily: "sans-serif", fontSize: 18, lineHeight: 21, maxLines: 1, maxUnits: 80, text: content.basis.disclaimer, x: 92, y: 1368 })}
  ${renderTextBlock({ blockName: "ai-disclosure", fill: "#776d5f", fontFamily: "sans-serif", fontSize: 18, lineHeight: 21, maxLines: 1, maxUnits: 80, text: aiDisclosure, x: 92, y: 1390 })}
</svg>`;
}

export class FixedSvgPosterRenderer implements PosterRenderer {
  constructor(
    private readonly fetchImage: PosterImageFetch = (url, init) => fetch(url, init),
    private readonly originPolicy: PosterImageOriginPolicy = new StrictPosterImageOriginPolicy([]),
  ) {}

  async render({
    content,
    landingUrl,
    posterTemplateVersion,
    sourceContentVersion,
  }: RenderPosterInput): Promise<RenderedPoster> {
    const template = posterTemplate(posterTemplateVersion);
    if (
      content.versions.contentVersion !== sourceContentVersion ||
      content.versions.posterTemplateVersion !== posterTemplateVersion ||
      content.share.posterTemplateVersion !== posterTemplateVersion
    ) {
      throw new RangeError("Poster source version does not match the frozen published content");
    }

    const source = reviewedPosterSource(content);
    const tiers = orderedTiers(content);
    const embeddedImage = await embeddedReviewedImage(
      source.image,
      this.fetchImage,
      this.originPolicy,
    );
    const qrSvg = await QRCode.toString(landingUrl, {
      errorCorrectionLevel: "M",
      margin: QR_QUIET_ZONE_MODULES,
      type: "svg",
      width: 256,
    });
    const svg = renderPortraitTemplate({
      channelId: landingChannel(landingUrl),
      content,
      embeddedImage,
      qrData: Buffer.from(qrSvg, "utf8").toString("base64"),
      source,
      sourceContentVersion,
      template,
      tiers,
    });
    const body = Buffer.from(svg, "utf8");
    if (body.byteLength >= MAX_RENDERED_POSTER_BYTES) {
      throw new RangeError("Rendered poster exceeds the downloadable artifact size limit");
    }
    return { body, mediaType: "image/svg+xml" };
  }
}
