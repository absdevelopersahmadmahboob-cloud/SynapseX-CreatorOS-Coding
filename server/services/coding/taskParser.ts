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

function parseModelContent(content: unknown): ParsedCodingTask {
  if (typeof content !== "string") {
    throw new Error("Task parser returned an unsupported response");
  }

  const parsed = JSON.parse(content) as ParsedCodingTask;
  if (!parsed.taskType || !parsed.deliverable || !Array.isArray(parsed.implementationPlan)) {
    throw new Error("Task parser returned an incomplete response");
  }

  if (!parsed.romanUrduResponse || hasNonRomanScript(parsed.romanUrduResponse)) {
    parsed.romanUrduResponse = fallbackRomanUrduResponse(parsed.taskType);
  }

  return parsed;
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

  return parseModelContent(response.choices[0]?.message.content);
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
}): Promise<CodeProposal> {
  const workspace = input.files.length
    ? input.files.map(file => `FILE: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``).join("\n\n")
    : "The workspace is empty.";
  const response = await invokeLLM({
    model: "claude-sonnet-4-6",
    maxTokens: 12000,
    messages: [
      { role: "system", content: `${buildCodingSystemPrompt()}\n\nYou are now proposing exact source-code changes for a planned task. Use the existing workspace files as the source of truth. Return only changes necessary to complete the task. Use safe relative paths; never use paths containing '..', absolute paths, package manager cache paths, or secrets. For create and update return the complete resulting file content. For delete return null content. Do not use deletion merely to simplify a task. User-facing response must be Roman Urdu with Latin characters only.` },
      { role: "user", content: `Original request:\n${input.userPrompt}\n\nTask plan JSON:\n${input.taskJson}\n\nCurrent workspace:\n${workspace}` },
    ],
    response_format: { type: "json_schema", json_schema: CODE_PROPOSAL_SCHEMA },
  });
  const content = response.choices[0]?.message.content;
  if (typeof content !== "string") throw new Error("Code proposal returned an unsupported response");
  const parsed = JSON.parse(content) as CodeProposal;
  if (!Array.isArray(parsed.changes)) throw new Error("Code proposal returned an incomplete response");
  const safeChanges = parsed.changes.filter(change => {
    const path = change.path.trim();
    return path.length > 0 && path.length <= 1024 && !path.startsWith("/") && !path.includes("..") && !path.includes("\\");
  });
  return {
    romanUrduResponse: hasNonRomanScript(parsed.romanUrduResponse)
      ? "Main ne requested code changes review ke liye tayar kar diye hain. Har file ko accept karne se pehle diff check kar lein."
      : parsed.romanUrduResponse,
    changes: safeChanges,
  };
}
