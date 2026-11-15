"use client";

import { useState, type ReactNode } from "react";
import type { Maneuver, ManeuverType, NavAlgo } from "@/core/navcore";
import {
  Badge,
  BuildingIcon,
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EntranceIcon,
  LiftIcon,
  RouteIcon,
  StairsIcon,
  type SheetSnap,
} from "@/ui";
import styles from "./routeCard.module.css";

export interface RouteCardProps {
  fromLabel: string;
  toLabel: string;
  distanceM: number;
  algo: NavAlgo;
  maneuvers: Maneuver[];
  activeStepIndex: number;
  onStepChange: (index: number) => void;
  onEnterBuilding?: (buildingId: string) => void;
  indoorLoading?: boolean;
  sheetSnap?: SheetSnap;
}

function renderManeuverIcon(type: ManeuverType): ReactNode {
  switch (type) {
    case "enter-building":
      return <EntranceIcon size={18} />;
    case "stairs-up":
    case "stairs-down":
      return <StairsIcon size={18} />;
    case "lift":
      return <LiftIcon size={18} />;
    default:
      return <RouteIcon size={18} />;
  }
}

function extractBuildingIdFromNode(nodeId: string): string | null {
  const idx = nodeId.indexOf(":");
  return idx > 0 ? nodeId.slice(0, idx) : null;
}

export function RouteCard({
  fromLabel,
  toLabel,
  distanceM,
  algo,
  maneuvers,
  activeStepIndex,
  onStepChange,
  onEnterBuilding,
  indoorLoading = false,
  sheetSnap = "peek",
}: RouteCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (maneuvers.length === 0) return null;

  const safeIdx = Math.max(0, Math.min(maneuvers.length - 1, activeStepIndex));
  const current = maneuvers[safeIdx];
  const walkMinutes = Math.max(1, Math.round(distanceM / 78));
  const buildingIdForStep =
    current.type === "enter-building"
      ? extractBuildingIdFromNode(current.atNodeId)
      : null;

  return (
    <section
      aria-label="Active route directions"
      className={[
        styles.routeCard,
        sheetSnap === "expanded" ? styles.routeCardHiddenMobile : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.headerRow}>
        <span className={styles.routeTitle}>
          {fromLabel} → {toLabel}
        </span>
        <div className={styles.metaPills}>
          <span className={styles.numMetric}>{distanceM.toFixed(1)} m</span>
          <span className={styles.numMetric}>{walkMinutes} min</span>
          <span className={styles.numMetric}>{maneuvers.length} steps</span>
          <Badge variant="vermilion" numeric>
            {algo.toUpperCase()}
          </Badge>
        </div>
      </div>

      {!expanded ? (
        <>
          <div className={styles.currentStepBox}>
            <span className={styles.currentStepIcon}>
              {renderManeuverIcon(current.type)}
            </span>
            <div className={styles.currentStepBody}>
              <span className={styles.currentStepText}>{current.text}</span>
              <span className={styles.currentStepDist}>
                {current.distanceM > 0
                  ? `${current.distanceM.toFixed(0)} m leg`
                  : "Destination"}
              </span>
            </div>
          </div>

          {buildingIdForStep && onEnterBuilding ? (
            <div className={styles.indoorActionBar}>
              <Button
                size="sm"
                variant="primary"
                chamfer
                loading={indoorLoading}
                leadingIcon={<BuildingIcon size={14} />}
                onClick={() => onEnterBuilding(buildingIdForStep)}
              >
                Enter {current.landmark || buildingIdForStep}?
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={indoorLoading}
                onClick={() => onEnterBuilding(buildingIdForStep)}
              >
                Open indoor map
              </Button>
            </div>
          ) : null}

          <div className={styles.controlsRow}>
            <div className={styles.navBtns}>
              <Button
                size="sm"
                variant="secondary"
                disabled={safeIdx <= 0}
                leadingIcon={<ChevronLeftIcon size={14} />}
                onClick={() => onStepChange(safeIdx - 1)}
              >
                Prev
              </Button>
              <span className={styles.stepCounter}>
                {safeIdx + 1} / {maneuvers.length}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={safeIdx >= maneuvers.length - 1}
                trailingIcon={<ChevronRightIcon size={14} />}
                onClick={() => onStepChange(safeIdx + 1)}
              >
                Next
              </Button>
            </div>

            <Button
              size="sm"
              variant="quiet"
              onClick={() => setExpanded(true)}
            >
              Expand
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.expandedList}>
            {maneuvers.map((m, idx) => {
              const bid =
                m.type === "enter-building"
                  ? extractBuildingIdFromNode(m.atNodeId)
                  : null;
              return (
                <button
                  key={`${m.type}-${m.atNodeId}-${idx}`}
                  type="button"
                  className={[
                    styles.expandedRow,
                    idx === safeIdx ? styles.expandedRowActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onStepChange(idx)}
                >
                  <span className={styles.expandedRowLeft}>
                    <span className={styles.currentStepIcon}>
                      {renderManeuverIcon(m.type)}
                    </span>
                    <span className={styles.expandedRowText}>{m.text}</span>
                  </span>
                  {bid && onEnterBuilding ? (
                    <span
                      className={styles.indoorActionBar}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEnterBuilding(bid);
                      }}
                    >
                      <Badge variant="vermilion">Enter</Badge>
                    </span>
                  ) : m.distanceM > 0 ? (
                    <span className={styles.expandedRowDist}>
                      {m.distanceM.toFixed(0)} m
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className={styles.controlsRow}>
            <span className={styles.stepCounter}>
              Step {safeIdx + 1} of {maneuvers.length}
            </span>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<CloseIcon size={14} />}
              onClick={() => setExpanded(false)}
            >
              Close
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
