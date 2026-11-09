"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import "@/map/map.css";
import type {
  BasemapMode,
  CampusLandmark,
  OutdoorMapProps,
  OutdoorNode,
} from "./types";

const DEFAULT_WARPED_BOUNDS: [[number, number], [number, number]] = [
  [24.92677, 67.10644],
  [24.93788, 67.11837],
];

const DEFAULT_MAX_BOUNDS: [[number, number], [number, number]] = [
  [24.9255, 67.1045],
  [24.9395, 67.1215],
];

const MAJOR_LANDMARK_IDS = new Set([
  "b-csit",
  "b-csit-labs",
  "b-library",
  "b-admin",
  "b-dean-offices",
  "b-auditorium",
  "b-civil-engg",
  "b-mechanical-engg",
  "b-electrical-engg",
  "b-cis-engg",
  "b-electronic-engg",
  "b-chemical-engg",
  "b-textile-engg",
  "b-petroleum-engg",
  "b-main-masjid",
  "b-cricket-ground",
  "b-soccer-field",
  "b-main-gate",
  "b-bank-gate",
  "b-food-centre",
  "b-admission-centre",
]);

const TIER1_ADMIN_LIBRARY_IDS = new Set([
  "b-library",
  "b-admin",
  "b-dean-offices",
  "b-auditorium",
  "b-main-masjid",
  "b-csit",
  "b-admission-centre",
]);

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function getLandmarkPriority(
  lm: CampusLandmark,
  selectedLandmarkId: string | null | undefined,
  hoveredLandmarkId: string | null,
  activeRouteNodes: Set<string>
): number {
  if (
    lm.id === selectedLandmarkId ||
    lm.id === hoveredLandmarkId ||
    activeRouteNodes.has(lm.nodeId)
  ) {
    return 100;
  }
  if (
    lm.category === "gate" ||
    lm.id === "b-main-gate" ||
    lm.id === "b-bank-gate" ||
    lm.id === "b-cricket-ground" ||
    lm.id === "b-soccer-field"
  ) {
    return 90;
  }
  if (TIER1_ADMIN_LIBRARY_IDS.has(lm.id)) {
    return 78;
  }
  if (MAJOR_LANDMARK_IDS.has(lm.id) || lm.category === "academic") {
    return 58;
  }
  return 35;
}

function getLandmarkLabelText(
  lm: CampusLandmark,
  zoom: number,
  isFocused: boolean
): string {
  if (zoom >= 19 || (zoom >= 18 && isFocused)) {
    return lm.name;
  }
  if (zoom <= 16 && !isFocused) {
    const codeMatch = lm.short.match(/\(([0-9A-Za-z-]+)\)$/);
    if (codeMatch) return codeMatch[1];
  }
  return lm.short;
}

function getPolygonCenter(ring: [number, number][]): [number, number] {
  if (!ring || ring.length === 0) return [24.9322, 67.1133];
  let latSum = 0;
  let lngSum = 0;
  for (const [lat, lng] of ring) {
    latSum += lat;
    lngSum += lng;
  }
  return [latSum / ring.length, lngSum / ring.length];
}

function resolveMapVar(
  el: HTMLElement | null,
  varName: string,
  fallback: string
): string {
  if (!el || typeof window === "undefined") return fallback;
  const val = window.getComputedStyle(el).getPropertyValue(varName).trim();
  return val || fallback;
}

