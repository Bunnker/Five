"use client";

import type { MouseEvent } from "react";

import type { CompleteTodayPageData } from "../lib/today";
import { TodayPageContent } from "./today-page-content";

export interface DailyExperienceViewProps {
  channelId?: string | undefined;
  mode?: "admin-preview" | "public" | undefined;
  onSelectionChange?: ((selectionKey: string) => void) | undefined;
  today: CompleteTodayPageData;
}

export function DailyExperienceView({
  channelId = "organic",
  mode = "public",
  onSelectionChange,
  today,
}: DailyExperienceViewProps) {
  function selectAdminObject(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const isAdminPreview = mode === "admin-preview" || onSelectionChange !== undefined;
    if (isAdminPreview && target.closest("a") !== null) event.preventDefault();
    if (onSelectionChange === undefined) return;
    const selectable = target.closest<HTMLElement>("[data-admin-selection-key]");
    const selectionKey = selectable?.dataset.adminSelectionKey;
    if (selectionKey === undefined) return;
    if (isAdminPreview) event.preventDefault();
    onSelectionChange(selectionKey);
  }

  return (
    <div className="daily-experience-view" onClick={selectAdminObject}>
      <TodayPageContent
        channelId={channelId}
        interactiveShare={mode === "public" && onSelectionChange === undefined}
        today={today}
      />
    </div>
  );
}
