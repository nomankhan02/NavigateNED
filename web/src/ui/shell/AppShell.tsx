"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CampusGraph,
  type CampusLandmark,
  OutdoorMap,
} from "@/map";
import {
  AccessibilityIcon,
  AssemblyPointIcon,
  Badge,
  Button,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  Chip,
  CompassIcon,
  Divider,
  Field,
  GraphIcon,
  HazardIcon,
  IconButton,
  ListRow,
  RouteIcon,
  SearchField,
  SegmentedControl,
  type SheetSnap,
  StatReadout,
  SurveyLoader,
  SwapIcon,
  ThemeSwitch,
  Toggle,
} from "@/ui";
import styles from "./shell.module.css";

export type AppMode = "navigate" | "explore" | "evacuate";
export type RouteAlgo = "dijkstra" | "astar" | "bfs" | "bellmanford";

const SNAP_ORDER: readonly SheetSnap[] = ["peek", "half", "expanded"];

export function AppShell() {
  const [graph, setGraph] = useState<CampusGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<AppMode>("navigate");
  const [algo, setAlgo] = useState<RouteAlgo>("astar");
  const [stepFree, setStepFree] = useState<boolean>(false);
  const [disableLifts, setDisableLifts] = useState<boolean>(true);
  const [showGraph, setShowGraph] = useState<boolean>(false);

  const [whereToQuery, setWhereToQuery] = useState<string>("");
  const [fromInput, setFromInput] = useState<string>("Main Gate (b-main-gate)");
  const [toInput, setToInput] = useState<string>("Central Library (b-library)");
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | null>("b-library");
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number }>({
    lat: 24.9325,
    lng: 67.1135,
  });

  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [mobileSnap, setMobileSnap] = useState<SheetSnap>("half");
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/graph.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading /data/graph.json`);
        return res.json() as Promise<CampusGraph>;
      })
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredLandmarks = useMemo(() => {
    if (!graph) return [];
    const q = whereToQuery.trim().toLowerCase();
    const list = graph.landmarks;
    if (!q) return list.slice(0, 12);
    return list
      .filter(
        (lm) =>
          lm.name.toLowerCase().includes(q) ||
          (lm.number && lm.number.toLowerCase().includes(q)) ||
          lm.id.toLowerCase().includes(q) ||
          lm.category.toLowerCase().includes(q),
      )
      .slice(0, 14);
  }, [graph, whereToQuery]);

  const selectedLandmark: CampusLandmark | null = useMemo(() => {
    if (!graph || !selectedLandmarkId) return null;
    return graph.landmarks.find((lm) => lm.id === selectedLandmarkId) ?? null;
  }, [graph, selectedLandmarkId]);

  const nodeById = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    if (!graph) return map;
    for (const n of graph.nodes) {
      map.set(n.id, { lat: n.lat, lng: n.lng });
    }
    return map;
  }, [graph]);

  const handleLandmarkSelect = (id: string, lm: CampusLandmark) => {
    setSelectedLandmarkId(id);
    const node = nodeById.get(lm.nodeId);
    if (node) {
      setCursorCoords({ lat: node.lat, lng: node.lng });
    }
    setToInput(`${lm.name} (${lm.id})`);
  };

  const handleSwapEndpoints = () => {
    setFromInput(toInput);
    setToInput(fromInput);
  };

  const cycleMobileSnap = (dir: 1 | -1) => {
    const idx = SNAP_ORDER.indexOf(mobileSnap);
    const nextIdx = Math.max(0, Math.min(SNAP_ORDER.length - 1, idx + dir));
    setMobileSnap(SNAP_ORDER[nextIdx]);
  };

  const handleGrabPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartYRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleGrabPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    dragStartYRef.current = null;
    if (dy < -28) cycleMobileSnap(1);
    else if (dy > 28) cycleMobileSnap(-1);
  };

  const mapStageStyle = {
    "--map-left-inset": dockCollapsed ? "0px" : "384px",
  } as CSSProperties;

  const mobileSnapClass =
    mobileSnap === "peek"
      ? styles.mobileSnapPeek
      : mobileSnap === "expanded"
        ? styles.mobileSnapExpanded
        : styles.mobileSnapHalf;

  return (
    <div className={styles.shellRoot}>
      {/* TITLE-BLOCK HEADER STRIP */}
      <header className={styles.titleBlock}>
        <div className={styles.brandCluster}>
          <span className={styles.compassStamp} aria-hidden="true">
            <CompassIcon size={20} />
          </span>
          <div className={styles.brandTitles}>
            <span className={styles.plateSerial}>
              NED UNIVERSITY // CAMPUS SURVEY PLATE // REV C1
            </span>
            <h1 className={styles.appTitle}>NavigateNED</h1>
          </div>
        </div>

        <div className={styles.telemetryCluster}>
          <div className={styles.coordReadout} title="Active survey datum coordinates">
            <span className={styles.coordLabel}>DATUM</span>
            <span>
              {cursorCoords.lat.toFixed(4)}°N, {cursorCoords.lng.toFixed(4)}°E
            </span>
          </div>

          {graph ? (
            <Badge variant="teal" numeric>
              {graph.nodes.length} NODES // {graph.landmarks.length} LANDMARKS
            </Badge>
          ) : null}

          <div className={styles.headerActions}>
            <IconButton
              size="sm"
              variant={showGraph ? "primary" : "secondary"}
              aria-label="Toggle walkable network topology overlay"
              title="Toggle walkable graph overlay"
              onClick={() => setShowGraph((v) => !v)}
            >
              <GraphIcon size={16} />
            </IconButton>
            <ThemeSwitch size="sm" />
            <Link href="/kit">
              <Button size="sm" variant="secondary">
                UI Kit
              </Button>
            </Link>
          </div>
        </div>

        <div className={styles.titleHairlineRule} aria-hidden="true" />
      </header>

      {/* FULL-BLEED MAP STAGE + EDGE-ATTACHED PANEL / MOBILE SHEET */}
      <div className={styles.mapStage} style={mapStageStyle}>
        <div className={styles.mapCanvas}>
          {graph ? (
            <OutdoorMap
              graph={graph}
              showGraph={showGraph}
              selectedLandmarkId={selectedLandmarkId}
              onLandmarkClick={handleLandmarkSelect}
              onMapClick={(coords) => setCursorCoords(coords)}
            />
          ) : (
            <div className={styles.loadingOverlay}>
              {loadError ? (
                <Badge variant="hazard">{loadError}</Badge>
              ) : (
                <SurveyLoader label="CALIBRATING /DATA/GRAPH.JSON SURVEY PLATE" />
              )}
            </div>
          )}
        </div>

        {/* EDGE-ATTACHED LEFT PANEL (DESKTOP) / DRAGGABLE BOTTOM SHEET (PHONE) */}
        <aside
          aria-label="Campus navigation control sheet"
          className={[
            styles.leftDock,
            dockCollapsed ? styles.leftDockCollapsed : "",
            mobileSnapClass,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {/* Desktop collapse/expand mechanical latch */}
          <button
            type="button"
            className={styles.dockLatchBtn}
            aria-label={dockCollapsed ? "Expand survey panel" : "Collapse survey panel"}
            title={dockCollapsed ? "Expand panel" : "Collapse panel"}
            onClick={() => setDockCollapsed((c) => !c)}
          >
            {dockCollapsed ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
          </button>

          {/* Phone drag handle & snap controls */}
          <div
            className={styles.mobileGrabHeader}
            onPointerDown={handleGrabPointerDown}
            onPointerUp={handleGrabPointerUp}
          >
            <div className={styles.mobileGrabPill} />
            <div className={styles.mobileSnapHeaderRow}>
              <span className={styles.plateSerial}>
                SURVEY SHEET // {mobileSnap.toUpperCase()}
              </span>
              <div style={{ display: "inline-flex", gap: 4 }}>
                <IconButton
                  size="sm"
                  aria-label="Expand bottom sheet"
                  disabled={mobileSnap === "expanded"}
                  onClick={() => cycleMobileSnap(1)}
                >
                  <ChevronUpIcon size={14} />
                </IconButton>
                <IconButton
                  size="sm"
                  aria-label="Collapse bottom sheet"
                  disabled={mobileSnap === "peek"}
                  onClick={() => cycleMobileSnap(-1)}
                >
                  <ChevronDownIcon size={14} />
                </IconButton>
              </div>
            </div>
          </div>

          {/* Top-level Mode Tabs + "Where to" Search */}
          <div className={styles.dockHeader}>
            <SegmentedControl
              fullWidth
              ariaLabel="Primary navigation mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "navigate", label: "Navigate", icon: <RouteIcon size={14} /> },
                { value: "explore", label: "Explore", count: graph?.landmarks.length ?? 55 },
                { value: "evacuate", label: "Evacuate", icon: <AssemblyPointIcon size={14} /> },
              ]}
            />

            <SearchField
              id="shell-where-to"
              label="Where To"
              placeholder="Search buildings, numbers (#11), or rooms..."
              value={whereToQuery}
              onChange={setWhereToQuery}
              resultCount={whereToQuery.trim() ? filteredLandmarks.length : undefined}
            />
          </div>

          {/* Scrollable Body */}
          <div className={styles.dockScroll}>
            {mode === "navigate" ? (
              <>
                {/* FROM / TO ENDPOINT SECTION */}
                <div className={styles.endpointGrid}>
                  <div className={styles.endpointFields}>
                    <Field
                      id="shell-from"
                      label="From (Origin)"
                      unit="START"
                      value={fromInput}
                      onChange={(e) => setFromInput(e.target.value)}
                    />
                    <Field
                      id="shell-to"
                      label="To (Destination)"
                      unit={selectedLandmark?.number ? `BLDG #${selectedLandmark.number}` : "DEST"}
                      value={toInput}
                      onChange={(e) => setToInput(e.target.value)}
                    />
                  </div>
                  <IconButton
                    size="md"
                    aria-label="Swap origin and destination"
                    title="Swap From / To"
                    onClick={handleSwapEndpoints}
                  >
                    <SwapIcon size={16} />
                  </IconButton>
                </div>

                <SegmentedControl
                  fullWidth
                  ariaLabel="Routing algorithm selection"
                  value={algo}
                  onChange={setAlgo}
                  options={[
                    { value: "dijkstra", label: "Dijkstra" },
                    { value: "astar", label: "A*" },
                    { value: "bfs", label: "BFS" },
                    { value: "bellmanford", label: "Bellman" },
                  ]}
                />

                <Toggle
                  id="shell-step-free"
                  checked={stepFree}
                  onChange={setStepFree}
                  leadingIcon={<AccessibilityIcon size={15} />}
                  label="Step-Free Accessible Traverse"
                  hint="Prefer ramps & indoor lifts; exclude stairwells"
                />

                <Divider label="ROUTE SUMMARY READOUT" />

                {/* ROUTE SUMMARY AREA (Instrument Readouts in Azeret Mono) */}
                <div className={styles.readoutGrid}>
                  <StatReadout
                    size="sm"
                    label="Traverse Distance"
                    value={312.4}
                    decimals={1}
                    unit="m"
                    sublabel={`Algo: ${algo.toUpperCase()}`}
                    tone="accent"
                  />
                  <StatReadout
                    size="sm"
                    label="Est. Walk Time"
                    value={4}
                    unit="min"
                    sublabel={stepFree ? "Step-free pace" : "Standard pace"}
                    tone="teal"
                  />
                  <StatReadout
                    size="sm"
                    label="Indoor Transition"
                    value={0}
                    unit="fl"
                    sublabel="Outdoor ground plate"
                    tone="safe"
                  />
                  <StatReadout
                    size="sm"
                    label="Graph Search"
                    value={42}
                    unit="nodes"
                    sublabel="LRU cache ready"
                  />
                </div>

                <Divider label="QUICK CAMPUS LANDMARKS" />
                <div className={styles.directoryList}>
                  {filteredLandmarks.slice(0, 6).map((lm) => (
                    <ListRow
                      key={lm.id}
                      selected={selectedLandmarkId === lm.id}
                      onClick={() => handleLandmarkSelect(lm.id, lm)}
                      leading={
                        lm.number ? (
                          <Badge variant="building">{lm.number}</Badge>
                        ) : (
                          <Badge variant="neutral" numeric>
                            LM
                          </Badge>
                        )
                      }
                      title={lm.name}
                      subtitle={`Node ${lm.nodeId} // ${lm.category}`}
                      trailing={<span>SET TO</span>}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {mode === "explore" ? (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  <Chip
                    label="All Buildings"
                    count={graph?.landmarks.length ?? 55}
                    active={!whereToQuery}
                    onClick={() => setWhereToQuery("")}
                  />
                  <Chip
                    label="CSIT"
                    active={whereToQuery.toLowerCase() === "csit"}
                    onClick={() => setWhereToQuery("CSIT")}
                  />
                  <Chip
                    label="Library"
                    active={whereToQuery.toLowerCase() === "library"}
                    onClick={() => setWhereToQuery("Library")}
                  />
                  <Chip
                    label="Gates"
                    active={whereToQuery.toLowerCase() === "gate"}
                    onClick={() => setWhereToQuery("Gate")}
                  />
                </div>

                <Divider label="CAMPUS DIRECTORY (CLICK TO FOCUS ON PLATE)" />
                <div className={styles.directoryList} style={{ maxHeight: "340px" }}>
                  {filteredLandmarks.map((lm) => {
                    const node = nodeById.get(lm.nodeId);
                    return (
                      <ListRow
                        key={lm.id}
                        selected={selectedLandmarkId === lm.id}
                        onClick={() => handleLandmarkSelect(lm.id, lm)}
                        leading={
                          lm.number ? (
                            <Badge variant="building">{lm.number}</Badge>
                          ) : (
                            <Badge variant="neutral" numeric>
                              --
                            </Badge>
                          )
                        }
                        title={lm.name}
                        subtitle={`${lm.category.toUpperCase()} // Node ${lm.nodeId}`}
                        trailing={
                          <span>
                            {node ? `${node.lat.toFixed(4)}, ${node.lng.toFixed(4)}` : lm.nodeId}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              </>
            ) : null}

            {mode === "evacuate" ? (
              <>
                <div className={styles.readoutGrid}>
                  <StatReadout
                    size="sm"
                    label="Assembly Zones"
                    value={7}
                    unit="areas"
                    sublabel="Multi-Source Reversed"
                    tone="safe"
                  />
                  <StatReadout
                    size="sm"
                    label="Total Capacity"
                    value={6800}
                    unit="pers"
                    sublabel="Min-Cost Max-Flow"
                    tone="teal"
                  />
                </div>

                <Toggle
                  id="shell-evac-lifts"
                  checked={disableLifts}
                  onChange={setDisableLifts}
                  leadingIcon={<HazardIcon size={15} />}
                  label="Disable Lifts During Evacuation"
                  hint="Enforce stairwell-only vertical egress across all 6 indoor blocks"
                />

                <Divider label="MUSTER & EGRESS READINESS" />
                <div className={styles.directoryList}>
                  <ListRow
                    leading={<Badge variant="safe" numeric>A1</Badge>}
                    title="Courtyard Fountain Central Plaza"
                    subtitle="Node n28 // Primary Central Muster"
                    trailing={<span>600 CAP</span>}
                  />
                  <ListRow
                    leading={<Badge variant="safe" numeric>A2</Badge>}
                    title="Soccer Field & Athletics Track"
                    subtitle="Primary Open Ground Muster"
                    trailing={<span>1800 CAP</span>}
                  />
                  <ListRow
                    leading={<Badge variant="safe" numeric>A3</Badge>}
                    title="Main Gate Outer Assembly Apron"
                    subtitle="University Road Egress"
                    trailing={<span>900 CAP</span>}
                  />
                </div>
              </>
            ) : null}
          </div>

          <footer className={styles.dockFooter}>
            <span>PLATE SCALE // GEODETIC WGS84</span>
            <span>697 MERGED NODES READY</span>
          </footer>
        </aside>
      </div>
    </div>
  );
}
