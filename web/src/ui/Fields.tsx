"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { CloseIcon, SearchIcon } from "./icons";
import styles from "./ui.module.css";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  unit?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function Field({
  label,
  unit,
  hint,
  error,
  mono = false,
  leading,
  trailing,
  id,
  className,
  ...rest
}: FieldProps) {
  return (
    <div className={[styles.fieldRoot, className ?? ""].filter(Boolean).join(" ")}>
      {label || unit ? (
        <div className={styles.fieldHeader}>
          {label ? (
            <label htmlFor={id} className={styles.fieldLabel}>
              {label}
            </label>
          ) : (
            <span />
          )}
          {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
        </div>
      ) : null}

      <div
        className={[styles.inputShell, error ? styles.inputShellError : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {leading ? <span className={styles.inputLeading}>{leading}</span> : null}
        <input
          id={id}
          aria-invalid={Boolean(error) || undefined}
          className={[styles.input, mono ? styles.inputMono : ""].filter(Boolean).join(" ")}
          {...rest}
        />
        {trailing ? <span className={styles.inputTrailing}>{trailing}</span> : null}
      </div>

      {error ? (
        <span role="alert" className={styles.fieldError}>
          {error}
        </span>
      ) : hint ? (
        <span className={styles.fieldHint}>{hint}</span>
      ) : null}
    </div>
  );
}

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  label?: string;
  shortcut?: string;
  resultCount?: number;
}

export function SearchField({
  value,
  onChange,
  onClear,
  label,
  shortcut = "/",
  resultCount,
  placeholder = "Search buildings, numbers, rooms...",
  id,
  ...rest
}: SearchFieldProps) {
  return (
    <Field
      id={id}
      label={label}
      unit={resultCount !== undefined ? `${resultCount} MATCHES` : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      leading={<SearchIcon size={16} />}
      trailing={
        value ? (
          <button
            type="button"
            className={styles.chipRemove}
            aria-label="Clear search query"
            onClick={() => {
              onChange("");
              onClear?.();
            }}
          >
            <CloseIcon size={14} />
          </button>
        ) : shortcut ? (
          <kbd className={styles.kbdBadge}>{shortcut}</kbd>
        ) : null
      }
      {...rest}
    />
  );
}
