type SkeletonLineWidth = "compact" | "medium" | "wide";

interface SkeletonLineProps {
  width?: SkeletonLineWidth;
}

function SkeletonLine({ width = "wide" }: SkeletonLineProps) {
  return <span className={`today-page-skeleton__line today-page-skeleton__line--${width}`} />;
}

interface TierSkeletonProps {
  priority: "primary" | "secondary" | "tertiary";
}

function TierSkeleton({ priority }: TierSkeletonProps) {
  return (
    <article
      aria-hidden="true"
      className={`decision-card today-tier-card decision-card--${priority} today-page-skeleton__tier`}
      data-skeleton-section={`tier-${priority}`}
    >
      <div className="decision-card__rank today-page-skeleton__rank">
        <span className="today-page-skeleton__rank-number" />
        <span className="today-page-skeleton__rank-label" />
      </div>
      <div className="decision-card__body today-page-skeleton__tier-body">
        <div className="today-page-skeleton__tier-heading">
          <SkeletonLine width="medium" />
          <SkeletonLine width="compact" />
        </div>
        <div className="today-page-skeleton__swatches">
          {Array.from({ length: 5 }, (_, index) => (
            <span className="today-page-skeleton__swatch" key={index} />
          ))}
        </div>
        <SkeletonLine />
      </div>
    </article>
  );
}

function OutfitSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="outfit-preview today-page-skeleton__outfits"
      data-skeleton-section="outfits"
    >
      <div className="today-page-skeleton__section-heading">
        <SkeletonLine width="medium" />
        <SkeletonLine width="compact" />
      </div>
      <div className="outfit-preview__cards">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="outfit-preview-card today-page-skeleton__outfit-card" key={index}>
            <SkeletonLine width="compact" />
            <SkeletonLine width="medium" />
            <span className="today-page-skeleton__outfit-block" />
          </div>
        ))}
      </div>
    </section>
  );
}

function ImageSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="today-image-preview today-page-skeleton__images"
      data-skeleton-section="images"
    >
      <div className="today-page-skeleton__section-heading">
        <SkeletonLine width="medium" />
        <SkeletonLine width="compact" />
      </div>
      <div className="today-image-preview__grid">
        {Array.from({ length: 2 }, (_, index) => (
          <div className="today-image-card today-page-skeleton__image-card" key={index}>
            <span className="today-image-card__media today-page-skeleton__image-media" />
            <div className="today-page-skeleton__image-copy">
              <SkeletonLine width="medium" />
              <SkeletonLine />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TodayPageSkeleton() {
  return (
    <main aria-busy="true" className="page-shell">
      <div className="today-page today-page--home today-page-skeleton">
        <header className="today-masthead">
          <div className="today-masthead__identity">
            <p className="today-masthead__brand">
              <span>Five</span>
              <span>五行穿衣</span>
            </p>
            <p className="today-masthead__description">每日五行搭配参考</p>
          </div>
          <div aria-hidden="true" className="today-masthead__actions">
            <span className="today-page-skeleton__share" />
          </div>
        </header>

        <p aria-atomic="true" aria-live="polite" className="visually-hidden" role="status">
          正在加载今日内容
        </p>

        <section
          aria-hidden="true"
          className="today-date-card today-page-skeleton__date"
          data-skeleton-section="date"
        >
          <div className="today-date-card__layout">
            <div className="today-date-card__date-plaque today-page-skeleton__date-plaque">
              <SkeletonLine width="compact" />
              <span className="today-page-skeleton__date-number" />
              <SkeletonLine width="compact" />
            </div>
            <div className="today-date-card__summary today-page-skeleton__date-summary">
              <SkeletonLine width="medium" />
              <SkeletonLine />
              <div className="today-page-skeleton__date-details">
                <SkeletonLine width="compact" />
                <SkeletonLine width="compact" />
                <SkeletonLine width="compact" />
              </div>
            </div>
          </div>
        </section>

        <TierSkeleton priority="primary" />
        <TierSkeleton priority="secondary" />
        <TierSkeleton priority="tertiary" />

        <section
          aria-hidden="true"
          className="attention-section today-page-skeleton__attention"
          data-skeleton-section="attention"
        >
          <div className="today-page-skeleton__attention-groups">
            {Array.from({ length: 2 }, (_, index) => (
              <div className="today-page-skeleton__attention-row" key={index}>
                <SkeletonLine width="compact" />
                <div className="today-page-skeleton__swatches">
                  {Array.from({ length: 5 }, (__, swatchIndex) => (
                    <span className="today-page-skeleton__swatch" key={swatchIndex} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="attention-balance today-page-skeleton__balance">
            <div>
              <SkeletonLine width="medium" />
              <SkeletonLine />
            </div>
            <span className="today-page-skeleton__balance-pills" />
          </div>
        </section>

        <OutfitSkeleton />
        <ImageSkeleton />

        <nav
          aria-hidden="true"
          className="today-next-steps today-page-skeleton__next-steps"
          data-skeleton-section="next-steps"
        >
          <span className="foundation-action foundation-action--full today-page-skeleton__action" />
          <div className="today-next-steps__secondary">
            <span className="today-page-skeleton__secondary-action" />
            <span className="today-page-skeleton__secondary-action" />
          </div>
        </nav>
      </div>
    </main>
  );
}
