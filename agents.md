# Agent Ownership & Workflow

## Per-Task Workflow
Every task executed by an agent or human contributor must strictly follow these 5 steps:
1. **Context**: Read `memory.md` and `repo_map.md`.
2. **Plan**: Formulate a plan in $\le 5$ concise bullet points.
3. **Execution**: Make the smallest verifiable change strictly inside your owned folders.
4. **Validation**: Test the change (build, unit tests, static export).
5. **Record & Commit**: Update memory.md and repo_map.md, then commit and push per the Git rules.

## Ownership Matrix

| Member | Focus Area | Owned Directories & Files | Prohibited |
| :--- | :--- | :--- | :--- |
| **Member A** | Data, GIS, Indoor Maps, Map Renderers | `data/`, `tools/`, `web/src/map/` | `core/`, `web/src/ui/`, `web/src/core/`, `.github/` |
| **Member B** | C++ DSA Core, WASM Bridge, CI Workflows | `core/`, `.github/workflows/` | `data/`, `web/src/` (except consuming output) |
| **Member C** | Web UI, State, Visualizers, Design, Deploy | `web/` (except `web/src/map/`), `design.md` | `core/`, `data/`, `web/src/map/` |

### Cross-Cutting Rules
- Never modify files owned by another member without explicit consensus and contract updates in `contracts.md`.
- Shared coordination documents (`contracts.md`, `memory.md`, `repo_map.md`, `plan.md`) may be updated when a member delivers their respective work slice.

