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
- Task A3d delivered: Footpath geometries, honest edge weights, validation, and geometry-aware map rendering.
- Task A4 delivered: Client-only SVG `IndoorMap` component, floor switcher, evacuation/trace overlays, and dev harness:
  - Component suite in `web/src/map/indoor/` (`IndoorMap.tsx`, `floors.tsx`, `labels.ts`, `route.ts`, `types.ts`, `indoor.css`, `index.ts`).
  - SVG pan/zoom renderer with smooth pointer/touch events, corridor strips, room rectangles, hand-drawn stairs/lift/entrance/exit SVG symbols, and demo model badge (`meta.demo`).
  - Multi-floor routing with animated strokes, stair/lift vertical transition connector badges (clickable floor switch), and pulsing `userNode` ("I am here") marker.
  - Evacuation hazard overlays (exit node highlight rings, blocked corridors/rooms, assignment paths) and algorithm trace replay layer (`useTraceReplay`).
  - Temporary dev verification harness at `web/src/app/_map-dev/indoor/page.tsx` (and `web/src/app/%5Fmap-dev/indoor/page.tsx`).
- Task A4b delivered: Indoor map fixes (hover jitter elimination, room label boundary clipping, and room popover):
  - Hover jitter eliminated: Removed conflicting CSS transforms on SVG transform-positioned elements; added transparent hit-area primitives with `pointer-events: none` on inner visuals across stairs, lift, entrance, exit, transition badges, and markers; respected `prefers-reduced-motion`.
  - Room label fitting & clipping: Computed room screen bounds at current zoom; fitted text using 2-line wrapped full names down to 9px min, short names, or short codes; centered labels within room rects; enforced strict clipping via SVG `<clipPath>` to prevent room overflow; recomputes on debounced zoom end (never during pan).
  - Room popover: Floating details tooltip displays full room name, floor, capacity, and ID on room hover or tap.
- Task B1, B2, B3, B4 & B5 delivered: Single-file C++17 routing, DSA, evacuation, turn-by-turn directions, GPS progress & viva CLI showcase engine (`core/src/navcore.cpp`), Doctest suite (`core/tests/test_main.cpp`), and CI (`.github/workflows/core.yml`):
  - Merged 697-node graph (`data/graph.json` 86 outdoor nodes + 6 `data/indoor/*.json` 611 indoor nodes) linked via 3 m entrance edges, plus `data/evac.json` (7 assembly areas, 12 building exits) and optional outdoor edge `geometry` polylines.
  - Routing: Dijkstra, A* (admissible Haversine heuristic), BFS (fewest hops), Bellman-Ford (with negative cycle detection), and Floyd-Warshall (`algo: "floyd"`), all supporting `accessible: true`, `avoid` / `blockedEdges`, and optional `AlgoStats*` telemetry (`nodesVisited`, `edgesRelaxed`, `heapPushes`, `heapPops`, `elapsedUs`), memoized by an O(1) LRU cache (invalidated when blocked sets change).
  - Additional DSA: Prefix Trie (`search`), Floyd-Warshall landmark matrix (`allPairs`), Union-Find + Kruskal/Prim (`mst`), Held-Karp bitmask DP & Nearest-Neighbor (`tsp` with heuristic gap %), and Tarjan's articulation points & bridges (`criticalPoints`). Fully deterministic tie-breaking across platforms.
  - Emergency Evacuation (Task B3): Multi-Source Dijkstra on the reversed graph (`nearest` mode & `nearestAssembly`) and Min-Cost Max-Flow via Successive Shortest Paths / Bellman-Ford SPFA (`capacity` mode) with `disableLifts` (default `true`), indoor `exitNodeId` detection, and side-by-side `evacuationCompare`.
  - Turn-by-Turn Directions & GPS Progress (Task B4): Geometry-aware bearing classification (`directions` with `start`, `straight`, `slight-left/right`, `left/right`, `sharp-left/right`, `enter-building`, `stairs-up/down`, `lift`, `arrive` and 40 m nearest-landmark naming without raw node IDs), polyline projection with noise/backward-jump filtering (`progress`), and GPS live rerouting (`reroute`).
  - Viva CLI Showcase (Task B5 — `g++ -std=c++17 -O2 -DNAVCORE_CLI -I core/third_party core/src/navcore.cpp -o navcore_cli`): ANSI-colored human-readable output by default (`--json` for raw JSON, `--no-color` to disable ANSI), labeled DSA concept headers, 100x40 ASCII campus map renderer (`route`, `directions`, `tsp`, `mst`, `evacuate`), live trace animation (`--animate [--speed <x>]` on `route` & `compare`), benchmark comparison table & capacity load bars, and scripted 8-part viva `demo` (`navcore_cli demo [--auto]`).
