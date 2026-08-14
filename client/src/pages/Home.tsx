import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Bot, Braces, CheckCircle2, ChevronRight, CircleDot, Code2, Download, FileCode2, Files, GitBranch, History, Loader2, LockKeyhole, PencilLine, Play, Plus, RotateCcw, Save, Send, ShieldCheck, TerminalSquare, Trash2, Upload, X } from "lucide-react";

type WorkspaceFile = { id: number; path: string; content: string; language: string };
type FileChange = { id: number; path: string; operation: "create" | "update" | "delete"; previousContent: string | null; nextContent: string | null; diffText: string; reviewStatus: "pending" | "accepted" | "rejected" };

const statusMeta = {
  planned: { label: "Planned", className: "text-cyan-300 bg-cyan-300/10 border-cyan-300/20" },
  needs_approval: { label: "Approval needed", className: "text-amber-300 bg-amber-300/10 border-amber-300/20" },
  awaiting_review: { label: "Review", className: "text-violet-300 bg-violet-300/10 border-violet-300/20" },
  verifying: { label: "Verifying", className: "text-blue-300 bg-blue-300/10 border-blue-300/20" },
  passed: { label: "Passed", className: "text-emerald-300 bg-emerald-300/10 border-emerald-300/20" },
  failed: { label: "Failed", className: "text-red-300 bg-red-300/10 border-red-300/20" },
} as const;

