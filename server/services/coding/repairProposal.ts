export function buildVerificationRepairPrompt(input: { originalPrompt: string; failures: Array<{ checkType: string; logText: string | null }> }) {
  const failures = input.failures.map(failure => `[${failure.checkType}]\n${failure.logText ?? "No log was returned."}`).join("\n\n");
  return `${input.originalPrompt}\n\nVerification runner ne neeche failures record ki hain. Sirf in failures ko address karne ke liye safe code repair proposal banayein. Kisi file ko delete na karein aur existing completed functionality ko preserve karein.\n\n${failures}`;
}
