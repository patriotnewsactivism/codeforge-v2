import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
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
import { useAuthToken } from "@/hooks/useAuthToken";
import { toast } from "sonner";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  PanelBottomOpen,
  PanelBottomClose,
  MessageSquare,
  MessageSquareOff,
} from "lucide-react";

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

  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileBuffers, setFileBuffers] = useState<Map<string, string>>(
    new Map()
  );
  const [unsavedFiles, setUnsavedFiles] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState<Id<"chatSessions"> | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

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
    // Initial heartbeat
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

  const activeFile =
    files?.find((f) => f.path === activeFilePath) ?? null;

  // Get effective content (buffer or saved)
  const getFileContent = useCallback(
    (path: string) => {
      return fileBuffers.get(path) ?? files?.find((f) => f.path === path)?.content ?? "";
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
        setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      }
      // Clean up buffer
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
      const original = files?.find((f) => f.path === activeFilePath)?.content;
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

      {/* Main IDE area */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* File Tree */}
          <ResizablePanel defaultSize={15} minSize={10} maxSize={25}>
            <FileTree
              files={files ?? []}
              activeFilePath={activeFilePath}
              onFileSelect={handleFileSelect}
              onCreateFile={handleCreateFile}
              onDeleteFile={handleDeleteFile}
              collaborators={collaborators}
            />
          </ResizablePanel>

          <ResizableHandle />

          {/* Editor + Preview area */}
          <ResizablePanel defaultSize={showChat ? 55 : 70}>
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
                    <CodeEditor
                      file={activeFile ? { ...activeFile, content: getFileContent(activeFile.path) } : null}
                      onChange={handleContentChange}
                      onSave={handleSave}
                    />
                  </div>
                </div>
              </ResizablePanel>

              {showPreview && (
                <>
                  <ResizableHandle />
                  {/* Live Preview + Console */}
                  <ResizablePanel defaultSize={45} minSize={20}>
                    <LivePreview
                      files={previewFiles}
                      autoRefresh={autoRefresh}
                      onToggleAutoRefresh={() => setAutoRefresh(!autoRefresh)}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {showChat && (
            <>
              <ResizableHandle />
              {/* AI Chat */}
              <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
                <ChatPanel
                  projectId={projectId as Id<"projects">}
                  sessionId={sessionId}
                  currentFileContent={
                    activeFile
                      ? getFileContent(activeFile.path)
                      : undefined
                  }
                  currentFileName={activeFile?.name}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[oklch(0.09_0.02_260)] border-t border-border text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>
            {activeFile?.language ?? "plaintext"}
          </span>
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
            onClick={() => setShowChat(!showChat)}
          >
            {showChat ? (
              <MessageSquareOff className="h-3 w-3" />
            ) : (
              <MessageSquare className="h-3 w-3" />
            )}
            Chat
          </button>
          <span>CodeForge</span>
        </div>
      </div>
    </div>
  );
}
