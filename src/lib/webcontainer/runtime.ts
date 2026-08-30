import { WebContainer } from "@webcontainer/api";

export interface ExecutionOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export class HardenedWebContainerRuntime {
  private static instance: WebContainer | null = null;
  private static bootPromise: Promise<WebContainer> | null = null;
  private static readonly DEFAULT_TIMEOUT_MS = 60000; // 60s default timeout

  public static isCrossOriginIsolated(): boolean {
    return typeof window !== "undefined" && Boolean(window.crossOriginIsolated);
  }

  public static async getInstance(): Promise<WebContainer> {
    if (this.instance) return this.instance;
    if (this.bootPromise) return this.bootPromise;

    if (!this.isCrossOriginIsolated()) {
      throw new Error(
        "WebContainer requires Cross-Origin-Opener-Policy (same-origin) and Cross-Origin-Embedder-Policy (credentialless/require-corp) headers."
      );
    }

    this.bootPromise = WebContainer.boot()
      .then(container => {
        this.instance = container;
        return container;
      })
      .catch(err => {
        this.bootPromise = null;
        throw new Error(`Failed to initialize WebContainer: ${err instanceof Error ? err.message : String(err)}`);
      });

    return this.bootPromise;
  }

  public static async executeCommand(
    command: string,
    args: string[] = [],
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const container = await this.getInstance();
    const timeoutMs = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Sanitize environment variables to avoid leaking browser tokens
    const safeEnv = {
      NODE_ENV: "development",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      ...options.env,
    };

    const process = await container.spawn(command, args, {
      env: safeEnv,
    });

    const stdoutStream = process.output.pipeTo(
      new WritableStream({
        write(chunk) {
          stdout += chunk;
          options.onStdout?.(chunk);
        },
      })
    );

    const timeoutPromise = new Promise<number>((_, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill();
        } catch {
          // Process might already be terminating
        }
        reject(new Error(`Command '${command} ${args.join(" ")}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      process.exit.then(() => clearTimeout(timer));
    });

    try {
      const exitCode = await Promise.race([process.exit, timeoutPromise]);
      await stdoutStream.catch(() => {});
      return {
        exitCode,
        stdout,
        stderr,
        timedOut: false,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        exitCode: -1,
        stdout,
        stderr: stderr || (err instanceof Error ? err.message : String(err)),
        timedOut,
        durationMs: Date.now() - startTime,
      };
    }
  }

  public static async teardown(): Promise<void> {
    if (this.instance) {
      try {
        await this.instance.teardown();
      } finally {
        this.instance = null;
        this.bootPromise = null;
      }
    }
  }
}
