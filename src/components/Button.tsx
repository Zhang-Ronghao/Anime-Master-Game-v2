import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ className = "", variant = "primary", ...buttonProps }: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? "bg-[var(--primary)] text-white shadow-lg shadow-rose-200 hover:bg-[var(--primary-strong)]"
      : "border border-[var(--line)] bg-white text-[var(--foreground)] hover:bg-slate-50";

  return (
    <button
      {...buttonProps}
      className={`h-12 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${variantClass} ${className}`}
    />
  );
}
