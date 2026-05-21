"use client";

import { DragEvent, useMemo, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { FormField } from "@/components/FormField";
import {
  filesToUploadableImages,
  getCloudinaryUploadConfigStatus,
  uploadImagesToCloudinary,
  type CloudinaryUploadItemResult,
  type UploadProgress,
  type UploadableImage,
} from "@/lib/cloudinaryUpload";
import {
  createQuestionSetFromUrlText,
  createUploadedQuestionSet,
  getCommunityQuestionSets,
  parseImageUrlsText,
  startGameWithQuestionSet,
} from "@/lib/supabaseRooms";
import type { QuestionSet, Room } from "@/types/game";

type QuestionSetUploaderProps = {
  room: Room;
  presenterPlayerId: string;
  onRoomUpdated: (room: Room) => void;
  onError: (message: string) => void;
  onClearError?: () => void;
};

type SetupMode = "upload" | "urlText" | "community";
type CommunitySort = "latest" | "rating";

const emptyProgress: UploadProgress = {
  done: 0,
  total: 0,
  success: 0,
  fail: 0,
  rawBytes: 0,
  uploadBytes: 0,
  latestMessage: "尚未开始",
};

function getQuestionSetUrls(questionSet: QuestionSet | null) {
  if (!questionSet) {
    return [];
  }

  const textUrls = parseImageUrlsText(questionSet.imageUrlsText ?? "");

  if (textUrls.length > 0) {
    return textUrls;
  }

  return (questionSet.questions ?? [])
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((question) => question.imageUrl);
}

export function QuestionSetUploader({
  room,
  presenterPlayerId,
  onRoomUpdated,
  onError,
  onClearError,
}: QuestionSetUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<SetupMode>("upload");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [urlText, setUrlText] = useState("");
  const [items, setItems] = useState<UploadableImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingFromText, setIsCreatingFromText] = useState(false);
  const [isLoadingCommunity, setIsLoadingCommunity] = useState(false);
  const [communitySort, setCommunitySort] = useState<CommunitySort>("latest");
  const [communitySets, setCommunitySets] = useState<QuestionSet[]>([]);
  const [communitySearch, setCommunitySearch] = useState("");
  const [previewingCommunitySet, setPreviewingCommunitySet] = useState<QuestionSet | null>(null);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [maxRevealRounds, setMaxRevealRounds] = useState(3);
  const [roundSeconds, setRoundSeconds] = useState(30);
  const [roundScores, setRoundScores] = useState<number[]>([3, 2, 1]);
  const [progress, setProgress] = useState<UploadProgress>(emptyProgress);
  const [results, setResults] = useState<CloudinaryUploadItemResult[]>([]);
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
  const configStatus = getCloudinaryUploadConfigStatus();

  const previewUrls = useMemo(() => getQuestionSetUrls(questionSet), [questionSet]);
  const urlsTextForPreview = previewUrls.join("\n");
  const progressPercent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const filteredCommunitySets = useMemo(() => {
    const terms = communitySearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) {
      return communitySets;
    }

    return communitySets.filter((item) => {
      const searchableText = `${item.title} ${item.description ?? ""}`.toLowerCase();
      return terms.every((term) => searchableText.includes(term));
    });
  }, [communitySearch, communitySets]);

  function clearError() {
    onClearError?.();
  }

  function resetCreatedSet() {
    setQuestionSet(null);
    setResults([]);
  }

  function switchMode(nextMode: SetupMode) {
    setMode(nextMode);
    clearError();

    if (nextMode === "community" && communitySets.length === 0 && !isLoadingCommunity) {
      handleLoadCommunitySets();
    }
  }

  function addFiles(fileList: FileList | File[] | null) {
    if (!fileList) {
      return;
    }

    const incoming = filesToUploadableImages(fileList);
    setItems((currentItems) => {
      const existing = new Set(currentItems.map((item) => item.path));
      const nextItems = [...currentItems];

      for (const item of incoming) {
        if (!existing.has(item.path)) {
          nextItems.push(item);
          existing.add(item.path);
        }
      }

      return nextItems.sort((a, b) => a.path.localeCompare(b.path));
    });
    resetCreatedSet();
  }

  function clearFiles() {
    setItems([]);
    setProgress(emptyProgress);
    resetCreatedSet();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  }

  async function createQuestionSetFromUrls(imageUrls: string[]) {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      onError("请先输入题库标题。");
      return null;
    }

    if (imageUrls.length === 0) {
      onError("至少需要一张图片。");
      return null;
    }

    const createdQuestionSet = await createUploadedQuestionSet({
      roomId: room.id ?? "",
      presenterPlayerId,
      title: trimmedTitle,
      description,
      imageUrls,
    });

    setQuestionSet(createdQuestionSet);
    clearError();
    return createdQuestionSet;
  }

  async function handleUpload() {
    clearError();

    if (items.length === 0) {
      onError("请先选择至少一张图片。");
      return;
    }

    setIsUploading(true);
    resetCreatedSet();
    setProgress({ ...emptyProgress, total: items.length, latestMessage: "开始压缩并上传图片" });

    try {
      const uploadResults = await uploadImagesToCloudinary(items, setProgress);
      setResults(uploadResults);

      const imageUrls = uploadResults
        .filter((result): result is Extract<CloudinaryUploadItemResult, { ok: true }> => result.ok)
        .map((result) => result.url);

      if (imageUrls.length === 0) {
        onError("没有图片上传成功，未创建题库。");
        return;
      }

      await createQuestionSetFromUrls(imageUrls);
    } catch (error) {
      onError(error instanceof Error ? error.message : "上传题库失败，请稍后重试。");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleCreateFromUrlText() {
    clearError();
    setIsCreatingFromText(true);
    resetCreatedSet();

    try {
      const createdQuestionSet = await createQuestionSetFromUrlText({
        roomId: room.id ?? "",
        presenterPlayerId,
        title,
        description,
        imageUrlsText: urlText,
      });
      setQuestionSet(createdQuestionSet);
      clearError();
    } catch (error) {
      onError(error instanceof Error ? error.message : "从 URL 文本创建题库失败。");
    } finally {
      setIsCreatingFromText(false);
    }
  }

  async function handleLoadCommunitySets(nextSort = communitySort) {
    clearError();
    setIsLoadingCommunity(true);

    try {
      const questionSets = await getCommunityQuestionSets(nextSort);
      setCommunitySets(questionSets);
    } catch (error) {
      onError(error instanceof Error ? error.message : "加载社区题库失败。");
    } finally {
      setIsLoadingCommunity(false);
    }
  }

  function handleSelectCommunitySet(selectedQuestionSet: QuestionSet) {
    setQuestionSet(selectedQuestionSet);
    setTitle(selectedQuestionSet.title);
    setDescription(selectedQuestionSet.description ?? "");
    clearError();
  }

  async function handleCopyUrlsText() {
    try {
      await navigator.clipboard.writeText(urlsTextForPreview);
      clearError();
    } catch {
      onError("复制失败，请手动选择 URL 文本。");
    }
  }

  async function handleStartGame() {
    if (!room.id || !questionSet) {
      return;
    }

    clearError();
    setIsStartingGame(true);
    try {
      const started = await startGameWithQuestionSet({
        roomId: room.id,
        presenterPlayerId,
        questionSetId: questionSet.id,
        maxRevealRounds,
        roundSeconds,
        roundScores,
      });
      clearError();
      onRoomUpdated({ ...room, ...started.room, players: room.players });
    } catch (error) {
      onError(error instanceof Error ? error.message : "开始游戏失败，请稍后重试。");
    } finally {
      setIsStartingGame(false);
    }
  }

  return (
    <div className="mt-5 space-y-4 rounded-md border border-[var(--line)] bg-white p-4">
      <div>
        <p className="font-semibold text-slate-900">你是本轮出题人，请准备题库。</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          上传图片会保存上传后的 Cloudinary URL；粘贴已有 URL 不会重新上传或复制图片。
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          ["upload", "上传图片"],
          ["urlText", "粘贴 URL 文本"],
          ["community", "选择社区题库"],
        ].map(([value, label]) => (
          <button
            className={[
              "rounded-md border px-4 py-3 text-sm font-semibold transition",
              mode === value ? "border-rose-300 bg-rose-50 text-rose-700" : "border-[var(--line)] bg-white hover:bg-slate-50",
            ].join(" ")}
            key={value}
            type="button"
            onClick={() => switchMode(value as SetupMode)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="题库标题"
          maxLength={40}
          placeholder="例如：经典动画截图"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            clearError();
          }}
        />
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-900">简介</span>
          <input
            className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
            maxLength={120}
            placeholder="可选"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>

      <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
        <p className="font-semibold text-slate-900">游戏参数</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-900">揭露轮数</span>
            <input
              className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
              min={1}
              max={10}
              type="number"
              value={maxRevealRounds}
              onChange={(event) => {
                const nextRounds = Math.max(1, Math.min(10, Number(event.target.value) || 1));
                setMaxRevealRounds(nextRounds);
                setRoundScores((currentScores) =>
                  Array.from({ length: nextRounds }, (_, index) => currentScores[index] ?? Math.max(1, nextRounds - index)),
                );
              }}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-900">每轮倒计时（秒）</span>
            <input
              className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
              min={1}
              max={600}
              type="number"
              value={roundSeconds}
              onChange={(event) => setRoundSeconds(Math.max(1, Math.min(600, Number(event.target.value) || 30)))}
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: maxRevealRounds }, (_, index) => (
            <label className="block" key={index}>
              <span className="mb-2 block text-sm font-medium text-slate-900">第 {index + 1} 轮分数</span>
              <input
                className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
                min={0}
                type="number"
                value={roundScores[index] ?? 0}
                onChange={(event) => {
                  const nextScore = Math.max(0, Number(event.target.value) || 0);
                  setRoundScores((currentScores) =>
                    currentScores.map((score, scoreIndex) => (scoreIndex === index ? nextScore : score)),
                  );
                }}
              />
            </label>
          ))}
        </div>
      </div>

      {mode === "upload" ? (
        <div className="space-y-4">
          {!configStatus.isReady ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              缺少 Cloudinary 上传环境变量，无法上传新图片。
            </div>
          ) : null}
          <div
            className={`rounded-md border-2 border-dashed p-5 text-center transition ${
              isDragging ? "border-rose-300 bg-rose-50" : "border-[var(--line)] bg-slate-50"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <p className="text-sm font-semibold text-slate-900">拖拽图片到这里</p>
            <p className="mt-1 text-sm text-[var(--muted)]">也可以批量选择图片或选择整个文件夹。</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                选择图片
              </Button>
              <Button type="button" variant="secondary" onClick={() => folderInputRef.current?.click()}>
                选择文件夹
              </Button>
              <Button type="button" variant="secondary" onClick={clearFiles} disabled={isUploading || items.length === 0}>
                清空
              </Button>
            </div>
            <input ref={fileInputRef} className="hidden" type="file" accept="image/*" multiple onChange={(event) => addFiles(event.target.files)} />
            <input
              ref={folderInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => addFiles(event.target.files)}
            />
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-md bg-slate-50 p-3">已选择：{items.length}</div>
            <div className="rounded-md bg-slate-50 p-3">成功：{progress.success}</div>
            <div className="rounded-md bg-slate-50 p-3">失败：{progress.fail}</div>
          </div>
          <div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{progress.latestMessage}</p>
          </div>
          <Button type="button" onClick={handleUpload} disabled={!configStatus.isReady || isUploading || items.length === 0}>
            {isUploading ? "上传中..." : "上传并创建题库"}
          </Button>
        </div>
      ) : null}

      {mode === "urlText" ? (
        <div className="space-y-3 rounded-md border border-[var(--line)] bg-slate-50 p-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-900">图片 URL 文本</span>
            <textarea
              className="min-h-44 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
              placeholder={"每行一个 http/https 图片 URL\nhttps://res.cloudinary.com/.../image.webp"}
              value={urlText}
              onChange={(event) => {
                setUrlText(event.target.value);
                resetCreatedSet();
                clearError();
              }}
            />
          </label>
          <p className="text-sm text-[var(--muted)]">检测到 {parseImageUrlsText(urlText).length} 个有效 URL。</p>
          <Button type="button" onClick={handleCreateFromUrlText} disabled={isCreatingFromText}>
            {isCreatingFromText ? "创建中..." : "用 URL 文本创建题库"}
          </Button>
        </div>
      ) : null}

      {mode === "community" ? (
        <div className="space-y-3 rounded-md border border-[var(--line)] bg-slate-50 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold text-slate-900">社区题库</p>
              <p className="mt-1 text-sm text-[var(--muted)]">选择后直接使用原题库开始游戏，不复制图片或 questions。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-12 rounded-md border border-[var(--line)] bg-white px-3 text-sm"
                value={communitySort}
                onChange={(event) => {
                  const nextSort = event.target.value as CommunitySort;
                  setCommunitySort(nextSort);
                  handleLoadCommunitySets(nextSort);
                }}
              >
                <option value="latest">最新</option>
                <option value="rating">评分最高</option>
              </select>
              <Button type="button" variant="secondary" onClick={() => handleLoadCommunitySets()} disabled={isLoadingCommunity}>
                {isLoadingCommunity ? "加载中..." : "刷新列表"}
              </Button>
            </div>
          </div>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-900">搜索题库</span>
            <input
              className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
              placeholder="按标题或简介实时搜索"
              value={communitySearch}
              onChange={(event) => setCommunitySearch(event.target.value)}
            />
            <span className="mt-2 block text-xs text-[var(--muted)]">
              搜索会随输入实时过滤，当前显示 {filteredCommunitySets.length} / {communitySets.length} 个题库。
            </span>
          </label>
          <div className="grid max-h-[54vh] gap-3 overflow-y-auto pr-1">
            {filteredCommunitySets.map((item) => (
                <div
                  className="rounded-md border border-[var(--line)] bg-white p-3 text-left transition hover:border-rose-300 hover:bg-rose-50"
                  key={item.id}
                >
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                    <div>
                      <p className="font-semibold text-slate-950">{item.title}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{item.description || "暂无简介"}</p>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        {item.imageCount} 张，评分 {Number(item.ratingAvg).toFixed(2)} / 5，{item.ratingCount} 人评分，创建于{" "}
                        {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => setPreviewingCommunitySet(item)}>
                        预览
                      </Button>
                      <Button type="button" onClick={() => handleSelectCommunitySet(item)}>
                        选择
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            {!isLoadingCommunity && communitySets.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">暂无社区题库，点击刷新列表或先发布一个题库。</p>
            ) : null}
            {!isLoadingCommunity && communitySets.length > 0 && filteredCommunitySets.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">没有匹配的社区题库。</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {previewingCommunitySet ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 px-4 py-6">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-2xl">
            <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-start">
              <div>
                <p className="text-lg font-semibold text-slate-950">{previewingCommunitySet.title}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{previewingCommunitySet.description || "暂无简介"}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {previewingCommunitySet.imageCount} 张，评分 {Number(previewingCommunitySet.ratingAvg).toFixed(2)} / 5，
                  {previewingCommunitySet.ratingCount} 人评分
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    handleSelectCommunitySet(previewingCommunitySet);
                    setPreviewingCommunitySet(null);
                  }}
                >
                  选择题库
                </Button>
                <button
                  className="rounded-md border border-[var(--line)] px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                  type="button"
                  onClick={() => setPreviewingCommunitySet(null)}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {getQuestionSetUrls(previewingCommunitySet).map((url, index) => (
                  <figure className="rounded-md border border-[var(--line)] bg-slate-50 p-2" key={`${url}-${index}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" className="aspect-video w-full rounded bg-black object-contain" src={url} />
                    <figcaption className="mt-2 text-xs text-[var(--muted)]">第 {index + 1} 张</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {questionSet ? (
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold text-slate-950">{questionSet.title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                图片数量：{questionSet.imageCount}，{questionSet.isPublic ? "社区公开题库" : "未发布题库"}
              </p>
            </div>
            <Button type="button" onClick={handleStartGame} disabled={isStartingGame}>
              {isStartingGame ? "启动中..." : "开始游戏"}
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {previewUrls.slice(0, 12).map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" className="aspect-square rounded-md border border-[var(--line)] object-cover" key={url} src={url} />
            ))}
            {previewUrls.length === 0
              ? results.slice(0, 12).map((result) =>
                  result.ok ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" className="aspect-square rounded-md border border-[var(--line)] object-cover" key={result.url} src={result.url} />
                  ) : null,
                )
              : null}
          </div>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-medium text-slate-900">image_urls_text</span>
            <textarea
              className="min-h-32 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-xs outline-none"
              readOnly
              value={urlsTextForPreview}
            />
          </label>
          <Button className="mt-3" type="button" variant="secondary" onClick={handleCopyUrlsText}>
            复制 URL 文本
          </Button>
        </div>
      ) : null}
    </div>
  );
}
