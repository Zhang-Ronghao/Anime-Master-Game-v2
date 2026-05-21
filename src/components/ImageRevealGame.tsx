"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { supabase } from "@/lib/supabaseClient";
import { confirmRevealBlocks, getGameSessionById, getQuestionsByQuestionSetId } from "@/lib/supabaseRooms";
import type { DbGameSession, GameSession, Question, Room } from "@/types/game";

type ImageRevealGameProps = {
  room: Room;
  playerId: string;
  isPresenter: boolean;
  onError: (message: string) => void;
};

const GRID_ROWS = 4;
const GRID_COLUMNS = 7;
const TOTAL_BLOCKS = GRID_COLUMNS * GRID_ROWS;
const MAX_REVEAL_ROUND = 3;
const ROUND_SECONDS = 30;
const ROUND_SCORES = [3, 2, 1];

function toGameSession(gameSession: DbGameSession): GameSession {
  return {
    id: gameSession.id,
    roomId: gameSession.room_id,
    questionSetId: gameSession.question_set_id,
    presenterPlayerId: gameSession.presenter_player_id,
    status: gameSession.status,
    currentQuestionIndex: gameSession.current_question_index,
    currentRevealRound: gameSession.current_reveal_round,
    revealedBlocks: Array.isArray(gameSession.revealed_blocks)
      ? gameSession.revealed_blocks.filter((block): block is number => Number.isInteger(block))
      : [],
    roundStartedAt: gameSession.round_started_at,
    createdAt: gameSession.created_at,
    endedAt: gameSession.ended_at,
  };
}

function getRemainingSeconds(roundStartedAt?: string | null) {
  if (!roundStartedAt) {
    return ROUND_SECONDS;
  }

  const elapsedSeconds = Math.floor((Date.now() - new Date(roundStartedAt).getTime()) / 1000);
  return Math.max(0, ROUND_SECONDS - elapsedSeconds);
}

