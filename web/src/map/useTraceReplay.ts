"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type { TraceEvent, TraceReplayState } from "./types";

const BASE_STEP_MS = 380;

export function useTraceReplay(
  trace: TraceEvent[] | null | undefined,
  initialSpeed = 1
): TraceReplayState {
  const events = useMemo(() => trace ?? [], [trace]);
  const totalSteps = events.length;

  const [currentIndex, setCurrentIndex] = useState<number>(
    totalSteps > 0 ? 0 : -1
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeedState] = useState<number>(initialSpeed);

  // Reset index when trace reference or length changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentIndex(events.length > 0 ? 0 : -1);
  }, [events]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying || totalSteps === 0) return;

    const intervalMs = Math.max(40, Math.round(BASE_STEP_MS / Math.max(0.25, speed)));
    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= totalSteps - 1) {
          setIsPlaying(false);
          return totalSteps - 1;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, totalSteps, speed]);

  const play = useCallback(() => {
    if (totalSteps === 0) return;
    setCurrentIndex((prev) => (prev >= totalSteps - 1 || prev < 0 ? 0 : prev));
    setIsPlaying(true);
  }, [totalSteps]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (totalSteps === 0) return;
    setIsPlaying((prevPlaying) => {
      if (!prevPlaying) {
        setCurrentIndex((idx) => (idx >= totalSteps - 1 || idx < 0 ? 0 : idx));
      }
      return !prevPlaying;
    });
  }, [totalSteps]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(totalSteps > 0 ? 0 : -1);
  }, [totalSteps]);

  const seek = useCallback(
    (index: number) => {
      if (totalSteps === 0) {
        setCurrentIndex(-1);
        return;
      }
      const clamped = Math.max(-1, Math.min(totalSteps - 1, Math.floor(index)));
      setCurrentIndex(clamped);
    },
    [totalSteps]
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
      if (ev.op === "visit") {
        visitedSet.add(ev.nodeId);
        frontierSet.delete(ev.nodeId);
      } else if (ev.op === "frontier") {
        if (!visitedSet.has(ev.nodeId)) {
          frontierSet.add(ev.nodeId);
        }
      } else if (ev.op === "relax") {
        relaxedSet.add(ev.nodeId);
        if (!visitedSet.has(ev.nodeId)) {
          frontierSet.add(ev.nodeId);
        }
      }
      if (i === limit) {
        activeNodeId = ev.nodeId;
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
    currentIndex,
    totalSteps,
    isPlaying,
    speed,
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
