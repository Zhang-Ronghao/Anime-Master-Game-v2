"use client";

import { createRoomCode } from "@/lib/id";
import { assertSupabaseEnv, getSupabasePublicConfig, supabase } from "@/lib/supabaseClient";
import type {
  Answer,
  BuzzerAnswer,
  DbAnswer,
  DbBuzzerAnswer,
  DbGameSession,
  DbPlayer,
  DbPlayerScore,
  DbQuestion,
  DbQuestionResult,
  DbQuestionSet,
  DbRoom,
  GameSession,
  GameMode,
  LeaderboardEntry,
  Player,
  PlayerScore,
  Question,
  QuestionResult,
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
    preparedQuestionSetId: room.prepared_question_set_id ?? null,
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
    labelText: question.label_text ?? null,
    labelSource: question.label_source ?? null,
    labelSourceAnswerId: question.label_source_answer_id ?? null,
    labelUpdatedByPlayerId: question.label_updated_by_player_id ?? null,
    labelUpdatedAt: question.label_updated_at ?? null,
    createdAt: question.created_at,
  };
}

function toQuestionSet(questionSet: DbQuestionSet, questions: DbQuestion[] = []): QuestionSet {
  const questionUrlsText = questions
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((question) => question.image_url)
    .join("\n");

  return {
    id: questionSet.id,
    title: questionSet.title,
    description: questionSet.description,
    createdByPlayerId: questionSet.created_by_player_id,
    source: questionSet.source,
    isPublic: questionSet.is_public,
    imageUrlsText: questionSet.image_urls_text ?? questionUrlsText,
    imageCount: questionSet.image_count,
    ratingAvg: questionSet.rating_avg,
    ratingCount: questionSet.rating_count,
    createdAt: questionSet.created_at,
    updatedAt: questionSet.updated_at,
    questions: questions.map(toQuestion),
  };
}

function toGameSession(gameSession: DbGameSession): GameSession {
  const revealedBlocks = Array.isArray(gameSession.revealed_blocks)
    ? Array.from(
        new Set(
          gameSession.revealed_blocks.filter(
            (block): block is number => Number.isInteger(block) && block >= 0 && block < REVEAL_BLOCK_COUNT,
          ),
        ),
      ).sort((a, b) => a - b)
    : [];
  const roundScores = Array.isArray(gameSession.round_scores)
    ? gameSession.round_scores.filter((score): score is number => Number.isFinite(score))
    : [3, 2, 1];

  return {
    id: gameSession.id,
    roomId: gameSession.room_id,
    questionSetId: gameSession.question_set_id,
    presenterPlayerId: gameSession.presenter_player_id,
    status: gameSession.status,
    gameMode: gameSession.game_mode ?? "ROUND_REVEAL",
    currentQuestionIndex: gameSession.current_question_index,
    currentRevealRound: gameSession.current_reveal_round,
    revealedBlocks,
    maxRevealRounds: gameSession.max_reveal_rounds ?? 3,
    roundSeconds: gameSession.round_seconds ?? 60,
    roundScores,
    roundStartedAt: gameSession.round_started_at,
    createdAt: gameSession.created_at,
    endedAt: gameSession.ended_at,
  };
}

function toBuzzerAnswer(answer: DbBuzzerAnswer): BuzzerAnswer {
  return {
    id: answer.id,
    gameSessionId: answer.game_session_id,
    questionIndex: answer.question_index,
    revealRound: answer.reveal_round,
    playerId: answer.player_id,
    answerText: answer.answer_text,
    status: answer.status,
    scoreAwarded: answer.score_awarded,
    submittedAt: answer.submitted_at,
    judgedAt: answer.judged_at,
    judgedByPlayerId: answer.judged_by_player_id,
  };
}

function toAnswer(answer: DbAnswer): Answer {
  return {
    id: answer.id,
    gameSessionId: answer.game_session_id,
    questionIndex: answer.question_index,
    revealRound: answer.reveal_round,
    playerId: answer.player_id,
    answerText: answer.answer_text,
    submittedAt: answer.submitted_at,
  };
}

function toPlayerScore(playerScore: DbPlayerScore): PlayerScore {
  return {
    id: playerScore.id,
    gameSessionId: playerScore.game_session_id,
    playerId: playerScore.player_id,
    score: playerScore.score,
    correctCount: playerScore.correct_count,
  };
}

function toQuestionResult(questionResult: DbQuestionResult): QuestionResult {
  return {
    id: questionResult.id,
    gameSessionId: questionResult.game_session_id,
    questionIndex: questionResult.question_index,
    playerId: questionResult.player_id,
    scoredRound: questionResult.scored_round,
    scoreAwarded: questionResult.score_awarded,
    judgedByPlayerId: questionResult.judged_by_player_id,
    judgedAt: questionResult.judged_at,
  };
}

function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}

const REVEAL_BLOCK_COUNT = 45;
const ALL_REVEALED_BLOCKS = Array.from({ length: REVEAL_BLOCK_COUNT }, (_, index) => index);
const MAX_PLAYERS_PER_ROOM = 15;

export type QuestionImportItem = {
  imageUrl: string;
  labelText?: string | null;
};

function isHttpImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseImageUrlsText(imageUrlsText: string) {
  return Array.from(
    new Set(
      imageUrlsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && isHttpImageUrl(line)),
    ),
  );
}

function normalizeQuestionImportItems(items: QuestionImportItem[]) {
  const seenUrls = new Set<string>();
  const normalizedItems: QuestionImportItem[] = [];

  for (const item of items) {
    const imageUrl = item.imageUrl.trim();

    if (!imageUrl || !isHttpImageUrl(imageUrl) || seenUrls.has(imageUrl)) {
      continue;
    }

    seenUrls.add(imageUrl);
    normalizedItems.push({
      imageUrl,
      labelText: item.labelText?.trim() || null,
    });
  }

  return normalizedItems;
}

