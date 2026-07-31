"use client";

import type { paths as FiveApiPaths } from "@five/api-contract";
import { useEffect, useRef, useState, type FormEvent } from "react";

type CreateFeedbackOperation = FiveApiPaths["/api/v1/feedback-reports"]["post"];
type CreateFeedbackRequest = CreateFeedbackOperation["requestBody"]["content"]["application/json"];
type CreateFeedbackResponse =
  CreateFeedbackOperation["responses"][202]["content"]["application/json"];

export type FeedbackCategory = CreateFeedbackRequest["category"];
export type FeedbackContext = Pick<
  CreateFeedbackRequest,
  "channelId" | "contentVersion" | "fortuneDate"
>;

interface FeedbackFormProps {
  context: FeedbackContext;
  initialCategory: FeedbackCategory;
}

type SubmissionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

function isCreateFeedbackResponse(value: unknown): value is CreateFeedbackResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    Object.keys(response).length === 2 &&
    response.status === "received" &&
    typeof response.feedbackId === "string" &&
    response.feedbackId.length >= 1 &&
    response.feedbackId.length <= 128
  );
}

export function FeedbackForm({ context, initialCategory }: FeedbackFormProps) {
  const [category, setCategory] = useState<FeedbackCategory>(initialCategory);
  const [message, setMessage] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({ kind: "idle" });
  const activeController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeController.current?.abort();
    },
    [],
  );

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submission.kind === "submitting") {
      return;
    }

    const normalizedMessage = message.trim();
    if (normalizedMessage.length === 0) {
      setSubmission({ kind: "error", message: "请先写下反馈内容。" });
      return;
    }

    const requestBody = {
      category,
      channelId: context.channelId,
      contact: null,
      contentVersion: context.contentVersion,
      fortuneDate: context.fortuneDate,
      message: normalizedMessage,
    } satisfies CreateFeedbackRequest;
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    setSubmission({ kind: "submitting" });

    try {
      const response = await fetch("/api/v1/feedback-reports", {
        body: JSON.stringify(requestBody),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (response.status === 429) {
        setSubmission({ kind: "error", message: "请求较多，请稍后再试。" });
        return;
      }

      if (response.status === 503) {
        setSubmission({
          kind: "error",
          message: "反馈暂时无法接收，今日公共内容仍可继续使用。",
        });
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      if (response.status !== 202 || !isCreateFeedbackResponse(body)) {
        setSubmission({ kind: "error", message: "暂时没能提交，请保留文字后重试。" });
        return;
      }

      setMessage("");
      setSubmission({ kind: "success" });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setSubmission({ kind: "error", message: "暂时没能提交，请检查网络后重试。" });
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
      }
    }
  }

  const status =
    submission.kind === "success"
      ? "已经收到，谢谢你帮我们检查。"
      : submission.kind === "error"
        ? submission.message
        : null;

  return (
    <form
      aria-label="匿名反馈"
      className="help-feedback"
      data-channel-id={context.channelId}
      data-content-version={context.contentVersion}
      data-fortune-date={context.fortuneDate}
      id="feedback"
      onSubmit={submitFeedback}
    >
      <fieldset>
        <legend>反馈类别</legend>
        <div className="help-feedback__categories">
          <label>
            <input
              aria-label="内容或图片有误"
              checked={category === "content_error"}
              name="feedback-category"
              onChange={() => setCategory("content_error")}
              type="radio"
              value="content_error"
            />
            <span>
              <strong>内容或图片有误</strong>
              <small>颜色、文字、图片或日期需要检查</small>
            </span>
          </label>
          <label>
            <input
              aria-label="产品建议"
              checked={category === "product_feedback"}
              name="feedback-category"
              onChange={() => setCategory("product_feedback")}
              type="radio"
              value="product_feedback"
            />
            <span>
              <strong>产品建议</strong>
              <small>使用体验或功能建议</small>
            </span>
          </label>
        </div>
      </fieldset>

      <label className="help-feedback__message" htmlFor="feedback-message">
        <span>
          反馈内容 <small>{message.length}/2000</small>
        </span>
        <textarea
          aria-label="反馈内容"
          id="feedback-message"
          maxLength={2000}
          onChange={(event) => {
            setMessage(event.currentTarget.value);
            if (submission.kind !== "idle") {
              setSubmission({ kind: "idle" });
            }
          }}
          placeholder="请描述你看到的问题或建议"
          required
          rows={6}
          value={message}
        />
      </label>

      <p className="help-feedback__safety">
        本表不设置单独的联系方式字段，也不会主动索取。请勿在反馈正文填写姓名、电话、住址、证件、健康或其他敏感资料。
      </p>
      <p className="help-feedback__context">
        关联内容：{context.fortuneDate} · {context.contentVersion}
      </p>

      <button
        className="foundation-action foundation-action--button foundation-action--full"
        disabled={submission.kind === "submitting"}
        type="submit"
      >
        <span>{submission.kind === "submitting" ? "正在提交" : "提交匿名反馈"}</span>
        <span aria-hidden="true">→</span>
      </button>

      {status === null ? null : (
        <p
          className={`help-feedback__status help-feedback__status--${submission.kind}`}
          role={submission.kind === "error" ? "alert" : "status"}
        >
          {status}
        </p>
      )}
    </form>
  );
}
