import { AdminOperationsDay } from "../../admin-operations-ui";

export default async function AdminCalendarDayPage({
  params,
}: {
  params: Promise<{ fortuneDate: string }>;
}) {
  const { fortuneDate } = await params;
  return <AdminOperationsDay fortuneDate={fortuneDate} />;
}
