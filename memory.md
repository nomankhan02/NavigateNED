# Project Memory

## Current State
- Repository foundation initialized with governance rules, contracts, and static export workflow.
- Task A1 delivered: Outdoor campus graph (`data/graph.json`, 86 nodes, 108 edges, 55 landmarks) + master plan image (`web/public/map/ned_master_plan.jpg`).
- Task A2a delivered: Indoor floor plans generated via `tools/generate_indoor.py` for 6 buildings in `data/indoor/` and visually verified via PNG floor previews.
- Task A2b delivered: Emergency evacuation dataset generated via `tools/generate_evac.py` in `data/evac.json` (7 assembly areas, 12 building exits across all 6 indoor buildings) and validated via `tools/validate.py`.
- Task A3 delivered: Client-only `OutdoorMap` component (`web/src/map/OutdoorMap.tsx`), `useTraceReplay` hook (`web/src/map/useTraceReplay.ts`), CSS token stylesheet (`web/src/map/map.css`), and barrel exports (`web/src/map/index.ts`).
- Task A3b delivered: Basemap switching, north-up warped master plan (`tools/warp_master_plan.py`), priority-ranked label collision logic, merged markers, and zoom animations.
- Task A3c delivered:
  - **CARTO Basemap & Tile Speed**: Switched street basemap to CARTO `light_nolabels` (`https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png`, subdomains `abcd`, OSM & CARTO attributions) so only custom vector labels show; added `keepBuffer: 4`, `updateWhenIdle: false`, `updateWhenZooming: false`, tile background color (`#f2ede5` / `#101c15`), and zoom 17 tile preloading across campus bounds.
  - **Official Building Numbers**: Extracted TraverseNED's `blockNumber` (`"1"`..`"30"`, `"5A"`, `"LIB"`, `"G1"`, etc.) as stable `number` property on all 55 landmarks in `data/graph.json` & `web/public/data/graph.json`. At `zoom < 18`, map displays compact number badges; at `zoom >= 18` (or on hover/selected/route), expands to number badge + full landmark name.
  - **Collapsible Key (Legend) Control**: Built a searchable, category-grouped legend panel with custom 1.75px stroke SVGs and `--map-*` theme tokens. Clicking an entry smoothly flies to and highlights the landmark. Renders as a side panel on desktop and a bottom drawer on mobile. Dev harness defaults unticked for raw walkways and master plan overlay.

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

## Open Tasks
- [ ] Member A (Task A4): Indoor floor-plan SVG map component in `web/src/map/`.
- [ ] Member B: Implement C++ DSA routing algorithms in `core/`.
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host lacks CMake/native compiler; C++ native tests and Emscripten WASM compile in GitHub Actions.
