# NavigateNED

Georeferenced outdoor and multi-floor indoor campus navigation, algorithm visualizer, and emergency evacuation planner for NED University of Engineering & Technology.

- **Live Demo:** https://navigate-ned.vercel.app/
- **Repository:** https://github.com/nomankhan02/NavigateNED

| Field | Details |
| :--- | :--- |
| **University** | NED University of Engineering and Technology |
| **Course** | CT-159 Data Structures and Algorithms (DSA) — Complex Computing Problem |
| **Topic** | Campus Navigator |
| **Section** | B |
| **Instructor** | Muhammad Imran |

### Team

| Name | Roll Number |
| :--- | :--- |
| Noman Khursheed | CT-25093 |
| Laiba Akram | CT-25060 |
| Bushra Abid | CT-25057 |

---

## 2. Problem Statement & Objectives

Large university campuses combine open outdoor walkways, multi-story academic buildings, and emergency muster zones, yet students, visitors, and drill coordinators rarely have a unified tool for turn-by-turn routing or evacuation planning.

**Objectives:**
1. Model the NED University campus as a unified outdoor + indoor weighted graph (`697` nodes: `86` outdoor junctions and `611` indoor nodes across `6` buildings).
2. Implement all graph, routing, search, caching, and evacuation algorithms strictly in C++17 (`core/src/navcore.cpp`), compiled both natively for testing/CLI and to WebAssembly (`web/public/wasm/navcore.js`) for the browser.
3. Provide an interactive web interface (`Next.js` static export) with turn-by-turn directions, algorithm trace visualization, algorithm benchmarking, and an emergency evacuation guide.

---

## 3. Features

- **Navigate:** Origin/destination search across `55` campus landmarks and `240` indoor rooms, `5` selectable routing algorithms (`A*`, `Dijkstra`, `BFS`, `Bellman-Ford`, `Floyd-Warshall`), accessibility toggle (`Avoids stairs`), perimeter access-point arrival (`toLandmark` + `12 m` destination footprint trimming), and step-by-step `RouteCard` maneuvers.
- **Explore:** Category-filtered campus directory, building footprints, numbered map badges, and direct `"Directions to here"` / `"Open indoor map"` actions.
- **Evacuate:**
  - **Go to assembly (default):** 3-step emergency guide, `"Where are you?"` building/room search or browser GPS snap, `"Show me the way out"` routing to the nearest non-full assembly area, `"Area is full, find next"` cycling, and indoor exit highlighting (stairs-only, lifts disabled).
  - **Campus simulation (secondary tab):** Multi-group scenario builder with presets, tap-to-block map edges/junctions, `Nearest assembly` vs `Capacity-aware` comparison, per-area load bars, and canvas particle flow animation.
- **Algorithm Visualizer & Compare:** Step-by-step replay (`Play`/`Pause`, step forward/back, `0.5x`/`1x`/`2x`/`5x` speeds, scrubber) of visited and frontier nodes on `OutdoorMap`, plus a `4`-metric SVG bar-chart comparison (`Nodes visited`, `Edges relaxed`, `Time (µs)`, `Distance (m)`).
- **Indoor Maps:** Multi-floor SVG viewer for `6` sample buildings (`b-admin`, `b-auditorium`, `b-csit`, `b-csit-labs`, `b-dean-offices`, `b-library`) with floor switching, room popovers, `"I'm here"` origin setting, and vertical stair/lift connectors.
- **Directions, GPS Snapping & Reroute (C++ Core):** Windowed polyline bearing turns, progress projection along route segments, off-route detection, and live GPS rerouting in `core/src/navcore.cpp`.

---

## 4. System Architecture

```text
  [data/*.json] ---> [tools/*.py validation & geometry]
         |
         v
  [core/src/navcore.cpp] (8,199 lines, single-file C++17 DSA engine)
     |                               |
     | (Native CMake / g++)          | (Emscripten via GitHub Actions)
     v                               v
  [core_tests / navcore_cli]   [web/public/wasm/navcore.js]
                                     |
                                     v
                        [web/src/core/navcore.ts]  <-- call(fn, argsJson)
                                     |
                                     v
                  [Next.js Static Export (Vercel)]
```

### Why One C++ File and One `call(fn, argsJson)` API?

Keeping the entire DSA engine in `core/src/navcore.cpp` ensures zero build-system drift between native Doctest tests, the terminal viva CLI (`-DNAVCORE_CLI`), and the Emscripten WebAssembly target. Exposing a single C ABI boundary (`extern "C" const char* call(const char* fn, const char* argsJson)`) eliminates per-function Emscripten binding boilerplate and lets TypeScript (`web/src/core/navcore.ts`) pass structured JSON payloads via WASM heap allocation (`_malloc`/`_free`).