export function parseQuestionImportText(importText: string): QuestionImportItem[] {
  const items: QuestionImportItem[] = [];

  for (const [index, rawLine] of importText.split(/\r?\n/).entries()) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (!line.startsWith("{")) {
      if (isHttpImageUrl(line)) {
        items.push({ imageUrl: line });
      }
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`第 ${index + 1} 行不是有效 JSON。`);
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error(`第 ${index + 1} 行必须是 JSON 对象。`);
    }

    const record = parsed as Record<string, unknown>;

    if (typeof record.image_url !== "string" || !isHttpImageUrl(record.image_url.trim())) {
      throw new Error(`第 ${index + 1} 行缺少有效的 image_url。`);
    }

    if (record.label_text != null && typeof record.label_text !== "string") {
      throw new Error(`第 ${index + 1} 行的 label_text 必须是字符串。`);
    }

    const labelText = typeof record.label_text === "string" ? record.label_text : null;

    items.push({
      imageUrl: record.image_url,
      labelText,
    });
  }

  return normalizeQuestionImportItems(items);
}

function imageUrlsToText(imageUrls: string[]) {
  return imageUrls.map((url) => url.trim()).filter(Boolean).join("\n");
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

  const isExistingPlayer = players.some((player) => player.id === playerId);

  if (!isExistingPlayer && players.length >= MAX_PLAYERS_PER_ROOM) {
    return {
      room: null,
      error: `房间人数已满，最多 ${MAX_PLAYERS_PER_ROOM} 人。`,
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
      current_game_id: null,
      prepared_question_set_id: null,
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
      prepared_question_set_id: null,
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
    throw new Error("只有房主可以取消本局。");
  }

  return toRoom(room);
}

export async function createUploadedQuestionSet(params: {
  roomId: string;
  presenterPlayerId: string;
  title: string;
  description?: string;
  imageUrls?: string[];
  questions?: QuestionImportItem[];
}) {
  assertSupabaseEnv();

  const title = params.title.trim();
  const questionItems = normalizeQuestionImportItems(
    params.questions ?? params.imageUrls?.map((imageUrl) => ({ imageUrl })) ?? [],
  );
  const imageUrls = questionItems.map((item) => item.imageUrl);

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
      description: params.description?.trim() || null,
      created_by_player_id: params.presenterPlayerId,
      source: "uploaded",
      is_public: false,
      image_count: imageUrls.length,
      image_urls_text: imageUrlsToText(imageUrls),
    })
    .select()
    .single<DbQuestionSet>();

  if (questionSetError) {
    throw new Error(questionSetError.message);
  }

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .insert(
      imageUrls.map((imageUrl, index) => {
        const labelText = questionItems[index].labelText;

        return {
          question_set_id: questionSet.id,
          image_url: imageUrl,
          order_index: index,
          label_text: labelText,
          label_source: labelText ? "manual" : null,
          label_updated_by_player_id: labelText ? params.presenterPlayerId : null,
          label_updated_at: labelText ? new Date().toISOString() : null,
        };
      }),
    )
    .select()
    .order("order_index", { ascending: true })
    .returns<DbQuestion[]>();

  if (questionsError) {
    throw new Error(questionsError.message);
  }

  return toQuestionSet(questionSet, questions ?? []);
}

export async function createQuestionSetFromUrlText(params: {
  roomId: string;
  presenterPlayerId: string;
  title: string;
  description?: string;
  imageUrlsText: string;
}) {
  const questions = parseQuestionImportText(params.imageUrlsText);

  if (questions.length === 0) {
    throw new Error("至少需要 1 个有效的 http/https 图片 URL。");
  }

  return createUploadedQuestionSet({
    roomId: params.roomId,
    presenterPlayerId: params.presenterPlayerId,
    title: params.title,
    description: params.description,
    questions,
  });
}

export async function getQuestionSetById(questionSetId: string) {
  assertSupabaseEnv();

  const { data: questionSet, error } = await supabase
    .from("question_sets")
    .select("*")
    .eq("id", questionSetId)
    .maybeSingle<DbQuestionSet>();

  if (error) {
    throw new Error(error.message);
  }

  if (!questionSet) {
    return null;
  }

  const questions = await getDbQuestionsByQuestionSetId(questionSet.id);
  return toQuestionSet(questionSet, questions);
}

