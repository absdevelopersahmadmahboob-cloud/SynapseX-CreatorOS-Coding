import { invokeLLM } from "../../_core/llm";
import type { ParsedCodingTask } from "../../../shared/coding";

export type ProposedCodeChange = {
  path: string;
  operation: "create" | "update" | "delete";
  content: string | null;
  rationale: string;
};

export type CodeProposal = {
  romanUrduResponse: string;
  changes: ProposedCodeChange[];
};

export const CODING_TASK_SCHEMA = {
  name: "coding_task_interpretation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      inputLanguage: { type: "string" },
      taskType: { type: "string" },
      executionMode: { type: "string", enum: ["plan_only", "propose_code"] },
      deliverableKind: { type: "string", enum: ["website", "local_script", "other"] },
      localScriptKind: { type: "string", enum: ["powershell", "shell", "none"] },
      deliverable: { type: "string" },
      scope: { type: "array", items: { type: "string" } },
      implementationPlan: { type: "array", items: { type: "string" } },
      verificationPlan: { type: "array", items: { type: "string" } },
      confirmationRequired: { type: "boolean" },
      confirmationReason: { type: ["string", "null"] },
      romanUrduResponse: { type: "string" },
    },
    required: [
      "inputLanguage",
      "taskType",
      "executionMode",
      "deliverableKind",
      "localScriptKind",
      "deliverable",
      "scope",
      "implementationPlan",
      "verificationPlan",
      "confirmationRequired",
      "confirmationReason",
      "romanUrduResponse",
    ],
  },
} as const;

export function buildCodingSystemPrompt(): string {
  return `You are SynapseX CreatorOS Coding, a universal software engineering assistant. You accept user instructions in any natural language, including English, Roman Urdu, Hindi, Urdu script, or mixed language. Your role is strictly to understand and complete software-development work through code: web applications, APIs, scripts, automation, mobile projects, debugging, refactoring, documentation, infrastructure, and deployment configuration.

Interpret the user's ENTIRE instruction before deciding the task. Use the complete sentence, verbs, objects, qualifiers, negations, dependencies, requested deliverable, and surrounding context. Never route or plan a task from an isolated keyword. For example, a request asking for video-generation training topics is a planning/content task, not an instruction to generate a video. A request describing a previous deployment failure is a debugging task, not an instruction to deploy.

Set executionMode to "propose_code" when the user clearly asks to create, build, implement, fix, modify, scaffold, or generate a coding deliverable. Set it to "plan_only" when the user only requests analysis, explanation, review, architecture, ideas, test guidance, or explicitly says not to make changes. Set deliverableKind to "website" for an initial website or web application, "local_script" for a local OS operation script, and "other" otherwise. For local_script, set localScriptKind to "powershell" for a Windows or PC request, "shell" for a requested Unix shell script, and "none" otherwise. A reviewed proposal is not an applied change: no workspace file is applied unless the user later reviews and accepts it.

For a request to create a folder or carry out another local operating-system file action, do not call it invalid and do not claim direct control over the user's PC. Treat it as coding work and plan a safe, copyable PowerShell or shell script as a workspace file. For a request to build a website or application in an empty workspace, plan complete runnable source files rather than merely describing a ZIP. Prefer a self-contained index.html, CSS and JavaScript when the user does not name a stack, so the result can be previewed locally after acceptance.

Do not impose artificial categories or narrow the user's task. Classify taskType freely as a descriptive string. Identify every deliverable and choose verification appropriate to the actual request. Never claim that code was executed, files were changed, or tests passed unless an execution result is provided separately.

All user-facing explanation must be in Roman Urdu written with Latin characters only. Do not use Urdu script, Devanagari, or English prose in romanUrduResponse. Technical filenames, command names, product names, and code identifiers may remain unchanged where necessary. The response should confirm the understood objective, explain the intended coding work, and state whether explicit approval is required for a permanent consequence. Require confirmation only for deletion, live repository pushes, production deployment, or another irreversible operation.

Return only the requested JSON object.`;
}

function hasNonRomanScript(value: string): boolean {
  return /[\u0600-\u06ff\u0900-\u097f]/i.test(value);
}

function fallbackRomanUrduResponse(taskType: string): string {
  return `Main ne aapki poori request ko ${taskType} task ke tor par samjha hai. Main code plan aur verification steps review ke liye tayar kar raha hoon.`;
}

export function normalizeTaskType(value: unknown): string {
  const taskType = typeof value === "string" ? value.trim() : "";
  const invalidSystemLabels = new Set(["invalid-request", "clarification-required", "invalid request", "clarification required"]);
  if (!taskType || invalidSystemLabels.has(taskType.toLowerCase())) return "coding-request";
  return taskType;
}

