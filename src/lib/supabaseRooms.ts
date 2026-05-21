"use client";

import { createRoomCode } from "@/lib/id";
import { assertSupabaseEnv, getSupabasePublicConfig, supabase } from "@/lib/supabaseClient";
import type {
  DbGameSession,
  DbPlayer,
  DbQuestion,
  DbQuestionSet,
  DbRoom,
  GameSession,
  Player,
  Question,
  QuestionSet,
  Room,
} from "@/types/game";

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

function toQuestion(question: DbQuestion): Question {
  return {
    id: question.id,
    questionSetId: question.question_set_id,
    imageUrl: question.image_url,
    orderIndex: question.order_index,
    createdAt: question.created_at,
  };
}

function toQuestionSet(questionSet: DbQuestionSet, questions: DbQuestion[] = []): QuestionSet {
  return {
    id: questionSet.id,
    title: questionSet.title,
    description: questionSet.description,
    createdByPlayerId: questionSet.created_by_player_id,
    source: questionSet.source,
    isPublic: questionSet.is_public,
    imageCount: questionSet.image_count,
    ratingAvg: questionSet.rating_avg,
    ratingCount: questionSet.rating_count,
    createdAt: questionSet.created_at,
    questions: questions.map(toQuestion),
  };
}

function toGameSession(gameSession: DbGameSession): GameSession {
  const revealedBlocks = Array.isArray(gameSession.revealed_blocks)
    ? gameSession.revealed_blocks.filter((block): block is number => Number.isInteger(block))
    : [];

  return {
    id: gameSession.id,
    roomId: gameSession.room_id,
    questionSetId: gameSession.question_set_id,
    presenterPlayerId: gameSession.presenter_player_id,
    status: gameSession.status,
    currentQuestionIndex: gameSession.current_question_index,
    currentRevealRound: gameSession.current_reveal_round,
    revealedBlocks,
    roundStartedAt: gameSession.round_started_at,
    createdAt: gameSession.created_at,
    endedAt: gameSession.ended_at,
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

export function dissolveSupabaseRoomOnPageExit(roomId: string, playerId: string) {
  try {
    const { supabaseUrl, supabaseAnonKey } = getSupabasePublicConfig();
    const url = new URL(`${supabaseUrl}/rest/v1/rooms`);
    url.searchParams.set("id", `eq.${roomId}`);
    url.searchParams.set("host_player_id", `eq.${playerId}`);

    void fetch(url.toString(), {
      method: "DELETE",
      keepalive: true,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Prefer: "return=minimal",
      },
    });
  } catch {
    // Page-exit cleanup is best effort; explicit host navigation still awaits dissolveSupabaseRoom.
  }
}

export async function selectPresenterForRound(roomId: string, hostPlayerId: string, presenterPlayerId: string) {
  assertSupabaseEnv();

  const { data: presenter, error: presenterError } = await supabase
    .from("players")
    .select("id")
    .eq("room_id", roomId)
    .eq("id", presenterPlayerId)
    .maybeSingle<{ id: string }>();

  if (presenterError) {
    throw new Error(presenterError.message);
  }

  if (!presenter) {
    throw new Error("选择的出题人不在当前房间中。");
  }

  const { data: room, error } = await supabase
    .from("rooms")
    .update({
      current_presenter_player_id: presenterPlayerId,
      game_status: "QUESTION_SETUP",
    })
    .eq("id", roomId)
    .eq("host_player_id", hostPlayerId)
    .eq("game_status", "LOBBY")
    .select()
    .maybeSingle<DbRoom>();

  if (error) {
    throw new Error(error.message);
  }

  if (!room) {
    throw new Error("只有房主可以在大厅状态选择出题人。");
  }

  return toRoom(room);
}

export async function cancelCurrentRound(roomId: string, hostPlayerId: string) {
  assertSupabaseEnv();

  const { data: room, error } = await supabase
    .from("rooms")
    .update({
      current_presenter_player_id: null,
      current_game_id: null,
      game_status: "LOBBY",
    })
    .eq("id", roomId)
    .eq("host_player_id", hostPlayerId)
    .select()
    .maybeSingle<DbRoom>();

  if (error) {
    throw new Error(error.message);
  }

  if (!room) {
    throw new Error("只有房主可以取消本轮。");
  }

  return toRoom(room);
}

export async function createUploadedQuestionSet(params: {
  roomId: string;
  presenterPlayerId: string;
  title: string;
  imageUrls: string[];
}) {
  assertSupabaseEnv();

  const title = params.title.trim();
  const imageUrls = params.imageUrls.filter(Boolean);

  if (!title) {
    throw new Error("请先输入题库标题。");
  }

  if (imageUrls.length === 0) {
    throw new Error("至少需要一张上传成功的图片。");
  }

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", params.roomId)
    .eq("current_presenter_player_id", params.presenterPlayerId)
    .eq("game_status", "QUESTION_SETUP")
    .maybeSingle<DbRoom>();

  if (roomError) {
    throw new Error(roomError.message);
  }

  if (!room) {
    throw new Error("只有当前出题人可以在准备题库阶段创建题库。");
  }

  const { data: questionSet, error: questionSetError } = await supabase
    .from("question_sets")
    .insert({
      title,
      created_by_player_id: params.presenterPlayerId,
      source: "uploaded",
      is_public: false,
      image_count: imageUrls.length,
    })
    .select()
    .single<DbQuestionSet>();

  if (questionSetError) {
    throw new Error(questionSetError.message);
  }

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .insert(
      imageUrls.map((imageUrl, index) => ({
        question_set_id: questionSet.id,
        image_url: imageUrl,
        order_index: index,
      })),
    )
    .select()
    .order("order_index", { ascending: true })
    .returns<DbQuestion[]>();

  if (questionsError) {
    throw new Error(questionsError.message);
  }

  return toQuestionSet(questionSet, questions ?? []);
}

export async function startGameWithQuestionSet(params: {
  roomId: string;
  presenterPlayerId: string;
  questionSetId: string;
}) {
  assertSupabaseEnv();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", params.roomId)
    .eq("current_presenter_player_id", params.presenterPlayerId)
    .eq("game_status", "QUESTION_SETUP")
    .maybeSingle<DbRoom>();

  if (roomError) {
    throw new Error(roomError.message);
  }

  if (!room) {
    throw new Error("只有当前出题人可以开始游戏。");
  }

  const { data: questionSet, error: questionSetError } = await supabase
    .from("question_sets")
    .select("*")
    .eq("id", params.questionSetId)
    .eq("created_by_player_id", params.presenterPlayerId)
    .maybeSingle<DbQuestionSet>();

  if (questionSetError) {
    throw new Error(questionSetError.message);
  }

  if (!questionSet || questionSet.image_count <= 0) {
    throw new Error("题库不存在或没有图片。");
  }

  const { data: gameSession, error: gameSessionError } = await supabase
    .from("game_sessions")
    .insert({
      room_id: params.roomId,
      question_set_id: params.questionSetId,
      presenter_player_id: params.presenterPlayerId,
      status: "PLAYING",
    })
    .select()
    .single<DbGameSession>();

  if (gameSessionError) {
    throw new Error(gameSessionError.message);
  }

  const { data: updatedRoom, error: updateRoomError } = await supabase
    .from("rooms")
    .update({
      current_game_id: gameSession.id,
      game_status: "PLAYING",
    })
    .eq("id", params.roomId)
    .eq("current_presenter_player_id", params.presenterPlayerId)
    .eq("game_status", "QUESTION_SETUP")
    .select()
    .maybeSingle<DbRoom>();

  if (updateRoomError) {
    throw new Error(updateRoomError.message);
  }

  if (!updatedRoom) {
    throw new Error("开始游戏失败，房间状态已变化。");
  }

  return {
    gameSession: toGameSession(gameSession),
    room: toRoom(updatedRoom),
  };
}

export async function getGameSessionById(gameSessionId: string) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("game_sessions")
    .select("*")
    .eq("id", gameSessionId)
    .maybeSingle<DbGameSession>();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toGameSession(data) : null;
}

