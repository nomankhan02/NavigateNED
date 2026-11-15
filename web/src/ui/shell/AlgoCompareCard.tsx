"use client";

import { useEffect, useState } from "react";
import {
  compareAlgorithms,
  type CompareAlgoEntry,
  type NavAlgo,
} from "@/core/navcore";
import { Button, CloseIcon, SurveyLoader } from "@/ui";
import styles from "./algoCompare.module.css";

export interface AlgoCompareCardProps {
  fromId: string;
  toId: string;
  accessible: boolean;
  currentAlgo: NavAlgo;
  onSelectAlgo: (algo: NavAlgo) => void;
  onClose: () => void;
}

interface AlgoMeta {
  key: NavAlgo;
  label: string;
  colorToken: string;
}

const ALGO_LIST: AlgoMeta[] = [
  { key: "astar", label: "A*", colorToken: "var(--color-signal-vermilion)" },
  { key: "dijkstra", label: "Dijkstra", colorToken: "var(--color-network-teal)" },
  { key: "bfs", label: "BFS", colorToken: "var(--color-safe-green)" },
  { key: "bellmanford", label: "Bellman-Ford", colorToken: "var(--color-caution-amber)" },
  { key: "floyd", label: "Floyd-Warshall", colorToken: "var(--color-text-secondary)" },
];

interface MetricSpec {
  id: string;
  title: string;
  unit: string;
  getValue: (entry: CompareAlgoEntry) => number;
  format: (val: number) => string;
}

const METRICS: MetricSpec[] = [
  {
    id: "nodes",
    title: "Nodes visited",
    unit: "nodes",
    getValue: (e) => e.nodesVisited ?? e.visitedCount ?? 0,
    format: (v) => String(Math.round(v)),
  },
  {
    id: "edges",
    title: "Edges relaxed",
    unit: "edges",
    getValue: (e) => e.edgesRelaxed ?? e.hops ?? 0,
    format: (v) => String(Math.round(v)),
  },
  {
    id: "time",
    title: "Time",
    unit: "µs",
    getValue: (e) => e.timeUs ?? Math.round((e.timeMs ?? 0) * 1000),
    format: (v) => `${Math.round(v)} µs`,
  },
  {
    id: "distance",
    title: "Distance",
    unit: "m",
    getValue: (e) => (e.found ? e.distance : 0),
    format: (v) => `${v.toFixed(1)} m`,
  },
];

export function AlgoCompareCard({
  fromId,
  toId,
  accessible,
  currentAlgo,
  onSelectAlgo,
  onClose,
}: AlgoCompareCardProps) {
  const [results, setResults] = useState<Record<string, CompareAlgoEntry> | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    compareAlgorithms({ from: fromId, to: toId, accessible })
      .then((res) => {
        if (cancelled) return;
        setResults(res.results ?? {});
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromId, toId, accessible]);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Compare routing algorithms"
      onClick={onClose}
    >
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>Compare algorithms</h2>
            <p className={styles.subtitle}>
              Click any algorithm row to select it and replay its search trace.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<CloseIcon size={14} />}
            onClick={onClose}
          >
            Close
          </Button>
        </div>

        {loading ? (
          <div className={styles.statusBox}>
            <SurveyLoader label="BENCHMARKING 5 ALGORITHMS" />
          </div>
        ) : error ? (
          <div className={styles.statusBox}>{error}</div>
        ) : results ? (
          <div className={styles.chartsGrid}>
            {METRICS.map((metric) => {
              const entries = ALGO_LIST.map((meta) => ({
                meta,
                entry: results[meta.key],
                value: results[meta.key]?.found
                  ? metric.getValue(results[meta.key])
                  : 0,
              }));
              const foundValues = entries
                .filter((x) => x.entry?.found)
                .map((x) => x.value);
              const maxVal = Math.max(1, ...foundValues);
              const bestVal =
                foundValues.length > 0 ? Math.min(...foundValues) : null;

              return (
                <section key={metric.id} className={styles.chartCard}>
                  <div className={styles.chartHeader}>
                    <span className={styles.chartTitle}>{metric.title}</span>
                    <span className={styles.chartUnit}>{metric.unit}</span>
                  </div>

                  <div className={styles.rows}>
                    {entries.map(({ meta, entry, value }) => {
                      const found = Boolean(entry?.found);
                      const isBest =
                        found && bestVal !== null && Math.abs(value - bestVal) < 1e-6;
                      const pct = found
                        ? Math.max(4, Math.min(100, (value / maxVal) * 100))
                        : 0;
                      const isSelected = currentAlgo === meta.key;

                      return (
                        <button
                          key={meta.key}
                          type="button"
                          className={[
                            styles.algoRow,
                            isSelected ? styles.algoRowSelected : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => onSelectAlgo(meta.key)}
                        >
                          <div className={styles.rowTop}>
                            <span className={styles.algoName}>
                              <span
                                className={styles.swatch}
                                style={{ backgroundColor: meta.colorToken }}
                              />
                              {meta.label}
                            </span>
                            <span className={styles.rowRight}>
                              {isBest ? (
                                <span className={styles.bestTag}>Best</span>
                              ) : null}
                              <span className={styles.metricValue}>
                                {found ? metric.format(value) : "No path"}
                              </span>
                            </span>
                          </div>
                          <svg
                            className={styles.barSvg}
                            viewBox="0 0 100 8"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <rect
                              x="0"
                              y="1"
                              width="100"
                              height="6"
                              rx="2"
                              fill="var(--color-border-hairline)"
                            />
                            {found ? (
                              <rect
                                x="0"
                                y="1"
                                width={pct}
                                height="6"
                                rx="2"
                                fill={meta.colorToken}
                                className={styles.barFill}
                              />
                            ) : null}
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
