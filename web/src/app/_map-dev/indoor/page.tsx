/**
 * web/src/app/_map-dev/indoor/page.tsx
 * Temporary Dev Verification Harness for the IndoorMap Component.
 * Allowed exception per task instructions. Member C may freely remove or replace it.
 */

"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  IndoorMap,
  useTraceReplay,
  type IndoorBuilding,
  type IndoorNode,
  type IndoorEvacuationData,
  type TraceEvent,
} from "@/map";

const BUILDINGS = [
  { id: "b-csit", name: "CS & IT Department (Ring 70x44m, 3F)" },
  { id: "b-admin", name: "Administration Block (Ring 70x44m, 3F)" },
  { id: "b-library", name: "Central Library (H-Shape 70x56m, 3F)" },
  { id: "b-auditorium", name: "Main Auditorium (U-Shape 70x50m, 2F)" },
  { id: "b-csit-labs", name: "CSIT Labs 5A (U-Shape 70x50m, 2F)" },
  { id: "b-dean-offices", name: "Dean Offices (L-Shape 60x60m, 2F)" },
];

/**
 * Finds a multi-floor path from entrance on Ground Floor to a room on First Floor.
 */
function findSamplePath(building: IndoorBuilding | null): string[] {
  if (!building) return [];
  const entrance =
    building.nodes.find((n) => n.type === "entrance") ||
    building.nodes.find((n) => n.floor === 0) ||
    building.nodes[0];

  const targetRoom =
    building.nodes.find((n) => n.type === "room" && n.floor === 1) ||
    building.nodes.find((n) => n.type === "room" && n.floor !== entrance.floor) ||
    building.nodes[building.nodes.length - 1];

  if (!entrance || !targetRoom) return [];

  const adj = new Map<string, string[]>();
  for (const e of building.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }

  const queue: string[] = [entrance.id];
  const parent = new Map<string, string | null>([[entrance.id, null]]);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === targetRoom.id) {
      const path: string[] = [];
      let step: string | null = curr;
      while (step) {
        path.unshift(step);
        step = parent.get(step) ?? null;
      }
      return path;
    }
    for (const neighbor of adj.get(curr) ?? []) {
      if (!parent.has(neighbor)) {
        parent.set(neighbor, curr);
        queue.push(neighbor);
      }
    }
  }

  return [];
}

