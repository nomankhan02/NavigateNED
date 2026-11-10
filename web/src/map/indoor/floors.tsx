/**
 * web/src/map/indoor/floors.tsx
 * Multi-floor state helpers and vertical floor switcher component.
 */

import React from "react";
import type { IndoorBuilding, IndoorFloor } from "./types";

/**
 * Returns the sorted floor list for a building (sorted ascending by level).
 */
export function getBuildingFloors(
  building: IndoorBuilding | null | undefined
): IndoorFloor[] {
  if (!building || !building.floors) return [];
  return [...building.floors].sort((a, b) => a.level - b.level);
}

/**
 * Computes the set of floor levels that contain at least one node of the active route.
 */
export function getFloorsWithRoute(
  building: IndoorBuilding | null | undefined,
  route?: string[] | null
): Set<number> {
  const result = new Set<number>();
  if (!building || !route || route.length === 0) return result;

  const nodeFloorMap = new Map<string, number>();
  for (const n of building.nodes) {
    nodeFloorMap.set(n.id, n.floor);
  }

  for (const nid of route) {
    const fl = nodeFloorMap.get(nid);
    if (fl !== undefined) {
      result.add(fl);
    }
  }

  return result;
}

export interface FloorSwitcherProps {
  floors: IndoorFloor[];
  activeFloor: number;
  onSelectFloor: (level: number) => void;
  routeFloors?: Set<number>;
  className?: string;
}

/**
 * Vertical Floor Switcher HUD component.
 * Displays floors in architectural order (top floor on top, ground floor on bottom).
 */
export function FloorSwitcher({
  floors,
  activeFloor,
  onSelectFloor,
  routeFloors,
  className = "",
}: FloorSwitcherProps) {
  if (!floors || floors.length <= 1) {
    return null;
  }

  // Display top floor at the top (descending by level)
  const displayFloors = [...floors].sort((a, b) => b.level - a.level);

  return (
    <nav
      className={`ned-indoor-floor-switcher ${className}`}
      aria-label="Floor selection"
    >
      {displayFloors.map((fl) => {
        const isActive = fl.level === activeFloor;
        const hasRoute = routeFloors?.has(fl.level) ?? false;
        const shortLabel =
          fl.level === 0
            ? "GF"
            : fl.level === 1
            ? "1F"
            : fl.level === 2
            ? "2F"
            : fl.level === 3
            ? "3F"
            : `F${fl.level}`;

        return (
          <button
            key={fl.level}
            type="button"
            className={`ned-indoor-floor-btn ${
              isActive ? "ned-indoor-floor-btn--active" : ""
            }`}
            onClick={() => onSelectFloor(fl.level)}
            aria-pressed={isActive}
            aria-label={`${fl.label} (Level ${fl.level})${
              hasRoute ? ", contains route" : ""
            }`}
            title={`${fl.label} (Level ${fl.level})`}
          >
            <span>{shortLabel}</span>
            {hasRoute && (
              <span
                className="ned-indoor-floor-route-dot"
                aria-hidden="true"
                title="Route passes through this floor"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
