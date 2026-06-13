"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/Button";
import { subscribeRealtimeTopic } from "@/lib/cloudflareClient";
import {
  advanceReviewedQuestion,
  confirmRevealBlocks,
  endCurrentGameEarly,
  finalizeTeamBattleVote,
  getAnswersForQuestion,
  getAnswerForPlayerRound,
  getAnswersForQuestionRound,
  getBuzzerAnswerForPlayerRound,
  getBuzzerAnswersForQuestion,
  getBuzzerAnswersForQuestionRound,
  getGameSessionById,
  getPlayerScores,
  getQuestionResultsForQuestion,
  getQuestionsByQuestionSetId,
  gradeAnswersAndAdvance,
  judgeTeamBattleGuess,
  judgeBuzzerAnswer,
  revealTeamBattleAnswer,
  settleBuzzerRound,
  skipCurrentQuestion,
  submitAnswer,
  submitBuzzerAnswer,
  submitTeamBattleGuessVote,
  submitTeamBattleRevealVote,
  updateQuestionLabel,
} from "@/lib/cloudflareRooms";
import type {
  Answer,
  BuzzerAnswer,
  DbAnswer,
  DbBuzzerAnswer,
  DbGameSession,
  DbQuestion,
  GameSession,
  PlayerScore,
  Question,
  QuestionResult,
  Room,
  TeamBattleGuessVote,
  TeamBattleTeam,
} from "@/types/game";

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
    gameMode: gameSession.game_mode ?? "ROUND_REVEAL",
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
  return Math.min(roundSeconds, Math.max(0, roundSeconds - elapsedSeconds));
}

function getTeamName(team: TeamBattleTeam) {
  return team === "red" ? "红队" : "蓝队";
}

