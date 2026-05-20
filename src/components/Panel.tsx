import type { ReactNode } from "react";

type PanelProps = {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
};

export function Panel({ title, children, action }: PanelProps) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(23,32,51,0.08)]">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <div />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
