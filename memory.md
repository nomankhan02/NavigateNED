# Project Memory

## Current State
- Repository foundation initialized with governance rules, contracts, and static export workflow.
- Task A1 delivered: Outdoor campus graph extracted to `data/graph.json` (86 nodes, 108 edges, 55 landmarks) with master plan image in `web/public/map/ned_master_plan.jpg`.
- Task A2a Slices (a) and (b) complete: Created `tools/generate_indoor.py` and generated indoor JSONs for all 6 target buildings in `data/indoor/`:
  - `b-csit.json` (CSIT & Maths, `ring` 70x44, 3 floors, 48 rooms, linked to `n21`)
  - `b-csit-labs.json` (CSIT Labs 5A, `U` 70x50, 2 floors, 32 rooms, linked to `n22`)
  - `b-library.json` (Central Library, `H` 70x56, 3 floors, 48 rooms, linked to `n76`)
  - `b-dean-offices.json` (Dean Offices, `L` 60x60, 2 floors, 32 rooms, linked to `n74`)
  - `b-admin.json` (Admin Block, `ring` 70x44 inner-wings variant, 3 floors, 54 rooms, linked to `n73`)
  - `b-auditorium.json` (Auditorium, `U` 70x50 auditorium variant, 2 floors, 26 rooms, linked to `n57`)

## Architectural & Data Notes
- Identifiers: Outdoor nodes use `n<number>` (`n1`..`n86`), landmarks use `b-<slug>`, indoor nodes use `<buildingId>:<local>`.
- Indoor Graph Rules: Each building has `meta.demo = true`, 1 entrance node (`<id>:ent`) linked by a 3.0m walk edge to its outdoor landmark `nodeId`, at least 2 emergency exits on floor 0, vertical stairs (`w=10, accessible:false`), and vertical lift (`w=15, accessible:true`).

## Open Tasks
- [ ] Member A (Task A2a Slice c): Extend `tools/validate.py` for indoor validation and generate/inspect floor preview PNGs in `tools/previews/`.
- [ ] Member A (Task A3/A4): Evacuation dataset (`data/evac.json`) and 2D map renderers (`web/src/map/`).
- [ ] Member B: Implement C++ DSA routing algorithms in `core/`.
- [ ] Member C: Design tokens, accessible navigation UI shell, and algorithm step visualizer.

## Known Issues
- Local Windows host lacks CMake/native compiler; C++ native tests and Emscripten WASM compile in GitHub Actions.
