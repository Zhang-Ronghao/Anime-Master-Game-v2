import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CloudinaryResource = {
  public_id: string;
  secure_url: string;
  width?: number;
  height?: number;
  created_at?: string;
};

export async function GET() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = process.env.CLOUDINARY_FOLDER ?? process.env.NEXT_PUBLIC_CLOUDINARY_FOLDER ?? "";
  const limit = Math.max(1, Math.min(100, Number(process.env.CLOUDINARY_EXISTING_IMAGE_LIMIT ?? 50)));

  if (!cloudName || !apiKey || !apiSecret) {
    return NextResponse.json(
      {
        error: "缺少 Cloudinary 服务端配置：NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME、CLOUDINARY_API_KEY 或 CLOUDINARY_API_SECRET。",
      },
      { status: 500 },
    );
  }

  const url = new URL(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/image/upload`);
  url.searchParams.set("max_results", String(limit));

  if (folder) {
    url.searchParams.set("prefix", folder.endsWith("/") ? folder : `${folder}/`);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
    },
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as {
    resources?: CloudinaryResource[];
    error?: { message?: string };
  };

  if (!response.ok) {
    return NextResponse.json(
      { error: data.error?.message ?? `Cloudinary HTTP ${response.status}` },
      { status: response.status },
    );
  }

  const images = (data.resources ?? []).map((resource) => ({
    publicId: resource.public_id,
    url: resource.secure_url,
    originalUrl: resource.secure_url,
    width: resource.width ?? null,
    height: resource.height ?? null,
    createdAt: resource.created_at ?? null,
  }));

  return NextResponse.json({ images, folder, limit });
}