export function parseLlmJson<T>(content: unknown, responseName: string): T {
  if (typeof content !== "string") {
    throw new Error(`${responseName} returned an unsupported response`);
  }

  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectText = withoutFence.startsWith("{")
    ? withoutFence
    : withoutFence.match(/\{[\s\S]*\}/)?.[0];
  if (!objectText) throw new Error(`${responseName} did not contain a JSON object`);
  try {
    return JSON.parse(objectText) as T;
  } catch {
    throw new Error(`${responseName} returned invalid JSON`);
  }
}

export function parseModelContent(content: unknown): ParsedCodingTask {
  const candidate = parseLlmJson<Partial<ParsedCodingTask>>(content, "Task parser");
  const receivedInvalidTaskLabel = typeof candidate.taskType === "string" && ["invalid-request", "clarification-required", "invalid request", "clarification required"].includes(candidate.taskType.trim().toLowerCase());
  const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const taskType = normalizeTaskType(candidate.taskType);
  const parsed: ParsedCodingTask = {
    inputLanguage: typeof candidate.inputLanguage === "string" && candidate.inputLanguage.trim() ? candidate.inputLanguage.trim() : "unknown",
    taskType,
    executionMode: candidate.executionMode === "propose_code" ? "propose_code" : "plan_only",
    deliverableKind: candidate.deliverableKind === "website" || candidate.deliverableKind === "local_script" ? candidate.deliverableKind : "other",
    localScriptKind: candidate.localScriptKind === "powershell" || candidate.localScriptKind === "shell" ? candidate.localScriptKind : "none",
    deliverable: typeof candidate.deliverable === "string" && candidate.deliverable.trim() ? candidate.deliverable.trim() : "Requested coding work",
    scope: stringList(candidate.scope),
    implementationPlan: stringList(candidate.implementationPlan).length ? stringList(candidate.implementationPlan) : ["Request ko detail mein review karna", "Required source changes ka proposal banana", "Verification steps tayar karna"],
    verificationPlan: stringList(candidate.verificationPlan).length ? stringList(candidate.verificationPlan) : ["Relevant code aur changes review karna"],
    confirmationRequired: candidate.confirmationRequired === true,
    confirmationReason: typeof candidate.confirmationReason === "string" && candidate.confirmationReason.trim() ? candidate.confirmationReason.trim() : null,
    romanUrduResponse: typeof candidate.romanUrduResponse === "string" ? candidate.romanUrduResponse.trim() : "",
  };

  if (!parsed.romanUrduResponse || hasNonRomanScript(parsed.romanUrduResponse)) {
    parsed.romanUrduResponse = fallbackRomanUrduResponse(parsed.taskType);
  }
  if (receivedInvalidTaskLabel) {
    parsed.romanUrduResponse = "Aapki coding request plan ke liye receive ho gayi hai. Main isay generic coding task ke tor par review kar raha hoon; workspace files, requested deliverable aur aapki condition ke mutabiq next code proposal tayar ki ja sakti hai. Aapki approval ke baghair koi file change apply nahin hoga.";
  }

  return parsed;
}

export function createSafeTaskFallback(): ParsedCodingTask {
  return {
    inputLanguage: "unknown",
    taskType: "coding-request",
    executionMode: "plan_only",
    deliverableKind: "other",
    localScriptKind: "none",
    deliverable: "Requested coding review and next-step plan",
    scope: [],
    implementationPlan: ["Request aur imported workspace ko detail mein review karna", "Findings aur safe next steps ko review ke liye present karna", "Bina approval kisi file ko change na karna"],
    verificationPlan: ["Relevant workspace files ke against findings ko review karna"],
    confirmationRequired: false,
    confirmationReason: null,
    romanUrduResponse: "Aapki coding request receive ho gayi hai. Structured task plan ka response readable JSON mein nahin mila, is liye system safe review mode mein aage barh raha hai. Aapke instructions ke baghair koi fix ya file change apply nahin hoga.",
  };
}

