"use client";

import React, { useEffect, useState } from "react";
import {
  OutdoorMap,
  useTraceReplay,
  type CampusGraph,
  type CampusLandmark,
  type EvacuationOverlayData,
  type TraceEvent,
  type UserLocation,
} from "@/map";

const SAMPLE_ROUTE: string[] = ["n1", "n9", "n10", "n19", "n20", "n21"];

const SAMPLE_TRACE: TraceEvent[] = [
  { type: "frontier", node: "n1", dist: 0 },
  { type: "visit", node: "n1", dist: 0 },
  { type: "frontier", node: "n9", dist: 38 },
  { type: "relax", node: "n9", dist: 38 },
  { type: "visit", node: "n9", dist: 38 },
  { type: "frontier", node: "n10", dist: 82 },
  { type: "visit", node: "n10", dist: 82 },
  { type: "frontier", node: "n11", dist: 120 },
  { type: "frontier", node: "n19", dist: 145 },
  { type: "relax", node: "n19", dist: 145 },
  { type: "visit", node: "n19", dist: 145 },
  { type: "frontier", node: "n23", dist: 190 },
  { type: "frontier", node: "n51", dist: 210 },
  { type: "frontier", node: "n20", dist: 198 },
  { type: "relax", node: "n20", dist: 198 },
  { type: "visit", node: "n20", dist: 198 },
  { type: "frontier", node: "n21", dist: 235 },
  { type: "visit", node: "n21", dist: 235 },
];

const SAMPLE_EVACUATION: EvacuationOverlayData = {
  blockedNodes: ["n11"],
  blockedEdges: [
    ["n10", "n11"],
    ["n11", "n12"],
  ],
  assignments: [
    {
      from: "n30",
      assemblyId: "a-cricket-ground",
      path: ["n30", "n6", "n5", "n80"],
      distance: 165,
    },
  ],
};

const SAMPLE_USER_LOCATION: UserLocation = {
  lat: 24.93175,
  lng: 67.11355,
  accuracyMeters: 22,
};

