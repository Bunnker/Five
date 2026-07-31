"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

type AdminNavigationGuardContextValue = {
  setNavigationBlocked: (blocked: boolean) => void;
};

const AdminNavigationGuardContext = createContext<AdminNavigationGuardContextValue | null>(null);

export function AdminNavigationGuard({ children }: { children: ReactNode }) {
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [showReminder, setShowReminder] = useState(false);

  useEffect(() => {
    if (!navigationBlocked) {
      setShowReminder(false);
      return;
    }

    const protectUnsavedCodes = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedCodes);
    return () => window.removeEventListener("beforeunload", protectUnsavedCodes);
  }, [navigationBlocked]);

  const value = useMemo(() => ({ setNavigationBlocked }), []);

  function interceptAdminNavigation(event: MouseEvent<HTMLDivElement>) {
    if (!navigationBlocked) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest("a[href]") === null) return;
    event.preventDefault();
    event.stopPropagation();
    setShowReminder(true);
  }

  return (
    <AdminNavigationGuardContext.Provider value={value}>
      <div onClickCapture={interceptAdminNavigation}>
        {children}
        {showReminder ? (
          <p className="admin-navigation-reminder" role="status">
            请先离线保存恢复码并勾选确认，再离开本页。
          </p>
        ) : null}
      </div>
    </AdminNavigationGuardContext.Provider>
  );
}

export function useAdminNavigationGuard(): AdminNavigationGuardContextValue {
  const value = useContext(AdminNavigationGuardContext);
  if (value === null) {
    throw new Error("useAdminNavigationGuard must be rendered inside AdminNavigationGuard");
  }
  return value;
}
