import { TodayDateRegion } from "./today-date-region";
import type { TodayDateData } from "../lib/today";

export interface TodayPageContentProps {
  today: TodayDateData | null;
}

export function TodayPageContent({ today }: TodayPageContentProps) {
  return (
    <main className="page-shell">
      <div className="today-page">
        <header className="today-masthead">
          <div>
            <p className="today-masthead__brand">Five</p>
            <p className="today-masthead__description">每日五行穿衣参考</p>
          </div>
          <span className="foundation-seal" aria-hidden="true">
            五
          </span>
        </header>

        {today === null ? (
          <section className="today-unavailable" role="status">
            <p>今日内容正在校验中</p>
            <small>请稍后刷新页面。</small>
          </section>
        ) : (
          <TodayDateRegion today={today} />
        )}
      </div>
    </main>
  );
}
