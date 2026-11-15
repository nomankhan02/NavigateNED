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

## 3. Color Tokens (`web/src/styles/tokens.css`) — Theme 2: Harbor Chart

| Token | Daylight Harbor Chart (`light` / `:root`) | Night Harbor Chart (`dark`) | Purpose |
| :--- | :--- | :--- | :--- |
| `--color-bg-canvas` | `#EEF2F3` (Sea-Salt Chart Paper) | `#09151E` (Abyssal Chart Ground) | Root canvas & page ground |
| `--color-surface-panel` | `#E2E9EB` (Pale Harbor Slate) | `#0F202D` (Night Chart Plate) | Side panels, headers, drawers |
| `--color-surface-elevated` | `#F8FBFB` (Bright Chart Vellum) | `#152B3B` (Elevated Night Cell) | Interactive rows, section cards |
| `--color-surface-recessed` | `#D5DFE2` (Recessed Sounding Well) | `#060F16` (Recessed Night Well) | Segmented tracks, input & readout wells |
| `--color-text-primary` | `#0E2233` (Deep Maritime Ink) | `#E8F0F4` (Crisp Chart Chalk) | Primary headings, labels, values |
| `--color-text-secondary` | `#2D4659` (Harbor Slate) | `#A5BCC9` (Muted Sea Mist) | Secondary descriptions, metadata |
| `--color-text-muted` | `#50697A` (Sounding Gray-Blue) | `#7692A3` (Dim Grid Legend) | Hints, disabled states, coordinates |
| `--color-border-hairline` | `#B4C3C8` | `#223E52` | `1px` structural grid & table hairlines |
| `--color-border-strong` | `#587282` | `#41657E` | Active control borders & frame rules |
| `--color-network-teal` | `#0B6E75` | `#2AB3BC` | Walkable campus network & secondary states |
| `--color-signal-vermilion` | `#C93E24` | `#F05A3E` | Route, active tab, selected algo & primary actions |
| `--color-hazard-red` | `#B91C1C` | `#EF4444` | Blocked paths, hazards, evacuation alerts |
| `--color-safe-green` | `#157347` | `#2EB872` | Assembly areas, entrances, safe status |
| `--color-caution-amber` | `#B45309` | `#E59423` | Frontier exploration, capacity warning |

### Frosted Tracing Vellum (Map Overlay Surfaces Only)
- Allowed **strictly** on surfaces sitting directly over the map canvas (bottom sheet, edge side panel, Campus Key drawer, floating route readouts):
  - `--vellum-bg`: `rgba(238, 242, 243, 0.84)` (Daylight) / `rgba(15, 32, 45, 0.84)` (Night)
  - `--vellum-bg-fallback`: `#E6ECEE` (Daylight) / `#112433` (Night) solid fallback when `backdrop-filter` is unsupported.
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
| **Title-Block Intro Draw-In** | `--duration-intro` (`620ms`) | `--ease-out-plate` (`cubic-bezier(0.16, 1, 0.3, 1)`) | On first load, title-block hairline rules scale from `scaleX(0)` to `scaleX(1)` (`transform-origin: left`) and the isometric `N` brand mark faces fade and rise `4px` into place in sequence (`< 700ms` total). |
| **Panel Slide & Bottom Sheet Snap** | `--duration-normal` (`240ms`) | `--ease-spring-snap` (`cubic-bezier(0.22, 1, 0.36, 1)`) | Desktop side panel translates `translateX(-100% -> 0)`; mobile bottom sheet snaps between peek/half/full via `translateY(...)`. |
| **Route Polyline Draw-On** | `--duration-route-draw` (`900ms`) | `--ease-spring-snap` (`cubic-bezier(0.22, 1, 0.36, 1)`) | SVG route path animates `stroke-dashoffset` from `1800` to `0`. |
| **StatReadout Number Tick-Up** | `--duration-slow` (`380ms`) | `requestAnimationFrame` cubic ease-out | Numeric instrument readouts interpolate smoothly from previous value to target value (instant under `prefers-reduced-motion`). |
| **Indoor Floor Switch** | `--duration-normal` (`240ms`) | `--ease-out-plate` (`cubic-bezier(0.16, 1, 0.3, 1)`) | Floor SVG group cross-fades `opacity` (`0 -> 1`) with subtle vertical shift `translateY(6px -> 0)`. |
| **Control & ListRow Hover / Press** | `--duration-fast` (`150ms`) | `--ease-out-plate` | Background tint shift and `translateX(2px)` on list rows or `translateY(-1px)` on primary buttons. |

---

## 6. Brand Mark Usage & Clear-Space Rule (`web/src/ui/icons/BrandLogo.tsx`)

- **Geometry**: Static 30° isometric extruded letter **"N"** built strictly from flat polygon faces in three theme-token tones (`--color-logo-light` top face, `--color-logo-mid` front/left face, `--color-logo-dark` side/right face), bisected bottom-left to top-right by a thin `--color-signal-vermilion` route line with endpoint nodes. Zero gradients, zero blur.
- **Size Variants**:
  - `24px`–`64px+`: Full 3D isometric extruded letterform (`favicon.svg`, `apple-touch-icon.png`, header title block, `/kit`, `SurveyLoader`).
  - `16px` (`size <= 18`): Simplified 3-face isometric geometry with thicker `1.5px` route cut for crisp legibility at small sizes.
- **Clear-Space Rule**: Maintain a minimum clear space equal to **`0.25 ×` the logo's rendered width** (`1/4` of mark size, e.g., `6px` around a `24px` mark or `16px` around a `64px` mark) on all four sides, free of text, badges, or competing borders. Inside the `34px` header stamp frame, the `24px` mark sits centered with `5px` internal padding.
