# Design Guidelines & System Specification — "Campus Survey Plate"

## 1. Aesthetic Direction: Campus Survey Plate
NavigateNED is designed as an architectural **drafting sheet and geodetic survey instrument** for the NED University campus:
- **Map-First Spatial Hierarchy**: The outdoor/indoor map occupies the full viewport bleed. Controls and panels attach cleanly to viewport edges (`top`, `left`, `bottom`) like a technical title-block and instrument readout tray—never floating centered card stacks.
- **Drafting Rules & Tick Marks**: Structural divisions use `1px` hairline rules (`--color-border-hairline`) accented with calibrated tick marks (`--color-tick-mark`) and a title-block header strip bearing a hand-drawn compass rose.
- **Instrument Readouts**: Distances, coordinates, floor levels, capacities, and algorithm metrics render as precision instrument readouts in a tabular slashed-zero monospace numeral face (`Azeret Mono`).
- **Signature Geometry**: Flat paper surfaces use crisp `2px`–`4px` corners (`--radius-xs`, `--radius-sm`) paired with a recurring `45°` chamfered corner notch (`--clip-chamfer-tr`) on primary actions, title-block tags, and active callouts. Generic pill shapes (`999px`) are avoided.

## 2. Banned Patterns & Anti-Patterns
- **No AI-Generic Look**: No boilerplate SaaS templates or interchangeable corporate dashboard cards.
- **No Purple / Blue-Purple Anywhere**: Strictly forbidden across both themes.
- **No Decorative Gradients or Glows**: Surfaces are flat drafting paper or frosted tracing vellum with crisp `1px` hairlines.
- **No Forbidden Fonts**: Never use Geist, Inter, Roboto, Poppins, Arial, system fonts, Space Grotesk, DM Sans, Manrope, Outfit, Sora, or Plus Jakarta Sans.
- **No Emojis Anywhere**: Zero emoji characters in UI, labels, badges, alerts, or empty states.
- **No External Icon Libraries**: Every icon in `web/src/ui/icons/` is a custom hand-drawn inline SVG on a unified `24x24` grid with a `1.75px` stroke width, round caps, and round joins.

---

## 3. Color Tokens (`web/src/styles/tokens.css`)

| Token | Daylight Plate (`light` / `:root`) | Night Plate (`dark`) | Purpose |
| :--- | :--- | :--- | :--- |
| `--color-bg-canvas` | `#F5F2EA` (Warm Drafting Paper) | `#0B1410` (Deep Green-Black Ground) | Root canvas & page ground |
| `--color-surface-panel` | `#ECE7DC` (Toned Survey Sheet) | `#111E18` (Night Instrument Plate) | Side panels, headers, drawers |
| `--color-surface-elevated` | `#FAF8F3` (Bright Vellum Card) | `#172820` (Elevated Night Cell) | Interactive rows, inputs, cards |
| `--color-surface-recessed` | `#E2DCD0` (Recessed Well) | `#070D0A` (Recessed Night Well) | Segmented tracks, code/log wells |
| `--color-text-primary` | `#111D18` (Deep Green-Black Ink) | `#EDEAE1` (Crisp Chalk Ink) | Primary headings, labels, values |
| `--color-text-secondary` | `#394D44` (Drafting Graphite) | `#A5B5AD` (Muted Silver-Sage) | Secondary descriptions, metadata |
| `--color-text-muted` | `#63776D` (Calibration Gray-Green) | `#6E8278` (Dim Grid Legend) | Hints, disabled states, coordinates |
| `--color-border-hairline` | `#C4BDB0` | `#24382E` | `1px` structural grid & table hairlines |
| `--color-border-strong` | `#6D7F76` | `#415E50` | Active control borders & frame rules |
| `--color-network-teal` | `#0E6B5E` | `#24A18E` | Walkable campus network & footprints |
| `--color-signal-vermilion` | `#D9431F` | `#EC532F` | Primary actions, active route, focus ring |
| `--color-hazard-red` | `#C62828` | `#E53935` | Blocked paths, hazards, evacuation alerts |
| `--color-safe-green` | `#1D7544` | `#2EAE66` | Assembly areas, entrances, safe status |
| `--color-caution-amber` | `#C4760A` | `#E59423` | Frontier exploration, capacity warning |

