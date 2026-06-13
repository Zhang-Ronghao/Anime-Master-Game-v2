"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "@/lib/router";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ImageRevealGame } from "@/components/ImageRevealGame";
import { Panel } from "@/components/Panel";
import { QuestionGuideButton } from "@/components/QuestionGuideButton";
import { QuestionSetUploader } from "@/components/QuestionSetUploader";
import { subscribeRealtimeTopic } from "@/lib/cloudflareClient";
import { clearLocalRoomSession, getLocalSession, saveLocalSession } from "@/lib/localSession";
import {
  cancelCurrentRound,
  dissolveRoom,
  getGameSessionById,
  getLeaderboardForGameSession,
  getPlayersByRoomId,
  getQuestionSetById,
  getRoomByCode,
  joinRoom,
  leaveRoom,
  publishQuestionSetToCommunity,
  rateCommunityQuestionSet,
  returnRoomToLobby,
  selectPresenterForRound,
  startGameWithQuestionSet,
} from "@/lib/cloudflareRooms";
import type { GameMode, GameSession, LeaderboardEntry, Player, QuestionSet, Room, RoomStatus, TeamBattleTeam } from "@/types/game";

const statusText: Record<RoomStatus, string> = {
  LOBBY: "房间大厅",
  QUESTION_SETUP: "出题人准备题库",
  PLAYING: "游戏中",
  GAME_RESULT: "本局结算",
};

