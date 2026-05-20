import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </main>
  );
}