### Frosted Tracing Vellum (Map Overlay Surfaces Only)
- Allowed **strictly** on surfaces sitting directly over the map canvas (bottom sheet, edge side panel, Campus Key drawer, floating route readouts):
  - `--vellum-bg`: `rgba(245, 242, 234, 0.82)` (Daylight) / `rgba(17, 30, 24, 0.83)` (Night)
  - `--vellum-bg-fallback`: `#EFECE3` (Daylight) / `#13211B` (Night) solid fallback when `backdrop-filter` is unsupported.
  - `--vellum-blur`: `12px` (`backdrop-filter: blur(12px)`).
  - `--vellum-border`: `1px solid var(--vellum-border)`.
  - **No Glass-on-Glass**: Children inside a vellum container use flat opaque/toned surfaces (`--color-surface-elevated` or `--color-surface-recessed`).
  - **Mobile Drag/Zoom Performance Rule**: While the map is actively panned or zoomed (`body[data-map-interacting="true"]`), `backdrop-filter` is immediately disabled (`none`) and falls back to `--vellum-bg-fallback` to guarantee 60 fps frame pacing on mobile GPUs.

---

## 4. Typography & Numerals Specification

All fonts are self-hosted via `@fontsource` packages imported in `web/src/app/layout.tsx`:
1. **Display Face (`--font-display`)**: **`Bricolage Grotesque`** (`500`, `600`, `700`)
   - Used for title-block headings, section banners, and **bold building number badges** (`.ned-landmark-badge`, `.ned-key-item-number`, `.font-building-badge`).
2. **Text Face (`--font-sans`)**: **`Familjen Grotesk`** (`400`, `500`, `600`, `700`)
   - Used for body copy, form controls, navigation steps, and map landmark labels.
3. **Numerals & Readout Face (`--font-numerals`)**: **`Azeret Mono`** (`400`, `500`, `600`, `700`)
   - Enforced with `font-variant-numeric: tabular-nums slashed-zero` (`font-feature-settings: "tnum" 1, "zero" 1`).
   - Used for **ALL numbers across the application**: distances (`294.2 m`), walking times, floor numbers (`F0`, `F1`, `F2`), building numbers in tables/keys, evacuee counts, GPS coordinates (`24.9317° N, 67.1128° E`), and algorithm telemetry readouts.

### Type Scale & Spacing
- **Type Scale**: `--text-2xs` (`11px`), `--text-xs` (`12px`), `--text-sm` (`13px`), `--text-base` (`15px`), `--text-md` (`17px`), `--text-lg` (`20px`), `--text-xl` (`24px`), `--text-2xl` (`30px`).
- **4 px Spacing Scale**: `--space-1` (`4px`), `--space-2` (`8px`), `--space-3` (`12px`), `--space-4` (`16px`), `--space-5` (`20px`), `--space-6` (`24px`), `--space-7` (`28px`), `--space-8` (`32px`), `--space-10` (`40px`), `--space-12` (`48px`), `--space-16` (`64px`).

---

## 5. Motion Specification

All animations strictly use GPU-composited `transform` and `opacity` (or SVG `stroke-dashoffset` for vector line drawing) and honor `@media (prefers-reduced-motion: reduce)` by collapsing durations to `0.01ms`.

| Interaction / Element | Duration Token | Easing Token | What Animates |
| :--- | :--- | :--- | :--- |
| **Title-Block Intro Draw-In** | `--duration-intro` (`620ms`) | `--ease-out-plate` (`cubic-bezier(0.16, 1, 0.3, 1)`) | On first load, title-block hairline rules scale from `scaleX(0)` to `scaleX(1)` (`transform-origin: left`) and compass needle settles (`rotate(-18deg)` to `0deg`). |
| **Panel Slide & Bottom Sheet Snap** | `--duration-normal` (`240ms`) | `--ease-spring-snap` (`cubic-bezier(0.22, 1, 0.36, 1)`) | Desktop side panel translates `translateX(-100% -> 0)`; mobile bottom sheet snaps between peek/half/full via `translateY(...)`. |
| **Route Polyline Draw-On** | `--duration-route-draw` (`900ms`) | `--ease-spring-snap` (`cubic-bezier(0.22, 1, 0.36, 1)`) | SVG route path animates `stroke-dashoffset` from `1800` to `0`. |
| **StatReadout Number Tick-Up** | `--duration-slow` (`380ms`) | `requestAnimationFrame` cubic ease-out | Numeric instrument readouts interpolate smoothly from previous value to target value (instant under `prefers-reduced-motion`). |
| **Indoor Floor Switch** | `--duration-normal` (`240ms`) | `--ease-out-plate` (`cubic-bezier(0.16, 1, 0.3, 1)`) | Floor SVG group cross-fades `opacity` (`0 -> 1`) with subtle vertical shift `translateY(6px -> 0)`. |
| **Control & ListRow Hover / Press** | `--duration-fast` (`150ms`) | `--ease-out-plate` | Background tint shift and `translateX(2px)` on list rows or `translateY(-1px)` on primary buttons. |
