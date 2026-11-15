"use client";

import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { CloseIcon } from "./icons";
import styles from "./ui.module.css";

/* --- Toggle --- */
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: string;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  id?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  leadingIcon,
  id,
}: ToggleProps) {
  return (
    <label
      htmlFor={id}
      className={[
        styles.toggleWrapper,
        checked ? styles.toggleWrapperChecked : "",
        disabled ? styles.toggleDisabled : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.toggleText}>
        <span className={styles.toggleLabel}>
          {leadingIcon}
          {label}
        </span>
        {hint ? <span className={styles.toggleHint}>{hint}</span> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={[
          styles.toggleTrack,
          checked ? styles.toggleTrackChecked : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className={styles.toggleThumb} />
      </button>
    </label>
  );
}

/* --- SegmentedControl --- */
export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number | string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  fullWidth?: boolean;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  fullWidth = false,
}: SegmentedControlProps<T>) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabledIndices = options
      .map((opt, idx) => (opt.disabled ? -1 : idx))
      .filter((idx) => idx >= 0);
    if (enabledIndices.length === 0) return;

    const currentIdx = options.findIndex((o) => o.value === value);
    const pos = enabledIndices.indexOf(currentIdx);
    if (pos < 0) return;

    let nextPos = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextPos = (pos + 1) % enabledIndices.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextPos = (pos - 1 + enabledIndices.length) % enabledIndices.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextPos = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextPos = enabledIndices.length - 1;
    }

    if (nextPos >= 0) {
      const targetIdx = enabledIndices[nextPos];
      const nextOption = options[targetIdx];
      onChange(nextOption.value);
      btnRefs.current[targetIdx]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={[styles.segmented, fullWidth ? styles.segmentedFull : ""].filter(Boolean).join(" ")}
    >
      {options.map((opt, idx) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={[styles.segmentBtn, active ? styles.segmentBtnActive : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {opt.icon}
            <span>{opt.label}</span>
            {opt.count !== undefined ? (
              <span className={styles.segmentCount}>{opt.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* --- Chip --- */
export interface ChipProps {
  label: string;
  active?: boolean;
  count?: number | string;
  leadingIcon?: ReactNode;
  onClick?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
}

export function Chip({
  label,
  active = false,
  count,
  leadingIcon,
  onClick,
  onRemove,
  disabled = false,
}: ChipProps) {
  return (
    <span
      role={onClick ? "button" : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      aria-pressed={onClick ? active : undefined}
      onClick={() => !disabled && onClick?.()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onClick && !disabled) {
          e.preventDefault();
          onClick();
        }
      }}
      className={[styles.chip, active ? styles.chipActive : ""].filter(Boolean).join(" ")}
    >
      {leadingIcon}
      <span>{label}</span>
      {count !== undefined ? <span className={styles.chipCount}>{count}</span> : null}
      {onRemove ? (
        <button
          type="button"
          className={styles.chipRemove}
          aria-label={`Remove ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onRemove();
          }}
        >
          <CloseIcon size={12} />
        </button>
      ) : null}
    </span>
  );
}

