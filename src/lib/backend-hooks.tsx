import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getRpcName } from "./backend-api";

interface BackendUser {
  id: string;
  name: string | null;
  image: string | null;
  email: string | null;
  onboarded: boolean;
  plan: string | null;
  subscriptionStatus: string | null;
  aiProfile: string | null;
}

interface BackendContextValue {
  accessToken: string | null;
  user: BackendUser | null;
  isLoading: boolean;
  signIn(
    provider: string,
    data?: FormData | Record<string, unknown>,
  ): Promise<{ signingIn: boolean }>;
  signOut(): Promise<void>;
  request<T>(
    path: string,
    init?: RequestInit,
    retry?: boolean,
  ): Promise<T>;
}

const BackendContext = createContext<BackendContextValue | null>(null);
const ACCESS_TOKEN_KEY = "codeforge_access_token";
const realtimeListeners = new Set<() => void>();

function toObject(
  data?: FormData | Record<string, unknown>,
): Record<string, unknown> {
  if (!data) {
    return {};
  }

  if (data instanceof FormData) {
    return Object.fromEntries(data.entries());
  }

  return data;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };

  if (!response.ok) {
    const error = new Error(body.error ?? `HTTP ${response.status}`);
    Object.assign(error, {
      status: response.status,
      code: body.code,
    });
    throw error;
  }

  return body as T;
}

export function BackendProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    localStorage.getItem(ACCESS_TOKEN_KEY),
  );
  const [user, setUser] = useState<BackendUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const tokenRef = useRef(accessToken);

  const updateToken = useCallback((token: string | null) => {
    tokenRef.current = token;
    setAccessToken(token);

    if (token) {
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      updateToken(null);
      setUser(null);
      return null;
    }

    const session = await parseResponse<{
      accessToken: string;
      user: BackendUser;
    }>(response);

    updateToken(session.accessToken);
    setUser(session.user);
    return session.accessToken;
  }, [updateToken]);

  const request = useCallback(
    async <T,>(
      path: string,
      init: RequestInit = {},
      retry = true,
    ): Promise<T> => {
      const headers = new Headers(init.headers);

      if (
        init.body &&
        typeof init.body === "string" &&
        !headers.has("content-type")
      ) {
        headers.set("content-type", "application/json");
      }

      if (tokenRef.current) {
        headers.set("authorization", `Bearer ${tokenRef.current}`);
      }

      const response = await fetch(path, {
        ...init,
        headers,
        credentials: "include",
      });

      if (response.status === 401 && retry) {
        const nextToken = await refresh();

        if (nextToken) {
          return request<T>(path, init, false);
        }
      }

      return parseResponse<T>(response);
    },
    [refresh],
  );

  useEffect(() => {
    void (async () => {
      try {
        if (!tokenRef.current) {
          await refresh();
          return;
        }

        const me = await request<BackendUser>("/api/auth/me", {}, false);
        setUser(me);
      } catch {
        await refresh();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refresh, request]);

  const signIn = useCallback(
    async (
      provider: string,
      rawData?: FormData | Record<string, unknown>,
    ) => {
      const data = toObject(rawData);

      if (provider === "github" || provider === "google") {
        throw new Error(
          `${provider} OAuth is temporarily disabled during the Convex cutover`,
        );
      }

      const flow = String(data.flow ?? "signIn");

      if (flow === "reset") {
        await request("/api/auth/password-reset/request", {
          method: "POST",
          body: JSON.stringify({
            email: data.email,
          }),
        });

        return {
          signingIn: false,
        };
      }

      if (flow === "reset-verification") {
        await request("/api/auth/password-reset/confirm", {
          method: "POST",
          body: JSON.stringify({
            email: data.email,
            code: data.code,
            newPassword: data.newPassword,
          }),
        });

        const session = await request<{
          accessToken: string;
          user: BackendUser;
        }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: data.email,
            password: data.newPassword,
          }),
        });

        updateToken(session.accessToken);
        setUser(session.user);

        return {
          signingIn: true,
        };
      }

      if (flow === "email-verification") {
        throw new Error(
          "Email verification is not required by the PostgreSQL auth backend",
        );
      }

      const endpoint =
        flow === "signUp" ? "/api/auth/register" : "/api/auth/login";

      const payload =
        flow === "signUp"
          ? {
              name: data.name,
              email: data.email,
              password: data.password,
            }
          : {
              email: data.email,
              password: data.password,
            };

      const session = await request<{
        accessToken: string;
        user: BackendUser;
      }>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      updateToken(session.accessToken);
      setUser(session.user);

      return {
        signingIn: true,
      };
    },
    [request, updateToken],
  );

  const signOut = useCallback(async () => {
    try {
      await request("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      updateToken(null);
      setUser(null);
    }
  }, [request, updateToken]);

  const value = useMemo(
    () => ({
      accessToken,
      user,
      isLoading,
      signIn,
      signOut,
      request,
    }),
    [accessToken, isLoading, request, signIn, signOut, user],
  );

  return (
    <BackendContext.Provider value={value}>
      {children}
    </BackendContext.Provider>
  );
}

