/**
 * InteractiveTerminal — a real, typeable shell inside the IDE, backed by the
 * same WebContainer instance the live preview runs in. This closes the
 * biggest remaining gap vs. Replit: the existing "Build Logs" panel only
 * ever showed passive npm/dev-server output; this lets the user actually run
 * arbitrary commands (ls, npm install <pkg>, git status, cat, etc.) the same
 * way they would in a real terminal tab.
 *
 * xterm.js + its fit addon are dynamically imported so their weight (~230KB)
 * only loads when the user opens this tab, not on the base IDE bundle.
 */

import { useEffect, useRef, useState } from "react";
import { openInteractiveShell, type InteractiveShell } from "@/lib/runtime/webcontainer";

export function InteractiveTerminal({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<InteractiveShell | null>(null);
  const disposedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    disposedRef.current = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;

    (async () => {
      try {
        const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        await import("@xterm/xterm/css/xterm.css");

        if (disposedRef.current || !containerRef.current) return;

        term = new XTerm({
          convertEol: true,
          fontSize: 12,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          theme: {
            background: "#00000000",
            foreground: "#d4d4d8",
          },
          cursorBlink: true,
        });
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();

        const shell = await openInteractiveShell(term.cols, term.rows);
        if (disposedRef.current) {
          shell.kill();
          return;
        }
        shellRef.current = shell;

        const reader = shell.output.getReader();
        const pump = (): void => {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) return;
              if (value) term?.write(value);
              pump();
            })
            .catch(() => {
              // stream closed — shell exited
            });
        };
        pump();

        term.onData(data => shellRef.current?.write(data));

        resizeObserver = new ResizeObserver(() => {
          if (!fitAddon || !term) return;
          fitAddon.fit();
          shellRef.current?.resize(term.cols, term.rows);
        });
        resizeObserver.observe(containerRef.current);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposedRef.current = true;
      resizeObserver?.disconnect();
      shellRef.current?.kill();
      shellRef.current = null;
      term?.dispose();
    };
  }, [active]);

  if (!active) return null;

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-xs text-destructive text-center">
          Couldn't start the terminal: {error}
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full px-2 py-1" />;
}