export function ImageRevealGame({ room, playerId, isPresenter, onError }: ImageRevealGameProps) {
  const [gameSession, setGameSession] = useState<GameSession | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<number[]>([]);
  const [remainingSeconds, setRemainingSeconds] = useState(ROUND_SECONDS);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadGame() {
      if (!room.currentGameId) {
        return;
      }

      setIsLoading(true);
      try {
        const loadedGameSession = await getGameSessionById(room.currentGameId);

        if (!loadedGameSession) {
          onError("当前游戏不存在。");
          return;
        }

        const loadedQuestions = await getQuestionsByQuestionSetId(loadedGameSession.questionSetId);

        if (isMounted) {
          setGameSession(loadedGameSession);
          setQuestions(loadedQuestions);
          setRemainingSeconds(getRemainingSeconds(loadedGameSession.roundStartedAt));
        }
      } catch (error) {
        if (isMounted) {
          onError(error instanceof Error ? error.message : "加载游戏失败。");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadGame();

    return () => {
      isMounted = false;
    };
  }, [onError, room.currentGameId]);

  useEffect(() => {
    if (!room.currentGameId) {
      return;
    }

    const channel = supabase
      .channel(`game-session:${room.currentGameId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_sessions",
          filter: `id=eq.${room.currentGameId}`,
        },
        (payload) => {
          const nextGameSession = toGameSession(payload.new as DbGameSession);
          setGameSession(nextGameSession);
          setSelectedBlocks([]);
          setRemainingSeconds(getRemainingSeconds(nextGameSession.roundStartedAt));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room.currentGameId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds(getRemainingSeconds(gameSession?.roundStartedAt));
    }, 500);

    return () => window.clearInterval(timer);
  }, [gameSession?.roundStartedAt]);

  const currentQuestion = gameSession ? questions[gameSession.currentQuestionIndex] : null;
  const revealedBlockSet = useMemo(() => new Set(gameSession?.revealedBlocks ?? []), [gameSession?.revealedBlocks]);
  const selectedBlockSet = useMemo(() => new Set(selectedBlocks), [selectedBlocks]);
  const currentRound = gameSession?.currentRevealRound ?? 1;
  const currentScore = ROUND_SCORES[Math.min(MAX_REVEAL_ROUND, currentRound) - 1] ?? 1;
  const canConfirm =
    isPresenter &&
    selectedBlocks.length > 0 &&
    !isConfirming &&
    Boolean(gameSession) &&
    (!gameSession?.roundStartedAt || remainingSeconds === 0) &&
    currentRound <= MAX_REVEAL_ROUND;

  function toggleBlock(blockIndex: number) {
    if (
      !isPresenter ||
      revealedBlockSet.has(blockIndex) ||
      (remainingSeconds > 0 && Boolean(gameSession?.roundStartedAt))
    ) {
      return;
    }

    setSelectedBlocks((currentBlocks) =>
      currentBlocks.includes(blockIndex)
        ? currentBlocks.filter((block) => block !== blockIndex)
        : [...currentBlocks, blockIndex].sort((a, b) => a - b),
    );
  }

  async function handleConfirmReveal() {
    if (!gameSession || selectedBlocks.length === 0) {
      return;
    }

    setIsConfirming(true);
    try {
      const updatedGameSession = await confirmRevealBlocks({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
        selectedBlocks,
      });
      setGameSession(updatedGameSession);
      setSelectedBlocks([]);
      setRemainingSeconds(getRemainingSeconds(updatedGameSession.roundStartedAt));
    } catch (error) {
      onError(error instanceof Error ? error.message : "确认揭露失败。");
    } finally {
      setIsConfirming(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-[var(--muted)]">正在加载当前题目...</p>;
  }

  if (!gameSession || !currentQuestion) {
    return <p className="text-sm text-red-700">没有找到当前游戏题目。</p>;
  }

  const waitingForNextRound = Boolean(gameSession.roundStartedAt) && remainingSeconds === 0 && currentRound < MAX_REVEAL_ROUND;
  const maxRoundReached = Boolean(gameSession.roundStartedAt) && remainingSeconds === 0 && currentRound >= MAX_REVEAL_ROUND;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-3">
          <p className="text-[var(--muted)]">当前题号</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            {gameSession.currentQuestionIndex + 1} / {questions.length}
          </p>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-3">
          <p className="text-[var(--muted)]">当前轮次</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            第 {currentRound} / {MAX_REVEAL_ROUND} 轮
          </p>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-3">
          <p className="text-[var(--muted)]">本轮分数</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{currentScore} 分</p>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-3">
          <p className="text-[var(--muted)]">倒计时</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{remainingSeconds} 秒</p>
        </div>
      </div>

      <div className="bg-white">
        <div className="relative mx-auto aspect-video max-h-[78vh] w-full max-w-[1280px] overflow-hidden rounded-md bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" className="h-full w-full object-cover" src={currentQuestion.imageUrl} />

          {!isPresenter ? (
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))` }}>
              {Array.from({ length: TOTAL_BLOCKS }, (_, blockIndex) => (
                <div className={revealedBlockSet.has(blockIndex) ? "bg-transparent" : "bg-black"} key={blockIndex} />
              ))}
            </div>
          ) : null}

          {isPresenter ? (
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))` }}>
              {Array.from({ length: TOTAL_BLOCKS }, (_, blockIndex) => {
                const isRevealed = revealedBlockSet.has(blockIndex);
                const isSelected = selectedBlockSet.has(blockIndex);

                return (
                  <button
                    aria-label={`块 ${blockIndex + 1}`}
                    className={[
                      "border border-white/60 transition",
                      isRevealed ? "bg-emerald-400/30" : "",
                      isSelected ? "bg-rose-500/45" : "",
                      !isRevealed && !isSelected ? "hover:bg-rose-300/25" : "",
                    ].join(" ")}
                    disabled={isRevealed || (Boolean(gameSession.roundStartedAt) && remainingSeconds > 0)}
                    key={blockIndex}
                    type="button"
                    onClick={() => toggleBlock(blockIndex)}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {isPresenter ? (
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
          <p className="text-sm text-[var(--muted)]">
            已揭露 {revealedBlockSet.size} / {TOTAL_BLOCKS} 块，本轮已选择 {selectedBlocks.length} 块。
            {waitingForNextRound ? " 可以选择下一轮要揭露的块。" : null}
            {maxRoundReached ? " 本题已达到 3 轮上限。" : null}
          </p>
          <Button className="mt-3" type="button" onClick={handleConfirmReveal} disabled={!canConfirm}>
            {isConfirming ? "确认中..." : "确认揭露"}
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-[var(--line)] bg-slate-50 p-4 text-sm text-[var(--muted)]">
          等待出题人揭露更多图片区域。
        </p>
      )}
    </div>
  );
}
