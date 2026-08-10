import { AttentionColorSection } from "../../../components/attention-color-section";
import { CiJiColorCard } from "../../../components/ci-ji-color-card";
import { DaJiColorCard } from "../../../components/da-ji-color-card";
import { DailyDateRegion } from "../../../components/daily-date-region";
import { OutfitPreviewSection } from "../../../components/outfit-preview-section";
import { PingColorCard } from "../../../components/ping-color-card";
import { TodayImagePreviewSection } from "../../../components/today-image-preview-section";
import type { MouseEvent, ReactNode } from "react";

import { isReviewedColorCode, reviewedColorPalette } from "../../../lib/color-palette";
import {
  parsePublicDailyContent,
  type TodayImagePreviewCardData,
  type TodayImagePreviewSectionData,
} from "../../../lib/today";
import type { AdminContentVersion, AdminImageAsset, ContentDraft } from "../admin-api";

type ContentModules = ContentDraft["modules"] | AdminContentVersion["snapshot"];

export type AdminPreviewImage = {
  asset: AdminImageAsset;
  imageSlot: "optional" | "required_alternative" | "required_primary" | null;
  previewUrl: string;
  selectedForSlot: boolean;
};

type Props = {
  fortuneDate: string;
  images: readonly AdminPreviewImage[];
  mode: "draft" | "version";
  modules: ContentModules;
  revisionLabel: string;
};

const imageSlotPresentation = {
  optional: { displayLabel: "更多场景", placement: "supplemental", sortOrder: 3 },
  required_alternative: { displayLabel: "替代方案", placement: "alternate", sortOrder: 2 },
  required_primary: { displayLabel: "主方案", placement: "primary", sortOrder: 1 },
} as const;
const imageSlotOrder = ["required_primary", "required_alternative", "optional"] as const;

function buildPublicPreview(fortuneDate: string, modules: ContentModules, revisionLabel: string) {
  const calendarModule = modules.calendar_algorithm;
  const copyModule = modules.copy_and_formula;
  if (calendarModule === null || copyModule === null) return null;

  const previewVersion = `admin-preview-${revisionLabel}`;
  return parsePublicDailyContent(
    {
      balanceSuggestion: copyModule.balanceSuggestion,
      basis: copyModule.basis,
      calendar: calendarModule.calendar,
      fortuneDate,
      outfitFormulas: copyModule.outfitFormulas,
      share: copyModule.share,
      tiers: calendarModule.tiers,
      versions: {
        algorithmVersion: calendarModule.algorithmVersion,
        assetManifestVersion: "admin-preview-assets",
        calendarDataVersion: calendarModule.calendarDataVersion,
        calendarRuleVersion: calendarModule.calendarRuleVersion,
        contentVersion: previewVersion,
        copyVersion: copyModule.copyVersion,
        outfitVersion: copyModule.outfitVersion,
        posterTemplateVersion: copyModule.share.posterTemplateVersion,
      },
    },
    previewVersion,
  );
}

export function buildAdminImageSection(
  images: readonly AdminPreviewImage[],
  modules: ContentModules,
  contentVersion: string,
): TodayImagePreviewSectionData | null {
  const formulas = modules.copy_and_formula?.outfitFormulas ?? [];
  const cards: TodayImagePreviewCardData[] = [];

  imageSlotOrder.forEach((imageSlot, index) => {
    const selected = images.find((image) => image.imageSlot === imageSlot && image.selectedForSlot);
    const formula = formulas[index];
    if (selected === undefined || formula === undefined) {
      return;
    }
    const { asset, previewUrl } = selected;
    const { displayLabel, placement, sortOrder } = imageSlotPresentation[imageSlot];

    const items: TodayImagePreviewCardData["items"] = [];
    formula.slots.forEach((slot) => {
      const colorCode = slot.colorCodes.find(isReviewedColorCode);
      if (colorCode === undefined) return;
      items.push({
        categoryLabel: slot.garmentParts.join(" / "),
        color: { colorCode, name: reviewedColorPalette[colorCode].name },
      });
    });
    if (items.length === 0) return;

    cards.push({
      aiDisclosure: asset.sourceType === "ai_generated" ? "AI 生成穿搭示意图" : null,
      altText: asset.altText,
      assetId: asset.assetId,
      displayLabel,
      formulaId: formula.formulaId,
      height: asset.height,
      items,
      lookId: `admin-preview-${asset.assetId}`,
      mediaType: asset.mediaType,
      placement,
      scenarioLabel: formula.scenario.label,
      sortOrder,
      title: formula.title,
      url: previewUrl,
      width: asset.width,
    });
  });

  return cards.length === 0 ? null : { cards, contentVersion };
}

