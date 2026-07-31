import { headers } from "next/headers";

import { TodayPageState } from "../components/today-page-state";
import { loadTodayResult } from "../lib/today";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const requestId = (await headers()).get("x-request-id");
  const result = await loadTodayResult({ requestId });
  const stateKey =
    result.kind === "ready"
      ? `ready:${result.snapshot.contentVersion}`
      : `${result.kind}:${result.kind === "refresh_failed" ? result.reason : "none"}`;

  return <TodayPageState key={stateKey} result={result} />;
}