export async function getQuestionsByQuestionSetId(questionSetId: string) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("questions")
    .select("*")
    .eq("question_set_id", questionSetId)
    .order("order_index", { ascending: true })
    .returns<DbQuestion[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toQuestion);
}

export async function confirmRevealBlocks(params: {
  gameSessionId: string;
  presenterPlayerId: string;
  selectedBlocks: number[];
}) {
  assertSupabaseEnv();

  const { data: currentGameSession, error: currentError } = await supabase
    .from("game_sessions")
    .select("*")
    .eq("id", params.gameSessionId)
    .eq("presenter_player_id", params.presenterPlayerId)
    .eq("status", "PLAYING")
    .maybeSingle<DbGameSession>();

  if (currentError) {
    throw new Error(currentError.message);
  }

  if (!currentGameSession) {
    throw new Error("只有当前出题人可以确认揭露。");
  }

  const revealedBlocks = toGameSession(currentGameSession).revealedBlocks;
  const selectedBlocks = params.selectedBlocks.filter((block) => Number.isInteger(block) && block >= 0 && block < 28);
  const nextBlocks = Array.from(new Set([...revealedBlocks, ...selectedBlocks])).sort((a, b) => a - b);

  if (nextBlocks.length === revealedBlocks.length) {
    throw new Error("请先选择至少一个未揭露的块。");
  }

  const roundStartedAt = currentGameSession.round_started_at;
  const roundDurationMs = 30_000;
  const roundEnded = !roundStartedAt || Date.now() - new Date(roundStartedAt).getTime() >= roundDurationMs;
  const nextRevealRound =
    roundStartedAt && roundEnded
      ? Math.min(3, currentGameSession.current_reveal_round + 1)
      : currentGameSession.current_reveal_round;

  if (roundStartedAt && !roundEnded) {
    throw new Error("当前轮倒计时结束后才能确认下一轮揭露。");
  }

  if (currentGameSession.current_reveal_round >= 3 && roundStartedAt && roundEnded) {
    throw new Error("本题最多 3 轮揭露。");
  }

  const { data: updatedGameSession, error } = await supabase
    .from("game_sessions")
    .update({
      revealed_blocks: nextBlocks,
      current_reveal_round: nextRevealRound,
      round_started_at: new Date().toISOString(),
    })
    .eq("id", params.gameSessionId)
    .eq("presenter_player_id", params.presenterPlayerId)
    .eq("status", "PLAYING")
    .select()
    .maybeSingle<DbGameSession>();

  if (error) {
    throw new Error(error.message);
  }

  if (!updatedGameSession) {
    throw new Error("确认揭露失败，游戏状态已变化。");
  }

  return toGameSession(updatedGameSession);
}