export async function getCommunityQuestionSets(sort: "latest" | "rating" = "latest") {
  assertSupabaseEnv();

  let query = supabase.from("question_sets").select("*").eq("is_public", true);

  if (sort === "rating") {
    query = query.order("rating_avg", { ascending: false }).order("rating_count", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query.limit(30).returns<DbQuestionSet[]>();

  if (error) {
    throw new Error(error.message);
  }

  const questionSets = await Promise.all(
    (data ?? []).map(async (questionSet) => {
      const questions = await getDbQuestionsByQuestionSetId(questionSet.id);
      return toQuestionSet(questionSet, questions);
    }),
  );

  return questionSets;
}

export async function prepareQuestionSetForStart(params: {
  roomId: string;
  presenterPlayerId: string;
  questionSetId: string;
}) {
  assertSupabaseEnv();

  const { data: questionSet, error: questionSetError } = await supabase
    .from("question_sets")
    .select("*")
    .eq("id", params.questionSetId)
    .maybeSingle<DbQuestionSet>();

  if (questionSetError) {
    throw new Error(questionSetError.message);
  }

  if (!questionSet || questionSet.image_count <= 0) {
    throw new Error("题库不存在或没有图片。");
  }

  if (questionSet.created_by_player_id !== params.presenterPlayerId && !questionSet.is_public) {
    throw new Error("只能使用自己创建的题库或公开社区题库。");
  }

  const { data: room, error } = await supabase
    .from("rooms")
    .update({
      prepared_question_set_id: params.questionSetId,
    })
    .eq("id", params.roomId)
    .eq("current_presenter_player_id", params.presenterPlayerId)
    .eq("game_status", "QUESTION_SETUP")
    .select()
    .maybeSingle<DbRoom>();

  if (error) {
    throw new Error(error.message);
  }

  if (!room) {
    throw new Error("只有当前出题人可以通知房主题库已准备好。");
  }

  return toRoom(room);
}

export async function startGameWithQuestionSet(params: {
  roomId: string;
  hostPlayerId: string;
  presenterPlayerId: string;
  questionSetId: string;
  gameMode?: GameMode;
  maxRevealRounds?: number;
  roundSeconds?: number;
  roundScores?: number[];
}) {
  assertSupabaseEnv();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", params.roomId)
    .eq("host_player_id", params.hostPlayerId)
    .eq("current_presenter_player_id", params.presenterPlayerId)
    .eq("prepared_question_set_id", params.questionSetId)
    .eq("game_status", "QUESTION_SETUP")
    .maybeSingle<DbRoom>();

  if (roomError) {
    throw new Error(roomError.message);
  }

  if (!room) {
    throw new Error("只有房主可以在出题人准备完成后开始游戏。");
  }

  const { data: questionSet, error: questionSetError } = await supabase
    .from("question_sets")
    .select("*")
    .eq("id", params.questionSetId)
    .maybeSingle<DbQuestionSet>();

  if (questionSetError) {
    throw new Error(questionSetError.message);
  }

  if (!questionSet || questionSet.image_count <= 0) {
    throw new Error("题库不存在或没有图片。");
  }

  if (questionSet.created_by_player_id !== params.presenterPlayerId && !questionSet.is_public) {
    throw new Error("只能使用自己创建的题库或公开社区题库。");
  }

  const maxRevealRounds = Math.max(1, Math.min(10, Math.floor(params.maxRevealRounds ?? 3)));
  const roundSeconds = Math.max(1, Math.min(600, Math.floor(params.roundSeconds ?? 60)));
  const gameMode = params.gameMode ?? "ROUND_REVEAL";
  const roundScores = Array.from({ length: maxRevealRounds }, (_, index) => {
    const score = params.roundScores?.[index] ?? Math.max(1, maxRevealRounds - index);
    return Math.max(0, Math.floor(score));
  });

  const { data: gameSession, error: gameSessionError } = await supabase
    .from("game_sessions")
    .insert({
      room_id: params.roomId,
      question_set_id: params.questionSetId,
      presenter_player_id: params.presenterPlayerId,
      status: "PLAYING",
      game_mode: gameMode,
      max_reveal_rounds: maxRevealRounds,
      round_seconds: roundSeconds,
      round_scores: roundScores,
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
      prepared_question_set_id: null,
      game_status: "PLAYING",
    })
    .eq("id", params.roomId)
    .eq("host_player_id", params.hostPlayerId)
    .eq("current_presenter_player_id", params.presenterPlayerId)
    .eq("prepared_question_set_id", params.questionSetId)
    .eq("game_status", "QUESTION_SETUP")
    .select()
    .maybeSingle<DbRoom>();

  if (updateRoomError) {
    throw new Error(updateRoomError.message);
  }

  if (!updatedRoom) {
    await supabase
      .from("game_sessions")
      .update({
        status: "GAME_RESULT",
        ended_at: new Date().toISOString(),
      })
      .eq("id", gameSession.id);
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

async function getDbQuestionsByQuestionSetId(questionSetId: string) {
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

  return data ?? [];
}

export async function getQuestionsByQuestionSetId(questionSetId: string) {
  const questions = await getDbQuestionsByQuestionSetId(questionSetId);
  return questions.map(toQuestion);
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
  const selectedBlocks = params.selectedBlocks.filter(
    (block) => Number.isInteger(block) && block >= 0 && block < REVEAL_BLOCK_COUNT,
  );
  const nextBlocks = Array.from(new Set([...revealedBlocks, ...selectedBlocks])).sort((a, b) => a - b);

  if (nextBlocks.length === revealedBlocks.length) {
    throw new Error("请先选择至少一个未揭露的块。");
  }

  const roundStartedAt = currentGameSession.round_started_at;
  const maxRevealRounds = currentGameSession.max_reveal_rounds ?? 3;
  const roundDurationMs = Math.max(1, currentGameSession.round_seconds ?? 60) * 1000;
  const roundEnded = !roundStartedAt || Date.now() - new Date(roundStartedAt).getTime() >= roundDurationMs;
  const nextRevealRound =
    roundStartedAt && roundEnded
      ? Math.min(maxRevealRounds, currentGameSession.current_reveal_round + 1)
      : currentGameSession.current_reveal_round;

  if (roundStartedAt && !roundEnded) {
    throw new Error("当前轮倒计时结束后才能确认下一轮揭露。");
  }

  if (currentGameSession.current_reveal_round >= maxRevealRounds && roundStartedAt && roundEnded) {
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

export async function getAnswersForQuestionRound(params: {
  gameSessionId: string;
  questionIndex: number;
  revealRound: number;
}) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("game_session_id", params.gameSessionId)
    .eq("question_index", params.questionIndex)
    .eq("reveal_round", params.revealRound)
    .order("submitted_at", { ascending: true })
    .returns<DbAnswer[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toAnswer);
}

export async function getAnswersForQuestion(params: {
  gameSessionId: string;
  questionIndex: number;
}) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("game_session_id", params.gameSessionId)
    .eq("question_index", params.questionIndex)
    .order("submitted_at", { ascending: true })
    .returns<DbAnswer[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toAnswer);
}

export async function getAnswerForPlayerRound(params: {
  gameSessionId: string;
  questionIndex: number;
  revealRound: number;
  playerId: string;
}) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("game_session_id", params.gameSessionId)
    .eq("question_index", params.questionIndex)
    .eq("reveal_round", params.revealRound)
    .eq("player_id", params.playerId)
    .maybeSingle<DbAnswer>();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toAnswer(data) : null;
}

export async function getBuzzerAnswersForQuestionRound(params: {
  gameSessionId: string;
  questionIndex: number;
  revealRound: number;
}) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("buzzer_answers")
    .select("*")
    .eq("game_session_id", params.gameSessionId)
    .eq("question_index", params.questionIndex)
    .eq("reveal_round", params.revealRound)
    .order("submitted_at", { ascending: true })
    .returns<DbBuzzerAnswer[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toBuzzerAnswer);
}

export async function getBuzzerAnswersForQuestion(params: {
  gameSessionId: string;
  questionIndex: number;
}) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("buzzer_answers")
    .select("*")
    .eq("game_session_id", params.gameSessionId)
    .eq("question_index", params.questionIndex)
    .order("submitted_at", { ascending: true })
    .returns<DbBuzzerAnswer[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toBuzzerAnswer);
}

export async function getBuzzerAnswerForPlayerRound(params: {
  gameSessionId: string;
  questionIndex: number;
  revealRound: number;
  playerId: string;
}) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("buzzer_answers")
    .select("*")
    .eq("game_session_id", params.gameSessionId)
    .eq("question_index", params.questionIndex)
    .eq("reveal_round", params.revealRound)
    .eq("player_id", params.playerId)
    .maybeSingle<DbBuzzerAnswer>();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toBuzzerAnswer(data) : null;
}

export async function getPlayerScores(gameSessionId: string) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("player_scores")
    .select("*")
    .eq("game_session_id", gameSessionId)
    .order("score", { ascending: false })
    .returns<DbPlayerScore[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toPlayerScore);
}

