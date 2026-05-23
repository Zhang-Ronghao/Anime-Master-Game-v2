"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { supabase } from "@/lib/supabaseClient";
import {
  advanceReviewedQuestion,
  confirmRevealBlocks,
  endCurrentGameEarly,
  getAnswersForQuestion,
  getAnswerForPlayerRound,
  getAnswersForQuestionRound,
  getGameSessionById,
  getPlayerScores,
  getQuestionResultsForQuestion,
  getQuestionsByQuestionSetId,
  gradeAnswersAndAdvance,
  skipCurrentQuestion,
  submitAnswer,
  updateQuestionLabel,
} from "@/lib/supabaseRooms";
import type { Answer, DbGameSession, DbQuestion, GameSession, PlayerScore, Question, QuestionResult, Room } from "@/types/game";

type ImageRevealGameProps = {
  room: Room;
  playerId: string;
  isPresenter: boolean;
  onError: (message: string) => void;
  onRoomUpdated?: (room: Room) => void;
};

const LANDSCAPE_GRID_COLUMNS = 9;
const PORTRAIT_GRID_COLUMNS = 5;
const TOTAL_BLOCKS = 45;
const DEFAULT_ROUND_SECONDS = 60;

function toGameSession(gameSession: DbGameSession): GameSession {
  const roundScores = Array.isArray(gameSession.round_scores)
    ? gameSession.round_scores.filter((score): score is number => Number.isFinite(score))
    : [3, 2, 1];

  return {
    id: gameSession.id,
    roomId: gameSession.room_id,
    questionSetId: gameSession.question_set_id,
    presenterPlayerId: gameSession.presenter_player_id,
    status: gameSession.status,
    currentQuestionIndex: gameSession.current_question_index,
    currentRevealRound: gameSession.current_reveal_round,
    revealedBlocks: Array.isArray(gameSession.revealed_blocks)
      ? Array.from(
          new Set(
            gameSession.revealed_blocks.filter(
              (block): block is number => Number.isInteger(block) && block >= 0 && block < TOTAL_BLOCKS,
            ),
          ),
        ).sort((a, b) => a - b)
      : [],
    maxRevealRounds: gameSession.max_reveal_rounds ?? 3,
    roundSeconds: gameSession.round_seconds ?? DEFAULT_ROUND_SECONDS,
    roundScores,
    roundStartedAt: gameSession.round_started_at,
    createdAt: gameSession.created_at,
    endedAt: gameSession.ended_at,
  };
}

