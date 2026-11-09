"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import "@/map/map.css";
import type {
  CampusLandmark,
  MasterPlanCorners,
  OutdoorMapProps,
  OutdoorNode,
} from "./types";

const DEFAULT_CORNERS: MasterPlanCorners = {
  topLeft: [24.93788, 67.11341],
  topRight: [24.93076, 67.11837],
  bottomLeft: [24.93389, 67.10644],
  bottomRight: [24.92677, 67.11141],
};

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
  showGraph = true,
  userLocation = null,
}: OutdoorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const canvasRendererRef = useRef<any>(null);
  const svgRendererRef = useRef<any>(null);

  const graphLayerRef = useRef<any>(null);
  const footprintLayerRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const labelLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const highlightLayerRef = useRef<any>(null);
  const userLayerRef = useRef<any>(null);

  const [isReady, setIsReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(17);

  const onLandmarkClickRef = useRef(onLandmarkClick);
  onLandmarkClickRef.current = onLandmarkClick;

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  // 1. Initialize Leaflet on client only + Affine Master Plan Image Overlay
  useEffect(() => {
    let cancelled = false;

    async function initLeaflet() {
      if (!containerRef.current || mapRef.current) return;

      const LModule = await import("leaflet");
      const L = LModule.default || LModule;
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;

      const origin: [number, number] = graph?.meta?.origin || [24.9322, 67.1133];
      const map = L.map(containerRef.current, {
        center: origin,
        zoom: 17,
        minZoom: 15,
        maxZoom: 20,
        maxBounds: DEFAULT_MAX_BOUNDS,
        maxBoundsViscosity: 0.9,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: false,
      });

      mapRef.current = map;
      canvasRendererRef.current = L.canvas({ padding: 0.5 });
      svgRendererRef.current = L.svg({ padding: 0.5 });

      // Custom Affine 4-Corner Master Plan Image Layer
      const corners: MasterPlanCorners =
        graph?.meta?.masterPlanControlCorners ||
        graph?.meta?.mapOverlay?.corners ||
        DEFAULT_CORNERS;
      const imageUrl = graph?.meta?.mapOverlay?.image || "/map/ned_master_plan.jpg";

      const AffineMasterPlanOverlay = L.Layer.extend({
        onAdd: function (mapInstance: any) {
          this._map = mapInstance;
          if (!this._container) {
            const div = L.DomUtil.create("div", "leaflet-image-layer");
            div.style.position = "absolute";
            div.style.top = "0";
            div.style.left = "0";
            div.style.pointerEvents = "none";
            div.style.zIndex = "220";

            const img = L.DomUtil.create("img", "", div) as HTMLImageElement;
            img.style.position = "absolute";
            img.style.transformOrigin = "0 0";
            img.style.clipPath = "inset(4% 4% 22% 4% round 12px)";
            img.style.opacity = "0.9";
            img.alt = "NED University Master Plan";

            img.onload = () => {
              if (this._map) this._reset();
            };
            img.src = imageUrl;

            this._container = div;
            this._img = img;
          }
          mapInstance.getPanes().overlayPane.appendChild(this._container);
          mapInstance.on("zoom viewreset move zoomanim", this._reset, this);
          if (this._img.complete) {
            this._reset();
          }
        },
        onRemove: function (mapInstance: any) {
          mapInstance.off("zoom viewreset move zoomanim", this._reset, this);
          if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
          }
        },
        _reset: function () {
          if (!this._map || !this._img) return;
          const W = this._img.naturalWidth || 1000;
          const H = this._img.naturalHeight || 1000;
          const pTL = this._map.latLngToLayerPoint(corners.topLeft);
          const pTR = this._map.latLngToLayerPoint(corners.topRight);
          const pBL = this._map.latLngToLayerPoint(corners.bottomLeft);

          const a = (pTR.x - pTL.x) / W;
          const b = (pTR.y - pTL.y) / W;
          const c = (pBL.x - pTL.x) / H;
          const d = (pBL.y - pTL.y) / H;

          this._img.style.width = `${W}px`;
          this._img.style.height = `${H}px`;
          this._img.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${pTL.x}, ${pTL.y})`;
        },
      });

      const masterOverlay = new AffineMasterPlanOverlay();
      masterOverlay.addTo(map);

      graphLayerRef.current = L.layerGroup().addTo(map);
      footprintLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
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
    }

    initLeaflet();

    return () => {
      cancelled = true;
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

  // 3. Layer (b) & (c): Landmark footprints + zoom-aware labels + entrance/gate/assembly markers
  useEffect(() => {
    const L = leafletRef.current;
    const fpGroup = footprintLayerRef.current;
    const mkGroup = markerLayerRef.current;
    const lblGroup = labelLayerRef.current;
    const svgRenderer = svgRendererRef.current;
    const map = mapRef.current;
    if (!isReady || !L || !fpGroup || !mkGroup || !lblGroup || !map || !graph) return;

    fpGroup.clearLayers();
    mkGroup.clearLayers();
    lblGroup.clearLayers();

    // (b) Landmark Footprints
    for (const lm of graph.landmarks) {
      if (!lm.footprint || lm.footprint.length < 3) continue;
      const isSelected = selectedLandmarkId === lm.id;

      const baseStyle = {
        renderer: svgRenderer,
        color: isSelected
          ? "var(--map-landmark-selected-stroke)"
          : "var(--map-landmark-stroke)",
        weight: isSelected ? 2.5 : 1.5,
        fillColor: isSelected
          ? "var(--map-landmark-selected-fill)"
          : "var(--map-landmark-fill)",
        fillOpacity: isSelected ? 0.95 : 0.85,
      };

      const poly = L.polygon(lm.footprint, baseStyle);

      poly.on("mouseover", () => {
        if (selectedLandmarkId !== lm.id) {
          poly.setStyle({
            weight: 2.2,
            fillColor: "var(--map-landmark-hover-fill)",
            fillOpacity: 0.95,
            color: "var(--map-landmark-hover-stroke)",
          });
        }
      });

      poly.on("mouseout", () => {
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

    // Zoom-dependent non-overlapping short labels
    const placedBoxes: Array<[number, number, number, number]> = [];
    const sortedLandmarks = [...graph.landmarks].sort((a, b) => {
      if (a.id === selectedLandmarkId) return -1;
      if (b.id === selectedLandmarkId) return 1;
      const aMaj = MAJOR_LANDMARK_IDS.has(a.id) ? 1 : 0;
      const bMaj = MAJOR_LANDMARK_IDS.has(b.id) ? 1 : 0;
      return bMaj - aMaj;
    });

    for (const lm of sortedLandmarks) {
      const isSelected = lm.id === selectedLandmarkId;
      const isMajor = MAJOR_LANDMARK_IDS.has(lm.id);

      if (!isSelected) {
        if (zoomLevel < 16) continue;
        if (zoomLevel === 16 && !isMajor) continue;
        if (zoomLevel === 17 && !isMajor && lm.category === "labs") continue;
      }

      const center = getPolygonCenter(lm.footprint);
      const pt = map.latLngToContainerPoint(center);
      const estW = Math.max(48, lm.short.length * 6.5 + 14);
      const estH = 20;
      const box: [number, number, number, number] = [
        pt.x - estW / 2,
        pt.y - estH / 2,
        pt.x + estW / 2,
        pt.y + estH / 2,
      ];

      let collides = false;
      if (!isSelected) {
        for (const [x0, y0, x1, y1] of placedBoxes) {
          if (box[0] < x1 + 4 && box[2] > x0 - 4 && box[1] < y1 + 3 && box[3] > y0 - 3) {
            collides = true;
            break;
          }
        }
      }
      if (collides) continue;
      placedBoxes.push(box);

      const icon = L.divIcon({
        className: "",
        iconSize: [0, 0],
        html: `<div class="ned-landmark-label ${
          isSelected ? "ned-landmark-label--selected" : ""
        }">${lm.short}</div>`,
      });

      L.marker(center, { icon, interactive: false }).addTo(lblGroup);
    }

    // (c) Entrance, Gate & Assembly-Area Markers (unified 1.75px stroke SVG icons)
    for (const n of graph.nodes) {
      if (n.kind === "gate") {
        const gateHtml = `
          <div class="ned-map-marker" title="Campus Gate (${n.id})">
            <span class="ned-marker-badge ned-marker-badge--gate">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 17V6l7-3 7 3v11"/>
                <path d="M8 17v-6h4v6"/>
              </svg>
              GATE
            </span>
          </div>`;
        L.marker([n.lat, n.lng], {
          icon: L.divIcon({ className: "", iconSize: [0, 0], html: gateHtml }),
          interactive: false,
        }).addTo(mkGroup);
      } else if (n.kind === "assembly") {
        const assemblyHtml = `
          <div class="ned-map-marker" title="Assembly Area (${n.id})">
            <span class="ned-marker-badge ned-marker-badge--assembly">
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
      } else if (n.kind === "entrance" && zoomLevel >= 17) {
        const entHtml = `
          <div class="ned-map-marker" title="Building Entrance (${n.id})">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="5" fill="var(--map-marker-entrance)" stroke="var(--map-surface-elevated)" stroke-width="1.75"/>
            </svg>
          </div>`;
        L.marker([n.lat, n.lng], {
          icon: L.divIcon({ className: "", iconSize: [0, 0], html: entHtml }),
          interactive: false,
        }).addTo(mkGroup);
      }
    }
  }, [isReady, graph, selectedLandmarkId, zoomLevel]);

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
      <div class="ned-map-marker" title="Route Start">
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
      <div class="ned-map-marker" title="Route Destination">
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
      fillOpacity: 0.85,
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

  const handleZoomIn = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomOut();
  }, []);

  const handleRecenter = useCallback(() => {
    if (mapRef.current) {
      const origin: [number, number] = graph?.meta?.origin || [24.9322, 67.1133];
      mapRef.current.setView(origin, 17, { animate: true });
    }
  }, [graph]);

  return (
    <div className="ned-outdoor-map-root">
      <div ref={containerRef} className="ned-leaflet-viewport" />

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