function useBackend(): BackendContextValue {
  const context = useContext(BackendContext);

  if (!context) {
    throw new Error("BackendProvider is missing");
  }

  return context;
}

export function useConvexAuth() {
  const { user, isLoading } = useBackend();

  return {
    isAuthenticated: Boolean(user),
    isLoading,
  };
}

export function useAuthActions() {
  const { signIn, signOut } = useBackend();

  return {
    signIn,
    signOut,
  };
}

async function rpc<T>(
  request: BackendContextValue["request"],
  kind: "query" | "mutation" | "action",
  reference: unknown,
  args: Record<string, unknown> = {},
): Promise<T> {
  return request<T>("/api/rpc", {
    method: "POST",
    body: JSON.stringify({
      name: getRpcName(reference),
      args,
      kind,
    }),
  });
}

export function useQuery<T = any>(
  reference: unknown,
  args: Record<string, unknown> | "skip" = {},
): T | undefined {
  const { request, user } = useBackend();
  const [value, setValue] = useState<T | undefined>(undefined);
  const rpcName = getRpcName(reference);
  const isSkipped = args === "skip";
  const argsKey = isSkipped ? "{}" : JSON.stringify(args);
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (isSkipped) {
      return;
    }

    if (!userId) {
      if (rpcName === "auth.currentUser") {
        setValue(null as T);
      }
      return;
    }

    const next = await rpc<T>(
      request,
      "query",
      rpcName,
      JSON.parse(argsKey),
    );
    setValue(next);
  }, [argsKey, isSkipped, request, rpcName, userId]);

  useEffect(() => {
    void load();

    const listener = () => {
      void load();
    };

    realtimeListeners.add(listener);
    return () => {
      realtimeListeners.delete(listener);
    };
  }, [load]);

  return value;
}

type MutationFunction = ((args?: Record<string, unknown>) => Promise<any>) & {
  withOptimisticUpdate: (_update: unknown) => MutationFunction;
};

export function useMutation(reference: unknown): MutationFunction {
  const { request } = useBackend();
  const rpcName = getRpcName(reference);

  return useMemo(() => {
    const mutation = (async (
      args: Record<string, unknown> = {},
    ) => {
      const result = await rpc(request, "mutation", rpcName, args);
      realtimeListeners.forEach((listener) => listener());
      return result;
    }) as MutationFunction;

    mutation.withOptimisticUpdate = () => mutation;
    return mutation;
  }, [request, rpcName]);
}

export function useAction(reference: unknown) {
  const { request } = useBackend();
  const rpcName = getRpcName(reference);

  return useCallback(
    async (args: Record<string, unknown> = {}) =>
      rpc(request, "action", rpcName, args),
    [request, rpcName],
  );
}