### Exported `call(fn, argsJson)` API

| Function | Purpose |
| :--- | :--- |
| `ping` | Health check and engine version (`1.0.0`) |
| `load` | Loads/merges outdoor `graph.json`, indoor JSONs, or `evac.json` |
| `route` | Computes path, distance, steps, and `trace[]` (`dijkstra`, `astar`, `bfs`, `bellmanford`, `floyd`, optional `toLandmark`) |
| `compare` | Runs all 5 routing algorithms side-by-side and returns timing, visited nodes, and edges relaxed |
| `search` | Prefix Trie search across landmarks, building numbers, and indoor rooms |
| `cacheStats` | Inspects or resets LRU route cache hit/miss/eviction counters |
| `allPairs` | Returns the Floyd-Warshall landmark-to-landmark distance matrix |
| `mst` | Computes campus Minimum Spanning Tree via Kruskal or Prim |
| `tsp` | Solves multi-stop tour via Held-Karp exact bitmask DP or Nearest-Neighbor heuristic |
| `criticalPoints` | Finds Tarjan articulation points and bridge edges |
| `evacuate` | Assigns people groups to assembly areas (`nearest` or `capacity` mode) |
| `nearestAssembly` | Finds nearest reachable assembly area from a building or indoor room (`disableLifts: true`) |
| `evacuationCompare` | Compares `nearest` vs `capacity` evacuation (overloaded areas, max load, total distance) |
| `directions` | Converts a route into windowed bearing turn maneuvers |
| `progress` | Projects a GPS coordinate onto the route polyline and checks off-route status |
| `reroute` | Snaps a GPS coordinate to the nearest graph node/edge and computes a fresh route + maneuvers |

---

## 5. Data & Attribution

