# Project Memory

## Current State
- Repository foundation initialized with governance rules, contracts, and static export workflow.
- Task A1 delivered: Outdoor campus graph extracted to `data/graph.json` (86 nodes, 108 edges, 55 landmarks).
- Calibrated master plan map image committed to `web/public/map/ned_master_plan.jpg` with corner coordinates in `data/graph.json` meta.
- Automated extractor `tools/extract_ned.py` and validator `tools/validate.py` built and passing.
- Next.js static export verified with updated public assets.

## Architectural & Data Notes
- Identifiers: Outdoor nodes use `n<number>` (`n1`..`n86`), landmarks use `b-<slug>` (e.g., `b-csit`, `b-admin`, `b-library`).
- Graph Topology: Fully connected single component verified by BFS. Every landmark has a designated entrance node.
- Distance Metrics: Great-circle Haversine formula strictly computed in meters for all edges.
- Raster Alignment: `meta.masterPlanControlCorners` provides 4-corner affine control coordinates for 2D map overlay.
- Contract alignment: `category` values normalized to contract standards (`academic`, `services`, `labs`, `gate`, `assembly`, `library`, etc.).

## Open Tasks
- [ ] Member A (Task A2/A3): Indoor floor plans (`data/indoor/*.json`) and evacuation checkpoints (`data/evac.json`).
- [ ] Member A (Task A4): 2D Canvas / SVG map renderer in `web/src/map/`.
- [ ] Member B: Implement C++ DSA routing algorithms in `core/` (Dijkstra, A*, BFS, Bellman-Ford, Floyd-Warshall, MST, TSP, Trie, Max-Flow).
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host lacks CMake/native compiler; C++ native tests and Emscripten WASM compile in GitHub Actions.
