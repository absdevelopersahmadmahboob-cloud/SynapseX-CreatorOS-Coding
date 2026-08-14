import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import JSZip from "jszip";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, Check, ChevronDown, CircleDot, Download, FileCode2, FilePlus2, GitBranch, History, Loader2, LockKeyhole, Play, Plus, RotateCcw, Save, Send, ShieldCheck, TerminalSquare, Upload } from "lucide-react";

type WorkspaceFile = { id: number; path: string; content: string; language: string };
type FileChange = { id: number; path: string; operation: "create" | "update" | "delete"; previousContent: string | null; nextContent: string | null; diffText: string; reviewStatus: "pending" | "accepted" | "rejected" };

const statusTone = {
  planned: "text-cyan-300",
  needs_approval: "text-amber-300",
  awaiting_review: "text-violet-300",
  verifying: "text-blue-300",
  passed: "text-emerald-300",
  failed: "text-red-300",
} as const;

export default function Home() {
  const { loading, isAuthenticated, logout } = useAuth();
  const utils = trpc.useUtils();
  const [projectName, setProjectName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [command, setCommand] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const archiveInput = useRef<HTMLInputElement>(null);

  const projects = trpc.coding.listProjects.useQuery(undefined, { enabled: isAuthenticated });
  const files = trpc.coding.listFiles.useQuery({ projectId: activeProjectId ?? 0 }, { enabled: isAuthenticated && !!activeProjectId });
  const runs = trpc.coding.listRuns.useQuery({ projectId: activeProjectId ?? 0 }, { enabled: isAuthenticated && !!activeProjectId });
  const changes = trpc.coding.listChanges.useQuery({ runId: activeRunId ?? 0 }, { enabled: isAuthenticated && !!activeRunId });
  const verification = trpc.coding.listVerification.useQuery({ runId: activeRunId ?? 0 }, { enabled: isAuthenticated && !!activeRunId });
  const approvals = trpc.coding.listApprovals.useQuery({ projectId: activeProjectId ?? 0 }, { enabled: isAuthenticated && !!activeProjectId });
  const snapshots = trpc.coding.listSnapshots.useQuery({ projectId: activeProjectId ?? 0 }, { enabled: isAuthenticated && !!activeProjectId });

  useEffect(() => { if (!activeProjectId && projects.data?.[0]) setActiveProjectId(projects.data[0].id); }, [activeProjectId, projects.data]);
  useEffect(() => { if (!activeRunId && runs.data?.[0]) setActiveRunId(runs.data[0].id); }, [activeRunId, runs.data]);
  useEffect(() => { if (!activeFilePath && files.data?.[0]) setActiveFilePath(files.data[0].path); }, [activeFilePath, files.data]);

  const activeProject = useMemo(() => projects.data?.find(project => project.id === activeProjectId), [projects.data, activeProjectId]);
  const activeFile = useMemo(() => files.data?.find(file => file.path === activeFilePath) as WorkspaceFile | undefined, [files.data, activeFilePath]);
  const activeRun = useMemo(() => runs.data?.find(run => run.id === activeRunId) ?? runs.data?.[0], [runs.data, activeRunId]);
  const activeChange = useMemo(() => changes.data?.find(change => change.reviewStatus === "pending") as FileChange | undefined, [changes.data]);
  useEffect(() => setDraft(activeFile?.content ?? ""), [activeFile?.path, activeFile?.content]);

  const createProject = trpc.coding.createProject.useMutation({ onSuccess: async result => { await utils.coding.listProjects.invalidate(); setActiveProjectId(result.id); setProjectName(""); toast.success("Workspace created"); }, onError: error => toast.error(error.message) });
  const saveFile = trpc.coding.saveFile.useMutation({ onSuccess: async result => { await utils.coding.listFiles.invalidate(); setActiveFilePath(result.path); toast.success("File saved"); }, onError: error => toast.error(error.message) });
  const analyze = trpc.coding.analyzeTask.useMutation({ onSuccess: async result => { await Promise.all([utils.coding.listRuns.invalidate(), utils.coding.listApprovals.invalidate()]); setActiveRunId(result.run.id); setCommand(""); }, onError: error => toast.error(error.message) });
  const generate = trpc.coding.generateChanges.useMutation({ onSuccess: async () => { await Promise.all([utils.coding.listRuns.invalidate(), utils.coding.listChanges.invalidate()]); toast.success("Code proposal ready"); }, onError: error => toast.error(error.message) });
  const accept = trpc.coding.acceptChanges.useMutation({ onSuccess: async () => { await Promise.all([utils.coding.listFiles.invalidate(), utils.coding.listRuns.invalidate(), utils.coding.listChanges.invalidate(), utils.coding.listVerification.invalidate(), utils.coding.listSnapshots.invalidate()]); toast.success("Changes accepted"); }, onError: error => toast.error(error.message) });
  const reject = trpc.coding.rejectChanges.useMutation({ onSuccess: async () => { await Promise.all([utils.coding.listRuns.invalidate(), utils.coding.listChanges.invalidate()]); toast.success("Changes rejected"); }, onError: error => toast.error(error.message) });
  const resolveApproval = trpc.coding.resolveApproval.useMutation({ onSuccess: async () => { await Promise.all([utils.coding.listApprovals.invalidate(), utils.coding.listRuns.invalidate()]); toast.success("Approval decision saved"); }, onError: error => toast.error(error.message) });
  const restore = trpc.coding.restoreSnapshot.useMutation({ onSuccess: async () => { await utils.coding.listFiles.invalidate(); toast.success("Snapshot restored"); }, onError: error => toast.error(error.message) });

  const createFile = () => {
    if (!activeProjectId || !filePath.trim()) return;
    saveFile.mutate({ projectId: activeProjectId, path: filePath.trim(), content: "", language: inferLanguage(filePath.trim()) });
    setFilePath("");
  };
  const runCommand = () => {
    if (!activeProjectId) return toast.error("Create a workspace first");
    if (command.trim()) analyze.mutate({ projectId: activeProjectId, prompt: command.trim() });
  };
  const importZip = async (archive?: File) => {
    if (!archive || !activeProjectId) return;
    setImporting(true);
    try {
      const zip = await JSZip.loadAsync(archive);
      const entries = Object.values(zip.files).filter(entry => !entry.dir);
      for (const entry of entries) await saveFile.mutateAsync({ projectId: activeProjectId, path: entry.name, content: await entry.async("string"), language: inferLanguage(entry.name) });
      await utils.coding.listFiles.invalidate();
      toast.success(`${entries.length} files imported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ZIP import failed");
    } finally {
      setImporting(false);
      if (archiveInput.current) archiveInput.current.value = "";
    }
  };
  const exportZip = async () => {
    if (!activeProject || !files.data?.length) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      files.data.forEach(file => zip.file(file.path, file.content));
      const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugify(activeProject.name) || "synapsex-project"}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  if (loading) return <div className="min-h-screen bg-background" />;
  if (!isAuthenticated) return <LoginScreen />;

  return (
    <main className="min-h-screen bg-[#090d17] font-mono text-slate-200 selection:bg-emerald-400/30">
      <header className="flex min-h-14 items-center justify-between border-b border-emerald-300/20 bg-[#0b1020] px-4 sm:px-6">
        <div className="flex items-center gap-3"><div className="flex size-8 items-center justify-center border border-emerald-300/40 bg-emerald-300/10 text-emerald-300"><Braces className="size-4" /></div><div><h1 className="font-sans text-sm font-extrabold tracking-tight text-white">SynapseX CreatorOS Coding</h1><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">PowerShell Command Center</p></div></div>
        <div className="flex items-center gap-2"><input ref={archiveInput} className="hidden" type="file" accept=".zip,application/zip" onChange={event => importZip(event.target.files?.[0])} /><TerminalButton onClick={() => archiveInput.current?.click()} disabled={!activeProjectId || importing}><Upload className="size-3.5" />Import</TerminalButton><TerminalButton onClick={exportZip} disabled={!files.data?.length || exporting}><Download className="size-3.5" />Export</TerminalButton><TerminalButton onClick={logout}>Sign out</TerminalButton></div>
      </header>

      <section className="mx-auto max-w-[1600px] p-3 sm:p-5">
        <div className="border border-slate-700/80 bg-[#0d1324] shadow-[0_24px_90px_rgba(0,0,0,.35)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/80 bg-[#0a0f1d] px-3 py-2 text-[11px] text-slate-400"><TerminalSquare className="size-3.5 text-emerald-300" /><span>PS C:\SynapseX\CreatorOS\Coding</span><span className="hidden text-slate-600 sm:inline">|</span><span className="text-emerald-300">status: ready</span><span className="ml-auto hidden text-slate-500 sm:inline">input: multilingual / output: Roman Urdu</span></div>
          <div className="grid min-h-[57vh] grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_290px]">
            <aside className="border-b border-slate-700/80 p-3 xl:border-b-0 xl:border-r">
              <TerminalLabel>Workspace</TerminalLabel>
              <div className="mt-2 flex gap-2"><select value={activeProjectId ?? ""} onChange={event => { setActiveProjectId(Number(event.target.value)); setActiveRunId(null); setActiveFilePath(null); }} className="h-9 min-w-0 flex-1 border border-slate-700 bg-[#090d17] px-2 text-xs text-slate-200 outline-none focus:border-emerald-300"><option value="" disabled>Select workspace</option>{projects.data?.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><Button size="icon" variant="outline" className="size-9 rounded-none border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800" onClick={() => document.getElementById("project-name")?.focus()}><Plus className="size-4" /></Button></div>
              <div className="mt-2 flex gap-2"><Input id="project-name" value={projectName} onChange={event => setProjectName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && projectName.trim()) createProject.mutate({ name: projectName.trim() }); }} placeholder="new-workspace" className="h-8 rounded-none border-slate-700 bg-[#090d17] text-[11px]" /><TerminalButton disabled={!projectName.trim() || createProject.isPending} onClick={() => createProject.mutate({ name: projectName.trim() })}>Create</TerminalButton></div>
              <TerminalLabel className="mt-5">Files</TerminalLabel>
              <div className="mt-2 flex gap-2"><Input value={filePath} onChange={event => setFilePath(event.target.value)} onKeyDown={event => { if (event.key === "Enter") createFile(); }} placeholder="src/app.ts" disabled={!activeProjectId} className="h-8 rounded-none border-slate-700 bg-[#090d17] text-[11px]" /><Button size="icon" variant="outline" disabled={!activeProjectId || !filePath.trim()} onClick={createFile} className="size-8 rounded-none border-slate-700 bg-transparent"><FilePlus2 className="size-3.5" /></Button></div>
              <div className="mt-2 max-h-60 overflow-auto pr-1 xl:max-h-[calc(57vh-12rem)]">{files.data?.length ? files.data.map(file => <button key={file.id} onClick={() => setActiveFilePath(file.path)} className={cn("flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]", activeFilePath === file.path ? "bg-emerald-300/10 text-emerald-300" : "text-slate-400 hover:bg-slate-800 hover:text-white")}><FileCode2 className="size-3.5 shrink-0" /><span className="truncate">{file.path}</span></button>) : <p className="py-4 text-[11px] leading-5 text-slate-600">No files loaded.<br />Import a ZIP or create one.</p>}</div>
            </aside>

            <section className="flex min-h-[380px] flex-col border-b border-slate-700/80 xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between border-b border-slate-700/80 px-3 py-2"><div className="flex min-w-0 items-center gap-2 text-[11px]"><FileCode2 className="size-3.5 text-slate-500" /><span className="truncate text-slate-300">{activeFile?.path ?? "No file selected"}</span><span className="text-slate-600">{activeFile?.language ? `(${activeFile.language})` : ""}</span></div><TerminalButton disabled={!activeFile || saveFile.isPending || draft === activeFile.content} onClick={() => activeProjectId && activeFile && saveFile.mutate({ projectId: activeProjectId, path: activeFile.path, content: draft, language: activeFile.language })}><Save className="size-3.5" />Save</TerminalButton></div>
              {activeFile ? <Textarea value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} className="min-h-[310px] flex-1 resize-none rounded-none border-0 bg-[#0b1020] px-4 py-3 font-mono text-[12px] leading-6 text-slate-200 shadow-none focus-visible:ring-0" /> : <TerminalPlaceholder label="Workspace file editor" text="Select a source file. All manual edits stay inside the active workspace and are saved to its isolated storage." />}
              {activeChange ? <div className="border-t border-slate-700/80 bg-[#080c16] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-violet-300">proposed {activeChange.operation}: {activeChange.path}</span><div className="flex gap-2"><TerminalButton disabled={reject.isPending} onClick={() => activeRun && reject.mutate({ runId: activeRun.id })}>Reject</TerminalButton><TerminalButton accent disabled={accept.isPending} onClick={() => activeRun && accept.mutate({ runId: activeRun.id })}><Check className="size-3.5" />Accept changes</TerminalButton></div></div><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-slate-400">{activeChange.diffText}</pre></div> : null}
            </section>

            <aside className="p-3">
              <TerminalLabel>Activity</TerminalLabel>
              <div className="mt-2 space-y-2 border-l border-slate-700 pl-3">{runs.data?.length ? runs.data.slice(0, 6).map(run => <button key={run.id} onClick={() => setActiveRunId(run.id)} className={cn("block w-full text-left text-[11px]", activeRun?.id === run.id ? "text-white" : "text-slate-500 hover:text-slate-300")}><span className={cn("mr-2", statusTone[run.status])}>●</span><span className="font-semibold">{run.taskType}</span><span className="ml-2 text-slate-600">#{run.id}</span><p className="mt-1 line-clamp-2 pl-3 text-[10px] leading-4 text-slate-500">{run.deliverable}</p></button>) : <p className="text-[11px] leading-5 text-slate-600">Commands and coding runs will appear here.</p>}</div>
              <TerminalLabel className="mt-6">Verification</TerminalLabel>
              <div className="mt-2 space-y-1 text-[10px]">{verification.data?.length ? verification.data.map(item => <div key={item.id} className="flex items-center justify-between border-b border-slate-800 py-1.5"><span className="text-slate-400">{item.checkType}</span><span className={cn("uppercase", item.status === "passed" ? "text-emerald-300" : item.status === "failed" ? "text-red-300" : "text-amber-300")}>{item.status}</span></div>) : <p className="leading-5 text-slate-600">Accepted changes queue checks for the isolated verification runner.</p>}</div>
              <TerminalLabel className="mt-6">Approval queue</TerminalLabel>
              <div className="mt-2 space-y-2">{approvals.data?.length ? approvals.data.map(({ approval }) => <div key={approval.id} className="border border-amber-300/20 bg-amber-300/5 p-2 text-[10px]"><p className="font-semibold text-amber-300">{approval.actionType.replaceAll("_", " ")}</p><p className="mt-1 leading-4 text-slate-500">{approval.description}</p><div className="mt-2 flex gap-2"><TerminalButton onClick={() => resolveApproval.mutate({ approvalId: approval.id, approved: false })}>Reject</TerminalButton><TerminalButton accent onClick={() => resolveApproval.mutate({ approvalId: approval.id, approved: true })}>Approve</TerminalButton></div></div>) : <p className="text-[10px] leading-5 text-slate-600">No permanent action is waiting for approval.</p>}</div>
              {snapshots.data?.[0] ? <TerminalButton className="mt-5" disabled={restore.isPending} onClick={() => activeProjectId && restore.mutate({ projectId: activeProjectId, snapshotId: snapshots.data![0].id })}><RotateCcw className="size-3.5" />Restore latest snapshot</TerminalButton> : null}
            </aside>
          </div>

          <section className="border-t border-emerald-300/20 bg-[#080c16] p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-bold text-emerald-300"><Play className="size-3.5" />Command Center</p><p className="mt-1 text-[10px] text-slate-500">Describe the complete coding task in any language. SynapseX reads the full request before it plans changes.</p></div><span className="hidden text-[10px] text-slate-600 sm:block">Ctrl / Cmd + Enter to run</span></div>
            {activeRun ? <div className="mb-3 border border-slate-700/80 bg-[#0d1324] p-3 text-[11px]"><div className="flex flex-wrap items-center gap-2"><span className={cn("font-semibold", statusTone[activeRun.status])}>[{activeRun.status.replaceAll("_", " ")}]</span><span className="text-slate-500">input: {activeRun.inputLanguage}</span></div><p className="mt-2 whitespace-pre-wrap leading-5 text-slate-200">{activeRun.assistantResponse}</p><div className="mt-3 flex flex-wrap gap-2">{activeRun.status === "planned" ? <TerminalButton accent disabled={generate.isPending} onClick={() => generate.mutate({ runId: activeRun.id })}>{generate.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Braces className="size-3.5" />}Generate code proposal</TerminalButton> : null}{activeRun.status === "needs_approval" ? <span className="text-amber-300">Approval required before code generation.</span> : null}</div></div> : null}
            <div className="flex items-stretch border border-emerald-300/30 bg-[#0d1324] focus-within:border-emerald-300"><div className="flex w-12 shrink-0 items-start justify-center pt-4 text-emerald-300">PS&gt;</div><Textarea value={command} onChange={event => setCommand(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); runCommand(); } }} placeholder="Assign any coding task…" className="min-h-24 flex-1 resize-y rounded-none border-0 bg-transparent px-0 py-3 font-mono text-xs leading-6 text-slate-100 shadow-none focus-visible:ring-0" /><Button onClick={runCommand} disabled={!activeProjectId || !command.trim() || analyze.isPending} className="m-2 h-auto rounded-none bg-emerald-300 px-4 text-[#07100e] hover:bg-emerald-200">{analyze.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</Button></div>
          </section>
        </div>
      </section>
    </main>
  );
}

function LoginScreen() {
  return <main className="flex min-h-screen items-center justify-center bg-[#090d17] p-5 font-mono text-slate-200"><section className="w-full max-w-2xl border border-emerald-300/25 bg-[#0d1324] p-6 sm:p-9"><p className="text-[11px] text-emerald-300">PS C:\SynapseX\CreatorOS\Coding&gt; connect</p><h1 className="mt-5 font-sans text-3xl font-extrabold tracking-tight text-white">SynapseX CreatorOS Coding</h1><p className="mt-3 max-w-xl text-sm leading-7 text-slate-400">A focused Command Center for assigning coding work, reviewing generated changes, and keeping permanent actions under your control.</p><Button onClick={() => startLogin()} className="mt-8 rounded-none bg-emerald-300 px-5 font-bold text-[#07100e] hover:bg-emerald-200">Open Command Center</Button></section></main>;
}

function TerminalButton({ children, className, accent, ...props }: React.ComponentProps<typeof Button> & { accent?: boolean }) {
  return <Button variant="outline" size="sm" className={cn("h-8 rounded-none border-slate-700 bg-transparent px-2 text-[10px] text-slate-300 hover:bg-slate-800 hover:text-white", accent && "border-emerald-300/40 bg-emerald-300/10 text-emerald-300 hover:bg-emerald-300/20", className)} {...props}>{children}</Button>;
}

function TerminalLabel({ children, className }: { children: React.ReactNode; className?: string }) { return <p className={cn("text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500", className)}>{children}</p>; }
function TerminalPlaceholder({ label, text }: { label: string; text: string }) { return <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><FileCode2 className="size-6 text-slate-600" /><p className="mt-3 text-xs text-slate-300">{label}</p><p className="mt-2 max-w-sm text-[11px] leading-5 text-slate-600">{text}</p></div>; }
function inferLanguage(path: string) { const ext = path.split(".").pop()?.toLowerCase(); return ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", json: "json", css: "css", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", sh: "shell" } as Record<string, string>)[ext ?? ""] ?? "text"; }
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