export function applyPromptExecutionDefaults(prompt: string, task: ParsedCodingTask): ParsedCodingTask {
  const text = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const asksForCreation = /\b(create|build|make|generate|scaffold|implement|develop|banao|banayein|banana)\b/.test(text);
  const explicitlyAnalysisOnly = /\b(don't|do not|without changes|no changes|fix mat|change mat|na banao|nahin banao)\b/.test(text);
  if (!asksForCreation || explicitlyAnalysisOnly) return task;

  const asksForWebsite = /\b(website|web\s*app|landing\s*page|web\s*site)\b/.test(text);
  if (asksForWebsite) {
    return { ...task, executionMode: "propose_code", deliverableKind: "website", localScriptKind: "none" };
  }

  const asksForFolder = /\b(folder|directory)\b/.test(text);
  const asksForWindowsPc = /\b(pc|computer|windows|desktop)\b/.test(text);
  if (asksForFolder && asksForWindowsPc) {
    return { ...task, executionMode: "propose_code", deliverableKind: "local_script", localScriptKind: "powershell" };
  }

  const asksForUnix = /\b(linux|macos|mac|bash|unix)\b/.test(text);
  if (asksForFolder && asksForUnix) {
    return { ...task, executionMode: "propose_code", deliverableKind: "local_script", localScriptKind: "shell" };
  }

  return task;
}

export function parseTaskOrFallback(content: unknown): ParsedCodingTask {
  try {
    return parseModelContent(content);
  } catch {
    return createSafeTaskFallback();
  }
}

export async function parseCodingTask(prompt: string): Promise<ParsedCodingTask> {
  const response = await invokeLLM({
    model: "claude-sonnet-4-6",
    maxTokens: 1800,
    messages: [
      { role: "system", content: buildCodingSystemPrompt() },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: CODING_TASK_SCHEMA,
    },
  });

  return applyPromptExecutionDefaults(prompt, parseTaskOrFallback(response.choices[0]?.message.content));
}

const CODE_PROPOSAL_SCHEMA = {
  name: "code_change_proposal",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      romanUrduResponse: { type: "string" },
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            operation: { type: "string", enum: ["create", "update", "delete"] },
            content: { type: ["string", "null"] },
            rationale: { type: "string" },
          },
          required: ["path", "operation", "content", "rationale"],
        },
      },
    },
    required: ["romanUrduResponse", "changes"],
  },
} as const;

export async function proposeCodeChanges(input: {
  userPrompt: string;
  taskJson: string;
  files: Array<{ path: string; content: string; language: string }>;
  model?: string;
}): Promise<CodeProposal> {
  const workspace = input.files.length
    ? input.files.map(file => `FILE: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``).join("\n\n")
    : "The workspace is empty.";
  const response = await invokeLLM({
    model: input.model ?? "claude-sonnet-4-6",
    maxTokens: 12000,
    messages: [
      { role: "system", content: `${buildCodingSystemPrompt()}\n\nYou are now proposing exact source-code changes for a planned task. Use the existing workspace files as the source of truth. Return only changes necessary to complete the task. Use safe relative paths; never use paths containing '..', absolute paths, package manager cache paths, or secrets. For create and update return the complete resulting file content. For delete return null content. Do not use deletion merely to simplify a task. When the request is to create a website or application and the workspace is empty, create the complete initial file set, including index.html and every required local CSS or JavaScript file. When the request is a local PC folder or file operation, create a carefully commented .ps1 or shell script that the user can review and run on their own machine; never state that it was directly executed. User-facing response must be Roman Urdu with Latin characters only.` },
      { role: "user", content: `Original request:\n${input.userPrompt}\n\nTask plan JSON:\n${input.taskJson}\n\nCurrent workspace:\n${workspace}` },
    ],
    response_format: { type: "json_schema", json_schema: CODE_PROPOSAL_SCHEMA },
  });
  const content = response.choices[0]?.message.content;
  if (typeof content !== "string") throw new Error("Code proposal returned an unsupported response");
  const parsed = parseLlmJson<CodeProposal>(content, "Code proposal");
  if (!Array.isArray(parsed.changes)) throw new Error("Code proposal returned an incomplete response");
  const safeChanges = parsed.changes.filter(change => {
    const path = change.path.trim();
    return path.length > 0 && path.length <= 1024 && !path.startsWith("/") && !path.includes("..") && !path.includes("\\");
  });
  validateProposalForTask(input.taskJson, safeChanges);
  return {
    romanUrduResponse: hasNonRomanScript(parsed.romanUrduResponse)
      ? "Main ne requested code changes review ke liye tayar kar diye hain. Har file ko accept karne se pehle diff check kar lein."
      : parsed.romanUrduResponse,
    changes: safeChanges,
  };
}

export function validateProposalForTask(taskJson: string, changes: ProposedCodeChange[]): void {
  let task: Partial<ParsedCodingTask>;
  try {
    task = parseLlmJson<Partial<ParsedCodingTask>>(taskJson, "Task plan");
  } catch {
    return;
  }
  if (task.executionMode !== "propose_code") return;

  const createdOrUpdatedPaths = changes
    .filter(change => change.operation === "create" || change.operation === "update")
    .map(change => change.path.trim().toLowerCase());

  if (task.deliverableKind === "website" && !createdOrUpdatedPaths.some(path => path === "index.html" || path.endsWith("/index.html"))) {
    throw new Error("Website scaffold proposal must include a previewable index.html file");
  }
  if (task.deliverableKind === "local_script" && task.localScriptKind === "powershell" && !createdOrUpdatedPaths.some(path => path.endsWith(".ps1"))) {
    throw new Error("PC file-operation proposal must include a reviewable .ps1 PowerShell script");
  }
  if (task.deliverableKind === "local_script" && task.localScriptKind === "shell" && !createdOrUpdatedPaths.some(path => path.endsWith(".sh"))) {
    throw new Error("Local shell-operation proposal must include a reviewable .sh script");
  }
}
