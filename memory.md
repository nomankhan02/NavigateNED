# Project Memory

## Current State
- Repository foundation initialized with governance rules, contracts, and static export workflow.
- Task A1 delivered: Outdoor campus graph extracted to `data/graph.json` (86 nodes, 108 edges, 55 landmarks) with calibrated master plan image in `web/public/map/ned_master_plan.jpg`.
- Task A2a delivered: Indoor floor plans generated via `tools/generate_indoor.py` for 6 buildings in `data/indoor/` (`b-csit`, `b-csit-labs`, `b-library`, `b-dean-offices`, `b-admin`, `b-auditorium`) and visually verified via PNG floor previews in `tools/previews/` (gitignored).
- Task A2b delivered: Emergency evacuation dataset generated via `tools/generate_evac.py` in `data/evac.json` (7 assembly areas, 12 building exits across all 6 indoor buildings) and verified via `tools/validate.py` (84/84 exit-to-assembly pairs reachable across the unified indoor-outdoor graph).

## Delivery Note for Members B & C (Data Files & Formats)
1. **Outdoor Graph (`data/graph.json` & `web/public/data/graph.json`)**:
   - `meta`: `{ version: "1.0", origin: [24.9322, 67.1133], masterPlanControlCorners: { topLeft, topRight, bottomLeft, bottomRight }, mapOverlay: { image: "/map/ned_master_plan.jpg", corners } }`
   - `nodes` (86): `[{ id: "n1".."n86", lat, lng, kind: "path"|"entrance"|"gate"|"assembly"|"poi" }]`
   - `edges` (108): `[{ a, b, w (meters), oneway: false, covered: false }]`
   - `landmarks` (55): `[{ id: "b-<slug>", name, short, nodeId, category, footprint: [[lat,lng],...] }]`
2. **Indoor Graphs (`data/indoor/<buildingId>.json` for `b-admin`, `b-auditorium`, `b-csit`, `b-csit-labs`, `b-dean-offices`, `b-library`)**:
   - `meta`: `{ demo: true, template: "ring"|"U"|"L"|"H", width, height, corridorWidth: 3.6, roomWidth: 6.2 }`
   - `floors`: `[{ level: 0..2, label }]`
   - `nodes` (611 total): `[{ id: "<bid>:<local>", x, y, floor, type: "corridor"|"room"|"stairs"|"lift"|"entrance"|"exit", name? }]`
   - `edges`: `[{ a, b, kind: "walk"|"stairs"|"lift", w, accessible }]`. Includes 1 outdoor link `{ a: "<bid>:ent", b: "<outdoorNodeId>", kind: "walk", w: 3.0, accessible: true }`, stairs (`w: 10, accessible: false`), and lift (`w: 15, accessible: true`).
   - `rooms` (240 total): `[{ nodeId: "<bid>:<room>", rect: [x, y, w, h] }]`
3. **Evacuation Dataset (`data/evac.json`)**:
   - `assemblyAreas` (7): `[{ id: "a-<slug>", name, nodeId ("n80","n81","n28","n1","n2","n82","n77"), capacity (500..1800, total 6800) }]`
   - `buildingExits` (12): `[{ buildingId: "b-<slug>", nodeId: "<bid>:exit_*" }]` (2 ground-floor exits per indoor building).

## Open Tasks
- [ ] Member A (Task A4): Scalable 2D SVG / Canvas map renderers in `web/src/map/`.
- [ ] Member B: Implement C++ DSA routing algorithms in `core/`.
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host lacks CMake/native compiler; C++ native tests and Emscripten WASM compile in GitHub Actions.
