"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type { TraceEvent, TraceReplayState } from "./types";

const BASE_STEP_MS = 380;

export function useTraceReplay(
  trace: TraceEvent[] | null | undefined,
  initialSpeed = 1
): TraceReplayState {
  const events = useMemo(() => trace ?? [], [trace]);
  const totalEvents = events.length;

  const [currentIndex, setCurrentIndex] = useState<number>(
    totalEvents > 0 ? 0 : -1
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speedMultiplier, setSpeedState] = useState<number>(initialSpeed);

  // Reset index when trace reference or length changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentIndex(events.length > 0 ? 0 : -1);
  }, [events]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying || totalEvents === 0) return;

    const intervalMs = Math.max(
      40,
      Math.round(BASE_STEP_MS / Math.max(0.25, speedMultiplier))
    );
    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= totalEvents - 1) {
          setIsPlaying(false);
          return totalEvents - 1;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, totalEvents, speedMultiplier]);

  const play = useCallback(() => {
    if (totalEvents === 0) return;
    setCurrentIndex((prev) => (prev >= totalEvents - 1 || prev < 0 ? 0 : prev));
    setIsPlaying(true);
  }, [totalEvents]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (totalEvents === 0) return;
    setIsPlaying((prevPlaying) => {
      if (!prevPlaying) {
        setCurrentIndex((idx) => (idx >= totalEvents - 1 || idx < 0 ? 0 : idx));
      }
      return !prevPlaying;
    });
  }, [totalEvents]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(totalEvents > 0 ? 0 : -1);
  }, [totalEvents]);

  const seek = useCallback(
    (index: number) => {
      if (totalEvents === 0) {
        setCurrentIndex(-1);
        return;
      }
      const clamped = Math.max(-1, Math.min(totalEvents - 1, Math.floor(index)));
      setCurrentIndex(clamped);
    },
    [totalEvents]
  );

  const setSpeed = useCallback((multiplier: number) => {
    setSpeedState(Math.max(0.25, Math.min(16, multiplier)));
  }, []);

  const derived = useMemo(() => {
    const visitedSet = new Set<string>();
    const frontierSet = new Set<string>();
    const relaxedSet = new Set<string>();
    let activeNodeId: string | null = null;

    const limit = Math.min(currentIndex, events.length - 1);
    for (let i = 0; i <= limit; i++) {
      const ev = events[i];
      if (!ev) continue;
      if (ev.type === "visit") {
        visitedSet.add(ev.node);
        frontierSet.delete(ev.node);
      } else if (ev.type === "frontier") {
        if (!visitedSet.has(ev.node)) {
          frontierSet.add(ev.node);
        }
      } else if (ev.type === "relax") {
        relaxedSet.add(ev.node);
        if (!visitedSet.has(ev.node)) {
          frontierSet.add(ev.node);
        }
      }
      if (i === limit) {
        activeNodeId = ev.node;
      }
    }

    return {
      visitedNodeIds: Array.from(visitedSet),
      frontierNodeIds: Array.from(frontierSet),
      relaxedNodeIds: Array.from(relaxedSet),
      activeNodeId,
    };
  }, [events, currentIndex]);

  return {
    isPlaying,
    currentIndex,
    totalEvents,
    speedMultiplier,
    visitedNodeIds: derived.visitedNodeIds,
    frontierNodeIds: derived.frontierNodeIds,
    relaxedNodeIds: derived.relaxedNodeIds,
    activeNodeId: derived.activeNodeId,
    play,
    pause,
    toggle,
    reset,
    seek,
    setSpeed,
  };
}
