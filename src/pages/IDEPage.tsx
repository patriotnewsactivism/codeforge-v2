import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { FileTree } from "@/components/ide/FileTree";
import { CodeEditor } from "@/components/ide/CodeEditor";
import { EditorTabs } from "@/components/ide/EditorTabs";
import { ChatPanel } from "@/components/ide/ChatPanel";
import { LivePreview } from "@/components/ide/LivePreview";
import { CollaborationBar } from "@/components/ide/CollaborationBar";
import { SuggestionsPanel } from "@/components/ide/SuggestionsPanel";
import { BuildProgress } from "@/components/ide/BuildProgress";
import { AgentPanel } from "@/components/ide/AgentPanel";
import { MemoryTab } from "@/components/ide/MemoryTab";
import { SessionSidebar } from "@/components/ide/SessionSidebar";
import { PanelErrorBoundary } from "@/components/ide/PanelErrorBoundary";
import {
  FileTreeSkeleton,
  EditorSkeleton,
} from "@/components/ide/PanelSkeleton";
import { useAuthToken } from "@/hooks/useAuthToken";
import { toast } from "sonner";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  PanelBottomOpen,
  PanelBottomClose,
  MessageSquare,
  MessageSquareOff,
  Lightbulb,
  Zap,
  History,
  Download,
  Brain,
} from "lucide-react";

type RightPanel = "chat" | "suggestions" | "agents" | "memory";

