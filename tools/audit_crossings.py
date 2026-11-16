#!/usr/bin/env python3
"""
Audit outdoor graph edges whose geometry crosses any building footprint
shrunk 25% toward its centroid, ignoring buildings that either endpoint
belongs to (official nodeId or accessNodeIds).
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Set, Tuple


def shrink_polygon(poly: List[List[float]], shrink_ratio: float = 0.25) -> List[Tuple[float, float]]:
    if len(poly) < 3:
        return []
    c_lat = sum(p[0] for p in poly) / len(poly)
    c_lng = sum(p[1] for p in poly) / len(poly)
    scale = 1.0 - shrink_ratio
    return [
        (c_lat + (p[0] - c_lat) * scale, c_lng + (p[1] - c_lng) * scale)
        for p in poly
    ]


def point_in_polygon(lat: float, lng: float, poly: List[Tuple[float, float]]) -> bool:
    if len(poly) < 3:
        return False
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) if (yj - yi) != 0 else 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def _orient(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> float:
    return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])


def _on_segment(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> bool:
    return (
        min(a[0], b[0]) - 1e-12 <= c[0] <= max(a[0], b[0]) + 1e-12
        and min(a[1], b[1]) - 1e-12 <= c[1] <= max(a[1], b[1]) + 1e-12
    )


def segments_intersect(
    a: Tuple[float, float],
    b: Tuple[float, float],
    c: Tuple[float, float],
    d: Tuple[float, float],
) -> bool:
    o1 = _orient(a, b, c)
    o2 = _orient(a, b, d)
    o3 = _orient(c, d, a)
    o4 = _orient(c, d, b)
    if (o1 > 1e-13 and o2 < -1e-13 or o1 < -1e-13 and o2 > 1e-13) and (
        o3 > 1e-13 and o4 < -1e-13 or o3 < -1e-13 and o4 > 1e-13
    ):
        return True
    if abs(o1) <= 1e-13 and _on_segment(a, b, c):
        return True
    if abs(o2) <= 1e-13 and _on_segment(a, b, d):
        return True
    if abs(o3) <= 1e-13 and _on_segment(c, d, a):
        return True
    if abs(o4) <= 1e-13 and _on_segment(c, d, b):
        return True
    return False


def segment_crosses_polygon(
    a: Tuple[float, float],
    b: Tuple[float, float],
    poly: List[Tuple[float, float]],
) -> bool:
    if len(poly) < 3:
        return False
    if point_in_polygon(a[0], a[1], poly) or point_in_polygon(b[0], b[1], poly):
        return True
    mid = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)
    if point_in_polygon(mid[0], mid[1], poly):
        return True
    n = len(poly)
    for i in range(n):
        if segments_intersect(a, b, poly[i], poly[(i + 1) % n]):
            return True
    return False


def build_node_to_landmarks(landmarks: List[Dict[str, Any]]) -> Dict[str, Set[str]]:
    mapping: Dict[str, Set[str]] = {}
    for lm in landmarks:
        lid = lm.get("id", "")
        if not lid:
            continue
        nid = lm.get("nodeId")
        if nid:
            mapping.setdefault(nid, set()).add(lid)
        for aid in lm.get("accessNodeIds", []):
            mapping.setdefault(aid, set()).add(lid)
    return mapping


def find_crossings(graph: Dict[str, Any], shrink_ratio: float = 0.25) -> List[Dict[str, Any]]:
    nodes = {n["id"]: (float(n["lat"]), float(n["lng"])) for n in graph.get("nodes", [])}
    landmarks = graph.get("landmarks", [])
    node_owner_lms = build_node_to_landmarks(landmarks)

    shrunk_polys: List[Tuple[str, List[Tuple[float, float]]]] = []
    for lm in landmarks:
        fp = lm.get("footprint", [])
        if len(fp) >= 3:
            shrunk_polys.append((lm["id"], shrink_polygon(fp, shrink_ratio)))

    crossings: List[Dict[str, Any]] = []
    for idx, edge in enumerate(graph.get("edges", [])):
        u, v = edge["a"], edge["b"]
        geom = edge.get("geometry")
        if geom and len(geom) >= 2:
            pts = [(float(p[0]), float(p[1])) for p in geom]
        elif u in nodes and v in nodes:
            pts = [nodes[u], nodes[v]]
        else:
            continue

        ignored = node_owner_lms.get(u, set()) | node_owner_lms.get(v, set())
        hit_landmarks: List[str] = []
        for lid, poly in shrunk_polys:
            if lid in ignored:
                continue
            if any(segment_crosses_polygon(pts[i], pts[i + 1], poly) for i in range(len(pts) - 1)):
                hit_landmarks.append(lid)

        if hit_landmarks:
            crossings.append({
                "edgeIndex": idx,
                "a": u,
                "b": v,
                "landmarks": hit_landmarks,
            })
    return crossings


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    graph_path = os.path.join(repo_root, "data", "graph.json")
    with open(graph_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    crossings = find_crossings(graph, 0.25)
    print(f"Audited {len(graph.get('edges', []))} edges against 25%-shrunk footprints: {len(crossings)} crossing(s).")
    for c in crossings:
        print(f"  - {c['a']} -- {c['b']} crosses {', '.join(c['landmarks'])}")


if __name__ == "__main__":
    main()