export async function getLeaderboardForGameSession(gameSessionId: string): Promise<LeaderboardEntry[]> {
  assertSupabaseEnv();

  const gameSession = await getGameSessionById(gameSessionId);

  if (!gameSession) {
    throw new Error("当前游戏不存在。");
  }

  const [{ data: players, error: playersError }, scores] = await Promise.all([
    supabase
      .from("players")
      .select("*")
      .eq("room_id", gameSession.roomId)
      .returns<DbPlayer[]>(),
    getPlayerScores(gameSessionId),
  ]);

  if (playersError) {
    throw new Error(playersError.message);
  }

  const scoreByPlayerId = new Map(scores.map((score) => [score.playerId, score]));

  return (players ?? [])
    .filter((player) => player.id !== gameSession.presenterPlayerId)
    .map((player) => {
      const score = scoreByPlayerId.get(player.id);

      return {
        playerId: player.id,
        nickname: player.nickname,
        rank: 0,
        score: score?.score ?? 0,
        correctCount: score?.correctCount ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.nickname.localeCompare(b.nickname))
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

export async function publishQuestionSetToCommunity(params: {
  questionSetId: string;
  playerId: string;
  title: string;
  description?: string;
}) {
  assertSupabaseEnv();

  const title = params.title.trim();

  if (!title) {
    throw new Error("请填写题库标题。");
  }

  const { data: questionSet, error } = await supabase
    .from("question_sets")
    .update({
      title,
      description: params.description?.trim() || null,
      is_public: true,
    })
    .eq("id", params.questionSetId)
    .eq("created_by_player_id", params.playerId)
    .select()
    .maybeSingle<DbQuestionSet>();

  if (error) {
    throw new Error(error.message);
  }

  if (!questionSet) {
    throw new Error("只有题库创建者可以发布到社区。");
  }

  const questions = await getDbQuestionsByQuestionSetId(questionSet.id);
  return toQuestionSet(questionSet, questions);
}

export async function rateCommunityQuestionSet(params: {
  questionSetId: string;
  playerId: string;
  rating: number;
}) {
  assertSupabaseEnv();

  const rating = Math.max(1, Math.min(5, Math.floor(params.rating)));

  const { data: questionSet, error: questionSetError } = await supabase
    .from("question_sets")
    .select("*")
    .eq("id", params.questionSetId)
    .eq("is_public", true)
    .maybeSingle<DbQuestionSet>();

  if (questionSetError) {
    throw new Error(questionSetError.message);
  }

  if (!questionSet) {
    throw new Error("只能给公开社区题库评分。");
  }

  const { error: ratingError } = await supabase.from("question_set_ratings").upsert(
    {
      question_set_id: params.questionSetId,
      player_id: params.playerId,
      rating,
    },
    { onConflict: "question_set_id,player_id" },
  );

  if (ratingError) {
    throw new Error(ratingError.message);
  }

  const { data: ratings, error: ratingsLoadError } = await supabase
    .from("question_set_ratings")
    .select("rating")
    .eq("question_set_id", params.questionSetId)
    .returns<{ rating: number }[]>();

  if (ratingsLoadError) {
    throw new Error(ratingsLoadError.message);
  }

  const ratingCount = ratings?.length ?? 0;
  const ratingAvg =
    ratingCount > 0
      ? Math.round((ratings ?? []).reduce((total, item) => total + item.rating, 0) * 100 / ratingCount) / 100
      : 0;

  const { data: updatedQuestionSet, error: updateError } = await supabase
    .from("question_sets")
    .update({
      rating_avg: ratingAvg,
      rating_count: ratingCount,
    })
    .eq("id", params.questionSetId)
    .select()
    .single<DbQuestionSet>();

  if (updateError) {
    throw new Error(updateError.message);
  }

  const questions = await getDbQuestionsByQuestionSetId(updatedQuestionSet.id);
  return toQuestionSet(updatedQuestionSet, questions);
}

export async function getQuestionResultsForQuestion(params: {
  gameSessionId: string;
  questionIndex: number;
}) {
  assertSupabaseEnv();

  const { data, error } = await supabase
    .from("question_results")
    .select("*")
    .eq("game_session_id", params.gameSessionId)
    .eq("question_index", params.questionIndex)
    .returns<DbQuestionResult[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toQuestionResult);
}

async function addScoreToPlayer(params: {
  gameSessionId: string;
  playerId: string;
  scoreAwarded: number;
}) {
  const { data: existingScore, error: scoreLoadError } = await supabase
    .from("player_scores")
    .select("*")
    .eq("game_session_id", params.gameSessionId)
    .eq("player_id", params.playerId)
    .maybeSingle<DbPlayerScore>();

  if (scoreLoadError) {
    throw new Error(scoreLoadError.message);
  }

  const { error: scoreError } = await supabase.from("player_scores").upsert(
    {
      id: existingScore?.id,
      game_session_id: params.gameSessionId,
      player_id: params.playerId,
      score: (existingScore?.score ?? 0) + params.scoreAwarded,
      correct_count: (existingScore?.correct_count ?? 0) + 1,
    },
    {
      onConflict: "game_session_id,player_id",
    },
  );

  if (scoreError) {
    throw new Error(scoreError.message);
  }
}

async function revealQuestionForReview(gameSessionId: string) {
  const { data: reviewedGameSession, error } = await supabase
    .from("game_sessions")
    .update({
      revealed_blocks: ALL_REVEALED_BLOCKS,
      round_started_at: null,
    })
    .eq("id", gameSessionId)
    .select()
    .single<DbGameSession>();

  if (error) {
    throw new Error(error.message);
  }

  return toGameSession(reviewedGameSession);
}

async function moveToNextRevealRound(currentGameSession: DbGameSession) {
  const { data: updatedGameSession, error } = await supabase
    .from("game_sessions")
    .update({
      current_reveal_round: currentGameSession.current_reveal_round + 1,
      round_started_at: null,
    })
    .eq("id", currentGameSession.id)
    .select()
    .single<DbGameSession>();

  if (error) {
    throw new Error(error.message);
  }

  return toGameSession(updatedGameSession);
}

async function settleBuzzerRoundFromDb(currentGameSession: DbGameSession) {
  const currentSession = toGameSession(currentGameSession);
  const questionIndex = currentGameSession.current_question_index;
  const currentRound = currentGameSession.current_reveal_round;
  const roundStartedAt = currentGameSession.round_started_at;
  const roundEnded = Boolean(
    roundStartedAt && Date.now() - new Date(roundStartedAt).getTime() >= currentSession.roundSeconds * 1000,
  );

  const [{ data: players, error: playersError }, { data: questionResults, error: resultsError }, { data: currentRoundAnswers, error: answersError }] =
    await Promise.all([
      supabase.from("players").select("*").eq("room_id", currentGameSession.room_id).returns<DbPlayer[]>(),
      supabase
        .from("question_results")
        .select("*")
        .eq("game_session_id", currentGameSession.id)
        .eq("question_index", questionIndex)
        .returns<DbQuestionResult[]>(),
      supabase
        .from("buzzer_answers")
        .select("*")
        .eq("game_session_id", currentGameSession.id)
        .eq("question_index", questionIndex)
        .eq("reveal_round", currentRound)
        .returns<DbBuzzerAnswer[]>(),
    ]);

  if (playersError) {
    throw new Error(playersError.message);
  }

  if (resultsError) {
    throw new Error(resultsError.message);
  }

  if (answersError) {
    throw new Error(answersError.message);
  }

  const guesserIds = (players ?? [])
    .filter((player) => player.id !== currentGameSession.presenter_player_id)
    .map((player) => player.id);
  const correctSet = new Set((questionResults ?? []).map((result) => result.player_id));
  const eligibleGuesserIds = guesserIds.filter((guesserId) => !correctSet.has(guesserId));
  const answerByPlayerId = new Map((currentRoundAnswers ?? []).map((answer) => [answer.player_id, answer]));
  const hasPendingAnswers = (currentRoundAnswers ?? []).some((answer) => answer.status === "pending");
  const allEligiblePlayersUsedChance =
    eligibleGuesserIds.length === 0 || eligibleGuesserIds.every((guesserId) => answerByPlayerId.has(guesserId));
  const hasCorrectAnswer = correctSet.size > 0;
  const allPlayersCorrect = guesserIds.length > 0 && guesserIds.every((guesserId) => correctSet.has(guesserId));

  if (allPlayersCorrect || (currentSession.gameMode === "BUZZER_FIRST_CORRECT" && hasCorrectAnswer)) {
    return revealQuestionForReview(currentGameSession.id);
  }

  if (hasPendingAnswers) {
    return currentSession;
  }

  if (roundEnded || allEligiblePlayersUsedChance) {
    if (currentRound >= currentSession.maxRevealRounds) {
      return revealQuestionForReview(currentGameSession.id);
    }

    return moveToNextRevealRound(currentGameSession);
  }

  return currentSession;
}

export async function submitAnswer(params: {
  gameSessionId: string;
  playerId: string;
  answerText: string;
}) {
  assertSupabaseEnv();

  const answerText = params.answerText.trim();

  if (!answerText) {
    throw new Error("请输入答案。");
  }

  const gameSession = await getGameSessionById(params.gameSessionId);

  if (gameSession?.gameMode !== "ROUND_REVEAL") {
    throw new Error("当前游戏是抢答模式，请使用抢答提交。");
  }

  if (!gameSession || gameSession.status !== "PLAYING") {
    throw new Error("当前游戏不在答题阶段。");
  }

  if (gameSession.presenterPlayerId === params.playerId) {
    throw new Error("出题人不能提交答案。");
  }

  if (!gameSession.roundStartedAt) {
    throw new Error("等待出题人确认揭露后才能答题。");
  }

  if (Date.now() - new Date(gameSession.roundStartedAt).getTime() >= gameSession.roundSeconds * 1000) {
    throw new Error("本轮倒计时已结束。");
  }

  const { data: existingResult, error: resultError } = await supabase
    .from("question_results")
    .select("id")
    .eq("game_session_id", gameSession.id)
    .eq("question_index", gameSession.currentQuestionIndex)
    .eq("player_id", params.playerId)
    .maybeSingle<{ id: string }>();

  if (resultError) {
    throw new Error(resultError.message);
  }

  if (existingResult) {
    throw new Error("你已答对本题，不能继续作答。");
  }

  const { data, error } = await supabase
    .from("answers")
    .upsert(
      {
        game_session_id: gameSession.id,
        question_index: gameSession.currentQuestionIndex,
        reveal_round: gameSession.currentRevealRound,
        player_id: params.playerId,
        answer_text: answerText,
        submitted_at: new Date().toISOString(),
      },
      {
        onConflict: "game_session_id,question_index,reveal_round,player_id",
      },
    )
    .select()
    .single<DbAnswer>();

  if (error) {
    throw new Error(error.message);
  }

  return toAnswer(data);
}

export async function submitBuzzerAnswer(params: {
  gameSessionId: string;
  playerId: string;
  answerText: string;
}) {
  assertSupabaseEnv();

  const answerText = params.answerText.trim();

  if (!answerText) {
    throw new Error("请输入答案。");
  }

  const gameSession = await getGameSessionById(params.gameSessionId);

  if (!gameSession || gameSession.status !== "PLAYING" || gameSession.gameMode === "ROUND_REVEAL") {
    throw new Error("当前游戏不在抢答阶段。");
  }

  if (gameSession.presenterPlayerId === params.playerId) {
    throw new Error("出题人不能抢答。");
  }

  if (!gameSession.roundStartedAt) {
    throw new Error("等待出题人确认揭露后才能抢答。");
  }

  if (Date.now() - new Date(gameSession.roundStartedAt).getTime() >= gameSession.roundSeconds * 1000) {
    throw new Error("本轮抢答时间已结束。");
  }

  const { data: existingResult, error: resultError } = await supabase
    .from("question_results")
    .select("id")
    .eq("game_session_id", gameSession.id)
    .eq("question_index", gameSession.currentQuestionIndex)
    .eq("player_id", params.playerId)
    .maybeSingle<{ id: string }>();

  if (resultError) {
    throw new Error(resultError.message);
  }

  if (existingResult) {
    throw new Error("你已答对本题，不能继续抢答。");
  }

  const { data, error } = await supabase
    .from("buzzer_answers")
    .insert({
      game_session_id: gameSession.id,
      question_index: gameSession.currentQuestionIndex,
      reveal_round: gameSession.currentRevealRound,
      player_id: params.playerId,
      answer_text: answerText,
      submitted_at: new Date().toISOString(),
    })
    .select()
    .single<DbBuzzerAnswer>();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new Error("本轮你已经用过抢答机会。");
    }

    throw new Error(error.message);
  }

  return toBuzzerAnswer(data);
}

export async function judgeBuzzerAnswer(params: {
  gameSessionId: string;
  presenterPlayerId: string;
  buzzerAnswerId: string;
  isCorrect: boolean;
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
    throw new Error("只有当前出题人可以判定抢答。");
  }

  const currentSession = toGameSession(currentGameSession);

  if (currentSession.gameMode === "ROUND_REVEAL") {
    throw new Error("当前游戏不是抢答模式。");
  }

  const { data: firstPendingAnswer, error: pendingError } = await supabase
    .from("buzzer_answers")
    .select("*")
    .eq("game_session_id", currentGameSession.id)
    .eq("question_index", currentGameSession.current_question_index)
    .eq("reveal_round", currentGameSession.current_reveal_round)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true })
    .limit(1)
    .maybeSingle<DbBuzzerAnswer>();

  if (pendingError) {
    throw new Error(pendingError.message);
  }

  if (!firstPendingAnswer || firstPendingAnswer.id !== params.buzzerAnswerId) {
    throw new Error("请按抢答队列顺序判定。");
  }

  let scoreAwarded = 0;

  if (params.isCorrect) {
    if (currentSession.gameMode === "BUZZER_FIRST_CORRECT") {
      scoreAwarded = 1;
    } else {
      const [{ data: players, error: playersError }, { data: existingResults, error: resultsError }] = await Promise.all([
        supabase.from("players").select("id").eq("room_id", currentGameSession.room_id).returns<{ id: string }[]>(),
        supabase
          .from("question_results")
          .select("id")
          .eq("game_session_id", currentGameSession.id)
          .eq("question_index", currentGameSession.current_question_index)
          .returns<{ id: string }[]>(),
      ]);

      if (playersError) {
        throw new Error(playersError.message);
      }

      if (resultsError) {
        throw new Error(resultsError.message);
      }

      const guesserCount = (players ?? []).filter((player) => player.id !== currentGameSession.presenter_player_id).length;
      const correctRank = (existingResults?.length ?? 0) + 1;
      scoreAwarded = Math.max(1, guesserCount - correctRank + 1);
    }

    const { error: resultError } = await supabase.from("question_results").insert({
      game_session_id: currentGameSession.id,
      question_index: currentGameSession.current_question_index,
      player_id: firstPendingAnswer.player_id,
      scored_round: currentGameSession.current_reveal_round,
      score_awarded: scoreAwarded,
      judged_by_player_id: params.presenterPlayerId,
    });

    if (resultError && !isUniqueViolation(resultError)) {
      throw new Error(resultError.message);
    }

    if (!resultError) {
      await addScoreToPlayer({
        gameSessionId: currentGameSession.id,
        playerId: firstPendingAnswer.player_id,
        scoreAwarded,
      });
    }
  }

  const { error: updateError } = await supabase
    .from("buzzer_answers")
    .update({
      status: params.isCorrect ? "correct" : "wrong",
      score_awarded: scoreAwarded,
      judged_at: new Date().toISOString(),
      judged_by_player_id: params.presenterPlayerId,
    })
    .eq("id", firstPendingAnswer.id)
    .eq("status", "pending");

  if (updateError) {
    throw new Error(updateError.message);
  }

  const nextGameSession = await settleBuzzerRoundFromDb(currentGameSession);

  return {
    gameSession: nextGameSession,
    judgedAnswer: {
      ...toBuzzerAnswer(firstPendingAnswer),
      status: params.isCorrect ? "correct" as const : "wrong" as const,
      scoreAwarded,
      judgedAt: new Date().toISOString(),
      judgedByPlayerId: params.presenterPlayerId,
    },
  };
}

