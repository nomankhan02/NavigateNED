#!/usr/bin/env python3
"""
Fix outdoor edges that cross 25%-shrunk building footprints by routing each
crossing edge's geometry around obstacle footprints using a visibility graph
over footprint corners pushed outward by 4 m.

Recomputes `w` as the honest Haversine geometry length (never below old `w`),
preserves endpoints, updates data/graph.json and web/public/data/graph.json,
and prints any edges that could not be fixed.
"""

from __future__ import annotations

import heapq
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_crossings import (  # noqa: E402
    build_node_to_landmarks,
    find_crossings,
    segment_crosses_polygon,
    shrink_polygon,
)


def haversine_m(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    r = 6371000.0
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = math.sin(dlat * 0.5) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng * 0.5) ** 2
    return 2.0 * r * math.asin(min(1.0, math.sqrt(h)))


def polyline_length_m(pts: List[Tuple[float, float]]) -> float:
    return sum(haversine_m(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def push_corners_outward(poly: List[List[float]], push_m: float = 4.0) -> List[Tuple[float, float]]:
    if len(poly) < 3:
        return []
    c_lat = sum(p[0] for p in poly) / len(poly)
    c_lng = sum(p[1] for p in poly) / len(poly)
    cos_lat = math.cos(math.radians(c_lat))
    pushed: List[Tuple[float, float]] = []
    for p in poly:
        dy = (p[0] - c_lat) * 111320.0
        dx = (p[1] - c_lng) * 111320.0 * cos_lat
        norm = math.hypot(dx, dy)
        if norm > 1e-6:
            scale_lat = (push_m * (dy / norm)) / 111320.0
            scale_lng = (push_m * (dx / norm)) / (111320.0 * cos_lat)
            pushed.append((p[0] + scale_lat, p[1] + scale_lng))
        else:
            pushed.append((p[0], p[1]))
    return pushed


def shortest_detour(
    start: Tuple[float, float],
    goal: Tuple[float, float],
    obstacles: List[List[Tuple[float, float]]],
    candidate_points: List[Tuple[float, float]],
) -> Optional[List[Tuple[float, float]]]:
    def is_clear(a: Tuple[float, float], b: Tuple[float, float]) -> bool:
        return not any(segment_crosses_polygon(a, b, obs) for obs in obstacles)

    if is_clear(start, goal):
        return [start, goal]

    # Filter candidate points strictly outside all obstacle interiors
    pts: List[Tuple[float, float]] = [start, goal]
    for cp in candidate_points:
        pts.append(cp)

    n = len(pts)
    dist = [float("inf")] * n
    prev = [-1] * n
    dist[0] = 0.0
    pq: List[Tuple[float, int]] = [(0.0, 0)]

    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u] + 1e-9:
            continue
        if u == 1:
            break
        for v in range(n):
            if v == u:
                continue
            w = haversine_m(pts[u], pts[v])
            if d + w >= dist[v]:
                continue
            if is_clear(pts[u], pts[v]):
                dist[v] = d + w
                prev[v] = u
                heapq.heappush(pq, (dist[v], v))

    if prev[1] == -1:
        return None

    path: List[Tuple[float, float]] = []
    cur = 1
    while cur != -1:
        path.append(pts[cur])
        cur = prev[cur]
    path.reverse()
    return path


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_graph_path = os.path.join(repo_root, "data", "graph.json")
    web_graph_path = os.path.join(repo_root, "web", "public", "data", "graph.json")

    with open(data_graph_path, "r", encoding="utf-8") as f:
        graph: Dict[str, Any] = json.load(f)

    nodes = {n["id"]: (float(n["lat"]), float(n["lng"])) for n in graph.get("nodes", [])}
    landmarks = graph.get("landmarks", [])
    node_owner_lms = build_node_to_landmarks(landmarks)

    all_obstacles: List[Tuple[str, List[Tuple[float, float]], List[Tuple[float, float]]]] = []
    for lm in landmarks:
        fp = lm.get("footprint", [])
        if len(fp) >= 3:
            all_obstacles.append((
                lm["id"],
                shrink_polygon(fp, 0.25),
                push_corners_outward(fp, 4.0),
            ))

    crossings = find_crossings(graph, 0.25)
    fixed_count = 0
    unfixable: List[str] = []

    for c in crossings:
        idx = c["edgeIndex"]
        edge = graph["edges"][idx]
        u, v = edge["a"], edge["b"]
        if u not in nodes or v not in nodes:
            unfixable.append(f"{u} -- {v} (missing node)")
            continue
        start, goal = nodes[u], nodes[v]
        ignored = node_owner_lms.get(u, set()) | node_owner_lms.get(v, set())
        obstacles = [shrunk for lid, shrunk, _ in all_obstacles if lid not in ignored]
        cand_pts: List[Tuple[float, float]] = []
        for lid, _, pushed in all_obstacles:
            if lid not in ignored:
                cand_pts.extend(pushed)

        detour = shortest_detour(start, goal, obstacles, cand_pts)
        if detour is None or len(detour) < 2:
            unfixable.append(f"{u} -- {v} (crosses {', '.join(c['landmarks'])})")
            continue

        old_w = float(edge.get("w", 0.0))
        new_w = polyline_length_m(detour)
        edge["geometry"] = [[round(p[0], 6), round(p[1], 6)] for p in detour]
        edge["w"] = round(max(old_w, new_w), 1)
        fixed_count += 1

    for out_path in (data_graph_path, web_graph_path):
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(graph, f, indent=2)
            f.write("\n")

    print(f"Fixed {fixed_count} crossing edge(s); {len(unfixable)} unfixable.")
    for item in unfixable:
        print(f"  [UNFIXABLE] {item}")


if __name__ == "__main__":
    main()
