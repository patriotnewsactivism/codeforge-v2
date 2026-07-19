import {
  ChevronDown,
  ChevronRight,
  Edit2,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

interface FileTreeProps {
  files: Doc<"files">[];
  activeFilePath: string | null;
  onFileSelect: (file: Doc<"files">) => void;
  onCreateFile?: (name: string, isDirectory: boolean) => void;
  onDeleteFile?: (fileId: Id<"files">) => void;
  onRenameFile?: (fileId: Id<"files">, newName: string) => void;
  collaborators?: Doc<"collaborators">[];
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  file?: Doc<"files">;
  children: TreeNode[];
}

function buildTree(files: Doc<"files">[]): TreeNode[] {
  const root: TreeNode[] = [];
  const map = new Map<string, TreeNode>();

  // Sort: directories first, then by name
  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const file of sorted) {
    const parts = file.path.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");

    const node: TreeNode = {
      name,
      path: file.path,
      isDirectory: file.isDirectory,
      file: file.isDirectory ? undefined : file,
      children: [],
    };

    map.set(file.path, node);

    if (parentPath === "") {
      root.push(node);
    } else {
      const parent = map.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        // Fallback if parent directory object doesn't exist
        root.push(node);
      }
    }
  }

  return root;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "html":
    case "htm":
      return <FileCode className="h-4 w-4 text-orange-400" />;
    case "css":
      return <FileCode className="h-4 w-4 text-blue-400" />;
    case "js":
    case "jsx":
      return <FileCode className="h-4 w-4 text-yellow-400" />;
    case "ts":
    case "tsx":
      return <FileCode className="h-4 w-4 text-blue-300" />;
    case "json":
      return <FileJson className="h-4 w-4 text-green-400" />;
    case "md":
      return <FileText className="h-4 w-4 text-gray-400" />;
    case "py":
      return <FileCode className="h-4 w-4 text-green-300" />;
    default:
      return <File className="h-4 w-4 text-gray-400" />;
  }
}

function TreeItem({
  node,
  depth,
  activeFilePath,
  onFileSelect,
  onDeleteFile,
  onRenameFile,
  collaborators,
}: {
  node: TreeNode;
  depth: number;
  activeFilePath: string | null;
  onFileSelect: (file: Doc<"files">) => void;
  onDeleteFile?: (fileId: Id<"files">) => void;
  onRenameFile?: (fileId: Id<"files">, newName: string) => void;
  collaborators?: Doc<"collaborators">[];
}) {
  const [expanded, setExpanded] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const isActive = activeFilePath === node.path;

  // Find collaborators viewing this file
  const viewingCollabs = collaborators?.filter(c => c.activeFile === node.path);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isRenaming) return; // let input handle its own keys
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (node.isDirectory) {
        setExpanded(!expanded);
      } else if (node.file) {
        onFileSelect(node.file);
      }
    }
  };

  const handleRenameSubmit = () => {
    if (
      renameValue.trim() &&
      renameValue !== node.name &&
      node.file &&
      onRenameFile
    ) {
      onRenameFile(node.file._id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  return (
    <div
      role="treeitem"
      aria-expanded={node.isDirectory ? expanded : undefined}
    >
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 cursor-pointer text-sm hover:bg-[oklch(0.20_0.02_260)] rounded-sm group relative",
          isActive && "bg-[oklch(0.22_0.02_260)] text-[oklch(0.75_0.18_190)]",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (isRenaming) return;
          if (node.isDirectory) {
            setExpanded(!expanded);
          } else if (node.file) {
            onFileSelect(node.file);
          }
        }}
        onKeyDown={handleKeyDown}
      >
        {node.isDirectory ? (
          expanded ? (
            <>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              <FolderOpen className="h-4 w-4 shrink-0 text-cyan-400" />
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <Folder className="h-4 w-4 shrink-0 text-cyan-400" />
            </>
          )
        ) : (
          <>
            <span className="w-3 shrink-0" />
            {getFileIcon(node.name)}
          </>
        )}

        {isRenaming ? (
          <input
            type="text"
            className="flex-1 min-w-0 bg-[oklch(0.18_0.02_260)] border border-primary/50 rounded px-1 text-sm text-foreground focus:outline-none"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onKeyDown={e => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") {
                setIsRenaming(false);
                setRenameValue(node.name);
              }
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1">{node.name}</span>
        )}

        {/* Collaborator dots */}
        {!isRenaming && viewingCollabs && viewingCollabs.length > 0 && (
          <div className="flex gap-0.5 mr-1 shrink-0">
            {viewingCollabs.map(c => (
              <div
                key={c._id}
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: c.color }}
                title={c.userName}
              />
            ))}
          </div>
        )}

        {/* Actions */}
        {!isRenaming && node.file && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 transition-opacity gap-1">
            {onRenameFile && (
              <button
                type="button"
                className="p-0.5 hover:text-primary"
                aria-label={`Rename ${node.name}`}
                onClick={e => {
                  e.stopPropagation();
                  setRenameValue(node.name);
                  setIsRenaming(true);
                }}
              >
                <Edit2 className="h-3 w-3" />
              </button>
            )}
            {onDeleteFile && (
              <button
                type="button"
                className="p-0.5 hover:text-destructive"
                aria-label={`Delete ${node.name}`}
                onClick={e => {
                  e.stopPropagation();
                  onDeleteFile(node.file!._id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {node.isDirectory && expanded && (
        <div>
          {node.children.map(child => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onFileSelect={onFileSelect}
              onDeleteFile={onDeleteFile}
              onRenameFile={onRenameFile}
              collaborators={collaborators}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({
  files,
  activeFilePath,
  onFileSelect,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  collaborators,
}: FileTreeProps) {
  const [isCreating, setIsCreating] = useState<{
    active: boolean;
    isDir: boolean;
  }>({ active: false, isDir: false });
  const [newFileName, setNewFileName] = useState("");

  const tree = buildTree(files);

  const handleCreate = () => {
    if (newFileName.trim() && onCreateFile) {
      onCreateFile(newFileName.trim(), isCreating.isDir);
      setNewFileName("");
      setIsCreating({ active: false, isDir: false });
    }
  };

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Files
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="p-1 hover:bg-[oklch(0.20_0.02_260)] rounded"
            onClick={() => setIsCreating({ active: true, isDir: false })}
            title="New File"
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="p-1 hover:bg-[oklch(0.20_0.02_260)] rounded"
            onClick={() => setIsCreating({ active: true, isDir: true })}
            title="New Folder"
          >
            <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {isCreating.active && (
        <div className="px-2 py-1.5 border-b border-border shrink-0">
          <input
            type="text"
            className="w-full bg-[oklch(0.18_0.02_260)] border border-border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder={isCreating.isDir ? "folder/name" : "filename.ext"}
            aria-label="New item name"
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onKeyDown={e => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") {
                setIsCreating({ active: false, isDir: false });
                setNewFileName("");
              }
            }}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1" role="tree">
        {tree.map(node => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onDeleteFile={onDeleteFile}
            onRenameFile={onRenameFile}
            collaborators={collaborators}
          />
        ))}
      </div>
    </div>
  );
}
