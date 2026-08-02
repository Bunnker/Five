import { DraftEditor } from "./draft-editor";

export default async function AdminDraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return <DraftEditor draftId={draftId} />;
}
