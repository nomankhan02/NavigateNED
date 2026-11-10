/**
 * web/src/map/indoor/route.ts
 * Indoor route processing, floor-specific path extraction, and vertical transitions.
 */

import type { IndoorNode } from "./types";

export interface FloorTransitionBadge {
  nodeId: string;
  x: number;
  y: number;
  kind: "stairs" | "lift";
  targetFloor: number;
  direction: "up" | "down";
  type: "depart" | "arrive";
  targetLabel: string;
}

export interface ExtractedFloorRoute {
  polylines: [number, number][][];
  transitions: FloorTransitionBadge[];
  startPoint: [number, number] | null;
  endPoint: [number, number] | null;
}

/**
 * Extracts the route segments and vertical transitions (stairs/lift)
 * applicable to the currently displayed floor.
 */
export function extractFloorRoute(
  route: string[] | undefined | null,
  nodes: IndoorNode[],
  activeFloor: number
): ExtractedFloorRoute {
  const result: ExtractedFloorRoute = {
    polylines: [],
    transitions: [],
    startPoint: null,
    endPoint: null,
  };

  if (!route || route.length < 2 || !nodes || nodes.length === 0) {
    return result;
  }

  const nodeLookup = new Map<string, IndoorNode>();
  for (const n of nodes) {
    nodeLookup.set(n.id, n);
  }

  // Check start and end endpoints on the active floor
  const firstNode = nodeLookup.get(route[0]);
  if (firstNode && firstNode.floor === activeFloor) {
    result.startPoint = [firstNode.x, firstNode.y];
  }

  const lastNode = nodeLookup.get(route[route.length - 1]);
  if (lastNode && lastNode.floor === activeFloor) {
    result.endPoint = [lastNode.x, lastNode.y];
  }

  let currentPolyline: [number, number][] = [];

  for (let i = 0; i < route.length - 1; i++) {
    const u = nodeLookup.get(route[i]);
    const v = nodeLookup.get(route[i + 1]);
    if (!u || !v) continue;

    // Both nodes on the active floor -> walking path
    if (u.floor === activeFloor && v.floor === activeFloor) {
      if (currentPolyline.length === 0) {
        currentPolyline.push([u.x, u.y], [v.x, v.y]);
      } else {
        const lastPt = currentPolyline[currentPolyline.length - 1];
        if (lastPt[0] === u.x && lastPt[1] === u.y) {
          currentPolyline.push([v.x, v.y]);
        } else {
          result.polylines.push(currentPolyline);
          currentPolyline = [[u.x, u.y], [v.x, v.y]];
        }
      }
    } else {
      // Flush any walking polyline in progress
      if (currentPolyline.length >= 2) {
        result.polylines.push(currentPolyline);
      }
      currentPolyline = [];

      // Inter-floor transition leaving active floor
      if (u.floor === activeFloor && v.floor !== activeFloor) {
        const kind = (u.type === "lift" || v.type === "lift") ? "lift" : "stairs";
        const direction = v.floor > activeFloor ? "up" : "down";
        const targetLabel = v.floor === 0 ? "GF" : `F${v.floor}`;

        result.transitions.push({
          nodeId: u.id,
          x: u.x,
          y: u.y,
          kind,
          targetFloor: v.floor,
          direction,
          type: "depart",
          targetLabel,
        });
      }
      // Inter-floor transition arriving at active floor
      else if (u.floor !== activeFloor && v.floor === activeFloor) {
        const kind = (u.type === "lift" || v.type === "lift") ? "lift" : "stairs";
        const direction = activeFloor > u.floor ? "up" : "down";
        const targetLabel = u.floor === 0 ? "GF" : `F${u.floor}`;

        result.transitions.push({
          nodeId: v.id,
          x: v.x,
          y: v.y,
          kind,
          targetFloor: u.floor,
          direction,
          type: "arrive",
          targetLabel,
        });
      }
    }
  }

  if (currentPolyline.length >= 2) {
    result.polylines.push(currentPolyline);
  }

  return result;
}
