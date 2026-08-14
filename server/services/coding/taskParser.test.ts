import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeLLM } from "../../_core/llm";
import { applyPromptExecutionDefaults, buildCodingSystemPrompt, createSafeTaskFallback, normalizeTaskType, parseLlmJson, parseModelContent, parseTaskOrFallback, proposeCodeChanges, validateProposalForTask } from "./taskParser";

vi.mock("../../_core/llm", () => ({ invokeLLM: vi.fn() }));

const mockedInvokeLLM = vi.mocked(invokeLLM);

describe("coding task parser contract", () => {
  afterEach(() => mockedInvokeLLM.mockReset());
  it("requires whole-prompt interpretation rather than keyword routing", () => {
    const prompt = buildCodingSystemPrompt();
    expect(prompt).toContain("ENTIRE instruction");
    expect(prompt).toContain("isolated keyword");
    expect(prompt).toContain("executionMode");
    expect(prompt).toContain("PowerShell");
  });

  it("requires Roman Urdu only for user-facing explanation", () => {
    expect(buildCodingSystemPrompt()).toContain("Roman Urdu");
    expect(buildCodingSystemPrompt()).toContain("Latin characters only");
  });

  it("parses JSON wrapped in a Markdown json fence", () => {
    const parsed = parseLlmJson<{ taskType: string }>("```json\n{\"taskType\":\"debugging\"}\n```", "Task parser");
    expect(parsed).toEqual({ taskType: "debugging" });
  });

  it("parses a fenced task response and preserves its Roman Urdu reply", () => {
    const task = parseModelContent(`\`\`\`json
{"inputLanguage":"Roman Urdu","taskType":"debugging","deliverable":"bug fix","scope":[],"implementationPlan":[],"verificationPlan":[],"confirmationRequired":false,"confirmationReason":null,"romanUrduResponse":"Main masla samajh gaya hoon."}
\`\`\``);
    expect(task.taskType).toBe("debugging");
    expect(task.romanUrduResponse).toBe("Main masla samajh gaya hoon.");
  });

  it("applies safe defaults when the model omits non-critical task fields", () => {
    const task = parseModelContent("{\"romanUrduResponse\":\"Main request samajh gaya hoon.\"}");
    expect(task.taskType).toBe("coding-request");
    expect(task.executionMode).toBe("plan_only");
    expect(task.deliverable).toBe("Requested coding work");
    expect(task.implementationPlan.length).toBeGreaterThan(0);
    expect(task.verificationPlan.length).toBeGreaterThan(0);
  });

  it("preserves a semantic request to generate a reviewed code proposal", () => {
    const task = parseModelContent("{\"taskType\":\"website creation\",\"executionMode\":\"propose_code\",\"deliverableKind\":\"website\",\"localScriptKind\":\"none\",\"romanUrduResponse\":\"Main website ke liye code proposal tayar kar raha hoon.\"}");
    expect(task.executionMode).toBe("propose_code");
    expect(task.deliverableKind).toBe("website");
  });

  it("requires a previewable index.html for a website scaffold proposal", () => {
    const task = JSON.stringify({ executionMode: "propose_code", deliverableKind: "website", localScriptKind: "none" });
    expect(() => validateProposalForTask(task, [{ path: "styles.css", operation: "create", content: "body {}", rationale: "style" }])).toThrow("index.html");
    expect(() => validateProposalForTask(task, [{ path: "index.html", operation: "create", content: "<!doctype html>", rationale: "entry" }])).not.toThrow();
  });

  it("requires a PowerShell file for a PC folder-operation proposal", () => {
    const task = JSON.stringify({ executionMode: "propose_code", deliverableKind: "local_script", localScriptKind: "powershell" });
    expect(() => validateProposalForTask(task, [{ path: "create-folder.sh", operation: "create", content: "mkdir demo", rationale: "wrong platform" }])).toThrow(".ps1");
    expect(() => validateProposalForTask(task, [{ path: "create-folder.ps1", operation: "create", content: "New-Item -ItemType Directory", rationale: "Windows command" }])).not.toThrow();
  });

  it("classifies a full PC folder creation sentence as a reviewed PowerShell coding task", () => {
    const task = applyPromptExecutionDefaults("Please create a new project folder on my Windows PC", createSafeTaskFallback());
    expect(task.executionMode).toBe("propose_code");
    expect(task.deliverableKind).toBe("local_script");
    expect(task.localScriptKind).toBe("powershell");
  });

  it("classifies a full website creation sentence as a reviewed website coding task", () => {
    const task = applyPromptExecutionDefaults("Build me a responsive portfolio website with a contact section", createSafeTaskFallback());
    expect(task.executionMode).toBe("propose_code");
    expect(task.deliverableKind).toBe("website");
  });

  it("keeps an explicitly no-change website review request in planning mode", () => {
    const task = applyPromptExecutionDefaults("Review this website and do not make changes", createSafeTaskFallback());
    expect(task.executionMode).toBe("plan_only");
  });

  it("returns a complete previewable website scaffold from a website task proposal", async () => {
    mockedInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ romanUrduResponse: "Website files review ke liye tayar hain.", changes: [
        { path: "index.html", operation: "create", content: "<!doctype html><html><head><link rel=\"stylesheet\" href=\"styles.css\"></head><body><main>Website</main><script src=\"app.js\"></script></body></html>", rationale: "Preview entry" },
        { path: "styles.css", operation: "create", content: "body { margin: 0; }", rationale: "Site styling" },
        { path: "app.js", operation: "create", content: "console.log('ready');", rationale: "Site behaviour" },
      ] }) } }],
    } as never);
    const proposal = await proposeCodeChanges({
      userPrompt: "Build a small website",
      taskJson: JSON.stringify({ executionMode: "propose_code", deliverableKind: "website", localScriptKind: "none" }),
      files: [],
    });
    expect(proposal.changes.map(change => change.path)).toEqual(["index.html", "styles.css", "app.js"]);
  });

  it("returns a reviewable PowerShell script from a PC folder task proposal", async () => {
    mockedInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ romanUrduResponse: "PowerShell script review ke liye tayar hai.", changes: [
        { path: "create-project-folder.ps1", operation: "create", content: "New-Item -ItemType Directory -Path $HOME\\Desktop\\MyProject", rationale: "Local PC folder command" },
      ] }) } }],
    } as never);
    const proposal = await proposeCodeChanges({
      userPrompt: "Create folder on my PC",
      taskJson: JSON.stringify({ executionMode: "propose_code", deliverableKind: "local_script", localScriptKind: "powershell" }),
      files: [],
    });
    expect(proposal.changes[0]?.path).toBe("create-project-folder.ps1");
    expect(proposal.changes[0]?.content).toContain("New-Item");
  });

  it("does not expose invalid-request parser labels as a task type", () => {
    expect(normalizeTaskType("invalid-request")).toBe("coding-request");
    expect(normalizeTaskType("clarification-required")).toBe("coding-request");
    const task = parseModelContent("{\"taskType\":\"invalid-request\",\"romanUrduResponse\":\"Main aapki request samajh gaya hoon.\"}");
    expect(task.taskType).toBe("coding-request");
    expect(task.implementationPlan.length).toBeGreaterThan(0);
    expect(task.romanUrduResponse).toContain("generic coding task");
    expect(task.romanUrduResponse).not.toContain("Folder button");
  });

  it("uses a safe planned task when the model returns malformed JSON", () => {
    const task = parseTaskOrFallback("```json\n{ invalid JSON }\n```");
    expect(task.taskType).toBe("coding-request");
    expect(task.romanUrduResponse).toContain("safe review mode");
    expect(task.implementationPlan).toContain("Bina approval kisi file ko change na karna");
  });
});
