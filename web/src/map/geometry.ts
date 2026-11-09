/**
 * web/src/map/geometry.ts
 * Geometry and path coordinate helpers for Leaflet polyline rendering.
 * Resolves edge geometries, re-orients segments along traversal directions,
 * and falls back to straight-line node coordinates when geometry is absent.
 */

import type { OutdoorEdge, OutdoorNode } from "./types";

export type LatLngCoord = [number, number];

/**
 * Builds a Map of node IDs to OutdoorNode objects for O(1) lookups.
 */
export function buildNodeLookup(
  nodes: OutdoorNode[]
): Map<string, OutdoorNode> {
  const lookup = new Map<string, OutdoorNode>();
  for (const n of nodes) {
    lookup.set(n.id, n);
  }
  return lookup;
}

/**
 * Finds an edge connecting node `u` and node `v` regardless of stored direction.
 */
export function findEdge(
  edges: OutdoorEdge[],
  u: string,
  v: string
): OutdoorEdge | undefined {
  return edges.find(
    (e) => (e.a === u && e.b === v) || (e.a === v && e.b === u)
  );
}

/**
 * Returns the coordinates for a single edge oriented in the traversal direction
 * from `fromId` to `toId`.
 *
 * If `edge.geometry` is present and valid (>= 2 points):
 * - If `edge.b === fromId` and `edge.a === toId`: reverses `geometry` so points
 *   proceed from `b` to `a`.
 * - Otherwise: returns a copy of `geometry`.
 *
 * If `edge.geometry` is missing or has < 2 points:
 * - Falls back to a straight line segment from `fromId` to `toId` using `nodeLookup`.
 */
export function getOrientedEdgeCoordinates(
  edge: OutdoorEdge,
  fromId: string,
  toId: string,
  nodeLookup?: Map<string, OutdoorNode>
): LatLngCoord[] | null {
  if (edge.geometry && edge.geometry.length >= 2) {
    if (edge.b === fromId && edge.a === toId) {
      return [...edge.geometry].reverse();
    }
    return edge.geometry.slice();
  }

  // Fallback to straight line between endpoints
  if (nodeLookup) {
    const na = nodeLookup.get(fromId);
    const nb = nodeLookup.get(toId);
    if (na && nb) {
      return [
        [na.lat, na.lng],
        [nb.lat, nb.lng],
      ];
    }
  }

  return null;
}

/**
 * Resolves coordinates connecting `fromId` to `toId`.
 * Checks for an existing edge in `edges` (orienting its geometry accordingly).
 * If no edge exists or geometry is absent, falls back to a straight line
 * connecting the two nodes via `nodeLookup`.
 */
export function getEdgeCoordinatesBetween(
  edges: OutdoorEdge[],
  fromId: string,
  toId: string,
  nodeLookup: Map<string, OutdoorNode>
): LatLngCoord[] | null {
  const edge = findEdge(edges, fromId, toId);
  if (edge) {
    const oriented = getOrientedEdgeCoordinates(edge, fromId, toId, nodeLookup);
    if (oriented && oriented.length >= 2) {
      return oriented;
    }
  }

  const na = nodeLookup.get(fromId);
  const nb = nodeLookup.get(toId);
  if (na && nb) {
    return [
      [na.lat, na.lng],
      [nb.lat, nb.lng],
    ];
  }

  return null;
}

/**
 * Returns coordinates for an edge in the debug graph view.
 * Uses `edge.geometry` when present; falls back to straight line [na, nb].
 */
export function getDebugGraphEdgeCoordinates(
  edge: OutdoorEdge,
  nodeLookup: Map<string, OutdoorNode>
): LatLngCoord[] | null {
  if (edge.geometry && edge.geometry.length >= 2) {
    return edge.geometry;
  }
  const na = nodeLookup.get(edge.a);
  const nb = nodeLookup.get(edge.b);
  if (!na || !nb) return null;
  return [
    [na.lat, na.lng],
    [nb.lat, nb.lng],
  ];
}

/**
 * Joins consecutive edges of an ordered path of node IDs (e.g. route or
 * evacuation assignment path) into a continuous polyline coordinate array.
 *
 * Each edge's geometry is oriented in the traversal direction (reversed if
 * traversing from `b` to `a`). Duplicate consecutive coordinates at segment
 * joints are de-duplicated so the resulting polyline renders smoothly.
 * Falls back to straight lines for any segments lacking stored geometry.
 */
export function getPathCoordinates(
  pathNodeIds: string[] | undefined | null,
  edges: OutdoorEdge[],
  nodeLookup: Map<string, OutdoorNode>
): LatLngCoord[] {
  if (!pathNodeIds || pathNodeIds.length === 0) {
    return [];
  }
  if (pathNodeIds.length === 1) {
    const n = nodeLookup.get(pathNodeIds[0]);
    return n ? [[n.lat, n.lng]] : [];
  }

  const coords: LatLngCoord[] = [];

  for (let i = 0; i < pathNodeIds.length - 1; i++) {
    const u = pathNodeIds[i];
    const v = pathNodeIds[i + 1];
    const segment = getEdgeCoordinatesBetween(edges, u, v, nodeLookup);
    if (!segment || segment.length === 0) continue;

    for (let j = 0; j < segment.length; j++) {
      const pt = segment[j];
      if (coords.length > 0) {
        const last = coords[coords.length - 1];
        // Skip duplicate joint coordinate
        if (last[0] === pt[0] && last[1] === pt[1]) {
          continue;
        }
      }
      coords.push(pt);
    }
  }

  return coords;
}

/**
 * Returns polyline coordinate segments connecting consecutive visited nodes
 * in trace replay where an edge exists in the graph.
 * Uses edge geometry when present; falls back to straight lines.
 */
export function getTraceSegments(
  visitedNodeIds: string[],
  edges: OutdoorEdge[],
  nodeLookup: Map<string, OutdoorNode>
): LatLngCoord[][] {
  const segments: LatLngCoord[][] = [];
  if (!visitedNodeIds || visitedNodeIds.length < 2) {
    return segments;
  }

  for (let i = 0; i < visitedNodeIds.length - 1; i++) {
    const u = visitedNodeIds[i];
    const v = visitedNodeIds[i + 1];
    const edge = findEdge(edges, u, v);
    if (!edge) continue;

    const coords = getOrientedEdgeCoordinates(edge, u, v, nodeLookup);
    if (coords && coords.length >= 2) {
      segments.push(coords);
    }
  }

  return segments;
}
