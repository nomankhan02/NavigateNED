/**
 * web/src/map/types.ts
 * Type definitions for OutdoorMap, campus graph schemas, evacuation overlays, and algorithm trace replay.
 */

export type OutdoorNodeKind = "path" | "entrance" | "gate" | "assembly" | "poi";

export interface OutdoorNode {
  id: string;
  lat: number;
  lng: number;
  kind: OutdoorNodeKind;
}

export interface OutdoorEdge {
  a: string;
  b: string;
  w: number;
  oneway?: boolean;
  covered?: boolean;
}

export interface CampusLandmark {
  id: string;
  name: string;
  short: string;
  nodeId: string;
  category: string;
  footprint: [number, number][];
}

export interface MasterPlanCorners {
  topLeft: [number, number];
  topRight: [number, number];
  bottomLeft: [number, number];
  bottomRight: [number, number];
}

export type BasemapMode = "street" | "satellite";

export interface WarpedMasterPlanOverlay {
  image: string;
  bounds: [[number, number], [number, number]];
  sourceResolution?: [number, number];
  warpedResolution?: [number, number];
}

export interface CampusGraphMeta {
  version: string;
  origin: [number, number];
  campusName?: string;
  city?: string;
  masterPlanControlCorners?: MasterPlanCorners;
  mapOverlay?: {
    image: string;
    corners: MasterPlanCorners;
  };
  warpedOverlay?: WarpedMasterPlanOverlay;
}

export interface CampusGraph {
  meta: CampusGraphMeta;
  nodes: OutdoorNode[];
  edges: OutdoorEdge[];
  landmarks: CampusLandmark[];
}

export interface UserLocation {
  lat: number;
  lng: number;
  accuracyMeters?: number;
}

export interface EvacuationAssignment {
  from: string;
  assemblyId: string;
  path: string[];
  distance: number;
}

export interface EvacuationOverlayData {
  blockedNodes?: string[];
  blockedEdges?: [string, string][];
  assignments?: EvacuationAssignment[];
}

export type TraceEventType = "visit" | "relax" | "frontier";

export interface TraceEvent {
  type: TraceEventType;
  node: string;
  dist: number;
}

export interface TraceReplayState {
  isPlaying: boolean;
  currentIndex: number;
  totalEvents: number;
  speedMultiplier: number;
  visitedNodeIds: string[];
  frontierNodeIds: string[];
  relaxedNodeIds: string[];
  activeNodeId: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  seek: (index: number) => void;
  setSpeed: (multiplier: number) => void;
}

export interface OutdoorMapProps {
  graph: CampusGraph;
  route?: string[];
  highlightedNodeIds?: string[];
  selectedLandmarkId?: string | null;
  onLandmarkClick?: (landmarkId: string, landmark: CampusLandmark) => void;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  showGraph?: boolean;
  userLocation?: UserLocation | null;
  evacuation?: EvacuationOverlayData | null;
  trace?: TraceEvent[] | TraceReplayState | null;
}

