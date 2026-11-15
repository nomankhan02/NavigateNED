"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CampusGraph,
  type CampusLandmark,
  type IndoorBuilding,
  OutdoorMap,
} from "@/map";
import {
  AccessibilityIcon,
  AssemblyPointIcon,
  Badge,
  BrandLogo,
  Button,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  Chip,
  DistanceIcon,
  Field,
  FloorIcon,
  GraphIcon,
  HazardIcon,
  IconButton,
  ListRow,
  RouteIcon,
  SearchField,
  type SearchOption,
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

const INDOOR_BUILDING_IDS = [
  "b-admin",
  "b-auditorium",
  "b-csit",
  "b-csit-labs",
  "b-dean-offices",
  "b-library",
] as const;

const PREFERRED_DISPLAY_NAMES: Record<string, string> = {
  "b-library": "Central Library",
  "b-csit": "CSIT & Maths",
  "b-csit-labs": "CSIT Labs",
  "b-admin": "Admin Block",
  "b-auditorium": "Main Auditorium",
  "b-dean-offices": "Dean Offices",
  "b-main-gate": "Main Gate",
};

/** Returns a clean, human-friendly building name with zero internal IDs. */
export function formatLandmarkName(lm: CampusLandmark): string {
  if (PREFERRED_DISPLAY_NAMES[lm.id]) {
    return PREFERRED_DISPLAY_NAMES[lm.id];
  }
  if (lm.name.length > 24 && lm.short && lm.short.trim().length >= 3) {
    return lm.short.trim();
  }
  return lm.name;
}

/** Sorts landmarks by building number first (1, 2, ..., 5, 5A, ...), then alphabetically. */
function compareLandmarksByNumber(a: CampusLandmark, b: CampusLandmark): number {
  const numA = a.number ?? "";
  const numB = b.number ?? "";
  if (numA && !numB) return -1;
  if (!numA && numB) return 1;
  if (numA && numB) {
    const intA = Number.parseInt(numA, 10);
    const intB = Number.parseInt(numB, 10);
    if (!Number.isNaN(intA) && !Number.isNaN(intB) && intA !== intB) {
      return intA - intB;
    }
    const cmp = numA.localeCompare(numB, undefined, { numeric: true });
    if (cmp !== 0) return cmp;
  }
  return formatLandmarkName(a).localeCompare(formatLandmarkName(b));
}

interface SectionHeaderProps {
  number: string;
  title: string;
  rightSlot?: ReactNode;
}

function SectionHeader({ number, title, rightSlot }: SectionHeaderProps) {
  return (
    <div className={styles.sectionHeader}>
      <span className={styles.sectionNumber}>{number}</span>
      <span className={styles.sectionTitle}>{title}</span>
      <span className={styles.sectionRule} aria-hidden="true" />
      {rightSlot}
    </div>
  );
}

export function AppShell() {
  const [graph, setGraph] = useState<CampusGraph | null>(null);
  const [indoorBuildings, setIndoorBuildings] = useState<IndoorBuilding[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<AppMode>("navigate");
  const [algo, setAlgo] = useState<RouteAlgo>("astar");
  const [stepFree, setStepFree] = useState<boolean>(false);
  const [disableLifts, setDisableLifts] = useState<boolean>(true);
  const [showGraph, setShowGraph] = useState<boolean>(false);

  const [whereToQuery, setWhereToQuery] = useState<string>("");
  const [fromInput, setFromInput] = useState<string>("Main Gate");
  const [toInput, setToInput] = useState<string>("Central Library");
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | null>("b-library");
  const [exploreCategory, setExploreCategory] = useState<string>("all");
  const [landmarksExpanded, setLandmarksExpanded] = useState<boolean>(true);

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
        if (!res.ok) throw new Error(`HTTP ${res.status} loading campus map`);
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

    Promise.all(
      INDOOR_BUILDING_IDS.map((bid) =>
        fetch(`/data/indoor/${bid}.json`)
          .then((r) => (r.ok ? (r.json() as Promise<IndoorBuilding>) : null))
          .catch(() => null),
      ),
    ).then((buildings) => {
      if (!cancelled) {
        setIndoorBuildings(
          buildings.filter((b): b is IndoorBuilding => b !== null),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const nodeById = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    if (!graph) return map;
    for (const n of graph.nodes) {
      map.set(n.id, { lat: n.lat, lng: n.lng });
    }
    return map;
  }, [graph]);

  /** Ordered campus landmarks (by building number, then alphabetically), independent of search */
  const orderedLandmarks = useMemo(() => {
    if (!graph) return [];
    return [...graph.landmarks].sort(compareLandmarksByNumber);
  }, [graph]);

  /** Unified search options (buildings + indoor rooms) for Where-to, From, and To dropdowns */
  const searchOptions: SearchOption[] = useMemo(() => {
    if (!graph) return [];
    const lmById = new Map<string, CampusLandmark>();
    for (const lm of graph.landmarks) {
      lmById.set(lm.id, lm);
    }

    const opts: SearchOption[] = [];

    for (const lm of orderedLandmarks) {
      opts.push({
        id: lm.id,
        name: formatLandmarkName(lm),
        fullName: lm.name,
        number: lm.number,
        kind: "building",
        landmarkId: lm.id,
      });
    }

    for (const bldg of indoorBuildings) {
      const parentLm = lmById.get(bldg.landmarkId || bldg.id);
      const bldgShort = parentLm ? formatLandmarkName(parentLm) : bldg.name;
      for (const node of bldg.nodes) {
        if (node.type === "room" && node.name) {
          opts.push({
            id: node.id,
            name: node.name,
            fullName: `${node.name} ${bldgShort}`,
            number: parentLm?.number,
            kind: "room",
            buildingName: bldgShort,
            landmarkId: parentLm?.id ?? bldg.id,
          });
        }
      }
    }

    return opts;
  }, [graph, orderedLandmarks, indoorBuildings]);

  const exploreLandmarks = useMemo(() => {
    if (exploreCategory === "all") return orderedLandmarks;
    return orderedLandmarks.filter(
      (lm) => lm.category.toLowerCase() === exploreCategory,
    );
  }, [orderedLandmarks, exploreCategory]);

  const focusLandmarkOnMap = (landmarkId?: string) => {
    if (!landmarkId || !graph) return;
    setSelectedLandmarkId(landmarkId);
    const lm = graph.landmarks.find((item) => item.id === landmarkId);
    if (lm) {
      const node = nodeById.get(lm.nodeId);
      if (node) {
        setCursorCoords({ lat: node.lat, lng: node.lng });
      }
    }
  };

  const handleLandmarkClickOnMap = (id: string, lm: CampusLandmark) => {
    setSelectedLandmarkId(id);
    const node = nodeById.get(lm.nodeId);
    if (node) {
      setCursorCoords({ lat: node.lat, lng: node.lng });
    }
    setToInput(formatLandmarkName(lm));
  };

  const handleSetDestination = (lm: CampusLandmark) => {
    const cleanName = formatLandmarkName(lm);
    setToInput(cleanName);
    focusLandmarkOnMap(lm.id);
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
    "--map-left-inset": dockCollapsed ? "0px" : "392px",
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
          <span className={styles.compassStamp}>
            <BrandLogo size={24} animated title="NavigateNED" />
          </span>
          <div className={styles.brandTitles}>
            <span className={styles.plateSerial}>
              NED UNIVERSITY // CAMPUS SURVEY PLATE
            </span>
            <h1 className={styles.appTitle}>NavigateNED</h1>
          </div>
        </div>

        <div className={styles.telemetryCluster}>
          <div className={styles.coordReadout} title="Active survey coordinates">
            <span className={styles.coordLabel}>COORDS</span>
            <span>
              {cursorCoords.lat.toFixed(4)}°N, {cursorCoords.lng.toFixed(4)}°E
            </span>
          </div>

          {graph ? (
            <Badge variant="teal" numeric>
              {graph.landmarks.length} BUILDINGS
            </Badge>
          ) : null}

          <div className={styles.headerActions}>
            <IconButton
              size="sm"
              variant={showGraph ? "primary" : "secondary"}
              aria-label="Toggle walkable network overlay"
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
              onLandmarkClick={handleLandmarkClickOnMap}
              onMapClick={(coords) => setCursorCoords(coords)}
            />
          ) : (
            <div className={styles.loadingOverlay}>
              {loadError ? (
                <Badge variant="hazard">{loadError}</Badge>
              ) : (
                <SurveyLoader label="CALIBRATING CAMPUS SURVEY PLATE" />
              )}
            </div>
          )}
        </div>

        {/* EDGE-ATTACHED LEFT PANEL (DESKTOP) / DRAGGABLE BOTTOM SHEET (PHONE) */}
        <aside
          aria-label="Campus navigation panel"
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
            aria-label={dockCollapsed ? "Expand panel" : "Collapse panel"}
            title={dockCollapsed ? "Expand panel" : "Collapse panel"}
            onClick={() => setDockCollapsed((c) => !c)}
          >
            {dockCollapsed ? (
              <ChevronRightIcon size={16} />
            ) : (
              <ChevronLeftIcon size={16} />
            )}
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

          {/* Top-level Mode Tabs + "Where to" Floating Dropdown Search */}
          <div className={styles.dockHeader}>
            <SegmentedControl
              fullWidth
              ariaLabel="Navigation mode"
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: "navigate",
                  label: "Navigate",
                  icon: <RouteIcon size={14} />,
                },
                {
                  value: "explore",
                  label: "Explore",
                  count: graph?.landmarks.length ?? 55,
                },
                {
                  value: "evacuate",
                  label: "Evacuate",
                  icon: <AssemblyPointIcon size={14} />,
                },
              ]}
            />

            <SearchField
              id="shell-where-to"
              label="Where to"
              placeholder="Search buildings or rooms..."
              value={whereToQuery}
              onChange={setWhereToQuery}
              options={searchOptions}
              onSelectOption={(opt) => {
                setWhereToQuery(opt.name);
                setToInput(opt.name);
                focusLandmarkOnMap(opt.landmarkId);
              }}
            />
          </div>

          {/* Main Scrollable Body with 3-Level Visual Hierarchy & Numbered Sections */}
          <div className={styles.dockScroll}>
            {mode === "navigate" ? (
              <>
                {/* 01 ROUTE */}
                <section className={styles.sectionCard} style={{ zIndex: 20 }}>
                  <SectionHeader number="01" title="ROUTE" />
                  <div className={styles.endpointGrid}>
                    <div className={styles.endpointFields}>
                      <Field
                        id="shell-from"
                        label="From"
                        placeholder="Choose starting point..."
                        value={fromInput}
                        onChange={(e) => setFromInput(e.target.value)}
                        options={searchOptions}
                        onSelectOption={(opt) => {
                          setFromInput(opt.name);
                          focusLandmarkOnMap(opt.landmarkId);
                        }}
                      />
                      <Field
                        id="shell-to"
                        label="To"
                        placeholder="Choose destination..."
                        value={toInput}
                        onChange={(e) => setToInput(e.target.value)}
                        options={searchOptions}
                        onSelectOption={(opt) => {
                          setToInput(opt.name);
                          focusLandmarkOnMap(opt.landmarkId);
                        }}
                      />
                    </div>
                    <IconButton
                      size="md"
                      aria-label="Swap starting point and destination"
                      title="Swap From and To"
                      onClick={handleSwapEndpoints}
                    >
                      <SwapIcon size={16} />
                    </IconButton>
                  </div>
                </section>

                {/* 02 ALGORITHM */}
                <section className={styles.sectionCard} style={{ zIndex: 15 }}>
                  <SectionHeader number="02" title="ALGORITHM" />
                  <SegmentedControl
                    fullWidth
                    ariaLabel="Routing algorithm"
                    value={algo}
                    onChange={setAlgo}
                    options={[
                      { value: "dijkstra", label: "Dijkstra" },
                      { value: "astar", label: "A*" },
                      { value: "bfs", label: "BFS" },
                      { value: "bellmanford", label: "Bellman" },
                    ]}
                  />
                </section>

                {/* 03 OPTIONS */}
                <section className={styles.sectionCard} style={{ zIndex: 12 }}>
                  <SectionHeader number="03" title="OPTIONS" />
                  <Toggle
                    id="shell-step-free"
                    checked={stepFree}
                    onChange={setStepFree}
                    leadingIcon={<AccessibilityIcon size={15} />}
                    label="Step-free route"
                    hint="Use ramps and lifts; avoid stairs"
                  />
                </section>

                {/* 04 SUMMARY */}
                <section className={styles.sectionCard} style={{ zIndex: 10 }}>
                  <SectionHeader number="04" title="SUMMARY" />
                  <div className={styles.readoutGrid}>
                    <StatReadout
                      size="sm"
                      label="Distance"
                      value={312.4}
                      decimals={1}
                      unit="m"
                      sublabel="Shortest path"
                      tone="vermilion"
                      icon={<DistanceIcon size={14} />}
                    />
                    <StatReadout
                      size="sm"
                      label="Walk time"
                      value={4}
                      unit="min"
                      sublabel={stepFree ? "Step-free pace" : "Standard pace"}
                      tone="teal"
                      icon={<RouteIcon size={14} />}
                    />
                    <StatReadout
                      size="sm"
                      label="Floors"
                      value={0}
                      unit="fl"
                      sublabel="Ground level"
                      tone="safe"
                      icon={<FloorIcon size={14} />}
                    />
                    <StatReadout
                      size="sm"
                      label="Visited"
                      value={42}
                      unit="nodes"
                      sublabel={`${algo.toUpperCase()} search`}
                      tone="neutral"
                      icon={<GraphIcon size={14} />}
                    />
                  </div>
                </section>

                {/* 05 LANDMARKS (Collapsible + Full-Height Scrollable List) */}
                <section
                  className={[
                    styles.sectionCard,
                    landmarksExpanded ? styles.sectionCardFill : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ zIndex: 5 }}
                >
                  <SectionHeader
                    number="05"
                    title="LANDMARKS"
                    rightSlot={
                      <button
                        type="button"
                        className={styles.sectionCollapseBtn}
                        onClick={() => setLandmarksExpanded((v) => !v)}
                        aria-expanded={landmarksExpanded}
                      >
                        <span>{landmarksExpanded ? "Hide" : "Show"}</span>
                        {landmarksExpanded ? (
                          <ChevronUpIcon size={12} />
                        ) : (
                          <ChevronDownIcon size={12} />
                        )}
                      </button>
                    }
                  />

                  {landmarksExpanded ? (
                    <div className={styles.landmarksScrollList}>
                      {orderedLandmarks.map((lm) => {
                        const cleanName = formatLandmarkName(lm);
                        const isSelected = selectedLandmarkId === lm.id;
                        const isDest = toInput === cleanName;
                        return (
                          <div
                            key={lm.id}
                            className={[
                              styles.landmarkItem,
                              isSelected ? styles.landmarkItemSelected : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <div className={styles.landmarkItemTop}>
                              <div className={styles.landmarkItemIdentity}>
                                {lm.number ? (
                                  <Badge variant="building">{lm.number}</Badge>
                                ) : (
                                  <Badge variant="neutral" numeric>
                                    --
                                  </Badge>
                                )}
                                <span
                                  className={styles.landmarkItemName}
                                  title={lm.name}
                                >
                                  {cleanName}
                                </span>
                              </div>
                              <span className={styles.landmarkItemCategory}>
                                {lm.category}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSetDestination(lm)}
                              className={[
                                styles.setDestBtn,
                                isDest ? styles.setDestBtnActive : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              <RouteIcon size={13} />
                              <span>
                                {isDest
                                  ? "Selected destination"
                                  : "Set as destination"}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}

            {mode === "explore" ? (
              <>
                <section className={styles.sectionCard}>
                  <SectionHeader number="01" title="FILTER" />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {[
                      { id: "all", label: "All", count: orderedLandmarks.length },
                      { id: "academic", label: "Academic" },
                      { id: "administration", label: "Admin" },
                      { id: "services", label: "Services" },
                      { id: "gate", label: "Gates" },
                    ].map((cat) => (
                      <Chip
                        key={cat.id}
                        label={cat.label}
                        count={cat.count}
                        active={exploreCategory === cat.id}
                        onClick={() => setExploreCategory(cat.id)}
                      />
                    ))}
                  </div>
                </section>

                <section
                  className={[styles.sectionCard, styles.sectionCardFill].join(" ")}
                >
                  <SectionHeader number="02" title="LANDMARKS" />
                  <div className={styles.landmarksScrollList} style={{ maxHeight: "420px" }}>
                    {exploreLandmarks.map((lm) => {
                      const cleanName = formatLandmarkName(lm);
                      const isSelected = selectedLandmarkId === lm.id;
                      const isDest = toInput === cleanName;
                      return (
                        <div
                          key={lm.id}
                          className={[
                            styles.landmarkItem,
                            isSelected ? styles.landmarkItemSelected : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <div className={styles.landmarkItemTop}>
                            <div className={styles.landmarkItemIdentity}>
                              {lm.number ? (
                                <Badge variant="building">{lm.number}</Badge>
                              ) : (
                                <Badge variant="neutral" numeric>
                                  --
                                </Badge>
                              )}
                              <span
                                className={styles.landmarkItemName}
                                title={lm.name}
                              >
                                {cleanName}
                              </span>
                            </div>
                            <span className={styles.landmarkItemCategory}>
                              {lm.category}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSetDestination(lm)}
                            className={[
                              styles.setDestBtn,
                              isDest ? styles.setDestBtnActive : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <RouteIcon size={13} />
                            <span>
                              {isDest
                                ? "Selected destination"
                                : "Set as destination"}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : null}

            {mode === "evacuate" ? (
              <>
                <section className={styles.sectionCard}>
                  <SectionHeader number="01" title="SUMMARY" />
                  <div className={styles.readoutGrid}>
                    <StatReadout
                      size="sm"
                      label="Assembly zones"
                      value={7}
                      unit="areas"
                      sublabel="Multi-source"
                      tone="safe"
                      icon={<AssemblyPointIcon size={14} />}
                    />
                    <StatReadout
                      size="sm"
                      label="Total capacity"
                      value={6800}
                      unit="people"
                      sublabel="Max-flow balanced"
                      tone="teal"
                      icon={<GraphIcon size={14} />}
                    />
                  </div>
                </section>

                <section className={styles.sectionCard}>
                  <SectionHeader number="02" title="OPTIONS" />
                  <Toggle
                    id="shell-evac-lifts"
                    checked={disableLifts}
                    onChange={setDisableLifts}
                    leadingIcon={<HazardIcon size={15} />}
                    label="Disable lifts"
                    hint="Use stairs only during emergency egress"
                  />
                </section>

                <section
                  className={[styles.sectionCard, styles.sectionCardFill].join(" ")}
                >
                  <SectionHeader number="03" title="ASSEMBLY POINTS" />
                  <div className={styles.landmarksScrollList}>
                    <ListRow
                      leading={<Badge variant="safe" numeric>01</Badge>}
                      title="Courtyard Fountain Plaza"
                      subtitle="Central campus muster zone"
                      trailing={<span>600 cap</span>}
                    />
                    <ListRow
                      leading={<Badge variant="safe" numeric>02</Badge>}
                      title="Soccer Field & Athletics Track"
                      subtitle="Primary open ground muster"
                      trailing={<span>1800 cap</span>}
                    />
                    <ListRow
                      leading={<Badge variant="safe" numeric>03</Badge>}
                      title="Main Gate Assembly Apron"
                      subtitle="University Road egress"
                      trailing={<span>900 cap</span>}
                    />
                  </div>
                </section>
              </>
            ) : null}
          </div>

          <footer className={styles.dockFooter}>
            <span>SURVEY PLATE // WGS84</span>
            <span>697 NODES READY</span>
          </footer>
        </aside>
      </div>
    </div>
  );
}
