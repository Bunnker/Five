"use client";

import type { FiveApiPaths } from "./api-contract";

type CreateAnalyticsEventRequest =
  FiveApiPaths["/api/v1/analytics-events"]["post"]["requestBody"]["content"]["application/json"];

export type AnalyticsEventName = CreateAnalyticsEventRequest["eventName"];

export type AnalyticsEventContext = Pick<
  CreateAnalyticsEventRequest,
  "channelId" | "contentVersion" | "fortuneDate"
>;

export type TrackAnalyticsEventInput = AnalyticsEventContext & {
  eventName: AnalyticsEventName;
  posterInstanceId?: string | null;
  referralId?: string | null;
  sourceContentVersion?: string | null;
};

export const ANALYTICS_ANONYMOUS_ID_KEY = "five:analytics:v1:anonymous-id";
export const ANALYTICS_OPT_OUT_KEY = "five:analytics:v1:opt-out";

const ANALYTICS_ENDPOINT = "/api/v1/analytics-events";
const ANALYTICS_ID_PATTERN = /^[-A-Za-z0-9_:.]{16,128}$/u;

function localStorageOrNull(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createRandomId(prefix: "browser" | "event" | "referral"): string | null {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    return null;
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${value}`;
}

export function analyticsOptedOut(): boolean {
  const storage = localStorageOrNull();
  if (storage === null) {
    return true;
  }

  try {
    return storage.getItem(ANALYTICS_OPT_OUT_KEY) === "true";
  } catch {
    return true;
  }
}

function getOrCreateAnonymousId(): string | null {
  const storage = localStorageOrNull();
  if (storage === null || analyticsOptedOut()) {
    return null;
  }

  try {
    const existing = storage.getItem(ANALYTICS_ANONYMOUS_ID_KEY);
    if (
      existing !== null &&
      existing.startsWith("browser:") &&
      ANALYTICS_ID_PATTERN.test(existing)
    ) {
      return existing;
    }
    if (existing !== null) {
      storage.removeItem(ANALYTICS_ANONYMOUS_ID_KEY);
    }
    const created = createRandomId("browser");
    if (created === null) {
      return null;
    }
    storage.setItem(ANALYTICS_ANONYMOUS_ID_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export function clearAnalyticsAnonymousId(): boolean {
  const storage = localStorageOrNull();
  if (storage === null) {
    return false;
  }

  try {
    storage.removeItem(ANALYTICS_ANONYMOUS_ID_KEY);
    return true;
  } catch {
    return false;
  }
}

export function setAnalyticsOptOut(optedOut: boolean): boolean {
  const storage = localStorageOrNull();
  if (storage === null) {
    return false;
  }

  try {
    if (optedOut) {
      storage.setItem(ANALYTICS_OPT_OUT_KEY, "true");
      storage.removeItem(ANALYTICS_ANONYMOUS_ID_KEY);
    } else {
      storage.removeItem(ANALYTICS_OPT_OUT_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function generateAnalyticsReferralId(): string | null {
  return analyticsOptedOut() ? null : createRandomId("referral");
}

function normalizedEventFields(
  input: TrackAnalyticsEventInput,
): Pick<
  CreateAnalyticsEventRequest,
  "eventName" | "posterInstanceId" | "referralId" | "sourceContentVersion"
> | null {
  switch (input.eventName) {
    case "open_outfit_hub":
    case "view_daily_look":
    case "view_look_detail":
    case "view_today_summary":
      return {
        eventName: input.eventName,
        posterInstanceId: null,
        referralId: null,
        sourceContentVersion: null,
      };
    case "share_summary_initiated":
      return typeof input.referralId === "string"
        ? {
            eventName: input.eventName,
            posterInstanceId: null,
            referralId: input.referralId,
            sourceContentVersion: null,
          }
        : null;
    case "share_link_landing_view":
      return typeof input.referralId === "string" && typeof input.sourceContentVersion === "string"
        ? {
            eventName: input.eventName,
            posterInstanceId: null,
            referralId: input.referralId,
            sourceContentVersion: input.sourceContentVersion,
          }
        : null;
    case "share_poster_initiated":
      return typeof input.referralId === "string" && typeof input.posterInstanceId === "string"
        ? {
            eventName: input.eventName,
            posterInstanceId: input.posterInstanceId,
            referralId: input.referralId,
            sourceContentVersion: null,
          }
        : null;
    case "poster_save_failed":
    case "poster_save_requested":
    case "poster_save_succeeded":
      return typeof input.posterInstanceId === "string"
        ? {
            eventName: input.eventName,
            posterInstanceId: input.posterInstanceId,
            referralId: null,
            sourceContentVersion: null,
          }
        : null;
    case "poster_landing_view":
      return typeof input.referralId === "string" && typeof input.sourceContentVersion === "string"
        ? {
            eventName: input.eventName,
            posterInstanceId: null,
            referralId: input.referralId,
            sourceContentVersion: input.sourceContentVersion,
          }
        : null;
  }
}

function fallbackFetch(body: string): void {
  if (typeof fetch !== "function") {
    return;
  }

  try {
    void fetch(ANALYTICS_ENDPOINT, {
      body,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  } catch {
    // Anonymous analytics must never block or change the public experience.
  }
}

export function trackAnalyticsEvent(input: TrackAnalyticsEventInput): void {
  const anonymousId = getOrCreateAnonymousId();
  const eventId = createRandomId("event");
  const eventFields = normalizedEventFields(input);
  if (anonymousId === null || eventId === null || eventFields === null) {
    return;
  }

  const request = {
    anonymousId,
    channelId: input.channelId,
    contentVersion: input.contentVersion,
    eventId,
    eventName: eventFields.eventName,
    fortuneDate: input.fortuneDate,
    posterInstanceId: eventFields.posterInstanceId,
    referralId: eventFields.referralId,
    sourceContentVersion: eventFields.sourceContentVersion,
  } as CreateAnalyticsEventRequest;
  const body = JSON.stringify(request);

  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: "application/json" }))
    ) {
      return;
    }
  } catch {
    // Fall through to the same-origin keepalive request.
  }

  fallbackFetch(body);
}
