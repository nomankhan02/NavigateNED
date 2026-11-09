# NavigateNED Implementation Roadmap

## Member A: Data & GIS Engineering
- [ ] Task A.1: NED University outdoor campus survey and graph extraction (`data/graph.json`).
- [ ] Task A.2: Indoor floor plans and schemas for academic blocks (`data/indoor/*.json`).
- [ ] Task A.3: Evacuation checkpoints and assembly point datasets (`data/evac.json`).
- [ ] Task A.4: Scalable 2D SVG / Canvas map renderers in `web/src/map/`.

## Member B: C++ Core Algorithms & WASM Bridge
- [ ] Task B.1: Core graph data structures with adjacency lists and edge cost metrics in `core/`.
- [ ] Task B.2: Single-source shortest path engines (Dijkstra, A*, BFS, Bellman-Ford) with step tracer.
- [ ] Task B.3: All-pairs shortest paths (Floyd-Warshall) and Minimum Spanning Trees (Kruskal/Prim).
- [ ] Task B.4: Traveling Salesperson Problem (TSP) heuristic and articulation point / bridge detection.
- [ ] Task B.5: Trie-based search index for campus landmarks and facilities.
- [ ] Task B.6: Emergency evacuation routing (min-cost / max-flow network assignment).
- [ ] Task B.7: WASM compilation pipeline verification and performance profiling.

## Member C: Web Architecture & UI Experience
- [ ] Task C.1: Design token system (colors, institutional typography, elevation, spacing) in plain CSS.
- [ ] Task C.2: Unified custom hand-drawn SVG icon system.
- [ ] Task C.3: Responsive shell, accessible search bar, and waypoint picker.
- [ ] Task C.4: Algorithm visualizer mode (displaying step-by-step frontier, visit, and relax events).
- [ ] Task C.5: Emergency evacuation view mode with route highlighting and status panels.
- [ ] Task C.6: Static export build validation, Vercel deployment pipeline, and final project documentation.
- [ ] Task C.7: Service worker caching and offline PWA capability (deferred to subsequent milestone).