export function IDEPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const userId = useAuthToken();

  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as Id<"projects"> } : "skip"
  );
  const files = useQuery(
    api.files.listByProject,
    projectId ? { projectId: projectId as Id<"projects"> } : "skip"
  );
  const collaborators = useQuery(
    api.collaboration.listActive,
    projectId ? { projectId: projectId as Id<"projects"> } : "skip"
  );

  const updateFileContent = useMutation(api.files.updateContent);
  const createFile = useMutation(api.files.create);
  const deleteFile = useMutation(api.files.remove);
  const getOrCreateSession = useMutation(api.chat.getOrCreateSession);
  const heartbeat = useMutation(api.collaboration.heartbeat);
  const runBuildLoop = useAction(api.buildLoop.runBuildLoop);

  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileBuffers, setFileBuffers] = useState<Map<string, string>>(
    new Map()
  );
  const [unsavedFiles, setUnsavedFiles] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState<Id<"chatSessions"> | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [rightPanel, setRightPanel] = useState<RightPanel>("chat");
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showSessionSidebar, setShowSessionSidebar] = useState(false);

  const createSession = useMutation(api.chat.createSession);
  const projectBundle = useQuery(
    api.export.getProjectBundle,
    projectId ? { projectId: projectId as Id<"projects"> } : "skip"
  );

  // Initialize chat session
  useEffect(() => {
    if (projectId && userId && !sessionId) {
      getOrCreateSession({ projectId: projectId as Id<"projects"> }).then(
        setSessionId
      );
    }
  }, [projectId, userId, sessionId, getOrCreateSession]);

  // Presence heartbeat
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(() => {
      heartbeat({
        projectId: projectId as Id<"projects">,
        activeFile: activeFilePath ?? undefined,
      }).catch(() => {});
    }, 10_000);
    heartbeat({
      projectId: projectId as Id<"projects">,
      activeFile: activeFilePath ?? undefined,
    }).catch(() => {});
    return () => clearInterval(interval);
  }, [projectId, activeFilePath, heartbeat]);

  // Auto-open first file
  useEffect(() => {
    if (files && files.length > 0 && openFilePaths.length === 0) {
      const htmlFile = files.find((f) => f.name === "index.html");
      const firstFile = htmlFile ?? files.find((f) => !f.isDirectory);
      if (firstFile) {
        setOpenFilePaths([firstFile.path]);
        setActiveFilePath(firstFile.path);
      }
    }
  }, [files, openFilePaths.length]);

  const activeFile = files?.find((f) => f.path === activeFilePath) ?? null;

  const getFileContent = useCallback(
    (path: string) => {
      return (
        fileBuffers.get(path) ??
        files?.find((f) => f.path === path)?.content ??
        ""
      );
    },
    [fileBuffers, files]
  );

  const handleFileSelect = useCallback(
    (file: Doc<"files">) => {
      if (!openFilePaths.includes(file.path)) {
        setOpenFilePaths((prev) => [...prev, file.path]);
      }
      setActiveFilePath(file.path);
    },
    [openFilePaths]
  );

  const handleTabClose = useCallback(
    (filePath: string) => {
      setOpenFilePaths((prev) => prev.filter((p) => p !== filePath));
      if (activeFilePath === filePath) {
        const remaining = openFilePaths.filter((p) => p !== filePath);
        setActiveFilePath(
          remaining.length > 0 ? remaining[remaining.length - 1] : null
        );
      }
      setFileBuffers((prev) => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
      setUnsavedFiles((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    },
    [activeFilePath, openFilePaths]
  );

  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeFilePath) return;
      setFileBuffers((prev) => new Map(prev).set(activeFilePath, content));
      const original = files?.find(
        (f) => f.path === activeFilePath
      )?.content;
      if (content !== original) {
        setUnsavedFiles((prev) => new Set(prev).add(activeFilePath));
      } else {
        setUnsavedFiles((prev) => {
          const next = new Set(prev);
          next.delete(activeFilePath);
          return next;
        });
      }
    },
    [activeFilePath, files]
  );

  const handleSave = useCallback(async () => {
    if (!activeFilePath || !activeFile) return;
    const content = fileBuffers.get(activeFilePath);
    if (content === undefined) return;
    try {
      await updateFileContent({ fileId: activeFile._id, content });
      setUnsavedFiles((prev) => {
        const next = new Set(prev);
        next.delete(activeFilePath);
        return next;
      });
      setFileBuffers((prev) => {
        const next = new Map(prev);
        next.delete(activeFilePath);
        return next;
      });
      toast.success("File saved", { duration: 1500 });
    } catch {
      toast.error("Failed to save file");
    }
  }, [activeFilePath, activeFile, fileBuffers, updateFileContent]);

  const handleCreateFile = useCallback(
    async (name: string) => {
      if (!projectId) return;
      try {
        await createFile({
          projectId: projectId as Id<"projects">,
          path: name,
          name,
          isDirectory: false,
        });
        toast.success(`Created ${name}`);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Failed to create file");
      }
    },
    [projectId, createFile]
  );

  const handleDeleteFile = useCallback(
    async (fileId: Id<"files">) => {
      try {
        const file = files?.find((f) => f._id === fileId);
        await deleteFile({ fileId });
        if (file) {
          handleTabClose(file.path);
        }
        toast.success("File deleted");
      } catch {
        toast.error("Failed to delete file");
      }
    },
    [files, deleteFile, handleTabClose]
  );

  // Handle implementing a suggestion via the build loop
  const handleImplementSuggestion = useCallback(
    async (prompt: string, suggestionId: Id<"suggestions">) => {
      if (!projectId) return;
      toast.info("Starting build...", { duration: 2000 });
      try {
        const result = await runBuildLoop({
          projectId: projectId as Id<"projects">,
          prompt,
          suggestionId,
        });
        toast.success(`Build complete: ${result}`, { duration: 4000 });
      } catch (e) {
        toast.error(
          `Build failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    },
    [projectId, runBuildLoop]
  );

  // Handle creating a new chat session
  const handleNewSession = useCallback(async () => {
    if (!projectId) return;
    try {
      const newId = await createSession({
        projectId: projectId as Id<"projects">,
        title: `Chat ${new Date().toLocaleTimeString()}`,
      });
      setSessionId(newId);
    } catch {
      toast.error("Failed to create session");
    }
  }, [projectId, createSession]);

  // Handle export as zip
  const handleExport = useCallback(() => {
    if (!projectBundle) return;
    // Create a simple JSON bundle download (can be converted to zip client-side with JSZip)
    const blob = new Blob([JSON.stringify(projectBundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectBundle.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Project exported");
  }, [projectBundle]);

  // Collect open file contexts for multi-file AI chat
  const openFileContexts = openFilePaths
    .map((path) => {
      const file = files?.find((f) => f.path === path);
      if (!file || file.isDirectory) return null;
      return { path: file.path, content: getFileContent(file.path) };
    })
    .filter((f): f is { path: string; content: string } => f !== null);

  // Build file list with buffers applied for preview
  const previewFiles =
    files?.map((f) => ({
      ...f,
      content: fileBuffers.get(f.path) ?? f.content,
    })) ?? [];

  const openFilesDocs = openFilePaths
    .map((path) => files?.find((f) => f.path === path))
    .filter((f): f is Doc<"files"> => f !== undefined);

  if (!project) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar: collaboration */}
      <CollaborationBar
        projectId={projectId as Id<"projects">}
        projectName={project.name}
      />

      {/* Build progress overlay */}
      <BuildProgress projectId={projectId as Id<"projects">} />

      {/* Main IDE area */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* File Tree */}
          <ResizablePanel defaultSize={15} minSize={10} maxSize={25}>
            <PanelErrorBoundary panelName="File Tree">
              {files === undefined ? (
                <FileTreeSkeleton />
              ) : (
                <FileTree
                  files={files}
                  activeFilePath={activeFilePath}
                  onFileSelect={handleFileSelect}
                  onCreateFile={handleCreateFile}
                  onDeleteFile={handleDeleteFile}
                  collaborators={collaborators}
                />
              )}
            </PanelErrorBoundary>
          </ResizablePanel>

          <ResizableHandle />

          {/* Editor + Preview area */}
          <ResizablePanel defaultSize={showRightPanel ? 55 : 70}>
            <ResizablePanelGroup direction="vertical">
              {/* Code Editor */}
              <ResizablePanel defaultSize={showPreview ? 55 : 100}>
                <div className="h-full flex flex-col">
                  <EditorTabs
                    openFiles={openFilesDocs}
                    activeFilePath={activeFilePath}
                    onSelect={handleFileSelect}
                    onClose={handleTabClose}
                    unsavedFiles={unsavedFiles}
                  />
                  <div className="flex-1">
                    <PanelErrorBoundary panelName="Code Editor">
                      {files === undefined ? (
                        <EditorSkeleton />
                      ) : (
                        <CodeEditor
                          file={
                            activeFile
                              ? {
                                  ...activeFile,
                                  content: getFileContent(activeFile.path),
                                }
                              : null
                          }
                          onChange={handleContentChange}
                          onSave={handleSave}
                        />
                      )}
                    </PanelErrorBoundary>
                  </div>
                </div>
              </ResizablePanel>

              {showPreview && (
                <>
                  <ResizableHandle />
                  {/* Live Preview + Console */}
                  <ResizablePanel defaultSize={45} minSize={20}>
                    <PanelErrorBoundary panelName="Live Preview">
                      <LivePreview
                        files={previewFiles}
                        autoRefresh={autoRefresh}
                        onToggleAutoRefresh={() => setAutoRefresh(!autoRefresh)}
                      />
                    </PanelErrorBoundary>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {showRightPanel && (
            <>
              <ResizableHandle />
              {/* Right panel: Chat / Suggestions / Agents */}
              <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
                <div className="h-full flex flex-col">
                  {/* Panel tabs */}
                  <div className="flex border-b border-border bg-[oklch(0.10_0.02_260)]">
                    <button
                      type="button"
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                        rightPanel === "chat"
                          ? "text-primary border-b-2 border-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setRightPanel("chat")}
                    >
                      <MessageSquare className="h-3 w-3" />
                      Chat
                    </button>
                    <button
                      type="button"
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                        rightPanel === "suggestions"
                          ? "text-amber-400 border-b-2 border-amber-400"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setRightPanel("suggestions")}
                    >
                      <Lightbulb className="h-3 w-3" />
                      Ideas
                    </button>
                    <button
                      type="button"
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                        rightPanel === "agents"
                          ? "text-amber-400 border-b-2 border-amber-400"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setRightPanel("agents")}
                    >
                      <Zap className="h-3 w-3" />
                      Agents
                    </button>
                    <button
                      type="button"
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                        rightPanel === "memory"
                          ? "text-violet-400 border-b-2 border-violet-400"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setRightPanel("memory")}
                    >
                      <Brain className="h-3 w-3" />
                      Memory
                    </button>
                  </div>

                  {/* Panel content */}
                  <div className="flex-1 overflow-hidden flex">
                    {/* Session sidebar (togglable) */}
                    {rightPanel === "chat" && showSessionSidebar && (
                      <div className="w-44 border-r border-border shrink-0">
                        <SessionSidebar
                          projectId={projectId as Id<"projects">}
                          activeSessionId={sessionId}
                          onSelectSession={(id) => setSessionId(id)}
                          onNewSession={handleNewSession}
                        />
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                      {rightPanel === "chat" && (
                        <PanelErrorBoundary panelName="AI Chat">
                          <ChatPanel
                            projectId={projectId as Id<"projects">}
                            sessionId={sessionId}
                            currentFileContent={
                              activeFile
                                ? getFileContent(activeFile.path)
                                : undefined
                            }
                            currentFileName={activeFile?.name}
                            openFiles={openFileContexts}
                          />
                        </PanelErrorBoundary>
                      )}
                      {rightPanel === "suggestions" && (
                        <PanelErrorBoundary panelName="Suggestions">
                          <SuggestionsPanel
                            projectId={projectId as Id<"projects">}
                            onImplement={handleImplementSuggestion}
                          />
                        </PanelErrorBoundary>
                      )}
                      {rightPanel === "agents" && (
                        <PanelErrorBoundary panelName="Multi-Agent">
                          <AgentPanel
                            projectId={projectId as Id<"projects">}
                          />
                        </PanelErrorBoundary>
                      )}
                  {rightPanel === "memory" && projectId && (
                    <PanelErrorBoundary>
                      <MemoryTab projectId={projectId as Id<"projects">} />
                    </PanelErrorBoundary>
                  )}
                    </div>
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[oklch(0.09_0.02_260)] border-t border-border text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{activeFile?.language ?? "plaintext"}</span>
          {unsavedFiles.size > 0 && (
            <span className="text-primary">
              {unsavedFiles.size} unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[oklch(0.16_0.02_260)] transition-colors"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? (
              <PanelBottomClose className="h-3 w-3" />
            ) : (
              <PanelBottomOpen className="h-3 w-3" />
            )}
            Preview
          </button>
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[oklch(0.16_0.02_260)] transition-colors"
            onClick={() => setShowRightPanel(!showRightPanel)}
          >
            {showRightPanel ? (
              <MessageSquareOff className="h-3 w-3" />
            ) : (
              <MessageSquare className="h-3 w-3" />
            )}
            Panel
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[oklch(0.16_0.02_260)] transition-colors ${showSessionSidebar ? "text-primary" : ""}`}
            onClick={() => setShowSessionSidebar(!showSessionSidebar)}
          >
            <History className="h-3 w-3" />
            Sessions
          </button>
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[oklch(0.16_0.02_260)] transition-colors"
            onClick={handleExport}
          >
            <Download className="h-3 w-3" />
            Export
          </button>
          <span>CodeForge</span>
        </div>
      </div>
    </div>
  );
}
