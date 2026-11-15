"use client";

import { useState } from "react";
import type {
  EvacDataset,
  EvacuateResponse,
  EvacuationCompareResponse,
} from "@/core/navcore";
import {
  Badge,
  Button,
  CloseIcon,
  HazardIcon,
  PeopleFlowIcon,
  PlayIcon,
  SearchField,
  type SearchOption,
  SegmentedControl,
  Toggle,
} from "@/ui";
import { EvacResultsCard } from "./EvacResultsCard";
import styles from "./evacuatePanel.module.css";

export interface EvacGroupItem {
  id: string;
  at: string;
  label: string;
  count: number;
}

export interface EvacuatePanelProps {
  searchOptions: SearchOption[];
  groups: EvacGroupItem[];
  onAddGroup: (at: string, label: string, count: number) => void;
  onRemoveGroup: (id: string) => void;
  onApplyPresetGroups: (preset: "lib-aud" | "campus-drill") => void;
  blockMode: boolean;
  onToggleBlockMode: (next: boolean) => void;
  blockedNodes: string[];
  blockedEdges: [string, string][];
  onBlockMainGateRoad: () => void;
  onRemoveBlockedNode: (nodeId: string) => void;
  onRemoveBlockedEdge: (a: string, b: string) => void;
  onClearBlocked: () => void;
  evacMode: "nearest" | "capacity";
  onChangeEvacMode: (mode: "nearest" | "capacity") => void;
  onRunEvacuation: () => void;
  isRunning: boolean;
  evacError: string | null;
  evacDataset: EvacDataset | null;
  evacResult: EvacuateResponse | null;
  evacCompare: EvacuationCompareResponse | null;
}

