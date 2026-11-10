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
import { computeIndoorLabels, type PlacedLabel } from "./labels";
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

  // Compute collision-free labels
  const activeRouteNodesSet = useMemo(() => new Set(route ?? []), [route]);
  const visibleLabels = useMemo(() => {
    return computeIndoorLabels(
      floorRooms,
      floorNodes,
      activeFloor,
      scale,
      selectedRoomId,
      activeRouteNodesSet
    );
  }, [floorRooms, floorNodes, activeFloor, scale, selectedRoomId, activeRouteNodesSet]);

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
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRoomClick?.(r.nodeId, node);
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
                  className="ned-indoor-symbol-group"
                >
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
                      <title>{n.name ?? "Staircase"}</title>
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
                      <title>{n.name ?? "Elevator"}</title>
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
                      <title>{n.name ?? "Main Entrance"}</title>
                    </g>
                  )}

                  {n.type === "exit" && (
                    <g>
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
                      <title>{n.name ?? "Emergency Exit"}</title>
                    </g>
                  )}
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
                className="ned-indoor-symbol-group"
              >
                <circle
                  cx="0"
                  cy="0"
                  r="2.0"
                  fill="var(--map-landmark-fill, #185a44)"
                  stroke="#ffffff"
                  strokeWidth="0.4"
                />
                <circle cx="0" cy="0" r="0.7" fill="#ffffff" />
                <title>Route Start</title>
              </g>
            )}

            {/* Route End Badge */}
            {floorRoute.endPoint && (
              <g
                transform={`translate(${floorRoute.endPoint[0]}, ${floorRoute.endPoint[1]})`}
                className="ned-indoor-symbol-group"
              >
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
              className="ned-indoor-symbol-group"
            >
              {/* Outer pulsing halo */}
              <circle
                cx="0"
                cy="0"
                r="3.2"
                fill="var(--map-user-dot, #0284c7)"
                className="ned-indoor-user-pulse"
              />
              {/* Solid dot */}
              <circle
                cx="0"
                cy="0"
                r="1.7"
                fill="var(--map-user-dot, #0284c7)"
                stroke="#ffffff"
                strokeWidth="0.4"
              />
              <circle cx="0" cy="0" r="0.6" fill="#ffffff" />
              <title>You Are Here</title>
            </g>
          )}

          {/* 6. Room Labels */}
          <g className="ned-indoor-labels-layer">
            {visibleLabels.map((lbl) => {
              return (
                <text
                  key={`label-${lbl.id}`}
                  x={lbl.x}
                  y={lbl.y}
                  className="ned-indoor-label"
                  style={{ fontSize: `${lbl.fontSize}px` }}
                >
                  {lbl.text}
                </text>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}
