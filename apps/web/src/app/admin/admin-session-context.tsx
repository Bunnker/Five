"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { adminApi, describeAdminApiError, type AdminSession } from "./admin-api";

type AdminSessionState =
  | { kind: "loading" }
  | { kind: "authenticated"; session: AdminSession }
  | { kind: "unauthenticated" }
  | { kind: "unavailable"; message: string };

type AdminSessionContextValue = {
  adoptSession: (session: AdminSession) => void;
  clearSession: () => void;
  refreshSession: () => Promise<void>;
  state: AdminSessionState;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminSessionState>({ kind: "loading" });
  const requestSequenceRef = useRef(0);

  const refreshSession = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current;
    setState({ kind: "loading" });
    const result = await adminApi.getSession();
    if (requestSequence !== requestSequenceRef.current) return;
    if (result.ok) {
      setState({ kind: "authenticated", session: result.data });
      return;
    }
    if (result.error.status === 401) {
      setState({ kind: "unauthenticated" });
      return;
    }
    setState({
      kind: "unavailable",
      message: describeAdminApiError(result.error, true),
    });
  }, []);

  useEffect(() => {
    void refreshSession();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [refreshSession]);

  useEffect(() => {
    if (state.kind !== "authenticated") return;
    const deadlineMs = Math.min(
      Date.parse(state.session.idleExpiresAt),
      Date.parse(state.session.absoluteExpiresAt),
    );
    let revalidationStarted = false;
    const revalidateExpiredSession = () => {
      if (revalidationStarted || Date.now() < deadlineMs) return;
      revalidationStarted = true;
      void refreshSession();
    };
    const remainingMs = Math.max(0, deadlineMs - Date.now());
    const expiryTimer = window.setTimeout(revalidateExpiredSession, remainingMs);
    const revalidateVisibleSession = () => {
      if (document.visibilityState === "visible") revalidateExpiredSession();
    };
    document.addEventListener("visibilitychange", revalidateVisibleSession);
    window.addEventListener("focus", revalidateExpiredSession);
    return () => {
      window.clearTimeout(expiryTimer);
      document.removeEventListener("visibilitychange", revalidateVisibleSession);
      window.removeEventListener("focus", revalidateExpiredSession);
    };
  }, [refreshSession, state]);

  useEffect(() => {
    const revalidateRestoredPage = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setState({ kind: "loading" });
      void refreshSession();
    };
    window.addEventListener("pageshow", revalidateRestoredPage);
    return () => window.removeEventListener("pageshow", revalidateRestoredPage);
  }, [refreshSession]);

  const value = useMemo<AdminSessionContextValue>(
    () => ({
      adoptSession: (session) => {
        requestSequenceRef.current += 1;
        setState({ kind: "authenticated", session });
      },
      clearSession: () => {
        requestSequenceRef.current += 1;
        setState({ kind: "unauthenticated" });
      },
      refreshSession,
      state,
    }),
    [refreshSession, state],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionContextValue {
  const value = useContext(AdminSessionContext);
  if (value === null) {
    throw new Error("useAdminSession must be rendered inside AdminSessionProvider");
  }
  return value;
}