- Task C1 (Step 0 & Slice a) delivered:
  - Step 0(a) Skill Audit: Checked Antigravity built-in skills (`generative_ui` is for chat HTML embeds only) and Marketplace (`search_marketplace` for frontend/design/motion skills returned `[]`); no workspace frontend UI skills exist, proceeding directly with the "Campus Survey Plate" specification.
  - Step 0(b) & Slice (a): Installed self-hosted `@fontsource/bricolage-grotesque`, `@fontsource/familjen-grotesk`, and `@fontsource/azeret-mono`; defined Daylight & Night Survey Plate tokens, Frosted Tracing Vellum rules (`body[data-map-interacting="true"]` blur disable), 4px spacing, 2-4px crisp radii, 45° chamfer clip-paths, and unified `--map-*` / `--map-indoor-*` tokens in `web/src/styles/tokens.css`; documented full spec in `design.md`.
  - Slice (b) Icons: Created 31 hand-drawn inline SVG survey & architectural icons on a unified `24x24` grid (`strokeWidth: 1.75`, `strokeLinecap: "round"`, `strokeLinejoin: "round"`) in `web/src/ui/icons/` (`types.ts`, `navigation.tsx`, `campus.tsx`, `controls.tsx`, `index.tsx`).
  - Slice (c) Components & `/kit`: Built accessible Survey Plate UI library in `web/src/ui/` (`Button`, `IconButton`, `Toggle`, `SegmentedControl`, `Chip`, `Field`, `SearchField`, `Panel`, `Sheet`, `Badge`, `StatReadout`, `ListRow`, `Divider`, `Toast`, `SurveyLoader`, `ThemeSwitch`) and live token/component showcase at `web/src/app/kit/page.tsx`.
  - Slice (d) App Shell: Built Campus Survey Plate home shell (`web/src/app/page.tsx`, `web/src/ui/shell/AppShell.tsx`, `web/src/ui/shell/shell.module.css`) over full-bleed `OutdoorMap` (`/data/graph.json`) with title-block header strip (`<700ms` hairline draw-in & compass settle intro animation), edge-attached frosted vellum left panel on desktop / 3-snap draggable bottom sheet on phone, mode tabs (`Navigate`, `Explore`, `Evacuate`), "Where to" search, From/To fields, and `Azeret Mono` route summary readouts.
- Task C1b (Sidebar Polish) delivered:
  - Floating search dropdown on `Where to`, `From`, and `To` fields (`web/src/ui/Fields.tsx`) indexing buildings and indoor rooms with keyboard highlight/select/close (`ArrowUp`/`ArrowDown`/`Enter`/`Escape`), outside-click dismissal, automatic upward/viewport-clamped placement on the phone `Sheet`, and rows displaying number badge, clean name, and kind (`Building` or `Room · <Building>`).
  - Three-level panel visual hierarchy (panel base, elevated section cards, recessed inset wells) with numbered tick-mark headers (`01 ROUTE`, `02 ALGORITHM`, `03 OPTIONS`, `04 SUMMARY`, `05 LANDMARKS`), solid vermilion fills on active tab & selected algorithm, solid teal fills on active toggles & filter chips, type-coded readout cards (`Distance`, `Walk time`, `Floors`, `Visited`), readable sentence-case labels, zero user-visible internal IDs, and collapsible/scrollable `05 LANDMARKS` with full-width `"Set as destination"` buttons.
- Task C1c (Harbor Chart Theme, Fixes & Isometric Brand Mark) delivered:
  - Rethemed `web/src/styles/tokens.css` & `design.md` to Theme 2 (**Harbor Chart**, day & night palettes + unified `--map-*` / `--map-indoor-*` tokens).
  - Fixed `Toggle` (`transform` only, 180ms ease, `prefers-reduced-motion`), `SearchField` focus ring (single outer 2px route-colour ring, no inner cursor bars, `/` keycap preserved), and unified `ThemeProvider` (`try/catch` localStorage, `prefers-color-scheme`, inline pre-paint script in `layout.tsx`, accurate `ThemeSwitch` icon & `aria-label` synced across `/kit` and shell).
  - Created 30° 3D isometric extruded `"N"` `BrandLogo` (`web/src/ui/icons/BrandLogo.tsx`, full 24px/64px + simplified 16px, staggered 4px face rise intro `<700ms`), `web/public/favicon.svg`, and `web/public/apple-touch-icon.png` (180x180).
