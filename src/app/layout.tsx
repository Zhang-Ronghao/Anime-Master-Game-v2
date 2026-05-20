import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anime Master Game",
  description: "多人实时动画截图猜番小游戏",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
