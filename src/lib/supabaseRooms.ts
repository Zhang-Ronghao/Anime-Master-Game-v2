"use client";

import { createRoomCode } from "@/lib/id";
import { assertSupabaseEnv, supabase } from "@/lib/supabaseClient";
import type { DbPlayer, DbRoom, Player, Room } from "@/types/game";

function toPlayer(player: DbPlayer): Player {
  return {
    id: player.id,
    roomId: player.room_id,
    nickname: player.nickname,
    isHost: player.is_host,
    joinedAt: player.joined_at,
    lastSeenAt: player.last_seen_at,
  };
}

function toRoom(room: DbRoom, players: DbPlayer[] = []): Room {
  return {
    id: room.id,
    code: room.room_code,
    hostPlayerId: room.host_player_id,
    players: players.map(toPlayer),
    status: room.game_status,
    currentPresenterPlayerId: room.current_presenter_player_id,
    currentGameId: room.current_game_id,
    createdAt: room.created_at,
    updatedAt: room.updated_at,
  };
}

function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}

export async function createSupabaseRoom(playerId: string, nickname: string) {
  assertSupabaseEnv();

  let roomCode = createRoomCode();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({
        room_code: roomCode,
        host_player_id: playerId,
      })
      .select()
      .single<DbRoom>();

    if (roomError) {
      if (isUniqueViolation(roomError)) {
        roomCode = createRoomCode();
        continue;
      }

      throw new Error(roomError.message);
    }

    const { error: playerError } = await supabase.from("players").upsert(
      {
        id: playerId,
        room_id: room.id,
        nickname,
        is_host: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (playerError) {
      throw new Error(playerError.message);
    }

    return toRoom(room, [
      {
        id: playerId,
        room_id: room.id,
        nickname,
        is_host: true,
        joined_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      },
    ]);
  }

  throw new Error("生成房间号失败，请重试。");
}

export async function getRoomByCode(roomCode: string) {
  assertSupabaseEnv();

  const { data: room, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("room_code", roomCode)
    .maybeSingle<DbRoom>();

  if (error) {
    throw new Error(error.message);
  }

  return room;
}

export async function getRoomWithPlayers(roomCode: string) {
  const room = await getRoomByCode(roomCode);

  if (!room) {
    return null;
  }

  const players = await getDbPlayersByRoomId(room.id);
  return toRoom(room, players);
}

async function getDbPlayersByRoomId(roomId: string) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true })
    .returns<DbPlayer[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getPlayersByRoomId(roomId: string) {
  const players = await getDbPlayersByRoomId(roomId);
  return players.map(toPlayer);
}

export async function joinSupabaseRoom(roomCode: string, playerId: string, nickname: string) {
  const room = await getRoomByCode(roomCode);

  if (!room) {
    return {
      room: null,
      error: "房间不存在。请检查房间号是否正确。",
    };
  }

  const players = await getDbPlayersByRoomId(room.id);
  const duplicatedNickname = players.some(
    (player) => player.id !== playerId && player.nickname.trim().toLowerCase() === nickname.trim().toLowerCase(),
  );

  if (duplicatedNickname) {
    return {
      room: null,
      error: "该昵称已在房间中使用，请换一个昵称。",
    };
  }

  const isHost = room.host_player_id === playerId;
  const { error } = await supabase.from("players").upsert(
    {
      id: playerId,
      room_id: room.id,
      nickname,
      is_host: isHost,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        room: null,
        error: "该昵称已在房间中使用，请换一个昵称。",
      };
    }

    throw new Error(error.message);
  }

  const nextPlayers = await getDbPlayersByRoomId(room.id);

  return {
    room: toRoom(room, nextPlayers),
    error: null,
  };
}

export async function leaveSupabaseRoom(roomId: string, playerId: string) {
  assertSupabaseEnv();

  const { error } = await supabase
    .from("players")
    .delete()
    .eq("room_id", roomId)
    .eq("id", playerId)
    .eq("is_host", false);

  if (error) {
    throw new Error(error.message);
  }
}

export async function dissolveSupabaseRoom(roomId: string, playerId: string) {
  assertSupabaseEnv();

  const { error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", roomId)
    .eq("host_player_id", playerId);

  if (error) {
    throw new Error(error.message);
  }
}
