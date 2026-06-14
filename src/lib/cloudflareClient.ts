"use client";

import type { RoundSnapshot } from "@/types/game";
import type { RealtimeDelta } from "@/types/game";

type ChangeMessage = {
  type: "change";
  name: string;
  result: unknown;
  args: unknown[];
  topic: string;
  clientActionId?: string;
  delta?: RealtimeDelta;
  deltas?: RealtimeDelta[];
  roundSnapshot?: RoundSnapshot;
};

type ActionResultMessage = {
  type: "action_result";
  clientActionId?: string;
  data?: unknown;
  error?: string;
};

type TopicState = {
  socket: WebSocket | null;
  listeners: Set<(message: ChangeMessage) => void>;
  pending: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>;
  reconnectTimer: number | null;
};

const ACTION_TIMEOUT_MS = 4000;
const RECONNECT_DELAY_MS = 500;
const ROOM_TOPIC_PREFIX = "room:";

const MUTATION_NAMES = new Set([
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
  "submitForfeitAnswer",
  "cancelForfeitAnswer",
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

const topicStates = new Map<string, TopicState>();

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
}

function apiUrl(path: string) {
  return `${apiBase()}${path}`;
}

function wsUrl(path: string) {
  const base = apiBase();
  const url = new URL(path, base || window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferActionTopic(name: string, args: unknown[]) {
  const first = args[0];

  if (typeof first === "string" && (name.includes("Room") || name.includes("Presenter") || name.includes("Round"))) {
    const roomTopic = `${ROOM_TOPIC_PREFIX}${first}`;
    if (topicStates.has(roomTopic)) {
      return roomTopic;
    }
  }

  if (isRecord(first)) {
    if (typeof first.roomId === "string" && first.roomId.trim()) {
      const roomTopic = `${ROOM_TOPIC_PREFIX}${first.roomId}`;
      if (topicStates.has(roomTopic)) {
        return roomTopic;
      }
    }
  }

  return Array.from(topicStates.keys()).find((topic) => topic.startsWith(ROOM_TOPIC_PREFIX)) ?? null;
}

function getTopicState(topic: string) {
  let state = topicStates.get(topic);
  if (!state) {
    state = { socket: null, listeners: new Set(), pending: new Map(), reconnectTimer: null };
    topicStates.set(topic, state);
  }
  return state;
}

function scheduleReconnect(topic: string, state: TopicState) {
  if (state.listeners.size === 0 || state.reconnectTimer !== null) {
    return;
  }

  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = null;
    if (state.listeners.size > 0) {
      ensureSocket(topic);
    }
  }, RECONNECT_DELAY_MS);
}

function ensureSocket(topic: string) {
  const state = getTopicState(topic);

  if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
    return state.socket;
  }

  if (state.reconnectTimer !== null) {
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  const socket = new WebSocket(wsUrl(`/api/realtime/${encodeURIComponent(topic)}/ws`));
  state.socket = socket;

  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as ChangeMessage | ActionResultMessage | { type?: string };

    if (message.type === "action_result") {
      const result = message as ActionResultMessage;
      const pending = result.clientActionId ? state.pending.get(result.clientActionId) : null;
      if (pending) {
        window.clearTimeout(pending.timer);
        state.pending.delete(result.clientActionId ?? "");
        if (result.error) {
          pending.reject(new Error(result.error));
        } else {
          pending.resolve(result.data);
        }
      }
      return;
    }

    if (message.type === "change") {
      for (const listener of state.listeners) {
        listener(message as ChangeMessage);
      }
    }
  };

  socket.onclose = () => {
    if (state.socket !== socket) {
      return;
    }

    for (const pending of state.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("实时连接已断开，本次操作没有完成。请重试。"));
    }
    state.pending.clear();
    state.socket = null;
    scheduleReconnect(topic, state);
  };

  return socket;
}

function waitForSocketOpen(topic: string, socket: WebSocket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve(socket);
  }

  if (socket.readyState !== WebSocket.CONNECTING) {
    return Promise.reject(new Error("实时连接不可用，请稍后重试。"));
  }

  return new Promise<WebSocket>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      reject(new Error("实时连接未就绪，请稍后重试。"));
    }, ACTION_TIMEOUT_MS);

    function handleOpen() {
      window.clearTimeout(timer);
      socket.removeEventListener("close", handleClose);
      resolve(socket);
    }

    function handleClose() {
      window.clearTimeout(timer);
      socket.removeEventListener("open", handleOpen);
      reject(new Error("实时连接已断开，请重试。"));
    }

    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("close", handleClose, { once: true });
    ensureSocket(topic);
  });
}

async function httpRpc<T>(name: string, args: unknown[]) {
  const response = await fetch(apiUrl("/api/rpc"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const payload = (await response.json()) as { data?: T; error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? "请求游戏服务失败，请稍后重试。");
  }
  return payload.data as T;
}

async function wsAction<T>(topic: string, name: string, args: unknown[]) {
  const state = getTopicState(topic);
  const socket = await waitForSocketOpen(topic, ensureSocket(topic));

  const clientActionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const promise = new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      state.pending.delete(clientActionId);
      reject(new Error("实时操作响应超时，请检查网络后重试。"));
    }, ACTION_TIMEOUT_MS);

    state.pending.set(clientActionId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });
  });

  socket.send(JSON.stringify({ type: "action", name, args, clientActionId }));
  return promise;
}

export async function callGameRpc<T>(name: string, args: unknown[] = []) {
  if (MUTATION_NAMES.has(name)) {
    const topic = inferActionTopic(name, args);
    if (topic) {
      return await wsAction<T>(topic, name, args);
    }
  }

  return httpRpc<T>(name, args);
}

export function subscribeRealtimeTopic(topic: string, listener: (message: ChangeMessage) => void) {
  const state = getTopicState(topic);
  state.listeners.add(listener);
  ensureSocket(topic);

  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.pending.size === 0) {
      if (state.reconnectTimer !== null) {
        window.clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      state.socket?.close(1000, "No listeners.");
      state.socket = null;
    }
  };
}
