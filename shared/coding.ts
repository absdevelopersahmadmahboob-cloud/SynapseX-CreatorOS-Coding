export type CodingRunStatus =
  | "planned"
  | "awaiting_review"
  | "verifying"
  | "passed"
  | "failed"
  | "needs_approval";

export type ParsedCodingTask = {
  inputLanguage: string;
  taskType: string;
  deliverable: string;
  scope: string[];
  implementationPlan: string[];
  verificationPlan: string[];
  confirmationRequired: boolean;
  confirmationReason: string | null;
  romanUrduResponse: string;
};

export type FileChangeOperation = "create" | "update" | "delete";

export type ApprovalAction = "delete_file" | "push_live" | "permanent_operation";

