import { headers } from "next/headers";

import { TodayPageContent } from "../components/today-page-content";
import { loadToday } from "../lib/today";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const requestId = (await headers()).get("x-request-id");
  const today = await loadToday({ requestId });

  return <TodayPageContent today={today} />;
}
