import * as gameService from "./gameService";

export interface Env {
  DB: D1Database;
  ROOM_OBJECTS: DurableObjectNamespace;
  ALLOWED_ORIGIN?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  CLOUDINARY_FOLDER?: string;
  NEXT_PUBLIC_CLOUDINARY_FOLDER?: string;
  CLOUDINARY_EXISTING_IMAGE_LIMIT?: string;
}

type RpcBody = {
  name?: string;
  args?: unknown[];
  clientActionId?: string;
};

type BroadcastMessage = {
  type: "change";
  name: string;
  result: unknown;
  args: unknown[];
  topics: string[];
};

type CloudinaryResource = {
  public_id: string;
  secure_url: string;
  width?: number;
  height?: number;
  created_at?: string;
};

const ACTION_RESULT_TTL_MS = 10_000;

const MUTATION_NAMES = new Set([
  "createRoom",
  "joinRoom",
  "leaveRoom",
  "dissolveRoom",
  "selectPresenterForRound",
  "cancelCurrentRound",
  "createUploadedQuestionSet",
  "createQuestionSetFromUrlText",
  "prepareQuestionSetForStart",
  "startGameWithQuestionSet",
  "confirmRevealBlocks",
  "submitAnswer",
  "submitBuzzerAnswer",
  "judgeBuzzerAnswer",
  "settleBuzzerRound",
  "submitTeamBattleRevealVote",
  "submitTeamBattleGuessVote",
  "finalizeTeamBattleVote",
  "judgeTeamBattleGuess",
  "revealTeamBattleAnswer",
  "gradeAnswersAndAdvance",
  "advanceReviewedQuestion",
  "publishQuestionSetToCommunity",
  "rateCommunityQuestionSet",
  "updateQuestionLabel",
  "skipCurrentQuestion",
  "endCurrentGameEarly",
  "returnRoomToLobby",
]);

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigins = (env.ALLOWED_ORIGIN ?? "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowedOrigins.includes("*") || allowedOrigins.includes(origin) ? origin || "*" : allowedOrigins[0] ?? "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, init: ResponseInit = {}, request: Request, env: Env) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
      ...init.headers,
    },
  });
}

function errorResponse(error: unknown, request: Request, env: Env) {
  const message = error instanceof Error ? error.message : "Unknown Worker error.";
  return json({ error: message }, { status: 400 }, request, env);
}

function getExportedFunction(name: string) {
  const fn = (gameService as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") {
    throw new Error(`Unknown game RPC: ${name}`);
  }
  return fn as (...args: unknown[]) => Promise<unknown>;
}

function getRoomObject(env: Env, topic: string) {
  return env.ROOM_OBJECTS.get(env.ROOM_OBJECTS.idFromName(topic));
}

