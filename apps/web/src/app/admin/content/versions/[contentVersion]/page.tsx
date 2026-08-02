import { ContentVersionReview } from "./content-version-review";

export default async function AdminContentVersionPage({
  params,
}: {
  params: Promise<{ contentVersion: string }>;
}) {
  const { contentVersion } = await params;
  return <ContentVersionReview contentVersion={contentVersion} />;
}
