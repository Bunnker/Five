"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import {
  adminApi,
  describeAdminApiError,
  type AdminAnalyticsChannelPoint,
  type AdminAnalyticsDailyPoint,
  type AdminAnalyticsReport,
} from "./admin-api";
import { AdminSessionGate } from "./admin-session-gate";
import { useAdminUnauthorizedHandler } from "./use-admin-unauthorized-handler";

/*
 * The charts intentionally use the contract's named metrics rather than a generic chart-data
 * abstraction. This keeps product meaning (browser, view, share) visible at the UI boundary.
 */
type AnalyticsReportLoadState =
  | { kind: "error"; message: string }
  | { kind: "loading" }
  | { data: AdminAnalyticsReport; kind: "ready" };

const numberFormatter = new Intl.NumberFormat("zh-CN");
const percentFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: "percent",
});

function formatPercent(value: number | null): string {
  return value === null ? "暂无" : percentFormatter.format(value);
}

function formatShortDate(fortuneDate: string): string {
  const [, month = "", day = ""] = fortuneDate.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function channelLabel(channelId: AdminAnalyticsChannelPoint["channelId"]): string {
  switch (channelId) {
    case "organic":
      return "直接访问";
    case "wechat_official":
      return "公众号";
    case "wechat_group":
      return "微信群";
    case "user_share":
      return "用户分享";
    case "other":
      return "其他";
    default:
      return "其他";
  }
}

function MetricCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <article className="admin-analytics-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

type LineSeries = {
  className: string;
  label: string;
  value: (point: AdminAnalyticsDailyPoint) => number;
};

const lineSeries: LineSeries[] = [
  {
    className: "admin-analytics-line--views",
    label: "页面浏览",
    value: (point) => point.pageViews,
  },
  {
    className: "admin-analytics-line--browsers",
    label: "匿名浏览器",
    value: (point) => point.anonymousBrowsers,
  },
  {
    className: "admin-analytics-line--shares",
    label: "分享发起",
    value: (point) => point.shareInitiations,
  },
];

function polylinePoints(
  daily: AdminAnalyticsDailyPoint[],
  value: LineSeries["value"],
  maximum: number,
): string {
  const chartLeft = 48;
  const chartRight = 700;
  const chartTop = 24;
  const chartBottom = 208;
  return daily
    .map((point, index) => {
      const x =
        daily.length === 1
          ? (chartLeft + chartRight) / 2
          : chartLeft + (index / (daily.length - 1)) * (chartRight - chartLeft);
      const y = chartBottom - (value(point) / maximum) * (chartBottom - chartTop);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function TrafficLineChart({ daily, days }: { daily: AdminAnalyticsDailyPoint[]; days: 7 | 30 }) {
  const maximum = Math.max(
    1,
    ...daily.flatMap((point) => lineSeries.map((series) => series.value(point))),
  );
  const tickIndexes =
    days === 7
      ? daily.map((_, index) => index)
      : [0, 7, 14, 21, daily.length - 1].filter(
          (index, position, indexes) => index >= 0 && indexes.indexOf(index) === position,
        );
  const recordedTrafficDays = daily.filter((point) => point.pageViews > 0).length;

  return (
    <section className="admin-analytics-panel admin-analytics-panel--trend">
      <header>
        <div>
          <p className="admin-kicker">访问趋势</p>
          <h2>每天有多少浏览和分享动作</h2>
        </div>
        <span>按内容日期统计</span>
      </header>
      <div className="admin-analytics-chart-scroll">
        <svg
          aria-label={`最近 ${days} 天访问趋势`}
          className="admin-analytics-line-chart"
          role="img"
          viewBox="0 0 720 250"
        >
          <title>{`最近 ${days} 天访问趋势`}</title>
          <desc>三条折线分别表示每日页面浏览、匿名浏览器和分享发起次数。</desc>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = 208 - ratio * 184;
            return (
              <g key={ratio}>
                <line className="admin-analytics-grid-line" x1="48" x2="700" y1={y} y2={y} />
                <text className="admin-analytics-axis-label" x="40" y={y + 4}>
                  {Math.round(maximum * ratio)}
                </text>
              </g>
            );
          })}
          {lineSeries.map((series) => (
            <polyline
              className={`admin-analytics-line ${series.className}`}
              fill="none"
              key={series.label}
              points={polylinePoints(daily, series.value, maximum)}
            />
          ))}
          {tickIndexes.map((index) => {
            const point = daily[index];
            if (point === undefined) return null;
            const x = daily.length === 1 ? 374 : 48 + (index / (daily.length - 1)) * (700 - 48);
            return (
              <text
                className="admin-analytics-axis-label admin-analytics-axis-label--date"
                key={point.fortuneDate}
                textAnchor="middle"
                x={x}
                y="236"
              >
                {formatShortDate(point.fortuneDate)}
              </text>
            );
          })}
        </svg>
      </div>
      <ul className="admin-analytics-legend" aria-label="访问趋势图例">
        {lineSeries.map((series) => (
          <li key={series.label}>
            <span className={series.className} aria-hidden="true" />
            {series.label}
          </li>
        ))}
      </ul>
      {recordedTrafficDays === 1 ? (
        <p className="admin-analytics-sample-note">目前样本不足以判断趋势</p>
      ) : null}
    </section>
  );
}

function BehaviorBarChart({ report }: { report: AdminAnalyticsReport }) {
  const bars = [
    { label: "匿名浏览器", value: report.summary.anonymousBrowsers },
    { label: "打开搭配", value: report.summary.outfitHubVisitors },
    { label: "查看具体穿法", value: report.summary.outfitDetailVisitors },
    { label: "发起分享的浏览器", value: report.summary.sharingBrowsers },
    { label: "分享回流浏览器", value: report.summary.referredBrowsers },
  ];
  const maximum = Math.max(1, ...bars.map((item) => item.value));

  return (
    <figure aria-label="区间行为人数对比" className="admin-analytics-panel admin-analytics-bars">
      <figcaption>
        <p className="admin-kicker">行为人数对比</p>
        <h2>关键行为发生了多少</h2>
        <span>各项独立去重，不代表严格漏斗</span>
      </figcaption>
      <ul>
        {bars.map((bar) => (
          <li key={bar.label}>
            <div>
              <span>{bar.label}</span>
              <strong>{numberFormatter.format(bar.value)}</strong>
            </div>
            <span className="admin-analytics-bar-track" aria-hidden="true">
              <span
                className="admin-analytics-bar-fill"
                data-zero={bar.value === 0 ? "true" : undefined}
                style={
                  {
                    "--admin-analytics-bar-size": `${(bar.value / maximum) * 100}%`,
                  } as CSSProperties
                }
              />
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function ChannelDonutChart({ channels }: { channels: AdminAnalyticsChannelPoint[] }) {
  const visibleChannels = channels.filter((channel) => channel.pageViews > 0);
  if (visibleChannels.length === 0) {
    return (
      <section className="admin-analytics-panel admin-analytics-channels admin-analytics-channels--empty">
        <header>
          <p className="admin-kicker">访问来源</p>
          <h2>暂无可计算的访问来源</h2>
        </header>
        <p>当前区间没有页面浏览，因此不绘制来源占比。</p>
      </section>
    );
  }
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;

  return (
    <section className="admin-analytics-panel admin-analytics-channels">
      <header>
        <p className="admin-kicker">访问来源</p>
        <h2>页面浏览从哪里来</h2>
      </header>
      <div className="admin-analytics-channels__content">
        <svg
          aria-label="页面浏览来源占比"
          className="admin-analytics-donut"
          role="img"
          viewBox="0 0 140 140"
        >
          <title>页面浏览来源占比</title>
          <desc>环形图按页面浏览次数展示直接访问、公众号、微信群、用户分享和其他来源。</desc>
          <circle className="admin-analytics-donut__track" cx="70" cy="70" r={radius} />
          {visibleChannels.map((channel) => {
            const ratio = channel.ratio ?? 0;
            const offset = -consumed * circumference;
            consumed += ratio;
            return (
              <circle
                className={`admin-analytics-donut__segment admin-analytics-donut__segment--${channel.channelId}`}
                cx="70"
                cy="70"
                key={channel.channelId}
                r={radius}
                strokeDasharray={`${ratio * circumference} ${circumference}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </svg>
        <ul className="admin-analytics-channel-list">
          {visibleChannels.map((channel) => (
            <li key={channel.channelId}>
              <span
                className={`admin-analytics-channel-dot admin-analytics-channel-dot--${channel.channelId}`}
                aria-hidden="true"
              />
              <span>{channelLabel(channel.channelId)}</span>
              <strong>{numberFormatter.format(channel.pageViews)} 次浏览</strong>
              <small>{formatPercent(channel.ratio)}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function DailyDetails({ daily }: { daily: AdminAnalyticsDailyPoint[] }) {
  return (
    <details className="admin-analytics-details">
      <summary>查看每日明细数据</summary>
      <div>
        <table>
          <caption>每日匿名使用统计明细</caption>
          <thead>
            <tr>
              <th scope="col">日期</th>
              <th scope="col">浏览</th>
              <th scope="col">匿名浏览器</th>
              <th scope="col">打开搭配</th>
              <th scope="col">具体穿法</th>
              <th scope="col">分享发起</th>
              <th scope="col">分享回流</th>
              <th scope="col">确认保存海报</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((point) => (
              <tr key={point.fortuneDate}>
                <th scope="row">{point.fortuneDate}</th>
                <td>{point.pageViews}</td>
                <td>{point.anonymousBrowsers}</td>
                <td>{point.outfitHubVisitors}</td>
                <td>{point.outfitDetailVisitors}</td>
                <td>{point.shareInitiations}</td>
                <td>{point.referredBrowsers}</td>
                <td>{point.posterSaveSucceeded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ReportState({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="admin-analytics-state">
      <span className="admin-analytics-state__mark" aria-hidden="true" />
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function hasRecordedActivity(report: AdminAnalyticsReport): boolean {
  const summary = report.summary;
  return (
    summary.pageViews > 0 ||
    summary.anonymousBrowsers > 0 ||
    summary.outfitHubVisitors > 0 ||
    summary.outfitDetailVisitors > 0 ||
    summary.shareInitiations > 0 ||
    summary.referredBrowsers > 0 ||
    summary.posterSaveRequests > 0
  );
}

export function AdminAnalyticsReportView({ report }: { report: AdminAnalyticsReport }) {
  const summary = report.summary;
  const reportDays = report.days;

  return (
    <div className="admin-analytics-report">
      <section className="admin-analytics-hero">
        <div>
          <p className="admin-kicker">匿名使用统计</p>
          <h1>数据报表</h1>
          <p>匿名浏览器不等于真实用户；分享发起不等于微信发送成功。所有数字都来自真实匿名事件。</p>
        </div>
        <div className="admin-analytics-range" role="group" aria-label="报表时间范围">
          <Link aria-current={reportDays === 7 ? "page" : undefined} href="/admin/analytics?days=7">
            近 7 天
          </Link>
          <Link
            aria-current={reportDays === 30 ? "page" : undefined}
            href="/admin/analytics?days=30"
          >
            近 30 天
          </Link>
        </div>
      </section>

      {report.collectionStatus === "unavailable" ? (
        <ReportState title="匿名统计暂时不可用">
          <p>当前采集状态无法确认，已有数字可能不完整，因此暂不把它们展示成可靠报表。</p>
          <span>内容发布、预览和修改不受影响。</span>
        </ReportState>
      ) : !hasRecordedActivity(report) ? (
        <ReportState title="还没有真实访问数据">
          <p>统计已经开启；真实访问发生后，这里会自动出现趋势和来源。</p>
          <span>不会用样例内容填充报表，也不会把空值包装成增长。</span>
        </ReportState>
      ) : (
        <>
          <section className="admin-analytics-metrics" aria-label="区间关键指标">
            <MetricCard
              detail="当前浏览器随机标识去重"
              label="匿名浏览器"
              value={`${numberFormatter.format(summary.anonymousBrowsers)} 个`}
            />
            <MetricCard
              detail="首页与每日详情浏览合计"
              label="页面浏览"
              value={`${numberFormatter.format(summary.pageViews)} 次`}
            />
            <MetricCard
              detail={`${summary.outfitDetailVisitors} 个浏览器查看具体穿法`}
              label="访问者深入率"
              value={formatPercent(summary.outfitDetailRate.ratio)}
            />
            <MetricCard
              detail={`${summary.shareInitiations} 次分享动作被发起`}
              label="分享发起率"
              value={formatPercent(summary.shareInitiationRate.ratio)}
            />
            <MetricCard
              detail="排除分享者本人后的回流"
              label="分享带回访问"
              value={`${numberFormatter.format(summary.referredBrowsers)} 个`}
            />
            <MetricCard
              detail={`用户确认；已知失败 ${summary.posterSaveFailed} 次`}
              label="确认保存海报"
              value={`${numberFormatter.format(summary.posterSaveSucceeded)} 次`}
            />
          </section>

          <section className="admin-analytics-dashboard" aria-label="匿名使用趋势与来源">
            <TrafficLineChart daily={report.daily} days={report.days} />
            <BehaviorBarChart report={report} />
            <ChannelDonutChart channels={report.channelBreakdown} />
          </section>
          <DailyDetails daily={report.daily} />
        </>
      )}
      <p className="admin-analytics-footnote">
        报表区间：{report.fromFortuneDate} 至 {report.toFortuneDate} · 更新时间：
        {new Intl.DateTimeFormat("zh-CN", {
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          month: "short",
          timeZone: "Asia/Shanghai",
          timeZoneName: "short",
          year: "numeric",
        }).format(new Date(report.generatedAt))}
      </p>
    </div>
  );
}

function AnalyticsReportLoader({ days }: { days: 7 | 30 }) {
  const handleUnauthorized = useAdminUnauthorizedHandler();
  const [retryRevision, setRetryRevision] = useState(0);
  const [state, setState] = useState<AnalyticsReportLoadState>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    void (async () => {
      const result = await adminApi.getAnalyticsReport(days);
      if (!current) return;
      if (!result.ok) {
        if (handleUnauthorized(result.error.status)) return;
        setState({ kind: "error", message: describeAdminApiError(result.error, true) });
        return;
      }
      setState({ data: result.data, kind: "ready" });
    })();
    return () => {
      current = false;
    };
  }, [days, handleUnauthorized, retryRevision]);

  if (state.kind === "ready") return <AdminAnalyticsReportView report={state.data} />;
  if (state.kind === "error") {
    return (
      <section className="admin-analytics-load-state">
        <p className="admin-kicker">数据暂不可用</p>
        <h1>暂时没有拿到数据报表</h1>
        <p role="alert">{state.message}</p>
        <button
          className="admin-button admin-button--quiet"
          onClick={() => setRetryRevision((value) => value + 1)}
          type="button"
        >
          重新读取
        </button>
      </section>
    );
  }
  return (
    <section className="admin-analytics-load-state" aria-live="polite">
      <span className="admin-state-card__mark" aria-hidden="true" />
      <h1>正在读取数据报表</h1>
      <p>只读取真实匿名事件，不生成演示数字。</p>
    </section>
  );
}

export function AdminAnalyticsReportScreen({ days }: { days: 7 | 30 }) {
  return <AdminSessionGate>{() => <AnalyticsReportLoader days={days} />}</AdminSessionGate>;
}