export async function settleBuzzerRound(params: {
  gameSessionId: string;
  presenterPlayerId: string;
}) {
  assertSupabaseEnv();

  const { data: currentGameSession, error } = await supabase
    .from("game_sessions")
    .select("*")
    .eq("id", params.gameSessionId)
    .eq("presenter_player_id", params.presenterPlayerId)
    .eq("status", "PLAYING")
    .maybeSingle<DbGameSession>();

  if (error) {
    throw new Error(error.message);
  }

  if (!currentGameSession) {
    throw new Error("只有当前出题人可以结算抢答轮次。");
  }

  const currentSession = toGameSession(currentGameSession);

  if (currentSession.gameMode === "ROUND_REVEAL") {
    throw new Error("当前游戏不是抢答模式。");
  }

  const roundEnded = Boolean(
    currentSession.roundStartedAt &&
      Date.now() - new Date(currentSession.roundStartedAt).getTime() >= currentSession.roundSeconds * 1000,
  );

  if (!roundEnded) {
    throw new Error("本轮抢答时间结束后才能结算。");
  }

  const nextGameSession = await settleBuzzerRoundFromDb(currentGameSession);

  return {
    gameSession: nextGameSession,
  };
}

export async function gradeAnswersAndAdvance(params: {
  gameSessionId: string;
  presenterPlayerId: string;
  correctPlayerIds: string[];
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
    throw new Error("只有当前出题人可以判分。");
  }

  if (!currentGameSession.round_started_at) {
    throw new Error("本轮还没有开始。");
  }

  const currentRound = currentGameSession.current_reveal_round;
  const questionIndex = currentGameSession.current_question_index;
  const currentSession = toGameSession(currentGameSession);
  const roundScore = currentSession.roundScores[currentRound - 1] ?? Math.max(1, currentSession.maxRevealRounds - currentRound + 1);
  const uniqueCorrectPlayerIds = Array.from(new Set(params.correctPlayerIds)).filter(
    (playerId) => playerId && playerId !== params.presenterPlayerId,
  );
  const newlyScoredPlayerIds: string[] = [];

  for (const correctPlayerId of uniqueCorrectPlayerIds) {
    const { error } = await supabase.from("question_results").insert({
      game_session_id: currentGameSession.id,
      question_index: questionIndex,
      player_id: correctPlayerId,
      scored_round: currentRound,
      score_awarded: roundScore,
      judged_by_player_id: params.presenterPlayerId,
    });

    if (error) {
      if (isUniqueViolation(error)) {
        continue;
      }

      throw new Error(error.message);
    }

    newlyScoredPlayerIds.push(correctPlayerId);
  }

  for (const scoredPlayerId of newlyScoredPlayerIds) {
    const { data: existingScore, error: scoreLoadError } = await supabase
      .from("player_scores")
      .select("*")
      .eq("game_session_id", currentGameSession.id)
      .eq("player_id", scoredPlayerId)
      .maybeSingle<DbPlayerScore>();

    if (scoreLoadError) {
      throw new Error(scoreLoadError.message);
    }

    const { error: scoreError } = await supabase.from("player_scores").upsert(
      {
        id: existingScore?.id,
        game_session_id: currentGameSession.id,
        player_id: scoredPlayerId,
        score: (existingScore?.score ?? 0) + roundScore,
        correct_count: (existingScore?.correct_count ?? 0) + 1,
      },
      {
        onConflict: "game_session_id,player_id",
      },
    );

    if (scoreError) {
      throw new Error(scoreError.message);
    }
  }

  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", currentGameSession.room_id)
    .returns<DbPlayer[]>();

  if (playersError) {
    throw new Error(playersError.message);
  }

  const guesserIds = (players ?? [])
    .filter((player) => player.id !== currentGameSession.presenter_player_id)
    .map((player) => player.id);

  const { data: questionResults, error: questionResultsError } = await supabase
    .from("question_results")
    .select("*")
    .eq("game_session_id", currentGameSession.id)
    .eq("question_index", questionIndex)
    .returns<DbQuestionResult[]>();

  if (questionResultsError) {
    throw new Error(questionResultsError.message);
  }

  const correctSet = new Set((questionResults ?? []).map((result) => result.player_id));
  const allPlayersCorrect = guesserIds.length > 0 && guesserIds.every((guesserId) => correctSet.has(guesserId));
  const shouldAdvanceQuestion = allPlayersCorrect || currentRound >= currentSession.maxRevealRounds;
  let nextGameSession: GameSession;

  if (shouldAdvanceQuestion) {
    const { data: reviewedGameSession, error: reviewError } = await supabase
      .from("game_sessions")
      .update({
        revealed_blocks: ALL_REVEALED_BLOCKS,
        round_started_at: null,
      })
      .eq("id", currentGameSession.id)
      .select()
      .single<DbGameSession>();

    if (reviewError) {
      throw new Error(reviewError.message);
    }

    nextGameSession = toGameSession(reviewedGameSession);
  } else {
    const { data: updatedGameSession, error: nextRoundError } = await supabase
      .from("game_sessions")
      .update({
        current_reveal_round: currentRound + 1,
        round_started_at: null,
      })
      .eq("id", currentGameSession.id)
      .select()
      .single<DbGameSession>();

    if (nextRoundError) {
      throw new Error(nextRoundError.message);
    }

    nextGameSession = toGameSession(updatedGameSession);
  }

  return {
    gameSession: nextGameSession,
    room: null,
    newlyScoredPlayerIds,
  };
}

