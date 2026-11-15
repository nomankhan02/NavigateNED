"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type IndoorBuilding,
  type IndoorEvacuationData,
  IndoorMap,
  type IndoorNode,
} from "@/map";
import {
  Badge,
  Button,
  ChevronLeftIcon,
  LocateIcon,
} from "@/ui";
import styles from "./shell.module.css";

export interface IndoorStageProps {
  building: IndoorBuilding;
  buildingDisplayName: string;
  route?: string[];
  initialSelectedRoomId?: string;
  activeStepNodeId?: string | null;
  evacuation?: IndoorEvacuationData | null;
  onBackToCampus: () => void;
  onSetOriginFromRoom: (nodeId: string, label: string) => void;
}

export function IndoorStage({
  building,
  buildingDisplayName,
  route = [],
  initialSelectedRoomId,
  activeStepNodeId = null,
  evacuation = null,
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
    if (initialSelectedRoomId) {
      const roomNode = nodeById.get(initialSelectedRoomId);
      if (roomNode) return roomNode.floor;
    }
    if (activeStepNodeId) {
      const stepNode = nodeById.get(activeStepNodeId);
      if (stepNode) return stepNode.floor;
    }
    if (route.length > 0) {
      const first = nodeById.get(route[0]);
      if (first) return first.floor;
    }
    return building.floors[0]?.level ?? 0;
  }, [building, route, initialSelectedRoomId, activeStepNodeId, nodeById]);

  const [floor, setFloor] = useState<number>(initialFloor);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(
    initialSelectedRoomId ?? null,
  );
  const [userNode, setUserNode] = useState<string | null>(null);

  useEffect(() => {
    setFloor(initialFloor);
    setSelectedRoomId(initialSelectedRoomId ?? null);
  }, [building.id, initialFloor, initialSelectedRoomId]);

  // Follow RouteCard step changes: switch floor automatically when step moves to another floor
  useEffect(() => {
    if (!activeStepNodeId) return;
    const stepNode = nodeById.get(activeStepNodeId);
    if (stepNode) {
      setFloor(stepNode.floor);
    }
  }, [activeStepNodeId, nodeById]);

  const activeStepNode = activeStepNodeId ? nodeById.get(activeStepNodeId) : undefined;
  const selectedRoomNode = selectedRoomId ? nodeById.get(selectedRoomId) : undefined;
  const fallbackRouteNode = route.length > 0 ? nodeById.get(route[0]) : undefined;

  const imHereTargetNode = selectedRoomNode ?? activeStepNode ?? fallbackRouteNode;

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
          evacuation={evacuation}
        />
      </div>
    </div>
  );
}

