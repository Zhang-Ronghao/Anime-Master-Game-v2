"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Panel } from "@/components/Panel";
import { clearLocalRoomSession, getLocalSession, saveLocalSession } from "@/lib/localSession";
import { supabase } from "@/lib/supabaseClient";
import {
  dissolveSupabaseRoom,
  getPlayersByRoomId,
  getRoomByCode,
  joinSupabaseRoom,
  leaveSupabaseRoom,
} from "@/lib/supabaseRooms";
import type { Room } from "@/types/game";

const statusText: Record<Room["status"], string> = {
  LOBBY: "大厅等待中",
  SELECTING_PRESENTER: "选择出题人",
  PLAYING: "游戏进行中",
  FINISHED: "本轮已结束",
};

export default function RoomPage() {
  const params = useParams<{ roomCode: string }>();
  const router = useRouter();
  const roomCode = params.roomCode;
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDissolving, setIsDissolving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadRoom() {
      setIsLoading(true);
      setError("");

      const session = getLocalSession();
      setPlayerId(session.playerId);
      setNickname(session.nickname);

      if (!session.nickname) {
        setError("缺少昵称，请回到首页重新进入房间。");
        setIsLoading(false);
        return;
      }

      try {
        const joined = await joinSupabaseRoom(roomCode, session.playerId, session.nickname);

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

    async function checkRoomStillExists() {
      const latestRoom = await getRoomByCode(roomCode);

      if (!latestRoom) {
        markRoomDissolved();
        return false;
      }

      return true;
    }

    async function refreshPlayers() {
      if (!room?.id) {
        return;
      }

      const players = await getPlayersByRoomId(room.id);

      if (!players.some((player) => player.id === playerId)) {
        const roomExists = await checkRoomStillExists();

        if (!roomExists) {
          return;
        }
      }

      setRoom((currentRoom) => (currentRoom ? { ...currentRoom, players } : currentRoom));
    }

    const channel = supabase
      .channel(`room:${room.id}:players`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${room.id}`,
        },
        async (payload) => {
          if (payload.eventType === "DELETE" && payload.old.id === playerId) {
            const roomExists = await checkRoomStillExists();

            if (!roomExists) {
              return;
            }
          }

          refreshPlayers().catch((caughtError) => {
            setError(caughtError instanceof Error ? caughtError.message : "刷新玩家列表失败。");
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [playerId, room?.id, roomCode]);

  useEffect(() => {
    if (!room?.id) {
      return;
    }

    const channel = supabase
      .channel(`room:${room.id}:meta`)
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        () => {
          clearLocalRoomSession();
          setRoom(null);
          setError("房间已被房主解散。");
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id]);

  const currentPlayer = useMemo(
    () => room?.players.find((player) => player.id === playerId) ?? null,
    [playerId, room],
  );

  const isHost = Boolean(currentPlayer?.isHost);

  async function handleBackHome() {
    try {
      if (room?.id && playerId && !isHost) {
        await leaveSupabaseRoom(room.id, playerId);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "离开房间失败，请稍后重试。");
      return;
    }

    if (!isHost) {
      clearLocalRoomSession();
    }

    router.push("/");
  }

  async function handleDissolveRoom() {
    if (!room?.id || !playerId || !isHost) {
      return;
    }

    const confirmed = window.confirm("确定要解散房间吗？房间内所有玩家都会被移出。");

    if (!confirmed) {
      return;
    }

    setIsDissolving(true);
    setError("");

    try {
      await dissolveSupabaseRoom(room.id, playerId);
      clearLocalRoomSession();
      router.push("/");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "解散房间失败，请稍后重试。");
    } finally {
      setIsDissolving(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <button
            className="text-sm font-semibold text-[var(--primary)] hover:underline"
            type="button"
            onClick={handleBackHome}
          >
            返回首页
          </button>
          <h1 className="mt-3 text-4xl font-bold text-slate-950">房间 {roomCode}</h1>
          <p className="mt-2 text-[var(--muted)]">
            当前玩家：{nickname || "未设置昵称"}
            {isHost ? <span className="ml-2 rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">房主</span> : null}
          </p>
        </div>
        <div className="flex gap-3">
          {isHost ? (
            <Button type="button" variant="secondary" onClick={handleDissolveRoom} disabled={isDissolving}>
              {isDissolving ? "解散中..." : "解散房间"}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => router.refresh()}>
            刷新视图
          </Button>
        </div>
      </div>

      {error ? (
        <Panel title="无法加载房间">
          <p className="text-sm leading-6 text-red-700">{error}</p>
          <Button className="mt-4" type="button" onClick={() => router.push("/")}>
            回到首页
          </Button>
        </Panel>
      ) : isLoading ? (
        <Panel title="加载房间">
          <p className="text-sm leading-6 text-[var(--muted)]">正在从 Supabase 读取房间和玩家列表...</p>
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Panel title="玩家列表">
            <div className="space-y-3">
              {room?.players.map((player) => (
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
                      {player.id === playerId ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">当前标签页玩家</p>
                      ) : null}
                    </div>
                  </div>
                  {player.isHost ? (
                    <span className="rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">房主</span>
                  ) : (
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">玩家</span>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="当前游戏状态">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
                <p className="text-sm text-[var(--muted)]">状态</p>
                <p className="mt-2 text-xl font-semibold">{room ? statusText[room.status] : "加载中"}</p>
              </div>
              <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
                <p className="text-sm text-[var(--muted)]">房主权限</p>
                <p className="mt-2 text-xl font-semibold">{isHost ? "当前玩家是房主" : "当前玩家不是房主"}</p>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-dashed border-[var(--line)] bg-white p-4 text-sm leading-6 text-[var(--muted)]">
              本阶段已接入 Supabase。玩家列表来自数据库，并通过 Supabase Realtime 订阅 players 表变化。
            </div>
          </Panel>
        </div>
      )}
    </AppShell>
  );
}