function selectionKeyForImageSlot(imageSlot: (typeof imageSlotOrder)[number]): string {
  return `image.${imageSlot}`;
}

function MissingImageSlots({
  images,
  interactive,
}: {
  images: readonly AdminPreviewImage[];
  interactive: boolean;
}) {
  const missingSlots = imageSlotOrder.filter(
    (imageSlot) => !images.some((image) => image.imageSlot === imageSlot && image.selectedForSlot),
  );
  if (missingSlots.length === 0) return null;
  const labels = {
    optional: { action: "补充可选图", eyebrow: "可选", title: "更多场景图待补充" },
    required_alternative: { action: "补充备选图", eyebrow: "必备 2/2", title: "备选模特图待补充" },
    required_primary: { action: "补充主图", eyebrow: "必备 1/2", title: "主模特图待补充" },
  } as const;
  return (
    <section className="admin-correction-image-placeholders" aria-label="待补充图片槽位">
      {missingSlots.map((imageSlot) => {
        const copy = labels[imageSlot];
        const content = (
          <>
            <span>{copy.eyebrow}</span>
            <strong>{copy.title}</strong>
            <small>{interactive ? `点击${copy.action}` : "选择图片后会按用户端样式显示"}</small>
          </>
        );
        return interactive ? (
          <button
            aria-label={copy.action}
            data-admin-selection-key={selectionKeyForImageSlot(imageSlot)}
            key={imageSlot}
            type="button"
          >
            {content}
          </button>
        ) : (
          <div key={imageSlot}>{content}</div>
        );
      })}
    </section>
  );
}

function SelectablePreviewSurface({
  children,
  onSelectionChange,
}: {
  children: ReactNode;
  onSelectionChange?: ((selectionKey: string) => void) | undefined;
}) {
  function selectAdminObject(event: MouseEvent<HTMLDivElement>): void {
    if (onSelectionChange === undefined) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const selectable = target.closest<HTMLElement>("[data-admin-selection-key]");
    const selectionKey = selectable?.dataset.adminSelectionKey;
    if (selectionKey === undefined) return;
    event.preventDefault();
    onSelectionChange(selectionKey);
  }
  return (
    <div className="admin-correction-preview-surface" onClick={selectAdminObject}>
      {children}
    </div>
  );
}

function AdminDailyExperienceContent({
  fortuneDate,
  images,
  modules,
  onSelectionChange,
  revisionLabel,
}: {
  fortuneDate: string;
  images: readonly AdminPreviewImage[];
  modules: ContentModules;
  onSelectionChange?: ((selectionKey: string) => void) | undefined;
  revisionLabel: string;
}) {
  const preview = buildPublicPreview(fortuneDate, modules, revisionLabel);
  const imageSection =
    preview?.daJiCard === null || preview?.daJiCard === undefined
      ? null
      : buildAdminImageSection(images, modules, preview.daJiCard.contentVersion);
  const missingModules = missingModuleLabels(modules);
  if (preview === null) {
    return (
      <div className="admin-phone-preview__empty">
        <span aria-hidden="true">未</span>
        <h3>还不能生成完整预览</h3>
        <p>
          {missingModules.length > 0
            ? `请先补全：${missingModules.join("、")}。`
            : "当前内容未通过公开展示规则，请检查下方模块。"}
        </p>
      </div>
    );
  }

  return (
    <SelectablePreviewSurface onSelectionChange={onSelectionChange}>
      <div className="today-page today-page--home admin-preview-today-page">
        <header className="today-masthead admin-preview-masthead">
          <span className="today-help-link" aria-hidden="true">
            <span>?</span>
            <span>说明</span>
          </span>
          <div className="today-masthead__identity">
            <p className="today-masthead__brand">
              <span>Five</span>
              <span>五行穿衣</span>
            </p>
            <p className="today-masthead__description">每日五行搭配参考</p>
          </div>
          <button className="today-share-link" data-admin-selection-key="share.copy" type="button">
            <span>分享</span>
            <span aria-hidden="true">↗</span>
          </button>
        </header>
        <DailyDateRegion daily={preview} />
        {preview.daJiCard === null ? null : <DaJiColorCard tier={preview.daJiCard} />}
        {preview.ciJiCard === null ? null : <CiJiColorCard tier={preview.ciJiCard} />}
        {preview.pingCard === null ? null : <PingColorCard tier={preview.pingCard} />}
        {preview.attentionSection === null ? null : (
          <AttentionColorSection section={preview.attentionSection} />
        )}
        {preview.outfitPreviewSection === null ? null : (
          <OutfitPreviewSection
            dateLabel="当日"
            interactive={false}
            section={preview.outfitPreviewSection}
          />
        )}
        {imageSection === null ? (
          <section className="admin-preview-images-empty">
            <p>图片预览</p>
            <h3>等待至少一张候选图</h3>
            <span>上传或生成图片后会在这里按用户端样式展示。</span>
          </section>
        ) : (
          <TodayImagePreviewSection dateLabel="当日" section={imageSection} />
        )}
        <MissingImageSlots images={images} interactive={onSelectionChange !== undefined} />
        <footer className="today-reference-statement" data-admin-selection-key="basis.disclaimer">
          <p>{preview.basis?.disclaimer ?? "内容基于传统文化规则整理，仅供穿搭参考。"}</p>
        </footer>
      </div>
    </SelectablePreviewSurface>
  );
}

