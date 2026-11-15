"use client";

import { useEffect, useState } from "react";
import styles from "./ui.module.css";

export interface StatReadoutProps {
  label: string;
  value: number | string;
  unit?: string;
  sublabel?: string;
  decimals?: number;
  animate?: boolean;
  tone?: "default" | "accent" | "teal" | "safe";
  size?: "sm" | "md";
}

export function StatReadout({
  label,
  value,
  unit,
  sublabel,
  decimals = 0,
  animate = true,
  tone = "default",
  size = "md",
}: StatReadoutProps) {
  const numericTarget = typeof value === "number" ? value : Number.NaN;
  const [displayNumber, setDisplayNumber] = useState<number>(
    Number.isFinite(numericTarget) ? numericTarget : 0,
  );

  useEffect(() => {
    if (!Number.isFinite(numericTarget)) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!animate || prefersReduced) {
      setDisplayNumber(numericTarget);
      return;
    }

    let rafId = 0;
    const startVal = displayNumber;
    const delta = numericTarget - startVal;
    if (Math.abs(delta) < 1e-6) {
      setDisplayNumber(numericTarget);
      return;
    }

    const durationMs = 280;
    const t0 = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplayNumber(startVal + delta * eased);
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setDisplayNumber(numericTarget);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericTarget, animate]);

  const formattedValue = Number.isFinite(numericTarget)
    ? displayNumber.toFixed(decimals)
    : String(value);

  const toneClass =
    tone === "accent"
      ? styles.statReadoutAccent
      : tone === "teal"
        ? styles.statReadoutTeal
        : tone === "safe"
          ? styles.statReadoutSafe
          : "";

  return (
    <div className={[styles.statReadout, toneClass].filter(Boolean).join(" ")}>
      <span className={styles.statLabel}>{label}</span>
      <div className={styles.statValueRow}>
        <span
          className={[styles.statValue, size === "sm" ? styles.statValueSm : ""]
            .filter(Boolean)
            .join(" ")}
        >
          {formattedValue}
        </span>
        {unit ? <span className={styles.statUnit}>{unit}</span> : null}
      </div>
      {sublabel ? <span className={styles.statSublabel}>{sublabel}</span> : null}
    </div>
  );
}