type GameSettings = {
  gameMode: GameMode;
  maxRevealRounds: number;
  roundSeconds: number;
  roundScores: number[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRoom(value: unknown): value is Room {
  return isRecord(value) && typeof value.code === "string" && typeof value.status === "string";
}

function isQuestionSet(value: unknown): value is QuestionSet {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && "imageCount" in value;
}

function getBroadcastRoom(result: unknown) {
  if (isRoom(result)) {
    return result;
  }

  if (isRecord(result) && isRoom(result.room)) {
    return result.room;
  }

  return null;
}

function getBroadcastQuestionSet(result: unknown) {
  if (isQuestionSet(result)) {
    return result;
  }

  if (isRecord(result) && isQuestionSet(result.questionSet)) {
    return result.questionSet;
  }

  return null;
}

type GameModeCopy = {
  title: string;
  summary: string;
  rules: string[];
  settingsNote?: string;
};

const gameModeCopy: Record<GameMode, GameModeCopy> = {
  ROUND_REVEAL: {
    title: "个人 · 标准模式",
    summary: "按轮得分，越早猜中分越高",
    rules: [
      "出题人逐轮打开画面，默认共 3 轮",
      "玩家在倒计时内提交答案",
      "猜中得当前轮分数，默认 3/2/1 分",
    ],
  },
  BUZZER_FIRST_CORRECT: {
    title: "个人 · 抢答模式",
    summary: "第一个答对的人得分，本题立即结束",
    rules: [
      "出题人逐轮打开画面，默认共 3 轮",
      "玩家在倒计时内抢答",
      "第一个答对的人得 1 分，本题立即结束",
    ],
  },
  BUZZER_RANKED: {
    title: "个人 · 顺位得分模式",
    summary: "多人可得分，按答对顺序递减",
    rules: [
      "出题人逐轮打开画面，默认共 3 轮",
      "玩家在倒计时内抢答",
      "多名玩家可答对得分，按答对顺序递减，最低 1 分",
    ],
  },
  TEAM_BATTLE: {
    title: "团队 · 对抗模式",
    summary: "两队在同一张截图上较量，谁先猜对谁得分",
    rules: [
      "红蓝两队看同一张被遮住的截图",
      "两队轮流行动，每次打开 1 个区块",
      "当前队伍可以猜答案；猜对得 1 分，本题立即结束",
      "猜错后，对方可额外打开 1 个区块",
    ],
    settingsNote: "至少需要 2 名答题玩家",
  },
};

const gameModeCommonRule = "每题截图会被格子遮住，出题人逐轮打开画面；玩家根据线索猜动画名";

function getPresenterName(players: Player[], presenterPlayerId?: string | null) {
  return players.find((player) => player.id === presenterPlayerId)?.nickname ?? "未选择";
}

function getTeamName(team: TeamBattleTeam) {
  return team === "red" ? "红队" : "蓝队";
}

function getTeamStyles(team: TeamBattleTeam) {
  return team === "red"
    ? {
        panel: "border-red-200 bg-red-50",
      }
    : {
        panel: "border-sky-200 bg-sky-50",
      };
}

function getRoomCodeFromLocation() {
  const roomMatch = window.location.pathname.match(/^\/room\/([^/]+)/);
  return roomMatch ? decodeURIComponent(roomMatch[1]) : "";
}

function getPlayerJoinedAtTime(player: Player) {
  if (typeof player.joinedAt === "number") {
    return player.joinedAt;
  }

  const timestamp = Date.parse(player.joinedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function sortPlayersByJoinedAt(players: Player[]) {
  return [...players].sort((a, b) => getPlayerJoinedAtTime(a) - getPlayerJoinedAtTime(b) || a.id.localeCompare(b.id));
}

function PlayerList({
  players,
  playerId,
  presenterPlayerId,
  gameMode,
}: {
  players: Player[];
  playerId: string;
  presenterPlayerId?: string | null;
  gameMode: GameMode;
}) {
  const sortedPlayers = sortPlayersByJoinedAt(players);
  const title = `玩家 ${sortedPlayers.length}`;

  return (
    <Panel className="h-full" title={title}>
      <div className="space-y-3">
        {sortedPlayers.map((player, index) => {
          const isPresenter = player.id === presenterPlayerId;

          return (
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-white px-3 py-3 shadow-sm"
              key={player.id}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-900 text-sm font-bold text-white">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{player.nickname}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                    {player.id === playerId ? <span>你</span> : null}
                    {isPresenter ? <span>本局出题人</span> : null}
                    {gameMode === "TEAM_BATTLE" ? <span>{isPresenter ? "裁判" : "答题玩家"}</span> : null}
                  </div>
                </div>
              </div>
              <span
                className={
                  player.isHost
                    ? "shrink-0 rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                    : "shrink-0 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
                }
              >
                {player.isHost ? "房主" : "玩家"}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function StepGuide({ room, isHost, isCurrentPresenter }: { room: Room; isHost: boolean; isCurrentPresenter: boolean }) {
  let text = "等待房主选择本局出题人。";

  if (room.status === "LOBBY") {
    text = isHost ? "先在大厅设置本局参数，然后选择一名出题人。" : "等待房主设置参数并选择出题人。";
  } else if (room.status === "QUESTION_SETUP") {
    text = isCurrentPresenter
      ? "选择上传、URL 文本或社区题库，创建题库预览后通知房主开始游戏。"
      : room.preparedQuestionSetId
        ? "出题人已准备好题库，等待房主开始游戏。"
        : "等待出题人准备题库。";
  } else if (room.status === "GAME_RESULT") {
    text = isHost ? "查看排行榜、发布或评分题库后，可以回到房间大厅开始下一局。" : "查看排行榜并评分，等待房主回到大厅。";
  }

  return <p className="mt-4 rounded-md border border-rose-100 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">{text}</p>;
}

function getLobbyActionText(room: Room, isHost: boolean, isCurrentPresenter: boolean) {
  if (room.status === "LOBBY") {
    return isHost ? "选择本局出题人" : "等待房主选择出题人";
  }

  if (room.status === "QUESTION_SETUP") {
    if (isCurrentPresenter && !room.preparedQuestionSetId) {
      return "准备题库";
    }

    if (room.preparedQuestionSetId) {
      return isHost ? "题库已准备，可以开始" : "题库已准备，等待房主开始";
    }

    return "等待出题人准备题库";
  }

  return statusText[room.status];
}

function PresenterPicker({
  room,
  pendingPresenterId,
  onSelectPresenter,
}: {
  room: Room;
  pendingPresenterId: string;
  onSelectPresenter: (presenterPlayerId: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {room.players.map((player) => (
        <button
          className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-left transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={Boolean(pendingPresenterId)}
          key={player.id}
          type="button"
          onClick={() => onSelectPresenter(player.id)}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-950">{player.nickname}</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">{player.isHost ? "房主也可以出题" : "玩家"}</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-[var(--primary)]">
            {pendingPresenterId === player.id ? "选择中..." : "选择"}
          </span>
        </button>
      ))}
    </div>
  );
}

function PresenterPickerModal({
  room,
  isOpen,
  pendingPresenterId,
  onSelectPresenter,
  onClose,
}: {
  room: Room;
  isOpen: boolean;
  pendingPresenterId: string;
  onSelectPresenter: (presenterPlayerId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 px-4 py-6" role="presentation" onMouseDown={onClose}>
      <div
        aria-modal="true"
        className="max-h-[calc(100dvh-48px)] w-full max-w-xl overflow-y-auto rounded-lg border border-[var(--line)] bg-white p-5 shadow-2xl"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">选择出题人</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">选中后由这名玩家准备题库，房主稍后开始游戏。</p>
          </div>
          <button
            aria-label="关闭选择出题人弹窗"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[var(--line)] text-xl leading-none text-slate-500 transition hover:bg-slate-50"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="mt-5">
          <PresenterPicker room={room} pendingPresenterId={pendingPresenterId} onSelectPresenter={onSelectPresenter} />
        </div>
      </div>
    </div>
  );
}

function GameSettingsPanel({
  settings,
  canEdit,
  onChange,
}: {
  settings: GameSettings;
  canEdit: boolean;
  onChange: (settings: GameSettings) => void;
}) {
  const isRoundRevealMode = settings.gameMode === "ROUND_REVEAL";
  const isTeamBattleMode = settings.gameMode === "TEAM_BATTLE";
  const copy = gameModeCopy[settings.gameMode];

  function updateRounds(nextRounds: number) {
    onChange({
      ...settings,
      maxRevealRounds: nextRounds,
      roundScores: Array.from(
        { length: nextRounds },
        (_, index) => settings.roundScores[index] ?? Math.max(1, nextRounds - index),
      ),
    });
  }

  function updateScore(index: number, score: number) {
    onChange({
      ...settings,
      roundScores: settings.roundScores.map((currentScore, scoreIndex) => (scoreIndex === index ? score : currentScore)),
    });
  }

  return (
    <div className="rounded-md border border-[var(--line)] bg-white">
      <div className="border-b border-[var(--line)] bg-slate-50 px-4 py-3">
        <p className="text-sm font-semibold text-slate-950">游戏说明</p>
        <p className="mt-1 text-sm leading-6 text-slate-700">{gameModeCommonRule}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
        <div className="p-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-900">游戏模式</span>
            <select
              className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition disabled:bg-slate-100 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
              disabled={!canEdit}
              value={settings.gameMode}
              onChange={(event) => onChange({ ...settings, gameMode: event.target.value as GameMode })}
            >
              {(Object.keys(gameModeCopy) as GameMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {gameModeCopy[mode].title}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{copy.summary}</p>
          {!canEdit ? <p className="mt-3 text-sm text-[var(--muted)]">当前只能查看，不能修改。</p> : null}
        </div>

        <div className="border-t border-[var(--line)] p-4 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">具体规则</p>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{copy.title}</span>
          </div>
          <ol className="mt-3 grid gap-2">
            {copy.rules.map((rule, index) => (
              <li className="flex gap-2 text-sm leading-6 text-slate-700" key={rule}>
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-slate-900 text-[11px] font-bold text-white">
                  {index + 1}
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <details className="border-t border-[var(--line)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">高级设置</summary>
        {copy.settingsNote ? <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{copy.settingsNote}</p> : null}

        {!isTeamBattleMode ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-900">最多轮数</span>
              <input
                className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition disabled:bg-slate-100 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                disabled={!canEdit}
                min={1}
                max={10}
                type="number"
                value={settings.maxRevealRounds}
                onChange={(event) => updateRounds(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-900">每轮秒数</span>
              <input
                className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition disabled:bg-slate-100 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                disabled={!canEdit}
                min={1}
                max={600}
                type="number"
                value={settings.roundSeconds}
                onChange={(event) =>
                  onChange({ ...settings, roundSeconds: Math.max(1, Math.min(600, Number(event.target.value) || 60)) })
                }
              />
            </label>
          </div>
        ) : null}

        {isRoundRevealMode ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {Array.from({ length: settings.maxRevealRounds }, (_, index) => (
              <label className="block" key={index}>
                <span className="mb-2 block text-sm font-medium text-slate-900">第 {index + 1} 轮分数</span>
                <input
                  className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition disabled:bg-slate-100 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                  disabled={!canEdit}
                  min={0}
                  type="number"
                  value={settings.roundScores[index] ?? 0}
                  onChange={(event) => updateScore(index, Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
            ))}
          </div>
        ) : isTeamBattleMode ? (
          <div className="mt-3 rounded-md border border-[var(--line)] bg-slate-50 px-4 py-3 text-sm leading-6 text-[var(--muted)]">
            固定规则：自动分队，猜对队伍得 1 分。
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-[var(--line)] bg-slate-50 px-4 py-3 text-sm leading-6 text-[var(--muted)]">
            {settings.gameMode === "BUZZER_FIRST_CORRECT" ? "固定得分：首个答对 +1。" : "固定得分：按答对名次递减，最低 1 分。"}
          </div>
        )}
      </details>
    </div>
  );
}

function LobbyMainPanel({
  room,
  settings,
  isHost,
  presenterName,
  isStartingGame,
  isCancelingRound,
  onSettingsChange,
  onOpenPresenterPicker,
  onStartGame,
  onCancelRound,
}: {
  room: Room;
  settings: GameSettings;
  isHost: boolean;
  presenterName: string;
  isStartingGame: boolean;
  isCancelingRound: boolean;
  onSettingsChange: (settings: GameSettings) => void;
  onOpenPresenterPicker: () => void;
  onStartGame: () => void;
  onCancelRound: () => void;
}) {
  const actionText = getLobbyActionText(room, isHost, false);
  const hasQuestionSet = Boolean(room.preparedQuestionSetId);
  const canEditSettings = isHost && (room.status === "LOBBY" || room.status === "QUESTION_SETUP");

  return (
    <Panel className="h-full" title="房间大厅">
      <div className="rounded-md border border-rose-100 bg-rose-50 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-rose-500">当前步骤</p>
            <p className="mt-1 text-2xl font-bold text-rose-950">{actionText}</p>
            <p className="mt-2 text-sm leading-6 text-rose-800">
              {room.status === "LOBBY"
                ? isHost
                  ? "先确认玩法，再选择一名出题人。"
                  : "房主会选择玩法和出题人。"
                : hasQuestionSet
                  ? isHost
                    ? "可以继续调整玩法，确认后开始游戏。"
                    : "等待房主开始游戏。"
                  : `当前出题人是 ${presenterName}。`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            {isHost && room.status === "LOBBY" ? (
              <Button type="button" onClick={onOpenPresenterPicker}>
                选择出题人
              </Button>
            ) : null}
            {isHost && room.status === "QUESTION_SETUP" ? (
              <>
                <Button type="button" onClick={onStartGame} disabled={isStartingGame || !hasQuestionSet}>
                  {isStartingGame ? "启动中..." : "开始游戏"}
                </Button>
                <Button type="button" variant="secondary" onClick={onCancelRound} disabled={isCancelingRound}>
                  {isCancelingRound ? "取消中..." : "取消本局"}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <GameSettingsPanel settings={settings} canEdit={canEditSettings} onChange={onSettingsChange} />
      </div>
    </Panel>
  );
}

function GameResultPanel({
  room,
  currentGameId,
  playerId,
  isHost,
  isCurrentPresenter,
  isReturningToLobby,
  onReturnToLobby,
  onError,
}: {
  room: Room;
  currentGameId?: string | null;
  playerId: string;
  isHost: boolean;
  isCurrentPresenter: boolean;
  isReturningToLobby: boolean;
  onReturnToLobby: () => void;
  onError: (message: string) => void;
}) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [gameSession, setGameSession] = useState<GameSession | null>(null);
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [publishTitle, setPublishTitle] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [ratingValue, setRatingValue] = useState(5);
  const [isRating, setIsRating] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadLeaderboard() {
      if (!currentGameId) {
        setLeaderboard([]);
        return;
      }

      setIsLoadingLeaderboard(true);
      try {
        const [nextLeaderboard, loadedGameSession] = await Promise.all([
          getLeaderboardForGameSession(currentGameId),
          getGameSessionById(currentGameId),
        ]);
        const loadedQuestionSet = loadedGameSession ? await getQuestionSetById(loadedGameSession.questionSetId) : null;

        if (isMounted) {
          setLeaderboard(nextLeaderboard);
          setGameSession(loadedGameSession);
          setQuestionSet(loadedQuestionSet);
          setPublishTitle(loadedQuestionSet?.title ?? "");
          setPublishDescription(loadedQuestionSet?.description ?? "");
        }
      } catch (caughtError) {
        if (isMounted) {
          onError(caughtError instanceof Error ? caughtError.message : "加载排行榜失败。");
        }
      } finally {
        if (isMounted) {
          setIsLoadingLeaderboard(false);
        }
      }
    }

    loadLeaderboard();

    return () => {
      isMounted = false;
    };
  }, [currentGameId, onError]);

  useEffect(() => {
    if (!questionSet?.id) {
      return;
    }

    return subscribeRealtimeTopic(`question-set:${questionSet.id}`, (message) => {
      const pushedQuestionSet = getBroadcastQuestionSet(message.result);
      if (pushedQuestionSet?.id === questionSet.id) {
        setQuestionSet(pushedQuestionSet);
        setPublishTitle(pushedQuestionSet.title);
        setPublishDescription(pushedQuestionSet.description ?? "");
        return;
      }

      getQuestionSetById(questionSet.id)
        .then((nextQuestionSet) => {
          if (nextQuestionSet) {
            setQuestionSet(nextQuestionSet);
            setPublishTitle(nextQuestionSet.title);
            setPublishDescription(nextQuestionSet.description ?? "");
          }
        })
        .catch((caughtError) => {
          onError(caughtError instanceof Error ? caughtError.message : "刷新题库状态失败。");
        });
    });
  }, [onError, questionSet?.id]);

  async function handlePublishQuestionSet() {
    if (!questionSet) {
      return;
    }

    setIsPublishing(true);
    try {
      const published = await publishQuestionSetToCommunity({
        questionSetId: questionSet.id,
        playerId,
        title: publishTitle,
        description: publishDescription,
      });
      setQuestionSet(published);
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : "发布到社区失败。");
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleRateQuestionSet() {
    if (!questionSet) {
      return;
    }

    setIsRating(true);
    try {
      const rated = await rateCommunityQuestionSet({
        questionSetId: questionSet.id,
        playerId,
        rating: ratingValue,
      });
      setQuestionSet(rated);
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : "评分失败。");
    } finally {
      setIsRating(false);
    }
  }

  const canPublish = Boolean(questionSet && !questionSet.isPublic && questionSet.createdByPlayerId === playerId);
  const canRate = Boolean(questionSet?.isPublic);
  const presenterName = getPresenterName(room.players, room.currentPresenterPlayerId);
  const isTeamBattleResult = gameSession?.gameMode === "TEAM_BATTLE" && Boolean(gameSession.teamBattleState);
  const playerById = new Map(room.players.map((player) => [player.id, player]));
  const teamRows = gameSession?.teamBattleState
    ? (["red", "blue"] as const)
        .map((team) => ({
          team,
          score: gameSession.teamBattleState?.teamScores[team] ?? 0,
          members: (gameSession.teamBattleState?.teams[team] ?? []).map((memberId) => ({
            id: memberId,
            nickname: playerById.get(memberId)?.nickname ?? memberId,
          })),
        }))
        .sort((a, b) => b.score - a.score || (a.team === "red" ? -1 : 1))
    : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <Panel title="最终排行榜">
        {isLoadingLeaderboard ? (
          <p className="text-sm text-[var(--muted)]">正在读取本局分数...</p>
        ) : isTeamBattleResult ? (
          <div className="grid gap-3">
            {teamRows.map((row, index) => {
              const styles = getTeamStyles(row.team);

              return (
                <div className={["rounded-md border p-4", styles.panel].join(" ")} key={row.team}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[var(--muted)]">第 {index + 1} 名</p>
                      <p className="mt-1 text-lg font-bold text-slate-950">{getTeamName(row.team)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-slate-950">{row.score}</p>
                      <p className="text-xs text-[var(--muted)]">队伍总分</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {row.members.map((member) => (
                      <div className="rounded-md bg-white/80 px-3 py-2 text-sm" key={member.id}>
                        <span className="min-w-0 truncate font-semibold text-slate-950">{member.nickname}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : leaderboard.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">本局没有玩家得分。</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-[var(--line)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">排名</th>
                  <th className="px-4 py-3">玩家昵称</th>
                  <th className="px-4 py-3">总分</th>
                  <th className="px-4 py-3">答对题数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] bg-white">
                {leaderboard.map((entry) => (
                  <tr key={entry.playerId}>
                    <td className="px-4 py-3 font-semibold text-slate-950">{entry.rank}</td>
                    <td className="px-4 py-3">{entry.nickname}</td>
                    <td className="px-4 py-3 font-semibold">{entry.score}</td>
                    <td className="px-4 py-3">{entry.correctCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="space-y-5">
        <Panel title="当前游戏状态">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
              <p className="text-sm text-[var(--muted)]">状态</p>
              <p className="mt-2 text-xl font-semibold">{statusText[room.status]}</p>
            </div>
            <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
              <p className="text-sm text-[var(--muted)]">本局出题人</p>
              <p className="mt-2 text-xl font-semibold">{presenterName}</p>
            </div>
          </div>
          <StepGuide room={room} isHost={isHost} isCurrentPresenter={isCurrentPresenter} />
          <p className="mt-4 rounded-md border border-[var(--line)] bg-white p-4 text-sm leading-6 text-[var(--muted)]">
            本局结算已生成，分数只统计当前 game_session。
          </p>
          {isHost ? (
            <Button className="mt-4" type="button" onClick={onReturnToLobby} disabled={isReturningToLobby}>
              {isReturningToLobby ? "返回中..." : "回到房间大厅"}
            </Button>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">等待房主回到房间大厅。</p>
          )}
        </Panel>

        {canPublish ? (
          <Panel title="发布到社区">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-900">标题</span>
                <input
                  className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                  value={publishTitle}
                  onChange={(event) => setPublishTitle(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-900">简介</span>
                <input
                  className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                  value={publishDescription}
                  onChange={(event) => setPublishDescription(event.target.value)}
                />
              </label>
            </div>
            <Button className="mt-4" type="button" onClick={handlePublishQuestionSet} disabled={isPublishing}>
              {isPublishing ? "发布中..." : "发布到社区"}
            </Button>
          </Panel>
        ) : null}

        {canRate ? (
          <Panel title="社区评分">
            <p className="text-sm text-[var(--muted)]">
              所有玩家都可以评分；同一玩家重复评分会更新自己的上一次评分。当前评分：
              {Number(questionSet?.ratingAvg ?? 0).toFixed(2)} / 5，{questionSet?.ratingCount ?? 0} 人评分。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm"
                value={ratingValue}
                onChange={(event) => setRatingValue(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5].map((rating) => (
                  <option key={rating} value={rating}>
                    {rating} 星
                  </option>
                ))}
              </select>
              <Button type="button" onClick={handleRateQuestionSet} disabled={isRating}>
                {isRating ? "评分中..." : "提交评分"}
              </Button>
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

export default function RoomPage({ initialRoomCode = "" }: { initialRoomCode?: string } = {}) {
  const params = useParams<{ roomCode: string }>();
  const router = useRouter();
  const roomCode = params.roomCode || initialRoomCode || getRoomCodeFromLocation();
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDissolving, setIsDissolving] = useState(false);
  const [pendingPresenterId, setPendingPresenterId] = useState("");
  const [isCancelingRound, setIsCancelingRound] = useState(false);
  const [isReturningToLobby, setIsReturningToLobby] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [isLeavingRoom, setIsLeavingRoom] = useState(false);
  const [isPresenterPickerOpen, setIsPresenterPickerOpen] = useState(false);
  const [gameSettings, setGameSettings] = useState<GameSettings>({
    gameMode: "ROUND_REVEAL",
    maxRevealRounds: 3,
    roundSeconds: 60,
    roundScores: [3, 2, 1],
  });

  useEffect(() => {
    if (!error) {
      return;
    }

    const timer = window.setTimeout(() => {
      setError("");
    }, 5000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [error]);

  useEffect(() => {
    let isMounted = true;

    async function loadRoom() {
      setIsLoading(true);
      setError("");

      const session = getLocalSession();
      setPlayerId(session.playerId);
      setNickname(session.nickname);

      if (!session.nickname) {
        router.push(`/?roomCode=${encodeURIComponent(roomCode)}`);
        return;
      }

      try {
        const joined = await joinRoom(roomCode, session.playerId, session.nickname);

        if (joined.error || !joined.room) {
          if (isMounted) {
            setError(joined.error ?? "没有找到房间。");
            setRoom(null);
          }
          return;
        }

        saveLocalSession({
          playerId: session.playerId,
          nickname: session.nickname,
          roomCode,
          isHost: joined.room.hostPlayerId === session.playerId,
        });

        if (isMounted) {
          setRoom(joined.room);
        }
      } catch (caughtError) {
        if (isMounted) {
          setError(caughtError instanceof Error ? caughtError.message : "加载房间失败，请稍后重试。");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadRoom();

    return () => {
      isMounted = false;
    };
  }, [roomCode]);

  useEffect(() => {
    if (!room?.id || !playerId) {
      return;
    }

    function markRoomDissolved() {
      clearLocalRoomSession();
      setRoom(null);
      setError("房间已被房主解散。");
    }

    async function refreshRoom() {
      if (!room?.id) {
        return;
      }

      const latestRoom = await getRoomByCode(roomCode);

      if (!latestRoom) {
        markRoomDissolved();
        return;
      }

      const players = await getPlayersByRoomId(room.id);

      if (!players.some((player) => player.id === playerId)) {
        markRoomDissolved();
        return;
      }

      setRoom((currentRoom) =>
        currentRoom
          ? {
              ...currentRoom,
              hostPlayerId: latestRoom.host_player_id,
              status: latestRoom.game_status,
              currentPresenterPlayerId: latestRoom.current_presenter_player_id,
              currentGameId: latestRoom.current_game_id,
              preparedQuestionSetId: latestRoom.prepared_question_set_id ?? null,
              updatedAt: latestRoom.updated_at,
              players,
            }
          : currentRoom,
      );
    }

    return subscribeRealtimeTopic(`room:${room.id}`, (message) => {
      const pushedRoom = getBroadcastRoom(message.result);
      if (pushedRoom && pushedRoom.id === room.id) {
        if (pushedRoom.players.length > 0 && !pushedRoom.players.some((player) => player.id === playerId)) {
          markRoomDissolved();
          return;
        }

        setRoom((currentRoom) =>
          currentRoom
            ? {
                ...currentRoom,
                ...pushedRoom,
                players: pushedRoom.players.length > 0 ? pushedRoom.players : currentRoom.players,
              }
            : pushedRoom,
        );
        return;
      }

      refreshRoom().catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : "刷新房间状态失败。");
      });
    });
  }, [playerId, room?.id, roomCode]);

  const currentPlayer = useMemo(
    () => room?.players.find((player) => player.id === playerId) ?? null,
    [playerId, room],
  );

  const isHost = Boolean(currentPlayer?.isHost);
  const presenterName = room ? getPresenterName(room.players, room.currentPresenterPlayerId) : "未选择";
  const isCurrentPresenter = room?.currentPresenterPlayerId === playerId;
  const shouldShowQuestionSetup = room?.status === "QUESTION_SETUP" && isCurrentPresenter && !room.preparedQuestionSetId;
  const shouldShowLobby =
    room?.status === "LOBBY" || (room?.status === "QUESTION_SETUP" && (!isCurrentPresenter || Boolean(room.preparedQuestionSetId)));

  async function handleBackHome() {
    try {
      if (room?.id && playerId) {
        await leaveRoom(room.id, playerId);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "离开房间失败，请稍后重试。");
      return;
    }

    clearLocalRoomSession();
    router.push("/");
  }

  async function handleExitRoom() {
    if (!room?.id || !playerId || isCurrentPresenter) {
      return;
    }

    setIsLeavingRoom(true);
    setError("");

    try {
      await leaveRoom(room.id, playerId);
      clearLocalRoomSession();
      router.push("/");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "退出房间失败，请稍后重试。");
    } finally {
      setIsLeavingRoom(false);
    }
  }

  async function handleDissolveRoom() {
    if (!room?.id || !playerId || !isHost) {
      return;
    }

    const confirmed = window.confirm("确定要解散房间吗？");

    if (!confirmed) {
      return;
    }

    setIsDissolving(true);
    setError("");

    try {
      await dissolveRoom(room.id, playerId);
      clearLocalRoomSession();
      router.push("/");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "解散房间失败，请稍后重试。");
    } finally {
      setIsDissolving(false);
    }
  }

  async function handleSelectPresenter(presenterPlayerId: string) {
    if (!room?.id || !playerId || !isHost || room.status !== "LOBBY") {
      return;
    }

    setPendingPresenterId(presenterPlayerId);
    setError("");

    try {
      const nextRoom = await selectPresenterForRound(room.id, playerId, presenterPlayerId);
      setRoom((currentRoom) => (currentRoom ? { ...currentRoom, ...nextRoom, players: currentRoom.players } : currentRoom));
      setIsPresenterPickerOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "选择出题人失败，请稍后重试。");
    } finally {
      setPendingPresenterId("");
    }
  }

  async function handleCancelRound() {
    if (!room?.id || !playerId || !isHost || room.status === "LOBBY") {
      return;
    }

    setIsCancelingRound(true);
    setError("");

    try {
      const nextRoom = await cancelCurrentRound(room.id, playerId);
      setRoom((currentRoom) => (currentRoom ? { ...currentRoom, ...nextRoom, players: currentRoom.players } : currentRoom));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "取消本局失败，请稍后重试。");
    } finally {
      setIsCancelingRound(false);
    }
  }

  async function handleReturnToLobby() {
    if (!room?.id || !playerId || !isHost || room.status !== "GAME_RESULT") {
      return;
    }

    setIsReturningToLobby(true);
    setError("");

    try {
      const nextRoom = await returnRoomToLobby(room.id, playerId);
      setRoom((currentRoom) => (currentRoom ? { ...currentRoom, ...nextRoom, players: currentRoom.players } : currentRoom));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "回到房间大厅失败，请稍后重试。");
    } finally {
      setIsReturningToLobby(false);
    }
  }

  async function handleStartGame() {
    if (!room?.id || !playerId || !isHost || room.status !== "QUESTION_SETUP" || !room.currentPresenterPlayerId || !room.preparedQuestionSetId) {
      return;
    }

    setIsStartingGame(true);
    setError("");

    try {
      const started = await startGameWithQuestionSet({
        roomId: room.id,
        hostPlayerId: playerId,
        presenterPlayerId: room.currentPresenterPlayerId,
        questionSetId: room.preparedQuestionSetId,
        gameMode: gameSettings.gameMode,
        maxRevealRounds: gameSettings.maxRevealRounds,
        roundSeconds: gameSettings.roundSeconds,
        roundScores: gameSettings.roundScores,
      });
      setRoom((currentRoom) => (currentRoom ? { ...currentRoom, ...started.room, players: currentRoom.players } : started.room));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "开始游戏失败，请稍后重试。");
    } finally {
      setIsStartingGame(false);
    }
  }

  return (
    <AppShell>
      {room?.status !== "PLAYING" ? (
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <button
              className="text-sm font-semibold text-[var(--primary)] hover:underline"
              type="button"
              onClick={handleBackHome}
            >
              返回首页
            </button>
            <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">房间 {roomCode}</h1>
            <p className="text-sm text-[var(--muted)] sm:text-base">
              当前玩家：{nickname || "未设置昵称"}
              {isHost ? <span className="ml-2 rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">房主</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-3">
            <QuestionGuideButton />
            {isHost ? (
              <Button type="button" variant="secondary" onClick={handleDissolveRoom} disabled={isDissolving}>
                {isDissolving ? "解散中..." : "解散房间"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="fixed left-1/2 top-4 z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 shadow-lg">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <Panel title="加载房间">
          <p className="text-sm leading-6 text-[var(--muted)]">正在从游戏服务读取房间和玩家列表...</p>
        </Panel>
      ) : !room ? (
        <Panel title="无法加载房间">
          <p className="text-sm leading-6 text-red-700">房间不存在、已被解散，或当前无法连接服务。</p>
          <Button className="mt-4" type="button" onClick={() => router.push("/")}>
            回到首页
          </Button>
        </Panel>
      ) : room.status === "PLAYING" ? (
        <main className="relative left-1/2 w-[calc(100vw-2rem)] -translate-x-1/2 space-y-4 sm:w-[calc(100vw-4rem)]">
          <ImageRevealGame
            room={room}
            playerId={playerId}
            isPresenter={isCurrentPresenter}
            onError={setError}
            onRoomUpdated={(nextRoom) =>
              setRoom((currentRoom) => (currentRoom ? { ...currentRoom, ...nextRoom, players: currentRoom.players } : nextRoom))
            }
          />
          {isHost || !isCurrentPresenter ? (
            <div className="flex flex-wrap justify-end gap-3">
              {isHost ? (
                <Button type="button" variant="secondary" onClick={handleCancelRound} disabled={isCancelingRound}>
                  {isCancelingRound ? "返回中..." : "返回大厅"}
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={handleExitRoom} disabled={isLeavingRoom}>
                  {isLeavingRoom ? "退出中..." : "退出房间"}
                </Button>
              )}
            </div>
          ) : null}
        </main>
      ) : shouldShowLobby ? (
        <div className="grid items-stretch gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="h-full">
            <PlayerList
              players={room.players}
              playerId={playerId}
              presenterPlayerId={room.currentPresenterPlayerId}
              gameMode={gameSettings.gameMode}
            />
          </aside>
          <LobbyMainPanel
            room={room}
            settings={gameSettings}
            isHost={isHost}
            presenterName={presenterName}
            isStartingGame={isStartingGame}
            isCancelingRound={isCancelingRound}
            onSettingsChange={setGameSettings}
            onOpenPresenterPicker={() => setIsPresenterPickerOpen(true)}
            onStartGame={handleStartGame}
            onCancelRound={handleCancelRound}
          />
          <PresenterPickerModal
            room={room}
            isOpen={isPresenterPickerOpen}
            pendingPresenterId={pendingPresenterId}
            onSelectPresenter={handleSelectPresenter}
            onClose={() => setIsPresenterPickerOpen(false)}
          />
        </div>
      ) : shouldShowQuestionSetup ? (
        <div className="grid items-stretch gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="h-full">
            <PlayerList
              players={room.players}
              playerId={playerId}
              presenterPlayerId={room.currentPresenterPlayerId}
              gameMode={gameSettings.gameMode}
            />
          </aside>
          <Panel title="准备题库">
            <StepGuide room={room} isHost={isHost} isCurrentPresenter={isCurrentPresenter} />
            <div className="mt-5 rounded-md border border-[var(--line)] bg-white p-4 text-sm leading-6">
              <QuestionSetUploader
                room={room}
                presenterPlayerId={playerId}
                onRoomUpdated={(nextRoom) =>
                  setRoom((currentRoom) => (currentRoom ? { ...nextRoom, players: currentRoom.players } : nextRoom))
                }
                onError={setError}
                onClearError={() => setError("")}
              />
            </div>
          </Panel>
        </div>
      ) : room.status === "GAME_RESULT" ? (
        <GameResultPanel
          room={room}
          currentGameId={room.currentGameId}
          playerId={playerId}
          isHost={isHost}
          isCurrentPresenter={isCurrentPresenter}
          isReturningToLobby={isReturningToLobby}
          onReturnToLobby={handleReturnToLobby}
          onError={setError}
        />
      ) : (
        <Panel title="当前游戏状态">
          <StepGuide room={room} isHost={isHost} isCurrentPresenter={isCurrentPresenter} />
        </Panel>
      )}
    </AppShell>
  );
}