async function callGameFunction(env: Env, name: string, args: unknown[]) {
  gameService.bindGameDatabase(env.DB);
  return await getExportedFunction(name)(...(args ?? []));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addTopic(topics: Set<string>, prefix: string, value: unknown) {
  if (typeof value === "string" && value.trim()) {
    topics.add(`${prefix}:${value}`);
  }
}

function deriveTopics(name: string, args: unknown[], result: unknown) {
  const topics = new Set<string>();
  const first = args[0];

  if (typeof first === "string") {
    if (name.includes("Room") || name.includes("Presenter") || name.includes("Round")) {
      addTopic(topics, "room", first);
    }
    if (name.includes("GameSession")) {
      addTopic(topics, "game", first);
    }
  }

  if (isRecord(first)) {
    addTopic(topics, "room", first.roomId);
    addTopic(topics, "game", first.gameSessionId);
    addTopic(topics, "question-set", first.questionSetId);
  }

  if (isRecord(result)) {
    const room = result.room;
    const gameSession = result.gameSession;
    if (isRecord(room)) {
      addTopic(topics, "room", room.id);
      addTopic(topics, "room-code", room.code);
      addTopic(topics, "game", room.currentGameId);
    }
    if (isRecord(gameSession)) {
      addTopic(topics, "game", gameSession.id);
      addTopic(topics, "room", gameSession.roomId);
      addTopic(topics, "question-set", gameSession.questionSetId);
    }
    addTopic(topics, "question-set", result.questionSetId);
    addTopic(topics, "game", result.gameSessionId);
  }

  if (name === "joinRoom" && typeof first === "string") {
    addTopic(topics, "room-code", first.toUpperCase());
  }

  return Array.from(topics);
}

async function broadcast(env: Env, message: BroadcastMessage) {
  await Promise.all(
    message.topics.map((topic) =>
      getRoomObject(env, topic).fetch("https://room-object/broadcast", {
        method: "POST",
        body: JSON.stringify(message),
      }),
    ),
  );
}

async function handleRpc(request: Request, env: Env) {
  const body = (await request.json()) as RpcBody;
  const name = body.name ?? "";
  const args = body.args ?? [];
  const result = await callGameFunction(env, name, args);

  if (MUTATION_NAMES.has(name)) {
    const topics = deriveTopics(name, args, result);
    if (topics.length > 0) {
      await broadcast(env, { type: "change", name, result, args, topics });
    }
  }

  return json({ data: result }, {}, request, env);
}

async function handleCloudinaryImages(request: Request, env: Env) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME ?? env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  const folder = env.CLOUDINARY_FOLDER ?? env.NEXT_PUBLIC_CLOUDINARY_FOLDER ?? "";
  const limit = Math.max(1, Math.min(100, Number(env.CLOUDINARY_EXISTING_IMAGE_LIMIT ?? 50)));

  if (!cloudName || !apiKey || !apiSecret) {
    return json(
      {
        error:
          "Missing Cloudinary Worker configuration: CLOUDINARY_CLOUD_NAME/NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET.",
      },
      { status: 500 },
      request,
      env,
    );
  }

  const url = new URL(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/image/upload`);
  url.searchParams.set("max_results", String(limit));

  if (folder) {
    url.searchParams.set("prefix", folder.endsWith("/") ? folder : `${folder}/`);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
    },
  });

  const data = (await response.json().catch(() => ({}))) as {
    resources?: CloudinaryResource[];
    error?: { message?: string };
  };

  if (!response.ok) {
    return json({ error: data.error?.message ?? `Cloudinary HTTP ${response.status}` }, { status: response.status }, request, env);
  }

  const images = (data.resources ?? []).map((resource) => ({
    publicId: resource.public_id,
    url: resource.secure_url,
    originalUrl: resource.secure_url,
    width: resource.width ?? null,
    height: resource.height ?? null,
    createdAt: resource.created_at ?? null,
  }));

  return json({ images, folder, limit }, {}, request, env);
}

export class RoomDurableObject {
  private readonly recentActions = new Map<string, { expiresAt: number; result: unknown }>();

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "connected", topic: url.searchParams.get("topic") ?? "" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const message = await request.text();
      this.broadcast(message);
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let clientActionId: string | undefined;
    try {
      const payload = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as {
        type?: string;
        name?: string;
        args?: unknown[];
        clientActionId?: string;
      };
      clientActionId = payload.clientActionId;

      if (payload.type !== "action" || !payload.name) {
        socket.send(JSON.stringify({ type: "error", error: "Invalid WebSocket action." }));
        return;
      }

      const actionKey = payload.clientActionId ? `${payload.name}:${payload.clientActionId}` : "";
      const cached = actionKey ? this.recentActions.get(actionKey) : null;
      if (cached && cached.expiresAt > Date.now()) {
        socket.send(JSON.stringify({ type: "action_result", clientActionId: payload.clientActionId, data: cached.result }));
        return;
      }

      const result = await callGameFunction(this.env, payload.name, payload.args ?? []);
      if (actionKey) {
        this.recentActions.set(actionKey, { expiresAt: Date.now() + ACTION_RESULT_TTL_MS, result });
      }

      const topics = deriveTopics(payload.name, payload.args ?? [], result);
      if (topics.length > 0) {
        await broadcast(this.env, { type: "change", name: payload.name, result, args: payload.args ?? [], topics });
      }

      socket.send(JSON.stringify({ type: "action_result", clientActionId: payload.clientActionId, data: result }));
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "action_result",
          clientActionId,
          error: error instanceof Error ? error.message : "WebSocket action failed.",
        }),
      );
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.recentActions.entries()) {
      if (entry.expiresAt <= now) {
        this.recentActions.delete(key);
      }
    }
  }

  private broadcast(message: string) {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "Broadcast failed.");
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (url.pathname === "/api/rpc" && request.method === "POST") {
        return await handleRpc(request, env);
      }

      if (url.pathname === "/api/cloudinary-images" && request.method === "GET") {
        return await handleCloudinaryImages(request, env);
      }

      const realtimeMatch = url.pathname.match(/^\/api\/realtime\/(.+)\/ws$/);
      if (realtimeMatch && request.headers.get("upgrade") === "websocket") {
        const topic = decodeURIComponent(realtimeMatch[1]);
        return getRoomObject(env, topic).fetch(new Request(`https://room-object/ws?topic=${encodeURIComponent(topic)}`, request));
      }

      return json({ error: "Not found" }, { status: 404 }, request, env);
    } catch (error) {
      return errorResponse(error, request, env);
    }
  },
};
