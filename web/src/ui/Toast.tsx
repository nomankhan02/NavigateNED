import type { ReactNode } from "react";
import { CloseIcon } from "./icons";
import styles from "./ui.module.css";

export type ToastTone = "default" | "safe" | "hazard";

export interface ToastProps {
  tone?: ToastTone;
  title: ReactNode;
  code?: string;
  onDismiss?: () => void;
}

export function Toast({ tone = "default", title, code, onDismiss }: ToastProps) {
  const toneClass =
    tone === "safe"
      ? styles.toastSafe
      : tone === "hazard"
        ? styles.toastHazard
        : "";

  return (
    <div
      role="status"
      aria-live="polite"
      className={[styles.toast, toneClass].filter(Boolean).join(" ")}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {code ? <span className={styles.panelCode}>{code}</span> : null}
        <span>{title}</span>
      </div>
      {onDismiss ? (
        <button
          type="button"
          className={styles.chipRemove}
          aria-label="Dismiss notification"
          onClick={onDismiss}
        >
          <CloseIcon size={14} />
        </button>
      ) : null}
    </div>
  );
}

export interface SurveyLoaderProps {
  label?: string;
}

export function SurveyLoader({ label = "CALIBRATING SURVEY PLATE" }: SurveyLoaderProps) {
  return (
    <div role="status" aria-live="polite" className={styles.surveyLoader}>
      <div className={styles.surveyLoaderTrack} aria-hidden="true">
        <div className={styles.surveyLoaderSweep} />
      </div>
      <span>{label}</span>
    </div>
  );
}
