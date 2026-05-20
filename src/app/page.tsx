"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { FormField } from "@/components/FormField";
import { Panel } from "@/components/Panel";
import { createNewLocalPlayerSession, getLocalSession, saveLocalSession } from "@/lib/localSession";
import { createMockRoom, getMockRoom, hasPlayerInMockRoom, joinMockRoom } from "@/lib/mockRooms";

export default function HomePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const session = getLocalSession();
    setNickname(session.nickname);
    setRoomCode(session.roomCode ?? "");
  }, []);

  function validateNickname() {
    const trimmedNickname = nickname.trim();

    if (!trimmedNickname) {
      setError("请先输入昵称。");
      return null;
    }

    return trimmedNickname;
  }

  function handleCreateRoom() {
    const trimmedNickname = validateNickname();

    if (!trimmedNickname) {
      return;
    }

    const session = getLocalSession();
    const room = createMockRoom(session.playerId, trimmedNickname);

    saveLocalSession({
      playerId: session.playerId,
      nickname: trimmedNickname,
      roomCode: room.code,
      isHost: true,
    });

    router.push(`/room/${room.code}`);
  }

  function handleJoinRoom() {
    const trimmedNickname = validateNickname();
    const trimmedRoomCode = roomCode.trim();

    if (!trimmedNickname) {
      return;
    }

    if (!/^\d{6}$/.test(trimmedRoomCode)) {
      setError("请输入 6 位房间号。");
      return;
    }

    const existingRoom = getMockRoom(trimmedRoomCode);

    if (!existingRoom) {
      setError("房间不存在。请先由房主创建房间。");
      return;
    }

    let session = getLocalSession();
    const existingPlayer = existingRoom.players.find((player) => player.id === session.playerId);

    if (existingPlayer && existingPlayer.nickname !== trimmedNickname) {
      session = createNewLocalPlayerSession(trimmedNickname);
    }

    if (!hasPlayerInMockRoom(trimmedRoomCode, session.playerId)) {
      saveLocalSession({
        playerId: session.playerId,
        nickname: trimmedNickname,
      });
    }

    const room = joinMockRoom(trimmedRoomCode, session.playerId, trimmedNickname);

    if (!room) {
      setError("房间不存在。请先由房主创建房间。");
      return;
    }

    const isHost = room.hostPlayerId === session.playerId;

    saveLocalSession({
      playerId: session.playerId,
      nickname: trimmedNickname,
      roomCode: room.code,
      isHost,
    });

    router.push(`/room/${room.code}`);
  }

  return (
    <AppShell>
      <div className="grid min-h-[calc(100vh-64px)] items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <div className="mb-6 inline-flex items-center rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-[var(--primary)] shadow-sm">
            Anime Master Game
          </div>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight text-slate-950 sm:text-5xl">
            根据动画截图猜动画的多人实时小游戏
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)]">
            当前阶段使用本地 mock 数据搭建创建房间、加入房间和房间页面骨架，后续会替换为 Supabase 实时同步。
          </p>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white bg-white/70 p-4 shadow-sm">
              <p className="text-2xl font-bold text-slate-950">6 位</p>
              <p className="mt-1 text-sm text-[var(--muted)]">房间号</p>
            </div>
            <div className="rounded-lg border border-white bg-white/70 p-4 shadow-sm">
              <p className="text-2xl font-bold text-slate-950">本地</p>
              <p className="mt-1 text-sm text-[var(--muted)]">临时身份</p>
            </div>
            <div className="rounded-lg border border-white bg-white/70 p-4 shadow-sm">
              <p className="text-2xl font-bold text-slate-950">MVP</p>
              <p className="mt-1 text-sm text-[var(--muted)]">阶段 1</p>
            </div>
          </div>
        </section>

        <Panel title="进入房间">
          <div className="space-y-4">
            <FormField
              label="昵称"
              maxLength={20}
              placeholder="例如：小明"
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                setError("");
              }}
            />

            <Button className="w-full" type="button" onClick={handleCreateRoom}>
              创建房间
            </Button>

            <div className="border-t border-[var(--line)] pt-4">
              <FormField
                label="房间号"
                inputMode="numeric"
                maxLength={6}
                placeholder="输入 6 位房间号"
                value={roomCode}
                onChange={(event) => {
                  setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setError("");
                }}
              />
              <Button className="mt-4 w-full" type="button" variant="secondary" onClick={handleJoinRoom}>
                加入房间
              </Button>
            </div>

            {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
