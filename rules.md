# NavigateNED Principles & Rules

## Core Architectural Principles
1. **C++ Logic Exclusivity**: All graph, routing, evacuation, and DSA algorithms are strictly C++17 in `core/`. TypeScript never contains routing or algorithm logic—only UI, data loading, and invoking C++ WASM.
2. **WASM Compilation via CI**: C++ is compiled to WebAssembly via GitHub Actions using Emscripten. Local C++/Emscripten tools are never required for web developers. Web consumes committed WASM artifacts in `web/public/wasm/`.
3. **Web Tech Stack**: Next.js App Router + TypeScript with static export (`output: "export"`), deployable on Vercel. Plain CSS (CSS variables + CSS modules). No Tailwind, no UI component kits, no icon libraries. Headless accessibility primitives (Radix/React Aria) allowed.
4. **Scope Discipline**: Stay strictly inside scope. If a task requires a new dependency, external tool, or architectural shift, stop and ask.
5. **Strict Ownership Boundaries**: Each member owns designated folders (see `agents.md`). Never edit another member's folders.

## Code Standards
- **C++**: Modern C++17, clean header/source organization, single-entry WASM binding via `call()`. Unit tests via Doctest.
- **TypeScript**: Strict type checking (`strict: true`), explicit interfaces matching contracts, clean separation between UI components and WASM loader.
- **CSS**: Pure vanilla CSS variables for tokens (`tokens.css`), scoped CSS modules for components, standard CSS resets.

## Git & Workflow Rules
- **Branches**:
  - `member-a-data`: Member A (Data & GIS)
  - `member-b-core`: Member B (C++ & WASM Core)
  - `member-c-web`: Member C (Web UI & Frontend)
- **Commits**: Small, atomic, well-described commits. Never rewrite shared history (`git push --force` is prohibited).
- **Trunk Integration**: Merge to `main` through clean PRs with verified builds and tests.

## Token & Agent Efficiency Rules
- Read markdown documentation files first before acting.
- Consult `repo_map.md` before exploring directories.
- Read specific line ranges instead of entire files.
- Grep or search before reading.
- Do not re-read unchanged files.
- Never paste large tool outputs into chat; summarize tool results concisely.
- Prefer editing existing files (`edit_file`) over full rewrites.
- Execute one slice per task. Stop at a clean commit boundary if context limits approach.