export async function advanceReviewedQuestion(params: {
  gameSessionId: string;
  presenterPlayerId: string;
}) {
  assertSupabaseEnv();

  const { data: currentGameSession, error: currentError } = await supabase
    .from("game_sessions")
    .select("*")
    .eq("id", params.gameSessionId)
    .eq("status", "PLAYING")
    .maybeSingle<DbGameSession>();

  if (currentError) {
    throw new Error(currentError.message);
  }

  if (!currentGameSession) {
    throw new Error("当前游戏不在进行中。");
  }

  const { data: room, error: roomLoadError } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", currentGameSession.room_id)
    .eq("current_presenter_player_id", params.presenterPlayerId)
    .eq("current_game_id", currentGameSession.id)
    .eq("game_status", "PLAYING")
    .maybeSingle<DbRoom>();

  if (roomLoadError) {
    throw new Error(roomLoadError.message);
  }

  if (!room) {
    throw new Error("只有当前出题人可以切换到下一张图片。");
  }

  const currentSession = toGameSession(currentGameSession);
  const isReviewingQuestion =
    !currentSession.roundStartedAt && currentSession.revealedBlocks.length === ALL_REVEALED_BLOCKS.length;

  if (!isReviewingQuestion) {
    throw new Error("当前图片还没有进入完整展示阶段。");
  }

  const questions = await getQuestionsByQuestionSetId(currentGameSession.question_set_id);
  const nextQuestionIndex = currentGameSession.current_question_index + 1;

  if (nextQuestionIndex >= questions.length) {
    const { data: endedGameSession, error: endGameError } = await supabase
      .from("game_sessions")
      .update({
        status: "GAME_RESULT",
        ended_at: new Date().toISOString(),
      })
      .eq("id", currentGameSession.id)
      .select()
      .single<DbGameSession>();

    if (endGameError) {
      throw new Error(endGameError.message);
    }

    const { data: updatedRoom, error: roomError } = await supabase
      .from("rooms")
      .update({
        game_status: "GAME_RESULT",
      })
      .eq("id", currentGameSession.room_id)
      .eq("current_game_id", currentGameSession.id)
      .select()
      .single<DbRoom>();

    if (roomError) {
      throw new Error(roomError.message);
    }

    return {
      gameSession: toGameSession(endedGameSession),
      room: toRoom(updatedRoom),
    };
  }

  const { data: updatedGameSession, error } = await supabase
    .from("game_sessions")
    .update({
      current_question_index: nextQuestionIndex,
      current_reveal_round: 1,
      revealed_blocks: [],
      round_started_at: null,
    })
    .eq("id", currentGameSession.id)
    .select()
    .single<DbGameSession>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    gameSession: toGameSession(updatedGameSession),
    room: null,
  };
}

