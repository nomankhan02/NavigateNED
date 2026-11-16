/**
 * Type-safe client bridge and in-memory module + dataset caching for C++ WASM navcore.
 */

import type { CampusGraph, TraceEvent } from "@/map/types";
import type { IndoorBuilding } from "@/map/indoor/types";

export interface PingResponse {
  status: string;
  version: string;
}

export interface LoadResponse {
  status: "ok" | "error";
  nodeCount?: number;
  edgeCount?: number;
  indoorBuildings?: number;
  landmarkCount?: number;
  message?: string;
}

export type NavAlgo = "dijkstra" | "astar" | "bfs" | "bellmanford" | "floyd";

export interface RouteRequest {
  from: string;
  to: string;
  toLandmark?: string;
  algo?: NavAlgo;
  accessible?: boolean;
  avoid?: string[];
  blockedEdges?: [string, string][];
}

export interface RouteResponse {
  found: boolean;
  distance: number;
  path: string[];
  steps: string[];
  trace?: TraceEvent[];
  negativeCycle?: boolean;
  algo?: string;
  toLandmark?: string;
  error?: string;
}

export type ManeuverType =
  | "start"
  | "straight"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "enter-building"
  | "stairs-up"
  | "stairs-down"
  | "lift"
  | "arrive";

export interface Maneuver {
  type: ManeuverType;
  text: string;
  distanceM: number;
  atNodeId: string;
  lat: number;
  lng: number;
  landmark?: string;
}

export interface DirectionsResponse {
  maneuvers: Maneuver[];
  error?: string;
}

export interface SearchHit {
  id: string;
  label: string;
  name: string;
  kind: "landmark" | "room";
  type: "landmark" | "room";
  number?: string;
  nodeId?: string;
  buildingId?: string;
}

export interface SearchResponse {
  results: SearchHit[];
}

export interface CompareAlgoEntry {
  found: boolean;
  distance: number;
  nodesVisited: number;
  visitedCount: number;
  timeUs: number;
  timeMs: number;
  hops: number;
  edgesRelaxed?: number;
}

export interface CompareResponse {
  results: Record<string, CompareAlgoEntry>;
}

export interface EvacDataset {
  assemblyAreas: Array<{
    id: string;
    name: string;
    nodeId: string;
    capacity: number;
  }>;
  buildingExits: Array<{
    buildingId: string;
    exitNodeIds?: string[];
    [key: string]: unknown;
  }>;
}

export interface LoadedCampusData {
  graph: CampusGraph;
  indoorBuildings: Record<string, IndoorBuilding>;
  evac: EvacDataset;
  loadSummary: LoadResponse;
}

export type NativeCallFn = (fn: string, argsJson: string) => string;

interface NavcoreModuleInstance {
  cwrap?: (funcName: string, returnType: string, argTypes: string[]) => NativeCallFn;
  call?: NativeCallFn;
  _malloc?: (size: number) => number;
  _free?: (ptr: number) => void;
  _call?: (fnPtr: number, argsPtr: number) => number;
  stringToUTF8?: (str: string, outPtr: number, maxBytesToWrite: number) => void;
  UTF8ToString?: (ptr: number) => string;
}

const utf8Encoder = new TextEncoder();

export const INDOOR_BUILDING_IDS = [
  "b-admin",
  "b-auditorium",
  "b-csit",
  "b-csit-labs",
  "b-dean-offices",
  "b-library",
] as const;

let cachedCallFn: NativeCallFn | null = null;
let modulePromise: Promise<NativeCallFn> | null = null;
let campusDataPromise: Promise<LoadedCampusData> | null = null;

/**
 * Loads the WebAssembly core module using dynamic import and returns the native call bridge.
 */
