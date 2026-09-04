import type { WebSocket } from "ws";
import { canAccessProject } from "./access.js";
import { createListener, one, sql } from "./db.js";

interface SocketState {
  userId: string;
  projects: Set<string>;
}

const sockets = new Map<WebSocket, SocketState>();

function broadcast(event: {
  type: string;
  projectId: string;
  entity?: string;
  id?: string;
}): void {
  const encoded = JSON.stringify(event);

  for (const [socket, state] of sockets) {
    if (
      state.projects.has(event.projectId) &&
      socket.readyState === 1
    ) {
      socket.send(encoded);
    }
  }
}

export async function startRealtimeListener(): Promise<void> {
  const listener = await createListener();
  await listener.query("listen codeforge_events");

  listener.on("notification", (notification) => {
    if (!notification.payload) {
      return;
    }

    try {
      broadcast(JSON.parse(notification.payload));
    } catch (error) {
      console.error("realtime.invalid_notification", error);
    }
  });

  listener.on("error", (error) => {
    console.error("realtime.listener_error", error);
  });
}

export async function notifyProject(input: {
  type: string;
  projectId: string;
  entity?: string;
  id?: string;
}): Promise<void> {
  const payload = JSON.stringify(input);

  if (Buffer.byteLength(payload, "utf8") >= 7900) {
    throw new Error("Realtime notification exceeds PostgreSQL NOTIFY limit");
  }

  await sql("select pg_notify('codeforge_events', $1)", [payload]);
}

export async function createRealtimeTicket(userId: string): Promise<string> {
  const result = await sql(
    `insert into realtime_tickets(user_id, expires_at)
     values($1, now() + interval '60 seconds')
     returning id`,
    [userId],
  );

  return String(one(result).id);
}

export async function consumeRealtimeTicket(
  ticket: string,
): Promise<string | null> {
  const result = await sql(
    `update realtime_tickets
     set used_at = now()
     where id = $1::uuid
       and used_at is null
       and expires_at > now()
     returning user_id`,
    [ticket],
  );

  if (result.rowCount === 1 && result.rows[0]) {
    return String(result.rows[0].user_id);
  }
  return null;
}

export function attachSocket(socket: WebSocket, userId: string): void {
  sockets.set(socket, {
    userId,
    projects: new Set(),
  });

  socket.on("message", (buffer) => {
    void handleSocketMessage(socket, buffer.toString());
  });

  socket.on("close", () => {
    sockets.delete(socket);
  });

  socket.on("error", () => {
    sockets.delete(socket);
  });
}

async function handleSocketMessage(
  socket: WebSocket,
  raw: string,
): Promise<void> {
  const state = sockets.get(socket);

  if (!state) {
    return;
  }

  let message: {
    type?: string;
    projectId?: string;
  };

  try {
    message = JSON.parse(raw);
  } catch {
    socket.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
    return;
  }

  if (message.type === "ping") {
    socket.send(JSON.stringify({ type: "pong" }));
    return;
  }

  if (message.type === "unsubscribe" && message.projectId) {
    state.projects.delete(message.projectId);
    return;
  }

  if (message.type === "subscribe" && message.projectId) {
    if (await canAccessProject(state.userId, message.projectId)) {
      state.projects.add(message.projectId);
      socket.send(
        JSON.stringify({
          type: "subscribed",
          projectId: message.projectId,
        }),
      );
      return;
    }

    socket.send(
      JSON.stringify({
        type: "error",
        error: "Project access denied",
        projectId: message.projectId,
      }),
    );
  }
}