function getRemainingSeconds(roundStartedAt?: string | null, roundSeconds = DEFAULT_ROUND_SECONDS) {
  if (!roundStartedAt) {
    return roundSeconds;
  }

  const elapsedSeconds = Math.floor((Date.now() - new Date(roundStartedAt).getTime()) / 1000);
  return Math.max(0, roundSeconds - elapsedSeconds);
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

export function ImageRevealGame({ room, playerId, isPresenter, onError, onRoomUpdated }: ImageRevealGameProps) {
  const [gameSession, setGameSession] = useState<GameSession | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [labelAnswers, setLabelAnswers] = useState<Answer[]>([]);
  const [myAnswer, setMyAnswer] = useState<Answer | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [scores, setScores] = useState<PlayerScore[]>([]);
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([]);
  const [selectedCorrectPlayerIds, setSelectedCorrectPlayerIds] = useState<string[]>([]);
  const [remainingSeconds, setRemainingSeconds] = useState(DEFAULT_ROUND_SECONDS);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirmingReveal, setIsConfirmingReveal] = useState(false);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [isAdvancingQuestion, setIsAdvancingQuestion] = useState(false);
  const [isEndingGame, setIsEndingGame] = useState(false);
  const [isSkippingQuestion, setIsSkippingQuestion] = useState(false);
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [isJudgeModalOpen, setIsJudgeModalOpen] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [isLabelPromptDisabledForGame, setIsLabelPromptDisabledForGame] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(16 / 9);
  const [isPortraitImage, setIsPortraitImage] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [lastAutoJudgeKey, setLastAutoJudgeKey] = useState("");
  const [lastAutoLabelKey, setLastAutoLabelKey] = useState("");

  const getPlayerName = useCallback(
    (targetPlayerId: string) => room.players.find((player) => player.id === targetPlayerId)?.nickname ?? targetPlayerId,
    [room.players],
  );

  const refreshRoundData = useCallback(
    async (targetGameSession: GameSession) => {
      const [nextScores, nextResults] = await Promise.all([
        getPlayerScores(targetGameSession.id),
        getQuestionResultsForQuestion({
          gameSessionId: targetGameSession.id,
          questionIndex: targetGameSession.currentQuestionIndex,
        }),
      ]);

      setScores(nextScores);
      setQuestionResults(nextResults);

      if (isPresenter) {
        const [nextAnswers, nextLabelAnswers] = await Promise.all([
          getAnswersForQuestionRound({
            gameSessionId: targetGameSession.id,
            questionIndex: targetGameSession.currentQuestionIndex,
            revealRound: targetGameSession.currentRevealRound,
          }),
          getAnswersForQuestion({
            gameSessionId: targetGameSession.id,
            questionIndex: targetGameSession.currentQuestionIndex,
          }),
        ]);
        setAnswers(nextAnswers);
        setLabelAnswers(nextLabelAnswers);
      } else {
        setLabelAnswers([]);
        const nextMyAnswer = await getAnswerForPlayerRound({
          gameSessionId: targetGameSession.id,
          questionIndex: targetGameSession.currentQuestionIndex,
          revealRound: targetGameSession.currentRevealRound,
          playerId,
        });
        setMyAnswer(nextMyAnswer);
        setAnswerText(nextMyAnswer?.answerText ?? "");
      }
    },
    [isPresenter, playerId],
  );

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
          setImageLoadFailed(false);
          setRemainingSeconds(getRemainingSeconds(loadedGameSession.roundStartedAt, loadedGameSession.roundSeconds));
          await refreshRoundData(loadedGameSession);
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
  }, [onError, refreshRoundData, room.currentGameId]);

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
          setImageLoadFailed(false);
          setSelectedBlocks([]);
          setSelectedCorrectPlayerIds([]);
          setRemainingSeconds(getRemainingSeconds(nextGameSession.roundStartedAt, nextGameSession.roundSeconds));
          refreshRoundData(nextGameSession).catch((error) => {
            onError(error instanceof Error ? error.message : "刷新游戏数据失败。");
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "player_scores",
          filter: `game_session_id=eq.${room.currentGameId}`,
        },
        () => {
          getPlayerScores(room.currentGameId ?? "")
            .then(setScores)
            .catch((error) => onError(error instanceof Error ? error.message : "刷新积分失败。"));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "question_results",
          filter: `game_session_id=eq.${room.currentGameId}`,
        },
        () => {
          if (!gameSession) {
            return;
          }

          refreshRoundData(gameSession).catch((error) => {
            onError(error instanceof Error ? error.message : "刷新判分结果失败。");
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "questions",
        },
        (payload) => {
          const nextQuestion = toQuestion(payload.new as DbQuestion);

          setQuestions((currentQuestions) =>
            currentQuestions.map((question) => (question.id === nextQuestion.id ? nextQuestion : question)),
          );
        },
      );

    if (isPresenter) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
          filter: `game_session_id=eq.${room.currentGameId}`,
        },
        () => {
          if (!gameSession) {
            return;
          }

          Promise.all([
            getAnswersForQuestionRound({
              gameSessionId: gameSession.id,
              questionIndex: gameSession.currentQuestionIndex,
              revealRound: gameSession.currentRevealRound,
            }),
            getAnswersForQuestion({
              gameSessionId: gameSession.id,
              questionIndex: gameSession.currentQuestionIndex,
            }),
          ])
            .then(([nextAnswers, nextLabelAnswers]) => {
              setAnswers(nextAnswers);
              setLabelAnswers(nextLabelAnswers);
            })
            .catch((error) => onError(error instanceof Error ? error.message : "刷新答案失败。"));
        },
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameSession, isPresenter, onError, refreshRoundData, room.currentGameId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds(getRemainingSeconds(gameSession?.roundStartedAt, gameSession?.roundSeconds));
    }, 500);

    return () => window.clearInterval(timer);
  }, [gameSession?.roundSeconds, gameSession?.roundStartedAt]);

  const currentQuestion = gameSession ? questions[gameSession.currentQuestionIndex] : null;
  const currentQuestionLabel = currentQuestion?.labelText?.trim() ?? "";
  const gridColumns = isPortraitImage ? PORTRAIT_GRID_COLUMNS : LANDSCAPE_GRID_COLUMNS;
  const gridRows = TOTAL_BLOCKS / gridColumns;
  const revealedBlockSet = useMemo(() => new Set(gameSession?.revealedBlocks ?? []), [gameSession?.revealedBlocks]);
  const selectedBlockSet = useMemo(() => new Set(selectedBlocks), [selectedBlocks]);
  const correctPlayerSet = useMemo(() => new Set(questionResults.map((result) => result.playerId)), [questionResults]);
  const maxRevealRounds = gameSession?.maxRevealRounds ?? 3;
  const currentRound = gameSession?.currentRevealRound ?? 1;
  const currentScore = gameSession?.roundScores[Math.min(maxRevealRounds, currentRound) - 1] ?? 1;
  const hasRoundStarted = Boolean(gameSession?.roundStartedAt);
  const isRoundActive = hasRoundStarted && remainingSeconds > 0;
  const isRoundEnded = hasRoundStarted && remainingSeconds === 0;
  const isQuestionReviewing = !hasRoundStarted && revealedBlockSet.size === TOTAL_BLOCKS;
  const shouldShowQuestionLabel = Boolean(currentQuestion) && (isPresenter || isQuestionReviewing);
  const hasNextQuestion = gameSession ? gameSession.currentQuestionIndex + 1 < questions.length : false;
  const isCurrentPlayerCorrect = correctPlayerSet.has(playerId);
  const guessers = room.players.filter((player) => player.id !== room.currentPresenterPlayerId);
  const activeGuessers = guessers.filter((player) => !correctPlayerSet.has(player.id));
  const currentRoundAnswerPlayerSet = useMemo(() => new Set(answers.map((answer) => answer.playerId)), [answers]);
  const allActiveGuessersSubmitted =
    activeGuessers.length > 0 && activeGuessers.every((player) => currentRoundAnswerPlayerSet.has(player.id));
  const scoreRows = room.players
    .filter((player) => player.id !== room.currentPresenterPlayerId)
    .map((player) => ({
      player,
      score: scores.find((score) => score.playerId === player.id)?.score ?? 0,
      correctCount: scores.find((score) => score.playerId === player.id)?.correctCount ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
  const canConfirmReveal =
    isPresenter &&
    selectedBlocks.length > 0 &&
    !isConfirmingReveal &&
    !isQuestionReviewing &&
    Boolean(gameSession) &&
    (!gameSession?.roundStartedAt || remainingSeconds === 0) &&
    currentRound <= maxRevealRounds;
  const canSubmitAnswer =
    !isPresenter && !isQuestionReviewing && !isCurrentPlayerCorrect && isRoundActive && answerText.trim().length > 0;
  const canGrade = isPresenter && !isQuestionReviewing && hasRoundStarted && Boolean(gameSession);
  const canAddQuestionLabel = isPresenter && isQuestionReviewing && Boolean(gameSession) && Boolean(currentQuestion) && !currentQuestionLabel;

  useEffect(() => {
    setLabelInput("");
    setIsLabelModalOpen(false);
  }, [currentQuestion?.id, currentQuestionLabel]);

  useEffect(() => {
    setIsLabelPromptDisabledForGame(false);
    setLastAutoLabelKey("");
  }, [gameSession?.id]);

  useEffect(() => {
    if (!gameSession || !canGrade || isJudgeModalOpen || isGrading) {
      return;
    }

    const shouldAutoOpenJudge = isRoundEnded || allActiveGuessersSubmitted;
    const autoJudgeKey = `${gameSession.id}:${gameSession.currentQuestionIndex}:${gameSession.currentRevealRound}`;

    if (shouldAutoOpenJudge && lastAutoJudgeKey !== autoJudgeKey) {
      setIsJudgeModalOpen(true);
      setLastAutoJudgeKey(autoJudgeKey);
    }
  }, [allActiveGuessersSubmitted, canGrade, gameSession, isGrading, isJudgeModalOpen, isRoundEnded, lastAutoJudgeKey]);

  useEffect(() => {
    if (!gameSession || !canAddQuestionLabel || isJudgeModalOpen || isLabelModalOpen || isLabelPromptDisabledForGame) {
      return;
    }

    const autoLabelKey = `${gameSession.id}:${gameSession.currentQuestionIndex}`;

    if (lastAutoLabelKey !== autoLabelKey) {
      setIsLabelModalOpen(true);
      setLastAutoLabelKey(autoLabelKey);
    }
  }, [canAddQuestionLabel, gameSession, isJudgeModalOpen, isLabelModalOpen, isLabelPromptDisabledForGame, lastAutoLabelKey]);

  async function saveQuestionLabel(params: { labelText: string; source: "manual" | "answer"; answerId?: string | null }) {
    if (!gameSession || !currentQuestion || !canAddQuestionLabel) {
      return;
    }

    setIsSavingLabel(true);
    try {
      const updatedQuestion = await updateQuestionLabel({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
        questionId: currentQuestion.id,
        labelText: params.labelText,
        source: params.source,
        answerId: params.answerId,
      });

      setQuestions((currentQuestions) =>
        currentQuestions.map((question) => (question.id === updatedQuestion.id ? updatedQuestion : question)),
      );
      setLabelInput("");
      setIsLabelModalOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "保存图片标签失败。");
    } finally {
      setIsSavingLabel(false);
    }
  }

  function handleSaveManualLabel() {
    const nextLabel = labelInput.trim();

    if (!nextLabel) {
      onError("请先输入标签。");
      return;
    }

    void saveQuestionLabel({ labelText: nextLabel, source: "manual" });
  }

  function handleUseAnswerAsLabel(answer: Answer) {
    void saveQuestionLabel({ labelText: answer.answerText, source: "answer", answerId: answer.id });
  }

  function handleDisableLabelPromptForGame() {
    setIsLabelPromptDisabledForGame(true);
    setIsLabelModalOpen(false);
  }

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

  function toggleCorrectPlayer(targetPlayerId: string) {
    if (correctPlayerSet.has(targetPlayerId)) {
      return;
    }

    setSelectedCorrectPlayerIds((currentIds) =>
      currentIds.includes(targetPlayerId)
        ? currentIds.filter((id) => id !== targetPlayerId)
        : [...currentIds, targetPlayerId],
    );
  }

  async function handleConfirmReveal() {
    if (!gameSession || selectedBlocks.length === 0) {
      return;
    }

    setIsConfirmingReveal(true);
    try {
      const updatedGameSession = await confirmRevealBlocks({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
        selectedBlocks,
      });
      setGameSession(updatedGameSession);
      setSelectedBlocks([]);
      setRemainingSeconds(getRemainingSeconds(updatedGameSession.roundStartedAt, updatedGameSession.roundSeconds));
      await refreshRoundData(updatedGameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "确认揭露失败。");
    } finally {
      setIsConfirmingReveal(false);
    }
  }

  async function handleSubmitAnswer() {
    if (!gameSession) {
      return;
    }

    setIsSubmittingAnswer(true);
    try {
      const submitted = await submitAnswer({
        gameSessionId: gameSession.id,
        playerId,
        answerText,
      });
      setMyAnswer(submitted);
      setAnswerText(submitted.answerText);
    } catch (error) {
      onError(error instanceof Error ? error.message : "提交答案失败。");
    } finally {
      setIsSubmittingAnswer(false);
    }
  }

  async function handleGradeAnswers() {
    if (!gameSession) {
      return;
    }

    setIsGrading(true);
    try {
      const graded = await gradeAnswersAndAdvance({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
        correctPlayerIds: selectedCorrectPlayerIds,
      });
      setGameSession(graded.gameSession);
      setImageLoadFailed(false);
      setSelectedCorrectPlayerIds([]);
      setSelectedBlocks([]);
      setRemainingSeconds(getRemainingSeconds(graded.gameSession.roundStartedAt, graded.gameSession.roundSeconds));

      if (graded.room) {
        onRoomUpdated?.(graded.room);
      }

      await refreshRoundData(graded.gameSession);
      setIsJudgeModalOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "确认判分失败。");
    } finally {
      setIsGrading(false);
    }
  }

  async function handleSkipQuestion() {
    if (!gameSession) {
      return;
    }

    const confirmed = window.confirm("确定跳过当前图片吗？");

    if (!confirmed) {
      return;
    }

    setIsSkippingQuestion(true);
    try {
      const skipped = await skipCurrentQuestion({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
      });
      setGameSession(skipped.gameSession);
      setImageLoadFailed(false);
      setSelectedBlocks([]);
      setSelectedCorrectPlayerIds([]);
      setRemainingSeconds(getRemainingSeconds(skipped.gameSession.roundStartedAt, skipped.gameSession.roundSeconds));

      if (skipped.room) {
        onRoomUpdated?.(skipped.room);
      }

      await refreshRoundData(skipped.gameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "跳过本题失败。");
    } finally {
      setIsSkippingQuestion(false);
    }
  }

  async function handleAdvanceReviewedQuestion() {
    if (!gameSession || !isPresenter || !isQuestionReviewing) {
      return;
    }

    setIsAdvancingQuestion(true);
    try {
      const advanced = await advanceReviewedQuestion({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
      });
      setGameSession(advanced.gameSession);
      setImageLoadFailed(false);
      setSelectedBlocks([]);
      setSelectedCorrectPlayerIds([]);
      setRemainingSeconds(getRemainingSeconds(advanced.gameSession.roundStartedAt, advanced.gameSession.roundSeconds));

      if (advanced.room) {
        onRoomUpdated?.(advanced.room);
      }

      await refreshRoundData(advanced.gameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "切换图片失败。");
    } finally {
      setIsAdvancingQuestion(false);
    }
  }

  async function handleEndGameEarly() {
    if (!gameSession) {
      return;
    }

    const confirmed = window.confirm("确定要提前结束本局游戏并进入排行榜吗？");

    if (!confirmed) {
      return;
    }

    setIsEndingGame(true);
    try {
      const ended = await endCurrentGameEarly({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
      });
      setGameSession(ended.gameSession);
      onRoomUpdated?.(ended.room);
    } catch (error) {
      onError(error instanceof Error ? error.message : "提前结束本局失败。");
    } finally {
      setIsEndingGame(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-[var(--muted)]">正在加载当前题目...</p>;
  }

  if (!gameSession || !currentQuestion) {
    return <p className="text-sm text-red-700">没有找到当前游戏题目。</p>;
  }

  const currentPlayerName = room.players.find((player) => player.id === playerId)?.nickname ?? "未设置昵称";
  const playingGridClass = "grid gap-4 lg:grid-cols-6";

  const scorePanel = (
    <div className="rounded-md border border-[var(--line)] bg-white p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <p className="mb-2 text-sm font-semibold text-slate-900">实时积分榜</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {scoreRows.map(({ player, score, correctCount }, index) => (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm" key={player.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 font-semibold text-slate-950">
                #{index + 1} {player.nickname}
              </div>
              <div className="shrink-0 font-semibold text-[var(--primary)]">{score}</div>
            </div>
            <div className="mt-1 text-[var(--muted)]">答对 {correctCount} 题</div>
          </div>
        ))}
      </div>
    </div>
  );

  const imagePanel = (
    <div className="bg-white">
      <div
        className="relative mx-auto max-h-[78vh] w-full max-w-[1280px] overflow-hidden rounded-md bg-black"
        style={{
          aspectRatio: imageAspectRatio,
          maxWidth: isPortraitImage ? `min(1280px, calc(78vh * ${imageAspectRatio}))` : "1280px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          className="h-full w-full object-cover"
          src={currentQuestion.imageUrl}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setImageAspectRatio(image.naturalWidth / image.naturalHeight);
              setIsPortraitImage(image.naturalHeight > image.naturalWidth);
            }
          }}
          onError={() => setImageLoadFailed(true)}
        />

        {imageLoadFailed ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-slate-950 px-4 text-center text-white">
            <div>
              <p className="text-lg font-semibold">图片加载失败</p>
              <p className="mt-2 text-sm text-slate-300">可能是图片 URL 失效、跨域限制或网络异常。</p>
              {isPresenter ? (
                <Button className="mt-4" type="button" variant="secondary" onClick={handleSkipQuestion} disabled={isSkippingQuestion}>
                  {isSkippingQuestion ? "跳过中..." : "跳过本题"}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!isPresenter && !imageLoadFailed ? (
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: TOTAL_BLOCKS }, (_, blockIndex) => (
              <div className={revealedBlockSet.has(blockIndex) ? "bg-transparent" : "bg-black"} key={blockIndex} />
            ))}
          </div>
        ) : null}

        {isPresenter && !imageLoadFailed ? (
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
            }}
          >
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
      {shouldShowQuestionLabel ? (
        <div className="mx-auto mt-3 max-w-[1280px] rounded-md border border-[var(--line)] bg-slate-50 px-4 py-3 text-sm">
          <span className="font-semibold text-slate-950">图片标签：</span>
          <span className={currentQuestionLabel ? "text-slate-900" : "text-[var(--muted)]"}>
            {currentQuestionLabel || "暂无标签"}
          </span>
        </div>
      ) : null}
    </div>
  );

  const actionPanel = (
    <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      {isQuestionReviewing ? (
        <>
          <p className="text-sm font-semibold text-slate-950">本题已结束，当前展示完整图片。</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {isPresenter ? "确认后切换到下一阶段。" : "等待出题人切换到下一阶段。"}
          </p>
          <div className="mt-3 rounded-md border border-[var(--line)] bg-white p-3 text-sm">
            <p className="font-semibold text-slate-950">图片标签</p>
            <p className="mt-1 text-[var(--muted)]">{currentQuestionLabel || "暂无标签"}</p>
          </div>
          {canAddQuestionLabel ? (
            <Button className="mt-3 w-full" type="button" variant="secondary" onClick={() => setIsLabelModalOpen(true)}>
              补充图片标签
            </Button>
          ) : null}
          {isPresenter ? (
            <Button className="mt-3 w-full" type="button" onClick={handleAdvanceReviewedQuestion} disabled={isAdvancingQuestion}>
              {isAdvancingQuestion ? "切换中..." : hasNextQuestion ? "下一张图片" : "查看排行榜"}
            </Button>
          ) : null}
        </>
      ) : isPresenter ? (
        <>
          <p className="text-sm font-semibold text-slate-950">出题人操作</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            已揭露 {revealedBlockSet.size} / {TOTAL_BLOCKS} 块，本轮已选择 {selectedBlocks.length} 块。
          </p>
          <div className="mt-3 grid gap-2">
            <Button type="button" onClick={handleConfirmReveal} disabled={!canConfirmReveal}>
              {isConfirmingReveal ? "确认中..." : "确认揭露"}
            </Button>
            <Button type="button" onClick={() => setIsJudgeModalOpen(true)} disabled={!hasRoundStarted}>
              判分
            </Button>
            <Button type="button" variant="secondary" onClick={handleSkipQuestion} disabled={isSkippingQuestion}>
              {isSkippingQuestion ? "跳过中..." : "跳过本题"}
            </Button>
            <Button type="button" variant="secondary" onClick={handleEndGameEarly} disabled={isEndingGame}>
              {isEndingGame ? "结束中..." : "结束本局游戏"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm">
            <span className="text-[var(--muted)]">倒计时</span>
            <span className="font-semibold text-slate-950">{hasRoundStarted ? `${remainingSeconds} 秒` : "等待开始"}</span>
          </div>
          {isCurrentPlayerCorrect ? (
            <p className="text-sm font-semibold text-emerald-700">你已答对本题，后续轮次无需继续作答。</p>
          ) : !hasRoundStarted ? (
            <p className="text-sm text-[var(--muted)]">等待出题人揭露图片后开始答题。</p>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-900">你的答案</span>
                <input
                  className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                  disabled={!isRoundActive}
                  maxLength={80}
                  placeholder="输入动画名称"
                  value={answerText}
                  onChange={(event) => setAnswerText(event.target.value)}
                />
              </label>
              <Button className="w-full" type="button" onClick={handleSubmitAnswer} disabled={!canSubmitAnswer || isSubmittingAnswer}>
                {isSubmittingAnswer ? "提交中..." : myAnswer ? "修改答案" : "提交答案"}
              </Button>
              <p className="text-sm text-[var(--muted)]">
                {myAnswer ? `已提交：${myAnswer.answerText}` : "本轮尚未提交答案"}
                {isRoundEnded ? "，本轮已结束" : ""}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={`${playingGridClass} text-sm`}>
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-3">
          <p className="text-[var(--muted)]">房间 / 当前玩家</p>
          <p className="mt-1 truncate text-lg font-semibold text-slate-950">房间 {room.code}</p>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">
            {currentPlayerName}
            {playerId === room.hostPlayerId ? <span className="ml-2 rounded bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">房主</span> : null}
          </p>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-3">
          <p className="text-[var(--muted)]">当前题号</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            {gameSession.currentQuestionIndex + 1} / {questions.length}
          </p>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-3">
          <p className="text-[var(--muted)]">当前轮次</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            第 {currentRound} / {maxRevealRounds} 轮
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
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-3">
          <p className="text-[var(--muted)]">已答对</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            {questionResults.length} / {guessers.length}
          </p>
        </div>
      </div>

      <div className={playingGridClass}>
        {scorePanel}
        <div className="min-w-0 lg:col-span-4">{imagePanel}</div>
        {actionPanel}
      </div>

      {isLabelModalOpen && canAddQuestionLabel ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 px-4 py-6">
          <div className="w-full max-w-3xl overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-2xl">
            <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-start">
              <div>
                <p className="text-lg font-semibold text-slate-950">补充图片标签</p>
                <p className="mt-1 text-sm text-[var(--muted)]">可以选择一个玩家回答作为标签，或手动输入。保存后不能覆盖。</p>
              </div>
              <button
                className="self-start rounded-md border border-[var(--line)] px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                type="button"
                onClick={() => setIsLabelModalOpen(false)}
              >
                关闭
              </button>
            </div>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-950">选择玩家回答</p>
                <div className="mt-2 space-y-2">
                  {labelAnswers.length > 0 ? (
                    labelAnswers.map((answer) => (
                      <button
                        className="w-full rounded-md border border-[var(--line)] bg-slate-50 px-3 py-2 text-left text-sm transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSavingLabel}
                        key={answer.id}
                        type="button"
                        onClick={() => handleUseAnswerAsLabel(answer)}
                      >
                        <span className="block font-semibold text-slate-950">{getPlayerName(answer.playerId)}</span>
                        <span className="mt-1 block text-[var(--muted)]">{answer.answerText}</span>
                      </button>
                    ))
                  ) : (
                    <p className="rounded-md border border-[var(--line)] bg-slate-50 px-3 py-2 text-sm text-[var(--muted)]">
                      本题还没有可选择的玩家回答。
                    </p>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-950">手动输入标签</span>
                <input
                  className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                  maxLength={80}
                  placeholder="例如：动画名称"
                  value={labelInput}
                  onChange={(event) => setLabelInput(event.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-col justify-between gap-3 border-t border-[var(--line)] bg-slate-50 px-5 py-4 sm:flex-row sm:items-center">
              <Button type="button" variant="secondary" onClick={handleDisableLabelPromptForGame}>
                本局游戏不再弹出该窗口
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="secondary" onClick={() => setIsLabelModalOpen(false)}>
                  稍后再说
                </Button>
                <Button type="button" onClick={handleSaveManualLabel} disabled={isSavingLabel || !labelInput.trim()}>
                  {isSavingLabel ? "保存中..." : "保存标签"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isJudgeModalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 px-4 py-6">
          <div className="w-full max-w-3xl overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-2xl">
            <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-lg font-semibold text-slate-950">本轮答案与判分</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  可以随时勾选答对玩家并确认判分。未勾选也可以确认，用于进入下一轮。
                </p>
              </div>
              <button
                className="self-start rounded-md border border-[var(--line)] px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                type="button"
                onClick={() => setIsJudgeModalOpen(false)}
              >
                关闭
              </button>
            </div>

            <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
              {guessers.map((player) => {
                const answer = answers.find((item) => item.playerId === player.id);
                const alreadyCorrect = correctPlayerSet.has(player.id);

                return (
                  <label
                    className="flex items-start gap-3 rounded-md border border-[var(--line)] bg-slate-50 p-3 text-sm"
                    key={player.id}
                  >
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={alreadyCorrect || selectedCorrectPlayerIds.includes(player.id)}
                      disabled={alreadyCorrect || !hasRoundStarted}
                      onChange={() => toggleCorrectPlayer(player.id)}
                    />
                    <span>
                      <span className="block font-semibold text-slate-950">
                        {player.nickname}
                        {alreadyCorrect ? "（已答对）" : ""}
                      </span>
                      <span className="mt-1 block text-[var(--muted)]">{answer?.answerText || "本轮未提交"}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex flex-col justify-between gap-3 border-t border-[var(--line)] bg-slate-50 px-5 py-4 sm:flex-row sm:items-center">
              <p className="text-sm text-[var(--muted)]">
                已选择 {selectedCorrectPlayerIds.length} 名玩家，本轮分值 {currentScore} 分。
              </p>
              <Button type="button" onClick={handleGradeAnswers} disabled={!canGrade || isGrading}>
                {isGrading ? "判分中..." : "确认判分"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