export function AdminCorrectionPhonePreview({
  fortuneDate,
  images,
  modules,
  onSelectionChange,
  revisionLabel,
}: {
  fortuneDate: string;
  images: readonly AdminPreviewImage[];
  modules: ContentModules;
  onSelectionChange: (selectionKey: string) => void;
  revisionLabel: string;
}) {
  return (
    <AdminDailyExperienceContent
      fortuneDate={fortuneDate}
      images={images}
      modules={modules}
      onSelectionChange={onSelectionChange}
      revisionLabel={revisionLabel}
    />
  );
}

function missingModuleLabels(modules: ContentModules): string[] {
  const labels = {
    calendar_algorithm: "日历与算法",
    copy_and_formula: "文案与穿法",
  } as const;
  return Object.entries(labels)
    .filter(([code]) => modules[code as keyof typeof labels] === null)
    .map(([, label]) => label);
}

export function DailyExperiencePreview({
  fortuneDate,
  images,
  mode,
  modules,
  revisionLabel,
}: Props) {
  const preview = buildPublicPreview(fortuneDate, modules, revisionLabel);
  const completeTextPreview =
    preview !== null &&
    preview.daJiCard !== null &&
    preview.ciJiCard !== null &&
    preview.pingCard !== null &&
    preview.attentionSection !== null &&
    preview.outfitPreviewSection !== null;

  return (
    <section
      aria-labelledby="admin-experience-preview-title"
      className="admin-experience-preview"
      id="daily-preview"
    >
      <header className="admin-experience-preview__heading">
        <div>
          <p className="admin-kicker">01 · USER EXPERIENCE PREVIEW</p>
          <h2 id="admin-experience-preview-title">先看用户最终会看到什么</h2>
          <p>以 375px 手机宽度模拟公开页；预览不代表已经发布。</p>
        </div>
        <span className={`admin-preview-mode admin-preview-mode--${mode}`}>
          {mode === "draft" ? "草稿模拟" : "不可变版本"}
        </span>
      </header>

      <div className="admin-experience-preview__layout">
        <aside className="admin-preview-guide" aria-label="预览核对说明">
          <p className="admin-preview-guide__date">{fortuneDate}</p>
          <h3>像用户一样从上往下检查</h3>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>日期与五档颜色</strong>
                <p>确认日期、日五行、大吉到不利的顺序和颜色。</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>穿搭是否说人话</strong>
                <p>检查单色、双色、三色搭配是否容易照着穿。</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>图片与文字一致</strong>
                <p>候选图按主图、替代图、更多场景的顺序模拟。</p>
              </div>
            </li>
          </ol>
          <dl className="admin-preview-health">
            <div>
              <dt>文字预览</dt>
              <dd data-status={completeTextPreview ? "ready" : "incomplete"}>
                {completeTextPreview ? "完整" : "待补全"}
              </dd>
            </div>
            <div>
              <dt>图片预览</dt>
              <dd
                data-status={
                  images.filter((image) => image.selectedForSlot).length >= 2
                    ? "ready"
                    : "incomplete"
                }
              >
                {Math.min(images.filter((image) => image.selectedForSlot).length, 3)} / 3
              </dd>
            </div>
          </dl>
          <p className="admin-preview-guide__share-note">
            这是用户端实际效果；大师可直接查看，发现问题后由维护者复制修改并替换版本。
          </p>
        </aside>

        <div className="admin-phone-preview" data-ready={completeTextPreview}>
          <div className="admin-phone-preview__chrome" aria-hidden="true">
            <span>9:41</span>
            <span>Five 预览</span>
            <span>●●●</span>
          </div>
          <div className="admin-phone-preview__viewport">
            <AdminDailyExperienceContent
              fortuneDate={fortuneDate}
              images={images}
              modules={modules}
              revisionLabel={revisionLabel}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