export async function updateQuestionLabel(params: {
  gameSessionId: string;
  presenterPlayerId: string;
  questionId: string;
  labelText: string;
  source: "manual" | "answer";
  answerId?: string | null;
}) {
  assertSupabaseEnv();

  const labelText = params.labelText.trim();

  if (!labelText) {
    throw new Error("标签不能为空。");
  }

  const { data: currentGameSession, error: currentError } = await supabase
    .from("game_sessions")
    .select("*")
    .eq("id", params.gameSessionId)
    .eq("status", "PLAYING")
    .maybeSingle<DbGameSession>();

  if (currentError) {
    throw new Error(currentError.message);
  }

  if (!currentGameSession) {
    throw new Error("当前游戏不在进行中。");
  }

  const { data: room, error: roomLoadError } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", currentGameSession.room_id)
    .eq("current_presenter_player_id", params.presenterPlayerId)
    .eq("current_game_id", currentGameSession.id)
    .eq("game_status", "PLAYING")
    .maybeSingle<DbRoom>();

  if (roomLoadError) {
    throw new Error(roomLoadError.message);
  }

  if (!room) {
    throw new Error("只有当前出题人可以补充图片标签。");
  }

  const currentSession = toGameSession(currentGameSession);
  const isReviewingQuestion =
    !currentSession.roundStartedAt && currentSession.revealedBlocks.length === ALL_REVEALED_BLOCKS.length;

  if (!isReviewingQuestion) {
    throw new Error("只能在完整展示图片时补充标签。");
  }

  const { data: question, error: questionError } = await supabase
    .from("questions")
    .select("*")
    .eq("id", params.questionId)
    .eq("question_set_id", currentGameSession.question_set_id)
    .eq("order_index", currentGameSession.current_question_index)
    .maybeSingle<DbQuestion>();

  if (questionError) {
    throw new Error(questionError.message);
  }

  if (!question) {
    throw new Error("没有找到当前图片。");
  }

  if (question.label_text?.trim()) {
    throw new Error("这张图片已经有标签，不能覆盖。");
  }

  let sourceAnswerId: string | null = null;

  if (params.source === "answer") {
    if (!params.answerId) {
      throw new Error("请选择一个玩家回答作为标签。");
    }

    const { data: answer, error: answerError } = await supabase
      .from("answers")
      .select("*")
      .eq("id", params.answerId)
      .eq("game_session_id", currentGameSession.id)
      .eq("question_index", currentGameSession.current_question_index)
      .maybeSingle<DbAnswer>();

    if (answerError) {
      throw new Error(answerError.message);
    }

    if (answer) {
      sourceAnswerId = answer.id;
    } else {
      const { data: buzzerAnswer, error: buzzerAnswerError } = await supabase
        .from("buzzer_answers")
        .select("*")
        .eq("id", params.answerId)
        .eq("game_session_id", currentGameSession.id)
        .eq("question_index", currentGameSession.current_question_index)
        .maybeSingle<DbBuzzerAnswer>();

      if (buzzerAnswerError) {
        throw new Error(buzzerAnswerError.message);
      }

      if (!buzzerAnswer) {
        throw new Error("没有找到这个玩家回答。");
      }

      sourceAnswerId = buzzerAnswer.id;
    }
  }

  const { data: updatedQuestion, error: updateError } = await supabase
    .from("questions")
    .update({
      label_text: labelText,
      label_source: params.source,
      label_source_answer_id: sourceAnswerId,
      label_updated_by_player_id: params.presenterPlayerId,
      label_updated_at: new Date().toISOString(),
    })
    .eq("id", question.id)
    .is("label_text", null)
    .select()
    .maybeSingle<DbQuestion>();

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (!updatedQuestion) {
    throw new Error("标签保存失败，可能已经被其他人补充。");
  }

  return toQuestion(updatedQuestion);
}