export function OutdoorMap({
  graph,
  route,
  highlightedNodeIds,
  selectedLandmarkId = null,
  onLandmarkClick,
  onMapClick,
  showGraph = false,
  userLocation = null,
  evacuation = null,
  trace = null,
}: OutdoorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const canvasRendererRef = useRef<any>(null);
  const svgRendererRef = useRef<any>(null);

  const streetTileLayerRef = useRef<any>(null);
  const satelliteTileLayerRef = useRef<any>(null);
  const masterPlanLayerRef = useRef<any>(null);

  const graphLayerRef = useRef<any>(null);
  const footprintLayerRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const labelLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const highlightLayerRef = useRef<any>(null);
  const userLayerRef = useRef<any>(null);
  const evacLayerRef = useRef<any>(null);
  const traceLayerRef = useRef<any>(null);

  const [isReady, setIsReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(17);
  const [hoveredLandmarkId, setHoveredLandmarkId] = useState<string | null>(null);
  const [basemapMode, setBasemapMode] = useState<BasemapMode>("street");
  const [showMasterPlan, setShowMasterPlan] = useState(false);
  const [masterPlanOpacity, setMasterPlanOpacity] = useState(0.8);

  const labelItemsRef = useRef<
    Array<{ lm: CampusLandmark; center: [number, number]; el: HTMLDivElement }>
  >([]);
  const fixedBadgesRef = useRef<
    Array<{ lat: number; lng: number; w: number; h: number }>
  >([]);

  const onLandmarkClickRef = useRef(onLandmarkClick);
  onLandmarkClickRef.current = onLandmarkClick;

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  // 1. Initialize Leaflet on client only + Basemaps
  useEffect(() => {
    let cancelled = false;

    async function initLeaflet() {
      if (!containerRef.current || mapRef.current) return;

      const LModule = await import("leaflet");
      const L = LModule.default || LModule;
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;

      const origin: [number, number] = [24.93165, 67.11315];
      const isCompact = containerRef.current.clientWidth > 0 && containerRef.current.clientWidth < 560;
      const initialZoom = isCompact ? 16 : 17;
      setZoomLevel(initialZoom);

      const map = L.map(containerRef.current, {
        center: origin,
        zoom: initialZoom,
        minZoom: 15,
        maxZoom: 20,
        maxBounds: DEFAULT_MAX_BOUNDS,
        maxBoundsViscosity: 0.9,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: false,
      });

      mapRef.current = map;

      // Basemap 1 (Default): Clear light street/ground map (OpenStreetMap)
      const streetTiles = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 20,
          maxNativeZoom: 19,
        }
      );

      // Basemap 2: Satellite (Esri World Imagery)
      const satelliteTiles = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 20,
          maxNativeZoom: 19,
        }
      );

      streetTileLayerRef.current = streetTiles;
      satelliteTileLayerRef.current = satelliteTiles;
      streetTiles.addTo(map);

      canvasRendererRef.current = L.canvas({ padding: 0.5 }).addTo(map);
      svgRendererRef.current = L.svg({ padding: 0.5 }).addTo(map);

      // North-Up Georeferenced Master-Plan Image Overlay via standard L.imageOverlay
      const warpedUrl =
        graph?.meta?.warpedOverlay?.image || "/map/ned_master_plan_warped.webp";
      const warpedBounds: [[number, number], [number, number]] =
        graph?.meta?.warpedOverlay?.bounds || DEFAULT_WARPED_BOUNDS;

      masterPlanLayerRef.current = L.imageOverlay(warpedUrl, warpedBounds, {
        opacity: 0.8,
        interactive: false,
      });

      graphLayerRef.current = L.layerGroup().addTo(map);
      footprintLayerRef.current = L.layerGroup().addTo(map);
      evacLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      traceLayerRef.current = L.layerGroup().addTo(map);
      highlightLayerRef.current = L.layerGroup().addTo(map);
      userLayerRef.current = L.layerGroup().addTo(map);
      markerLayerRef.current = L.layerGroup().addTo(map);
      labelLayerRef.current = L.layerGroup().addTo(map);

      map.on("zoomend", () => {
        setZoomLevel(map.getZoom());
      });

      map.on("click", (e: any) => {
        if (onMapClickRef.current && e?.latlng) {
          onMapClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
      });

      setIsReady(true);
      requestAnimationFrame(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
        }
      });
    }

    initLeaflet();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
        }
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      cancelled = true;
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Layer (a): Walkway graph thin edges on Canvas renderer
  useEffect(() => {
    const L = leafletRef.current;
    const group = graphLayerRef.current;
    const renderer = canvasRendererRef.current;
    if (!isReady || !L || !group || !renderer || !graph) return;

    group.clearLayers();
    if (!showGraph) return;

    const rootEl = containerRef.current;
    const walkwayColor = resolveMapVar(rootEl, "--map-edge-walkway", "#6b8276");
    const coveredColor = resolveMapVar(rootEl, "--map-edge-covered", "#3d6352");
    const nodeFill = resolveMapVar(rootEl, "--map-text-inverse", "#f7faf8");
    const nodeStroke = resolveMapVar(rootEl, "--map-border-strong", "#5c7468");

    const nodeLookup = new Map<string, OutdoorNode>();
    for (const n of graph.nodes) {
      nodeLookup.set(n.id, n);
    }

    for (const edge of graph.edges) {
      const na = nodeLookup.get(edge.a);
      const nb = nodeLookup.get(edge.b);
      if (!na || !nb) continue;

      L.polyline(
        [
          [na.lat, na.lng],
          [nb.lat, nb.lng],
        ],
        {
          renderer,
          color: edge.covered ? coveredColor : walkwayColor,
          weight: edge.covered ? 2.4 : 1.7,
          opacity: 0.78,
          dashArray: edge.covered ? undefined : "4 3",
          interactive: false,
        }
      ).addTo(group);
    }

    for (const n of graph.nodes) {
      if (n.kind === "path") {
        L.circleMarker([n.lat, n.lng], {
          renderer,
          radius: 2.2,
          color: nodeStroke,
          fillColor: nodeFill,
          fillOpacity: 0.9,
          weight: 1,
          interactive: false,
        }).addTo(group);
      }
    }
  }, [isReady, graph, showGraph]);

  // 3a. Layer (b): Landmark Footprints on Canvas Renderer (smooth native zoom animation)
  useEffect(() => {
    const L = leafletRef.current;
    const fpGroup = footprintLayerRef.current;
    const canvasRenderer = canvasRendererRef.current;
    if (!isReady || !L || !fpGroup || !canvasRenderer || !graph) return;

    fpGroup.clearLayers();
    const rootEl = containerRef.current;

    const strokeNormal = resolveMapVar(rootEl, "--map-landmark-stroke", "#185a44");
    const fillNormal = resolveMapVar(rootEl, "--map-landmark-fill", "#185a44");
    const strokeHover = resolveMapVar(rootEl, "--map-landmark-hover-stroke", "#0d3d2d");
    const fillHover = resolveMapVar(rootEl, "--map-landmark-hover-fill", "#0d3d2d");
    const strokeSel = resolveMapVar(rootEl, "--map-landmark-selected-stroke", "#b85d19");
    const fillSel = resolveMapVar(rootEl, "--map-landmark-selected-fill", "#d97706");

    for (const lm of graph.landmarks) {
      if (!lm.footprint || lm.footprint.length < 3) continue;
      const isSelected = selectedLandmarkId === lm.id;

      const baseStyle = {
        renderer: canvasRenderer,
        color: isSelected ? strokeSel : strokeNormal,
        weight: isSelected ? 2.5 : 1.6,
        fillColor: isSelected ? fillSel : fillNormal,
        fillOpacity: isSelected ? 0.36 : 0.2,
      };

      const poly = L.polygon(lm.footprint, baseStyle);

      poly.on("mouseover", () => {
        setHoveredLandmarkId(lm.id);
        if (selectedLandmarkId !== lm.id) {
          poly.setStyle({
            weight: 2.3,
            fillColor: fillHover,
            fillOpacity: 0.34,
            color: strokeHover,
          });
        }
      });

      poly.on("mouseout", () => {
        setHoveredLandmarkId((prev) => (prev === lm.id ? null : prev));
        poly.setStyle(baseStyle);
      });

      poly.on("click", (ev: any) => {
        L.DomEvent.stopPropagation(ev);
        if (onLandmarkClickRef.current) {
          onLandmarkClickRef.current(lm.id, lm);
        }
      });

      poly.addTo(fpGroup);
    }
  }, [isReady, graph, selectedLandmarkId]);

  // 3b. Layer (c): Merged Gate Markers & Deduplicated Assembly Area Markers (created once, not recreated on zoom)
  useEffect(() => {
    const L = leafletRef.current;
    const mkGroup = markerLayerRef.current;
    if (!isReady || !L || !mkGroup || !graph) return;

    mkGroup.clearLayers();
    const fixedBadges: Array<{ lat: number; lng: number; w: number; h: number }> = [];

    // Active evacuation target assembly node IDs (to highlight assigned assembly areas without stacking duplicate SAFE markers)
    const assignedAssemblyNodeIds = new Set<string>();
    if (evacuation?.assignments) {
      for (const a of evacuation.assignments) {
        if (a.path && a.path.length > 0) {
          assignedAssemblyNodeIds.add(a.path[a.path.length - 1]);
        }
      }
    }

    // Merge nearby gate nodes (< 65m apart) into one unified GATE marker per gate complex
    const gateNodes = graph.nodes.filter((n) => n.kind === "gate");
    const mergedGates: Array<{ id: string; lat: number; lng: number }> = [];
    const usedGateIds = new Set<string>();

    for (let i = 0; i < gateNodes.length; i++) {
      const g1 = gateNodes[i];
      if (usedGateIds.has(g1.id)) continue;
      usedGateIds.add(g1.id);

      let latSum = g1.lat;
      let lngSum = g1.lng;
      let count = 1;
      for (let j = i + 1; j < gateNodes.length; j++) {
        const g2 = gateNodes[j];
        if (usedGateIds.has(g2.id)) continue;
        if (haversineMeters([g1.lat, g1.lng], [g2.lat, g2.lng]) < 65) {
          usedGateIds.add(g2.id);
          latSum += g2.lat;
          lngSum += g2.lng;
          count += 1;
        }
      }
      mergedGates.push({
        id: g1.id,
        lat: latSum / count,
        lng: lngSum / count,
      });
    }

    for (const gate of mergedGates) {
      fixedBadges.push({ lat: gate.lat, lng: gate.lng, w: 62, h: 24 });
      const gateHtml = `
        <div class="ned-map-marker" title="Campus Gate (${gate.id})">
          <span class="ned-marker-badge ned-marker-badge--gate">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 17V6l7-3 7 3v11"/>
              <path d="M8 17v-6h4v6"/>
            </svg>
            GATE
          </span>
        </div>`;
      L.marker([gate.lat, gate.lng], {
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: gateHtml }),
        interactive: false,
      }).addTo(mkGroup);
    }

    // One unified marker per Assembly Area (deduplicating SAFE and SAFE ZONE)
    const assemblyNodes = graph.nodes.filter((n) => n.kind === "assembly");
    for (const n of assemblyNodes) {
      const isAssigned = assignedAssemblyNodeIds.has(n.id);
      fixedBadges.push({ lat: n.lat, lng: n.lng, w: 92, h: 24 });
      const assemblyHtml = `
        <div class="ned-map-marker" title="Assembly Area (${n.id})">
          <span class="ned-marker-badge ${
            isAssigned ? "ned-marker-badge--evac-end" : "ned-marker-badge--assembly"
          }">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 2L18 6v5c0 4.5-3.4 7.5-8 9-4.6-1.5-8-4.5-8-9V6l8-4z"/>
              <path d="M7 10l2 2 4-4"/>
            </svg>
            SAFE ZONE
          </span>
        </div>`;
      L.marker([n.lat, n.lng], {
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: assemblyHtml }),
        interactive: false,
      }).addTo(mkGroup);
    }

    fixedBadgesRef.current = fixedBadges;
  }, [isReady, graph, evacuation]);

  // 3c. Persistent Landmark Label Markers (mounted once when graph changes, never recreated on zoom)
  useEffect(() => {
    const L = leafletRef.current;
    const lblGroup = labelLayerRef.current;
    if (!isReady || !L || !lblGroup || !graph) return;

    lblGroup.clearLayers();
    const items: Array<{
      lm: CampusLandmark;
      center: [number, number];
      el: HTMLDivElement;
    }> = [];

    for (const lm of graph.landmarks) {
      if (!lm.footprint || lm.footprint.length < 3) continue;
      const center = getPolygonCenter(lm.footprint);
      const el = document.createElement("div");
      el.className = "ned-landmark-label";
      el.textContent = lm.short;

      const icon = L.divIcon({
        className: "",
        iconSize: [0, 0],
        html: el,
      });

      L.marker(center, { icon, interactive: false }).addTo(lblGroup);
      items.push({ lm, center, el });
    }

    labelItemsRef.current = items;
  }, [isReady, graph]);

  // 3d. Debounced Priority + Greedy Rectangle Collision Label Placement on zoomend (never on move)
  useEffect(() => {
    const map = mapRef.current;
    if (!isReady || !map || !graph) return;

    const rafId = requestAnimationFrame(() => {
      const items = labelItemsRef.current;
      if (!items || items.length === 0) return;

      const activeRouteNodes = new Set<string>();
      if (route && route.length > 0) {
        activeRouteNodes.add(route[0]);
        activeRouteNodes.add(route[route.length - 1]);
      }

      // Seed collision rectangles with merged GATE, SAFE ZONE, and route/evacuation endpoint badges
      const placedBoxes: Array<[number, number, number, number]> = [];
      for (const b of fixedBadgesRef.current) {
        const pt = map.latLngToContainerPoint([b.lat, b.lng]);
        placedBoxes.push([
          pt.x - b.w / 2,
          pt.y - b.h / 2,
          pt.x + b.w / 2,
          pt.y + b.h / 2,
        ]);
      }

      if (route && route.length >= 2) {
        const startNode = graph.nodes.find((n) => n.id === route[0]);
        const endNode = graph.nodes.find((n) => n.id === route[route.length - 1]);
        if (startNode) {
          const pt = map.latLngToContainerPoint([startNode.lat, startNode.lng]);
          placedBoxes.push([pt.x - 34, pt.y + 2, pt.x + 34, pt.y + 26]);
        }
        if (endNode) {
          const pt = map.latLngToContainerPoint([endNode.lat, endNode.lng]);
          placedBoxes.push([pt.x - 28, pt.y - 34, pt.x + 28, pt.y - 10]);
        }
      }

      if (evacuation?.assignments) {
        for (const assign of evacuation.assignments) {
          if (assign.path.length === 0) continue;
          const fromNode = graph.nodes.find((n) => n.id === assign.path[0]);
          if (fromNode) {
            const pt = map.latLngToContainerPoint([fromNode.lat, fromNode.lng]);
            placedBoxes.push([pt.x - 58, pt.y - 12, pt.x - 2, pt.y + 12]);
          }
        }
      }

      const ranked = [...items].sort((a, b) => {
        const pa = getLandmarkPriority(
          a.lm,
          selectedLandmarkId,
          hoveredLandmarkId,
          activeRouteNodes
        );
        const pb = getLandmarkPriority(
          b.lm,
          selectedLandmarkId,
          hoveredLandmarkId,
          activeRouteNodes
        );
        return pb - pa;
      });

      for (const item of ranked) {
        const { lm, center, el } = item;
        const isSelected = lm.id === selectedLandmarkId;
        const isHovered = lm.id === hoveredLandmarkId;
        const isFocused = isSelected || isHovered;
        const priority = getLandmarkPriority(
          lm,
          selectedLandmarkId,
          hoveredLandmarkId,
          activeRouteNodes
        );

        // Minimum zoom filter by priority tier
        let eligible = true;
        if (!isFocused) {
          if (zoomLevel < 16 && priority < 85) eligible = false;
          else if (zoomLevel === 16 && priority < 55) eligible = false;
          else if (zoomLevel === 17 && priority < 40 && lm.category === "labs") {
            eligible = false;
          }
        }

        const text = getLandmarkLabelText(lm, zoomLevel, isFocused);
        if (el.textContent !== text) {
          el.textContent = text;
        }

        el.classList.toggle("ned-landmark-label--selected", isSelected);
        el.classList.toggle("ned-landmark-label--hovered", isHovered && !isSelected);

        if (!eligible) {
          el.classList.remove("ned-landmark-label--visible");
          continue;
        }

        const pt = map.latLngToContainerPoint(center);
        const estW = Math.max(44, text.length * 6.4 + 14);
        const estH = 20;
        const box: [number, number, number, number] = [
          pt.x - estW / 2,
          pt.y - estH / 2,
          pt.x + estW / 2,
          pt.y + estH / 2,
        ];

        let collides = false;
        if (!isFocused) {
          for (const [x0, y0, x1, y1] of placedBoxes) {
            if (
              box[0] < x1 + 5 &&
              box[2] > x0 - 5 &&
              box[1] < y1 + 4 &&
              box[3] > y0 - 4
            ) {
              collides = true;
              break;
            }
          }
        }

        if (collides) {
          el.classList.remove("ned-landmark-label--visible");
        } else {
          placedBoxes.push(box);
          el.classList.add("ned-landmark-label--visible");
        }
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    isReady,
    graph,
    zoomLevel,
    selectedLandmarkId,
    hoveredLandmarkId,
    route,
    evacuation,
  ]);

  // 4. Layer (d): Route polyline from node IDs with animated draw-on effect
  useEffect(() => {
    const L = leafletRef.current;
    const rtGroup = routeLayerRef.current;
    const svgRenderer = svgRendererRef.current;
    if (!isReady || !L || !rtGroup || !svgRenderer || !graph) return;

    rtGroup.clearLayers();
    if (!route || route.length < 2) return;

    const nodeLookup = new Map<string, OutdoorNode>();
    for (const n of graph.nodes) {
      nodeLookup.set(n.id, n);
    }

    const coords: [number, number][] = [];
    for (const nodeId of route) {
      const node = nodeLookup.get(nodeId);
      if (node) coords.push([node.lat, node.lng]);
    }
    if (coords.length < 2) return;

    // Casing line underneath for contrast
    L.polyline(coords, {
      renderer: svgRenderer,
      color: "var(--map-route-casing)",
      weight: 8.5,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(rtGroup);

    // Animated foreground stroke
    L.polyline(coords, {
      renderer: svgRenderer,
      color: "var(--map-route-stroke)",
      weight: 4.8,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      className: "ned-route-animated-path",
      interactive: false,
    }).addTo(rtGroup);

    const startPt = coords[0];
    const endPt = coords[coords.length - 1];

    const startHtml = `
      <div class="ned-map-marker" style="transform: translate(-50%, 60%);" title="Route Start">
        <span class="ned-marker-badge" style="background: var(--map-landmark-stroke);">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="10" cy="10" r="6"/>
            <circle cx="10" cy="10" r="2"/>
          </svg>
          START
        </span>
      </div>`;
    L.marker(startPt, {
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: startHtml }),
      interactive: false,
    }).addTo(rtGroup);

    const endHtml = `
      <div class="ned-map-marker" style="transform: translate(-50%, -145%);" title="Route Destination">
        <span class="ned-marker-badge" style="background: var(--map-route-stroke);">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 17V4l11 4-11 4"/>
          </svg>
          END
        </span>
      </div>`;
    L.marker(endPt, {
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: endHtml }),
      interactive: false,
    }).addTo(rtGroup);
  }, [isReady, graph, route]);

  // 5. Layer (e): Highlighted Node IDs
  useEffect(() => {
    const L = leafletRef.current;
    const hlGroup = highlightLayerRef.current;
    const svgRenderer = svgRendererRef.current;
    if (!isReady || !L || !hlGroup || !svgRenderer || !graph) return;

    hlGroup.clearLayers();
    if (!highlightedNodeIds || highlightedNodeIds.length === 0) return;

    const nodeLookup = new Map<string, OutdoorNode>();
    for (const n of graph.nodes) {
      nodeLookup.set(n.id, n);
    }

    for (const id of highlightedNodeIds) {
      const node = nodeLookup.get(id);
      if (!node) continue;

      L.circleMarker([node.lat, node.lng], {
        renderer: svgRenderer,
        radius: 8,
        color: "var(--map-surface-elevated)",
        weight: 2,
        fillColor: "var(--map-marker-highlight)",
        fillOpacity: 0.92,
        interactive: false,
      }).addTo(hlGroup);
    }
  }, [isReady, graph, highlightedNodeIds]);

  // 6. Layer (f): User Location Dot with Accuracy Circle
  useEffect(() => {
    const L = leafletRef.current;
    const usrGroup = userLayerRef.current;
    const svgRenderer = svgRendererRef.current;
    if (!isReady || !L || !usrGroup || !svgRenderer) return;

    usrGroup.clearLayers();
    if (!userLocation) return;

    const { lat, lng, accuracyMeters = 18 } = userLocation;

    L.circle([lat, lng], {
      renderer: svgRenderer,
      radius: accuracyMeters,
      color: "var(--map-user-dot)",
      weight: 1.5,
      fillColor: "var(--map-user-accuracy)",
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(usrGroup);

    const userDotHtml = `
      <div class="ned-map-marker" title="Your Location">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" fill="var(--map-user-dot)" stroke="var(--map-surface-elevated)" stroke-width="2.2"/>
          <circle cx="10" cy="10" r="2.2" fill="var(--map-surface-elevated)"/>
        </svg>
      </div>`;
    L.marker([lat, lng], {
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: userDotHtml }),
      interactive: false,
    }).addTo(usrGroup);
  }, [isReady, userLocation]);

  // 7. Layer (g): Evacuation Overlay (hatched hazard lines for blocked edges/nodes + assignment paths)
  useEffect(() => {
    const L = leafletRef.current;
    const evGroup = evacLayerRef.current;
    const svgRenderer = svgRendererRef.current;
    if (!isReady || !L || !evGroup || !svgRenderer || !graph) return;

    evGroup.clearLayers();
    if (!evacuation) return;

    const nodeLookup = new Map<string, OutdoorNode>();
    for (const n of graph.nodes) {
      nodeLookup.set(n.id, n);
    }

    // Blocked edges as hatched hazard lines
    if (evacuation.blockedEdges) {
      for (const [aId, bId] of evacuation.blockedEdges) {
        const na = nodeLookup.get(aId);
        const nb = nodeLookup.get(bId);
        if (!na || !nb) continue;

        const pts: [number, number][] = [
          [na.lat, na.lng],
          [nb.lat, nb.lng],
        ];

        L.polyline(pts, {
          renderer: svgRenderer,
          color: "var(--map-evac-blocked-bg)",
          weight: 9,
          opacity: 0.95,
          lineCap: "butt",
          interactive: false,
        }).addTo(evGroup);

        L.polyline(pts, {
          renderer: svgRenderer,
          color: "var(--map-evac-blocked)",
          weight: 6.5,
          opacity: 1,
          dashArray: "7 5",
          lineCap: "butt",
          interactive: false,
        }).addTo(evGroup);
      }
    }

    // Blocked nodes as hazard cross markers
    if (evacuation.blockedNodes) {
      for (const nodeId of evacuation.blockedNodes) {
        const node = nodeLookup.get(nodeId);
        if (!node) continue;

        const hazardHtml = `
          <div class="ned-map-marker" title="Blocked Hazard Node (${nodeId})">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" fill="var(--map-evac-blocked-bg)" stroke="var(--map-evac-blocked)" stroke-width="2"/>
              <line x1="6.5" y1="6.5" x2="13.5" y2="13.5" stroke="var(--map-evac-blocked)" stroke-width="2" stroke-linecap="round"/>
              <line x1="13.5" y1="6.5" x2="6.5" y2="13.5" stroke="var(--map-evac-blocked)" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>`;
        L.marker([node.lat, node.lng], {
          icon: L.divIcon({ className: "", iconSize: [0, 0], html: hazardHtml }),
          interactive: false,
        }).addTo(evGroup);
      }
    }

    // Assignment paths with start/end markers
    if (evacuation.assignments) {
      for (const assign of evacuation.assignments) {
        const coords: [number, number][] = [];
        for (const nid of assign.path) {
          const n = nodeLookup.get(nid);
          if (n) coords.push([n.lat, n.lng]);
        }
        if (coords.length < 2) continue;

        L.polyline(coords, {
          renderer: svgRenderer,
          color: "var(--map-surface-elevated)",
          weight: 7,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
        }).addTo(evGroup);

        L.polyline(coords, {
          renderer: svgRenderer,
          color: "var(--map-evac-assign)",
          weight: 4,
          opacity: 0.98,
          dashArray: "9 5",
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
        }).addTo(evGroup);

        const startCoord = coords[0];
        const endCoord = coords[coords.length - 1];
        const endNodeId = assign.path[assign.path.length - 1];
        const endNode = nodeLookup.get(endNodeId);

        const evacStartHtml = `
          <div class="ned-map-marker" style="transform: translate(-115%, -50%);" title="Evacuation Exit (${assign.from})">
            <span class="ned-marker-badge ned-marker-badge--evac-start">
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 10h12M11 5l5 5-5 5"/>
              </svg>
              EXIT
            </span>
          </div>`;
        L.marker(startCoord, {
          icon: L.divIcon({ className: "", iconSize: [0, 0], html: evacStartHtml }),
          interactive: false,
        }).addTo(evGroup);

        // Only draw a standalone SAFE badge if the target is NOT already a SAFE ZONE assembly marker
        if (!endNode || endNode.kind !== "assembly") {
          const evacEndHtml = `
            <div class="ned-map-marker" style="transform: translate(-50%, -145%);" title="Assigned Assembly (${assign.assemblyId})">
              <span class="ned-marker-badge ned-marker-badge--evac-end">
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 11l3 3 7-7"/>
                </svg>
                SAFE
              </span>
            </div>`;
          L.marker(endCoord, {
            icon: L.divIcon({ className: "", iconSize: [0, 0], html: evacEndHtml }),
            interactive: false,
          }).addTo(evGroup);
        }
      }
    }
  }, [isReady, graph, evacuation]);

  // 8. Trace Replay Layer: Lights visited nodes in visit order and shows the frontier
  useEffect(() => {
    const L = leafletRef.current;
    const trGroup = traceLayerRef.current;
    const svgRenderer = svgRendererRef.current;
    if (!isReady || !L || !trGroup || !svgRenderer || !graph) return;

    trGroup.clearLayers();
    if (!trace) return;

    const nodeLookup = new Map<string, OutdoorNode>();
    for (const n of graph.nodes) {
      nodeLookup.set(n.id, n);
    }

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

    // Draw frontier nodes
    for (const fid of frontierNodeIds) {
      const node = nodeLookup.get(fid);
      if (!node) continue;
      L.circleMarker([node.lat, node.lng], {
        renderer: svgRenderer,
        radius: 6.5,
        color: "var(--map-trace-frontier)",
        weight: 2.2,
        fillColor: "var(--map-surface-elevated)",
        fillOpacity: 0.9,
        interactive: false,
      }).addTo(trGroup);
    }

    // Draw visited nodes in visit order
    visitedNodeIds.forEach((vid, orderIdx) => {
      const node = nodeLookup.get(vid);
      if (!node) return;
      L.circleMarker([node.lat, node.lng], {
        renderer: svgRenderer,
        radius: 6,
        color: "var(--map-surface-elevated)",
        weight: 1.75,
        fillColor: "var(--map-trace-visited)",
        fillOpacity: 0.95,
        interactive: false,
      }).addTo(trGroup);

      const orderBadge = `
        <div class="ned-map-marker ned-trace-order-badge" style="pointer-events:none; transform: translate(-50%, -140%);">
          <span style="background: var(--map-trace-visited); color: var(--map-text-inverse); font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; border: 1px solid var(--map-surface-elevated);">
            ${orderIdx + 1}
          </span>
        </div>`;
      L.marker([node.lat, node.lng], {
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: orderBadge }),
        interactive: false,
      }).addTo(trGroup);
    });

    // Draw active trace cursor node
    if (activeNodeId) {
      const activeNode = nodeLookup.get(activeNodeId);
      if (activeNode) {
        L.circleMarker([activeNode.lat, activeNode.lng], {
          renderer: svgRenderer,
          radius: 9.5,
          color: "var(--map-trace-active)",
          weight: 2.6,
          fillColor: "var(--map-trace-active)",
          fillOpacity: 0.28,
          interactive: false,
        }).addTo(trGroup);
      }
    }
  }, [isReady, graph, trace]);

  // 9. Switchable Basemaps (Street vs Satellite)
  useEffect(() => {
    const map = mapRef.current;
    const streetLayer = streetTileLayerRef.current;
    const satLayer = satelliteTileLayerRef.current;
    if (!isReady || !map || !streetLayer || !satLayer) return;

    if (basemapMode === "satellite") {
      if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
      if (!map.hasLayer(satLayer)) satLayer.addTo(map);
    } else {
      if (map.hasLayer(satLayer)) map.removeLayer(satLayer);
      if (!map.hasLayer(streetLayer)) streetLayer.addTo(map);
    }
  }, [isReady, basemapMode]);

  // 10. Master-Plan Overlay Toggle & Opacity Control
  useEffect(() => {
    const map = mapRef.current;
    const mpLayer = masterPlanLayerRef.current;
    if (!isReady || !map || !mpLayer) return;

    if (showMasterPlan) {
      if (!map.hasLayer(mpLayer)) mpLayer.addTo(map);
      if (typeof mpLayer.setOpacity === "function") {
        mpLayer.setOpacity(masterPlanOpacity);
      }
    } else {
      if (map.hasLayer(mpLayer)) map.removeLayer(mpLayer);
    }
  }, [isReady, showMasterPlan, masterPlanOpacity]);

  const handleZoomIn = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomOut();
  }, []);

  const handleRecenter = useCallback(() => {
    if (mapRef.current) {
      const origin: [number, number] = graph?.meta?.origin || [24.9318, 67.1132];
      mapRef.current.setView(origin, 17, { animate: true });
    }
  }, [graph]);

  return (
    <div className="ned-outdoor-map-root" data-basemap={basemapMode}>
      <div ref={containerRef} className="ned-leaflet-viewport" />

      {/* Custom Hand-Drawn SVG Basemap & Master-Plan Layer Switcher */}
      <div
        className="ned-layer-switcher"
        role="region"
        aria-label="Basemap and overlay switcher"
      >
        <div className="ned-layer-switcher-row" role="group" aria-label="Base map mode">
          <button
            type="button"
            className={`ned-layer-btn ${
              basemapMode === "street" ? "ned-layer-btn--active" : ""
            }`}
            onClick={() => setBasemapMode("street")}
            aria-pressed={basemapMode === "street"}
            title="Clear Street & Ground Map"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="2,5 8,3 12,5 18,3 18,15 12,17 8,15 2,17" />
              <line x1="8" y1="3" x2="8" y2="15" />
              <line x1="12" y1="5" x2="12" y2="17" />
            </svg>
            Street
          </button>

          <button
            type="button"
            className={`ned-layer-btn ${
              basemapMode === "satellite" ? "ned-layer-btn--active" : ""
            }`}
            onClick={() => setBasemapMode("satellite")}
            aria-pressed={basemapMode === "satellite"}
            title="Esri World Imagery Satellite"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="10" cy="10" r="7" />
              <ellipse cx="10" cy="10" rx="3" ry="7" />
              <line x1="3" y1="10" x2="17" y2="10" />
            </svg>
            Satellite
          </button>
        </div>

        <div className="ned-masterplan-row">
          <label className="ned-masterplan-toggle" title="Toggle NED Master Plan overlay">
            <input
              type="checkbox"
              checked={showMasterPlan}
              onChange={(e) => setShowMasterPlan(e.target.checked)}
            />
            <svg
              width="13"
              height="13"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="10,3 18,7 10,11 2,7" />
              <polyline points="2,11 10,15 18,11" />
              <polyline points="2,14.5 10,18.5 18,14.5" />
            </svg>
            Master Plan
          </label>
          {showMasterPlan && (
            <input
              type="range"
              className="ned-opacity-slider"
              min={0.15}
              max={1}
              step={0.05}
              value={masterPlanOpacity}
              onChange={(e) => setMasterPlanOpacity(Number(e.target.value))}
              aria-label="Master plan overlay opacity"
              title={`Master plan opacity: ${Math.round(masterPlanOpacity * 100)}%`}
            />
          )}
        </div>
      </div>

      {/* Custom Hand-Drawn SVG Zoom & Recenter Controls */}
      <div className="ned-map-controls" role="group" aria-label="Map navigation controls">
        <button
          type="button"
          className="ned-map-ctrl-btn"
          onClick={handleZoomIn}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <svg
            width="18"
            height="18"
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
          className="ned-map-ctrl-btn"
          onClick={handleZoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <svg
            width="18"
            height="18"
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
          className="ned-map-ctrl-btn"
          onClick={handleRecenter}
          aria-label="Recenter campus map"
          title="Recenter campus map"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="10" cy="10" r="6" />
            <circle cx="10" cy="10" r="1.5" />
            <line x1="10" y1="2" x2="10" y2="4" />
            <line x1="10" y1="16" x2="10" y2="18" />
            <line x1="2" y1="10" x2="4" y2="10" />
            <line x1="16" y1="10" x2="18" y2="10" />
          </svg>
        </button>
      </div>

      {/* Required Tile Attributions */}
      <div className="ned-map-attribution" aria-label="Map tile attribution">
        {basemapMode === "satellite" ? (
          <span>&copy; Esri World Imagery &bull; OpenStreetMap &bull; NED GIS</span>
        ) : (
          <span>&copy; OpenStreetMap contributors &bull; Esri &bull; NED GIS</span>
        )}
      </div>

      {/* Architectural Map Legend Pill */}
      <div className="ned-map-hud" aria-label="Map layer legend">
        <span className="ned-map-hud-item">
          <span
            className="ned-map-hud-swatch"
            style={{ background: "var(--map-landmark-stroke)" }}
          />
          Building
        </span>
        <span className="ned-map-hud-item">
          <span
            className="ned-map-hud-swatch"
            style={{ background: "var(--map-marker-gate)" }}
          />
          Gate
        </span>
        <span className="ned-map-hud-item">
          <span
            className="ned-map-hud-swatch"
            style={{ background: "var(--map-marker-assembly)" }}
          />
          Assembly
        </span>
      </div>
    </div>
  );
}
