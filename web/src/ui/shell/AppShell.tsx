"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
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
  computeRoute,
  ensureAllCampusDataLoaded,
  getDirections,
  INDOOR_BUILDING_IDS,
  type Maneuver,
  type ManeuverType,
  type NavAlgo,
  type RouteResponse,
} from "@/core/navcore";
import {
  AccessibilityIcon,
  AssemblyPointIcon,
  Badge,
  BrandLogo,
  BuildingIcon,
  Button,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  Chip,
  DistanceIcon,
  EntranceIcon,
  Field,
  FloorIcon,
  GraphIcon,
  HazardIcon,
  IconButton,
  LayersIcon,
  LiftIcon,
  ListRow,
  LocateIcon,
  RouteIcon,
  SearchField,
  type SearchOption,
  SegmentedControl,
  type SheetSnap,
  StairsIcon,
  StatReadout,
  SurveyLoader,
  SwapIcon,
  ThemeSwitch,
  Toggle,
} from "@/ui";
import { IndoorStage } from "./IndoorStage";
import { RouteCard } from "./RouteCard";
import { extractOutdoorPath, splitRouteIntoLegs } from "./routeLegs";
import styles from "./shell.module.css";

export type AppMode = "navigate" | "explore" | "evacuate";

const SNAP_ORDER: readonly SheetSnap[] = ["peek", "half", "expanded"];
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

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

function renderManeuverIcon(type: ManeuverType) {
  switch (type) {
    case "start":
      return <LocateIcon size={14} />;
    case "enter-building":
      return <EntranceIcon size={14} />;
    case "stairs-up":
    case "stairs-down":
      return <StairsIcon size={14} />;
    case "lift":
      return <LiftIcon size={14} />;
    case "slight-left":
    case "left":
    case "sharp-left":
      return <ChevronLeftIcon size={14} />;
    case "slight-right":
    case "right":
    case "sharp-right":
      return <ChevronRightIcon size={14} />;
    case "arrive":
      return <AssemblyPointIcon size={14} />;
    default:
      return <ChevronUpIcon size={14} />;
  }
}

interface SectionHeaderProps {
  number?: string;
  title: string;
  rightSlot?: ReactNode;
}

function SectionHeader({ title, rightSlot }: SectionHeaderProps) {
  return (
    <div className={styles.sectionHeader}>
      <span className={styles.sectionTitle}>{title}</span>
      {rightSlot}
    </div>
  );
}

