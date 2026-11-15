"use client";

import { useEffect, useMemo, useState } from "react";
import { type IndoorBuilding, IndoorMap, type IndoorNode } from "@/map";
import {
  Badge,
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  LocateIcon,
} from "@/ui";
import styles from "./shell.module.css";

export interface IndoorStageProps {
  building: IndoorBuilding;
  buildingDisplayName: string;
  route?: string[];
  onBackToCampus: () => void;
  onSetOriginFromRoom: (nodeId: string, label: string) => void;
}

export function IndoorStage({
  building,
  buildingDisplayName,
  route = [],
  onBackToCampus,
  onSetOriginFromRoom,
}: IndoorStageProps) {
  const nodeById = useMemo(() => {
    const map = new Map<string, IndoorNode>();
    for (const n of building.nodes) {
      map.set(n.id, n);
    }
    return map;
  }, [building]);

  const initialFloor = useMemo(() => {
    if (route.length > 0) {
      const first = nodeById.get(route[0]);
      if (first) return first.floor;
    }
    return building.floors[0]?.level ?? 0;
  }, [building, route, nodeById]);

  const [floor, setFloor] = useState<number>(initialFloor);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [userNode, setUserNode] = useState<string | null>(null);

  useEffect(() => {
    setStepIndex(0);
    setFloor(initialFloor);
  }, [building.id, initialFloor]);

  const activeStepNodeId = route[stepIndex] ?? null;
  const activeStepNode = activeStepNodeId ? nodeById.get(activeStepNodeId) : undefined;
  const selectedRoomNode = selectedRoomId ? nodeById.get(selectedRoomId) : undefined;

  const imHereTargetNode = selectedRoomNode ?? activeStepNode;

  const handleStep = (delta: number) => {
    if (route.length === 0) return;
    const nextIdx = Math.max(0, Math.min(route.length - 1, stepIndex + delta));
    setStepIndex(nextIdx);
    const nextNode = nodeById.get(route[nextIdx]);
    if (nextNode) {
      setFloor(nextNode.floor);
    }
  };

  const handleImHere = () => {
    const target = imHereTargetNode;
    if (!target) return;
    setUserNode(target.id);
    const label = target.name
      ? `${target.name} (${buildingDisplayName})`
      : `${buildingDisplayName} (Floor ${target.floor})`;
    onSetOriginFromRoom(target.id, label);
  };

  const floorRoute = useMemo(
    () => route.filter((id) => nodeById.get(id)?.floor === floor),
    [route, nodeById, floor],
  );

  return (
    <div className={styles.indoorStage}>
      <div className={styles.indoorToolbar}>
        <div className={styles.indoorToolbarLeft}>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<ChevronLeftIcon size={15} />}
            onClick={onBackToCampus}
          >
            Back to campus
          </Button>
          <span className={styles.indoorTitle}>{buildingDisplayName}</span>
          <Badge variant="teal" numeric>
            FLOOR {floor}
          </Badge>
        </div>

        <div className={styles.indoorToolbarRight}>
          {route.length > 0 ? (
            <div className={styles.indoorStepper}>
              <Button
                size="sm"
                variant="secondary"
                disabled={stepIndex <= 0}
                leadingIcon={<ChevronLeftIcon size={14} />}
                onClick={() => handleStep(-1)}
              >
                Back
              </Button>
              <span className={styles.indoorStepCounter}>
                {stepIndex + 1} / {route.length}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={stepIndex >= route.length - 1}
                trailingIcon={<ChevronRightIcon size={14} />}
                onClick={() => handleStep(1)}
              >
                Next
              </Button>
            </div>
          ) : null}

          <Button
            size="sm"
            variant="primary"
            disabled={!imHereTargetNode}
            leadingIcon={<LocateIcon size={14} />}
            onClick={handleImHere}
          >
            I&apos;m here
          </Button>
        </div>
      </div>

      <div className={styles.indoorMapWrap}>
        <IndoorMap
          building={building}
          floor={floor}
          onFloorChange={setFloor}
          route={floorRoute.length > 0 ? floorRoute : route}
          highlightedNodeIds={activeStepNodeId ? [activeStepNodeId] : undefined}
          selectedRoomId={selectedRoomId}
          onRoomClick={(roomId) => setSelectedRoomId(roomId)}
          userNode={userNode}
        />
      </div>
    </div>
  );
}
