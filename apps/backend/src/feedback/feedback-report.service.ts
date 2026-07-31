import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import {
  FEEDBACK_REPORT_REPOSITORY,
  type CreateFeedbackReportResult,
  type CreateFeedbackRequest,
  type FeedbackReportRepository,
} from "./feedback-report.repository";

export const FEEDBACK_ID_FACTORY = Symbol("FEEDBACK_ID_FACTORY");

export type FeedbackIdFactory = () => string;

export function createFeedbackId(): string {
  return `feedback_${randomUUID()}`;
}

@Injectable()
export class FeedbackReportService {
  constructor(
    @Inject(FEEDBACK_REPORT_REPOSITORY)
    private readonly repository: FeedbackReportRepository,
    @Inject(FEEDBACK_ID_FACTORY)
    private readonly idFactory: FeedbackIdFactory,
  ) {}

  submit(request: CreateFeedbackRequest, requestId: string): Promise<CreateFeedbackReportResult> {
    return this.repository.create({
      ...request,
      contact: request.contact === null ? null : request.contact.trim(),
      feedbackId: this.idFactory(),
      message: request.message.trim(),
      requestId,
    });
  }
}
