"use client";

import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "./icons";
import styles from "./ui.module.css";

export type SheetSnap = "peek" | "half" | "expanded";

export interface SheetProps {
  snap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  title?: string;
  code?: string;
  headerSlot?: ReactNode;
  vellum?: boolean;
  className?: string;
  children: ReactNode;
}

const SNAP_ORDER: readonly SheetSnap[] = ["peek", "half", "expanded"];

export function Sheet({
  snap: controlledSnap,
  onSnapChange,
  title,
  code,
  headerSlot,
  vellum = true,
  className,
  children,
}: SheetProps) {
  const [internalSnap, setInternalSnap] = useState<SheetSnap>("half");
  const snap = controlledSnap ?? internalSnap;
  const startYRef = useRef<number | null>(null);

  const setSnap = (next: SheetSnap) => {
    setInternalSnap(next);
    onSnapChange?.(next);
  };

  const cycleSnap = (dir: 1 | -1) => {
    const idx = SNAP_ORDER.indexOf(snap);
    const nextIdx = Math.max(0, Math.min(SNAP_ORDER.length - 1, idx + dir));
    setSnap(SNAP_ORDER[nextIdx]);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    startYRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (startYRef.current === null) return;
    const dy = e.clientY - startYRef.current;
    startYRef.current = null;
    if (dy < -28) {
      cycleSnap(1);
    } else if (dy > 28) {
      cycleSnap(-1);
    }
  };

  const snapClass =
    snap === "peek"
      ? styles.sheetSnapPeek
      : snap === "expanded"
        ? styles.sheetSnapExpanded
        : styles.sheetSnapHalf;

  return (
    <aside
      aria-label={title ?? "Navigation survey panel"}
      className={[
        styles.sheet,
        vellum ? styles.panelVellum : styles.panel,
        snapClass,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={styles.sheetHandleBar}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <div className={styles.sheetHandleGrip} />
        <div className={styles.sheetSnapRow}>
          <span className={styles.panelCode}>
            {code ?? "PLATE // SHEET"} [{snap.toUpperCase()}]
          </span>
          <div style={{ display: "inline-flex", gap: 4 }}>
            <button
              type="button"
              className={[styles.iconButton, styles.iconButtonSm, styles.sheetHandleBtn].join(" ")}
              aria-label="Expand sheet"
              disabled={snap === "expanded"}
              onClick={() => cycleSnap(1)}
            >
              <ChevronUpIcon size={14} />
            </button>
            <button
              type="button"
              className={[styles.iconButton, styles.iconButtonSm, styles.sheetHandleBtn].join(" ")}
              aria-label="Collapse sheet"
              disabled={snap === "peek"}
              onClick={() => cycleSnap(-1)}
            >
              <ChevronDownIcon size={14} />
            </button>
          </div>
        </div>
      </div>

      {headerSlot ? <div>{headerSlot}</div> : null}

      <div className={styles.sheetContent}>{children}</div>
    </aside>
  );
}