function getOpposingTeam(team: TeamBattleTeam): TeamBattleTeam {
  return team === "red" ? "blue" : "red";
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

type AnswerBubble = {
  id: string;
  text: string;
  left: number;
  top: number;
  width: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isGameSession(value: unknown): value is GameSession {
  return isRecord(value) && typeof value.id === "string" && typeof value.roomId === "string" && "currentQuestionIndex" in value;
}

function isAnswer(value: unknown): value is Answer {
  return isRecord(value) && typeof value.id === "string" && typeof value.gameSessionId === "string" && "answerText" in value && "submittedAt" in value;
}

function isBuzzerAnswer(value: unknown): value is BuzzerAnswer {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.gameSessionId === "string" &&
    "answerText" in value &&
    "submittedAt" in value &&
    typeof value.status === "string" &&
    "scoreAwarded" in value
  );
}

function isQuestion(value: unknown): value is Question {
  return isRecord(value) && typeof value.id === "string" && typeof value.questionSetId === "string" && "orderIndex" in value;
}

function getBroadcastGameSession(result: unknown) {
  if (isGameSession(result)) {
    return result;
  }

  if (isRecord(result) && isGameSession(result.gameSession)) {
    return result.gameSession;
  }

  return null;
}

function getBroadcastAnswer(result: unknown) {
  return isAnswer(result) && !isBuzzerAnswer(result) ? result : null;
}

function getBroadcastBuzzerAnswer(result: unknown) {
  if (isBuzzerAnswer(result)) {
    return result;
  }

  if (isRecord(result) && isBuzzerAnswer(result.judgedAnswer)) {
    return result.judgedAnswer;
  }

  return null;
}

function getBroadcastQuestion(result: unknown) {
  return isQuestion(result) ? result : null;
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  return items.some((currentItem) => currentItem.id === item.id)
    ? items.map((currentItem) => (currentItem.id === item.id ? item : currentItem))
    : [...items, item];
}

export function ImageRevealGame({ room, playerId, isPresenter, onError, onRoomUpdated }: ImageRevealGameProps) {
  const [gameSession, setGameSession] = useState<GameSession | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<number[]>([]);
  const [teamSelectedBlocks, setTeamSelectedBlocks] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [answerBubbles, setAnswerBubbles] = useState<Record<string, AnswerBubble>>({});
  const [buzzerAnswers, setBuzzerAnswers] = useState<BuzzerAnswer[]>([]);
  const [myBuzzerAnswer, setMyBuzzerAnswer] = useState<BuzzerAnswer | null>(null);
  const [labelAnswers, setLabelAnswers] = useState<Answer[]>([]);
  const [myAnswer, setMyAnswer] = useState<Answer | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [teamGuessText, setTeamGuessText] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [scores, setScores] = useState<PlayerScore[]>([]);
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([]);
  const [selectedCorrectPlayerIds, setSelectedCorrectPlayerIds] = useState<string[]>([]);
  const [remainingSeconds, setRemainingSeconds] = useState(DEFAULT_ROUND_SECONDS);
  const [teamBattleClockMs, setTeamBattleClockMs] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirmingReveal, setIsConfirmingReveal] = useState(false);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [isJudgingBuzzer, setIsJudgingBuzzer] = useState(false);
  const [isSettlingBuzzerRound, setIsSettlingBuzzerRound] = useState(false);
  const [isSubmittingTeamBattle, setIsSubmittingTeamBattle] = useState(false);
  const [isFinalizingTeamBattle, setIsFinalizingTeamBattle] = useState(false);
  const [isJudgingTeamBattle, setIsJudgingTeamBattle] = useState(false);
  const [isAdvancingQuestion, setIsAdvancingQuestion] = useState(false);
  const [isEndingGame, setIsEndingGame] = useState(false);
  const [isSkippingQuestion, setIsSkippingQuestion] = useState(false);
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [isJudgeModalOpen, setIsJudgeModalOpen] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [isRevealPreviewOpen, setIsRevealPreviewOpen] = useState(false);
  const [isLabelPromptDisabledForGame, setIsLabelPromptDisabledForGame] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(16 / 9);
  const [isPortraitImage, setIsPortraitImage] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [lastAutoJudgeKey, setLastAutoJudgeKey] = useState("");
  const [lastAutoLabelKey, setLastAutoLabelKey] = useState("");
  const [canRenderPortal, setCanRenderPortal] = useState(false);
  const scoreRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const gameSessionRef = useRef<GameSession | null>(null);

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

      if (targetGameSession.gameMode === "ROUND_REVEAL") {
        const nextAnswers = await getAnswersForQuestionRound({
          gameSessionId: targetGameSession.id,
          questionIndex: targetGameSession.currentQuestionIndex,
          revealRound: targetGameSession.currentRevealRound,
        });
        setAnswers(nextAnswers);
        setBuzzerAnswers([]);
        setMyBuzzerAnswer(null);

        if (isPresenter) {
          const nextLabelAnswers = await getAnswersForQuestion({
            gameSessionId: targetGameSession.id,
            questionIndex: targetGameSession.currentQuestionIndex,
          });
          setLabelAnswers(nextLabelAnswers);
        } else {
          const nextMyAnswer = await getAnswerForPlayerRound({
            gameSessionId: targetGameSession.id,
            questionIndex: targetGameSession.currentQuestionIndex,
            revealRound: targetGameSession.currentRevealRound,
            playerId,
          });
          setLabelAnswers([]);
          setMyAnswer(nextMyAnswer);
        }
      } else if (targetGameSession.gameMode === "TEAM_BATTLE") {
        setAnswers([]);
        setBuzzerAnswers([]);
        setMyAnswer(null);
        setMyBuzzerAnswer(null);
        if (isPresenter) {
          setLabelAnswers([]);
        } else {
          setLabelAnswers([]);
        }
      } else {
        const [nextBuzzerAnswers, nextLabelAnswers] = await Promise.all([
          getBuzzerAnswersForQuestionRound({
            gameSessionId: targetGameSession.id,
            questionIndex: targetGameSession.currentQuestionIndex,
            revealRound: targetGameSession.currentRevealRound,
          }),
          getBuzzerAnswersForQuestion({
            gameSessionId: targetGameSession.id,
            questionIndex: targetGameSession.currentQuestionIndex,
          }),
        ]);
        setAnswers([]);
        setBuzzerAnswers(nextBuzzerAnswers);
        setLabelAnswers(
          nextLabelAnswers.map((answer) => ({
            id: answer.id,
            gameSessionId: answer.gameSessionId,
            questionIndex: answer.questionIndex,
            revealRound: answer.revealRound,
            playerId: answer.playerId,
            answerText: answer.answerText,
            submittedAt: answer.submittedAt,
          })),
        );

        if (!isPresenter) {
          const nextMyBuzzerAnswer = await getBuzzerAnswerForPlayerRound({
            gameSessionId: targetGameSession.id,
            questionIndex: targetGameSession.currentQuestionIndex,
            revealRound: targetGameSession.currentRevealRound,
            playerId,
          });
          setMyBuzzerAnswer(nextMyBuzzerAnswer);
        }
        setMyAnswer(null);
      }
    },
    [isPresenter, playerId],
  );

  const showAnswerBubble = useCallback((answer: Answer) => {
    const bubbleId = `${answer.id}:${answer.submittedAt}`;
    const anchor = scoreRowRefs.current[answer.playerId];
    const rect = anchor?.getBoundingClientRect();
    const width = 224;
    const left = rect ? Math.min(rect.right + 8, window.innerWidth - width - 12) : 16;
    const top = rect ? Math.max(12, rect.top + rect.height / 2) : 16;

    setAnswerBubbles((currentBubbles) => ({
      ...currentBubbles,
      [answer.playerId]: {
        id: bubbleId,
        text: answer.answerText,
        left,
        top,
        width,
      },
    }));

    window.setTimeout(() => {
      setAnswerBubbles((currentBubbles) => {
        if (currentBubbles[answer.playerId]?.id !== bubbleId) {
          return currentBubbles;
        }

        const nextBubbles = { ...currentBubbles };
        delete nextBubbles[answer.playerId];
        return nextBubbles;
      });
    }, 3200);
  }, []);

  useEffect(() => {
    setCanRenderPortal(true);
  }, []);

  useEffect(() => {
    gameSessionRef.current = gameSession;
  }, [gameSession]);

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

    return subscribeRealtimeTopic(`game:${room.currentGameId}`, (message) => {
      const pushedQuestion = getBroadcastQuestion(message.result);
      if (pushedQuestion) {
        setQuestions((currentQuestions) =>
          currentQuestions.map((question) => (question.id === pushedQuestion.id ? pushedQuestion : question)),
        );
        return;
      }

      const currentGameSession = gameSessionRef.current;
      const pushedGameSession = getBroadcastGameSession(message.result);
      const applyPushedGameSession = () => {
        if (!pushedGameSession || pushedGameSession.id !== room.currentGameId) {
          return false;
        }

        setGameSession(pushedGameSession);
        setImageLoadFailed(false);
        setSelectedBlocks([]);
        setSelectedCorrectPlayerIds([]);
        setRemainingSeconds(getRemainingSeconds(pushedGameSession.roundStartedAt, pushedGameSession.roundSeconds));
        refreshRoundData(pushedGameSession).catch((error) => {
          onError(error instanceof Error ? error.message : "刷新游戏数据失败。");
        });
        return true;
      };

      const pushedAnswer = getBroadcastAnswer(message.result);
      if (pushedAnswer && currentGameSession?.id === pushedAnswer.gameSessionId) {
        if (
          pushedAnswer.questionIndex === currentGameSession.currentQuestionIndex &&
          pushedAnswer.revealRound === currentGameSession.currentRevealRound
        ) {
          setAnswers((currentAnswers) => upsertById(currentAnswers, pushedAnswer));
          if (isPresenter) {
            setLabelAnswers((currentAnswers) => upsertById(currentAnswers, pushedAnswer));
            showAnswerBubble(pushedAnswer);
          }
          if (pushedAnswer.playerId === playerId) {
            setMyAnswer(pushedAnswer);
          }
        }
        if (applyPushedGameSession()) {
          return;
        }
        return;
      }

      const pushedBuzzerAnswer = getBroadcastBuzzerAnswer(message.result);
      if (pushedBuzzerAnswer && currentGameSession?.id === pushedBuzzerAnswer.gameSessionId) {
        if (
          pushedBuzzerAnswer.questionIndex === currentGameSession.currentQuestionIndex &&
          pushedBuzzerAnswer.revealRound === currentGameSession.currentRevealRound
        ) {
          setBuzzerAnswers((currentAnswers) => upsertById(currentAnswers, pushedBuzzerAnswer));
          if (isPresenter) {
            showAnswerBubble({
              id: pushedBuzzerAnswer.id,
              gameSessionId: pushedBuzzerAnswer.gameSessionId,
              questionIndex: pushedBuzzerAnswer.questionIndex,
              revealRound: pushedBuzzerAnswer.revealRound,
              playerId: pushedBuzzerAnswer.playerId,
              answerText: pushedBuzzerAnswer.answerText,
              submittedAt: pushedBuzzerAnswer.submittedAt,
            });
          }
          if (pushedBuzzerAnswer.playerId === playerId) {
            setMyBuzzerAnswer(pushedBuzzerAnswer);
          }
        }
        if (applyPushedGameSession()) {
          return;
        }
        return;
      }

      if (applyPushedGameSession()) {
        return;
      }

      getGameSessionById(room.currentGameId ?? "")
        .then(async (nextGameSession) => {
          if (!nextGameSession) {
            onError("当前游戏不存在。");
            return;
          }

          const nextQuestions = await getQuestionsByQuestionSetId(nextGameSession.questionSetId);
          setGameSession(nextGameSession);
          setQuestions(nextQuestions);
          setImageLoadFailed(false);
          setSelectedBlocks([]);
          setSelectedCorrectPlayerIds([]);
          setRemainingSeconds(getRemainingSeconds(nextGameSession.roundStartedAt, nextGameSession.roundSeconds));
          await refreshRoundData(nextGameSession);
        })
        .catch((error) => {
          onError(error instanceof Error ? error.message : "刷新游戏数据失败。");
        });
    });
  }, [isPresenter, onError, playerId, refreshRoundData, room.currentGameId, showAnswerBubble]);

  useEffect(() => {
    setAnswerBubbles({});
    setAnswerText("");
    setTeamGuessText("");
    setTeamSelectedBlocks([]);
  }, [gameSession?.id, gameSession?.currentQuestionIndex, gameSession?.currentRevealRound]);

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
  const previewRevealedBlockSet = useMemo(
    () => new Set([...(gameSession?.revealedBlocks ?? []), ...selectedBlocks]),
    [gameSession?.revealedBlocks, selectedBlocks],
  );
  const correctPlayerSet = useMemo(() => new Set(questionResults.map((result) => result.playerId)), [questionResults]);
  const maxRevealRounds = gameSession?.maxRevealRounds ?? 3;
  const currentRound = gameSession?.currentRevealRound ?? 1;
  const currentScore = gameSession?.roundScores[Math.min(maxRevealRounds, currentRound) - 1] ?? 1;
  const isTeamBattleMode = gameSession?.gameMode === "TEAM_BATTLE";
  const teamBattleState = gameSession?.teamBattleState ?? null;
  const isBuzzerMode = Boolean(gameSession && gameSession.gameMode !== "ROUND_REVEAL" && gameSession.gameMode !== "TEAM_BATTLE");
  const hasRoundStarted = Boolean(gameSession?.roundStartedAt);
  const isRoundActive = hasRoundStarted && remainingSeconds > 0;
  const isRoundEnded = hasRoundStarted && remainingSeconds === 0;
  const isQuestionReviewing = isTeamBattleMode
    ? teamBattleState?.phase === "REVIEW"
    : !hasRoundStarted && revealedBlockSet.size === TOTAL_BLOCKS;
  const shouldShowQuestionLabel = Boolean(currentQuestion) && (isPresenter || isQuestionReviewing);
  const hasNextQuestion = gameSession ? gameSession.currentQuestionIndex + 1 < questions.length : false;
  const isCurrentPlayerCorrect = correctPlayerSet.has(playerId);
  const guessers = room.players.filter((player) => player.id !== room.currentPresenterPlayerId);
  const teamBattlePlayerTeam: TeamBattleTeam | null = teamBattleState?.teams.red.includes(playerId)
    ? "red"
    : teamBattleState?.teams.blue.includes(playerId)
      ? "blue"
      : null;
  const teamBattleActiveTeam = teamBattleState?.activeTeam ?? "red";
  const teamBattleActiveMembers = teamBattleState?.teams[teamBattleActiveTeam] ?? [];
  const teamBattleCanAct = Boolean(!isPresenter && teamBattlePlayerTeam === teamBattleActiveTeam && teamBattleState);
  const canSeeTeamBattleVotes = Boolean(isPresenter || teamBattlePlayerTeam === teamBattleActiveTeam);
  const teamBattleAvailableBlockCount = Math.max(0, TOTAL_BLOCKS - revealedBlockSet.size);
  const teamBattleRequiredBlockCount = Math.min(teamBattleState?.revealLimit ?? 1, teamBattleAvailableBlockCount);
  const teamBattleVoteSeconds = teamBattleState?.voteDeadlineAt
    ? Math.max(0, Math.ceil((new Date(teamBattleState.voteDeadlineAt).getTime() - teamBattleClockMs) / 1000))
    : null;
  const teamBattleRevealVoteCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const blocks of Object.values(teamBattleState?.revealVotes ?? {})) {
      for (const block of blocks) {
        counts[block] = (counts[block] ?? 0) + 1;
      }
    }
    return counts;
  }, [teamBattleState?.revealVotes]);
  const teamBattleGuessOptions = useMemo(() => {
    const options = new Map<string, { key: string; label: string; vote: TeamBattleGuessVote; count: number }>();
    for (const vote of Object.values(teamBattleState?.guessVotes ?? {})) {
      const key = vote.type === "skip" ? "__skip__" : `guess:${vote.answerText}`;
      const label = vote.type === "skip" ? "不猜" : vote.answerText ?? "";
      const current = options.get(key);
      options.set(key, {
        key,
        label,
        vote,
        count: (current?.count ?? 0) + 1,
      });
    }
    return Array.from(options.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [teamBattleState?.guessVotes]);
  const activeGuessers = guessers.filter((player) => !correctPlayerSet.has(player.id));
  const currentRoundAnswerPlayerSet = useMemo(() => new Set(answers.map((answer) => answer.playerId)), [answers]);
  const buzzerAnswerPlayerSet = useMemo(() => new Set(buzzerAnswers.map((answer) => answer.playerId)), [buzzerAnswers]);
  const pendingBuzzerAnswers = buzzerAnswers.filter((answer) => answer.status === "pending");
  const currentBuzzerAnswer = pendingBuzzerAnswers[0] ?? null;
  const currentPlayerBuzzerStatus = myBuzzerAnswer?.status ?? null;
  const allActiveGuessersUsedBuzzerChance =
    activeGuessers.length > 0 && activeGuessers.every((player) => buzzerAnswerPlayerSet.has(player.id));
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
    !isTeamBattleMode &&
    selectedBlocks.length > 0 &&
    !isConfirmingReveal &&
    !isQuestionReviewing &&
    Boolean(gameSession) &&
    (!gameSession?.roundStartedAt || remainingSeconds === 0) &&
    currentRound <= maxRevealRounds;
  const canSubmitAnswer =
    !isPresenter && !isBuzzerMode && !isTeamBattleMode && !isQuestionReviewing && !isCurrentPlayerCorrect && isRoundActive && answerText.trim().length > 0;
  const canSubmitBuzzerAnswer =
    !isPresenter &&
    isBuzzerMode &&
    !isQuestionReviewing &&
    !isCurrentPlayerCorrect &&
    !myBuzzerAnswer &&
    isRoundActive &&
    answerText.trim().length > 0;
  const canGrade = isPresenter && !isBuzzerMode && !isTeamBattleMode && !isQuestionReviewing && hasRoundStarted && Boolean(gameSession);
  const canJudgeBuzzer = isPresenter && isBuzzerMode && !isQuestionReviewing && Boolean(currentBuzzerAnswer) && Boolean(gameSession);
  const canSettleBuzzerRound =
    isPresenter &&
    isBuzzerMode &&
    !isQuestionReviewing &&
    isRoundEnded &&
    pendingBuzzerAnswers.length === 0 &&
    Boolean(gameSession);
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

  useEffect(() => {
    if (!gameSession || !teamBattleState?.voteDeadlineAt || isFinalizingTeamBattle) {
      return;
    }

    const delayMs = Math.max(0, new Date(teamBattleState.voteDeadlineAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      setIsFinalizingTeamBattle(true);
      finalizeTeamBattleVote({ gameSessionId: gameSession.id })
        .then(async (finalized) => {
          setGameSession(finalized.gameSession);
          setSelectedBlocks([]);
          setTeamSelectedBlocks([]);
          await refreshRoundData(finalized.gameSession);
        })
        .catch((error) => {
          onError(error instanceof Error ? error.message : "结算团队投票失败。");
        })
        .finally(() => {
          setIsFinalizingTeamBattle(false);
        });
    }, delayMs + 80);

    return () => window.clearTimeout(timer);
  }, [gameSession, isFinalizingTeamBattle, onError, refreshRoundData, teamBattleState?.voteDeadlineAt]);

  useEffect(() => {
    if (!teamBattleState?.voteDeadlineAt) {
      return;
    }

    setTeamBattleClockMs(Date.now());
    const timer = window.setInterval(() => {
      setTeamBattleClockMs(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [teamBattleState?.voteDeadlineAt]);

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

  function toggleTeamBattleBlock(blockIndex: number) {
    if (
      !teamBattleCanAct ||
      teamBattleState?.phase !== "REVEAL_VOTE" ||
      revealedBlockSet.has(blockIndex) ||
      teamBattleVoteSeconds === 0
    ) {
      return;
    }

    setTeamSelectedBlocks((currentBlocks) => {
      if (currentBlocks.includes(blockIndex)) {
        return currentBlocks.filter((block) => block !== blockIndex);
      }

      if (currentBlocks.length >= teamBattleRequiredBlockCount) {
        return currentBlocks;
      }

      const nextBlocks = [...currentBlocks, blockIndex].sort((a, b) => a - b);
      return nextBlocks;
    });
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

  async function handleSubmitTeamBattleRevealVote() {
    if (!gameSession || !teamBattleState) {
      return;
    }

    setIsSubmittingTeamBattle(true);
    try {
      const updatedGameSession = await submitTeamBattleRevealVote({
        gameSessionId: gameSession.id,
        playerId,
        selectedBlocks: teamSelectedBlocks,
      });
      setGameSession(updatedGameSession);
      await refreshRoundData(updatedGameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "提交揭露投票失败。");
    } finally {
      setIsSubmittingTeamBattle(false);
    }
  }

  async function handleSubmitTeamBattleGuessVote(vote: TeamBattleGuessVote) {
    if (!gameSession || !teamBattleState) {
      return;
    }

    setIsSubmittingTeamBattle(true);
    try {
      const updatedGameSession = await submitTeamBattleGuessVote({
        gameSessionId: gameSession.id,
        playerId,
        vote,
      });
      setGameSession(updatedGameSession);
      await refreshRoundData(updatedGameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "提交猜测投票失败。");
    } finally {
      setIsSubmittingTeamBattle(false);
    }
  }

  async function handleJudgeTeamBattleGuess(isCorrect: boolean) {
    if (!gameSession || !teamBattleState?.pendingGuess) {
      return;
    }

    setIsJudgingTeamBattle(true);
    try {
      const judged = await judgeTeamBattleGuess({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
        isCorrect,
      });
      setGameSession(judged.gameSession);
      setTeamSelectedBlocks([]);
      await refreshRoundData(judged.gameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "判定团队猜测失败。");
    } finally {
      setIsJudgingTeamBattle(false);
    }
  }

  async function handleRevealTeamBattleAnswer() {
    if (!gameSession) {
      return;
    }

    const confirmed = window.confirm("确认直接公布答案吗？本题红蓝两队都不会加分。");
    if (!confirmed) {
      return;
    }

    setIsSkippingQuestion(true);
    try {
      const revealed = await revealTeamBattleAnswer({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
      });
      setGameSession(revealed.gameSession);
      setImageLoadFailed(false);
      setTeamSelectedBlocks([]);
      await refreshRoundData(revealed.gameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "公布答案失败。");
    } finally {
      setIsSkippingQuestion(false);
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

  async function handleSubmitBuzzerAnswer() {
    if (!gameSession) {
      return;
    }

    setIsSubmittingAnswer(true);
    try {
      const submitted = await submitBuzzerAnswer({
        gameSessionId: gameSession.id,
        playerId,
        answerText,
      });
      setMyBuzzerAnswer(submitted);
      setAnswerText(submitted.answerText);
      await refreshRoundData(gameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "提交抢答失败。");
    } finally {
      setIsSubmittingAnswer(false);
    }
  }

  async function handleJudgeBuzzerAnswer(isCorrect: boolean) {
    if (!gameSession || !currentBuzzerAnswer) {
      return;
    }

    setIsJudgingBuzzer(true);
    try {
      const judged = await judgeBuzzerAnswer({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
        buzzerAnswerId: currentBuzzerAnswer.id,
        isCorrect,
      });
      setGameSession(judged.gameSession);
      setRemainingSeconds(getRemainingSeconds(judged.gameSession.roundStartedAt, judged.gameSession.roundSeconds));
      await refreshRoundData(judged.gameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "判定抢答失败。");
    } finally {
      setIsJudgingBuzzer(false);
    }
  }

  async function handleSettleBuzzerRound() {
    if (!gameSession) {
      return;
    }

    setIsSettlingBuzzerRound(true);
    try {
      const settled = await settleBuzzerRound({
        gameSessionId: gameSession.id,
        presenterPlayerId: playerId,
      });
      setGameSession(settled.gameSession);
      setRemainingSeconds(getRemainingSeconds(settled.gameSession.roundStartedAt, settled.gameSession.roundSeconds));
      await refreshRoundData(settled.gameSession);
    } catch (error) {
      onError(error instanceof Error ? error.message : "结算抢答轮次失败。");
    } finally {
      setIsSettlingBuzzerRound(false);
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
      {isTeamBattleMode && teamBattleState ? (
        <div className="mb-4 space-y-2">
          <p className="text-sm font-semibold text-slate-900">红蓝队比分</p>
          {(["red", "blue"] as const).map((team) => {
            const teamMembers = teamBattleState.teams[team]
              .map((memberId) => room.players.find((player) => player.id === memberId)?.nickname ?? memberId)
              .join("、");
            const isActiveTeam = teamBattleState.activeTeam === team;

            return (
              <div
                className={[
                  "rounded-md border px-3 py-2 text-sm",
                  team === "red" ? "border-red-200 bg-red-50" : "border-sky-200 bg-sky-50",
                  isActiveTeam ? "ring-2 ring-slate-900/10" : "",
                ].join(" ")}
                key={team}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={team === "red" ? "font-semibold text-red-700" : "font-semibold text-sky-700"}>
                    {getTeamName(team)}
                    {isActiveTeam ? "（行动中）" : ""}
                  </span>
                  <span className="text-lg font-bold text-slate-950">{teamBattleState.teamScores[team]}</span>
                </div>
                <p className="mt-1 break-words text-xs text-[var(--muted)]">{teamMembers || "暂无队员"}</p>
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="mb-2 text-sm font-semibold text-slate-900">实时积分榜</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {scoreRows.map(({ player, score, correctCount }, index) => {
          const alreadyCorrect = correctPlayerSet.has(player.id);
          const hasAnsweredCurrentRound = currentRoundAnswerPlayerSet.has(player.id);
          const buzzerAnswer = buzzerAnswers.find((answer) => answer.playerId === player.id);
          return (
            <div
              className="rounded-md bg-slate-50 px-3 py-2 text-sm"
              key={player.id}
              ref={(element) => {
                scoreRowRefs.current[player.id] = element;
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 font-semibold text-slate-950">
                  #{index + 1} {player.nickname}
                </div>
                <div className="shrink-0 font-semibold text-[var(--primary)]">{score}</div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[var(--muted)]">
                <span>答对 {correctCount} 题</span>
                {!isPresenter && alreadyCorrect ? (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">已答对</span>
                ) : null}
                {!isPresenter && !alreadyCorrect && hasAnsweredCurrentRound ? (
                  <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">已回答</span>
                ) : null}
                {isBuzzerMode && buzzerAnswer?.status === "pending" ? (
                  <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                    {pendingBuzzerAnswers[0]?.id === buzzerAnswer.id ? "判定中" : "排队中"}
                  </span>
                ) : null}
                {isBuzzerMode && buzzerAnswer?.status === "wrong" ? (
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">本轮已答错</span>
                ) : null}
                {isBuzzerMode && alreadyCorrect ? (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">已答对</span>
                ) : null}
              </div>
            </div>
          );
        })}
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

        {isTeamBattleMode && !imageLoadFailed ? (
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: TOTAL_BLOCKS }, (_, blockIndex) => {
              const isRevealed = revealedBlockSet.has(blockIndex);
              const isSelected = teamSelectedBlocks.includes(blockIndex);
              const voteCount = canSeeTeamBattleVotes ? teamBattleRevealVoteCounts[blockIndex] ?? 0 : 0;
              const canPickBlock =
                teamBattleCanAct &&
                teamBattleState?.phase === "REVEAL_VOTE" &&
                !isRevealed &&
                teamBattleVoteSeconds !== 0;
              const canSelectMoreBlocks = teamSelectedBlocks.length < teamBattleRequiredBlockCount;
              const canPreviewBlock = canPickBlock && !isSelected && canSelectMoreBlocks;
              const canToggleBlock = canPickBlock && (isSelected || canSelectMoreBlocks);

              return (
                <button
                  aria-label={`方块 ${blockIndex + 1}`}
                  className={[
                    "relative border border-white/45 text-xs font-bold transition disabled:cursor-default",
                    isRevealed ? "bg-transparent" : "bg-black",
                    isSelected ? "ring-2 ring-inset ring-emerald-300 shadow-[inset_0_0_0_9999px_rgba(5,150,105,0.42)]" : "",
                    canPreviewBlock
                      ? "hover:ring-2 hover:ring-inset hover:ring-emerald-200 hover:shadow-[inset_0_0_0_9999px_rgba(16,185,129,0.24)]"
                      : "",
                  ].join(" ")}
                  disabled={!canToggleBlock}
                  key={blockIndex}
                  type="button"
                  onClick={() => toggleTeamBattleBlock(blockIndex)}
                >
                  {!isRevealed && voteCount > 0 ? (
                    <span className="absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded bg-emerald-400 px-1 text-[11px] text-slate-950">
                      {voteCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {!isPresenter && !isTeamBattleMode && !imageLoadFailed ? (
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

        {isPresenter && !isTeamBattleMode && !imageLoadFailed ? (
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
      ) : isTeamBattleMode && teamBattleState ? (
        <>
          <p className="text-sm font-semibold text-slate-950">红蓝对抗</p>
          <div className="mt-2 rounded-md border border-[var(--line)] bg-white p-3 text-sm">
            <p className="font-semibold text-slate-950">
              {getTeamName(teamBattleActiveTeam)} ·{" "}
              {teamBattleState.phase === "REVEAL_VOTE"
                ? "选择揭露方块"
                : teamBattleState.phase === "GUESS_VOTE"
                  ? "决定是否猜测"
                  : teamBattleState.phase === "JUDGING"
                    ? "等待裁判判定"
                    : "本题复盘"}
            </p>
            <p className="mt-1 text-[var(--muted)]">{teamBattleState.message}</p>
            {teamBattleVoteSeconds !== null ? (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                自由修改倒计时：{teamBattleVoteSeconds} 秒
              </p>
            ) : null}
          </div>

          {teamBattleState.phase === "REVEAL_VOTE" ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-md border border-[var(--line)] bg-white p-3 text-sm">
                <p className="font-semibold text-slate-950">
                  本回合需选择 {teamBattleRequiredBlockCount} 个方块
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  已提交 {Object.keys(teamBattleState.revealVotes).length} / {teamBattleActiveMembers.length} 人。
                </p>
                {!isPresenter && teamBattlePlayerTeam ? (
                  <p className="mt-1 text-[var(--muted)]">
                    你属于{getTeamName(teamBattlePlayerTeam)}
                    {teamBattleCanAct ? "，当前可以投票。" : "，等待对方队伍行动。"}
                  </p>
                ) : null}
              </div>
              {teamBattleCanAct ? (
                <Button
                  className="w-full"
                  type="button"
                  onClick={handleSubmitTeamBattleRevealVote}
                  disabled={
                    isSubmittingTeamBattle ||
                    teamSelectedBlocks.length !== teamBattleRequiredBlockCount ||
                    teamBattleVoteSeconds === 0
                  }
                >
                  {isSubmittingTeamBattle ? "提交中..." : "提交揭露投票"}
                </Button>
              ) : null}
            </div>
          ) : null}

          {teamBattleState.phase === "GUESS_VOTE" ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-md border border-[var(--line)] bg-white p-3 text-sm">
                <p className="font-semibold text-slate-950">
                  已提交 {Object.keys(teamBattleState.guessVotes).length} / {teamBattleActiveMembers.length} 人
                </p>
                <div className="mt-2 space-y-2">
                  {canSeeTeamBattleVotes && teamBattleGuessOptions.length > 0 ? (
                    teamBattleGuessOptions.map((option) => (
                      <button
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-slate-50 px-3 py-2 text-left text-sm hover:border-emerald-300"
                        key={option.key}
                        type="button"
                        onClick={() => {
                          if (option.vote.type === "guess") {
                            setTeamGuessText(option.vote.answerText ?? "");
                          }
                        }}
                      >
                        <span className="min-w-0 truncate">{option.label}</span>
                        <span className="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          {option.count}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="text-[var(--muted)]">
                      {canSeeTeamBattleVotes ? "还没有队员提交选择。" : "等待当前队伍完成内部投票。"}
                    </p>
                  )}
                </div>
              </div>
              {teamBattleCanAct ? (
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    type="button"
                    variant="secondary"
                    onClick={() => handleSubmitTeamBattleGuessVote({ type: "skip" })}
                    disabled={isSubmittingTeamBattle || teamBattleVoteSeconds === 0}
                  >
                    投票不猜
                  </Button>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-900">猜测答案</span>
                    <input
                      className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                      maxLength={80}
                      placeholder="输入动画名称"
                      value={teamGuessText}
                      onChange={(event) => setTeamGuessText(event.target.value)}
                    />
                  </label>
                  <Button
                    className="w-full"
                    type="button"
                    onClick={() => handleSubmitTeamBattleGuessVote({ type: "guess", answerText: teamGuessText })}
                    disabled={isSubmittingTeamBattle || teamGuessText.trim().length === 0 || teamBattleVoteSeconds === 0}
                  >
                    提交猜测投票
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {teamBattleState.phase === "JUDGING" && teamBattleState.pendingGuess ? (
            <div className="mt-3 rounded-md border border-[var(--line)] bg-white p-3 text-sm">
              <p className="font-semibold text-slate-950">
                {getTeamName(teamBattleState.pendingGuess.team)}猜测
              </p>
              <p className="mt-2 break-words text-lg font-semibold text-slate-950">
                {teamBattleState.pendingGuess.answerText}
              </p>
              {isPresenter ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button type="button" onClick={() => handleJudgeTeamBattleGuess(true)} disabled={isJudgingTeamBattle}>
                    猜对
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleJudgeTeamBattleGuess(false)}
                    disabled={isJudgingTeamBattle}
                  >
                    猜错
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-[var(--muted)]">等待出题人判定。</p>
              )}
            </div>
          ) : null}

          {isPresenter ? (
            <div className="mt-3 grid gap-2">
              <Button type="button" variant="secondary" onClick={handleRevealTeamBattleAnswer} disabled={isSkippingQuestion}>
                {isSkippingQuestion ? "公布中..." : "直接公布答案"}
              </Button>
              <Button type="button" variant="secondary" onClick={handleEndGameEarly} disabled={isEndingGame}>
                {isEndingGame ? "结束中..." : "结束本局游戏"}
              </Button>
            </div>
          ) : null}
        </>
      ) : isPresenter ? (
        <>
          <p className="text-sm font-semibold text-slate-950">出题人操作</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            已揭露 {revealedBlockSet.size} / {TOTAL_BLOCKS} 块，本轮已选择 {selectedBlocks.length} 块。
          </p>
          {isBuzzerMode ? (
            <div className="mt-3 rounded-md border border-[var(--line)] bg-white p-3 text-sm">
              <p className="font-semibold text-slate-950">抢答队列</p>
              {currentBuzzerAnswer ? (
                <div className="mt-2 rounded-md bg-slate-50 p-3">
                  <p className="font-semibold text-slate-950">{getPlayerName(currentBuzzerAnswer.playerId)}</p>
                  <p className="mt-1 break-words text-[var(--muted)]">{currentBuzzerAnswer.answerText}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button type="button" onClick={() => handleJudgeBuzzerAnswer(true)} disabled={!canJudgeBuzzer || isJudgingBuzzer}>
                      答对
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleJudgeBuzzerAnswer(false)}
                      disabled={!canJudgeBuzzer || isJudgingBuzzer}
                    >
                      答错
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[var(--muted)]">{hasRoundStarted ? "当前没有待判定抢答。" : "揭露后开始抢答。"}</p>
              )}
              <p className="mt-2 text-xs text-[var(--muted)]">
                已排队 {pendingBuzzerAnswers.length} 人，本轮已用机会 {buzzerAnswers.length} / {activeGuessers.length}。
              </p>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2">
            <Button type="button" onClick={handleConfirmReveal} disabled={!canConfirmReveal}>
              {isConfirmingReveal ? "确认中..." : "确认揭露"}
            </Button>
            <button
              className="rounded-md border border-[var(--line)] bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={imageLoadFailed || selectedBlocks.length === 0}
              type="button"
              onBlur={() => setIsRevealPreviewOpen(false)}
              onContextMenu={(event) => event.preventDefault()}
              onPointerCancel={() => setIsRevealPreviewOpen(false)}
              onPointerDown={() => setIsRevealPreviewOpen(true)}
              onPointerLeave={() => setIsRevealPreviewOpen(false)}
              onPointerUp={() => setIsRevealPreviewOpen(false)}
            >
              按住预览玩家视角
            </button>
            {isBuzzerMode ? (
              <Button type="button" onClick={handleSettleBuzzerRound} disabled={!canSettleBuzzerRound || isSettlingBuzzerRound}>
                {isSettlingBuzzerRound ? "结算中..." : "结算本轮抢答"}
              </Button>
            ) : (
              <Button type="button" onClick={() => setIsJudgeModalOpen(true)} disabled={!hasRoundStarted}>
                判分
              </Button>
            )}
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
                  disabled={!isRoundActive || (isBuzzerMode && Boolean(myBuzzerAnswer))}
                  maxLength={80}
                  placeholder="输入动画名称"
                  value={answerText}
                  onChange={(event) => setAnswerText(event.target.value)}
                />
              </label>
              <Button
                className="w-full"
                type="button"
                onClick={isBuzzerMode ? handleSubmitBuzzerAnswer : handleSubmitAnswer}
                disabled={(isBuzzerMode ? !canSubmitBuzzerAnswer : !canSubmitAnswer) || isSubmittingAnswer}
              >
                {isSubmittingAnswer ? "提交中..." : isBuzzerMode ? "提交抢答" : myAnswer ? "修改答案" : "提交答案"}
              </Button>
              <p className="text-sm text-[var(--muted)]">
                {isBuzzerMode
                  ? myBuzzerAnswer
                    ? `本轮已抢答：${myBuzzerAnswer.answerText}`
                    : "本轮尚未抢答"
                  : myAnswer
                    ? `已提交：${myAnswer.answerText}`
                    : "本轮尚未提交答案"}
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

      {isPresenter && isRevealPreviewOpen && canRenderPortal
        ? createPortal(
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 py-6">
              <div
                className="relative w-full max-w-5xl overflow-hidden rounded-md bg-black shadow-2xl"
                style={{
                  aspectRatio: imageAspectRatio,
                  maxHeight: "86vh",
                  maxWidth: isPortraitImage ? `min(80vw, calc(86vh * ${imageAspectRatio}))` : "min(92vw, 1280px)",
                }}
              >
                <img alt="" className="h-full w-full object-cover" src={currentQuestion.imageUrl} />
                <div
                  className="absolute inset-0 grid"
                  style={{
                    gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
                  }}
                >
                  {Array.from({ length: TOTAL_BLOCKS }, (_, blockIndex) => (
                    <div className={previewRevealedBlockSet.has(blockIndex) ? "bg-transparent" : "bg-black"} key={blockIndex} />
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isPresenter && canRenderPortal
        ? createPortal(
            Object.values(answerBubbles).map((answerBubble) => (
            <div
              className="pointer-events-none fixed z-40 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-lg"
              key={answerBubble.id}
              style={{
                left: answerBubble.left,
                top: answerBubble.top,
                width: answerBubble.width,
                transform: "translateY(-50%)",
              }}
            >
              <span className="block truncate">{answerBubble.text}</span>
            </div>
            )),
            document.body,
          )
        : null}

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
