import type { DailyDateData } from "../lib/today";
import { formatPublicFortuneDate } from "./today-date-region";

export interface DailyDateRegionProps {
  daily: DailyDateData;
}

export function DailyDateRegion({ daily }: DailyDateRegionProps) {
  const { calendar, fortuneDate } = daily.content;

  return (
    <section
      aria-labelledby="daily-element-heading"
      className="today-date-card"
      data-day-element={calendar.dayElement}
      data-day-element-label={calendar.dayElementLabel}
    >
      <div className="today-date-card__calendar">
        <time dateTime={fortuneDate}>{formatPublicFortuneDate(fortuneDate)}</time>
        <span aria-hidden="true">·</span>
        <span>{calendar.weekdayText}</span>
      </div>

      <h1 id="daily-element-heading" aria-label={`当日${calendar.dayElementLabel}日`}>
        当日<span>{calendar.dayElementLabel}</span>日
      </h1>

      <dl className="today-date-card__details" aria-label="当日历法信息">
        <div>
          <dt>农历</dt>
          <dd>{calendar.lunarDateText}</dd>
        </div>
        <div>
          <dt>日干支</dt>
          <dd>{calendar.ganzhiDay}日</dd>
        </div>
        <div>
          <dt>日五行</dt>
          <dd>{calendar.dayElementLabel}</dd>
        </div>
      </dl>
    </section>
  );
}
