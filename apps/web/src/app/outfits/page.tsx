import { headers } from "next/headers";

import { OutfitDetailImage } from "../../components/outfit-detail-image";
import { OutfitOverviewImage } from "../../components/outfit-overview-image";
import { ColorSwatch, FoundationAction } from "../../components/visual-foundation";
import { reviewedColorPalette } from "../../lib/color-palette";
import {
  loadOutfitPageData,
  type OutfitSearchParamValue,
  type SelectedOutfit,
} from "../../lib/outfit-page-data";
import type { LookDetailData } from "../../lib/look-detail";
import type { OutfitPreviewCardData } from "../../lib/today";

export const dynamic = "force-dynamic";

interface OutfitsPageProps {
  searchParams: Promise<Record<string, OutfitSearchParamValue>>;
}

const kindLabels = {
  dual: "双色",
  mono: "单色",
  triple: "三色",
} as const;

function OutfitSlots({
  card,
  kindLabel,
  showGarmentParts = false,
}: {
  card: OutfitPreviewCardData;
  kindLabel: (typeof kindLabels)[OutfitPreviewCardData["kind"]];
  showGarmentParts?: boolean;
}) {
  return (
    <ul className="selected-outfit__slots" aria-label={`${kindLabel}颜色组合`}>
      {card.slots.map((slot) => (
        <li className="selected-outfit-slot" key={slot.role}>
          <div className="selected-outfit-slot__heading">
            <span>{slot.roleLabel}</span>
            {slot.ratioPercent === null ? null : <strong>{slot.ratioPercent}%</strong>}
          </div>
          <ul aria-label={`${slot.roleLabel}颜色`}>
            {slot.colors.map((color) => {
              const presentation = reviewedColorPalette[color.colorCode];

              return (
                <ColorSwatch
                  colorCode={color.colorCode}
                  compact
                  isLight={presentation.isLight}
                  key={color.colorCode}
                  name={color.name}
                  value={presentation.value}
                />
              );
            })}
          </ul>
          {showGarmentParts ? (
            <p className="selected-outfit-slot__parts">{slot.garmentParts.join("、")}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OutfitPlan({ detail, selection }: { detail: LookDetailData; selection: SelectedOutfit }) {
  const card = selection.selectedCard;
  const kindLabel = kindLabels[card.kind];
  const fallbackItems = detail.items.flatMap((item) => {
    const color = card.slots
      .flatMap((slot) => slot.colors)
      .find((candidate) => candidate.colorCode === item.colorCode);
    return color === undefined ? [] : [{ categoryLabel: item.categoryLabel, color }];
  });

  return (
    <div className={`outfit-detail selected-outfit--${card.kind}`}>
      <section aria-label="搭配图片" className="outfit-detail__gallery">
        <OutfitDetailImage
          caption={`${detail.scenarioLabel}主图`}
          contentVersion={selection.contentVersion}
          eager
          image={detail.coverImage}
          items={fallbackItems}
        />
        {detail.detailImages.length === 0 ? null : (
          <div className="outfit-detail__details">
            {detail.detailImages.map((image) => (
              <OutfitDetailImage
                caption={image.altText}
                contentVersion={selection.contentVersion}
                eager={false}
                image={image}
                items={fallbackItems}
                key={`${selection.contentVersion}:${image.assetId}:${image.url}`}
              />
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="outfit-detail-colors-title"
        className="selected-outfit outfit-detail__section"
      >
        <div className="selected-outfit__heading">
          <span>{kindLabel}</span>
          <h2 id="outfit-detail-colors-title">颜色比例与位置</h2>
        </div>
        <OutfitSlots card={card} kindLabel={kindLabel} showGarmentParts />
      </section>

      <section
        aria-labelledby="outfit-detail-items-title"
        className="selected-outfit outfit-detail__section"
      >
        <div className="selected-outfit__heading">
          <span>{detail.scenarioLabel}</span>
          <h2 id="outfit-detail-items-title">单品说明</h2>
        </div>
        <ul className="outfit-detail__list">
          {detail.items.map((item, index) => {
            const color = reviewedColorPalette[item.colorCode];
            return (
              <li key={`${item.category}:${item.colorCode}:${index}`}>
                <ul aria-label={`${item.categoryLabel}颜色`} className="outfit-detail__item-color">
                  <ColorSwatch
                    colorCode={item.colorCode}
                    compact
                    isLight={color.isLight}
                    name={color.name}
                    value={color.value}
                  />
                </ul>
                <div>
                  <strong>{item.categoryLabel}</strong>
                  <span>{item.description}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {detail.alternatives.length === 0 ? null : (
        <section
          aria-labelledby="outfit-detail-alternatives-title"
          className="selected-outfit outfit-detail__section"
        >
          <div className="selected-outfit__heading">
            <span>小面积替换</span>
            <h2 id="outfit-detail-alternatives-title">配饰替代</h2>
          </div>
          <ul className="outfit-detail__alternatives">
            {detail.alternatives.map((alternative, index) => (
              <li key={`${alternative.replaceCategory}:${index}`}>
                <strong>{alternative.replaceCategory}</strong>
                <span>{alternative.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="selected-outfit__note outfit-detail__note">{card.description}</p>
    </div>
  );
}

function OutfitOverview({ selection }: { selection: SelectedOutfit }) {
  const firstImageFormulaId = selection.cards.find((card) =>
    selection.imagesByFormula.has(card.formulaId),
  )?.formulaId;

  return (
    <div className="outfit-overview">
      {selection.cards.map((card) => {
        const image = selection.imagesByFormula.get(card.formulaId);
        const kindLabel = kindLabels[card.kind];
        const selected = card.formulaId === selection.selectedCard.formulaId;

        return (
          <section
            aria-label={`${kindLabel} · ${card.title}`}
            className={`selected-outfit selected-outfit--${card.kind} outfit-overview__section`}
            data-content-version={selection.contentVersion}
            data-selected={selected ? "true" : undefined}
            key={card.formulaId}
          >
            {image === undefined ? null : (
              <div className="outfit-overview__media">
                <OutfitOverviewImage
                  card={image}
                  contentVersion={selection.contentVersion}
                  eager={card.formulaId === firstImageFormulaId}
                />
              </div>
            )}

            <div className="selected-outfit__heading">
              <div className="outfit-overview__meta">
                <span>{kindLabel}</span>
                <span>{card.scenarioLabel}</span>
                {selected ? <strong>当前入口</strong> : null}
              </div>
              <h2>{card.title}</h2>
            </div>

            <OutfitSlots card={card} kindLabel={kindLabel} />
            <p className="selected-outfit__note">{card.description}</p>
            {image === undefined ? null : (
              <a
                aria-label={`查看${card.title}详情`}
                className="outfit-overview__action"
                href={`${card.href}&lookId=${encodeURIComponent(image.lookId)}&view=plan`}
              >
                查看方案详情
                <span aria-hidden="true">›</span>
              </a>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default async function OutfitsPage({ searchParams }: OutfitsPageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const resolution = await loadOutfitPageData({
    params,
    requestId: requestHeaders.get("x-request-id"),
  });

  if (resolution.status === "selection-error") {
    const notices = {
      invalid: {
        description: "暂时找不到这条搭配，请从首页重新选择。",
        title: "暂时找不到这条搭配",
      },
      stale: {
        description: "这条搭配已经更新，请从首页重新选择。",
        title: "这条搭配已经更新",
      },
      unavailable: {
        description: "今日内容还没有加载成功，请稍后再试。",
        title: "今日搭配暂时无法打开",
      },
    } as const;
    const notice = notices[resolution.reason];

    return (
      <main className="outfit-page">
        <section className="outfit-page__notice" role="status">
          <p className="outfit-page__eyebrow">今日怎么搭</p>
          <h1>{notice.title}</h1>
          <p>{notice.description}</p>
          <a className="outfit-page__back outfit-page__back--button" href="/">
            返回今日颜色
          </a>
        </section>
      </main>
    );
  }

  if (resolution.status === "detail-error") {
    const detailNotices = {
      invalid: {
        description: "链接信息不完整，请从今日搭配重新选择。",
        title: "暂时找不到这套搭配",
      },
      missing: {
        description: "这套搭配已经无法查看，请从今日搭配选择其他方案。",
        title: "这套搭配暂时无法查看",
      },
      stale: {
        description: "当天内容已经更新，请从首页重新查看当前版本。",
        title: "这套搭配已经更新",
      },
      unavailable: {
        description: "搭配详情还没有加载成功，请稍后再试。",
        title: "搭配详情暂时无法打开",
      },
    } as const;
    const notice = detailNotices[resolution.reason];

    return (
      <main className="outfit-page">
        <section className="outfit-page__notice" role="status">
          <p className="outfit-page__eyebrow">搭配方案详情</p>
          <h1>{notice.title}</h1>
          <p>{notice.description}</p>
          <a
            className="outfit-page__back outfit-page__back--button"
            href={resolution.selection.selectedCard.href}
          >
            返回今日搭配
          </a>
        </section>
      </main>
    );
  }

  const { selection } = resolution;
  const isPlanView = resolution.status === "detail";
  const lookDetail = isPlanView ? resolution.detail : null;

  return (
    <main className="outfit-page">
      <article
        aria-labelledby={isPlanView ? "outfit-detail-title" : undefined}
        className="outfit-page__sheet"
        data-content-version={selection.contentVersion}
      >
        <a className="outfit-page__back" href="/">
          <span aria-hidden="true">←</span>
          返回今日颜色
        </a>

        <header className="outfit-page__header">
          <p className="outfit-page__eyebrow">
            {isPlanView ? "已发布搭配方案" : "当天已核对的颜色组合"}
          </p>
          <h1 id={isPlanView ? "outfit-detail-title" : undefined}>
            {lookDetail?.title ?? "今日怎么搭"}
          </h1>
          <p>
            {selection.fortuneDate} ·{" "}
            {lookDetail === null ? "当天已审核方案" : lookDetail.scenarioLabel}
          </p>
        </header>

        {isPlanView && lookDetail !== null ? (
          <OutfitPlan detail={lookDetail} selection={selection} />
        ) : (
          <OutfitOverview selection={selection} />
        )}
        {isPlanView ? null : (
          <p className="outfit-page__rule-note">比例为穿搭参考，不是五行推算规则。</p>
        )}

        {isPlanView && selection.shareHref !== null ? (
          <FoundationAction fullWidth href={selection.shareHref} indicator="→">
            分享这套搭配
          </FoundationAction>
        ) : null}
        <a
          className="outfit-page__back outfit-page__back--button"
          href={isPlanView ? selection.selectedCard.href : "/"}
        >
          {isPlanView ? "查看其他搭配" : "回到今日首页"}
        </a>
      </article>
    </main>
  );
}