export default function MapDevHarnessPage() {
  const [graph, setGraph] = useState<CampusGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | null>(
    "b-csit"
  );
  const [selectedLandmarkName, setSelectedLandmarkName] = useState<string>(
    "CSIT & Maths Departments"
  );
  const [lastClickCoord, setLastClickCoord] = useState<string>("None");

  const [showGraph, setShowGraph] = useState<boolean>(true);
  const [showRoute, setShowRoute] = useState<boolean>(true);
  const [showEvac, setShowEvac] = useState<boolean>(true);
  const [showUserLoc, setShowUserLoc] = useState<boolean>(true);
  const [showHighlights, setShowHighlights] = useState<boolean>(true);

  const traceReplay = useTraceReplay(SAMPLE_TRACE, 1);

  // Set trace to a mid-way step initially so frontier & visited nodes are immediately visible
  useEffect(() => {
    traceReplay.seek(11);
  }, []);

  useEffect(() => {
    fetch("/data/graph.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: CampusGraph) => {
        setGraph(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load graph.json");
      });
  }, []);

  const handleLandmarkClick = (id: string, lm: CampusLandmark) => {
    setSelectedLandmarkId(id);
    setSelectedLandmarkName(`${lm.name} (${lm.short})`);
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--map-bg, #e7ece8)",
        color: "var(--map-text-primary, #14241d)",
        padding: "20px 24px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        fontFamily: "var(--map-font-sans, sans-serif)",
      }}
    >
      {/* Header Bar */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          background: "var(--map-surface-card, #fafcfb)",
          border: "1px solid var(--map-border, #b8c6be)",
          borderRadius: "8px",
          padding: "12px 16px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--map-text-secondary, #3f544a)",
            }}
          >
            Member A — Task A3 Verification Harness
          </div>
          <h1 style={{ margin: "2px 0 0", fontSize: "18px", fontWeight: 700 }}>
            NavigateNED Outdoor Map Component
          </h1>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "14px",
            fontSize: "12px",
            color: "var(--map-text-secondary, #3f544a)",
          }}
        >
          <span>
            <strong>Selected:</strong> {selectedLandmarkName}
          </span>
          <span>
            <strong>Route:</strong> Main Gate (n1) to CSIT (n21)
          </span>
          <span>
            <strong>Map Click:</strong> {lastClickCoord}
          </span>
        </div>
      </header>

      {/* Layer Toggles & Trace Replay Controls */}
      <section
        aria-label="Map layer and trace replay controls"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "12px",
        }}
      >
        {/* Layer Toggles Card */}
        <div
          style={{
            background: "var(--map-surface-card, #fafcfb)",
            border: "1px solid var(--map-border, #b8c6be)",
            borderRadius: "8px",
            padding: "12px 16px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "14px",
            fontSize: "12px",
          }}
        >
          <strong style={{ marginRight: "4px" }}>Overlays:</strong>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showGraph}
              onChange={(e) => setShowGraph(e.target.checked)}
            />
            Walkway Graph
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showRoute}
              onChange={(e) => setShowRoute(e.target.checked)}
            />
            Sample Route
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showEvac}
              onChange={(e) => setShowEvac(e.target.checked)}
            />
            Evacuation Hazard
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showUserLoc}
              onChange={(e) => setShowUserLoc(e.target.checked)}
            />
            User GPS
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showHighlights}
              onChange={(e) => setShowHighlights(e.target.checked)}
            />
            Highlights
          </label>
        </div>

        {/* Trace Replay Controls Card */}
        <div
          style={{
            background: "var(--map-surface-card, #fafcfb)",
            border: "1px solid var(--map-border, #b8c6be)",
            borderRadius: "8px",
            padding: "12px 16px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "10px",
            fontSize: "12px",
          }}
        >
          <strong>Trace Replay:</strong>
          <button
            type="button"
            onClick={traceReplay.toggle}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 10px",
              borderRadius: "5px",
              border: "1px solid var(--map-border-strong, #5c7468)",
              background: "var(--map-surface-elevated, #ffffff)",
              color: "var(--map-text-primary, #14241d)",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {traceReplay.isPlaying ? (
                <>
                  <line x1="7" y1="4" x2="7" y2="16" />
                  <line x1="13" y1="4" x2="13" y2="16" />
                </>
              ) : (
                <polygon points="6,4 16,10 6,16" />
              )}
            </svg>
            {traceReplay.isPlaying ? "Pause" : "Play"}
          </button>

          <button
            type="button"
            onClick={traceReplay.reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              borderRadius: "5px",
              border: "1px solid var(--map-border, #b8c6be)",
              background: "var(--map-surface-elevated, #ffffff)",
              color: "var(--map-text-primary, #14241d)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Reset
          </button>

          <input
            type="range"
            min={0}
            max={Math.max(0, traceReplay.totalEvents - 1)}
            value={Math.max(0, traceReplay.currentIndex)}
            onChange={(e) => traceReplay.seek(Number(e.target.value))}
            aria-label="Trace step scrubber"
            style={{ width: "110px", cursor: "pointer" }}
          />

          <select
            aria-label="Trace playback speed"
            value={traceReplay.speedMultiplier}
            onChange={(e) => traceReplay.setSpeed(Number(e.target.value))}
            style={{
              padding: "3px 6px",
              borderRadius: "4px",
              border: "1px solid var(--map-border, #b8c6be)",
              fontSize: "12px",
              background: "var(--map-surface-elevated, #ffffff)",
            }}
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>

          <span style={{ color: "var(--map-text-secondary, #3f544a)" }}>
            Step {traceReplay.currentIndex + 1}/{traceReplay.totalEvents} (Visited:{" "}
            {traceReplay.visitedNodeIds.length}, Frontier:{" "}
            {traceReplay.frontierNodeIds.length})
          </span>
        </div>
      </section>

      {/* Map Canvas Container */}
      <section
        aria-label="Campus outdoor interactive map"
        style={{
          height: "660px",
          minHeight: "520px",
          width: "100%",
          position: "relative",
        }}
      >
        {error ? (
          <div
            style={{
              padding: "24px",
              color: "var(--map-evac-blocked, #b91c1c)",
              fontWeight: 600,
            }}
          >
            Error loading graph data: {error}
          </div>
        ) : !graph ? (
          <div style={{ padding: "24px", fontWeight: 500 }}>
            Loading campus geospatial graph...
          </div>
        ) : (
          <OutdoorMap
            graph={graph}
            route={showRoute ? SAMPLE_ROUTE : undefined}
            highlightedNodeIds={showHighlights ? ["n23", "n51"] : undefined}
            selectedLandmarkId={selectedLandmarkId}
            onLandmarkClick={handleLandmarkClick}
            onMapClick={({ lat, lng }) =>
              setLastClickCoord(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
            }
            showGraph={showGraph}
            userLocation={showUserLoc ? SAMPLE_USER_LOCATION : null}
            evacuation={showEvac ? SAMPLE_EVACUATION : null}
            trace={traceReplay}
          />
        )}
      </section>
    </main>
  );
}
