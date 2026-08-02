import type { components, operations } from "./generated";

type Assert<T extends true> = T;
type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

type ImageSetInvalidResponse = components["responses"]["ImageSetInvalid"];
type InvalidArgumentResponse = components["responses"]["InvalidArgument"];
type ResourceNotFoundResponse = components["responses"]["ResourceNotFound"];

// These compile-time checks keep the two controller-visible 422 outcomes in the
// generated public contract instead of relying on undocumented implementation behavior.
export type UpdateDraftModuleDocumentsImageSetInvalid = Assert<
  IsEqual<operations["updateDailyContentDraftModule"]["responses"][422], ImageSetInvalidResponse>
>;

export type SubmitDraftDocumentsImageSetInvalid = Assert<
  IsEqual<operations["submitDailyContentDraft"]["responses"][422], ImageSetInvalidResponse>
>;

// Every lifecycle write can reject malformed input before reaching the domain
// service and can report that its target version or fortune date does not exist.
export type ScheduleDocumentsInvalidArgument = Assert<
  IsEqual<operations["scheduleDailyContentVersion"]["responses"][400], InvalidArgumentResponse>
>;
export type ScheduleDocumentsResourceNotFound = Assert<
  IsEqual<operations["scheduleDailyContentVersion"]["responses"][404], ResourceNotFoundResponse>
>;
export type CancelScheduleDocumentsInvalidArgument = Assert<
  IsEqual<operations["cancelDailyContentSchedule"]["responses"][400], InvalidArgumentResponse>
>;
export type CancelScheduleDocumentsResourceNotFound = Assert<
  IsEqual<operations["cancelDailyContentSchedule"]["responses"][404], ResourceNotFoundResponse>
>;
export type PublishDocumentsInvalidArgument = Assert<
  IsEqual<operations["publishDailyContentVersion"]["responses"][400], InvalidArgumentResponse>
>;
export type PublishDocumentsResourceNotFound = Assert<
  IsEqual<operations["publishDailyContentVersion"]["responses"][404], ResourceNotFoundResponse>
>;
export type WithdrawDocumentsInvalidArgument = Assert<
  IsEqual<operations["withdrawDailyContentVersion"]["responses"][400], InvalidArgumentResponse>
>;
export type WithdrawDocumentsResourceNotFound = Assert<
  IsEqual<operations["withdrawDailyContentVersion"]["responses"][404], ResourceNotFoundResponse>
>;
export type RollbackDocumentsInvalidArgument = Assert<
  IsEqual<operations["rollbackDailyContentDay"]["responses"][400], InvalidArgumentResponse>
>;
export type RollbackDocumentsResourceNotFound = Assert<
  IsEqual<operations["rollbackDailyContentDay"]["responses"][404], ResourceNotFoundResponse>
>;
