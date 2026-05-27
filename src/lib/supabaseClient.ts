"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SESSION_PLAYER_ID_KEY = "amg.session.playerId";
const LOCAL_PLAYER_ID_KEY = "amg.playerId";

function getStoredPlayerId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(SESSION_PLAYER_ID_KEY) ?? window.localStorage.getItem(LOCAL_PLAYER_ID_KEY);
}

function getPlayerContextHeaders(): Record<string, string> {
  const playerId = getStoredPlayerId();
  return playerId ? { "x-player-id": playerId } : {};
}

export function assertSupabaseEnv() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("缺少 Supabase 环境变量，请先配置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY。");
  }
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    global: {
      headers: getPlayerContextHeaders(),
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers);
        const playerId = getStoredPlayerId();

        if (playerId) {
          headers.set("x-player-id", playerId);
        }

        return fetch(input, {
          ...init,
          headers,
        });
      },
    },
  },
);

export function setSupabasePlayerContext(playerId: string) {
  const headers = { ...getPlayerContextHeaders(), "x-player-id": playerId };
  const realtime = supabase.realtime as typeof supabase.realtime & { headers?: Record<string, string> };

  realtime.headers = {
    ...(realtime.headers ?? {}),
    ...headers,
  };
}

export function getSupabasePublicConfig() {
  assertSupabaseEnv();

  return {
    supabaseUrl: supabaseUrl as string,
    supabaseAnonKey: supabaseAnonKey as string,
  };
}