export function EvacuatePanel({
  searchOptions,
  groups,
  onAddGroup,
  onRemoveGroup,
  onApplyPresetGroups,
  blockMode,
  onToggleBlockMode,
  blockedNodes,
  blockedEdges,
  onBlockMainGateRoad,
  onRemoveBlockedNode,
  onRemoveBlockedEdge,
  onClearBlocked,
  evacMode,
  onChangeEvacMode,
  onRunEvacuation,
  isRunning,
  evacError,
  evacDataset,
  evacResult,
  evacCompare,
}: EvacuatePanelProps) {
  const [groupQuery, setGroupQuery] = useState("");
  const [selectedAt, setSelectedAt] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [groupCount, setGroupCount] = useState(150);

  const totalBlocked = blockedNodes.length + blockedEdges.length;
  const totalPeople = groups.reduce((acc, g) => acc + g.count, 0);

  return (
    <>
      <div className={styles.alertBand} role="status">
        <span className={styles.alertLeft}>
          <HazardIcon size={15} />
          Evacuation Drill &amp; Egress Planner
        </span>
        <Badge variant="hazard" numeric>
          {totalBlocked} blocked
        </Badge>
      </div>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>People groups</h3>

        <div className={styles.presetRow}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onApplyPresetGroups("lib-aud")}
          >
            Library 300 + Auditorium 200
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onApplyPresetGroups("campus-drill")}
          >
            Whole campus drill
          </Button>
        </div>

        <div className={styles.addRow}>
          <div className={styles.searchWrap}>
            <SearchField
              id="evac-group-search"
              label="Location"
              placeholder="Building or room..."
              value={groupQuery}
              onChange={(val) => {
                setGroupQuery(val);
                setSelectedAt("");
              }}
              options={searchOptions}
              onSelectOption={(opt) => {
                setGroupQuery(opt.label);
                setSelectedAt(opt.id);
                setSelectedLabel(opt.label);
              }}
            />
          </div>

          <div className={styles.stepperWrap}>
            <Button
              size="sm"
              variant="secondary"
              aria-label="Decrease count"
              onClick={() => setGroupCount((c) => Math.max(10, c - 50))}
            >
              -50
            </Button>
            <input
              type="number"
              min={1}
              max={5000}
              aria-label="People count"
              className={styles.countInput}
              value={groupCount}
              onChange={(e) =>
                setGroupCount(Math.max(1, Number(e.target.value) || 1))
              }
            />
            <Button
              size="sm"
              variant="secondary"
              aria-label="Increase count"
              onClick={() => setGroupCount((c) => Math.min(5000, c + 50))}
            >
              +50
            </Button>
          </div>

          <Button
            size="sm"
            variant="primary"
            disabled={!selectedAt}
            leadingIcon={<PeopleFlowIcon size={14} />}
            onClick={() => {
              if (!selectedAt) return;
              onAddGroup(selectedAt, selectedLabel || groupQuery, groupCount);
              setGroupQuery("");
              setSelectedAt("");
              setSelectedLabel("");
            }}
          >
            Add
          </Button>
        </div>

        {groups.length > 0 ? (
          <div className={styles.itemList}>
            {groups.map((g) => (
              <div key={g.id} className={styles.itemRow}>
                <span className={styles.itemLabel}>{g.label}</span>
                <span className={styles.itemRight}>
                  <span className={styles.numValue}>{g.count}</span>
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`Remove ${g.label}`}
                    leadingIcon={<CloseIcon size={12} />}
                    onClick={() => onRemoveGroup(g.id)}
                  />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.emptyHint}>
            Add a building/room group or choose a preset above.
          </p>
        )}
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>Path blocking</h3>
        <Toggle
          id="evac-block-paths"
          checked={blockMode}
          onChange={onToggleBlockMode}
          leadingIcon={<HazardIcon size={15} />}
          label="Block paths"
          hint="Tap map edges or junctions to mark blocked"
        />

        <div className={styles.presetRow}>
          <Button
            size="sm"
            variant="secondary"
            onClick={onBlockMainGateRoad}
          >
            Block Main Gate road
          </Button>
          {totalBlocked > 0 ? (
            <Button size="sm" variant="quiet" onClick={onClearBlocked}>
              Clear all
            </Button>
          ) : null}
        </div>

        {totalBlocked > 0 ? (
          <div className={styles.itemList}>
            {blockedEdges.map(([a, b]) => (
              <div
                key={`edge-${a}-${b}`}
                className={[styles.itemRow, styles.blockedRow].join(" ")}
              >
                <span className={styles.itemLabel}>
                  Path {a} ↔ {b}
                </span>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Unblock edge ${a} to ${b}`}
                  leadingIcon={<CloseIcon size={12} />}
                  onClick={() => onRemoveBlockedEdge(a, b)}
                />
              </div>
            ))}
            {blockedNodes.map((nid) => (
              <div
                key={`node-${nid}`}
                className={[styles.itemRow, styles.blockedRow].join(" ")}
              >
                <span className={styles.itemLabel}>Junction {nid}</span>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Unblock junction ${nid}`}
                  leadingIcon={<CloseIcon size={12} />}
                  onClick={() => onRemoveBlockedNode(nid)}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.emptyHint}>No paths or junctions blocked.</p>
        )}

        <p className={styles.fixedNote}>Lifts are off during evacuation.</p>
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>Evacuation mode</h3>
        <SegmentedControl
          name="evac-mode"
          value={evacMode}
          onChange={(val) => onChangeEvacMode(val as "nearest" | "capacity")}
          options={[
            { value: "nearest", label: "Nearest assembly" },
            { value: "capacity", label: "Capacity-aware" },
          ]}
        />
        <Button
          variant="primary"
          chamfer
          loading={isRunning}
          disabled={groups.length === 0}
          leadingIcon={<PlayIcon size={14} />}
          onClick={onRunEvacuation}
        >
          Run evacuation ({totalPeople} people)
        </Button>
        {evacError ? (
          <p className={styles.emptyHint} role="alert">
            {evacError}
          </p>
        ) : null}
      </section>

      <EvacResultsCard
        totalPeople={totalPeople}
        evacDataset={evacDataset}
        result={evacResult}
        compare={evacCompare}
      />
    </>
  );
}
