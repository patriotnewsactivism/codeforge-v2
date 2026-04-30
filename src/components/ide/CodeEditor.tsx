import { useCallback, useRef, useEffect } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { Doc } from "../../../convex/_generated/dataModel";

interface CodeEditorProps {
  file: Doc<"files"> | null;
  onChange: (content: string) => void;
  onSave: () => void;
}

export function CodeEditor({ file, onChange, onSave }: CodeEditorProps) {
  const editorRef = useRef<any>(null);

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Ctrl+S to save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave();
      });

      // Set theme
      monaco.editor.defineTheme("codeforge-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6A9955" },
          { token: "keyword", foreground: "C586C0" },
          { token: "string", foreground: "CE9178" },
          { token: "number", foreground: "B5CEA8" },
          { token: "type", foreground: "4EC9B0" },
          { token: "function", foreground: "DCDCAA" },
          { token: "variable", foreground: "9CDCFE" },
        ],
        colors: {
          "editor.background": "#0d0f1a",
          "editor.foreground": "#e0e0e0",
          "editor.lineHighlightBackground": "#1a1d2e",
          "editor.selectionBackground": "#264f78",
          "editorCursor.foreground": "#22d3ee",
          "editorLineNumber.foreground": "#4a4a5a",
          "editorLineNumber.activeForeground": "#22d3ee",
          "editor.selectionHighlightBackground": "#1a3a5c",
          "editorIndentGuide.background": "#1a1d2e",
          "editorIndentGuide.activeBackground": "#2a2d3e",
        },
      });
      monaco.editor.setTheme("codeforge-dark");

      editor.focus();
    },
    [onSave]
  );

  // Update editor content when file changes
  useEffect(() => {
    if (editorRef.current && file) {
      const currentValue = editorRef.current.getValue();
      if (currentValue !== file.content) {
        editorRef.current.setValue(file.content);
      }
    }
  }, [file?._id]);

  if (!file) {
    return (
      <div className="h-full flex items-center justify-center bg-[oklch(0.13_0.02_260)]">
        <div className="text-center">
          <div className="text-4xl mb-4 opacity-20">{"</>"}</div>
          <p className="text-muted-foreground text-sm">
            Select a file to start editing
          </p>
          <p className="text-muted-foreground/60 text-xs mt-1">
            or create a new one from the file tree
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        language={file.language ?? "plaintext"}
        value={file.content}
        onChange={(value) => onChange(value ?? "")}
        onMount={handleEditorMount}
        theme="codeforge-dark"
        options={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
          fontLigatures: true,
          minimap: { enabled: false },
          lineNumbers: "on",
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          insertSpaces: true,
          automaticLayout: true,
          padding: { top: 8 },
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
        }}
      />
    </div>
  );
}
