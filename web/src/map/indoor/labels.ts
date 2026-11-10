/**
 * web/src/map/indoor/labels.ts
 * Room label fitting, text variant selection, multi-line wrapping, and clipping.
 * Guarantees labels stay strictly inside their room boxes and never overflow.
 */

import type { IndoorNode, IndoorRoom } from "./types";

export interface FittedRoomLabel {
  id: string;
  nodeId: string;
  lines: string[];
  fontSizePx: number;
  fontSizeMeters: number;
  cx: number;
  cy: number;
  rect: [number, number, number, number];
  priority: number;
  variant: "full" | "short" | "code";
}

/**
 * Extracts a concise short code (e.g. G01, 101, Lab1) from a node.
 */
export function getIndoorShortCode(node: IndoorNode): string {
  if (node.short) return node.short;
  if (!node.name) return node.id.split(":").pop() ?? "";

  // Look for room number/code in name (e.g., "101", "G02", "Lab-2")
  const match = node.name.match(/\b([A-Z0-9-]{2,6})\b/);
  if (match) return match[1];

  const idSuffix = node.id.split(":").pop() ?? "";
  return idSuffix.toUpperCase();
}

/**
 * Derives a readable abbreviated name from full room title.
 */
export function getIndoorShortName(node: IndoorNode): string {
  if (node.short) return node.short;
  if (!node.name) return getIndoorShortCode(node);

  let name = node.name
    .replace(/\bDepartment of\b/i, "Dept.")
    .replace(/\bDepartments of\b/i, "Depts.")
    .replace(/\bLaboratory\b/i, "Lab")
    .replace(/\bLaboratories\b/i, "Labs")
    .replace(/\bChairman Office\b/i, "Chairman Off.")
    .replace(/\bClassroom\b/i, "Room")
    .replace(/\bConference\b/i, "Conf.")
    .replace(/\bAdministration\b/i, "Admin")
    .replace(/\bSecretariat\b/i, "Secret.")
    .trim();

  if (name.length <= 16) return name;

  // If still long, take first 2 words
  const words = name.split(/\s+/);
  if (words.length > 2) {
    return `${words[0]} ${words[1]}`;
  }
  return name.slice(0, 15) + "…";
}

/**
 * Backward compatibility alias for getIndoorShortName.
 */
export const getIndoorShortLabel = getIndoorShortName;

/**
 * Splits text into two balanced lines at word boundaries.
 */
function splitIntoTwoLines(text: string): [string, string] | null {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;

  let bestSplit = 1;
  let minDiff = Infinity;

  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(" ");
    const l2 = words.slice(i).join(" ");
    const diff = Math.abs(l1.length - l2.length);
    if (diff < minDiff) {
      minDiff = diff;
      bestSplit = i;
    }
  }

  const line1 = words.slice(0, bestSplit).join(" ");
  const line2 = words.slice(bestSplit).join(" ");
  return [line1, line2];
}

/**
 * Checks whether text lines fit inside available pixel box at given font size.
 */
function checkTextFits(
  lines: string[],
  fontSizePx: number,
  availPxW: number,
  availPxH: number
): boolean {
  const charWidth = fontSizePx * 0.55;
  const lineHeight = fontSizePx * 1.25;
  const totalHeight = lines.length * lineHeight;

  if (totalHeight > availPxH) return false;

  for (const line of lines) {
    const lineWidth = line.length * charWidth;
    if (lineWidth > availPxW) return false;
  }

  return true;
}

/**
 * Computes labels for the active floor that fit strictly inside their room rectangles.
 * Selects the longest variant that fits (full wrapped 2 lines -> short name -> short code -> none).
 * Font size scales down to a minimum of 9px.
 */