export default function IndoorMapDevHarness() {
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>("b-csit");
  const [building, setBuilding] = useState<IndoorBuilding | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeFloor, setActiveFloor] = useState<number>(0);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<IndoorNode | null>(null);

  // Layer toggles
  const [showRoute, setShowRoute] = useState<boolean>(true);
  const [showEvacuation, setShowEvacuation] = useState<boolean>(true);
  const [showTrace, setShowTrace] = useState<boolean>(false);
  const [showUserNode, setShowUserNode] = useState<boolean>(true);

  // Load selected building JSON
  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedRoomId(null);
    setSelectedNodeInfo(null);

    fetch(`/data/indoor/${selectedBuildingId}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${selectedBuildingId}.json`);
        return res.json();
      })
      .then((data: IndoorBuilding) => {
        setBuilding(data);
        setActiveFloor(data.floors[0]?.level ?? 0);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load building data");
        setLoading(false);
      });
  }, [selectedBuildingId]);

  // Compute sample multi-floor route
  const sampleRoute = useMemo(() => {
    return findSamplePath(building);
  }, [building]);

  // Compute sample evacuation data
  const sampleEvacData: IndoorEvacuationData | null = useMemo(() => {
    if (!building) return null;
    const entranceNode = building.nodes.find((n) => n.type === "entrance");
    const exitNodes = building.nodes.filter((n) => n.type === "exit" || n.type === "entrance").map((n) => n.id);

    // Block one corridor edge on floor 0 if available
    const fl0Corridors = building.edges.filter((e) => {
      const na = building.nodes.find((n) => n.id === e.a);
      const nb = building.nodes.find((n) => n.id === e.b);
      return na?.floor === 0 && nb?.floor === 0 && na.type === "corridor" && nb.type === "corridor";
    });
    const blockedCorridors: [string, string][] =
      fl0Corridors.length > 2 ? [[fl0Corridors[1].a, fl0Corridors[1].b]] : [];

    // Block one room on floor 0
    const fl0Room = building.rooms.find((r) => {
      const n = building.nodes.find((node) => node.id === r.nodeId);
      return n?.floor === 0;
    });
    const blockedRooms = fl0Room ? [fl0Room.nodeId] : [];

    // Assignment path from a room on floor 0 to entrance
    const assignPath = sampleRoute.slice(0, Math.min(4, sampleRoute.length));

    return {
      exitNodes: exitNodes.length > 0 ? exitNodes : entranceNode ? [entranceNode.id] : [],
      blockedCorridors,
      blockedRooms,
      assignmentPaths:
        assignPath.length >= 2 && entranceNode
          ? [
              {
                from: assignPath[assignPath.length - 1],
                exitId: entranceNode.id,
                path: assignPath,
              },
            ]
          : [],
    };
  }, [building, sampleRoute]);

  // Sample trace events along sample route
  const sampleTraceEvents: TraceEvent[] = useMemo(() => {
    if (!sampleRoute || sampleRoute.length === 0) return [];
    const events: TraceEvent[] = [];
    sampleRoute.forEach((nid, idx) => {
      events.push({ type: "frontier", node: nid, dist: idx * 10 });
      if (idx > 0) {
        events.push({ type: "relax", node: nid, dist: idx * 10 });
      }
      events.push({ type: "visit", node: nid, dist: idx * 10 });
    });
    return events;
  }, [sampleRoute]);

  const traceReplay = useTraceReplay(showTrace ? sampleTraceEvents : null, 1);

  // Set trace replay initially midway
  useEffect(() => {
    if (showTrace && sampleTraceEvents.length > 0) {
      traceReplay.seek(Math.min(5, sampleTraceEvents.length - 1));
    }
  }, [showTrace, sampleTraceEvents]);

  const handleRoomClick = (roomId: string, node: IndoorNode | undefined) => {
    setSelectedRoomId(roomId);
    setSelectedNodeInfo(node ?? null);
  };

  const userNodeId = useMemo(() => {
    if (!building) return null;
    const ent = building.nodes.find((n) => n.type === "entrance");
    return ent ? ent.id : building.nodes[0]?.id ?? null;
  }, [building]);

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1280, margin: "0 auto", fontFamily: "var(--map-font-sans)" }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--map-text-primary, #14241d)" }}>
            IndoorMap Component Verification Harness
          </h1>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              background: "#dcfce7",
              color: "#166534",
              border: "1px solid #bbf7d0",
            }}
          >
            Task A4 Harness
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--map-text-secondary, #3f544a)", margin: 0 }}>
          Interactive multi-floor SVG viewer testing pan/zoom, vertical floor switching, route animations, stair/lift connectors, evacuation overlays, and trace replay.
        </p>
      </div>

      {/* Control Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "var(--map-surface-card, #ffffff)",
          border: "1px solid var(--map-border, #b8c6be)",
          borderRadius: 8,
          marginBottom: 16,
          boxShadow: "0 2px 8px rgba(18, 31, 25, 0.05)",
        }}
      >
        {/* Building Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="building-select" style={{ fontSize: 12, fontWeight: 700, color: "var(--map-text-secondary, #3f544a)" }}>
            Building:
          </label>
          <select
            id="building-select"
            value={selectedBuildingId}
            onChange={(e) => setSelectedBuildingId(e.target.value)}
            style={{
              padding: "5px 10px",
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 6,
              border: "1px solid var(--map-border, #b8c6be)",
              background: "var(--map-surface-elevated, #ffffff)",
              color: "var(--map-text-primary, #14241d)",
              outline: "none",
            }}
          >
            {BUILDINGS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Feature Toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showRoute}
              onChange={(e) => setShowRoute(e.target.checked)}
            />
            <span style={{ fontWeight: 600 }}>Multi-Floor Route</span>
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showEvacuation}
              onChange={(e) => setShowEvacuation(e.target.checked)}
            />
            <span style={{ fontWeight: 600 }}>Evacuation Hazard Overlay</span>
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showTrace}
              onChange={(e) => setShowTrace(e.target.checked)}
            />
            <span style={{ fontWeight: 600 }}>Trace Replay</span>
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showUserNode}
              onChange={(e) => setShowUserNode(e.target.checked)}
            />
            <span style={{ fontWeight: 600 }}>User Marker</span>
          </label>
        </div>

        {/* Trace Replay Controls */}
        {showTrace && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginLeft: "auto",
              padding: "4px 8px",
              background: "#f0fdf4",
              borderRadius: 6,
              border: "1px solid #bbf7d0",
            }}
          >
            <button
              type="button"
              onClick={traceReplay.toggle}
              style={{
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 4,
                border: "1px solid #86efac",
                background: "#ffffff",
                cursor: "pointer",
              }}
            >
              {traceReplay.isPlaying ? "Pause Trace" : "Play Trace"}
            </button>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#166534" }}>
              Step {traceReplay.currentIndex + 1} / {traceReplay.totalEvents}
            </span>
          </div>
        )}
      </div>

      {/* Main Map Viewer Area */}
      <div style={{ height: "620px", position: "relative" }}>
        {loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              background: "#f2f6f3",
              borderRadius: 8,
              border: "1px solid var(--map-border)",
              color: "var(--map-text-secondary)",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Loading building floor plan dataset...
          </div>
        ) : error ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              background: "#fef2f2",
              borderRadius: 8,
              border: "1px solid #fecaca",
              color: "#b91c1c",
              fontSize: 14,
              fontWeight: 600,
              padding: 24,
            }}
          >
            {error}
          </div>
        ) : (
          <IndoorMap
            building={building}
            floor={activeFloor}
            onFloorChange={setActiveFloor}
            route={showRoute ? sampleRoute : undefined}
            selectedRoomId={selectedRoomId}
            onRoomClick={handleRoomClick}
            userNode={showUserNode ? userNodeId : null}
            evacuation={showEvacuation ? sampleEvacData : null}
            trace={showTrace ? traceReplay : null}
          />
        )}
      </div>

      {/* Selected Room Details Panel */}
      {selectedNodeInfo && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 18px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#92400e" }}>
              Selected Room: {selectedNodeInfo.name ?? selectedNodeInfo.id}
            </div>
            <div style={{ fontSize: 12, color: "#78350f" }}>
              Node: <code>{selectedNodeInfo.id}</code> | Floor: {selectedNodeInfo.floor} | Type: {selectedNodeInfo.type}
              {selectedNodeInfo.capacity ? ` | Capacity: ${selectedNodeInfo.capacity} people` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedRoomId(null);
              setSelectedNodeInfo(null);
            }}
            style={{
              padding: "4px 10px",
              fontSize: 11.5,
              fontWeight: 600,
              borderRadius: 4,
              border: "1px solid #fcd34d",
              background: "#ffffff",
              color: "#92400e",
              cursor: "pointer",
            }}
          >
            Clear Selection
          </button>
        </div>
      )}
    </div>
  );
}
