"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
  [24.918, 67.094],
  [24.946, 67.132],
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

const CATEGORY_TITLES: Record<string, string> = {
  academic: "Academic Departments",
  labs: "Engineering Laboratories",
  administration: "Administration & Secretariats",
  library: "Central Library",
  services: "Campus Services & Facilities",
  sports: "Sports & Athletics",
  cafeteria: "Cafeterias & Food",
  hostels: "Student Hostels",
  gate: "Gates & Entrances",
  landmark: "Campus Landmarks",
  emergency: "Emergency & Safe Zones",
};

const CATEGORY_ORDER = [
  "academic",
  "labs",
  "administration",
  "library",
  "services",
  "sports",
  "cafeteria",
  "hostels",
  "gate",
  "landmark",
  "emergency",
];

function getCampusBounds(
  graph?: { landmarks?: Array<{ footprint?: [number, number][] }> } | null
): [[number, number], [number, number]] {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  if (graph?.landmarks && graph.landmarks.length > 0) {
    for (const lm of graph.landmarks) {
      if (lm.footprint && lm.footprint.length > 0) {
        for (const [lat, lng] of lm.footprint) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
      }
    }
  }

  if (
    Number.isFinite(minLat) &&
    Number.isFinite(maxLat) &&
    Number.isFinite(minLng) &&
    Number.isFinite(maxLng)
  ) {
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }

  return DEFAULT_WARPED_BOUNDS;
}

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

  const cleanTileLayerRef = useRef<any>(null);
  const detailedTileLayerRef = useRef<any>(null);
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
  const [basemapMode, setBasemapMode] = useState<BasemapMode>("clean");
  const [showMasterPlan, setShowMasterPlan] = useState(false);
  const [masterPlanOpacity, setMasterPlanOpacity] = useState(0.8);
  const [isKeyOpen, setIsKeyOpen] = useState(false);
  const [keySearch, setKeySearch] = useState("");

  const labelItemsRef = useRef<
    Array<{
      lm: CampusLandmark;
      center: [number, number];
      el: HTMLDivElement;
      badgeEl: HTMLSpanElement;
      nameEl: HTMLSpanElement;
    }>
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

      const campusBounds = getCampusBounds(graph);

      const map = L.map(containerRef.current, {
        center: [24.93165, 67.11315],
        zoom: 17,
        minZoom: 15,
        maxZoom: 20,
        maxBounds: DEFAULT_MAX_BOUNDS,
        maxBoundsViscosity: 0.9,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: false,
      });

      map.fitBounds(campusBounds, { padding: [20, 20] });
      setZoomLevel(map.getZoom());

      mapRef.current = map;

      // Basemap 1 (Default: Clean): Esri World Light Gray Base (no key, no labels, native up to 16, upscales to 20)
      const cleanTiles = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 20,
          maxNativeZoom: 16,
          keepBuffer: 4,
          updateWhenIdle: false,
          updateWhenZooming: false,
        }
      );

      // Basemap 2 (Detailed): Standard OpenStreetMap tiles
      const detailedTiles = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 20,
          maxNativeZoom: 19,
          keepBuffer: 4,
          updateWhenIdle: false,
          updateWhenZooming: false,
        }
      );

      // Basemap 3 (Satellite): Esri World Imagery
      const satelliteTiles = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 20,
          maxNativeZoom: 19,
          keepBuffer: 4,
          updateWhenIdle: false,
          updateWhenZooming: false,
        }
      );

      cleanTileLayerRef.current = cleanTiles;
      detailedTileLayerRef.current = detailedTiles;
      satelliteTileLayerRef.current = satelliteTiles;
      cleanTiles.addTo(map);

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
      badgeEl: HTMLSpanElement;
      nameEl: HTMLSpanElement;
    }> = [];

    for (const lm of graph.landmarks) {
      if (!lm.footprint || lm.footprint.length < 3) continue;
      const center = getPolygonCenter(lm.footprint);
      const el = document.createElement("div");
      el.className = "ned-landmark-label";

      const badgeEl = document.createElement("span");
      badgeEl.className = "ned-landmark-badge";
      badgeEl.textContent = lm.number || lm.short;

      const nameEl = document.createElement("span");
      nameEl.className = "ned-landmark-name";
      nameEl.textContent = lm.name;

      el.appendChild(badgeEl);
      el.appendChild(nameEl);

      const icon = L.divIcon({
        className: "",
        iconSize: [0, 0],
        html: el,
      });

      L.marker(center, { icon, interactive: false }).addTo(lblGroup);
      items.push({ lm, center, el, badgeEl, nameEl });
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

      // Seed collision rectangles with HUD controls, merged GATE, SAFE ZONE, and route/evacuation endpoint badges
      const placedBoxes: Array<[number, number, number, number]> = [];
      const vw = containerRef.current?.clientWidth || 1000;
      const vh = containerRef.current?.clientHeight || 680;
      const isCompactViewport = vw < 520;

      // Top-left Campus Key button / panel
      if (isKeyOpen && vw >= 640) {
        placedBoxes.push([0, 0, 350, vh]);
      } else {
        placedBoxes.push([0, 0, 130, 48]);
      }

      // Top-right Layer Switcher pill
      placedBoxes.push([Math.max(0, vw - 196), 0, vw, 78]);
      // Bottom-right Zoom & Recenter buttons
      placedBoxes.push([Math.max(0, vw - 58), Math.max(0, vh - 140), vw, vh]);
      // Bottom-left Legend & Attribution pills
      placedBoxes.push([0, Math.max(0, vh - 72), Math.min(vw, 240), vh]);
      placedBoxes.push([Math.max(0, vw - 310), Math.max(0, vh - 36), vw, vh]);

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
        const { lm, center, el, badgeEl, nameEl } = item;
        const isSelected = lm.id === selectedLandmarkId;
        const isHovered = lm.id === hoveredLandmarkId;
        const isFocused = isSelected || isHovered;
        const isOnRoute =
          activeRouteNodes.has(lm.nodeId) ||
          Boolean(route && lm.nodeId && route.includes(lm.nodeId));
        const priority = getLandmarkPriority(
          lm,
          selectedLandmarkId,
          hoveredLandmarkId,
          activeRouteNodes
        );

        // Minimum zoom filter by priority tier
        let eligible = true;
        if (!isFocused && !isOnRoute) {
          if (zoomLevel < 16 && priority < 85) eligible = false;
          else if (zoomLevel === 16 && priority < 55) eligible = false;
          else if (zoomLevel === 17 && priority < 40 && lm.category === "labs") {
            eligible = false;
          }
        }

        // Show only badge at zoomed out & mid zoom (< 18) unless focused or on route
        const showFullName = isFocused || isOnRoute || zoomLevel >= 18;

        const numText = lm.number || lm.short;
        if (badgeEl.textContent !== numText) {
          badgeEl.textContent = numText;
        }

        if (showFullName) {
          nameEl.style.display = "";
          const fullName =
            isCompactViewport && lm.name.length > 28 ? lm.short : lm.name;
          if (nameEl.textContent !== fullName) {
            nameEl.textContent = fullName;
          }
          el.classList.remove("ned-landmark-label--badge-only");
        } else {
          nameEl.style.display = "none";
          el.classList.add("ned-landmark-label--badge-only");
        }

        el.classList.toggle("ned-landmark-label--selected", isSelected);
        el.classList.toggle("ned-landmark-label--hovered", isHovered && !isSelected);

        if (!eligible) {
          el.classList.remove("ned-landmark-label--visible");
          continue;
        }

        const pt = map.latLngToContainerPoint(center);
        const estW = showFullName
          ? Math.max(26, numText.length * 7.5 + 8) +
            (nameEl.textContent || "").length * 6.4 +
            16
          : Math.max(22, numText.length * 7.5 + 10);
        const estH = 22;
        const box: [number, number, number, number] = [
          pt.x - estW / 2,
          pt.y - estH / 2,
          pt.x + estW / 2,
          pt.y + estH / 2,
        ];

        let collides = false;
        if (!isFocused) {
          if (
            box[0] < 6 ||
            box[2] > vw - 6 ||
            box[1] < 6 ||
            box[3] > vh - 6
          ) {
            collides = true;
          } else {
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
    isKeyOpen,
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

  // 9. Switchable Basemaps (Clean vs Detailed vs Satellite)
  useEffect(() => {
    const map = mapRef.current;
    const cleanLayer = cleanTileLayerRef.current;
    const detailedLayer = detailedTileLayerRef.current;
    const satLayer = satelliteTileLayerRef.current;
    if (!isReady || !map || !cleanLayer || !detailedLayer || !satLayer) return;

    const targetLayer =
      basemapMode === "satellite"
        ? satLayer
        : basemapMode === "detailed"
        ? detailedLayer
        : cleanLayer;

    const allLayers = [cleanLayer, detailedLayer, satLayer];
    for (const layer of allLayers) {
      if (layer !== targetLayer && map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    }
    if (!map.hasLayer(targetLayer)) {
      targetLayer.addTo(map);
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
      const bounds = getCampusBounds(graph);
      mapRef.current.fitBounds(bounds, { padding: [20, 20], animate: true });
    }
  }, [graph]);

  const filteredLandmarks = useMemo(() => {
    if (!graph?.landmarks) return [];
    const q = keySearch.trim().toLowerCase();
    if (!q) return graph.landmarks;
    return graph.landmarks.filter((lm) => {
      const numMatch = lm.number ? lm.number.toLowerCase().includes(q) : false;
      const nameMatch = lm.name.toLowerCase().includes(q);
      const shortMatch = lm.short.toLowerCase().includes(q);
      const catMatch = lm.category ? lm.category.toLowerCase().includes(q) : false;
      return numMatch || nameMatch || shortMatch || catMatch;
    });
  }, [graph?.landmarks, keySearch]);

  const groupedLandmarks = useMemo(() => {
    const groups: Array<{ category: string; title: string; items: CampusLandmark[] }> = [];
    const catMap = new Map<string, CampusLandmark[]>();

    for (const lm of filteredLandmarks) {
      const cat = (lm.category || "services").toLowerCase();
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(lm);
    }

    for (const cat of CATEGORY_ORDER) {
      const items = catMap.get(cat);
      if (items && items.length > 0) {
        const sorted = [...items].sort((a, b) => {
          const na = a.number || a.short;
          const nb = b.number || b.short;
          return na.localeCompare(nb, undefined, { numeric: true, sensitivity: "base" });
        });
        groups.push({
          category: cat,
          title: CATEGORY_TITLES[cat] || cat,
          items: sorted,
        });
      }
    }

    for (const [cat, items] of catMap.entries()) {
      if (!CATEGORY_ORDER.includes(cat) && items.length > 0) {
        const sorted = [...items].sort((a, b) => {
          const na = a.number || a.short;
          const nb = b.number || b.short;
          return na.localeCompare(nb, undefined, { numeric: true, sensitivity: "base" });
        });
        groups.push({
          category: cat,
          title: CATEGORY_TITLES[cat] || cat,
          items: sorted,
        });
      }
    }

    return groups;
  }, [filteredLandmarks]);

  const handleSelectLandmarkFromKey = useCallback(
    (lm: CampusLandmark) => {
      if (containerRef.current && containerRef.current.clientWidth < 640) {
        setIsKeyOpen(false);
      }

      if (mapRef.current) {
        let targetCoord: [number, number] | null = null;
        if (lm.footprint && lm.footprint.length >= 3) {
          targetCoord = getPolygonCenter(lm.footprint);
        } else if (lm.nodeId && graph?.nodes) {
          const n = graph.nodes.find((node) => node.id === lm.nodeId);
          if (n) targetCoord = [n.lat, n.lng];
        }
        if (targetCoord) {
          mapRef.current.flyTo(targetCoord, 18, { animate: true, duration: 0.75 });
        }
      }

      onLandmarkClickRef.current?.(lm.id, lm);
    },
    [graph]
  );

  return (
    <div className="ned-outdoor-map-root" data-basemap={basemapMode}>
      <div ref={containerRef} className="ned-leaflet-viewport" />

      {/* Campus Key / Directory Toggle Button */}
      <button
        type="button"
        className={`ned-key-toggle-btn ${isKeyOpen ? "ned-key-toggle-btn--active" : ""}`}
        onClick={() => setIsKeyOpen((prev) => !prev)}
        aria-label={isKeyOpen ? "Close campus key" : "Open campus key"}
        aria-expanded={isKeyOpen}
        title="Campus Directory & Building Key"
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
          <path d="M3 5a2 2 0 012-2h11v14H5a2 2 0 00-2 2V5z" />
          <path d="M7 6h7M7 10h7M7 14h4" />
        </svg>
        <span>Campus Key</span>
        {isKeyOpen && (
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginLeft: "2px" }}
          >
            <line x1="15" y1="5" x2="5" y2="15" />
            <line x1="5" y1="5" x2="15" y2="15" />
          </svg>
        )}
      </button>

      {/* Collapsible Key Panel (Desktop Side Panel / Mobile Bottom Drawer) */}
      {isKeyOpen && (
        <aside
          className="ned-key-panel"
          role="region"
          aria-label="Campus Building Directory"
        >
          {/* Mobile Drawer drag handle */}
          <div className="ned-key-drawer-handle" aria-hidden="true" />

          {/* Header */}
          <div className="ned-key-header">
            <div className="ned-key-title-group">
              <h2 className="ned-key-title">Campus Key</h2>
              <span className="ned-key-badge-count">
                {filteredLandmarks.length} buildings
              </span>
            </div>
            <button
              type="button"
              className="ned-key-close-btn"
              onClick={() => setIsKeyOpen(false)}
              aria-label="Close campus key"
              title="Close key"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="15" y1="5" x2="5" y2="15" />
                <line x1="5" y1="5" x2="15" y2="15" />
              </svg>
            </button>
          </div>

          {/* Search Box */}
          <div className="ned-key-search-wrapper">
            <div className="ned-key-search-box">
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="9" cy="9" r="6" />
                <line x1="13.5" y1="13.5" x2="18" y2="18" />
              </svg>
              <input
                type="search"
                className="ned-key-search-input"
                placeholder="Search number, name, department..."
                value={keySearch}
                onChange={(e) => setKeySearch(e.target.value)}
                aria-label="Search campus buildings by number or name"
              />
              {keySearch.length > 0 && (
                <button
                  type="button"
                  className="ned-key-clear-btn"
                  onClick={() => setKeySearch("")}
                  aria-label="Clear search"
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
                    <line x1="15" y1="5" x2="5" y2="15" />
                    <line x1="5" y1="5" x2="15" y2="15" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Grouped Building List */}
          <div className="ned-key-list" role="list">
            {groupedLandmarks.length === 0 ? (
              <div className="ned-key-empty">No campus buildings match "{keySearch}"</div>
            ) : (
              groupedLandmarks.map((group) => (
                <div key={group.category} className="ned-key-category-group" role="group" aria-label={group.title}>
                  <div className="ned-key-category-header">{group.title}</div>
                  {group.items.map((lm) => {
                    const isSelected = lm.id === selectedLandmarkId;
                    return (
                      <button
                        key={lm.id}
                        type="button"
                        className={`ned-key-item ${isSelected ? "ned-key-item--selected" : ""}`}
                        onClick={() => handleSelectLandmarkFromKey(lm)}
                        aria-pressed={isSelected}
                      >
                        <span className="ned-key-item-number">
                          {lm.number || lm.short}
                        </span>
                        <div className="ned-key-item-info">
                          <span className="ned-key-item-name">{lm.name}</span>
                          <span className="ned-key-item-short">{lm.short}</span>
                        </div>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="ned-key-item-arrow"
                          aria-hidden="true"
                        >
                          <polyline points="7 4 13 10 7 16" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* Custom Hand-Drawn SVG Basemap & Master-Plan Layer Switcher */}
      <div
        className="ned-layer-switcher"
        role="region"
        aria-label="Basemap and overlay switcher"
      >
        <div className="ned-layer-switcher-row" role="radiogroup" aria-label="Basemap style">
          <button
            type="button"
            className={`ned-layer-btn ${
              basemapMode === "clean" ? "ned-layer-btn--active" : ""
            }`}
            onClick={() => setBasemapMode("clean")}
            aria-pressed={basemapMode === "clean"}
            title="Esri World Light Gray Base (clean, minimal)"
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
              <rect x="3" y="3" width="14" height="14" rx="2" />
              <line x1="3" y1="9" x2="17" y2="9" />
              <line x1="9" y1="9" x2="9" y2="17" />
            </svg>
            Clean
          </button>

          <button
            type="button"
            className={`ned-layer-btn ${
              basemapMode === "detailed" ? "ned-layer-btn--active" : ""
            }`}
            onClick={() => setBasemapMode("detailed")}
            aria-pressed={basemapMode === "detailed"}
            title="OpenStreetMap Standard (detailed street map)"
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
            Detailed
          </button>

          <button
            type="button"
            className={`ned-layer-btn ${
              basemapMode === "satellite" ? "ned-layer-btn--active" : ""
            }`}
            onClick={() => setBasemapMode("satellite")}
            aria-pressed={basemapMode === "satellite"}
            title="Esri World Imagery (satellite aerial view)"
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
          <span>
            &copy;{" "}
            <a href="https://www.esri.com/" target="_blank" rel="noreferrer">
              Esri
            </a>{" "}
            &bull; &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap
            </a>{" "}
            &bull; NED GIS
          </span>
        ) : basemapMode === "detailed" ? (
          <span>
            &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap
            </a>{" "}
            contributors &bull; NED GIS
          </span>
        ) : (
          <span>
            &copy;{" "}
            <a href="https://www.esri.com/" target="_blank" rel="noreferrer">
              Esri
            </a>{" "}
            &bull; NED GIS
          </span>
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