The campus master plan data was taken from the **TraverseNED** repository by **Hasan Shahir** (https://github.com/hasanshahir/TraverseNED), used with his permission, and credited here.

- **Taken from TraverseNED (via `tools/extract_ned.py` reading `campus_nodes.js`):** Landmark names, short names, building numbers, categories, approximate building coordinates, and building footprints.
- **Built ourselves:** The walkable outdoor graph (`86` nodes, `108` edges), `6` multi-floor indoor building graphs (`611` indoor nodes, `240` rooms), perimeter `accessNodeIds` (`21` landmarks with `>1` access node), OSM-snapped and detour-corrected edge `geometry` with honest Haversine meter weights, emergency evacuation dataset (`7` assembly areas with `6,800` total capacity, `12` building exits), all C++17 algorithms, and the Next.js web application.
- **Data Pipeline (`tools/`):** `extract_ned.py` (base extraction) -> `generate_indoor.py` (indoor floor plans) -> `generate_evac.py` (evacuation dataset) -> `add_geometry.py` & `fix_crossings.py` (footpath geometry, `4 m` visibility-graph detours around `25%`-shrunk footprints, honest weights) -> `add_access_nodes.py` (perimeter `accessNodeIds` within `15 m`) -> `warp_master_plan.py` (north-up overlay) -> `validate.py` (schema, connectivity, crossing, and reachability checks).
- **Known Data Limits:** Building footprints are approximate polygons, and `59` of `108` outdoor edges still use straight-line 2-point fallback geometries where OSM footpath data was unavailable.

---

## 6. Data Structures & Algorithms

| Algorithm or Structure | Where Used in App | Time Complexity | Space | Section of `navcore.cpp` |
| :--- | :--- | :--- | :--- | :--- |
| **Binary Min-Heap** | Priority queue for Dijkstra, A*, Prim, and Multi-Source Dijkstra | `O(log V)` push/pop | `O(V)` | Sections 3, 7, 10 |
| **Dijkstra's Algorithm** | Default shortest-path & evacuation routing | `O((V + E) log V)` | `O(V + E)` | Section 3.2 |
| **A* Search** | Goal-directed routing with admissible Haversine heuristic | `O((V + E) log V)` | `O(V)` | Section 3.3 |
| **Breadth-First Search (BFS)** | Fewest-hops path option in algorithm picker | `O(V + E)` | `O(V)` | Section 3.4 |
| **Bellman-Ford** | Edge-relaxation pathfinding & negative-cycle check | `O(V · E)` | `O(V)` | Section 3.5 |
| **Floyd-Warshall** | All-pairs landmark distance matrix & `floyd` route mode | `O(V³)` | `O(V²)` | Section 6 |
| **Prefix Trie** | Instant autocomplete for buildings, numbers, and rooms | `O(L)` query (`L` = query length) | `O(N · Σ)` | Section 4 |
| **LRU Route Cache** | O(1) memoization of repeated route queries (`128` entries) | `O(1)` get/put | `O(C)` | Section 5 |
| **Union-Find + Kruskal / Prim** | Campus walkway MST analysis (`mst` API / CLI) | `O(E log E)` / `O((V+E) log V)` | `O(V + E)` | Section 7 |
| **TSP (Held-Karp & Nearest-Neighbor)** | Multi-stop campus tour ordering (`tsp` API / CLI) | `O(n² · 2ⁿ)` / `O(n²)` | `O(n · 2ⁿ)` | Section 8 |
| **Tarjan's Algorithm** | Articulation points & bridge edges (`criticalPoints` API / CLI) | `O(V + E)` | `O(V)` | Section 9 |
| **Multi-Source Dijkstra** | Reversed-graph nearest assembly lookup (`nearestAssembly`) | `O((V + E) log V)` | `O(V)` | Section 10.1 |
| **Min-Cost Max-Flow (SPFA)** | Capacity-constrained campus evacuation (`evacuate`) | `O(F · V · E)` | `O(V + E)` | Section 10.2 |

- **Binary Min-Heap:** Powers priority queues across Dijkstra, A*, Prim, and Multi-Source Dijkstra without relying on unordered tie-breaking.
- **Dijkstra's Algorithm:** Computes exact shortest walking paths in meters, e.g., routing from Main Gate (`n1`) to Central Library (`b-library`).
- **A\* Search:** Uses great-circle Haversine distance (propagating outdoor entrance coordinates to indoor nodes) to prune nodes away from the destination while preserving optimality.
- **BFS:** Finds the path with the fewest graph hops, contrasting hop-optimal vs meter-optimal paths in `Compare algorithms`.
- **Bellman-Ford:** Relaxes all edges `V - 1` times and detects negative-weight cycles (verified on synthetic negative-cycle graphs in `test_main.cpp`).
- **Floyd-Warshall:** Precomputes pairwise shortest distances and next-hop indices across the merged graph for instant `allPairs` landmark matrices.
- **Prefix Trie:** Indexes full names, short names, building numbers (e.g., `"11"` -> Main Auditorium), and indoor room codes (e.g., `"b-csit:201"`).
- **LRU Route Cache:** Combines an unordered hash map with a doubly linked list (`128`-entry capacity) and invalidates automatically when blocked node/edge hashes change.
- **Union-Find + Kruskal / Prim:** Evaluates minimum-cost walkway backbones across the `86`-node outdoor campus graph.
- **TSP (Held-Karp & Nearest-Neighbor):** Computes exact shortest multi-stop tours for up to `12` stops and compares against the greedy Nearest-Neighbor heuristic gap.
- **Tarjan's Articulation Points & Bridges:** Identifies single-point-of-failure walkways (such as the Main Gate connector `n1--n9`) whose removal disconnects campus subgraphs.
- **Multi-Source Dijkstra:** Seeds all `7` assembly areas simultaneously at distance `0` on the reversed graph (with lifts disabled) to answer `nearestAssembly` in one pass.
- **Min-Cost Max-Flow (SPFA):** Models assembly area capacities as sink-edge capacities so large drills (e.g., `Library 300 + Auditorium 200`) avoid overloading nearby muster zones.

---

## 7. Directions, GPS Snapping & Reroute

- **Turn Directions (`SECTION 11.1`):** Computes bearings over a **20 m** window before and after each vertex along the oriented polyline (`< 30°` straight and merged, `30°–60°` slight turn, `60°–120°` standard turn, `> 120°` sharp turn). Legs shorter than **12.0 m** (`kMinLegMeters`) and final `< 12.0 m` building-entrance stubs are merged into adjacent legs.
- **GPS Progress & Off-Route Detection (`SECTION 11.2`):** Projects the user's `(lat, lng)` onto the route polyline and flags `offRoute = true` when `offRouteDistanceM > max(25 m, 1.5 * accuracyM)`.
- **Live Reroute (`SECTION 11.3`):** Snaps the GPS coordinate to the nearest graph node/edge and invokes `route` + `directions` from that snapped node.

---

## 8. Evacuation Design

- **Go to Assembly:** Queries `nearestAssembly` (lifts disabled, stairs allowed). If the user marks the assigned assembly area full (`"Area is full, find next"`), the app excludes full areas and computes the next nearest reachable assembly area, falling back with a notice if all `7` areas are marked full.
- **Campus Simulation:** Supports multi-building people groups and tap-to-block road hazards, comparing `nearest` vs `capacity` modes (`Min-Cost Max-Flow`) with per-area load bars and canvas flow particles.

---

## 9. Testing & CI

- **Doctest Suite (`core/tests/test_main.cpp`):** `1,687` lines containing **21 test cases** and **4,324 assertions** covering routing, `toLandmark`, LRU cache invalidation, Trie search, Floyd-Warshall, Kruskal/Prim MST, Held-Karp TSP, Tarjan critical points, evacuation modes, windowed directions, and GPS rerouting.
- **GitHub Actions (`.github/workflows/core.yml`):** On every push to `core/**`, builds native C++17 on `ubuntu-22.04` via CMake + Ninja, runs `ctest --test-dir core/build-native --output-on-failure`, compiles `navcore.js` with Emscripten `3.1.64`, and commits updated WASM artifacts.
- **Cross-Platform Determinism:** Tie-breaking uses explicit node IDs and sorted candidate lists; `test_main.cpp` resolves `data/` via `Graph::resolveDataDirectory("data")` so `ctest` passes regardless of working directory.
- **CLI Showcase (`NAVCORE_CLI`):** Supports `route`, `directions`, `compare`, `mst`, `tsp`, `evacuate`, `--animate`, `--json`, and `demo --auto` with 100x40 ASCII campus maps.

---

## 10. Deployment

- **WASM Build:** Compiled automatically by GitHub Actions (`.github/workflows/core.yml`) into `web/public/wasm/navcore.js`.
- **Web Hosting:** `web/` uses Next.js App Router with static export (`output: "export"`), deployed on Vercel. Dev-only routes (`/kit`, `/_map-dev`, `/_map-dev/indoor`) return `notFound()` in production builds.

---

## 11. How to Run

### Prerequisites
- C++17 compiler (`g++` or MSVC/Clang), CMake + Ninja (optional)
- Node.js 18+ and npm
- Python 3 (only for regenerating `data/` scripts)

### Run C++ Unit Tests
```bash
g++ -std=c++17 -O2 -Icore/third_party core/tests/test_main.cpp -o core/test_runner.exe
./core/test_runner.exe
```

### Build & Run CLI Showcase
```bash
g++ -std=c++17 -O2 -DNAVCORE_CLI -Icore/third_party core/src/navcore.cpp -o navcore_cli
./navcore_cli demo --auto
```

### Run Web App
```bash
cd web
npm install
npm run dev:fresh
```

### Regenerate & Validate Data
```bash
python tools/extract_ned.py
python tools/generate_indoor.py
python tools/generate_evac.py
python tools/add_geometry.py
python tools/fix_crossings.py
python tools/add_access_nodes.py
python tools/validate.py
```

---

## 12. Screenshots

![Outdoor & Indoor Route Directions](docs/screenshots/route.png)
*Turn-by-turn campus route ending at the destination building perimeter.*

![Emergency Evacuation Mode](docs/screenshots/evacuation.png)
*Go-to-assembly guide and campus evacuation flow visualization.*

![Algorithm Visualizer & Compare](docs/screenshots/visualizer.png)
*Step-by-step search trace replay and 5-algorithm benchmark comparison.*

---

## 13. Limitations & Future Work

- **Approximate Paths & Footprints:** `59` of `108` outdoor edges use straight-line 2-point geometries, and building footprints are approximate polygons.
- **Sample Indoor Maps:** Detailed indoor floor plans cover `6` representative buildings rather than all `55` campus structures.
- **No Live GPS Navigation Screen:** `progress` and `reroute` are implemented and tested in `core/src/navcore.cpp`, but the web UI does not yet include a continuous live GPS turn-by-turn tracking screen.
- **No Crowdsourced Blockage Reporting UI:** Path blocking works locally in simulation mode without a backend persistence layer.

---

## 14. Credits & References

- **TraverseNED** by Hasan Shahir (https://github.com/hasanshahir/TraverseNED) — campus landmark coordinates, names, numbers, and approximate footprints, used with permission.
- **nlohmann/json** (`core/third_party/nlohmann/json.hpp`) & **doctest** (`core/third_party/doctest/doctest.h`).
- **Leaflet**, **Esri World Light Gray Base & World Imagery**, **Next.js**, and **Emscripten**.
