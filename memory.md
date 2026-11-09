# Project Memory

## Current State
- Repository initialized with foundation rules, agent boundaries, and data/API contracts.
- C++17 core scaffolded with native test suite (Doctest) and WASM bridge (`call()`).
- Emscripten GitHub Actions CI workflow configured to test and compile WASM artifact to `web/public/wasm/navcore.js`.
- Next.js 15+ App Router web application initialized with static HTML export (`output: "export"`).
- WASM loader and typed bridge implemented in `web/src/core/`.
- Sample 4-node campus graph defined in `data/sample/graph.json`.
- Minimal placeholder wasm runtime committed to `web/public/wasm/` for initial local verification pending GitHub Actions execution.

## Architectural Decisions
- Single entry point C++ WASM API via `std::string call(const std::string& fn, const std::string& argsJson)`.
- Zero local C++ build tool requirement for frontend development; CI builds and commits compiled WASM.
- Headless UI + vanilla CSS modules + custom unified SVG icon system (no Tailwind/icon libraries).
- In-memory WASM caching and browser fetch caching for JSON graphs; service worker deferred to future task.

## Open Tasks
- [ ] Member A: Map campus geo-boundaries, populate `data/graph.json` and indoor JSON specs.
- [ ] Member B: Implement C++ DSA algorithms in `core/` (Dijkstra, A*, BFS, Bellman-Ford, Floyd-Warshall, Kruskal/Prim MST, TSP, Trie search, Max-Flow / Evacuation).
- [ ] Member C: Establish typography and CSS design tokens in `design.md`, build accessible UI layout and visualizer.
- [ ] Verify first GitHub Actions run on remote push to generate production Emscripten WASM binary.

## Known Issues
- Local Windows environment lacks CMake / working native compiler; native builds and WASM compilation will run via GitHub Actions.

