import { CiJiColorCard } from "./ci-ji-color-card";
import { DaJiColorCard } from "./da-ji-color-card";
import { PingColorCard } from "./ping-color-card";
import { TodayDateRegion } from "./today-date-region";
import type { TodayPageData } from "../lib/today";

export interface TodayPageContentProps {
  today: TodayPageData | null;
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
          <>
            <TodayDateRegion today={today} />
            {today.daJiCard === null ? null : (
              <>
                <DaJiColorCard tier={today.daJiCard} />
                {today.ciJiCard === null ? null : (
                  <>
                    <CiJiColorCard tier={today.ciJiCard} />
                    {today.pingCard === null ? null : <PingColorCard tier={today.pingCard} />}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
