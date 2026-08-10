"use client";

import { useEffect, useRef } from "react";

import {
  trackAnalyticsEvent,
  type AnalyticsEventContext,
  type AnalyticsEventName,
} from "../../lib/analytics";

interface OutfitAnalyticsReporterProps extends AnalyticsEventContext {
  eventName: Extract<AnalyticsEventName, "open_outfit_hub" | "view_look_detail">;
}

export function OutfitAnalyticsReporter({
  channelId,
  contentVersion,
  eventName,
  fortuneDate,
}: OutfitAnalyticsReporterProps) {
  const trackedRef = useRef(false);

  useEffect(() => {
    if (trackedRef.current) {
      return;
    }
    trackedRef.current = true;
    trackAnalyticsEvent({ channelId, contentVersion, eventName, fortuneDate });
  }, [channelId, contentVersion, eventName, fortuneDate]);

  return null;
}
