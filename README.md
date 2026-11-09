# NavigateNED

Campus navigation and emergency evacuation system for NED University (DSA Course Project).

## Architecture
- **core/**: High-performance C++17 algorithmic engine (graph, Dijkstra, A*, Floyd-Warshall, MST, TSP, Max-Flow). Compiled to WebAssembly via Emscripten in GitHub Actions.
- **data/**: Outdoor road network, indoor floor plans, and evacuation assembly areas in structured JSON.
- **web/**: Next.js App Router (TypeScript, static export, plain CSS modules) consuming compiled WASM.

## How to Run Web Locally
```bash
cd web
npm install
npm run dev
```
Static export build:
```bash
cd web
npm run build
```
Deployment: Connect Vercel to repository with root directory set to `web/` (build command `next build`, output `out`).

