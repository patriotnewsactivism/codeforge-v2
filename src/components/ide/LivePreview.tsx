import { ExternalLink, RefreshCw, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Doc } from "../../../convex/_generated/dataModel";

interface LivePreviewProps {
  files: Doc<"files">[];
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
}

interface ConsoleMessage {
  type: "log" | "error" | "warn" | "info";
  content: string;
  timestamp: number;
}

/**
 * Resolve file references in HTML by finding matching files in the project.
 * Supports both flat and nested paths (e.g., "src/app.js", "style.css").
 */
function resolveFile(
  files: Doc<"files">[],
  reference: string,
): Doc<"files"> | undefined {
  // Exact path match
  const exact = files.find(f => f.path === reference);
  if (exact) return exact;
  // Match by filename only
  const byName = files.find(f => f.name === reference);
  if (byName) return byName;
  // Match by path ending (e.g., "src/app.js" matches a file at "src/app.js")
  return files.find(f => f.path.endsWith(`/${reference}`));
}

export function LivePreview({
  files,
  autoRefresh,
  onToggleAutoRefresh,
}: LivePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [consoleMessages, setConsoleMessages] = useState<ConsoleMessage[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const buildPreviewContent = useCallback(() => {
    // Find all HTML files — prefer index.html
    const htmlFile =
      files.find(f => f.name === "index.html") ??
      files.find(f => f.path.endsWith(".html"));

    if (!htmlFile) {
      return `
        <html>
          <body style="background: #1a1a2e; color: #666; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; margin: 0;">
            <div style="text-align: center;">
              <p style="font-size: 1.2rem;">No HTML file found</p>
              <p style="font-size: 0.9rem; color: #444;">Create an index.html to see the preview</p>
            </div>
          </body>
        </html>
      `;
    }

    let html = htmlFile.content;

    // Collect ALL CSS and JS files in the project
    const cssFiles = files.filter(
      f => f.name.endsWith(".css") && !f.isDirectory,
    );
    const jsFiles = files.filter(
      f => f.name.endsWith(".js") && !f.isDirectory,
    );

    // ─── Resolve <link> stylesheet references ──────────────────────────
    // Replace any <link rel="stylesheet" href="..."> with inline <style> blocks
    html = html.replace(
      /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
      (_match: string, href: string) => {
        const resolved = resolveFile(files, href);
        if (resolved) return `<style>/* ${href} */\n${resolved.content}</style>`;
        return `<!-- unresolved: ${href} -->`;
      },
    );
    // Also catch <link href="..." rel="stylesheet">
    html = html.replace(
      /<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi,
      (_match: string, href: string) => {
        const resolved = resolveFile(files, href);
        if (resolved) return `<style>/* ${href} */\n${resolved.content}</style>`;
        return `<!-- unresolved: ${href} -->`;
      },
    );

    // ─── Resolve <script src="..."> references ──────────────────────────
    html = html.replace(
      /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
      (_match: string, src: string) => {
        const resolved = resolveFile(files, src);
        if (resolved) return `<script>/* ${src} */\n${resolved.content}</script>`;
        return `<!-- unresolved: ${src} -->`;
      },
    );

    // ─── Inject any remaining CSS files not referenced in HTML ──────────
    const injectedCss = cssFiles
      .filter(f => !html.includes(f.content.slice(0, 50)))
      .map(f => `<style>/* auto-injected: ${f.path} */\n${f.content}</style>`)
      .join("\n");
    if (injectedCss) {
      if (html.includes("</head>")) {
        html = html.replace("</head>", `${injectedCss}\n</head>`);
      } else {
        html = `${injectedCss}\n${html}`;
      }
    }

    // ─── Inject any JS files not referenced in HTML ─────────────────────
    const injectedJs = jsFiles
      .filter(f => !html.includes(f.content.slice(0, 50)))
      .map(
        f =>
          `<script>/* auto-injected: ${f.path} */\n${f.content}</script>`,
      )
      .join("\n");
    if (injectedJs) {
      if (html.includes("</body>")) {
        html = html.replace("</body>", `${injectedJs}\n</body>`);
      } else {
        html = `${html}\n${injectedJs}`;
      }
    }

    // ─── Inject console interceptor + error overlay ─────────────────────
    const consoleInterceptor = `
      <script>
        (function() {
          // ── Console interceptor ──
          const originalConsole = {};
          ['log', 'error', 'warn', 'info'].forEach(method => {
            originalConsole[method] = console[method];
            console[method] = function(...args) {
              originalConsole[method].apply(console, args);
              window.parent.postMessage({
                type: 'console',
                method: method,
                content: args.map(a => {
                  try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
                  catch(e) { return String(a); }
                }).join(' ')
              }, '*');
            };
          });

          // ── Error overlay ──
          function showErrorOverlay(msg, source, line) {
            let overlay = document.getElementById('__codeforge_error_overlay');
            if (!overlay) {
              overlay = document.createElement('div');
              overlay.id = '__codeforge_error_overlay';
              overlay.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(220,38,38,0.95);color:#fff;font-family:monospace;font-size:12px;padding:12px 16px;z-index:99999;max-height:40%;overflow-y:auto;backdrop-filter:blur(4px);border-top:2px solid #ef4444;';
              const closeBtn = document.createElement('button');
              closeBtn.textContent = '✕';
              closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:none;border:none;color:#fff;font-size:16px;cursor:pointer;';
              closeBtn.onclick = () => overlay.remove();
              overlay.appendChild(closeBtn);
              document.body.appendChild(overlay);
            }
            const entry = document.createElement('div');
            entry.style.cssText = 'margin-top:4px;padding:4px 0;border-top:1px solid rgba(255,255,255,0.2);';
            entry.innerHTML = '<strong>Error:</strong> ' + msg + (source ? '<br><span style="opacity:0.7">' + source + (line ? ':' + line : '') + '</span>' : '');
            overlay.appendChild(entry);
          }

          window.onerror = function(msg, url, line, col, error) {
            showErrorOverlay(msg, url, line);
            window.parent.postMessage({
              type: 'console',
              method: 'error',
              content: msg + ' (line ' + line + ')'
            }, '*');
          };

          window.addEventListener('unhandledrejection', function(event) {
            const msg = event.reason ? (event.reason.message || String(event.reason)) : 'Unhandled promise rejection';
            showErrorOverlay(msg, '', '');
            window.parent.postMessage({
              type: 'console',
              method: 'error',
              content: 'Unhandled rejection: ' + msg
            }, '*');
          });
        })();
      </script>
    `;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${consoleInterceptor}`);
    } else {
      html = `${consoleInterceptor}\n${html}`;
    }

    return html;
  }, [files]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "console") {
        setConsoleMessages(prev => [
          ...prev.slice(-100), // Keep last 100 messages
          {
            type: event.data.method,
            content: event.data.content,
            timestamp: Date.now(),
          },
        ]);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const refresh = useCallback(() => {
    setConsoleMessages([]);
    setRefreshKey(k => k + 1);
  }, []);

  // Auto-refresh on file changes
  useEffect(() => {
    if (autoRefresh) {
      refresh();
    }
  }, [autoRefresh, refresh]);

  const previewContent = buildPreviewContent();

  const openInNewTab = () => {
    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(previewContent);
      newWindow.document.close();
    }
  };

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cn(
              "px-2 py-0.5 text-[10px] rounded",
              autoRefresh
                ? "bg-primary/20 text-primary"
                : "bg-[oklch(0.18_0.02_260)] text-muted-foreground",
            )}
            onClick={onToggleAutoRefresh}
            title="Auto-refresh on save"
          >
            AUTO
          </button>
          <button
            type="button"
            className="p-1 hover:bg-[oklch(0.20_0.02_260)] rounded"
            onClick={refresh}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="p-1 hover:bg-[oklch(0.20_0.02_260)] rounded"
            onClick={openInNewTab}
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="p-1 hover:bg-[oklch(0.20_0.02_260)] rounded relative"
            onClick={() => setShowConsole(!showConsole)}
            title="Toggle console"
          >
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            {consoleMessages.some(m => m.type === "error") && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-destructive rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 relative">
        <iframe
          key={refreshKey}
          ref={iframeRef}
          srcDoc={previewContent}
          className="sandbox-frame absolute inset-0"
          sandbox="allow-scripts allow-modals"
          title="Live Preview"
        />
      </div>

      {/* Console */}
      {showConsole && (
        <div className="border-t border-border bg-[oklch(0.09_0.02_260)]">
          <div className="flex items-center justify-between px-3 py-1 border-b border-border">
            <div className="flex items-center gap-2">
              <Terminal className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Console
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                ({consoleMessages.length})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground px-1"
                onClick={() => setConsoleMessages([])}
              >
                Clear
              </button>
              <button
                type="button"
                className="p-0.5 hover:bg-[oklch(0.16_0.02_260)] rounded"
                onClick={() => setShowConsole(false)}
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          </div>
          <div className="max-h-32 overflow-y-auto font-mono text-xs p-2 space-y-0.5">
            {consoleMessages.length === 0 && (
              <div className="text-muted-foreground/40 text-center py-2">
                No console output
              </div>
            )}
            {consoleMessages.map((msg, i) => (
              <div
                key={`${msg.timestamp}-${i}`}
                className={cn(
                  "px-1 py-0.5 rounded",
                  msg.type === "error" && "text-red-400 bg-red-500/5",
                  msg.type === "warn" && "text-yellow-400 bg-yellow-500/5",
                  msg.type === "info" && "text-blue-400",
                  msg.type === "log" && "text-foreground/80",
                )}
              >
                <span className="text-muted-foreground/40 mr-2">
                  {msg.type === "error" ? "✕" : msg.type === "warn" ? "⚠" : "›"}
                </span>
                {msg.content}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
