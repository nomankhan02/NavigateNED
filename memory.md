# Project Memory

## Current State
- Repository foundation initialized with governance rules, contracts, and static export workflow.
- Task A1 delivered: Outdoor campus graph (`data/graph.json`, 86 nodes, 108 edges, 55 landmarks) + master plan image (`web/public/map/ned_master_plan.jpg`).
- Task A2a delivered: Indoor floor plans generated via `tools/generate_indoor.py` for 6 buildings in `data/indoor/` and visually verified via PNG floor previews.
- Task A2b delivered: Emergency evacuation dataset generated via `tools/generate_evac.py` in `data/evac.json` (7 assembly areas, 12 building exits across all 6 indoor buildings) and validated via `tools/validate.py`.
- Task A3 delivered: Client-only `OutdoorMap` component (`web/src/map/OutdoorMap.tsx`), `useTraceReplay` hook (`web/src/map/useTraceReplay.ts`), CSS token stylesheet (`web/src/map/map.css`), and barrel exports (`web/src/map/index.ts`).
- Task A3b delivered: Basemap switching, north-up warped master plan (`tools/warp_master_plan.py`), priority-ranked label collision logic, merged markers, and zoom animations.
- Task A3c delivered: Building numbers on landmarks (`number`), badge-only rendering at zoom < 18, and collapsible searchable Key directory.
- Task A3e delivered: Switched default street basemap to Esri World Light Gray Base (`clean`) and dropped CARTO due to API key watermarks.
- Task A3d delivered: Footpath geometries, honest edge weights, validation, and geometry-aware map rendering:
  - Multi-point realistic geometry on 77/108 edges (32 OSM-snapped, 45 corner detours) and 31 straight-line fallbacks.
  - Validation checks in `tools/validate.py` for edge geometry, campus bounds, and honest cumulative Haversine weights.
  - Helper functions in `web/src/map/geometry.ts` resolving edge geometries, orienting segments (reversing for b->a traversals), joining route/evacuation paths, and falling back to straight lines.
  - `OutdoorMap.tsx` renders routes, trace replay segments, evacuation paths (blocked edges & assignments), and debug graph using `geometry`.

## Delivery Note for Members B & C
1. **Outdoor Graph (`data/graph.json` & `web/public/data/graph.json`)**: 86 nodes (`n1`..`n86`), 108 edges (`w` in meters), 55 landmarks (`b-<slug>`), and `masterPlanControlCorners` in `meta`.
2. **Indoor Graphs (`data/indoor/<buildingId>.json` for 6 buildings)**: 611 nodes (`<bid>:<local>`), 240 rooms (`rect: [x,y,w,h]`), 3m outdoor entrance link, `stairs` (`w=10, accessible:false`), and `lift` (`w=15, accessible:true`).
3. **Evacuation Dataset (`data/evac.json`)**: 7 `assemblyAreas` (capacity 6,800) and 12 `buildingExits` across the 6 indoor buildings.
4. **OutdoorMap & Trace Replay Usage (for Member C)**:
   - Import from `@/map`: `import { OutdoorMap, useTraceReplay, type OutdoorMapProps, type CampusGraph } from "@/map";`
   - Props: `<OutdoorMap graph={graph} route={pathIds} highlightedNodeIds={ids} selectedLandmarkId={lmId} onLandmarkClick={(id, lm) => ...} onMapClick={({ lat, lng }) => ...} showGraph={true} userLocation={{ lat, lng, accuracyMeters }} evacuation={{ blockedNodes, blockedEdges, assignments }} trace={traceReplay} />`
   - Hook: `const traceReplay = useTraceReplay(routeResult.trace, 1);` exposes `{ isPlaying, currentIndex, totalEvents, speedMultiplier, visitedNodeIds, frontierNodeIds, relaxedNodeIds, activeNodeId, play, pause, toggle, reset, seek, setSpeed }`.
   - Styling: Override `--map-*` CSS variables in global theme tokens (`web/src/map/map.css` provides fallbacks).
   - **Dev Harness Note**: `web/src/app/_map-dev/page.tsx` (and Next.js App Router underscore route forwarder `web/src/app/%5Fmap-dev/page.tsx`) is a temporary verification page added by Member A as an allowed exception; **Member C may freely remove or replace it**.
5. **Edge Geometry & Honest Weights Note (for Members B & C)**:
   - **Edge `w` now follows geometry**: Edge weight `w` is the true walking distance in meters (cumulative Haversine sum along multi-point geometry).
   - **`geometry` is optional display data**: `geometry` is an array of `[lat, lng]` coordinates strictly for rendering curved paths on maps; routing logic in C++ (`core/`) and frontend UI needs only `w` for graph traversal, edge costs, and shortest paths.
   - **What changed in `data/graph.json`**:
     - 77 of 108 edges enriched with multi-point `geometry` coordinates (32 snapped to real OSM walkways, 45 avoiding building footprints via perimeter corner waypoints).
     - 31 edges have 2-point straight-line fallback geometries.
     - All edge weights `w` recomputed to honest walking distances along their geometry in meters.
     - Nodes, landmarks, and metadata structure preserved with 100% backward compatibility.

## Open Tasks
- [ ] Member A (Task A4): Indoor floor-plan SVG map component in `web/src/map/`.
- [ ] Member B: Implement C++ DSA routing algorithms in `core/`.
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host lacks CMake/native compiler; C++ native tests and Emscripten WASM compile in GitHub Actions.
