import type { TodayDateData } from "../lib/today";

export interface TodayDateRegionProps {
  today: TodayDateData;
}

export function formatPublicFortuneDate(fortuneDate: string): string {
  const dateParts = splitPublicFortuneDate(fortuneDate);
  if (dateParts === null) {
    return fortuneDate;
  }

  return `${dateParts.year}年${dateParts.month}月${dateParts.day}日`;
}

function splitPublicFortuneDate(fortuneDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(fortuneDate);

  if (match === null) {
    return null;
  }

  const [, year, month, day] = match;
  return {
    day: String(Number(day)),
    month: String(Number(month)),
    year,
  };
}

function InkLandscape() {
  return (
    <svg
      aria-hidden="true"
      className="today-date-card__landscape"
      focusable="false"
      viewBox="0 0 220 126"
    >
      <defs>
        <linearGradient id="ink-mountain-wash" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.04" />
          <stop offset="0.55" stopColor="currentColor" stopOpacity="0.19" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.06" />
        </linearGradient>
        <filter id="ink-mountain-soften" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
      </defs>
      <path
        d="M2 111c23-14 34-32 49-48 9-10 15-5 20 9 6 15 11 16 19 3 10-17 20-34 35-57 4-6 9-6 13 1 12 21 19 39 30 47 7 5 15-5 23-16 8-12 14-9 18 5 4 13 7 32 11 56Z"
        fill="url(#ink-mountain-wash)"
        filter="url(#ink-mountain-soften)"
      />
      <path
        d="M12 110c24-13 36-30 51-48M79 106c20-23 29-48 48-81M126 29c10 20 18 38 39 51M164 81c12-5 19-19 27-29"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeOpacity="0.16"
        strokeWidth="1.2"
      />
      <path
        d="M139 83h24m-20 0 3-10h10l3 10m-15-10 7-6 7 6m-9 10v13m7-13v13m-12 0h17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.24"
        strokeWidth="1.15"
      />
      <path
        d="M38 38c5-4 9-4 14 0m6-9c4-3 7-3 11 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeOpacity="0.25"
        strokeWidth="1.1"
      />
    </svg>
  );
}

export function TodayDateRegion({ today }: TodayDateRegionProps) {
  const { calendar, fortuneDate } = today.content;
  const { crossedDayBoundary, shichen } = today.requestContext;
  const { advancedFromCivilDate } = today.publicContentContext;
  const formattedDate = formatPublicFortuneDate(fortuneDate);
  const dateParts = splitPublicFortuneDate(fortuneDate);

  return (
    <section
      className="today-date-card"
      data-admin-selection-key="calendar.summary"
      data-day-element={calendar.dayElement}
      data-day-element-label={calendar.dayElementLabel}
      aria-labelledby="today-element-heading"
    >
      <div className="today-date-card__layout">
        <time
          aria-label={`${formattedDate} ${calendar.weekdayText}`}
          className="today-date-card__date-plaque"
          dateTime={fortuneDate}
        >
          <span className="visually-hidden">{formattedDate}</span>
          {dateParts === null ? (
            <span aria-hidden="true" className="today-date-card__date-fallback">
              {formattedDate}
            </span>
          ) : (
            <span aria-hidden="true" className="today-date-card__date-parts">
              <span className="today-date-card__year">{dateParts.year}年</span>
              <span className="today-date-card__month">
                <strong>{dateParts.month}</strong>
                <small>月</small>
              </span>
              <span className="today-date-card__day">
                <strong>{dateParts.day}</strong>
                <small>日</small>
              </span>
            </span>
          )}
          <span className="today-date-card__weekday">{calendar.weekdayText}</span>
        </time>

        <div className="today-date-card__summary">
          <dl className="today-date-card__calendar" aria-label="今日历法信息">
            <div>
              <dt>农历</dt>
              <dd>{calendar.lunarDateText}</dd>
            </div>
            <div>
              <dt>日干支</dt>
              <dd>{calendar.ganzhiDay}日</dd>
            </div>
            <div>
              <dt>当前时辰</dt>
              <dd>{shichen}时</dd>
            </div>
          </dl>

          <h1 id="today-element-heading" aria-label={`今日${calendar.dayElementLabel}日`}>
            今日<strong>{calendar.dayElementLabel}</strong>日
          </h1>
        </div>
      </div>

      <InkLandscape />

      {advancedFromCivilDate ? (
        <p className="today-date-card__boundary-note">明日建议已更新</p>
      ) : null}
      {crossedDayBoundary ? <p className="today-date-card__boundary-note">已进入次日子时</p> : null}
    </section>
  );
}
