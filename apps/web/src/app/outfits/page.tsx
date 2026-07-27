import { headers } from "next/headers";
import type { CSSProperties } from "react";

import { OutfitOverviewImage } from "../../components/outfit-overview-image";
import { reviewedColorPalette } from "../../lib/color-palette";
import {
  loadToday,
  resolveOutfitPreviewImages,
  type OutfitPreviewCardData,
  type TodayImagePreviewCardData,
  type TodayPageData,
} from "../../lib/today";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

interface OutfitsPageProps {
  searchParams: Promise<Record<string, SearchParamValue>>;
}

interface SelectedOutfit {
  cards: OutfitPreviewCardData[];
  contentVersion: string;
  fortuneDate: string;
  imagesByFormula: ReadonlyMap<string, TodayImagePreviewCardData>;
  selectedCard: OutfitPreviewCardData;
  view: "all" | "plan";
}

type OutfitResolution =
  | {
      selection: SelectedOutfit;
      status: "selected";
    }
  | {
      status: "invalid" | "stale" | "unavailable";
    };

const kindLabels = {
  dual: "双色",
  mono: "单色",
  triple: "三色",
} as const;

function getSingleSearchParam(value: SearchParamValue): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function selectOutfit(
  today: TodayPageData | null,
  params: Record<string, SearchParamValue>,
): OutfitResolution {
  const expectedContentVersion = getSingleSearchParam(params.expectedContentVersion);
  const formulaId = getSingleSearchParam(params.formulaId);
  const fortuneDate = getSingleSearchParam(params.fortuneDate);
  const view = params.view === undefined ? "all" : getSingleSearchParam(params.view);

  if (
    expectedContentVersion === null ||
    formulaId === null ||
    fortuneDate === null ||
    (view !== "all" && view !== "plan")
  ) {
    return { status: "invalid" };
  }

  const section = today?.outfitPreviewSection;
  if (today === null || section === null || section === undefined) {
    return { status: "unavailable" };
  }

  if (
    today.content.fortuneDate !== fortuneDate ||
    section.contentVersion !== expectedContentVersion
  ) {
    return { status: "stale" };
  }

  const card = section.cards.find((candidate) => candidate.formulaId === formulaId);
  const imagesByFormula = resolveOutfitPreviewImages(section, today.imagePreviewSection);

  return card === undefined
    ? { status: "invalid" }
    : {
        status: "selected",
        selection: {
          cards: section.cards,
          contentVersion: section.contentVersion,
          fortuneDate,
          imagesByFormula,
          selectedCard: card,
          view,
        },
      };
}

function OutfitSlots({
  card,
  kindLabel,
}: {
  card: OutfitPreviewCardData;
  kindLabel: (typeof kindLabels)[OutfitPreviewCardData["kind"]];
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
              const style = {
                "--selected-outfit-color": presentation.value,
              } as CSSProperties;

              return (
                <li className="selected-outfit-color" key={color.colorCode}>
                  <span
                    aria-hidden="true"
                    className={
                      presentation.isLight
                        ? "selected-outfit-color__dot selected-outfit-color__dot--light"
                        : "selected-outfit-color__dot"
                    }
                    style={style}
                  />
                  <span>{color.name}</span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function OutfitPlan({ selection }: { selection: SelectedOutfit }) {
  const card = selection.selectedCard;
  const kindLabel = kindLabels[card.kind];

  return (
    <section
      aria-labelledby="selected-outfit-title"
      className={`selected-outfit selected-outfit--${card.kind}`}
      data-content-version={selection.contentVersion}
    >
      <div className="selected-outfit__heading">
        <span>{kindLabel}</span>
        <h2 id="selected-outfit-title">{card.title}</h2>
      </div>

      <OutfitSlots card={card} kindLabel={kindLabel} />
      <p className="selected-outfit__note">{card.description}</p>
    </section>
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
                <OutfitOverviewImage card={image} eager={card.formulaId === firstImageFormulaId} />
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
            <a
              aria-label={`查看${card.title}详情`}
              className="outfit-overview__action"
              href={`${card.href}&view=plan`}
            >
              查看方案详情
              <span aria-hidden="true">›</span>
            </a>
          </section>
        );
      })}
    </div>
  );
}

export default async function OutfitsPage({ searchParams }: OutfitsPageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const today = await loadToday({ requestId: requestHeaders.get("x-request-id") });
  const resolution = selectOutfit(today, params);

  if (resolution.status !== "selected") {
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
    const notice = notices[resolution.status];

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

  const { selection } = resolution;
  const selectedKindLabel = kindLabels[selection.selectedCard.kind];
  const isPlanView = selection.view === "plan";

  return (
    <main className="outfit-page">
      <article className="outfit-page__sheet">
        <a className="outfit-page__back" href="/">
          <span aria-hidden="true">←</span>
          返回今日颜色
        </a>

        <header className="outfit-page__header">
          <p className="outfit-page__eyebrow">当天已核对的颜色组合</p>
          <h1>今日怎么搭</h1>
          <p>
            {selection.fortuneDate} · {isPlanView ? `${selectedKindLabel}方案` : "当天已审核方案"}
          </p>
        </header>

        {isPlanView ? (
          <OutfitPlan selection={selection} />
        ) : (
          <OutfitOverview selection={selection} />
        )}
        <p className="outfit-page__rule-note">比例为穿搭参考，不是五行推算规则。</p>

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
