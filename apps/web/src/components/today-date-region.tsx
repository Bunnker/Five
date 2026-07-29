import type { TodayDateData } from "../lib/today";

export interface TodayDateRegionProps {
  today: TodayDateData;
}

export function formatPublicFortuneDate(fortuneDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(fortuneDate);

  if (match === null) {
    return fortuneDate;
  }

  const [, year, month, day] = match;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export function TodayDateRegion({ today }: TodayDateRegionProps) {
  const { calendar } = today.content;
  const { crossedDayBoundary, fortuneDate, shichen } = today.requestContext;

  return (
    <section
      className="today-date-card"
      data-day-element={calendar.dayElement}
      data-day-element-label={calendar.dayElementLabel}
      aria-labelledby="today-element-heading"
    >
      <div className="today-date-card__calendar">
        <time dateTime={fortuneDate}>{formatPublicFortuneDate(fortuneDate)}</time>
        <span aria-hidden="true">·</span>
        <span>{calendar.weekdayText}</span>
      </div>

      <h1 id="today-element-heading" aria-label={`今日${calendar.dayElementLabel}日`}>
        今日<span>{calendar.dayElementLabel}</span>日
      </h1>

      <dl className="today-date-card__details" aria-label="今日历法信息">
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

      {crossedDayBoundary ? <p className="today-date-card__boundary-note">已进入次日子时</p> : null}
    </section>
  );
}
