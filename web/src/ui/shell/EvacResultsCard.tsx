"use client";

import type {
  EvacDataset,
  EvacuateResponse,
  EvacuationCompareResponse,
} from "@/core/navcore";
import styles from "./evacuatePanel.module.css";

export interface EvacResultsCardProps {
  totalPeople: number;
  evacDataset: EvacDataset | null;
  result: EvacuateResponse | null;
  compare: EvacuationCompareResponse | null;
}

export function EvacResultsCard({
  totalPeople,
  evacDataset,
  result,
  compare,
}: EvacResultsCardProps) {
  if (!result) return null;

  const assigned = Math.max(0, totalPeople - result.unassigned);
  const nameById = new Map<string, string>();
  if (evacDataset) {
    for (const area of evacDataset.assemblyAreas) {
      nameById.set(area.id, area.name);
    }
  }

  return (
    <>
      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>Evacuation summary</h3>
        <div className={styles.totalsGrid}>
          <div className={styles.totalCell}>
            <span className={styles.totalLabel}>People</span>
            <span className={styles.totalValue}>{totalPeople}</span>
          </div>
          <div className={styles.totalCell}>
            <span className={styles.totalLabel}>Assigned</span>
            <span className={styles.totalValue}>{assigned}</span>
          </div>
          <div className={styles.totalCell}>
            <span className={styles.totalLabel}>Unassigned</span>
            <span
              className={[
                styles.totalValue,
                result.unassigned > 0 ? styles.totalValueHazard : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {result.unassigned}
            </span>
          </div>
          <div className={styles.totalCell}>
            <span className={styles.totalLabel}>Total distance</span>
            <span className={styles.totalValue}>
              {Math.round(result.totalDistance)} m
            </span>
          </div>
        </div>
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>Assembly area load</h3>
        <div className={styles.loadList}>
          {result.assemblyLoad.map((area) => {
            const pct =
              area.capacity > 0
                ? Math.min(100, (area.assigned / area.capacity) * 100)
                : 0;
            const over = area.assigned > area.capacity;
            const label = area.name || nameById.get(area.id) || area.id;
            return (
              <div key={area.id} className={styles.loadRow}>
                <div className={styles.loadHeader}>
                  <span className={styles.loadName}>{label}</span>
                  <span
                    className={[
                      styles.loadNums,
                      over ? styles.loadNumsOver : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {area.assigned} / {area.capacity}
                  </span>
                </div>
                <div className={styles.loadTrack}>
                  <div
                    className={[
                      styles.loadFill,
                      over ? styles.loadFillOver : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {compare ? (
        <section className={styles.sectionCard}>
          <h3 className={styles.sectionTitle}>Nearest vs Capacity-aware</h3>
          <div className={styles.compareTable}>
            <span className={styles.compareHead}>Metric</span>
            <span className={styles.compareHead}>Nearest</span>
            <span className={styles.compareHead}>Capacity</span>

            <span className={styles.compareMetric}>Overloaded areas</span>
            <span
              className={[
                styles.compareNum,
                compare.overloadedAreasCount.nearest > 0
                  ? styles.totalValueHazard
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {compare.overloadedAreasCount.nearest}
            </span>
            <span
              className={[
                styles.compareNum,
                compare.overloadedAreasCount.capacity > 0
                  ? styles.totalValueHazard
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {compare.overloadedAreasCount.capacity}
            </span>

            <span className={styles.compareMetric}>Max area load</span>
            <span className={styles.compareNum}>
              {compare.maxAssemblyLoad.nearest}
            </span>
            <span className={styles.compareNum}>
              {compare.maxAssemblyLoad.capacity}
            </span>

            <span className={styles.compareMetric}>Total distance</span>
            <span className={styles.compareNum}>
              {Math.round(compare.totalDistance.nearest)} m
            </span>
            <span className={styles.compareNum}>
              {Math.round(compare.totalDistance.capacity)} m
            </span>
          </div>
        </section>
      ) : null}
    </>
  );
}