export async function getNavCore(): Promise<NativeCallFn> {
  if (cachedCallFn) return cachedCallFn;
  if (modulePromise) return modulePromise;

  modulePromise = (async () => {
    const importUrl = "/wasm/navcore.js";
    const navcoreModule = await Function("url", "return import(url)")(importUrl);
    const createModule = navcoreModule.default || navcoreModule;
    const instance: NavcoreModuleInstance = await createModule();

    let callFn: NativeCallFn;
    // Allocate large JSON payloads (graph.json is ~400KB) on the WASM heap rather than
    // via cwrap's 64KB C stack to avoid memory access out of bounds.
    if (
      typeof instance._malloc === "function" &&
      typeof instance._free === "function" &&
      typeof instance._call === "function" &&
      typeof instance.stringToUTF8 === "function" &&
      typeof instance.UTF8ToString === "function"
    ) {
      const malloc = instance._malloc;
      const free = instance._free;
      const nativeCall = instance._call;
      const stringToUTF8 = instance.stringToUTF8;
      const utf8ToString = instance.UTF8ToString;
      callFn = (fn: string, argsJson: string): string => {
        const fnBytes = utf8Encoder.encode(fn).length + 1;
        const argsBytes = utf8Encoder.encode(argsJson).length + 1;
        const fnPtr = malloc(fnBytes);
        const argsPtr = malloc(argsBytes);
        try {
          stringToUTF8(fn, fnPtr, fnBytes);
          stringToUTF8(argsJson, argsPtr, argsBytes);
          const resPtr = nativeCall(fnPtr, argsPtr);
          return utf8ToString(resPtr);
        } finally {
          free(fnPtr);
          free(argsPtr);
        }
      };
    } else if (typeof instance.cwrap === "function") {
      callFn = instance.cwrap("call", "string", ["string", "string"]);
    } else if (typeof instance.call === "function") {
      callFn = instance.call;
    } else {
      throw new Error("Unable to locate call() export on navcore module");
    }

    cachedCallFn = callFn;
    return callFn;
  })();

  return modulePromise;
}

export async function callNavCore<T>(fn: string, args: unknown = {}): Promise<T> {
  const call = await getNavCore();
  const payload = typeof args === "string" ? args : JSON.stringify(args);
  const raw = call(fn, payload);
  return JSON.parse(raw) as T;
}

export async function pingCore(): Promise<PingResponse> {
  return callNavCore<PingResponse>("ping", {});
}

export async function loadGraphIntoCore(graphUrl: string): Promise<LoadResponse> {
  const call = await getNavCore();
  const response = await fetch(graphUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to fetch graph from ${graphUrl}: HTTP ${response.status}`);
  }
  const graphJsonString = await response.text();
  return JSON.parse(call("load", graphJsonString)) as LoadResponse;
}

/**
 * Loads outdoor graph.json, all 6 indoor building JSONs, and evac.json into C++ WASM once.
 */
export async function ensureAllCampusDataLoaded(): Promise<LoadedCampusData> {
  if (campusDataPromise) return campusDataPromise;

  campusDataPromise = (async () => {
    const call = await getNavCore();

    const [graphText, evacText, ...indoorTexts] = await Promise.all([
      fetch("/data/graph.json", { cache: "force-cache" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading /data/graph.json`);
        return r.text();
      }),
      fetch("/data/evac.json", { cache: "force-cache" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading /data/evac.json`);
        return r.text();
      }),
      ...INDOOR_BUILDING_IDS.map((id) =>
        fetch(`/data/indoor/${id}.json`, { cache: "force-cache" }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} loading /data/indoor/${id}.json`);
          return r.text();
        }),
      ),
    ]);

    // Load outdoor graph first, then merge all 6 indoor buildings, then evac.json
    let loadSummary = JSON.parse(call("load", graphText)) as LoadResponse;
    const indoorBuildings: Record<string, IndoorBuilding> = {};

    for (let i = 0; i < INDOOR_BUILDING_IDS.length; i++) {
      const id = INDOOR_BUILDING_IDS[i];
      const text = indoorTexts[i];
      indoorBuildings[id] = JSON.parse(text) as IndoorBuilding;
      loadSummary = JSON.parse(call("load", text)) as LoadResponse;
    }

    loadSummary = JSON.parse(call("load", evacText)) as LoadResponse;

    return {
      graph: JSON.parse(graphText) as CampusGraph,
      indoorBuildings,
      evac: JSON.parse(evacText) as EvacDataset,
      loadSummary,
    };
  })();

  return campusDataPromise;
}

