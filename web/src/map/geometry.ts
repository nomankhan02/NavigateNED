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

export function haversineMeters(a: LatLngCoord, b: LatLngCoord): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function shrinkPolygonTowardCentroid(
  poly: LatLngCoord[],
  shrinkRatio = 0.15
): LatLngCoord[] {
  if (poly.length < 3) return poly;
  let sumLat = 0;
  let sumLng = 0;
  for (const pt of poly) {
    sumLat += pt[0];
    sumLng += pt[1];
  }
  const cLat = sumLat / poly.length;
  const cLng = sumLng / poly.length;
  const scale = 1 - shrinkRatio;
  return poly.map(([lat, lng]) => [
    cLat + (lat - cLat) * scale,
    cLng + (lng - cLng) * scale,
  ]);
}

export function pointInPolygon(pt: LatLngCoord, poly: LatLngCoord[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0];
    const xi = poly[i][1];
    const yj = poly[j][0];
    const xj = poly[j][1];
    const intersect =
      yi > pt[0] !== yj > pt[0] &&
      pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentIntersectionT(
  a: LatLngCoord,
  b: LatLngCoord,
  c: LatLngCoord,
  d: LatLngCoord
): number | null {
  const rLat = b[0] - a[0];
  const rLng = b[1] - a[1];
  const sLat = d[0] - c[0];
  const sLng = d[1] - c[1];
  const denom = rLng * sLat - rLat * sLng;
  if (Math.abs(denom) < 1e-14) return null;
  const qLat = c[0] - a[0];
  const qLng = c[1] - a[1];
  const t = (qLng * sLat - qLat * sLng) / denom;
  const u = (qLng * rLat - qLat * rLng) / denom;
  if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
    return Math.max(0, Math.min(1, t));
  }
  return null;
}

export interface RouteTrimResult {
  coords: LatLngCoord[];
  trimmedMeters: number;
  wasTrimmed: boolean;
}

/**
 * Walks a route polyline in order and cuts it at the first point inside the
 * destination footprint (shrunk 15% toward its centroid). If the route never
 * enters the shrunk footprint, returns the original coordinates unchanged.
 */
export function trimRouteAtDestinationFootprint(
  coords: LatLngCoord[],
  footprint: LatLngCoord[] | undefined | null,
  shrinkRatio = 0.15
): RouteTrimResult {
  if (!coords || coords.length < 2 || !footprint || footprint.length < 3) {
    return { coords, trimmedMeters: 0, wasTrimmed: false };
  }

  const shrunk = shrinkPolygonTowardCentroid(footprint, shrinkRatio);
  if (pointInPolygon(coords[0], shrunk)) {
    return { coords, trimmedMeters: 0, wasTrimmed: false };
  }

  let cutSegIdx = -1;
  let cutPoint: LatLngCoord | null = null;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    let bestT: number | null = null;
    for (let j = 0; j < shrunk.length; j++) {
      const c = shrunk[j];
      const d = shrunk[(j + 1) % shrunk.length];
      const t = segmentIntersectionT(a, b, c, d);
      if (t !== null && (bestT === null || t < bestT)) {
        bestT = t;
      }
    }
    if (bestT !== null) {
      cutSegIdx = i;
      cutPoint = [
        a[0] + (b[0] - a[0]) * bestT,
        a[1] + (b[1] - a[1]) * bestT,
      ];
      break;
    }
    if (pointInPolygon(b, shrunk)) {
      cutSegIdx = i;
      cutPoint = b;
      break;
    }
  }

  if (cutSegIdx < 0 || !cutPoint) {
    return { coords, trimmedMeters: 0, wasTrimmed: false };
  }

  const kept = coords.slice(0, cutSegIdx + 1);
  const lastKept = kept[kept.length - 1];
  if (lastKept[0] !== cutPoint[0] || lastKept[1] !== cutPoint[1]) {
    kept.push(cutPoint);
  }
  if (kept.length < 2) {
    return { coords, trimmedMeters: 0, wasTrimmed: false };
  }

  let trimmedMeters = haversineMeters(cutPoint, coords[cutSegIdx + 1]);
  for (let i = cutSegIdx + 1; i < coords.length - 1; i++) {
    trimmedMeters += haversineMeters(coords[i], coords[i + 1]);
  }

  return { coords: kept, trimmedMeters, wasTrimmed: true };
}

/**
 * Dev-only self-checks for trimRouteAtDestinationFootprint (not a test framework).
 */
export function runGeometryTrimSelfChecks(): boolean {
  const poly: LatLngCoord[] = [
    [24.93, 67.11],
    [24.931, 67.11],
    [24.931, 67.111],
    [24.93, 67.111],
  ];
  const entering: LatLngCoord[] = [
    [24.929, 67.1105],
    [24.9305, 67.1105],
    [24.9315, 67.1105],
  ];
  const r1 = trimRouteAtDestinationFootprint(entering, poly, 0.15);
  const outside: LatLngCoord[] = [
    [24.929, 67.109],
    [24.931, 67.109],
  ];
  const r2 = trimRouteAtDestinationFootprint(outside, poly, 0.15);
  return r1.wasTrimmed && r1.trimmedMeters > 0 && !r2.wasTrimmed && r2.coords.length === 2;
}
