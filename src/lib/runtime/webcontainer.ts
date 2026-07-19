/**
 * WebContainerRuntime — runs a Node/Vite project entirely in the browser via
 * StackBlitz WebContainers. Real `npm install`, a real dev server, hot reload
 * — all on the user's own machine, so it costs us nothing per session.
 *
 * Notes:
 *  - WebContainer.boot() may only be called once per page, so the instance is
 *    a module-level singleton reused across project switches.
 *  - Requires cross-origin isolation (COOP/COEP headers). `crossOriginIsolated`
 *    is checked up front so we can show a clear error instead of a cryptic one.
 *  - @webcontainer/api is dynamically imported so its weight only loads for
 *    Node projects, keeping the static-preview path lean.
 */

import type { FileSystemTree, WebContainer } from "@webcontainer/api";
import {
  pickDevScript,
  type RuntimeFile,
  type RuntimeProvider,
  type RuntimeStartOptions,
} from "./types";

// One booted container per page (WebContainers hard requirement).
let booted: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

async function getContainer(): Promise<WebContainer> {
  if (booted) return booted;
  if (bootPromise) return bootPromise;
  const { WebContainer: WC } = await import("@webcontainer/api");
  bootPromise = WC.boot().then(instance => {
    booted = instance;
    return instance;
  });
  return bootPromise;
}

/** Convert a flat [{path, content}] list into a nested FileSystemTree. */
function toFileSystemTree(files: RuntimeFile[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const file of files) {
    const parts = file.path.replace(/^\.?\//, "").split("/");
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        cursor[part] = { file: { contents: file.content } };
      } else {
        const existing = cursor[part];
        if (existing && "directory" in existing) {
          cursor = existing.directory;
        } else {
          const dir: FileSystemTree = {};
          cursor[part] = { directory: dir };
          cursor = dir;
        }
      }
    }
  }
  return root;
}

// Strips ANSI escape/control sequences (cursor moves, line clears, color
// codes) from process output before it's shown in the plain-text build-log
// panel. Without this, npm's interactive spinner (`\x1b[1G\x1b[0K\|/-`
// repeated in place) renders as literal garbage text that never looks like
// it's progressing, even when npm is working fine — the log view has no
// terminal emulator to interpret those codes, so it must not print them raw.
const ANSI_PATTERN = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function pumpOutput(
  stream: ReadableStream<string>,
  onLog: (line: string) => void,
): void {
  const reader = stream.getReader();
  const read = (): void => {
    reader
      .read()
      .then(({ done, value }) => {
        if (done) return;
        if (value) {
          const cleaned = stripAnsi(value);
          if (cleaned) onLog(cleaned);
        }
        read();
      })
      .catch(() => {
        // Stream closed — process exited; nothing more to pump.
      });
  };
  read();
}

export class WebContainerRuntime implements RuntimeProvider {
  readonly kind = "webcontainer";
  private container: WebContainer | null = null;
  private serverReadyUnsub: (() => void) | null = null;

  async start(
    files: RuntimeFile[],
    { onLog, onStatus }: RuntimeStartOptions,
  ): Promise<void> {
    if (typeof window !== "undefined" && !window.crossOriginIsolated) {
      onStatus({
        phase: "error",
        message:
          "Live build sandbox needs cross-origin isolation (COOP/COEP " +
          "headers). Enable them on this site to run framework apps.",
      });
      return;
    }

    try {
      onStatus({ phase: "booting", message: "Starting sandbox…" });
      const container = await getContainer();
      this.container = container;

      await container.mount(toFileSystemTree(files));

      // server-ready fires when the dev server starts listening.
      this.serverReadyUnsub?.();
      this.serverReadyUnsub = container.on("server-ready", (_port, url) => {
        onStatus({ phase: "ready", url, message: "Preview ready" });
      });

      onStatus({ phase: "installing", message: "Installing dependencies…" });
      // Reverted --no-progress/--loglevel flags added 2026-07-19 (5b36058) —
      // suspected of causing npm to hang/error in the WebContainer runtime
      // (reported: install got stuck with zero log output at all, worse than
      // the pre-fix ANSI-garbage state). Back to plain `npm install`; the
      // ANSI-stripping in pumpOutput() below is the safe, tested part of
      // that fix and stays.
      const install = await container.spawn("npm", ["install"]);
      pumpOutput(install.output, onLog);
      const installCode = await install.exit;
      if (installCode !== 0) {
        onStatus({
          phase: "error",
          message: `npm install failed (exit ${installCode})`,
        });
        return;
      }

      const pkg = files.find(
        f => f.path.replace(/^\.?\//, "") === "package.json",
      );
      const script = pickDevScript(pkg?.content);

      onStatus({ phase: "starting", message: `Running npm run ${script}…` });
      const dev = await container.spawn("npm", ["run", script]);
      pumpOutput(dev.output, onLog);
      // Intentionally not awaiting dev.exit — the dev server runs until
      // teardown. Readiness is signalled by the server-ready event above.
    } catch (err) {
      onStatus({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async updateFiles(files: RuntimeFile[]): Promise<void> {
    if (!this.container) return;
    // Re-mounting the tree updates changed files; the dev server's watcher
    // picks them up and hot-reloads.
    await this.container.mount(toFileSystemTree(files));
  }

  async teardown(): Promise<void> {
    this.serverReadyUnsub?.();
    this.serverReadyUnsub = null;
    this.container = null;
    // The booted WebContainer instance is intentionally kept alive for reuse
    // (boot can only happen once per page).
  }
}

/**
 * A live, bidirectional shell session — the terminal-tab counterpart to the
 * read-only build-log stream above. Backed by the WebContainer's `jsh`
 * (a small POSIX-ish shell bundled with the container image).
 */
export interface InteractiveShell {
  /** Stream of raw terminal output (already ANSI-escaped by jsh). */
  output: ReadableStream<string>;
  /** Send raw keystrokes/input to the shell. */
  write(data: string): void;
  /** Notify the shell of a terminal resize (keeps line-wrapping correct). */
  resize(cols: number, rows: number): void;
  /** Terminate the shell process. */
  kill(): void;
}

/**
 * Open an interactive shell in the (singleton) booted WebContainer. Safe to
 * call independently of `WebContainerRuntime.start` — boots the container on
 * first use if nothing has booted it yet, so the terminal works even before
 * a project's dev server has been started.
 */
export async function openInteractiveShell(
  cols: number,
  rows: number,
): Promise<InteractiveShell> {
  const container = await getContainer();
  const proc = await container.spawn("jsh", {
    terminal: { cols, rows },
  });
  const writer = proc.input.getWriter();
  return {
    output: proc.output,
    write: data => {
      void writer.write(data);
    },
    resize: (c, r) => proc.resize({ cols: c, rows: r }),
    kill: () => {
      proc.kill();
      writer.releaseLock();
    },
  };
}
