"use client";

import { useEffect, useRef } from "react";

import {
  trackAnalyticsEvent,
  type AnalyticsEventContext,
  type AnalyticsEventName,
} from "../../../lib/analytics";

interface DailyAnalyticsReporterProps extends AnalyticsEventContext {
  eventName: Extract<
    AnalyticsEventName,
    "poster_landing_view" | "share_link_landing_view" | "view_daily_look"
  >;
  referralId: string | null;
  sourceContentVersion: string | null;
}

export function DailyAnalyticsReporter({
  channelId,
  contentVersion,
  eventName,
  fortuneDate,
  referralId,
  sourceContentVersion,
}: DailyAnalyticsReporterProps) {
  const trackedRef = useRef(false);

  useEffect(() => {
    if (trackedRef.current) {
      return;
    }
    trackedRef.current = true;
    trackAnalyticsEvent({
      channelId,
      contentVersion,
      eventName,
      fortuneDate,
      referralId,
      sourceContentVersion,
    });
  }, [channelId, contentVersion, eventName, fortuneDate, referralId, sourceContentVersion]);

  return null;
}
