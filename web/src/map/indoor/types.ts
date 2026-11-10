/**
 * web/src/map/indoor/types.ts
 * TypeScript contracts and schemas for indoor floor plan rendering.
 */

import type { TraceEvent, TraceReplayState } from "../types";

export type IndoorNodeType =
  | "corridor"
  | "room"
  | "stairs"
  | "lift"
  | "entrance"
  | "exit";

export interface IndoorNode {
  id: string;
  x: number;
  y: number;
  floor: number;
  type: IndoorNodeType;
  name?: string;
  short?: string;
  capacity?: number;
  accessible?: boolean;
}

export interface IndoorEdge {
  a: string;
  b: string;
  kind: "walk" | "stairs" | "lift";
  w: number;
  accessible?: boolean;
}

export interface IndoorRoom {
  nodeId: string;
  rect: [number, number, number, number]; // [x, y, width, height] in meters
}

export interface IndoorFloor {
  level: number;
  label: string;
}

export interface IndoorMeta {
  demo?: boolean;
  template?: string;
  width: number;
  height: number;
  corridorWidth?: number;
  roomWidth?: number;
  [key: string]: unknown;
}

export interface IndoorBuilding {
  id: string;
  name: string;
  landmarkId: string;
  meta?: IndoorMeta;
  floors: IndoorFloor[];
  nodes: IndoorNode[];
  edges: IndoorEdge[];
  rooms: IndoorRoom[];
}

export interface IndoorEvacuationData {
  exitNodes?: string[];
  blockedRooms?: string[];
  blockedCorridors?: [string, string][];
  assignmentPaths?: Array<{
    from: string;
    exitId: string;
    path: string[];
  }>;
}

export interface IndoorMapProps {
  building: IndoorBuilding | null | undefined;
  floor?: number;
  onFloorChange?: (floor: number) => void;
  route?: string[];
  highlightedNodeIds?: string[];
  selectedRoomId?: string | null;
  onRoomClick?: (roomId: string, node: IndoorNode | undefined) => void;
  userNode?: string | null;
  evacuation?: IndoorEvacuationData | null;
  trace?: TraceEvent[] | TraceReplayState | null;
  className?: string;
}