export function computeIndoorLabels(
  rooms: IndoorRoom[],
  nodes: IndoorNode[],
  activeFloor: number,
  scale: number,
  containerWidth: number,
  containerHeight: number,
  baseWidth: number,
  baseHeight: number,
  marginMeters: number,
  selectedRoomId?: string | null,
  activeRouteNodes?: Set<string>
): FittedRoomLabel[] {
  const nodeLookup = new Map<string, IndoorNode>();
  for (const n of nodes) {
    if (n.floor === activeFloor) {
      nodeLookup.set(n.id, n);
    }
  }

  // Calculate screen pixels per meter
  const vbWidth = (baseWidth + marginMeters * 2) / Math.max(0.1, scale);
  const pixelsPerMeter = containerWidth > 0 ? containerWidth / vbWidth : 12 * scale;

  const fittedLabels: FittedRoomLabel[] = [];

  for (const room of rooms) {
    const node = nodeLookup.get(room.nodeId);
    if (!node) continue;

    const [rx, ry, rw, rh] = room.rect;
    const isSelected = room.nodeId === selectedRoomId;
    const isRoute = activeRouteNodes?.has(room.nodeId) ?? false;

    // Available room inner bounds in screen pixels with comfortable wall padding
    const padPxX = 6;
    const padPxY = 4;
    const availPxW = rw * pixelsPerMeter - padPxX * 2;
    const availPxH = rh * pixelsPerMeter - padPxY * 2;

    // Minimum readable threshold
    if (availPxW < 14 || availPxH < 10) continue;

    const fullName = (node.name || node.id).trim();
    const shortName = getIndoorShortName(node);
    const shortCode = getIndoorShortCode(node);

    let chosenLines: string[] | null = null;
    let chosenFontSizePx = 0;
    let chosenVariant: "full" | "short" | "code" = "full";

    // 1. Try Full Name (single line or wrapped onto 2 lines) from 13px down to 9px
    const fullTwoLines = splitIntoTwoLines(fullName);
    for (let fs = 13; fs >= 9; fs -= 0.5) {
      if (checkTextFits([fullName], fs, availPxW, availPxH)) {
        chosenLines = [fullName];
        chosenFontSizePx = fs;
        chosenVariant = "full";
        break;
      }
      if (fullTwoLines && checkTextFits(fullTwoLines, fs, availPxW, availPxH)) {
        chosenLines = fullTwoLines;
        chosenFontSizePx = fs;
        chosenVariant = "full";
        break;
      }
    }

    // 2. If full name didn't fit, try Short Name
    if (!chosenLines && shortName !== fullName) {
      const shortTwoLines = splitIntoTwoLines(shortName);
      for (let fs = 12; fs >= 9; fs -= 0.5) {
        if (checkTextFits([shortName], fs, availPxW, availPxH)) {
          chosenLines = [shortName];
          chosenFontSizePx = fs;
          chosenVariant = "short";
          break;
        }
        if (shortTwoLines && checkTextFits(shortTwoLines, fs, availPxW, availPxH)) {
          chosenLines = shortTwoLines;
          chosenFontSizePx = fs;
          chosenVariant = "short";
          break;
        }
      }
    }

    // 3. If short name didn't fit, try Short Code
    if (!chosenLines && shortCode) {
      for (let fs = 11; fs >= 9; fs -= 0.5) {
        if (checkTextFits([shortCode], fs, availPxW, availPxH)) {
          chosenLines = [shortCode];
          chosenFontSizePx = fs;
          chosenVariant = "code";
          break;
        }
      }
    }

    // If still nothing fits at >= 9px, omit label (never spill outside room)
    if (!chosenLines) continue;

    // Convert screen pixel font size to SVG meter units
    const fontSizeMeters = chosenFontSizePx / pixelsPerMeter;

    let priority = 40;
    if (isSelected) priority = 100;
    else if (isRoute) priority = 90;
    else if (chosenVariant === "full") priority = 70;
    else if (chosenVariant === "short") priority = 55;

    fittedLabels.push({
      id: room.nodeId,
      nodeId: room.nodeId,
      lines: chosenLines,
      fontSizePx: chosenFontSizePx,
      fontSizeMeters,
      cx: rx + rw / 2,
      cy: ry + rh / 2,
      rect: room.rect,
      priority,
      variant: chosenVariant,
    });
  }

  // Sort by priority descending so route/selected rooms are ordered first
  fittedLabels.sort((a, b) => b.priority - a.priority);

  return fittedLabels;
}
