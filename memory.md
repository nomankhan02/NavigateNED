# Project Memory

## Current State
- Repository foundation initialized with governance rules, contracts, and static export workflow.
- Task A1 delivered: Outdoor campus graph (`data/graph.json`, 86 nodes, 108 edges, 55 landmarks) + master plan image (`web/public/map/ned_master_plan.jpg`).
- Task A2a delivered: Indoor floor plans generated via `tools/generate_indoor.py` for 6 buildings in `data/indoor/` and visually verified via PNG floor previews.
- Task A2b delivered: Emergency evacuation dataset generated via `tools/generate_evac.py` in `data/evac.json` (7 assembly areas, 12 building exits across all 6 indoor buildings) and validated via `tools/validate.py`.
- Task A3 Slice (a) complete: Installed `leaflet` + `@types/leaflet`, created `web/src/map/types.ts`, `web/src/map/map.css`, `web/src/map/OutdoorMap.tsx`, and `web/src/map/index.ts` implementing the client-only Leaflet map, 4-corner affine master plan image overlay, canvas-rendered walkway graph edges, landmark footprint polygons with hover/selected states and zoom-dependent collision-free short labels, entrance/gate/assembly markers, and custom hand-drawn SVG zoom/recenter controls.
- Task A3 Slice (b) complete: Added animated route polyline (`route?: string[]` with casing + `stroke-dashoffset` draw-on effect and `START`/`END` SVG badges), highlighted nodes (`highlightedNodeIds?: string[]`), and user location dot with accuracy circle (`userLocation?: { lat, lng, accuracyMeters? }`) to `web/src/map/OutdoorMap.tsx` using `--map-*` CSS variables.

## Delivery Note for Members B & C (Data Files & Formats)
1. **Outdoor Graph (`data/graph.json` & `web/public/data/graph.json`)**: 86 nodes (`n1`..`n86`), 108 edges (`w` in meters), 55 landmarks (`b-<slug>`), and `masterPlanControlCorners` in `meta`.
2. **Indoor Graphs (`data/indoor/<buildingId>.json` for 6 buildings)**: 611 nodes (`<bid>:<local>`), 240 rooms (`rect: [x,y,w,h]`), 3m outdoor entrance link, `stairs` (`w=10, accessible:false`), and `lift` (`w=15, accessible:true`).
3. **Evacuation Dataset (`data/evac.json`)**: 7 `assemblyAreas` (capacity 6,800) and 12 `buildingExits` across the 6 indoor buildings.

## Open Tasks
- [ ] Member A (Task A3 Slice c): Add evacuation overlay (blocked hazard lines + assignment paths) and `useTraceReplay` hook.
- [ ] Member A (Task A3 Slice d): Add dev harness `web/src/app/_map-dev/page.tsx`, verify `next build`, and inspect phone/desktop Playwright screenshots in `tools/previews/`.
- [ ] Member B: Implement C++ DSA routing algorithms in `core/`.
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host lacks CMake/native compiler; C++ native tests and Emscripten WASM compile in GitHub Actions.
