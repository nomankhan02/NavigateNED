"use client";

import type { TraceEvent, TraceReplayState } from "@/map";
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  PauseIcon,
  PlayIcon,
} from "@/ui";
import styles from "./traceReplayPanel.module.css";

export interface TraceReplayPanelProps {
  traceReplay: TraceReplayState;
  events: TraceEvent[];
  hasIndoor: boolean;
  onClose: () => void;
}

const SPEEDS = [0.5, 1, 2, 5] as const;

export function TraceReplayPanel({
  traceReplay,
  events,
  hasIndoor,
  onClose,
}: TraceReplayPanelProps) {
  const total = traceReplay.totalEvents;
  const safeIndex = Math.max(0, Math.min(Math.max(0, total - 1), traceReplay.currentIndex));
  const currentEvent = total > 0 ? events[safeIndex] : undefined;
  const currentDist =
    currentEvent && Number.isFinite(currentEvent.dist) && currentEvent.dist < 1e8
      ? currentEvent.dist
      : 0;

  return (
    <div className={styles.panel} role="region" aria-label="Search trace replay">
      <div className={styles.topRow}>
        <span className={styles.title}>Search replay</span>
        <Button
          size="sm"
          variant="quiet"
          aria-label="Close search replay"
          leadingIcon={<CloseIcon size={14} />}
          onClick={onClose}
        >
          Close
        </Button>
      </div>

      <div className={styles.readoutGrid}>
        <div className={styles.readoutCell}>
          <span className={styles.readoutLabel}>Visited</span>
          <span className={styles.readoutValue}>{traceReplay.visitedNodeIds.length}</span>
        </div>
        <div className={styles.readoutCell}>
          <span className={styles.readoutLabel}>Frontier</span>
          <span className={styles.readoutValue}>{traceReplay.frontierNodeIds.length}</span>
        </div>
        <div className={styles.readoutCell}>
          <span className={styles.readoutLabel}>Distance</span>
          <span className={styles.readoutValue}>{currentDist.toFixed(1)} m</span>
        </div>
      </div>

      <div className={styles.scrubberRow}>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={traceReplay.currentIndex < 0 ? 0 : safeIndex}
          disabled={total === 0}
          aria-label="Trace replay step"
          className={styles.scrubber}
          onChange={(e) => {
            traceReplay.pause();
            traceReplay.seek(Number(e.target.value));
          }}
        />
        <span className={styles.stepNum}>
          {total > 0 ? `${Math.max(0, traceReplay.currentIndex) + 1}/${total}` : "0/0"}
        </span>
      </div>

      <div className={styles.controlsRow}>
        <div className={styles.transportBtns}>
          <Button
            size="sm"
            variant="secondary"
            disabled={total === 0 || traceReplay.currentIndex <= 0}
            aria-label="Step back"
            leadingIcon={<ChevronLeftIcon size={14} />}
            onClick={() => {
              traceReplay.pause();
              traceReplay.seek(Math.max(0, traceReplay.currentIndex - 1));
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={total === 0}
            aria-label={traceReplay.isPlaying ? "Pause replay" : "Play replay"}
            leadingIcon={traceReplay.isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            onClick={() => traceReplay.toggle()}
          >
            {traceReplay.isPlaying ? "Pause" : "Play"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={total === 0 || traceReplay.currentIndex >= total - 1}
            aria-label="Step forward"
            leadingIcon={<ChevronRightIcon size={14} />}
            onClick={() => {
              traceReplay.pause();
              traceReplay.seek(Math.min(total - 1, traceReplay.currentIndex + 1));
            }}
          />
        </div>

        <div className={styles.speedGroup} role="group" aria-label="Replay speed">
          {SPEEDS.map((spd) => {
            const active = Math.abs(traceReplay.speedMultiplier - spd) < 0.01;
            return (
              <button
                key={spd}
                type="button"
                className={[
                  styles.speedChip,
                  active ? styles.speedChipActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => traceReplay.setSpeed(spd)}
              >
                {spd}x
              </button>
            );
          })}
        </div>
      </div>

      {hasIndoor ? (
        <p className={styles.indoorNote}>
          Outdoor search replayed; indoor leg uses direct room-to-entrance routing.
        </p>
      ) : null}
    </div>
  );
}