export async function computeRoute(req: RouteRequest): Promise<RouteResponse> {
  return callNavCore<RouteResponse>("route", {
    from: req.from,
    to: req.to,
    ...(req.toLandmark ? { toLandmark: req.toLandmark } : {}),
    algo: req.algo ?? "dijkstra",
    accessible: req.accessible ?? false,
    avoid: req.avoid ?? [],
    blockedEdges: req.blockedEdges ?? [],
  });
}

export async function getDirections(
  req: { route: RouteResponse } | RouteRequest,
): Promise<DirectionsResponse> {
  return callNavCore<DirectionsResponse>("directions", req);
}

export async function compareAlgorithms(args: {
  from: string;
  to: string;
  accessible?: boolean;
}): Promise<CompareResponse> {
  return callNavCore<CompareResponse>("compare", {
    from: args.from,
    to: args.to,
    accessible: args.accessible ?? false,
  });
}

export async function searchCampus(query: string, limit = 15): Promise<SearchResponse> {
  return callNavCore<SearchResponse>("search", { query, limit });
}

export interface EvacBlockedInput {
  nodes: string[];
  edges: [string, string][];
}

export interface EvacPersonGroup {
  at: string;
  count: number;
}

export interface EvacAssignment {
  from: string;
  assemblyId: string;
  assemblyName: string;
  count: number;
  distance: number;
  path: string[];
  exitNodeId?: string;
}

export interface EvacAssemblyLoad {
  id: string;
  name?: string;
  assigned: number;
  capacity: number;
}

export interface EvacuateResponse {
  mode: "nearest" | "capacity";
  assignments: EvacAssignment[];
  unassigned: number;
  assemblyLoad: EvacAssemblyLoad[];
  totalDistance: number;
}

export interface EvacuationCompareResponse {
  nearest: EvacuateResponse;
  capacity: EvacuateResponse;
  totalDistance: { nearest: number; capacity: number };
  maxAssemblyLoad: { nearest: number; capacity: number };
  overloadedAreasCount: { nearest: number; capacity: number };
}

export interface NearestAssemblyResponse {
  found: boolean;
  from: string;
  assemblyId: string;
  assemblyName: string;
  nodeId: string;
  capacity: number;
  distance: number;
  path: string[];
  steps: string[];
  exitNodeId?: string;
  error?: string;
}

export async function evacuateCampus(args: {
  mode: "nearest" | "capacity";
  blocked: EvacBlockedInput;
  people: EvacPersonGroup[];
  disableLifts?: boolean;
}): Promise<EvacuateResponse> {
  return callNavCore<EvacuateResponse>("evacuate", {
    mode: args.mode,
    blocked: args.blocked,
    people: args.people,
    disableLifts: args.disableLifts ?? true,
  });
}

export async function compareEvacuation(args: {
  blocked: EvacBlockedInput;
  people: EvacPersonGroup[];
  disableLifts?: boolean;
}): Promise<EvacuationCompareResponse> {
  return callNavCore<EvacuationCompareResponse>("evacuationCompare", {
    blocked: args.blocked,
    people: args.people,
    disableLifts: args.disableLifts ?? true,
  });
}

export async function findNearestAssembly(args: {
  from: string;
  blocked: EvacBlockedInput;
  disableLifts?: boolean;
}): Promise<NearestAssemblyResponse> {
  return callNavCore<NearestAssemblyResponse>("nearestAssembly", {
    from: args.from,
    blocked: args.blocked,
    disableLifts: args.disableLifts ?? true,
  });
}
