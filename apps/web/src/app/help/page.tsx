import { headers } from "next/headers";

import { loadToday, type TodayPageData } from "../../lib/today";
import { FeedbackForm, type FeedbackCategory, type FeedbackContext } from "./feedback-form";
import { LocalDataControls } from "./local-data-controls";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

interface HelpSearchParams {
  category?: SearchParamValue;
  channelId?: SearchParamValue;
  expectedContentVersion?: SearchParamValue;
  fortuneDate?: SearchParamValue;
}

interface HelpPageProps {
  searchParams: Promise<HelpSearchParams>;
}

const ORGANIC_CHANNEL_ID = "organic";

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function currentFeedbackContext(today: TodayPageData | null): FeedbackContext | null {
  const fortuneDate = today?.content.fortuneDate;
  const requestFortuneDate = today?.requestContext.fortuneDate;
  const contentVersion = today?.daJiCard?.contentVersion;
  if (
    typeof fortuneDate !== "string" ||
    fortuneDate !== requestFortuneDate ||
    !isBoundedString(contentVersion, 128)
  ) {
    return null;
  }

  return { channelId: ORGANIC_CHANNEL_ID, contentVersion, fortuneDate };
}

function resolveFeedbackContext(
  today: TodayPageData | null,
  params: HelpSearchParams,
): FeedbackContext | null {
  const current = currentFeedbackContext(today);
  if (current === null) {
    return null;
  }

  const carriesContentContext =
    params.fortuneDate !== undefined ||
    params.expectedContentVersion !== undefined ||
    params.channelId !== undefined;
  if (!carriesContentContext) {
    return current;
  }

  if (
    params.fortuneDate === current.fortuneDate &&
    params.expectedContentVersion === current.contentVersion &&
    isBoundedString(params.channelId, 64)
  ) {
    return { ...current, channelId: params.channelId };
  }

  return null;
}

function feedbackCategory(value: SearchParamValue): FeedbackCategory {
  return value === "product_feedback" ? "product_feedback" : "content_error";
}

function imageFeedbackHref(context: FeedbackContext | null): string {
  if (context === null) {
    return "#feedback";
  }
  const query = new URLSearchParams({
    category: "content_error",
    channelId: context.channelId,
    expectedContentVersion: context.contentVersion,
    fortuneDate: context.fortuneDate,
  });
  return `/help?${query.toString()}#feedback`;
}

