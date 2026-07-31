import { headers } from "next/headers";

import { TodayPageState } from "../components/today-page-state";
import { loadTodayResult } from "../lib/today";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const requestId = (await headers()).get("x-request-id");
  const result = await loadTodayResult({ requestId });

  return <TodayPageState result={result} />;
}
