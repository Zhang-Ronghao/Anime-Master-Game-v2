"use client";

import { STORAGE_KEYS } from "@/lib/constants";
import { createPlayerId } from "@/lib/id";
import { setSupabasePlayerContext } from "@/lib/supabaseClient";
import type { LocalSession } from "@/types/game";

const SESSION_KEYS = {
  playerId: "amg.session.playerId",
  nickname: "amg.session.nickname",
  roomCode: "amg.session.roomCode",
  isHost: "amg.session.isHost",
} as const;

export function getOrCreatePlayerId() {
  const existing = sessionStorage.getItem(SESSION_KEYS.playerId) ?? localStorage.getItem(STORAGE_KEYS.playerId);

  if (existing) {
    sessionStorage.setItem(SESSION_KEYS.playerId, existing);
    setSupabasePlayerContext(existing);
    return existing;
  }

  const playerId = createPlayerId();
  sessionStorage.setItem(SESSION_KEYS.playerId, playerId);
  localStorage.setItem(STORAGE_KEYS.playerId, playerId);
  setSupabasePlayerContext(playerId);
  return playerId;
}

export function getLocalSession(): LocalSession {
  return {
    playerId: getOrCreatePlayerId(),
    nickname: sessionStorage.getItem(SESSION_KEYS.nickname) ?? localStorage.getItem(STORAGE_KEYS.nickname) ?? "",
    roomCode:
      sessionStorage.getItem(SESSION_KEYS.roomCode) ?? localStorage.getItem(STORAGE_KEYS.roomCode) ?? undefined,
    isHost: (sessionStorage.getItem(SESSION_KEYS.isHost) ?? localStorage.getItem(STORAGE_KEYS.isHost)) === "true",
  };
}

export function saveLocalSession(session: Partial<LocalSession>) {
  if (session.playerId) {
    sessionStorage.setItem(SESSION_KEYS.playerId, session.playerId);
    localStorage.setItem(STORAGE_KEYS.playerId, session.playerId);
    setSupabasePlayerContext(session.playerId);
  }

  if (session.nickname !== undefined) {
    sessionStorage.setItem(SESSION_KEYS.nickname, session.nickname);
    localStorage.setItem(STORAGE_KEYS.nickname, session.nickname);
  }

  if (session.roomCode !== undefined) {
    sessionStorage.setItem(SESSION_KEYS.roomCode, session.roomCode);
    localStorage.setItem(STORAGE_KEYS.roomCode, session.roomCode);
  }

  if (session.isHost !== undefined) {
    sessionStorage.setItem(SESSION_KEYS.isHost, String(session.isHost));
    localStorage.setItem(STORAGE_KEYS.isHost, String(session.isHost));
  }
}

export function clearLocalRoomSession() {
  sessionStorage.removeItem(SESSION_KEYS.roomCode);
  sessionStorage.removeItem(SESSION_KEYS.isHost);
  localStorage.removeItem(STORAGE_KEYS.roomCode);
  localStorage.removeItem(STORAGE_KEYS.isHost);
}

export function createNewLocalPlayerSession(nickname: string) {
  const playerId = createPlayerId();

  saveLocalSession({
    playerId,
    nickname,
    isHost: false,
  });

  return getLocalSession();
}
