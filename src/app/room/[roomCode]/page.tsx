"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Panel } from "@/components/Panel";
import { ensurePlayerInMockRoom, getMockRoom } from "@/lib/mockRooms";
import { getLocalSession, saveLocalSession } from "@/lib/localSession";
import type { Room } from "@/types/game";

const statusText: Record<Room["status"], string> = {
  lobby: "大厅等待中",
  selecting_question_master: "选择出题人",
  playing: "游戏进行中",
  finished: "本轮已结束",
};

export default function RoomPage() {
  const params = useParams<{ roomCode: string }>();
  const router = useRouter();
  const roomCode = params.roomCode;
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const session = getLocalSession();
    setPlayerId(session.playerId);
    setNickname(session.nickname);

    if (!session.nickname) {
      setError("缺少昵称，请回到首页重新进入房间。");
      return;
    }

    const currentRoom = ensurePlayerInMockRoom(roomCode, session.playerId, session.nickname);

    if (!currentRoom) {
      setError("没有找到房间。当前阶段房间只保存在本机浏览器中。");
      return;
    }

    saveLocalSession({
      playerId: session.playerId,
      nickname: session.nickname,
      roomCode,
      isHost: currentRoom.hostPlayerId === session.playerId,
    });

    setRoom(currentRoom);

    function refreshRoom() {
      const latestRoom = getMockRoom(roomCode);

      if (latestRoom) {
        setRoom(latestRoom);
      }
    }

    window.addEventListener("storage", refreshRoom);
    const timer = window.setInterval(refreshRoom, 800);

    return () => {
      window.removeEventListener("storage", refreshRoom);
      window.clearInterval(timer);
    };
  }, [roomCode]);

  const currentPlayer = useMemo(
    () => room?.players.find((player) => player.id === playerId) ?? null,
    [playerId, room],
  );

  const isHost = Boolean(currentPlayer?.isHost);

  return (
    <AppShell>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link className="text-sm font-semibold text-[var(--primary)] hover:underline" href="/">
            返回首页
          </Link>
          <h1 className="mt-3 text-4xl font-bold text-slate-950">房间 {roomCode}</h1>
          <p className="mt-2 text-[var(--muted)]">
            当前玩家：{nickname || "未设置昵称"}
            {isHost ? <span className="ml-2 rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">房主</span> : null}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => router.refresh()}>
          刷新视图
        </Button>
      </div>

      {error ? (
        <Panel title="无法加载房间">
          <p className="text-sm leading-6 text-red-700">{error}</p>
          <Button className="mt-4" type="button" onClick={() => router.push("/")}>
            回到首页
          </Button>
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
              本阶段暂不接 Supabase，因此玩家列表来自当前浏览器的本地 mock 数据。下一阶段接入数据库和实时同步后，
              这里会显示同一房间内所有设备的真实玩家列表。
            </div>
          </Panel>
        </div>
      )}
    </AppShell>
  );
}
