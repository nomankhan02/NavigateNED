"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useState } from "react";
import {
  AccessibilityIcon,
  Badge,
  BrandLogo,
  Button,
  Chip,
  CompassIcon,
  Divider,
  Field,
  ICON_CATALOG,
  Icon,
  IconButton,
  LayersIcon,
  ListRow,
  LocateIcon,
  Panel,
  RouteIcon,
  SearchField,
  SegmentedControl,
  Sheet,
  type SheetSnap,
  StatReadout,
  SurveyLoader,
  SwapIcon,
  ThemeSwitch,
  Toast,
  Toggle,
  useTheme,
} from "@/ui";
import styles from "./kit.module.css";

const COLOR_SWATCHES = [
  { name: "Canvas Base", token: "--color-bg-canvas" },
  { name: "Surface Panel", token: "--color-surface-panel" },
  { name: "Surface Elevated", token: "--color-surface-elevated" },
  { name: "Surface Recessed", token: "--color-surface-recessed" },
  { name: "Text Primary", token: "--color-text-primary" },
  { name: "Text Secondary", token: "--color-text-secondary" },
  { name: "Text Muted", token: "--color-text-muted" },
  { name: "Border Strong", token: "--color-border-strong" },
  { name: "Network Teal", token: "--color-network-teal" },
  { name: "Route Coral", token: "--color-signal-vermilion" },
  { name: "Safe Green", token: "--color-safe-green" },
  { name: "Hazard Red", token: "--color-hazard-red" },
  { name: "Caution Amber", token: "--color-caution-amber" },
] as const;

