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
import { createUploadedQuestionSet, startGameWithQuestionSet } from "@/lib/supabaseRooms";
import type { QuestionSet, Room } from "@/types/game";

type QuestionSetUploaderProps = {
  room: Room;
  presenterPlayerId: string;
  onRoomUpdated: (room: Room) => void;
  onError: (message: string) => void;
  onClearError?: () => void;
};

type ExistingCloudinaryImage = {
  publicId: string;
  url: string;
  originalUrl: string;
  width: number | null;
  height: number | null;
  createdAt: string | null;
};

const emptyProgress: UploadProgress = {
  done: 0,
  total: 0,
  success: 0,
  fail: 0,
  rawBytes: 0,
  uploadBytes: 0,
  latestMessage: "尚未开始",
};

export function QuestionSetUploader({
  room,
  presenterPlayerId,
  onRoomUpdated,
  onError,
  onClearError,
}: QuestionSetUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<UploadableImage[]>([]);
  const [existingImages, setExistingImages] = useState<ExistingCloudinaryImage[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [isCreatingFromExisting, setIsCreatingFromExisting] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [progress, setProgress] = useState<UploadProgress>(emptyProgress);
  const [results, setResults] = useState<CloudinaryUploadItemResult[]>([]);
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
  const configStatus = getCloudinaryUploadConfigStatus();

  const successfulResults = useMemo(() => results.filter((result) => result.ok), [results]);
  const progressPercent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  function resetCreatedSet() {
    setQuestionSet(null);
    setPreviewUrls([]);
  }

  function clearError() {
    onClearError?.();
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
    setResults([]);
    resetCreatedSet();
  }

  function clearFiles() {
    setItems([]);
    setResults([]);
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

  async function handleLoadExistingImages() {
    clearError();
    setIsLoadingExisting(true);
    setExistingImages([]);
    resetCreatedSet();

    try {
      const response = await fetch("/api/cloudinary-images", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        images?: ExistingCloudinaryImage[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "加载 Cloudinary 图片失败。");
      }

      setExistingImages(data.images ?? []);

      if (!data.images?.length) {
        onError("Cloudinary 当前目录下没有可加载的图片。");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "加载 Cloudinary 图片失败。");
    } finally {
      setIsLoadingExisting(false);
    }
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
      imageUrls,
    });

    setQuestionSet(createdQuestionSet);
    setPreviewUrls(imageUrls);
    clearError();
    return createdQuestionSet;
  }

  async function handleCreateFromExistingImages() {
    clearError();
    setIsCreatingFromExisting(true);

    try {
      await createQuestionSetFromUrls(existingImages.map((image) => image.url));
    } catch (error) {
      onError(error instanceof Error ? error.message : "创建题库失败，请稍后重试。");
    } finally {
      setIsCreatingFromExisting(false);
    }
  }

  async function handleUpload() {
    clearError();

    if (items.length === 0) {
      onError("请先选择至少一张图片。");
      return;
    }

    setIsUploading(true);
    setResults([]);
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
          当前上传配置：最大边 {configStatus.maxSize}px，{configStatus.format}，质量 {configStatus.quality}
        </p>
      </div>

      {!configStatus.isReady ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          缺少 Cloudinary 上传环境变量，无法上传新图片；仍可尝试加载已有图片。
        </div>
      ) : null}

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

      <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold text-slate-900">临时加载 Cloudinary 已有图片</p>
            <p className="mt-1 text-sm text-[var(--muted)]">用于测试阶段复用已上传图片，后续社区题库会替换这块。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={handleLoadExistingImages} disabled={isLoadingExisting}>
              {isLoadingExisting ? "加载中..." : "加载已有图片"}
            </Button>
            <Button
              type="button"
              onClick={handleCreateFromExistingImages}
              disabled={isCreatingFromExisting || existingImages.length === 0}
            >
              {isCreatingFromExisting ? "创建中..." : "用已加载图片创建题库"}
            </Button>
          </div>
        </div>

        {existingImages.length > 0 ? (
          <div className="mt-4">
            <p className="text-sm text-[var(--muted)]">已加载 {existingImages.length} 张 Cloudinary 图片。</p>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {existingImages.slice(0, 18).map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="aspect-square rounded-md border border-[var(--line)] object-cover"
                  key={image.publicId}
                  src={image.url}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

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
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => addFiles(event.target.files)}
        />
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

      {items.length > 0 ? (
        <div className="max-h-32 overflow-auto rounded-md border border-[var(--line)] bg-slate-50 p-3 text-xs text-[var(--muted)]">
          {items.map((item, index) => (
            <div key={item.path}>
              {index + 1}. {item.path}
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">{progress.latestMessage}</p>
      </div>

      <Button type="button" onClick={handleUpload} disabled={!configStatus.isReady || isUploading || items.length === 0}>
        {isUploading ? "上传中..." : "上传并创建题库"}
      </Button>

      {questionSet ? (
        <div className="rounded-md border border-[var(--line)] bg-slate-50 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold text-slate-950">{questionSet.title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">图片数量：{questionSet.imageCount}</p>
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
              ? successfulResults.slice(0, 12).map((result) =>
                  result.ok ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="aspect-square rounded-md border border-[var(--line)] object-cover"
                      key={result.url}
                      src={result.url}
                    />
                  ) : null,
                )
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
