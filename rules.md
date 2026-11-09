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
- Work directly on `main`, one member at a time.
- Agents may run git add, commit, pull and push, but only after the task's build/tests pass.
- Before starting a task and before every push: git pull. If a merge conflict appears, STOP and ask the user. Never resolve conflicts alone.
- Stage only files inside your owned folders (plus memory.md and repo_map.md). Never use `git add .` at the repo root. Never commit .env, keys, .ref/, or build outputs.
- Never force push, reset --hard, rebase, or delete branches.
- One commit per finished slice, with a clear one-line message. Never push failing builds.

## Token & Agent Efficiency Rules
- Read markdown documentation files first before acting.
- Consult `repo_map.md` before exploring directories.
- Read specific line ranges instead of entire files.
- Grep or search before reading.
- Do not re-read unchanged files.
- Never paste large tool outputs into chat; summarize tool results concisely.
- Prefer editing existing files (`edit_file`) over full rewrites.
- Execute one slice per task. Stop at a clean commit boundary if context limits approach.

