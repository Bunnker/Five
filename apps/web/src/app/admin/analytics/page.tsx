import { AdminAnalyticsReportScreen } from "../admin-analytics-report";

type SearchParamValue = string | string[] | undefined;

interface AdminAnalyticsPageProps {
  searchParams: Promise<{ days?: SearchParamValue }>;
}

export default async function AdminAnalyticsPage({ searchParams }: AdminAnalyticsPageProps) {
  const query = await searchParams;
  const days = query.days === "30" ? 30 : 7;
  return <AdminAnalyticsReportScreen days={days} />;
}
