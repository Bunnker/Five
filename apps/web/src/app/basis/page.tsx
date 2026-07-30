import { headers } from "next/headers";

import { ColorSwatch } from "../../components/visual-foundation";
import { toBasisGuideData, type BasisTierData } from "../../lib/basis-guide";
import { reviewedColorPalette } from "../../lib/color-palette";
import { loadToday } from "../../lib/today";
import {
  resolveTodayEntry,
  type TodayEntrySearchParams,
  type TodayEntryResolution,
} from "../../lib/today-entry";

export const dynamic = "force-dynamic";

interface BasisPageProps {
  searchParams: Promise<TodayEntrySearchParams>;
}

function BasisTier({ tier }: { tier: BasisTierData }) {
  const isLowerTier = tier.tierCode === "jiao_cha" || tier.tierCode === "bu_li";
  const publicLabel = isLowerTier ? tier.algorithmLabel : tier.displayLabel;
  const supportingLabel = isLowerTier ? "今天减少大面积使用" : tier.algorithmLabel;
  const accessibleName = isLowerTier
    ? tier.algorithmLabel
    : `${tier.algorithmLabel} ${publicLabel}`;

  return (
    <li>
      <article aria-label={accessibleName} className="basis-tier">
        <header className="basis-tier__heading">
          <span aria-hidden="true" className="basis-tier__rank">
            {String(tier.rank).padStart(2, "0")}
          </span>
          <div>
            <h3>{publicLabel}</h3>
            <p>{supportingLabel}</p>
          </div>
          <strong>{tier.elementLabel}</strong>
        </header>
        <p className="basis-tier__relation">{tier.relationText}</p>
        <ul aria-label={`${tier.algorithmLabel}颜色`} className="basis-tier__colors">
          {tier.colors.map((color) => {
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
      </article>
    </li>
  );
}

function BasisNotice({ status }: { status: Exclude<TodayEntryResolution["status"], "ready"> }) {
  const notices = {
    invalid: {
      description: "链接信息不完整，请从首页重新进入。",
      title: "暂时找不到这份推算依据",
    },
    stale: {
      description: "当天内容已经更新，请返回首页查看当前版本。",
      title: "这份推算依据已经更新",
    },
    unavailable: {
      description: "当日依据还没有加载完整，请稍后再试。",
      title: "推算依据暂时无法打开",
    },
  } as const;
  const notice = notices[status];

  return (
    <main className="outfit-page">
      <section className="outfit-page__notice" role="status">
        <p className="outfit-page__eyebrow">为什么这样排</p>
        <h1>{notice.title}</h1>
        <p>{notice.description}</p>
        <a className="outfit-page__back outfit-page__back--button" href="/">
          返回今日首页
        </a>
      </section>
    </main>
  );
}

export default async function BasisPage({ searchParams }: BasisPageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const today = await loadToday({ requestId: requestHeaders.get("x-request-id") });
  const guide = toBasisGuideData(today);
  const resolution = resolveTodayEntry(today, params, {
    contentVersion: today?.basis?.contentVersion,
  });

  if (resolution.status !== "ready") {
    return <BasisNotice status={resolution.status} />;
  }

  if (guide === null || guide.contentVersion !== resolution.contentVersion) {
    return <BasisNotice status="unavailable" />;
  }

  return (
    <main className="outfit-page basis-page">
      <article
        aria-labelledby="basis-page-title"
        className="outfit-page__sheet basis-page__sheet"
        data-content-version={resolution.contentVersion}
      >
        <a className="outfit-page__back" href="/">
          <span aria-hidden="true">←</span>
          返回今日首页
        </a>

        <header className="outfit-page__header">
          <p className="outfit-page__eyebrow">当天公开推算依据</p>
          <h1 id="basis-page-title">为什么这样排</h1>
          <p>
            {resolution.fortuneDate} · {guide.dayElementLabel}日
          </p>
        </header>

        <p className="basis-page__source-note">
          日期干支按固定历法规则计算；穿衣分档依据本产品采用的传统五行规则整理。
        </p>

        <section aria-labelledby="basis-steps-title" className="basis-section">
          <header className="basis-section__heading">
            <p>按顺序看</p>
            <h2 id="basis-steps-title">三步看懂当天五行</h2>
          </header>
          <ol className="basis-steps">
            {guide.steps.map((step, index) => (
              <li key={step.label}>
                <span aria-hidden="true" className="basis-step__number">
                  {index + 1}
                </span>
                <div>
                  <p>{step.label}</p>
                  <strong>{step.value}</strong>
                  <span>{step.description}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="basis-tiers-title" className="basis-section">
          <header className="basis-section__heading">
            <p>从{guide.dayElementLabel}日到穿衣建议</p>
            <h2 id="basis-tiers-title">五档与颜色</h2>
          </header>
          <ol className="basis-tiers">
            {guide.tiers.map((tier) => (
              <BasisTier key={tier.tierCode} tier={tier} />
            ))}
          </ol>
        </section>

        <p className="basis-page__disclaimer">{guide.basis.disclaimer}</p>
      </article>
    </main>
  );
}
