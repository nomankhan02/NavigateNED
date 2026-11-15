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
- Task B1 & B2 delivered: Single-file C++17 routing & DSA engine (`core/src/navcore.cpp`), Doctest suite (`core/tests/test_main.cpp`), and CI (`.github/workflows/core.yml`):
  - Merged 697-node graph (`data/graph.json` 86 outdoor nodes + 6 `data/indoor/*.json` 611 indoor nodes) linked via 3 m entrance edges.
  - Routing: Dijkstra, A* (admissible Haversine heuristic), BFS (fewest hops), Bellman-Ford (with negative cycle detection), and Floyd-Warshall (`algo: "floyd"`), all supporting `accessible: true` and `avoid` / `blockedEdges`, memoized by an O(1) LRU cache (invalidated when blocked sets change).
  - Additional DSA: Prefix Trie (`search`), Floyd-Warshall landmark matrix (`allPairs`), Union-Find + Kruskal/Prim (`mst`), Held-Karp bitmask DP & Nearest-Neighbor (`tsp` with heuristic gap %), and Tarjan's articulation points & bridges (`criticalPoints`).
  - CLI (`g++ -std=c++17 -O2 -DNAVCORE_CLI -I core/third_party core/src/navcore.cpp -o navcore_cli`): supports `ping`, `route`, `compare`, `search`, `cacheStats`, `allPairs`, `mst`, `tsp`, `criticalPoints`.

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

## Open Tasks
- [x] Member A (Task A4 & A4b): Indoor floor-plan SVG map component and fixes in `web/src/map/`.
- [x] Member A/B (Task B1 & B2): Single-file C++17 routing & DSA core (`core/src/navcore.cpp`) with Dijkstra, A*, BFS, Bellman-Ford, Floyd-Warshall, Trie, LRU Cache, Union-Find/MST, TSP, and Tarjan.
- [ ] Member A/B (Task B3): Emergency evacuation algorithm (`evacuate`) in `core/src/navcore.cpp`.
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host uses MinGW-w64 `g++ 16.2.0` for native C++17 tests and CLI; Emscripten WASM compiles in GitHub Actions.