export function AppShell() {
  const [graph, setGraph] = useState<CampusGraph | null>(null);
  const [indoorBuildings, setIndoorBuildings] = useState<
    Record<string, IndoorBuilding>
  >({});
  const [wasmReady, setWasmReady] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<AppMode>("navigate");
  const [algo, setAlgo] = useState<NavAlgo>("astar");
  const [stepFree, setStepFree] = useState<boolean>(false);
  const [disableLifts, setDisableLifts] = useState<boolean>(true);
  const [showGraph, setShowGraph] = useState<boolean>(false);

  const [whereToQuery, setWhereToQuery] = useState<string>("");
  const [fromInput, setFromInput] = useState<string>("Main Gate");
  const [toInput, setToInput] = useState<string>("Central Library");
  const [fromTargetId, setFromTargetId] = useState<string>("b-main-gate");
  const [toTargetId, setToTargetId] = useState<string>("b-library");

  const [routeResult, setRouteResult] = useState<RouteResponse | null>(null);
  const [maneuvers, setManeuvers] = useState<Maneuver[]>([]);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [indoorStepIndex, setIndoorStepIndex] = useState<number>(0);
  const [stepFocusActive, setStepFocusActive] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isRouting, setIsRouting] = useState<boolean>(false);

  const [activeIndoor, setActiveIndoor] = useState<{
    buildingId: string;
    route: string[];
    selectedRoomId?: string;
  } | null>(null);
  const [indoorLoadError, setIndoorLoadError] = useState<{
    buildingId: string;
    route: string[];
    selectedRoomId?: string;
    message: string;
  } | null>(null);
  const [indoorLoading, setIndoorLoading] = useState<boolean>(false);
  const [selectedSearchRoom, setSelectedSearchRoom] = useState<{
    buildingId: string;
    nodeId: string;
    label: string;
  } | null>(null);

  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | null>(
    "b-library",
  );
  const [exploreCategory, setExploreCategory] = useState<string>("all");
  const [landmarksExpanded, setLandmarksExpanded] = useState<boolean>(true);
  const [optionsOpen, setOptionsOpen] = useState<boolean>(false);

  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number }>({
    lat: 24.9325,
    lng: 67.1135,
  });

  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [mobileSnap, setMobileSnap] = useState<SheetSnap>("peek");
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureAllCampusDataLoaded()
      .then((loaded) => {
        if (cancelled) return;
        setGraph(loaded.graph);
        setIndoorBuildings(loaded.indoorBuildings);
        setWasmReady(true);
      })
      .catch((err) => {
        console.error("[NavigateNED] Failed to load campus data:", err);
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasIndoorData = useCallback(
    (buildingId?: string | null): boolean => {
      if (!buildingId) return false;
      return (
        Boolean(indoorBuildings[buildingId]) ||
        (INDOOR_BUILDING_IDS as readonly string[]).includes(buildingId)
      );
    },
    [indoorBuildings],
  );

  const openIndoorBuilding = useCallback(
    async (buildingId: string, route: string[], selectedRoomId?: string) => {
      setIndoorLoadError(null);
      if (indoorBuildings[buildingId]) {
        setIndoorStepIndex(0);
        setActiveIndoor({ buildingId, route, selectedRoomId });
        setMobileSnap("peek");
        return;
      }

      setIndoorLoading(true);
      try {
        const res = await fetch(`/data/indoor/${buildingId}.json`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} loading /data/indoor/${buildingId}.json`);
        }
        const bldg = (await res.json()) as IndoorBuilding;
        setIndoorBuildings((prev) => ({ ...prev, [buildingId]: bldg }));
        setIndoorStepIndex(0);
        setActiveIndoor({ buildingId, route, selectedRoomId });
        setMobileSnap("peek");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[NavigateNED] Failed to load indoor map for ${buildingId}:`,
          err,
        );
        setIndoorLoadError({
          buildingId,
          route,
          selectedRoomId,
          message: `Could not load indoor map (${msg}).`,
        });
      } finally {
        setIndoorLoading(false);
      }
    },
    [indoorBuildings],
  );

  const runNavigation = useCallback(
    async (
      fromId: string,
      toId: string,
      selectedAlgo: NavAlgo,
      accessible: boolean,
    ) => {
      if (!wasmReady || !fromId || !toId) return;
      setIsRouting(true);
      setRouteError(null);
      try {
        const res = await computeRoute({
          from: fromId,
          to: toId,
          algo: selectedAlgo,
          accessible,
        });
        setRouteResult(res);
        setActiveStepIndex(0);
        setStepFocusActive(false);
        if (res.found) {
          const dirRes = await getDirections({ route: res });
          setManeuvers(dirRes.maneuvers ?? []);
          if (typeof window !== "undefined" && window.innerWidth <= 768) {
            setMobileSnap("peek");
          }
        } else {
          setManeuvers([]);
          setRouteError(res.error ?? "No valid path found for the selected options.");
        }
      } catch (err) {
        setRouteError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsRouting(false);
      }
    },
    [wasmReady],
  );

  useEffect(() => {
    if (wasmReady && fromTargetId && toTargetId) {
      void runNavigation(fromTargetId, toTargetId, algo, stepFree);
    }
  }, [wasmReady, fromTargetId, toTargetId, algo, stepFree, runNavigation]);

  const nodeById = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    if (!graph) return map;
    for (const n of graph.nodes) {
      map.set(n.id, { lat: n.lat, lng: n.lng });
    }
    return map;
  }, [graph]);

  const orderedLandmarks = useMemo(() => {
    if (!graph) return [];
    return [...graph.landmarks].sort(compareLandmarksByNumber);
  }, [graph]);

  const displayNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const lm of orderedLandmarks) {
      map[lm.id] = formatLandmarkName(lm);
    }
    return map;
  }, [orderedLandmarks]);

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

    for (const bldg of Object.values(indoorBuildings)) {
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
    const q = whereToQuery.trim().toLowerCase();
    return orderedLandmarks.filter((lm) => {
      if (
        exploreCategory !== "all" &&
        lm.category.toLowerCase() !== exploreCategory
      ) {
        return false;
      }
      if (!q) return true;
      return (
        formatLandmarkName(lm).toLowerCase().includes(q) ||
        lm.name.toLowerCase().includes(q) ||
        (lm.number ?? "").toLowerCase().includes(q)
      );
    });
  }, [orderedLandmarks, exploreCategory, whereToQuery]);

  const selectedExploreLandmark = useMemo(() => {
    if (!selectedLandmarkId) return orderedLandmarks[0] ?? null;
    return (
      orderedLandmarks.find((lm) => lm.id === selectedLandmarkId) ??
      orderedLandmarks[0] ??
      null
    );
  }, [orderedLandmarks, selectedLandmarkId]);

  const outdoorRoutePath = useMemo(
    () => (routeResult?.found ? extractOutdoorPath(routeResult.path) : []),
    [routeResult],
  );

  const routeLegs = useMemo(
    () =>
      routeResult?.found
        ? splitRouteIntoLegs(
            routeResult.path,
            indoorBuildings,
            displayNamesById,
          )
        : [],
    [routeResult, indoorBuildings, displayNamesById],
  );

  const indoorFloorCount = useMemo(() => {
    if (!routeResult?.found) return 0;
    const floors = new Set<string>();
    for (const id of routeResult.path) {
      const colon = id.indexOf(":");
      if (colon <= 0) continue;
      const bid = id.slice(0, colon);
      const node = indoorBuildings[bid]?.nodes.find((n) => n.id === id);
      if (node) floors.add(`${bid}:${node.floor}`);
    }
    return floors.size;
  }, [routeResult, indoorBuildings]);

  const activeManeuverForMap = useMemo(() => {
    if (!stepFocusActive || activeIndoor || maneuvers.length === 0) return null;
    const m = maneuvers[Math.max(0, Math.min(maneuvers.length - 1, activeStepIndex))];
    if (!m) return null;
    return { lat: m.lat, lng: m.lng, type: m.type, text: m.text };
  }, [stepFocusActive, activeIndoor, maneuvers, activeStepIndex]);

  const activeLegPathForMap = useMemo(() => {
    if (!stepFocusActive || activeIndoor || maneuvers.length === 0 || outdoorRoutePath.length < 2) {
      return undefined;
    }
    const idx = Math.max(0, Math.min(maneuvers.length - 1, activeStepIndex));
    const cur = maneuvers[idx];
    const next = maneuvers[idx + 1];
    const startIdx = outdoorRoutePath.indexOf(cur.atNodeId);
    if (startIdx < 0) return undefined;
    const endIdx = next ? outdoorRoutePath.indexOf(next.atNodeId, startIdx) : -1;
    if (endIdx > startIdx) {
      return outdoorRoutePath.slice(startIdx, endIdx + 1);
    }
    return outdoorRoutePath.slice(startIdx);
  }, [stepFocusActive, activeIndoor, maneuvers, activeStepIndex, outdoorRoutePath]);

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
    setToTargetId(lm.id);
  };

  const handleSetDestination = (lm: CampusLandmark) => {
    const cleanName = formatLandmarkName(lm);
    setToInput(cleanName);
    setToTargetId(lm.id);
    focusLandmarkOnMap(lm.id);
  };

  const handleSwapEndpoints = () => {
    setFromInput(toInput);
    setToInput(fromInput);
    setFromTargetId(toTargetId);
    setToTargetId(fromTargetId);
  };

  const cycleMobileSnap = (dir: 1 | -1) => {
    const idx = SNAP_ORDER.indexOf(mobileSnap);
    const nextIdx = Math.max(0, Math.min(SNAP_ORDER.length - 1, idx + dir));
    setMobileSnap(SNAP_ORDER[nextIdx]);
  };

  const handleGrabPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    dragStartYRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleGrabPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    dragStartYRef.current = null;
    if (dy < -28) {
      cycleMobileSnap(1);
    } else if (dy > 28) {
      cycleMobileSnap(-1);
    } else {
      const nextIdx = (SNAP_ORDER.indexOf(mobileSnap) + 1) % SNAP_ORDER.length;
      setMobileSnap(SNAP_ORDER[nextIdx]);
    }
  };

  const mobileBottomInset =
    mobileSnap === "peek"
      ? "168px"
      : mobileSnap === "expanded"
        ? "calc(100dvh - 54px)"
        : "52vh";

  const mapStageStyle = {
    "--map-left-inset": dockCollapsed ? "0px" : "392px",
    "--map-bottom-inset": mobileBottomInset,
  } as CSSProperties;

  const mobileSnapClass =
    mobileSnap === "peek"
      ? styles.mobileSnapPeek
      : mobileSnap === "expanded"
        ? styles.mobileSnapExpanded
        : styles.mobileSnapHalf;

  const activeIndoorBuilding = activeIndoor
    ? indoorBuildings[activeIndoor.buildingId]
    : undefined;

  return (
    <div className={styles.shellRoot}>
      {/* HEADER STRIP */}
      <header className={styles.titleBlock}>
        <div className={styles.brandCluster}>
          <span className={styles.compassStamp}>
            <BrandLogo size={24} animated title="NavigateNED" />
          </span>
          <h1 className={styles.appTitle}>NavigateNED</h1>
        </div>

        <div className={styles.telemetryCluster}>
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
            <Link
              href="/kit"
              className={styles.kitLinkBtn}
              aria-label="Open UI Kit"
              title="UI Kit"
            >
              <LayersIcon size={15} />
              <span className={styles.kitLinkLabel}>UI Kit</span>
            </Link>
          </div>
        </div>

      </header>

      {/* FULL-BLEED MAP STAGE + EDGE-ATTACHED PANEL / MOBILE SHEET */}
      <div
        className={styles.mapStage}
        style={mapStageStyle}
        data-sheet-snap={mobileSnap}
      >
        <div className={styles.mapCanvas}>
          {graph ? (
            <div className={styles.outdoorWrap}>
              <OutdoorMap
                graph={graph}
                route={outdoorRoutePath}
                activeManeuver={activeManeuverForMap}
                activeLegPath={activeLegPathForMap}
                showGraph={showGraph}
                selectedLandmarkId={selectedLandmarkId}
                onLandmarkClick={handleLandmarkClickOnMap}
                onMapClick={(coords) => setCursorCoords(coords)}
              />
            </div>
          ) : (
            <div className={styles.loadingOverlay}>
              {loadError ? (
                <Badge variant="hazard">{loadError}</Badge>
              ) : (
                <SurveyLoader label="CALIBRATING WASM & CAMPUS PLATE" />
              )}
            </div>
          )}

          {(() => {
            if (!routeResult?.found || maneuvers.length === 0) return null;
            const indoorManeuvers = activeIndoor
              ? maneuvers.filter((m) =>
                  m.atNodeId.startsWith(`${activeIndoor.buildingId}:`),
                )
              : [];
            const displayedManeuvers = activeIndoor
              ? indoorManeuvers
              : maneuvers;
            if (displayedManeuvers.length === 0) return null;
            const currentIdx = activeIndoor ? indoorStepIndex : activeStepIndex;
            return (
              <RouteCard
                fromLabel={fromInput || "Origin"}
                toLabel={toInput || "Destination"}
                distanceM={routeResult.distance}
                algo={algo}
                maneuvers={displayedManeuvers}
                activeStepIndex={currentIdx}
                isIndoorMode={Boolean(activeIndoor)}
                onStepChange={(idx) => {
                  if (activeIndoor) {
                    setIndoorStepIndex(idx);
                  } else {
                    setActiveStepIndex(idx);
                    setStepFocusActive(true);
                  }
                }}
                onEnterBuilding={(bid) => {
                  const leg = routeLegs.find(
                    (l) => l.kind === "indoor" && l.buildingId === bid,
                  );
                  void openIndoorBuilding(
                    bid,
                    leg?.nodeIds ?? [],
                    toTargetId.includes(":") ? toTargetId : undefined,
                  );
                }}
                indoorLoading={indoorLoading}
                sheetSnap={mobileSnap}
              />
            );
          })()}

          {activeIndoor && activeIndoorBuilding ? (
            <IndoorStage
              building={activeIndoorBuilding}
              buildingDisplayName={
                displayNamesById[activeIndoorBuilding.id] ??
                activeIndoorBuilding.name
              }
              route={activeIndoor.route}
              initialSelectedRoomId={activeIndoor.selectedRoomId}
              activeStepNodeId={
                maneuvers.filter((m) =>
                  m.atNodeId.startsWith(`${activeIndoor.buildingId}:`),
                )[indoorStepIndex]?.atNodeId ?? null
              }
              onBackToCampus={() => setActiveIndoor(null)}
              onSetOriginFromRoom={(nodeId, label) => {
                setFromTargetId(nodeId);
                setFromInput(label);
                setActiveIndoor(null);
                setMode("navigate");
              }}
            />
          ) : null}
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

          <button
            type="button"
            className={styles.mobileGrabHeader}
            aria-label={`Survey sheet (${mobileSnap}). Drag or tap to resize`}
            onPointerDown={handleGrabPointerDown}
            onPointerUp={handleGrabPointerUp}
          >
            <span className={styles.mobileGrabPill} aria-hidden="true" />
            <span className={styles.mobileSnapStatus}>
              SURVEY SHEET // {mobileSnap.toUpperCase()}
            </span>
          </button>

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
                setToTargetId(opt.id);
                focusLandmarkOnMap(opt.landmarkId);
                if (opt.id.includes(":")) {
                  const bid = opt.id.slice(0, opt.id.indexOf(":"));
                  setSelectedSearchRoom({
                    buildingId: bid,
                    nodeId: opt.id,
                    label: opt.name,
                  });
                } else {
                  setSelectedSearchRoom(null);
                }
              }}
            />
            {selectedSearchRoom && hasIndoorData(selectedSearchRoom.buildingId) ? (
              <div className={styles.searchRoomQuickBar}>
                <span className={styles.searchRoomLabel}>
                  Room: {selectedSearchRoom.label}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={indoorLoading}
                  leadingIcon={<BuildingIcon size={13} />}
                  onClick={() =>
                    void openIndoorBuilding(
                      selectedSearchRoom.buildingId,
                      [],
                      selectedSearchRoom.nodeId,
                    )
                  }
                >
                  Show in indoor map
                </Button>
              </div>
            ) : null}
          </div>

          <div className={styles.dockScroll}>
            {mode === "navigate" ? (
              <>
                {/* 01 ROUTE */}
                <section className={styles.sectionCard} style={{ zIndex: 20 }}>
                  <SectionHeader title="Route" />
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
                          setFromTargetId(opt.id);
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
                          setToTargetId(opt.id);
                          focusLandmarkOnMap(opt.landmarkId);
                          if (opt.id.includes(":")) {
                            const bid = opt.id.slice(0, opt.id.indexOf(":"));
                            setSelectedSearchRoom({
                              buildingId: bid,
                              nodeId: opt.id,
                              label: opt.name,
                            });
                          } else {
                            setSelectedSearchRoom(null);
                          }
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
                  <Button
                    variant="primary"
                    size="sm"
                    chamfer
                    loading={isRouting}
                    leadingIcon={<RouteIcon size={14} />}
                    onClick={() =>
                      void runNavigation(fromTargetId, toTargetId, algo, stepFree)
                    }
                  >
                    Compute route
                  </Button>
                </section>

                {/* 02 OPTIONS (Collapsed-by-default accordion: Algorithm + Step-free) */}
                <section className={styles.sectionCard} style={{ zIndex: 15 }}>
                  <SectionHeader
                    title="Options"
                    rightSlot={
                      <button
                        type="button"
                        className={styles.sectionToggleBtn}
                        aria-expanded={optionsOpen}
                        onClick={() => setOptionsOpen((v) => !v)}
                      >
                        <span>
                          {algo.toUpperCase()} · {stepFree ? "Step-free" : "Standard"}
                        </span>
                        {optionsOpen ? (
                          <ChevronUpIcon size={14} />
                        ) : (
                          <ChevronDownIcon size={14} />
                        )}
                      </button>
                    }
                  />
                  {optionsOpen ? (
                    <>
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
                          { value: "floyd", label: "Floyd" },
                        ]}
                      />
                      <Toggle
                        id="shell-step-free"
                        checked={stepFree}
                        onChange={setStepFree}
                        leadingIcon={<AccessibilityIcon size={15} />}
                        label="Step-free route"
                        hint="Avoids stairs"
                      />
                    </>
                  ) : null}
                </section>

                {/* SUMMARY & ROUTE LEGS */}
                <section className={styles.sectionCard} style={{ zIndex: 10 }}>
                  <SectionHeader title="Summary" />
                  {routeError ? (
                    <Badge variant="hazard">{routeError}</Badge>
                  ) : null}
                  <div className={styles.readoutGrid}>
                    <StatReadout
                      size="sm"
                      label="Distance"
                      value={routeResult?.found ? routeResult.distance : 0}
                      decimals={1}
                      unit="m"
                      tone="vermilion"
                      icon={<DistanceIcon size={14} />}
                    />
                    <StatReadout
                      size="sm"
                      label="Walk time"
                      value={
                        routeResult?.found
                          ? Math.max(1, Math.round(routeResult.distance / 78))
                          : 0
                      }
                      unit="min"
                      tone="teal"
                      icon={<RouteIcon size={14} />}
                    />
                    {indoorFloorCount > 1 ? (
                      <StatReadout
                        size="sm"
                        label="Floors"
                        value={indoorFloorCount}
                        unit="fl"
                        tone="safe"
                        icon={<FloorIcon size={14} />}
                      />
                    ) : null}
                  </div>

                  {routeLegs.length > 0 ? (
                    <div className={styles.legList}>
                      {routeLegs.map((leg, idx) => (
                        <div key={`${leg.kind}-${leg.buildingId ?? idx}`} className={styles.legCard}>
                          <div className={styles.legMeta}>
                            <span className={styles.legTitle}>
                              {leg.kind === "outdoor"
                                ? "Campus walkways"
                                : leg.buildingName}
                            </span>
                            <span className={styles.legSub}>
                              {leg.nodeIds.length} nodes
                            </span>
                          </div>
                          {leg.kind === "indoor" && leg.buildingId ? (
                            <Button
                              size="sm"
                              variant="primary"
                              chamfer
                              loading={indoorLoading}
                              leadingIcon={<BuildingIcon size={14} />}
                              onClick={() =>
                                void openIndoorBuilding(leg.buildingId!, leg.nodeIds)
                              }
                            >
                              Enter {leg.buildingName}?
                            </Button>
                          ) : (
                            <Badge variant="teal" numeric>
                              OUTDOOR
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {(() => {
                    const destBuildingId = toTargetId.includes(":")
                      ? toTargetId.slice(0, toTargetId.indexOf(":"))
                      : toTargetId;
                    if (!hasIndoorData(destBuildingId)) return null;
                    const indoorLeg = routeLegs.find(
                      (l) => l.kind === "indoor" && l.buildingId === destBuildingId,
                    );
                    const targetRoom = toTargetId.includes(":")
                      ? toTargetId
                      : undefined;
                    return (
                      <div className={styles.indoorAvailRow}>
                        <Badge variant="teal">Indoor map available</Badge>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={indoorLoading}
                          leadingIcon={<BuildingIcon size={14} />}
                          onClick={() =>
                            void openIndoorBuilding(
                              destBuildingId,
                              indoorLeg?.nodeIds ?? [],
                              targetRoom,
                            )
                          }
                        >
                          Open indoor map
                        </Button>
                      </div>
                    );
                  })()}

                  {indoorLoadError ? (
                    <div className={styles.indoorErrorBox} role="alert">
                      <span>{indoorLoadError.message}</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void openIndoorBuilding(
                            indoorLoadError.buildingId,
                            indoorLoadError.route,
                            indoorLoadError.selectedRoomId,
                          )
                        }
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}
                </section>

                {/* 04 LANDMARKS */}
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
                    title="Landmarks"
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
                        const isDest = toTargetId === lm.id;
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
                  <SectionHeader title="Filter" />
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

                {selectedExploreLandmark ? (
                  <section className={styles.sectionCard}>
                    <SectionHeader title="Details" />
                    <div className={styles.landmarkItemTop}>
                      <div className={styles.landmarkItemIdentity}>
                        {selectedExploreLandmark.number ? (
                          <Badge variant="building">
                            {selectedExploreLandmark.number}
                          </Badge>
                        ) : null}
                        <span className={styles.landmarkItemName}>
                          {selectedExploreLandmark.name}
                        </span>
                      </div>
                      <Badge variant="neutral">
                        {selectedExploreLandmark.category}
                      </Badge>
                    </div>
                    {indoorBuildings[selectedExploreLandmark.id] ? (
                      <span className={styles.legSub}>
                        {indoorBuildings[selectedExploreLandmark.id].floors.length}{" "}
                        FLOORS //{" "}
                        {
                          indoorBuildings[selectedExploreLandmark.id].rooms
                            .length
                        }{" "}
                        ROOMS INDOOR
                      </span>
                    ) : null}
                    <div className={styles.exploreActionsRow}>
                      <Button
                        size="sm"
                        variant="primary"
                        chamfer
                        leadingIcon={<RouteIcon size={14} />}
                        onClick={() => {
                          handleSetDestination(selectedExploreLandmark);
                          setMode("navigate");
                        }}
                      >
                        Directions to here
                      </Button>
                      {hasIndoorData(selectedExploreLandmark.id) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={indoorLoading}
                          leadingIcon={<BuildingIcon size={14} />}
                          onClick={() =>
                            void openIndoorBuilding(selectedExploreLandmark.id, [])
                          }
                        >
                          Open indoor map
                        </Button>
                      ) : null}
                    </div>
                    {indoorLoadError ? (
                      <div className={styles.indoorErrorBox} role="alert">
                        <span>{indoorLoadError.message}</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void openIndoorBuilding(
                              indoorLoadError.buildingId,
                              indoorLoadError.route,
                              indoorLoadError.selectedRoomId,
                            )
                          }
                        >
                          Retry
                        </Button>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section
                  className={[styles.sectionCard, styles.sectionCardFill].join(" ")}
                >
                  <SectionHeader title="Landmarks" />
                  <div
                    className={styles.landmarksScrollList}
                    style={{ maxHeight: "360px" }}
                  >
                    {exploreLandmarks.map((lm) => {
                      const cleanName = formatLandmarkName(lm);
                      const isSelected = selectedLandmarkId === lm.id;
                      const hasIndoor = Boolean(indoorBuildings[lm.id]);
                      return (
                        <ListRow
                          key={lm.id}
                          selected={isSelected}
                          onClick={() => focusLandmarkOnMap(lm.id)}
                          leading={
                            lm.number ? (
                              <Badge variant="building">{lm.number}</Badge>
                            ) : (
                              <Badge variant="neutral" numeric>
                                --
                              </Badge>
                            )
                          }
                          title={cleanName}
                          subtitle={
                            hasIndoor
                              ? `${lm.category} · Indoor map`
                              : lm.category
                          }
                          trailing={hasIndoor ? <span>INDOOR</span> : undefined}
                        />
                      );
                    })}
                  </div>
                </section>
              </>
            ) : null}

            {mode === "evacuate" ? (
              <>
                <section className={styles.sectionCard}>
                  <SectionHeader title="Summary" />
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
                  <SectionHeader title="Options" />
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
                  <SectionHeader title="Assembly Points" />
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
        </aside>
      </div>
    </div>
  );
}
