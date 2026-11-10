/**
 * web/src/map/indoor/labels.ts
 * Label collision resolution and text formatting for indoor floor plans.
 */

import type { IndoorNode, IndoorRoom } from "./types";

export interface CandidateLabel {
  id: string;
  nodeId: string;
  x: number;
  y: number;
  text: string;
  shortText: string;
  priority: number;
  fontSize: number;
  width: number;
  height: number;
}

export interface PlacedLabel {
  id: string;
  nodeId: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

function boxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
  padding = 0.6
): boolean {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;

  const aLeft = ax - padding;
  const aRight = ax + aw + padding;
  const aTop = ay - padding;
  const aBottom = ay + ah + padding;

  const bLeft = bx;
  const bRight = bx + bw;
  const bTop = by;
  const bBottom = by + bh;

  return (
    aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop
  );
}

/**
 * Extracts a concise short label from an indoor node or room code.
 */
export function getIndoorShortLabel(node: IndoorNode): string {
  if (node.short) return node.short;
  if (!node.name) return node.id.split(":").pop() ?? "";

  // Try extracting a room code like G01, 101, Lab-2
  const codeMatch = node.name.match(/\b([A-Z0-9-]{2,6})\b/);
  if (codeMatch) return codeMatch[1];

  // Truncate name
  return node.name.length > 8 ? node.name.slice(0, 7) + "…" : node.name;
}

/**
 * Computes visible non-colliding labels for the active floor.
 * High zoom displays full name; low zoom displays short code.
 */
export function computeIndoorLabels(
  rooms: IndoorRoom[],
  nodes: IndoorNode[],
  activeFloor: number,
  zoomScale: number,
  selectedRoomId?: string | null,
  activeRouteNodes?: Set<string>
): PlacedLabel[] {
  const nodeLookup = new Map<string, IndoorNode>();
  for (const n of nodes) {
    if (n.floor === activeFloor) {
      nodeLookup.set(n.id, n);
    }
  }

  const isHighZoom = zoomScale >= 1.35;
  const candidates: CandidateLabel[] = [];

  for (const room of rooms) {
    const node = nodeLookup.get(room.nodeId);
    if (!node) continue;

    const [rx, ry, rw, rh] = room.rect;
    const centerX = rx + rw / 2;
    const centerY = ry + rh / 2;

    const isSelected = room.nodeId === selectedRoomId;
    const isRoute = activeRouteNodes?.has(room.nodeId) ?? false;

    // Priority ranking
    let priority = 40;
    if (isSelected) priority = 100;
    else if (isRoute) priority = 85;
    else if (node.type === "room") priority = 50;

    const shortText = getIndoorShortLabel(node);
    const fullText = node.name || shortText;
    const displayText = isHighZoom || isSelected ? fullText : shortText;

    // Estimate label dimensions in meters based on character length
    const fontSize = isHighZoom ? 1.05 : 0.95;
    const charWidth = fontSize * 0.58;
    const textWidth = Math.min(rw - 0.4, displayText.length * charWidth);
    const textHeight = fontSize * 1.2;

    candidates.push({
      id: room.nodeId,
      nodeId: room.nodeId,
      x: centerX,
      y: centerY,
      text: displayText,
      shortText,
      priority,
      fontSize,
      width: textWidth,
      height: textHeight,
    });
  }

  // Sort candidates by priority descending
  candidates.sort((a, b) => b.priority - a.priority);

  const placedBoxes: Array<[number, number, number, number]> = [];
  const placedLabels: PlacedLabel[] = [];

  for (const cand of candidates) {
    const box: [number, number, number, number] = [
      cand.x - cand.width / 2,
      cand.y - cand.height / 2,
      cand.width,
      cand.height,
    ];

    let collides = false;
    for (const placed of placedBoxes) {
      if (boxesOverlap(box, placed, 0.4)) {
        collides = true;
        break;
      }
    }

    if (!collides || cand.priority >= 90) {
      placedBoxes.push(box);
      placedLabels.push({
        id: cand.id,
        nodeId: cand.nodeId,
        x: cand.x,
        y: cand.y,
        text: cand.text,
        fontSize: cand.fontSize,
      });
    }
  }

  return placedLabels;
}
