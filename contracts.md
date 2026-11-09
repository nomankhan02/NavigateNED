# System Contracts (Single Source of Truth)

## Identifiers
- Outdoor nodes: `n<number>` (e.g., `n1`, `n42`)
- Indoor nodes: `<buildingId>:<local>` (e.g., `b-cs:101`, `b-library:204`)
- Buildings: `b-<slug>` (e.g., `b-csit`, `b-library`, `b-admin`)

## Data Contracts

### 1. `data/graph.json`
```json
{
  "meta": { "version": "1.0", "origin": [24.9317, 67.1128] },
  "nodes": [
    { "id": "n1", "lat": 24.9317, "lng": 67.1128, "kind": "entrance" }
  ],
  "edges": [
    { "a": "n1", "b": "n2", "w": 45.2, "oneway": false, "covered": true }
  ],
  "landmarks": [
    {
      "id": "b-csit",
      "name": "Department of CS & IT",
      "short": "CSIT",
      "nodeId": "n1",
      "category": "academic",
      "footprint": [[24.9317, 67.1128], [24.9320, 67.1128], [24.9320, 67.1132], [24.9317, 67.1132]]
    }
  ]
}
```
- Node `kind` enum: `"path" | "entrance" | "gate" | "assembly" | "poi"`
- Weights (`w`): Edge distances strictly in meters.

### 2. `data/indoor/<buildingId>.json`
```json
{
  "id": "b-csit",
  "name": "Department of Computer Science & IT",
  "landmarkId": "b-csit",
  "floors": [{ "level": 0, "label": "Ground Floor" }],
  "nodes": [
    { "id": "b-csit:ent", "x": 10.0, "y": 5.0, "floor": 0, "type": "entrance", "name": "Main Entrance" }
  ],
  "edges": [
    { "a": "b-csit:ent", "b": "b-csit:c1", "kind": "walk", "w": 12.0, "accessible": true }
  ],
  "rooms": [
    { "nodeId": "b-csit:lab1", "rect": [15.0, 10.0, 20.0, 15.0] }
  ]
}
```
- Node `type` enum: `"corridor" | "room" | "stairs" | "lift" | "entrance" | "exit"`
- Edge `kind` enum: `"walk" | "stairs" | "lift"`
- Constraint: Exactly one `type: "entrance"` node per building, linked to landmark's outdoor entrance node by a 3 m edge.
- Standard weights: `stairs w = 10`, `lift w = 15`. For stairs, `accessible: false`.

### 3. `data/evac.json`
```json
{
  "assemblyAreas": [
    { "id": "a-ground", "name": "Main Cricket Ground", "nodeId": "n9", "capacity": 1500 }
  ],
  "buildingExits": [
    { "buildingId": "b-csit", "nodeId": "n1" }
  ]
}
```

## C++ WASM API Contract
One single exported bridge function:
```cpp
extern "C" {
  const char* call(const char* fn, const char* argsJson);
}
```
TypeScript calls via Emscripten `cwrap`:
```typescript
call(fn: string, argsJson: string): string
```

### Exported Functions
1. `load(graphJson: string) -> {"status": "ok" | "error", "message"?: string}`
2. `ping() -> {"status": "pong", "version": string}`
3. `route(args: {from: string, to: string, algo: "dijkstra"|"astar"|"bfs"|"bellmanford", accessible?: boolean, avoid?: string[]}) -> {found: boolean, distance: number, path: string[], steps: string[], trace: Array<{type: "visit"|"relax"|"frontier", node: string, dist: number}>}`
4. `compare(args: {from: string, to: string}) -> {results: Record<string, {distance: number, timeMs: number, visitedCount: number}>}`
5. `allPairs() -> {matrix: Record<string, Record<string, number>>}` (Floyd-Warshall)
6. `mst() -> {totalWeight: number, edges: Array<{a: string, b: string, w: number}>}`
7. `tsp(args: {stops: string[]}) -> {orderedStops: string[], totalDistance: number}`
8. `criticalPoints() -> {articulationPoints: string[], bridges: Array<[string, string]>}`
9. `search(args: {query: string, limit?: number}) -> {results: Array<{id: string, name: string, type: string}>}` (Trie-based prefix matching)
10. `evacuate(args: {blocked: string[], people: Array<{at: string, count: number}>}) -> {assignments: Array<{from: string, assemblyId: string, path: string[], distance: number}>, flowPlan?: any}`

