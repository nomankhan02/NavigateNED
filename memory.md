# Project Memory

## Current State
- Repository foundation initialized with governance rules, contracts, and static export workflow.
- Task A1 delivered: Outdoor campus graph extracted to `data/graph.json` (86 nodes, 108 edges, 55 landmarks) with master plan image in `web/public/map/ned_master_plan.jpg`.
- Task A2a delivered: Indoor floor plans generated via `tools/generate_indoor.py` for 6 buildings in `data/indoor/` and validated via `tools/validate.py` + visual PNG floor previews in `tools/previews/` (gitignored):
  - `b-csit.json` (CSIT & Maths, `ring` 70x44m, 3 floors, 129 nodes, 48 rooms, outdoor `n21`)
  - `b-csit-labs.json` (CSIT Labs 5A, `U` 70x50m, 2 floors, 77 nodes, 32 rooms, outdoor `n22`)
  - `b-library.json` (Central Library, `H` 70x56m, 3 floors, 132 nodes, 48 rooms, outdoor `n76`)
  - `b-dean-offices.json` (Dean Offices, `L` 60x60m, 2 floors, 67 nodes, 32 rooms, outdoor `n74`)
  - `b-admin.json` (Admin Block, `ring` 70x44m inner-wings variant, 3 floors, 135 nodes, 54 rooms, outdoor `n73`)
  - `b-auditorium.json` (Auditorium, `U` 70x50m auditorium variant, 2 floors, 71 nodes, 26 rooms, outdoor `n57`)

## Architectural & Data Notes
- Identifiers: Outdoor nodes `n<number>` (`n1`..`n86`), landmarks `b-<slug>`, indoor nodes `<buildingId>:<local>`.
- Indoor Topology: Each building sets `meta.demo = true`, has 1 `entrance` node linked by a 3.0m `walk` edge (`accessible: true`) to its outdoor landmark `nodeId`, 2 emergency `exit` nodes on floor 0, vertical `stairs` (`w=10, accessible: false`), and vertical `lift` (`w=15, accessible: true`).
- Validation: All 611 indoor nodes across 15 floors are reachable; all 240 rooms are reachable using only accessible edges and have zero geometric or label overlaps.

## Open Tasks
- [ ] Member A (Task A3): Evacuation checkpoints and assembly point datasets (`data/evac.json`).
- [ ] Member A (Task A4): Scalable 2D SVG / Canvas map renderers in `web/src/map/`.
- [ ] Member B: Implement C++ DSA routing algorithms in `core/`.
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host lacks CMake/native compiler; C++ native tests and Emscripten WASM compile in GitHub Actions.