export default async function HelpPage({ searchParams }: HelpPageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const today = await loadToday({ requestId: requestHeaders.get("x-request-id") });
  const context = resolveFeedbackContext(today, params);

  return (
    <main className="outfit-page help-page">
      <article
        className="outfit-page__sheet help-page__sheet"
        data-content-version={context?.contentVersion}
      >
        <a className="outfit-page__back" href="/">
          <span aria-hidden="true">←</span>
          返回今日首页
        </a>

        <header className="outfit-page__header help-page__header">
          <p className="outfit-page__eyebrow">Five 公开说明</p>
          <h1>使用说明与反馈</h1>
          <p>把边界、图片和数据说清楚，再安心看今天怎么穿。</p>
        </header>

        <nav aria-label="帮助页目录" className="help-page__index">
          <a href="#reference">参考边界</a>
          <a href="#images">图片与素材</a>
          <a href="#privacy">数据与隐私</a>
          <a href="#feedback">提交反馈</a>
        </nav>

        <section aria-labelledby="help-reference-title" className="help-section" id="reference">
          <header className="help-section__heading">
            <span aria-hidden="true">壹</span>
            <div>
              <p>先说明用途</p>
              <h2 id="help-reference-title">传统文化穿搭参考</h2>
            </div>
          </header>
          <p className="help-section__lead">内容基于传统文化规则整理，仅供穿搭参考。</p>
          <p>
            Five
            提供的是公共日期下的颜色搭配灵感，不会对现实结果作承诺，也不替代健康、财务、法律或其他重要决定所需的专业意见。
          </p>
        </section>

        <section aria-labelledby="help-images-title" className="help-section" id="images">
          <header className="help-section__heading">
            <span aria-hidden="true">贰</span>
            <div>
              <p>看图前知道</p>
              <h2 id="help-images-title">AI 图片与素材</h2>
            </div>
          </header>
          <p>
            当日图片可能由 AI
            离线生成。发布前，维护者会人工检查颜色配方、衣物结构、品牌与肖像、权利记录和 AI
            标识；用户访问时不会触发生成，也不会调用付费生图服务。
          </p>
          <p>问题图片可以单独下线并换成已审核配色卡，不影响当天日期、颜色和文字内容继续使用。</p>
          <a className="help-section__text-link" href={imageFeedbackHref(context)}>
            反馈问题图片
            <span aria-hidden="true">→</span>
          </a>
        </section>

        <section aria-labelledby="help-privacy-title" className="help-section" id="privacy">
          <header className="help-section__heading">
            <span aria-hidden="true">叁</span>
            <div>
              <p>匿名访问现状</p>
              <h2 id="help-privacy-title">数据与隐私</h2>
            </div>
          </header>
          <dl className="help-facts">
            <div>
              <dt>匿名统计</dt>
              <dd>
                当前未启用匿名访问统计，未接入第三方统计 SDK，不创建跨设备标识，也不使用分析
                Cookie；这类统计数据当前不产生，因此无需退出开关。
              </dd>
            </div>
            <div>
              <dt>网络与日志</dt>
              <dd>
                打开网页时，IP 地址和浏览器请求头会由网络与部署层为建立连接而处理；Five
                应用的通用逐请求访问日志目前关闭。接口失败时可能记录请求标识、错误类别及必要的日期、版本、渠道上下文用于排错，不记录反馈全文或联系方式，也不记录原始
                IP 或浏览器标识。
              </dd>
            </div>
            <div>
              <dt>主动反馈</dt>
              <dd>
                只有提交反馈时，才发送类别、正文、命理日期、内容版本、渠道标识和空联系方式，并由服务端关联请求标识用于排错。防滥用会把请求来源用进程随机密钥转换成只在内存存在的短期令牌：不保存原始网络地址，不跨进程或重启关联，一分钟窗口失效，闲置令牌最迟约两分钟清理。跨进程全局接收上限另保留每分钟已接收数量、触发该上限的拒绝数量和最后一个请求标识；不统计前置格式错误或单来源拦截，并在每次提交时清理超过
                24
                小时的窗口。反馈正文当前没有自动到期删除机制；公开试用前必须确定保存上限和退出渠道。在此之前按处理问题所需最少范围使用，不用于用户画像；不提交反馈即可避免产生这条记录。
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="help-local-title" className="help-section" id="local-data">
          <header className="help-section__heading">
            <span aria-hidden="true">肆</span>
            <div>
              <p>只在这台设备</p>
              <h2 id="help-local-title">本机公开内容缓存</h2>
            </div>
          </header>
          <p>
            浏览器只保存当前已发布的公开内容快照、命理日期、内容版本、有效期和刷新锚点，用于短暂断网或页面恢复；不保存身份档案，也不会跨设备同步。
          </p>
          <LocalDataControls />
        </section>

        <section aria-labelledby="help-agreement-title" className="help-section" id="agreement">
          <header className="help-section__heading">
            <span aria-hidden="true">伍</span>
            <div>
              <p>公开使用边界</p>
              <h2 id="help-agreement-title">使用约定</h2>
            </div>
          </header>
          <ul className="help-list">
            <li>请结合自己的衣物、场合和安全需要判断，不把颜色参考当作结果承诺。</li>
            <li>分享图片或文字时，请保留来源、内容版本和适用的 AI 标识。</li>
            <li>发现日期、颜色、文字或图片问题时，请通过下方内容纠错提交。</li>
          </ul>
        </section>

        <section aria-labelledby="help-policy-title" className="help-section" id="privacy-policy">
          <header className="help-section__heading">
            <span aria-hidden="true">陆</span>
            <div>
              <p>公开隐私说明</p>
              <h2 id="help-policy-title">隐私说明</h2>
            </div>
          </header>
          <p>
            浏览 Five
            的公开内容无需提供身份、个人命理或家人资料，我们也不会主动索取。若自行写入反馈正文，内容会随反馈保存，因此请勿提供敏感资料；本机数据可随时在上方清除。
          </p>
        </section>

        <section
          aria-labelledby="help-feedback-title"
          className="help-section help-section--feedback"
        >
          <header className="help-section__heading">
            <span aria-hidden="true">柒</span>
            <div>
              <p>无需留下联系方式</p>
              <h2 id="help-feedback-title">匿名反馈</h2>
            </div>
          </header>
          {context === null ? (
            <p className="help-feedback-unavailable" id="feedback" role="status">
              {currentFeedbackContext(today) === null
                ? "当前内容版本尚未加载完整，请返回今日首页刷新后再提交；本页公开说明仍可继续阅读。"
                : "这条帮助链接的日期、版本或渠道信息与当前内容不一致。为避免把问题记到错误版本，请从要反馈的当前页面重新进入。"}
            </p>
          ) : (
            <FeedbackForm context={context} initialCategory={feedbackCategory(params.category)} />
          )}
        </section>

        <footer className="help-page__footer">
          <span aria-hidden="true">五</span>
          <p>公开、克制、可核对</p>
        </footer>
      </article>
    </main>
  );
}