export function useConvex() {
  const { request } = useBackend();

  return useMemo(
    () => ({
      query: (reference: unknown, args: Record<string, unknown> = {}) =>
        rpc(request, "query", reference, args),
      mutation: (
        reference: unknown,
        args: Record<string, unknown> = {},
      ) => rpc(request, "mutation", reference, args),
      action: (reference: unknown, args: Record<string, unknown> = {}) =>
        rpc(request, "action", reference, args),
    }),
    [request],
  );
}

export function useConvexConnectionState() {
  return {
    isWebSocketConnected: true,
    hasInflightRequests: false,
  };
}

export function useQueries(
  queries: Record<
    string,
    {
      query: unknown;
      args?: Record<string, unknown>;
    }
  >,
) {
  const { request, user } = useBackend();
  const [results, setResults] = useState<Record<string, unknown>>({});
  const serialized = JSON.stringify(
    Object.entries(queries).map(([key, query]) => ({
      key,
      name: getRpcName(query.query),
      args: query.args ?? {},
    })),
  );
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setResults({});
      return;
    }

    const descriptors = JSON.parse(serialized) as Array<{
      key: string;
      name: string;
      args: Record<string, unknown>;
    }>;

    void Promise.all(
      descriptors.map(async ({ key, name, args }) => [
        key,
        await rpc(request, "query", name, args),
      ]),
    ).then((entries) => {
      setResults(Object.fromEntries(entries));
    });
  }, [request, serialized, userId]);

  return results;
}

export function usePaginatedQuery<T = any>(
  reference: unknown,
  args: Record<string, unknown> | "skip",
  options: {
    initialNumItems: number;
  },
) {
  const result = useQuery<any>(
    reference,
    args === "skip"
      ? "skip"
      : {
          ...args,
          paginationOpts: {
            numItems: options.initialNumItems,
            cursor: null,
          },
        },
  );

  return {
    results: (result?.page ?? result ?? []) as T[],
    status: result === undefined ? "LoadingFirstPage" : "Exhausted",
    loadMore: () => undefined,
    isLoading: result === undefined,
  };
}

class RealtimeClient {
  private socket: WebSocket | null = null;
  private subscriptions = new Set<string>();
  private reconnectTimer: number | null = null;
  private closed = false;

  constructor(
    private readonly request: BackendContextValue["request"],
  ) {}

  async connect() {
    if (this.closed) {
      return;
    }

    if (
      this.socket &&
      [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)
    ) {
      return;
    }

    const { ticket } = await this.request<{ ticket: string }>(
      "/api/realtime/ticket",
      {
        method: "POST",
      },
    );

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(
      `${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`,
    );

    this.socket.addEventListener("open", () => {
      for (const projectId of this.subscriptions) {
        this.socket?.send(
          JSON.stringify({
            type: "subscribe",
            projectId,
          }),
        );
      }
    });

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));

      if (
        message.type !== "ready" &&
        message.type !== "subscribed" &&
        message.type !== "pong"
      ) {
        realtimeListeners.forEach((listener) => listener());
      }
    });

    this.socket.addEventListener("close", () => {
      this.socket = null;

      if (this.reconnectTimer !== null) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      if (!this.closed && this.subscriptions.size > 0) {
        this.reconnectTimer = window.setTimeout(() => {
          void this.connect();
        }, 1500);
      }
    });
  }

  subscribe(projectId: string) {
    this.closed = false;
    this.subscriptions.add(projectId);
    void this.connect();

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          type: "subscribe",
          projectId,
        }),
      );
    }

    return () => {
      this.subscriptions.delete(projectId);

      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({
            type: "unsubscribe",
            projectId,
          }),
        );
      }
    };
  }

  close() {
    this.closed = true;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    this.socket = null;
  }
}

export function useProjectRealtime(projectId?: string) {
  const { request, user } = useBackend();
  const client = useMemo(() => new RealtimeClient(request), [request]);

  useEffect(() => {
    if (!user || !projectId) {
      return;
    }

    const unsubscribe = client.subscribe(projectId);

    return () => {
      unsubscribe();
      client.close();
    };
  }, [client, projectId, user]);
}
