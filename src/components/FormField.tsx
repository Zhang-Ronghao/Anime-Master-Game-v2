import type { InputHTMLAttributes } from "react";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function FormField({ label, ...inputProps }: FormFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[var(--foreground)]">{label}</span>
      <input
        {...inputProps}
        className="h-12 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-rose-100"
      />
    </label>
  );
}
