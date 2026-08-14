export type ApprovalAction = "delete_file" | "push_live" | "permanent_operation";

export function requiresExplicitApproval(action: ApprovalAction): boolean {
  return action === "delete_file" || action === "push_live" || action === "permanent_operation";
}

export function approvalMessage(action: ApprovalAction): string {
  if (action === "delete_file") return "Delete operation requires explicit approval before workspace changes are accepted.";
  if (action === "push_live") return "Live repository push requires explicit approval before any remote commit or deployment action begins.";
  return "Permanent operation requires explicit approval before execution begins.";
}

