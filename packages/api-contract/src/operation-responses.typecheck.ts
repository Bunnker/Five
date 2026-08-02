import type { components, operations } from "./generated";

type Assert<T extends true> = T;
type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

type ImageSetInvalidResponse = components["responses"]["ImageSetInvalid"];

// These compile-time checks keep the two controller-visible 422 outcomes in the
// generated public contract instead of relying on undocumented implementation behavior.
export type UpdateDraftModuleDocumentsImageSetInvalid = Assert<
  IsEqual<operations["updateDailyContentDraftModule"]["responses"][422], ImageSetInvalidResponse>
>;

export type SubmitDraftDocumentsImageSetInvalid = Assert<
  IsEqual<operations["submitDailyContentDraft"]["responses"][422], ImageSetInvalidResponse>
>;