export default function KitPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useState<"navigate" | "explore" | "evacuate">("navigate");
  const [algo, setAlgo] = useState<"dijkstra" | "astar" | "bfs" | "bellmanford">("astar");
  const [stepFree, setStepFree] = useState(true);
  const [disableLifts, setDisableLifts] = useState(true);
  const [searchQuery, setSearchQuery] = useState("CSIT");
  const [fromValue, setFromValue] = useState("b-csit:201");
  const [toValue, setToValue] = useState("b-library");
  const [activeChip, setActiveChip] = useState<string>("academic");
  const [selectedRow, setSelectedRow] = useState<string>("b-csit");
  const [statDistance, setStatDistance] = useState<number>(312.4);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("half");

  return (
    <div className={styles.kitPage}>
      <header className={styles.titleBlock}>
        <div className={styles.titleLeft}>
          <BrandLogo size={28} animated />
          <div className={styles.titleMeta}>
            <span className={styles.plateStamp}>
              NED UNIVERSITY // GEODETIC SURVEY INSTRUMENT KIT // REV 1.0
            </span>
            <h1 className={styles.plateHeading}>Campus Survey Plate — Component &amp; Token Kit</h1>
          </div>
        </div>

        <div className={styles.titleRight}>
          <Badge variant="neutral" numeric>
            BUILD {process.env.NEXT_PUBLIC_BUILD_ID || "dev"}
          </Badge>
          <SegmentedControl
            ariaLabel="Survey plate theme mode"
            value={theme}
            onChange={(val) => setTheme(val)}
            options={[
              { value: "light", label: "Daylight Plate" },
              { value: "dark", label: "Night Plate" },
            ]}
          />
          <ThemeSwitch size="md" />
          <Link href="/">
            <Button variant="primary" size="sm" chamfer leadingIcon={<RouteIcon size={15} />}>
              App Shell
            </Button>
          </Link>
        </div>
      </header>

      <main className={styles.container}>
        {/* 1. COLOR TOKENS */}
        <Panel
          code="SECTION 01 // PALETTE TOKENS"
          title="Daylight & Night Survey Plate Palette"
          actions={<Badge variant="teal">{theme.toUpperCase()} PLATE ACTIVE</Badge>}
        >
          <div className={styles.swatchGrid}>
            {COLOR_SWATCHES.map((s) => (
              <div key={s.token} className={styles.swatchCard}>
                <div
                  className={styles.swatchColor}
                  style={{ backgroundColor: `var(${s.token})` }}
                />
                <div className={styles.swatchMeta}>
                  <span className={styles.swatchName}>{s.name}</span>
                  <span className={styles.swatchToken}>{s.token}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* 2. TYPOGRAPHY & NUMERALS */}
        <div className={styles.grid2}>
          <Panel code="SECTION 02A // TYPE SYSTEM" title="Self-Hosted Font Stack (@fontsource)">
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <span className={styles.plateStamp}>
                  --font-display // Bricolage Grotesque (700)
                </span>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--text-xl)",
                    fontWeight: 700,
                    letterSpacing: "var(--tracking-tight)",
                  }}
                >
                  NED Campus Survey Plate — Sheet 04
                </div>
              </div>
              <Divider ticks />
              <div>
                <span className={styles.plateStamp}>
                  --font-sans // Familjen Grotesk (400 / 500 / 600)
                </span>
                <p style={{ margin: "4px 0 0", color: "var(--color-ink-secondary)" }}>
                  Turn left at Courtyard Fountain Central Plaza and proceed 142 m along the shaded
                  walkway toward Central Library entrance.
                </p>
              </div>
              <Divider ticks />
              <div>
                <span className={styles.plateStamp}>
                  --font-numerals // Azeret Mono (tabular-nums slashed-zero)
                </span>
                <div
                  className="numerals"
                  style={{
                    fontSize: "var(--text-lg)",
                    fontWeight: 600,
                    marginTop: "4px",
                  }}
                >
                  0123456789 // 24.9325°N, 67.1135°E // 00:04:18 // 697 NODES
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            code="SECTION 02B // INSTRUMENT READOUTS"
            title="StatReadout & Building Number Badges"
            actions={
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setStatDistance((d) => (d > 400 ? 198.0 : Number((d + 74.3).toFixed(1))))
                }
              >
                Tick Readout
              </Button>
            }
          >
            <div className={styles.grid4}>
              <StatReadout
                label="Route Distance"
                value={statDistance}
                decimals={1}
                unit="m"
                sublabel="A* Haversine"
                tone="accent"
              />
              <StatReadout
                label="Walk Time"
                value={Math.max(1, Math.round(statDistance / 78))}
                unit="min"
                sublabel="1.30 m/s pace"
                tone="teal"
              />
              <StatReadout
                label="Elevation"
                value={2}
                unit="fl"
                sublabel="Step-free lift"
                tone="safe"
              />
              <StatReadout
                label="Graph Telemetry"
                value={42}
                unit="nodes"
                sublabel="38.5 us elapsed"
              />
            </div>

            <Divider label="BUILDING NUMBER BADGES (BRICOLAGE GROTESQUE 700)" />
            <div className={styles.rowWrap}>
              <Badge variant="building">1</Badge>
              <Badge variant="building">5</Badge>
              <Badge variant="building">5A</Badge>
              <Badge variant="building">11</Badge>
              <Badge variant="building">18</Badge>
              <Badge variant="building">24</Badge>
              <Badge variant="vermilion" numeric>
                ROUTE 01
              </Badge>
              <Badge variant="teal" numeric>
                697 NODES
              </Badge>
              <Badge variant="safe" numeric>
                CAP 6800
              </Badge>
              <Badge variant="hazard" numeric>
                2 BLOCKED
              </Badge>
              <Badge variant="caution" numeric>
                DEMO MODEL
              </Badge>
            </div>
          </Panel>
        </div>

        {/* 3. BRAND MARK & HAND-DRAWN ICON SET */}
        <Panel
          code="SECTION 03 // BRAND MARK & INLINE SVG ICON SET"
          title={`Isometric Brand Mark & Hand-Drawn Icons (${ICON_CATALOG.length} Icons)`}
        >
          <div className={styles.rowWrap} style={{ marginBottom: "12px" }}>
            <div className={styles.iconCell} style={{ minWidth: "120px" }}>
              <BrandLogo size={16} />
              <span className={styles.iconName}>16px (Simplified)</span>
            </div>
            <div className={styles.iconCell} style={{ minWidth: "120px" }}>
              <BrandLogo size={24} />
              <span className={styles.iconName}>24px (Header)</span>
            </div>
            <div className={styles.iconCell} style={{ minWidth: "140px" }}>
              <BrandLogo size={64} animated />
              <span className={styles.iconName}>64px (Full Isometric)</span>
            </div>
          </div>
          <Divider label="24x24 SURVEY & CAMPUS ICON SET (1.75PX STROKE)" />
          <div className={styles.iconGrid}>
            {ICON_CATALOG.map((item) => (
              <div key={item.name} className={styles.iconCell}>
                <div className={styles.iconCellTop}>
                  <Icon name={item.name} size={22} />
                  <span className={styles.iconGroupTag}>{item.group}</span>
                </div>
                <span className={styles.iconName}>{item.name}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* 4. BUTTONS, TOGGLES, SEGMENTED CONTROLS & CHIPS */}
        <div className={styles.grid2}>
          <Panel code="SECTION 04A // ACTIONS" title="Buttons & IconButtons (All Variants & States)">
            <div className={styles.rowWrap}>
              <Button variant="primary" chamfer leadingIcon={<RouteIcon size={16} />}>
                Compute Route
              </Button>
              <Button variant="secondary" leadingIcon={<LayersIcon size={16} />}>
                Master Plan
              </Button>
              <Button variant="quiet">Reset View</Button>
              <Button variant="danger">Block Corridor</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button variant="secondary" loading>
                Solving...
              </Button>
            </div>

            <Divider label="SIZES (SM / MD / LG) & ICON BUTTONS" />
            <div className={styles.rowWrap}>
              <Button size="sm" variant="secondary">
                Small 30px
              </Button>
              <Button size="md" variant="secondary">
                Medium 36px
              </Button>
              <Button size="lg" variant="primary" chamfer>
                Large 42px Chamfer
              </Button>
              <IconButton aria-label="Locate position" size="sm">
                <LocateIcon size={15} />
              </IconButton>
              <IconButton aria-label="Swap endpoints" size="md">
                <SwapIcon size={16} />
              </IconButton>
              <IconButton aria-label="Primary compass" size="lg" variant="primary">
                <CompassIcon size={18} />
              </IconButton>
            </div>
          </Panel>

          <Panel
            code="SECTION 04B // SELECTION & SWITCHES"
            title="SegmentedControl, Toggle & Chips"
          >
            <SegmentedControl
              fullWidth
              ariaLabel="Primary mode selector"
              value={mode}
              onChange={setMode}
              options={[
                { value: "navigate", label: "Navigate", count: 5 },
                { value: "explore", label: "Explore", count: 55 },
                { value: "evacuate", label: "Evacuate", count: 7 },
              ]}
            />

            <SegmentedControl
              fullWidth
              ariaLabel="Routing algorithm"
              value={algo}
              onChange={setAlgo}
              options={[
                { value: "dijkstra", label: "Dijkstra" },
                { value: "astar", label: "A* Search" },
                { value: "bfs", label: "BFS Hops" },
                { value: "bellmanford", label: "Bellman-Ford" },
              ]}
            />

            <Divider ticks />
            <Toggle
              id="kit-toggle-stepfree"
              checked={stepFree}
              onChange={setStepFree}
              leadingIcon={<AccessibilityIcon size={16} />}
              label="Step-Free Accessible Route"
              hint="Avoid stairs; require ramps and vertical lifts indoors"
            />
            <Toggle
              id="kit-toggle-lifts"
              checked={disableLifts}
              onChange={setDisableLifts}
              label="Evacuation Lift Lockout"
              hint="Disable elevators during emergency egress"
            />

            <Divider label="FILTER CHIPS (CRISP 3PX CORNERS)" />
            <div className={styles.rowWrap}>
              {[
                { id: "academic", label: "Academic Blocks", count: 24 },
                { id: "labs", label: "CSIT & Labs", count: 6 },
                { id: "gates", label: "Campus Gates", count: 5 },
                { id: "assembly", label: "Assembly Zones", count: 7 },
              ].map((c) => (
                <Chip
                  key={c.id}
                  label={c.label}
                  count={c.count}
                  active={activeChip === c.id}
                  onClick={() => setActiveChip(c.id)}
                  onRemove={activeChip === c.id ? () => setActiveChip("") : undefined}
                />
              ))}
            </div>
          </Panel>
        </div>

        {/* 5. FIELDS, SEARCH, LIST ROWS & FEEDBACK */}
        <div className={styles.grid2}>
          <Panel code="SECTION 05A // INPUTS" title="SearchField & Coordinate / Endpoint Fields">
            <SearchField
              id="kit-search"
              label="Where To (Trie Prefix Search)"
              value={searchQuery}
              onChange={setSearchQuery}
              resultCount={4}
            />
            <div className={styles.fromToGrid}>
              <Field
                id="kit-from"
                label="Origin Node"
                unit="INDOOR"
                mono
                value={fromValue}
                onChange={(e) => setFromValue(e.target.value)}
                hint="CSIT Lecture Room 201"
              />
              <IconButton
                aria-label="Swap origin and destination"
                onClick={() => {
                  setFromValue(toValue);
                  setToValue(fromValue);
                }}
              >
                <SwapIcon size={16} />
              </IconButton>
              <Field
                id="kit-to"
                label="Destination"
                unit="LANDMARK #02"
                mono
                value={toValue}
                onChange={(e) => setToValue(e.target.value)}
                hint="Central Library (Engr. Abul Kalam)"
              />
            </div>
            <Field
              id="kit-error-field"
              label="Blocked Edge Validation"
              mono
              defaultValue="n999 -> n000"
              error="Node n999 does not exist in loaded 697-node campus topology."
            />
          </Panel>

          <Panel
            code="SECTION 05B // DIRECTORY & TELEMETRY"
            title="ListRow, Toast & SurveyLoader"
          >
            <div>
              <ListRow
                selected={selectedRow === "b-csit"}
                onClick={() => setSelectedRow("b-csit")}
                leading={<Badge variant="building">5</Badge>}
                title="Department of Computer Science & IT"
                subtitle="3 Floors // 48 Rooms // Indoor Graph Ready"
                trailing={<span>0.0 m</span>}
              />
              <ListRow
                selected={selectedRow === "b-library"}
                onClick={() => setSelectedRow("b-library")}
                leading={<Badge variant="building">2</Badge>}
                title="Engr. Abul Kalam Central Library"
                subtitle="3 Floors // 48 Rooms // Node n14"
                trailing={<span>312.4 m</span>}
              />
              <ListRow
                selected={selectedRow === "b-auditorium"}
                onClick={() => setSelectedRow("b-auditorium")}
                leading={<Badge variant="building">11</Badge>}
                title="Main Auditorium"
                subtitle="2 Floors // 26 Rooms // Node n57"
                trailing={<span>428.0 m</span>}
              />
            </div>

            <Divider label="TOASTS & SURVEY CALIBRATION LOADER" />
            <Toast
              code="WASM // NAVCORE 1.0.0"
              title="Merged 697 nodes (86 outdoor + 611 indoor) and 7 evacuation assembly zones."
              tone="safe"
            />
            <Toast
              code="EVACUATION // ALERT"
              title="Corridor node n28 blocked; rerouting 450 evacuees via Min-Cost Max-Flow."
              tone="hazard"
            />
            <div className={styles.rowWrap}>
              <SurveyLoader label="LOADING /DATA/GRAPH.JSON" />
            </div>
          </Panel>
        </div>

        {/* 6. FROSTED TRACING VELLUM & SHEET SPECIMEN */}
        <Panel
          code="SECTION 06 // FROSTED TRACING VELLUM & SHEET"
          title="Vellum Over Map Grid & Responsive Sheet Specimen"
        >
          <div className={styles.vellumStage}>
            <Sheet
              vellum
              snap={sheetSnap}
              onSnapChange={setSheetSnap}
              code="SPECIMEN // VELLUM SHEET"
              title="Frosted Tracing Vellum Sheet"
            >
              <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div className={styles.rowWrap} style={{ justifyContent: "space-between" }}>
                  <span className={styles.plateStamp}>
                    BACKDROP-FILTER: BLUR(12PX) // 1PX HAIRLINE EDGE // CHAMFERED PLATE
                  </span>
                  <Badge variant="vermilion" numeric>
                    SNAP: {sheetSnap.toUpperCase()}
                  </Badge>
                </div>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-ink-secondary)" }}>
                  Frosted tracing vellum is strictly reserved for panels floating over the map canvas
                  and automatically disables backdrop blur while the map is actively dragged or zoomed.
                </p>
              </div>
            </Sheet>
          </div>
        </Panel>
      </main>
    </div>
  );
}

