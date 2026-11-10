/**
 * web/src/map/indoor/IndoorMap.tsx
 * Client-only SVG multi-floor indoor architectural building viewer.
 * Supports smooth pan/zoom, room selection, floor switching, facility markers,
 * and priority-ranked collision-resolved labels.
 */

"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import "./indoor.css";
import type {
  IndoorBuilding,
  IndoorMapProps,
  IndoorNode,
  IndoorRoom,
  IndoorEdge,
} from "./types";
import {
  FloorSwitcher,
  getBuildingFloors,
  getFloorsWithRoute,
} from "./floors";
import { computeIndoorLabels, type FittedRoomLabel } from "./labels";
import { extractFloorRoute } from "./route";

const MARGIN_METERS = 5;
const MIN_SCALE = 0.6;
const MAX_SCALE = 6.0;

export function IndoorMap({
  building,
  floor: controlledFloor,
  onFloorChange,
  route,
  highlightedNodeIds,
  selectedRoomId = null,
  onRoomClick,
  userNode = null,
  evacuation = null,
  trace = null,
  className = "",
}: IndoorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Sorted floors list
  const floors = useMemo(() => getBuildingFloors(building), [building]);
  const defaultFloor = floors[0]?.level ?? 0;

  // Active floor state (uncontrolled with prop fallback or controlled)
  const [internalFloor, setInternalFloor] = useState<number>(defaultFloor);
  const activeFloor = controlledFloor !== undefined ? controlledFloor : internalFloor;

  // Sync internal floor when building changes
  useEffect(() => {
    if (floors.length > 0 && !floors.some((f) => f.level === internalFloor)) {
      setInternalFloor(floors[0].level);
    }
  }, [floors, internalFloor]);

  const handleSelectFloor = useCallback(
    (level: number) => {
      setInternalFloor(level);
      onFloorChange?.(level);
    },
    [onFloorChange]
  );

  // Building geometry bounds in meters
  const baseWidth = building?.meta?.width ?? 70;
  const baseHeight = building?.meta?.height ?? 44;
  const corridorWidth = building?.meta?.corridorWidth ?? 3.6;

  // Pan & Zoom transform state: { scale, panX, panY }
  const [scale, setScale] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({
    x: -MARGIN_METERS,
    y: -MARGIN_METERS,
  });

  // Container screen pixel dimensions for responsive text fitting
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  }>({
    width: 800,
    height: 520,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      setContainerSize({
        width: el.clientWidth || 800,
        height: el.clientHeight || 520,
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Debounced scale: recomputes room labels strictly on zoom end, never during pan
  const [committedScale, setCommittedScale] = useState<number>(scale);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCommittedScale(scale);
    }, 150);
    return () => clearTimeout(timer);
  }, [scale]);

  // Hovered room state for floating details popover
  const [hoveredRoom, setHoveredRoom] = useState<{
    roomId: string;
    node: IndoorNode;
    screenX: number;
    screenY: number;
  } | null>(null);

  // Track pointers for panning and pinch-to-zoom
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map()
  );
  const isDraggingRef = useRef<boolean>(false);
  const lastPanStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);

  // Reset view to fit building bounds
  const handleResetView = useCallback(() => {
    setScale(1);
    setPan({ x: -MARGIN_METERS, y: -MARGIN_METERS });
  }, []);

  // Zoom helpers
  const zoomAtPoint = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setScale((prevScale) => {
        const nextScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, prevScale * factor)
        );
        if (nextScale === prevScale) return prevScale;

        const container = containerRef.current;
        if (container && clientX !== undefined && clientY !== undefined) {
          const rect = container.getBoundingClientRect();
          const cursorFracX = (clientX - rect.left) / rect.width;
          const cursorFracY = (clientY - rect.top) / rect.height;

          const currentVbW = (baseWidth + MARGIN_METERS * 2) / prevScale;
          const currentVbH = (baseHeight + MARGIN_METERS * 2) / prevScale;
          const nextVbW = (baseWidth + MARGIN_METERS * 2) / nextScale;
          const nextVbH = (baseHeight + MARGIN_METERS * 2) / nextScale;

          setPan((prevPan) => ({
            x: prevPan.x + (currentVbW - nextVbW) * cursorFracX,
            y: prevPan.y + (currentVbH - nextVbH) * cursorFracY,
          }));
        } else {
          // Center zoom
          const currentVbW = (baseWidth + MARGIN_METERS * 2) / prevScale;
          const currentVbH = (baseHeight + MARGIN_METERS * 2) / prevScale;
          const nextVbW = (baseWidth + MARGIN_METERS * 2) / nextScale;
          const nextVbH = (baseHeight + MARGIN_METERS * 2) / nextScale;

          setPan((prevPan) => ({
            x: prevPan.x + (currentVbW - nextVbW) * 0.5,
            y: prevPan.y + (currentVbH - nextVbH) * 0.5,
          }));
        }

        return nextScale;
      });
    },
    [baseWidth, baseHeight]
  );

  // Wheel zoom listener (non-passive to prevent page scroll)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      zoomAtPoint(zoomFactor, e.clientX, e.clientY);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAtPoint]);

  // Pointer event handlers for drag / pinch
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Main button only
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 1) {
      isDraggingRef.current = true;
      lastPanStartRef.current = { x: e.clientX, y: e.clientY };
    } else if (activePointersRef.current.size === 2) {
      // Begin pinch
      isDraggingRef.current = false;
      const pts = Array.from(activePointersRef.current.values());
      pinchStartDistRef.current = Math.hypot(
        pts[0].x - pts[1].x,
        pts[0].y - pts[1].y
      );
      pinchStartScaleRef.current = scale;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    if (activePointersRef.current.size === 1 && isDraggingRef.current) {
      const dxPixels = e.clientX - lastPanStartRef.current.x;
      const dyPixels = e.clientY - lastPanStartRef.current.y;
      lastPanStartRef.current = { x: e.clientX, y: e.clientY };

      const vbWidth = (baseWidth + MARGIN_METERS * 2) / scale;
      const vbHeight = (baseHeight + MARGIN_METERS * 2) / scale;

      const dxMeters = (dxPixels / rect.width) * vbWidth;
      const dyMeters = (dyPixels / rect.height) * vbHeight;

      setPan((prev) => ({
        x: prev.x - dxMeters,
        y: prev.y - dyMeters,
      }));
    } else if (
      activePointersRef.current.size === 2 &&
      pinchStartDistRef.current !== null
    ) {
      const pts = Array.from(activePointersRef.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = currentDist / pinchStartDistRef.current;
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinchStartScaleRef.current * ratio)
      );
      setScale(nextScale);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStartDistRef.current = null;
    }
    if (activePointersRef.current.size === 0) {
      isDraggingRef.current = false;
    } else if (activePointersRef.current.size === 1) {
      isDraggingRef.current = true;
      const pt = activePointersRef.current.values().next().value;
      if (pt) lastPanStartRef.current = { x: pt.x, y: pt.y };
    }
  };

  // Double click / tap to zoom in
  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    zoomAtPoint(1.4, e.clientX, e.clientY);
  };

  // Dynamic ViewBox
  const viewBoxWidth = (baseWidth + MARGIN_METERS * 2) / scale;
  const viewBoxHeight = (baseHeight + MARGIN_METERS * 2) / scale;
  const viewBoxStr = `${pan.x} ${pan.y} ${viewBoxWidth} ${viewBoxHeight}`;

  // Route floor presence indicator
  const routeFloors = useMemo(
    () => getFloorsWithRoute(building, route),
    [building, route]
  );

  // Nodes for active floor
  const floorNodes = useMemo(() => {
    if (!building?.nodes) return [];
    return building.nodes.filter((n) => n.floor === activeFloor);
  }, [building, activeFloor]);

  const floorNodeLookup = useMemo(() => {
    const map = new Map<string, IndoorNode>();
    for (const n of floorNodes) {
      map.set(n.id, n);
    }
    return map;
  }, [floorNodes]);

  // Edges for active floor
  const floorEdges = useMemo(() => {
    if (!building?.edges) return [];
    return building.edges.filter((e) => {
      const na = floorNodeLookup.get(e.a);
      const nb = floorNodeLookup.get(e.b);
      return Boolean(na && nb);
    });
  }, [building, floorNodeLookup]);

  // Corridor edges on active floor
  const corridorEdges = useMemo(() => {
    return floorEdges.filter((e) => {
      const na = floorNodeLookup.get(e.a);
      const nb = floorNodeLookup.get(e.b);
      return na?.type === "corridor" && nb?.type === "corridor";
    });
  }, [floorEdges, floorNodeLookup]);

  // Rooms on active floor
  const floorRooms = useMemo(() => {
    if (!building?.rooms) return [];
    return building.rooms.filter((r) => {
      const n = floorNodeLookup.get(r.nodeId);
      return Boolean(n);
    });
  }, [building, floorNodeLookup]);

  // Facility nodes (stairs, lift, entrance, exit)
  const facilityNodes = useMemo(() => {
    return floorNodes.filter(
      (n) =>
        n.type === "stairs" ||
        n.type === "lift" ||
        n.type === "entrance" ||
        n.type === "exit"
    );
  }, [floorNodes]);

  // Compute fitted labels strictly fitting inside their room boxes on zoom end
  const activeRouteNodesSet = useMemo(() => new Set(route ?? []), [route]);
  const visibleLabels = useMemo(() => {
    return computeIndoorLabels(
      floorRooms,
      floorNodes,
      activeFloor,
      committedScale,
      containerSize.width,
      containerSize.height,
      baseWidth,
      baseHeight,
      MARGIN_METERS,
      selectedRoomId,
      activeRouteNodesSet
    );
  }, [
    floorRooms,
    floorNodes,
    activeFloor,
    committedScale,
    containerSize.width,
    containerSize.height,
    baseWidth,
    baseHeight,
    selectedRoomId,
    activeRouteNodesSet,
  ]);

  const highlightedSet = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds]
  );

  // Extract floor-specific route polylines and transitions
  const floorRoute = useMemo(() => {
    return extractFloorRoute(route, building?.nodes ?? [], activeFloor);
  }, [route, building?.nodes, activeFloor]);

  // User location node on active floor
  const currentUserNode = useMemo(() => {
    if (!userNode) return null;
    return floorNodeLookup.get(userNode) ?? null;
  }, [userNode, floorNodeLookup]);

  // Evacuation data sets
  const blockedRoomsSet = useMemo(
    () => new Set(evacuation?.blockedRooms ?? []),
    [evacuation]
  );

  const exitNodesSet = useMemo(
    () => new Set(evacuation?.exitNodes ?? []),
    [evacuation]
  );

  const blockedCorridors = useMemo(() => {
    if (!evacuation?.blockedCorridors) return [];
    return evacuation.blockedCorridors.filter(([a, b]) => {
      const na = floorNodeLookup.get(a);
      const nb = floorNodeLookup.get(b);
      return Boolean(na && nb);
    });
  }, [evacuation, floorNodeLookup]);

  const floorEvacAssignments = useMemo(() => {
    if (!evacuation?.assignmentPaths) return [];
    return evacuation.assignmentPaths.map((assign) => ({
      from: assign.from,
      exitId: assign.exitId,
      extracted: extractFloorRoute(
        assign.path,
        building?.nodes ?? [],
        activeFloor
      ),
    }));
  }, [evacuation, building?.nodes, activeFloor]);

  // Trace events state
  const traceState = useMemo(() => {
    if (!trace) return null;

    let visitedNodeIds: string[] = [];
    let frontierNodeIds: string[] = [];
    let activeNodeId: string | null = null;

    if (Array.isArray(trace)) {
      const vSet = new Set<string>();
      const fSet = new Set<string>();
      for (const ev of trace) {
        if (ev.type === "visit") {
          vSet.add(ev.node);
          fSet.delete(ev.node);
        } else if (!vSet.has(ev.node)) {
          fSet.add(ev.node);
        }
        activeNodeId = ev.node;
      }
      visitedNodeIds = Array.from(vSet);
      frontierNodeIds = Array.from(fSet);
    } else {
      visitedNodeIds = trace.visitedNodeIds;
      frontierNodeIds = trace.frontierNodeIds;
      activeNodeId = trace.activeNodeId;
    }

    const floorVisited = visitedNodeIds
      .map((id) => floorNodeLookup.get(id))
      .filter((n): n is IndoorNode => Boolean(n));

    const floorFrontier = frontierNodeIds
      .map((id) => floorNodeLookup.get(id))
      .filter((n): n is IndoorNode => Boolean(n));

    const floorActive = activeNodeId ? floorNodeLookup.get(activeNodeId) : null;

    const traceSegments: [number, number][][] = [];
    for (let i = 0; i < visitedNodeIds.length - 1; i++) {
      const u = floorNodeLookup.get(visitedNodeIds[i]);
      const v = floorNodeLookup.get(visitedNodeIds[i + 1]);
      if (u && v) {
        traceSegments.push([
          [u.x, u.y],
          [v.x, v.y],
        ]);
      }
    }

    return {
      visitedNodes: floorVisited,
      frontierNodes: floorFrontier,
      activeNode: floorActive,
      traceSegments,
    };
  }, [trace, floorNodeLookup]);

  return (
    <div
      ref={containerRef}
      className={`ned-indoor-root ${className}`}
      role="region"
      aria-label={`${building?.name ?? "Indoor Map"}, Floor ${activeFloor}`}
    >
      {/* Floor Switcher HUD */}
      <FloorSwitcher
        floors={floors}
        activeFloor={activeFloor}
        onSelectFloor={handleSelectFloor}
        routeFloors={routeFloors}
      />

      {/* Demo Badge */}
      {building?.meta?.demo && (
        <div className="ned-indoor-demo-badge" title="Architectural Floor Model">
          <span className="ned-indoor-demo-dot" aria-hidden="true" />
          <span>Demo Model</span>
        </div>
      )}

      {/* Zoom / Reset HUD */}
      <div className="ned-indoor-hud-controls" aria-label="Map controls">
        <button
          type="button"
          className="ned-indoor-hud-btn"
          onClick={() => zoomAtPoint(1.3)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="10" y1="4" x2="10" y2="16" />
            <line x1="4" y1="10" x2="16" y2="10" />
          </svg>
        </button>
        <button
          type="button"
          className="ned-indoor-hud-btn"
          onClick={() => zoomAtPoint(0.77)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="4" y1="10" x2="16" y2="10" />
          </svg>
        </button>
        <button
          type="button"
          className="ned-indoor-hud-btn"
          onClick={handleResetView}
          aria-label="Reset view"
          title="Fit building to screen"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7V3h4M17 3h-4v4M17 13v4h-4M7 17H3v-4" />
          </svg>
        </button>
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        className="ned-indoor-svg"
        viewBox={viewBoxStr}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          {/* Subtle architectural floor background pattern */}
          <pattern
            id="indoorGrid"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 5 0 L 0 0 0 5"
              fill="none"
              stroke="var(--map-indoor-grid)"
              strokeWidth="0.1"
            />
          </pattern>

          {/* Room-specific label clipping masks ensuring text never overflows room boundary */}
          {floorRooms.map((r) => {
            const [rx, ry, rw, rh] = r.rect;
            return (
              <clipPath
                key={`clip-room-${r.nodeId}`}
                id={`clip-room-${r.nodeId}`}
              >
                <rect
                  x={rx + 0.15}
                  y={ry + 0.15}
                  width={Math.max(0, rw - 0.3)}
                  height={Math.max(0, rh - 0.3)}
                  rx="0.3"
                />
              </clipPath>
            );
          })}
        </defs>

        {/* Floor Canvas Background */}
        <rect
          x={-MARGIN_METERS}
          y={-MARGIN_METERS}
          width={baseWidth + MARGIN_METERS * 2}
          height={baseHeight + MARGIN_METERS * 2}
          fill="var(--map-indoor-canvas)"
        />
        <rect
          x={0}
          y={0}
          width={baseWidth}
          height={baseHeight}
          fill="url(#indoorGrid)"
          stroke="var(--map-indoor-wall)"
          strokeWidth="0.8"
          strokeDasharray="2 1"
          rx="1"
        />

        {/* Group for current floor with transition */}
        <g key={`floor-${activeFloor}`} className="ned-indoor-floor-group">
          {/* 1. Corridors as wide underlay strips */}
          <g className="ned-indoor-corridors-layer">
            {corridorEdges.map((e) => {
              const na = floorNodeLookup.get(e.a);
              const nb = floorNodeLookup.get(e.b);
              if (!na || !nb) return null;
              return (
                <line
                  key={`corridor-strip-${e.a}-${e.b}`}
                  x1={na.x}
                  y1={na.y}
                  x2={nb.x}
                  y2={nb.y}
                  className="ned-indoor-corridor-underlay"
                  strokeWidth={corridorWidth}
                />
              );
            })}
            {corridorEdges.map((e) => {
              const na = floorNodeLookup.get(e.a);
              const nb = floorNodeLookup.get(e.b);
              if (!na || !nb) return null;
              return (
                <line
                  key={`corridor-edge-${e.a}-${e.b}`}
                  x1={na.x}
                  y1={na.y}
                  x2={nb.x}
                  y2={nb.y}
                  className="ned-indoor-corridor-edge"
                />
              );
            })}
          </g>

          {/* 2. Rooms as rectangles */}
          <g className="ned-indoor-rooms-layer">
            {floorRooms.map((r) => {
              const [rx, ry, rw, rh] = r.rect;
              const node = floorNodeLookup.get(r.nodeId);
              const isSelected = r.nodeId === selectedRoomId;
              const isHighlighted = highlightedSet.has(r.nodeId);
              const isBlocked = blockedRoomsSet.has(r.nodeId);

              return (
                <g key={`room-${r.nodeId}`}>
                  <rect
                    x={rx}
                    y={ry}
                    width={rw}
                    height={rh}
                    rx={0.5}
                    className={`ned-indoor-room-rect ${
                      isSelected ? "ned-indoor-room-rect--selected" : ""
                    } ${
                      isHighlighted ? "ned-indoor-room-rect--highlighted" : ""
                    } ${isBlocked ? "ned-indoor-room-rect--blocked" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRoomClick?.(r.nodeId, node);
                    }}
                    onPointerEnter={(e) => {
                      const container = containerRef.current;
                      if (!container || !node) return;
                      const rect = container.getBoundingClientRect();
                      setHoveredRoom({
                        roomId: r.nodeId,
                        node,
                        screenX: e.clientX - rect.left,
                        screenY: e.clientY - rect.top,
                      });
                    }}
                    onPointerLeave={() => {
                      setHoveredRoom((prev) =>
                        prev?.roomId === r.nodeId ? null : prev
                      );
                    }}
                  >
                    <title>{node?.name ? `${node.name} (${node.id})` : node?.id}</title>
                  </rect>
                </g>
              );
            })}
          </g>

          {/* 3. Facility symbols (Stairs, Lift, Entrance, Exit) */}
          <g className="ned-indoor-facilities-layer">
            {facilityNodes.map((n) => {
              return (
                <g
                  key={`facility-${n.id}`}
                  transform={`translate(${n.x}, ${n.y})`}
                  className="ned-indoor-symbol-marker"
                >
                  {/* Transparent hit area circle so hover never flickers */}
                  <circle
                    cx="0"
                    cy="0"
                    r="3.4"
                    className="ned-indoor-symbol-hit-area"
                  />
                  <g className="ned-indoor-symbol-visual">
                    {n.type === "stairs" && (
                      <g>
                        <circle
                          cx="0"
                          cy="0"
                          r="2.2"
                          fill="var(--map-surface-elevated)"
                          stroke="var(--map-indoor-stairs)"
                          strokeWidth="0.4"
                        />
                        {/* Hand-drawn staircase 1.75px style */}
                        <path
                          d="M-1.2 1.2 h0.8 v-0.8 h0.8 v-0.8 h0.8 v-0.8"
                          stroke="var(--map-indoor-stairs)"
                          strokeWidth="0.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </g>
                    )}

                    {n.type === "lift" && (
                      <g>
                        <circle
                          cx="0"
                          cy="0"
                          r="2.2"
                          fill="var(--map-surface-elevated)"
                          stroke="var(--map-indoor-lift)"
                          strokeWidth="0.4"
                        />
                        {/* Hand-drawn elevator box with up/down chevrons */}
                        <rect
                          x="-1.1"
                          y="-1.1"
                          width="2.2"
                          height="2.2"
                          rx="0.3"
                          stroke="var(--map-indoor-lift)"
                          strokeWidth="0.3"
                          fill="none"
                        />
                        <path
                          d="M-0.6 -0.1 l0.6 -0.6 l0.6 0.6 M-0.6 0.2 l0.6 0.6 l0.6 -0.6"
                          stroke="var(--map-indoor-lift)"
                          strokeWidth="0.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </g>
                    )}

                    {n.type === "entrance" && (
                      <g>
                        <circle
                          cx="0"
                          cy="0"
                          r="2.4"
                          fill="var(--map-surface-elevated)"
                          stroke="var(--map-indoor-entrance)"
                          strokeWidth="0.5"
                        />
                        {/* Hand-drawn entrance door & arrow */}
                        <path
                          d="M-0.7 1.1 v-2.2 h1.4 v2.2 M-1.2 0 h1.6 M0.1 -0.4 l0.4 0.4 l-0.4 0.4"
                          stroke="var(--map-indoor-entrance)"
                          strokeWidth="0.35"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </g>
                    )}

                    {n.type === "exit" && (
                      <g>
                        {exitNodesSet.has(n.id) && (
                          <circle
                            cx="0"
                            cy="0"
                            r="3.6"
                            fill="none"
                            stroke="var(--map-indoor-exit)"
                            strokeWidth="0.5"
                            strokeDasharray="1.2 0.8"
                          />
                        )}
                        <circle
                          cx="0"
                          cy="0"
                          r="2.4"
                          fill="var(--map-surface-elevated)"
                          stroke="var(--map-indoor-exit)"
                          strokeWidth="0.5"
                        />
                        {/* Hand-drawn exit door & arrow */}
                        <path
                          d="M-1.1 1.1 v-2.2 h1.4 v2.2 M-0.2 0 h1.6 M1.0 -0.4 l0.4 0.4 l-0.4 0.4"
                          stroke="var(--map-indoor-exit)"
                          strokeWidth="0.35"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </g>
                    )}
                  </g>
                  <title>
                    {n.name ??
                      (n.type === "stairs"
                        ? "Staircase"
                        : n.type === "lift"
                        ? "Elevator"
                        : n.type === "entrance"
                        ? "Main Entrance"
                        : "Emergency Exit")}
                  </title>
                </g>
              );
            })}
          </g>

          {/* 4. Active Route Layer */}
          <g className="ned-indoor-route-layer">
            {floorRoute.polylines.map((pts, idx) => {
              const d = pts
                .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
                .join(" ");
              return (
                <g key={`route-poly-${idx}`}>
                  {/* Casing stroke */}
                  <path
                    d={d}
                    className="ned-indoor-route-casing"
                    strokeWidth={1.8}
                  />
                  {/* Foreground animated stroke */}
                  <path
                    d={d}
                    className="ned-indoor-route-path ned-indoor-route-animated"
                    strokeWidth={1.0}
                    strokeDasharray="2.5 1.5"
                  />
                </g>
              );
            })}

            {/* Route Start Badge */}
            {floorRoute.startPoint && (
              <g
                transform={`translate(${floorRoute.startPoint[0]}, ${floorRoute.startPoint[1]})`}
                className="ned-indoor-symbol-marker"
              >
                <circle
                  cx="0"
                  cy="0"
                  r="3.2"
                  className="ned-indoor-symbol-hit-area"
                />
                <g className="ned-indoor-symbol-visual">
                  <circle
                    cx="0"
                    cy="0"
                    r="2.0"
                    fill="var(--map-landmark-fill, #185a44)"
                    stroke="#ffffff"
                    strokeWidth="0.4"
                  />
                  <circle cx="0" cy="0" r="0.7" fill="#ffffff" />
                </g>
                <title>Route Start</title>
              </g>
            )}

            {/* Route End Badge */}
            {floorRoute.endPoint && (
              <g
                transform={`translate(${floorRoute.endPoint[0]}, ${floorRoute.endPoint[1]})`}
                className="ned-indoor-symbol-marker"
              >
                <circle
                  cx="0"
                  cy="0"
                  r="3.4"
                  className="ned-indoor-symbol-hit-area"
                />
                <g className="ned-indoor-symbol-visual">
                  <circle
                    cx="0"
                    cy="0"
                    r="2.2"
                    fill="var(--map-route-stroke, #b85d19)"
                    stroke="#ffffff"
                    strokeWidth="0.4"
                  />
                  {/* Finish flag symbol */}
                  <path
                    d="M-0.8 1.1 v-2.2 M-0.8 -1.1 h1.6 l-0.4 0.6 l0.4 0.6 h-1.6"
                    stroke="#ffffff"
                    strokeWidth="0.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </g>
                <title>Route Destination</title>
              </g>
            )}

            {/* Stair / Lift Vertical Transition Badges */}
            {floorRoute.transitions.map((t, idx) => {
              const isUp = t.direction === "up";
              return (
                <g
                  key={`trans-${t.nodeId}-${idx}`}
                  transform={`translate(${t.x}, ${t.y - 3.2})`}
                  className="ned-indoor-floor-transition-badge"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectFloor(t.targetFloor);
                  }}
                >
                  <rect
                    x="-3.6"
                    y="-1.7"
                    width="7.2"
                    height="3.4"
                    className="ned-indoor-transition-hit-area"
                  />
                  <g className="ned-indoor-transition-visual">
                    <rect
                      x="-3.2"
                      y="-1.3"
                      width="6.4"
                      height="2.6"
                      rx="0.6"
                      fill="var(--map-surface-elevated, #ffffff)"
                      stroke="var(--map-route-stroke, #b85d19)"
                      strokeWidth="0.35"
                    />
                    {/* Direction indicator arrow */}
                    <path
                      d={
                        isUp
                          ? "M-1.8 0.4 l0.7 -0.8 l0.7 0.8"
                          : "M-1.8 -0.4 l0.7 0.8 l0.7 -0.8"
                      }
                      stroke="var(--map-route-stroke, #b85d19)"
                      strokeWidth="0.35"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                    <text
                      x="0.6"
                      y="0.1"
                      className="ned-indoor-label"
                      style={{
                        fontSize: "1.0px",
                        fill: "var(--map-route-stroke, #b85d19)",
                        fontWeight: 700,
                      }}
                    >
                      {t.targetLabel}
                    </text>
                  </g>
                  <title>{`Take ${t.kind} ${
                    isUp ? "up" : "down"
                  } to ${t.targetLabel} (click to switch floor)`}</title>
                </g>
              );
            })}
          </g>

          {/* 5. User Location Marker ("I am here") */}
          {currentUserNode && (
            <g
              transform={`translate(${currentUserNode.x}, ${currentUserNode.y})`}
              pointerEvents="none"
            >
              {/* Outer pulsing halo */}
              <circle
                cx="0"
                cy="0"
                r="3.2"
                fill="var(--map-user-dot, #0284c7)"
                className="ned-indoor-user-pulse"
                pointerEvents="none"
              />
              {/* Solid dot */}
              <circle
                cx="0"
                cy="0"
                r="1.7"
                fill="var(--map-user-dot, #0284c7)"
                stroke="#ffffff"
                strokeWidth="0.4"
                pointerEvents="none"
              />
              <circle cx="0" cy="0" r="0.6" fill="#ffffff" pointerEvents="none" />
              <title>You Are Here</title>
            </g>
          )}

          {/* 6. Evacuation Blocked Corridors */}
          {blockedCorridors.length > 0 && (
            <g className="ned-indoor-evac-blocked-corridors">
              {blockedCorridors.map(([aId, bId], idx) => {
                const na = floorNodeLookup.get(aId);
                const nb = floorNodeLookup.get(bId);
                if (!na || !nb) return null;
                const midX = (na.x + nb.x) / 2;
                const midY = (na.y + nb.y) / 2;

                return (
                  <g key={`blocked-corridor-${idx}`}>
                    <line
                      x1={na.x}
                      y1={na.y}
                      x2={nb.x}
                      y2={nb.y}
                      stroke="var(--map-evac-blocked-bg, #fef2f2)"
                      strokeWidth={corridorWidth * 0.9}
                      strokeLinecap="round"
                    />
                    <line
                      x1={na.x}
                      y1={na.y}
                      x2={nb.x}
                      y2={nb.y}
                      stroke="var(--map-evac-blocked, #b91c1c)"
                      strokeWidth={1.2}
                      strokeDasharray="2 1.5"
                      strokeLinecap="butt"
                    />
                    <circle
                      cx={midX}
                      cy={midY}
                      r="1.6"
                      fill="var(--map-evac-blocked-bg, #fef2f2)"
                      stroke="var(--map-evac-blocked, #b91c1c)"
                      strokeWidth="0.4"
                    />
                    <line
                      x1={midX - 0.7}
                      y1={midY - 0.7}
                      x2={midX + 0.7}
                      y2={midY + 0.7}
                      stroke="var(--map-evac-blocked, #b91c1c)"
                      strokeWidth="0.35"
                      strokeLinecap="round"
                    />
                    <line
                      x1={midX + 0.7}
                      y1={midY - 0.7}
                      x2={midX - 0.7}
                      y2={midY + 0.7}
                      stroke="var(--map-evac-blocked, #b91c1c)"
                      strokeWidth="0.35"
                      strokeLinecap="round"
                    />
                    <title>Blocked Hazard Corridor</title>
                  </g>
                );
              })}
            </g>
          )}

          {/* 7. Evacuation Assignment Paths */}
          {floorEvacAssignments.length > 0 && (
            <g className="ned-indoor-evac-assignments">
              {floorEvacAssignments.map((assign, aIdx) => {
                return (
                  <g key={`evac-assign-${aIdx}`}>
                    {assign.extracted.polylines.map((pts, pIdx) => {
                      const d = pts
                        .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
                        .join(" ");
                      return (
                        <g key={`assign-poly-${pIdx}`}>
                          <path
                            d={d}
                            stroke="#ffffff"
                            strokeWidth={1.7}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                          <path
                            d={d}
                            stroke="var(--map-evac-assign, #15803d)"
                            strokeWidth={1.0}
                            strokeDasharray="2.5 1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          )}

          {/* 8. Trace Replay Layer */}
          {traceState && (
            <g className="ned-indoor-trace-layer">
              {traceState.traceSegments.map((seg, sIdx) => (
                <line
                  key={`trace-seg-${sIdx}`}
                  x1={seg[0][0]}
                  y1={seg[0][1]}
                  x2={seg[1][0]}
                  y2={seg[1][1]}
                  stroke="var(--map-trace-visited, #0d9488)"
                  strokeWidth={0.8}
                  strokeDasharray="1.5 1"
                  strokeLinecap="round"
                />
              ))}

              {traceState.frontierNodes.map((n) => (
                <g key={`trace-frontier-${n.id}`}>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r="1.6"
                    fill="var(--map-surface-elevated, #ffffff)"
                    stroke="var(--map-trace-frontier, #d97706)"
                    strokeWidth="0.45"
                  />
                  <title>{`Frontier Node (${n.name ?? n.id})`}</title>
                </g>
              ))}

              {traceState.visitedNodes.map((n, orderIdx) => (
                <g key={`trace-visited-${n.id}`}>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r="1.7"
                    fill="var(--map-trace-visited, #0d9488)"
                    stroke="#ffffff"
                    strokeWidth="0.4"
                  />
                  {scale >= 1.2 && (
                    <text
                      x={n.x}
                      y={n.y - 2.4}
                      className="ned-indoor-label"
                      style={{
                        fontSize: "0.85px",
                        fill: "var(--map-trace-visited, #0d9488)",
                        fontWeight: 700,
                      }}
                    >
                      {orderIdx + 1}
                    </text>
                  )}
                  <title>{`Visited Node #${orderIdx + 1}: ${
                    n.name ?? n.id
                  }`}</title>
                </g>
              ))}

              {traceState.activeNode && (
                <g>
                  <circle
                    cx={traceState.activeNode.x}
                    cy={traceState.activeNode.y}
                    r="3.2"
                    fill="var(--map-trace-active, #be123c)"
                    className="ned-indoor-user-pulse"
                  />
                  <circle
                    cx={traceState.activeNode.x}
                    cy={traceState.activeNode.y}
                    r="1.9"
                    fill="var(--map-trace-active, #be123c)"
                    stroke="#ffffff"
                    strokeWidth="0.4"
                  />
                  <title>{`Active Search Node: ${
                    traceState.activeNode.name ?? traceState.activeNode.id
                  }`}</title>
                </g>
              )}
            </g>
          )}

          {/* 9. Room Labels (strictly clipped inside room boxes) */}
          <g className="ned-indoor-labels-layer">
            {visibleLabels.map((lbl) => (
              <g
                key={`label-${lbl.id}`}
                clipPath={`url(#clip-room-${lbl.nodeId})`}
                pointerEvents="none"
              >
                <text
                  x={lbl.cx}
                  y={lbl.cy}
                  className="ned-indoor-label"
                  style={{ fontSize: `${lbl.fontSizeMeters}px` }}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {lbl.lines.length === 1 ? (
                    lbl.lines[0]
                  ) : (
                    <>
                      <tspan x={lbl.cx} dy="-0.6em">
                        {lbl.lines[0]}
                      </tspan>
                      <tspan x={lbl.cx} dy="1.2em">
                        {lbl.lines[1]}
                      </tspan>
                    </>
                  )}
                </text>
              </g>
            ))}
          </g>
        </g>
      </svg>

      {/* Floating Room Popover / Tooltip */}
      {hoveredRoom && (
        <div
          className="ned-indoor-room-popover"
          style={{
            left: Math.max(
              110,
              Math.min(containerSize.width - 110, hoveredRoom.screenX)
            ),
            top: Math.max(36, hoveredRoom.screenY - 10),
          }}
        >
          <div className="ned-indoor-room-popover-title">
            {hoveredRoom.node.name || hoveredRoom.node.id}
          </div>
          <div className="ned-indoor-room-popover-meta">
            <span className="ned-indoor-room-popover-pill">
              Floor{" "}
              {hoveredRoom.node.floor === 0 ? "Ground" : hoveredRoom.node.floor}
            </span>
            {hoveredRoom.node.capacity && (
              <span>Capacity: {hoveredRoom.node.capacity}</span>
            )}
            <span style={{ opacity: 0.7 }}>{hoveredRoom.node.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}