- Task C1d (Mobile & Layout Overlap Fixes) delivered:
  - Responsive header across 320–1280px (below 560px: logo + `NavigateNED` + 3 icon buttons with `>=44px` tap targets; 560–900px: + buildings badge; >900px: + coordinates & `"UI Kit"` label).
  - Desktop panel scroll padding clears the fixed footer strip; phone moves status line inline at the end of the sheet scroll area with `env(safe-area-inset-bottom)`.
  - Single drag/tap handle on the phone bottom sheet (`peek -> half -> expanded -> peek`), coordinating map controls (`44px` icon-only Campus Key top-left, layer switcher top-right, zoom/locate above `--map-bottom-inset`, hidden when sheet is expanded).
  - `/kit` solid sticky/fixed header with top-padded content and `320px`-safe wrapping grids; disabled Next.js `devIndicators` in `web/next.config.ts`.

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
6. **IndoorMap Usage (for Member C)**:
   - Import from `@/map`: `import { IndoorMap, type IndoorBuilding, type IndoorMapProps } from "@/map";`
   - Static indoor data: Load from `/data/indoor/<buildingId>.json` (6 buildings: `b-admin`, `b-auditorium`, `b-csit`, `b-csit-labs`, `b-dean-offices`, `b-library`).
   - Props: `<IndoorMap building={building} floor={activeFloor} onFloorChange={(fl) => ...} route={indoorNodeIds} highlightedNodeIds={ids} selectedRoomId={roomId} onRoomClick={(id, node) => ...} userNode={nodeId} evacuation={evacData} trace={traceReplay} />`
   - Styling: Uses standard `--map-*` tokens with fallbacks defined in `web/src/map/indoor/indoor.css`.
   - **Dev Harness Note**: `web/src/app/_map-dev/indoor/page.tsx` (and Next.js App Router underscore route forwarder `web/src/app/%5Fmap-dev/indoor/page.tsx`) is a temporary verification page added by Member A as an allowed exception; **Member C may freely remove or replace it**.
