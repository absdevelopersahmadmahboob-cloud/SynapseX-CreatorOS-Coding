export async function submitCodingCommand(input: {
  activeProjectId: number | null;
  prompt: string;
  createWorkspace: () => Promise<{ id: number }>;
  analyzeTask: (request: { projectId: number; prompt: string }) => Promise<unknown>;
}) {
  const prompt = input.prompt.trim();
  if (!prompt) return null;
  const projectId = input.activeProjectId ?? (await input.createWorkspace()).id;
  await input.analyzeTask({ projectId, prompt });
  return projectId;
}

export function getCommandSubmissionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/unexpected token|not valid json|doctype|json/i.test(message)) {
    return "Proposal service se readable response nahin mila. Koi file change ya approval request create nahin hui; kuch seconds baad Retry dabayein.";
  }
  if (/fetch failed|failed to fetch|network|network request failed/i.test(message)) {
    return "Connection temporarily available nahin hai. Aapka prompt textarea mein mehfooz hai; kuch seconds baad Retry dabayein.";
  }
  return message || "Command run nahin ho saka. Prompt ko dobara bhejne ki koshish karein.";
}