export default function Home() {
  const { loading, isAuthenticated, logout } = useAuth();
  const utils = trpc.useUtils();
  const [newProjectName, setNewProjectName] = useState("");
  const [newFilePath, setNewFilePath] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeChangeId, setActiveChangeId] = useState<number | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projects = trpc.coding.listProjects.useQuery(undefined, { enabled: isAuthenticated });
  const files = trpc.coding.listFiles.useQuery({ projectId: activeProjectId ?? 0 }, { enabled: isAuthenticated && !!activeProjectId });
  const runs = trpc.coding.listRuns.useQuery({ projectId: activeProjectId ?? 0 }, { enabled: isAuthenticated && !!activeProjectId });
  const approvals = trpc.coding.listApprovals.useQuery({ projectId: activeProjectId ?? 0 }, { enabled: isAuthenticated && !!activeProjectId });
  const snapshots = trpc.coding.listSnapshots.useQuery({ projectId: activeProjectId ?? 0 }, { enabled: isAuthenticated && !!activeProjectId });
  const changes = trpc.coding.listChanges.useQuery({ runId: activeRunId ?? 0 }, { enabled: isAuthenticated && !!activeRunId });
  const verification = trpc.coding.listVerification.useQuery({ runId: activeRunId ?? 0 }, { enabled: isAuthenticated && !!activeRunId });

  useEffect(() => { if (!activeProjectId && projects.data?.[0]) setActiveProjectId(projects.data[0].id); }, [activeProjectId, projects.data]);
  useEffect(() => { if (!activeRunId && runs.data?.[0]) setActiveRunId(runs.data[0].id); }, [activeRunId, runs.data]);
  useEffect(() => { if (!activeFilePath && files.data?.[0]) setActiveFilePath(files.data[0].path); }, [activeFilePath, files.data]);

  const activeRun = useMemo(() => runs.data?.find(run => run.id === activeRunId) ?? runs.data?.[0], [activeRunId, runs.data]);
  const activeProject = useMemo(() => projects.data?.find(project => project.id === activeProjectId), [activeProjectId, projects.data]);
  const activeFile = useMemo(() => files.data?.find(file => file.path === activeFilePath) as WorkspaceFile | undefined, [activeFilePath, files.data]);
  const activeChange = useMemo(() => changes.data?.find(change => change.id === activeChangeId) as FileChange | undefined ?? changes.data?.[0] as FileChange | undefined, [activeChangeId, changes.data]);

  useEffect(() => { setDraftContent(activeFile?.content ?? ""); }, [activeFile?.content, activeFile?.path]);

  const createProject = trpc.coding.createProject.useMutation({ onSuccess: async project => { await utils.coding.listProjects.invalidate(); setActiveProjectId(project.id); setActiveRunId(null); setActiveFilePath(null); setNewProjectName(""); toast.success("Workspace created"); }, onError: error => toast.error(error.message) });
  const saveFile = trpc.coding.saveFile.useMutation({ onSuccess: async file => { await utils.coding.listFiles.invalidate(); setActiveFilePath(file.path); setNewFilePath(""); toast.success("File saved"); }, onError: error => toast.error(error.message) });
  const deleteFile = trpc.coding.deleteFile.useMutation({ onSuccess: async () => { await utils.coding.listFiles.invalidate(); setActiveFilePath(null); setDeleteCandidate(null); toast.success("File deleted"); }, onError: error => toast.error(error.message) });
  const analyzeTask = trpc.coding.analyzeTask.useMutation({ onSuccess: async result => { await Promise.all([utils.coding.listRuns.invalidate(), utils.coding.listApprovals.invalidate()]); setActiveRunId(result.run.id); setPrompt(""); }, onError: error => toast.error(error.message) });
  const generateChanges = trpc.coding.generateChanges.useMutation({ onSuccess: async () => { await Promise.all([utils.coding.listRuns.invalidate(), utils.coding.listChanges.invalidate()]); toast.success("Code proposal is ready for review"); }, onError: error => toast.error(error.message) });
  const acceptChanges = trpc.coding.acceptChanges.useMutation({ onSuccess: async () => { await Promise.all([utils.coding.listFiles.invalidate(), utils.coding.listRuns.invalidate(), utils.coding.listChanges.invalidate(), utils.coding.listSnapshots.invalidate(), utils.coding.listVerification.invalidate()]); toast.success("Reviewed changes accepted"); }, onError: error => toast.error(error.message) });
  const rejectChanges = trpc.coding.rejectChanges.useMutation({ onSuccess: async () => { await Promise.all([utils.coding.listRuns.invalidate(), utils.coding.listChanges.invalidate()]); toast.success("Proposed changes rejected"); }, onError: error => toast.error(error.message) });
  const resolveApproval = trpc.coding.resolveApproval.useMutation({ onSuccess: async () => { await Promise.all([utils.coding.listApprovals.invalidate(), utils.coding.listRuns.invalidate()]); toast.success("Approval decision recorded"); }, onError: error => toast.error(error.message) });
  const requestLivePushApproval = trpc.coding.requestLivePushApproval.useMutation({ onSuccess: async () => { await utils.coding.listApprovals.invalidate(); toast.success("Live push approval request created"); }, onError: error => toast.error(error.message) });
  const restoreSnapshot = trpc.coding.restoreSnapshot.useMutation({ onSuccess: async () => { await utils.coding.listFiles.invalidate(); toast.success("Workspace restored from snapshot"); }, onError: error => toast.error(error.message) });

  const createFile = () => {
    if (!activeProjectId || !newFilePath.trim()) return;
    saveFile.mutate({ projectId: activeProjectId, path: newFilePath.trim(), content: "", language: inferLanguage(newFilePath.trim()) });
  };
  const onSend = () => { if (!activeProjectId) return toast.error("Create or select a workspace first"); if (prompt.trim()) analyzeTask.mutate({ projectId: activeProjectId, prompt: prompt.trim() }); };
  const importZip = async (archive?: File) => {
    if (!archive || !activeProjectId) return;
    setImporting(true);
    try {
      const zip = await JSZip.loadAsync(archive);
      const entries = Object.values(zip.files).filter(entry => !entry.dir);
      let imported = 0;
      for (const entry of entries) {
        const content = await entry.async("string");
        await saveFile.mutateAsync({ projectId: activeProjectId, path: entry.name, content, language: inferLanguage(entry.name) });
        imported += 1;
      }
      await utils.coding.listFiles.invalidate();
      toast.success(`${imported} files imported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ZIP import failed");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  const exportZip = async () => {
    if (!activeProjectId || !files.data || !activeProject) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      files.data.forEach(file => zip.file(file.path, file.content));
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugify(activeProject.name) || "codeforge-project"}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };
  const scaffoldGitHubFiles = async () => {
    if (!activeProjectId || !activeProject) return;
    const existing = new Set((files.data ?? []).map(file => file.path));
    const generated = [
      { path: "README.md", content: `# ${activeProject.name}\n\nThis project is managed in CodeForge Workspace.\n\n## Setup\n\n1. Install the runtime and dependencies required by this project.\n2. Copy any documented environment values into your local environment.\n3. Run the project-specific development command.\n\n## Development workflow\n\nUse CodeForge to plan changes, review each diff, accept approved changes, and record verification results.\n`, language: "markdown" },
      { path: ".gitignore", content: `node_modules/\ndist/\nbuild/\n.env\n.env.*\n!.env.example\ncoverage/\n.DS_Store\n`, language: "text" },
      { path: ".env.example", content: `# Add only variable names and safe example values. Never commit real secrets.\n`, language: "text" },
    ].filter(file => !existing.has(file.path));
    if (!generated.length) return toast.message("GitHub documentation files already exist");
    try {
      for (const file of generated) await saveFile.mutateAsync({ projectId: activeProjectId, ...file });
      await utils.coding.listFiles.invalidate();
      toast.success("GitHub-ready files added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Repository files could not be added");
    }
  };

  if (loading) return <div className="min-h-screen bg-background" />;
  if (!isAuthenticated) return <LoginScreen />;

  return (
    <main className="ambient-grid min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/85 px-4 backdrop-blur-xl sm:px-6">
        <div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Braces className="size-5" /></div><div><h1 className="text-sm font-extrabold tracking-tight">CodeForge</h1><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Universal coding workspace</p></div></div>
        <div className="flex items-center gap-2 sm:gap-3"><input ref={fileInputRef} className="hidden" type="file" accept=".zip,application/zip" onChange={event => importZip(event.target.files?.[0])} /><Button variant="outline" size="sm" className="hidden sm:inline-flex" disabled={!activeProjectId || importing} onClick={() => fileInputRef.current?.click()}>{importing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Upload className="mr-1.5 size-3.5" />}Import ZIP</Button><Button variant="outline" size="sm" className="hidden sm:inline-flex" disabled={!activeProjectId || !files.data?.length || exporting} onClick={exportZip}>{exporting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Download className="mr-1.5 size-3.5" />}Export</Button><div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><span className="size-2 rounded-full bg-emerald-400" />Private workspace</div><Button variant="outline" size="sm" onClick={logout}>Sign out</Button></div>
      </header>

      <div className="mx-auto grid max-w-[1720px] grid-cols-1 gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:p-5">
        <aside className="panel-glow rounded-2xl border bg-card/80 p-3 lg:min-h-[calc(100vh-6.75rem)]">
          <div className="flex items-center justify-between px-2 pb-3"><span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Workspaces</span><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" onClick={() => document.getElementById("new-workspace")?.focus()}><Plus className="size-4" /></Button></TooltipTrigger><TooltipContent>Create workspace</TooltipContent></Tooltip></div>
          <div className="mb-3 flex gap-2"><Input id="new-workspace" value={newProjectName} onChange={event => setNewProjectName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") createProject.mutate({ name: newProjectName }); }} placeholder="New workspace" className="h-9 text-xs" /><Button size="icon" className="size-9 shrink-0" disabled={!newProjectName.trim() || createProject.isPending} onClick={() => createProject.mutate({ name: newProjectName.trim() })}>{createProject.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}</Button></div>
          <ScrollArea className="h-32"><nav className="space-y-1">{projects.data?.length ? projects.data.map(project => <button key={project.id} onClick={() => { setActiveProjectId(project.id); setActiveRunId(null); setActiveFilePath(null); }} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors", activeProjectId === project.id ? "bg-primary/14 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}><Files className="size-4 shrink-0" /><span className="truncate font-semibold">{project.name}</span></button>) : <EmptySmall text="Create your first workspace to begin." />}</nav></ScrollArea>
          <div className="mt-3 border-t pt-3"><div className="flex items-center justify-between px-2"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Files</p><Button variant="ghost" size="icon" className="size-7" disabled={!activeProjectId} onClick={() => document.getElementById("new-file")?.focus()}><Plus className="size-3.5" /></Button></div><div className="mt-2 flex gap-2"><Input id="new-file" value={newFilePath} onChange={event => setNewFilePath(event.target.value)} onKeyDown={event => { if (event.key === "Enter") createFile(); }} disabled={!activeProjectId} placeholder="src/app.ts" className="h-8 text-[11px]" /><Button size="icon" variant="outline" className="size-8 shrink-0" disabled={!activeProjectId || !newFilePath.trim() || saveFile.isPending} onClick={createFile}><Plus className="size-3.5" /></Button></div><div className="mt-2 grid grid-cols-2 gap-2"><Button variant="outline" size="sm" className="h-8 text-[10px]" disabled={!activeProjectId || importing} onClick={() => fileInputRef.current?.click()}><Upload className="mr-1 size-3" />Import</Button><Button variant="outline" size="sm" className="h-8 text-[10px]" disabled={!activeProjectId || !files.data?.length || exporting} onClick={exportZip}><Download className="mr-1 size-3" />Export</Button></div><Button variant="ghost" className="mt-1 h-8 w-full justify-start px-2 text-[10px] text-primary" disabled={!activeProjectId || saveFile.isPending} onClick={scaffoldGitHubFiles}><GitBranch className="mr-1.5 size-3" />Add GitHub setup files</Button><ScrollArea className="mt-2 h-44"><div className="space-y-1">{files.data?.length ? files.data.map(file => <button key={file.id} onClick={() => setActiveFilePath(file.path)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs", activeFilePath === file.path ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}><FileCode2 className="size-3.5 shrink-0" /><span className="truncate">{file.path}</span></button>) : <EmptySmall text="No files yet." />}</div></ScrollArea></div>
        </aside>

        <section className="space-y-4">
          <section className="panel-glow rounded-2xl border bg-card/85 p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Task control</p><h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Assign a complete coding task.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Write in any language. CodeForge reads the whole instruction, identifies the requested deliverable, and returns its plan in Roman Urdu before code is proposed.</p></div><div className="flex items-center gap-2 rounded-xl border bg-secondary/45 px-3 py-2 text-xs text-muted-foreground"><Bot className="size-4 text-primary" />Input language: Auto-detect</div></div><div className="mt-6 rounded-2xl border bg-background/45 p-2"><Textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSend(); } }} placeholder="Describe the coding task, expected result, and constraints…" className="min-h-32 resize-y border-0 bg-transparent text-sm leading-7 shadow-none focus-visible:ring-0" /><div className="flex flex-wrap items-center justify-between gap-3 border-t px-2 pt-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Destructive or live actions require approval.</div><Button onClick={onSend} disabled={!activeProjectId || !prompt.trim() || analyzeTask.isPending} className="h-10 px-4 font-bold">{analyzeTask.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}Analyze task</Button></div></div></section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(330px,.9fr)]">
            <section className="panel-glow overflow-hidden rounded-2xl border bg-card/80"><PanelTitle icon={TerminalSquare} title="Assistant plan" subtitle="Roman Urdu response" /><div className="min-h-80 p-5">{analyzeTask.isPending ? <LoadingPanel label="Understanding full task context…" /> : activeRun ? <RunPlan run={activeRun} onGenerate={() => generateChanges.mutate({ runId: activeRun.id })} generatePending={generateChanges.isPending} /> : <EmptyPanel icon={Bot} label="No task analyzed yet" description="Your Roman Urdu plan will appear here after you submit a real coding task." />}</div></section>
            <section className="panel-glow overflow-hidden rounded-2xl border bg-card/80"><PanelTitle icon={Code2} title="Source editor" subtitle={activeFile?.path ?? "Select a file"} /><div className="min-h-80 p-4">{activeFile ? <><Textarea value={draftContent} onChange={event => setDraftContent(event.target.value)} className="min-h-56 resize-y rounded-xl bg-background/60 text-xs leading-6" spellCheck={false} /><div className="mt-3 flex flex-wrap justify-between gap-2"><Button variant="outline" size="sm" onClick={() => setDeleteCandidate(activeFile.path)}><Trash2 className="mr-1.5 size-3.5" />Delete</Button><Button size="sm" disabled={saveFile.isPending || draftContent === activeFile.content} onClick={() => saveFile.mutate({ projectId: activeProjectId!, path: activeFile.path, content: draftContent, language: activeFile.language })}><Save className="mr-1.5 size-3.5" />Save file</Button></div></> : <EmptyPanel icon={PencilLine} label="No file selected" description="Create a file or choose one from the file tree. All saved files remain in this workspace." />}</div></section>
          </div>

          <section className="panel-glow overflow-hidden rounded-2xl border bg-card/80"><PanelTitle icon={GitBranch} title="Change review" subtitle="Review line-level changes before acceptance" /><div className="min-h-72 p-4">{changes.isLoading ? <LoadingPanel label="Loading code changes…" /> : changes.data?.length ? <DiffReview changes={changes.data as FileChange[]} activeChange={activeChange} onSelect={setActiveChangeId} canAccept={activeRun?.status === "awaiting_review"} accepting={acceptChanges.isPending} rejecting={rejectChanges.isPending} onAccept={() => activeRun && acceptChanges.mutate({ runId: activeRun.id })} onReject={() => activeRun && rejectChanges.mutate({ runId: activeRun.id })} /> : <EmptyPanel icon={GitBranch} label="No proposed file changes" description="After the assistant plan is ready, generate a code proposal to see exact creates, updates, or deletions here." />}</div></section>

          <section className="panel-glow overflow-hidden rounded-2xl border bg-card/80"><PanelTitle icon={CheckCircle2} title="Verification" subtitle="Isolated runner status and full logs" /><div className="p-4">{verification.isLoading ? <LoadingPanel label="Loading verification records…" /> : <VerificationPanel checks={verification.data ?? []} />}</div></section>
        </section>

        <aside className="space-y-4"><section className="panel-glow overflow-hidden rounded-2xl border bg-card/80"><PanelTitle icon={LockKeyhole} title="Approval gate" subtitle="Permanent actions" /><div className="p-4">{approvals.data?.length ? <div className="space-y-3">{approvals.data.map(({ approval }) => <div key={approval.id} className="rounded-xl border bg-background/40 p-3"><p className="text-sm font-semibold">{approval.actionType.replaceAll("_", " ")}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{approval.description}</p><div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={resolveApproval.isPending} onClick={() => resolveApproval.mutate({ approvalId: approval.id, approved: false })}>Reject</Button><Button size="sm" disabled={resolveApproval.isPending} onClick={() => resolveApproval.mutate({ approvalId: approval.id, approved: true })}>Approve</Button></div></div>)}</div> : <EmptyPanel icon={ShieldCheck} label="Nothing awaits approval" description="Deletes, live pushes, and permanent operations will stop here for your decision." />}<Button variant="outline" className="mt-3 w-full text-xs" disabled={!activeRun || requestLivePushApproval.isPending} onClick={() => activeRun && requestLivePushApproval.mutate({ runId: activeRun.id, destination: "Configured GitHub remote" })}>{requestLivePushApproval.isPending ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <GitBranch className="mr-2 size-3.5" />}Request live push approval</Button><p className="mt-2 text-[10px] leading-4 text-muted-foreground">An approved push remains a separate user-controlled GitHub action.</p></div></section>
          <section className="panel-glow overflow-hidden rounded-2xl border bg-card/80"><PanelTitle icon={History} title="Run history" subtitle="Saved task records" /><ScrollArea className="h-52"><div className="p-3">{runs.data?.length ? <div className="space-y-1">{runs.data.map(run => { const meta = statusMeta[run.status]; return <button key={run.id} onClick={() => setActiveRunId(run.id)} className={cn("w-full rounded-xl border p-3 text-left transition-colors", activeRun?.id === run.id ? "border-primary/40 bg-primary/8" : "border-transparent hover:bg-accent/70")}><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-bold">{run.taskType}</p><span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold", meta.className)}>{meta.label}</span></div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{run.deliverable}</p></button>; })}</div> : <EmptyPanel icon={History} label="No saved runs" description="Each submitted task remains available in this workspace." />}</div></ScrollArea></section>
          <section className="panel-glow overflow-hidden rounded-2xl border bg-card/80"><PanelTitle icon={RotateCcw} title="Rollback" subtitle="Workspace snapshots" /><ScrollArea className="h-36"><div className="space-y-2 p-3">{snapshots.data?.length ? snapshots.data.map(snapshot => <div key={snapshot.id} className="rounded-lg border bg-background/40 p-2"><p className="truncate text-[11px] font-semibold">{snapshot.label}</p><Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-[10px]" disabled={restoreSnapshot.isPending} onClick={() => restoreSnapshot.mutate({ projectId: activeProjectId!, snapshotId: snapshot.id })}>Restore</Button></div>) : <EmptySmall text="A snapshot is created before accepted changes." />}</div></ScrollArea></section>
          <section className="rounded-2xl border border-primary/20 bg-primary/7 p-4"><div className="flex gap-3"><Play className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-xs font-bold">Execution workflow</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Plan → proposal → your review → verification → saved snapshot. Nothing permanent runs without approval.</p></div></div></section>
        </aside>
      </div>

      {deleteCandidate ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"><section className="w-full max-w-md rounded-2xl border bg-card p-6 panel-glow"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-amber-300">Delete confirmation</p><h3 className="mt-2 text-lg font-extrabold">Delete {deleteCandidate}?</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">This is a permanent workspace action. Confirm only when you want to remove this file.</p></div><Button variant="ghost" size="icon" onClick={() => setDeleteCandidate(null)}><X className="size-4" /></Button></div><div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleteCandidate(null)}>Cancel</Button><Button variant="destructive" disabled={deleteFile.isPending} onClick={() => activeProjectId && deleteFile.mutate({ projectId: activeProjectId, path: deleteCandidate })}><Trash2 className="mr-1.5 size-4" />Confirm delete</Button></div></section></div> : null}
    </main>
  );
}

function LoginScreen() { return <main className="ambient-grid flex min-h-screen items-center justify-center px-5"><section className="panel-glow w-full max-w-xl rounded-[1.35rem] border bg-card/90 p-8 text-center sm:p-12"><div className="mx-auto mb-7 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Braces className="size-7" /></div><p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-primary">CodeForge Workspace</p><h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">Universal coding, one controlled workspace.</h1><p className="mx-auto mt-5 max-w-md text-sm leading-7 text-muted-foreground">Sign in to create a private workspace, submit coding tasks in any language, and review each proposed change before it is accepted.</p><Button onClick={() => startLogin()} className="mt-8 h-11 px-6 font-bold">Sign in to workspace <ChevronRight className="ml-1 size-4" /></Button></section></main>; }
function PanelTitle({ icon: Icon, title, subtitle }: { icon: typeof Files; title: string; subtitle: string }) { return <div className="flex items-center gap-3 border-b px-5 py-4"><div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></div><div><h3 className="text-sm font-extrabold">{title}</h3><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">{subtitle}</p></div></div>; }
function EmptySmall({ text }: { text: string }) { return <p className="px-2 py-4 text-center text-[11px] leading-5 text-muted-foreground">{text}</p>; }
function EmptyPanel({ icon: Icon, label, description }: { icon: typeof Files; label: string; description: string }) { return <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center"><div className="flex size-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><Icon className="size-5" /></div><p className="mt-4 text-sm font-bold">{label}</p><p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">{description}</p></div>; }
function VerificationPanel({ checks }: { checks: Array<{ id: number; checkType: string; status: "queued" | "running" | "passed" | "failed" | "skipped"; logText: string | null }> }) { if (!checks.length) return <EmptyPanel icon={CheckCircle2} label="No verification queued" description="After you accept a reviewed change set, CodeForge saves a snapshot and queues type check, lint, build, and tests in an isolated runner." />; return <div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{checks.map(check => <div key={check.id} className="rounded-xl border bg-background/45 p-3"><div className="flex items-center gap-2"><CircleDot className={cn("size-3.5", check.status === "passed" ? "text-emerald-300" : check.status === "failed" ? "text-red-300" : "text-amber-300")} /><p className="text-xs font-bold capitalize">{check.checkType}</p></div><p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{check.status}</p></div>)}</div><div className="mt-3 rounded-xl border bg-background/60 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Runner log</p><pre className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">{checks.map(check => `[${check.checkType}] ${check.logText ?? "No log available"}`).join("\n")}</pre></div></div>; }
function LoadingPanel({ label }: { label: string }) { return <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" />{label}</div>; }
function RunPlan({ run, onGenerate, generatePending }: { run: { id: number; assistantResponse: string; inputLanguage: string; taskType: string; status: keyof typeof statusMeta; taskJson: string }; onGenerate: () => void; generatePending: boolean }) { const meta = statusMeta[run.status]; let task: { implementationPlan?: string[] } = {}; try { task = JSON.parse(run.taskJson).task ?? JSON.parse(run.taskJson); } catch { task = {}; } return <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">{run.taskType}</span><span className="rounded-full border px-2.5 py-1 text-[10px] font-bold text-muted-foreground">Input: {run.inputLanguage}</span><span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold", meta.className)}>{meta.label}</span></div><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-foreground">{run.assistantResponse}</p>{task.implementationPlan?.length ? <ol className="mt-5 space-y-2 border-t pt-5">{task.implementationPlan.map((item, index) => <li key={`${item}-${index}`} className="flex gap-3 text-xs leading-5 text-muted-foreground"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{index + 1}</span>{item}</li>)}</ol> : null}{run.status === "planned" ? <Button className="mt-6" onClick={onGenerate} disabled={generatePending}>{generatePending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Code2 className="mr-2 size-4" />}Generate code proposal</Button> : null}</div>; }
function DiffReview({ changes, activeChange, onSelect, canAccept, accepting, rejecting, onAccept, onReject }: { changes: FileChange[]; activeChange?: FileChange; onSelect: (id: number) => void; canAccept: boolean; accepting: boolean; rejecting: boolean; onAccept: () => void; onReject: () => void }) { return <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)]"><div className="space-y-1">{changes.map(change => <button key={change.id} onClick={() => onSelect(change.id)} className={cn("w-full rounded-lg border px-3 py-2 text-left text-xs", activeChange?.id === change.id ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-accent")}><span className="mr-2 font-bold">{change.operation.toUpperCase()}</span><span className="break-all">{change.path}</span></button>)}</div><div>{activeChange ? <><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold">{activeChange.path}</p><span className="rounded-full border px-2 py-1 text-[10px] text-muted-foreground">{activeChange.reviewStatus}</span></div><pre className="max-h-80 overflow-auto rounded-xl border bg-background/60 p-4 text-[11px] leading-5 text-muted-foreground"><code>{activeChange.diffText}</code></pre>{canAccept ? <div className="mt-3 flex justify-end gap-2"><Button variant="outline" size="sm" disabled={rejecting} onClick={onReject}>Reject proposal</Button><Button size="sm" disabled={accepting} onClick={onAccept}><CheckCircle2 className="mr-1.5 size-3.5" />Accept reviewed changes</Button></div> : null}</> : null}</div></div>; }
function inferLanguage(path: string) { const ext = path.split(".").pop()?.toLowerCase(); return ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", json: "json", css: "css", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", sh: "shell" } as Record<string, string>)[ext ?? ""] ?? "text"; }
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
