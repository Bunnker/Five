import { headers } from "next/headers";

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
  const resolution = resolveTodayEntry(today, params, {
    contentVersion: today?.basis?.contentVersion,
  });

  if (resolution.status !== "ready") {
    return <BasisNotice status={resolution.status} />;
  }

  const basis = resolution.today.basis;
  if (basis === null || basis === undefined) {
    return <BasisNotice status="unavailable" />;
  }

  return (
    <main className="outfit-page">
      <article
        aria-labelledby="basis-page-title"
        className="outfit-page__sheet"
        data-content-version={resolution.contentVersion}
      >
        <a className="outfit-page__back" href="/">
          <span aria-hidden="true">←</span>
          返回今日首页
        </a>

        <header className="outfit-page__header">
          <p className="outfit-page__eyebrow">当天公开推算依据</p>
          <h1 id="basis-page-title">为什么这样排</h1>
          <p>{resolution.fortuneDate}</p>
        </header>

        <section aria-labelledby="basis-steps-title" className="selected-outfit">
          <div className="selected-outfit__heading">
            <span>按顺序看</span>
            <h2 id="basis-steps-title">当天依据</h2>
          </div>
          <ol className="selected-outfit__slots">
            {basis.steps.map((step, index) => (
              <li className="selected-outfit-slot" key={`${index}:${step}`}>
                {step}
              </li>
            ))}
          </ol>
          <p className="selected-outfit__note">{basis.disclaimer}</p>
        </section>
      </article>
    </main>
  );
}