7. **C++ WASM `call(fn, argsJson)` API Examples (for Member C)**:
   - `call("ping", "{}")` -> `{"status":"pong","version":"1.0.0"}`
   - `call("load", graphOrIndoorJson)` -> `{"status":"ok","nodeCount":697,"edgeCount":859,"indoorBuildings":6,"landmarkCount":55}` (pass outdoor `graph.json` first, then each indoor JSON to merge).
   - `call("route", '{"from":"b-csit:201","to":"n1","algo":"dijkstra|astar|bfs|bellmanford|floyd","accessible":false,"avoid":["n12"]}')` -> `{"found":true,"distance":294.2,"path":["b-csit:201",...,"n1"],"steps":["Walk indoors...",...],"trace":[{"type":"visit|relax|frontier","node":"...","dist":0.0}],"negativeCycle":false}`
   - `call("compare", '{"from":"b-csit","to":"b-library","accessible":false}')` -> `{"results":{"dijkstra":{"found":true,"distance":312.4,"nodesVisited":42,"visitedCount":42,"timeUs":38.5,"timeMs":0.0385,"hops":9},"astar":{...},"bfs":{...},"bellmanford":{...},"floyd":{...}}}`
   - `call("search", '{"query":"11","limit":5}')` -> `{"results":[{"id":"b-auditorium","label":"Main Auditorium","name":"Main Auditorium","kind":"landmark","type":"landmark","number":"11","nodeId":"n57"},...]}` (rooms include `"buildingId":"b-csit"`).
   - `call("cacheStats", "{}")` -> `{"hits":3,"misses":2,"size":2,"capacity":128,"evictions":0,"invalidations":0}` (supports `{"reset":true,"capacity":64}`).
   - `call("allPairs", "{}")` -> `{"matrix":{"b-csit":{"b-library":312.4,"b-admin":198.0,...}}, "landmarkCount":55}` (unreachable entries are `null`).
   - `call("mst", '{"algo":"kruskal|prim"}')` -> `{"algo":"kruskal","totalWeight":4120.5,"totalLength":4120.5,"edgeCount":85,"edges":[{"a":"n1","b":"n2","w":45.2},...]}`
   - `call("tsp", '{"stops":["n1","b-csit","b-library"],"algo":"dp|nn","returnToStart":false}')` -> `{"found":true,"order":["n1","b-csit","b-library"],"orderedStops":[...],"totalDistance":485.6,"dpDistance":485.6,"nnDistance":510.2,"heuristicGapPercent":5.06,"path":["n1",...]}`
   - `call("criticalPoints", "{}")` -> `{"articulationPoints":["n12",...],"bridges":[["n1","n2"],...],"landmarkNames":{"n57":"Main Auditorium",...},"nodes":[...],"edges":[...]}`
   - `call("nearestAssembly", '{"from":"b-library:204","blocked":{"nodes":[],"edges":[]},"disableLifts":true}')` -> `{"found":true,"from":"b-library:204","assemblyId":"a-courtyard-fountain","assemblyName":"Courtyard Fountain Central Plaza","nodeId":"n28","capacity":600,"distance":263.5,"path":["b-library:204",...,"n28"],"steps":[...],"exitNodeId":"b-library:exit_nw"}`
   - `call("evacuate", '{"mode":"nearest|capacity","blocked":{"nodes":["n28"],"edges":[["n1","n2"]]},"people":[{"at":"b-library:204","count":450},{"at":"b-csit:201","count":400}],"disableLifts":true}')` -> `{"mode":"capacity","assignments":[{"from":"b-library:204","assemblyId":"a-soccer-field","assemblyName":"Soccer Field & Athletics Track","count":450,"distance":312.4,"path":["b-library:204",...],"exitNodeId":"b-library:exit_nw"},...],"unassigned":0,"assemblyLoad":[{"id":"a-bank-gate","assigned":0,"capacity":700},...],"totalDistance":245100.0}` (Note: calling `call("load", evacJsonStr)` merges `data/evac.json` into the loaded graph without clearing nodes/edges).
   - `call("evacuationCompare", '{"blocked":{"nodes":[],"edges":[]},"people":[{"at":"b-library:204","count":500},{"at":"b-csit:201","count":500}],"disableLifts":true}')` -> `{"nearest":{...},"capacity":{...},"totalDistance":{"nearest":...,"capacity":...},"maxAssemblyLoad":{"nearest":1000,"capacity":600},"overloadedAreasCount":{"nearest":1,"capacity":0}}`
   - `call("directions", '{"from":"b-csit:201","to":"n1","algo":"dijkstra","accessible":false}')` (or `{"route":<routeResult>}`) -> `{"maneuvers":[{"type":"start|straight|slight-left|left|sharp-left|slight-right|right|sharp-right|enter-building|stairs-up|stairs-down|lift|arrive","text":"Turn left at Courtyard Fountain...","distanceM":42.5,"atNodeId":"n28","lat":24.9325,"lng":67.1135,"landmark":"Courtyard Fountain"},...]}`
   - `call("progress", '{"route":<routeResult>,"lat":24.9325,"lng":67.1135,"accuracyM":8.0,"lastIndex":2}')` -> `{"distanceAlongM":120.4,"remainingM":173.8,"nextManeuverIndex":3,"distanceToNextM":34.2,"offRoute":false,"offRouteDistanceM":3.1,"arrived":false,"lastIndex":4}`
   - `call("reroute", '{"from":{"lat":24.9325,"lng":67.1135},"to":"b-library","accessible":false}')` -> `{"snappedNodeId":"n28","snapDistanceM":4.2,"route":{...},"directions":{"maneuvers":[...]},"maneuvers":[...]}`

## Open Tasks
- [x] Member A (Task A4 & A4b): Indoor floor-plan SVG map component and fixes in `web/src/map/`.
- [x] Member A/B (Task B1–B5): Single-file C++17 routing, DSA, evacuation, directions, GPS progress & viva CLI showcase (`core/src/navcore.cpp`).
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host uses MinGW-w64 `g++ 16.2.0` for native C++17 tests and CLI; Emscripten WASM compiles in GitHub Actions.