export async function skipCurrentQuestion(params: {
  gameSessionId: string;
  presenterPlayerId: string;
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
    throw new Error("只有当前出题人可以跳过本题。");
  }

  const questions = await getQuestionsByQuestionSetId(currentGameSession.question_set_id);
  const nextQuestionIndex = currentGameSession.current_question_index + 1;

  if (nextQuestionIndex >= questions.length) {
    const { data: endedGameSession, error: endGameError } = await supabase
      .from("game_sessions")
      .update({
        status: "GAME_RESULT",
        ended_at: new Date().toISOString(),
      })
      .eq("id", currentGameSession.id)
      .select()
      .single<DbGameSession>();

    if (endGameError) {
      throw new Error(endGameError.message);
    }

    const { data: updatedRoom, error: roomError } = await supabase
      .from("rooms")
      .update({
        game_status: "GAME_RESULT",
      })
      .eq("id", currentGameSession.room_id)
      .select()
      .single<DbRoom>();

    if (roomError) {
      throw new Error(roomError.message);
    }

    return {
      gameSession: toGameSession(endedGameSession),
      room: toRoom(updatedRoom),
    };
  }

  const { data: updatedGameSession, error } = await supabase
    .from("game_sessions")
    .update({
      current_question_index: nextQuestionIndex,
      current_reveal_round: 1,
      revealed_blocks: [],
      round_started_at: null,
    })
    .eq("id", currentGameSession.id)
    .select()
    .single<DbGameSession>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    gameSession: toGameSession(updatedGameSession),
    room: null,
  };
}

export async function endCurrentGameEarly(params: {
  gameSessionId: string;
  presenterPlayerId: string;
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
    throw new Error("只有当前出题人可以提前结束本局游戏。");
  }

  const endedAt = new Date().toISOString();
  const { data: endedGameSession, error: endGameError } = await supabase
    .from("game_sessions")
    .update({
      status: "GAME_RESULT",
      ended_at: endedAt,
    })
    .eq("id", currentGameSession.id)
    .eq("status", "PLAYING")
    .select()
    .single<DbGameSession>();

  if (endGameError) {
    throw new Error(endGameError.message);
  }

  const { data: updatedRoom, error: roomError } = await supabase
    .from("rooms")
    .update({
      game_status: "GAME_RESULT",
    })
    .eq("id", currentGameSession.room_id)
    .eq("current_game_id", currentGameSession.id)
    .select()
    .single<DbRoom>();

  if (roomError) {
    throw new Error(roomError.message);
  }

  return {
    gameSession: toGameSession(endedGameSession),
    room: toRoom(updatedRoom),
  };
}

export async function returnRoomToLobby(roomId: string, hostPlayerId: string) {
  assertSupabaseEnv();

  const { data: room, error } = await supabase
    .from("rooms")
    .update({
      current_presenter_player_id: null,
      current_game_id: null,
      prepared_question_set_id: null,
      game_status: "LOBBY",
    })
    .eq("id", roomId)
    .eq("host_player_id", hostPlayerId)
    .eq("game_status", "GAME_RESULT")
    .select()
    .maybeSingle<DbRoom>();

  if (error) {
    throw new Error(error.message);
  }

  if (!room) {
    throw new Error("只有房主可以在结算后回到房间大厅。");
  }

  return toRoom(room);
}
