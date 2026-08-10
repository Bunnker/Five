"use client";

import { useCallback } from "react";

import { useAdminSession } from "./admin-session-context";

export function useAdminUnauthorizedHandler(): (status: number) => boolean {
  const { clearSession } = useAdminSession();
  return useCallback(
    (status: number) => {
      if (status !== 401) return false;
      clearSession();
      return true;
    },
    [clearSession],
  );
}
