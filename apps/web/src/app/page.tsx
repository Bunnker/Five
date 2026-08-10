import { headers } from "next/headers";

import { TodayPageState } from "../components/today-page-state";
import { parsePublicChannelId } from "../lib/channel-links";
import { loadTodayResult } from "../lib/today";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

interface HomePageProps {
  searchParams: Promise<{
    channelId?: SearchParamValue;
  }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [query, requestHeaders] = await Promise.all([searchParams, headers()]);
  const requestId = requestHeaders.get("x-request-id");
  const result = await loadTodayResult({ requestId });

  return (
    <TodayPageState
      channelId={parsePublicChannelId(query.channelId) ?? "organic"}
      result={result}
    />
  );
}
