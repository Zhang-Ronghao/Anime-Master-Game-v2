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

const gameModeText: Record<GameMode, string> = {
  ROUND_REVEAL: "轮揭竞答模式",
  BUZZER_FIRST_CORRECT: "抢答模式 - 首答制",
  BUZZER_RANKED: "抢答模式 - 排名得分制",
  TEAM_BATTLE: "红蓝对抗揭图模式",
};

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

function PlayerPill({ player, playerId, presenterPlayerId }: { player: Player; playerId: string; presenterPlayerId?: string | null }) {
  const isPresenter = player.id === presenterPlayerId;

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950">{player.nickname}</p>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
          {player.id === playerId ? <span>当前标签页玩家</span> : null}
          {isPresenter ? <span>本局出题人</span> : null}
        </div>
      </div>
      <span className={player.isHost ? "shrink-0 rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700" : "shrink-0 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"}>
        {player.isHost ? "房主" : "玩家"}
      </span>
    </div>
  );
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
  if (gameMode === "TEAM_BATTLE") {
    const presenter = players.find((player) => player.id === presenterPlayerId);
    const guessers = players.filter((player) => player.id !== presenterPlayerId);

    return (
      <Panel title="队伍与玩家">
        <div className="space-y-4">
          {presenter ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-950">出题人</p>
                <span className="rounded bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">裁判</span>
              </div>
              <PlayerPill player={presenter} playerId={playerId} presenterPlayerId={presenterPlayerId} />
            </div>
          ) : null}
          <div className="rounded-md border border-[var(--line)] bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-950">答题玩家</p>
              <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">开始后随机平均分队</span>
            </div>
            <div className="grid gap-2">
              {guessers.length > 0 ? (
                guessers.map((player) => (
                  <PlayerPill key={player.id} player={player} playerId={playerId} presenterPlayerId={presenterPlayerId} />
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">等待答题玩家加入。</p>
              )}
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="玩家列表">
      <div className="space-y-3">
        {players.map((player) => {
          const isPresenter = player.id === presenterPlayerId;

          return (
            <div
              className="flex items-center justify-between rounded-md border border-[var(--line)] bg-white px-3 py-3 shadow-sm"
              key={player.id}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-900 text-sm font-bold text-white">
                  {player.nickname.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{player.nickname}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                    {player.id === playerId ? <span>当前标签页玩家</span> : null}
                    {isPresenter ? <span>本局出题人</span> : null}
                  </div>
                </div>
              </div>
              <span
                className={
                  player.isHost
                    ? "rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                    : "rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
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
    <Panel title="本局游戏设置">
      <p className="text-sm leading-6 text-[var(--muted)]">
        这里设置每张图片的揭露轮数、每轮倒计时和每轮答对分数。设置会在房主点击“开始游戏”时写入本局游戏。
      </p>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-slate-900">游戏模式</span>
        <select
          className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition disabled:bg-slate-100 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
          disabled={!canEdit}
          value={settings.gameMode}
          onChange={(event) => onChange({ ...settings, gameMode: event.target.value as GameMode })}
        >
          {Object.entries(gameModeText).map(([mode, text]) => (
            <option key={mode} value={mode}>
              {text}
            </option>
          ))}
        </select>
      </label>
      {!isTeamBattleMode ? (
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-900">揭露轮数</span>
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
          <span className="mb-2 block text-sm font-medium text-slate-900">每轮倒计时（秒）</span>
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
        <div className="mt-3 rounded-md border border-[var(--line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--muted)]">
          除出题者外随机平均分成红蓝两队。每回合由当前队伍投票选择揭露方块，再投票决定是否猜测；猜中队伍 +1 分，猜错则对方下回合可揭露 2 个方块。
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-[var(--line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--muted)]">
          {settings.gameMode === "BUZZER_FIRST_CORRECT"
            ? "首答制：每轮每人 1 次抢答机会，第一个答对者 +1 分并结束本题。"
            : "排名得分制：每轮每人 1 次抢答机会，按本题答对顺序计分：第 1 名 +N，第 2 名 +N-1，依次递减，最低 +1。"}
        </div>
      )}
      {!canEdit ? <p className="mt-3 text-sm text-[var(--muted)]">当前阶段你只能查看设置，不能修改。</p> : null}
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
  const shouldShowLobby = room?.status === "LOBBY" || (room?.status === "QUESTION_SETUP" && !isCurrentPresenter);

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
      ) : (
        <div className={shouldShowLobby ? "grid gap-5 lg:grid-cols-[0.9fr_1.1fr]" : "grid gap-5"}>
          {shouldShowLobby ? (
            <PlayerList
              players={room.players}
              playerId={playerId}
              presenterPlayerId={room.currentPresenterPlayerId}
              gameMode={gameSettings.gameMode}
            />
          ) : null}

          <div className="space-y-5">
            {shouldShowLobby ? (
              <GameSettingsPanel
                settings={gameSettings}
                canEdit={isHost}
                onChange={setGameSettings}
              />
            ) : null}

            {room.status !== "GAME_RESULT" ? (
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

              {room.status === "QUESTION_SETUP" ? (
                <div className="mt-5 rounded-md border border-[var(--line)] bg-white p-4 text-sm leading-6">
                  {isCurrentPresenter ? (
                    <QuestionSetUploader
                      room={room}
                      presenterPlayerId={playerId}
                      onRoomUpdated={(nextRoom) =>
                        setRoom((currentRoom) => (currentRoom ? { ...nextRoom, players: currentRoom.players } : nextRoom))
                      }
                      onError={setError}
                      onClearError={() => setError("")}
                    />
                  ) : (
                    <p className="font-semibold text-slate-900">
                      {room.preparedQuestionSetId ? "出题人已准备好题库，房主可以开始游戏。" : "等待出题人准备题库。"}
                    </p>
                  )}
                  {isHost ? (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        type="button"
                        onClick={handleStartGame}
                        disabled={isStartingGame || !room.preparedQuestionSetId}
                      >
                        {isStartingGame ? "启动中..." : "开始游戏"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleCancelRound}
                        disabled={isCancelingRound}
                      >
                        {isCancelingRound ? "取消中..." : "取消本局"}
                      </Button>
                      {!room.preparedQuestionSetId ? (
                        <p className="basis-full text-sm text-[var(--muted)]">出题人准备好题库后才能开始。</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

            </Panel>
            ) : null}

            {room.status === "GAME_RESULT" ? (
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
            ) : null}

            {isHost && room.status === "LOBBY" ? (
              <Panel title="选择出题人">
                <div className="space-y-3">
                  {room.players.map((player) => (
                    <button
                      className="flex w-full items-center justify-between rounded-md border border-[var(--line)] bg-white px-4 py-3 text-left transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={Boolean(pendingPresenterId)}
                      key={player.id}
                      type="button"
                      onClick={() => handleSelectPresenter(player.id)}
                    >
                      <span>
                        <span className="block font-semibold text-slate-950">{player.nickname}</span>
                        <span className="mt-1 block text-xs text-[var(--muted)]">
                          {player.isHost ? "房主也可以作为出题人" : "玩家"}
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-[var(--primary)]">
                        {pendingPresenterId === player.id ? "选择中..." : "选择"}
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}
    </AppShell>
  );
}
