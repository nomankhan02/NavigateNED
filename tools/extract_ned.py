#!/usr/bin/env python3
"""
tools/extract_ned.py - Georeferenced Campus Graph Extractor for NED University.
Converts TraverseNED campus data into NavigateNED contracts.md specifications.
"""

import json
import math
import os
import re

EARTH_RADIUS_M = 6371000.0


def haversine(c1, c2):
    """Computes great-circle distance in meters between two [lat, lng] points."""
    lat1, lon1 = c1[0], c1[1]
    lat2, lon2 = c2[0], c2[1]
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_M * c


def slugify_building(landmark):
    """Generates standardized b-<slug> identifiers aligned with contracts.md."""
    lid = landmark.get("id", "")
    if lid == "poi-5":
        return "b-csit"
    if lid == "poi-library":
        return "b-library"
    if lid == "poi-27":
        return "b-admin"

    name = landmark.get("shortName") or landmark.get("name") or "building"
    cleaned = re.sub(r"\(.*?\)", "", name).lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", cleaned).strip("-")
    return f"b-{cleaned}"


def extract():
    src_file = os.path.join(".ref", "TraverseNED", "data", "campus_nodes.js")
    if not os.path.exists(src_file):
        raise FileNotFoundError(
            f"Reference source file not found: {src_file}. "
            "Please clone TraverseNED into .ref/ first."
        )

    with open(src_file, "r", encoding="utf-8") as f:
        content = f.read()

    start_idx = content.find("{")
    end_idx = content.rfind("}")
    raw_json_str = content[start_idx : end_idx + 1]
    raw_data = json.loads(raw_json_str)

    raw_meta = raw_data.get("meta", {})
    walkway_nodes = raw_data.get("walkwayGraph", {}).get("nodes", {})
    walkway_edges = raw_data.get("walkwayGraph", {}).get("edges", [])
    raw_landmarks = raw_data.get("landmarks", [])

    # Prepare node mappings
    nodes = []
    node_id_map = {}  # new_id -> dict
    raw_walkway_to_new = {}
    node_counter = 1

    # 1. Ingest base walkway nodes
    for raw_id, n in walkway_nodes.items():
        new_id = f"n{node_counter}"
        node_counter += 1
        raw_walkway_to_new[raw_id] = new_id

        kind = "path"
        if "gate_main" in raw_id or "gate_north" in raw_id:
            kind = "gate"

        node_obj = {
            "id": new_id,
            "lat": round(float(n["lat"]), 6),
            "lng": round(float(n["lng"]), 6),
            "kind": kind,
        }
        node_id_map[new_id] = node_obj
        nodes.append(node_obj)

    # 2. Map landmark entrances to nodes
    landmark_entrance_node = {}

    for l in raw_landmarks:
        ent_coords = l.get("entrance_coords") or l.get("coordinates")
        elat = round(float(ent_coords[0]), 6)
        elng = round(float(ent_coords[1]), 6)

        # Match against existing nodes within ~1 meter tolerance
        matched_id = None
        for nid, nobj in node_id_map.items():
            if haversine([nobj["lat"], nobj["lng"]], [elat, elng]) < 1.0:
                matched_id = nid
                break

        kind = "entrance"
        if l.get("id") in ("poi-cricket", "poi-soccer"):
            kind = "assembly"
        elif "gate" in l.get("id", ""):
            kind = "gate"

        if matched_id:
            if node_id_map[matched_id]["kind"] == "path":
                node_id_map[matched_id]["kind"] = kind
            landmark_entrance_node[l["id"]] = matched_id
        else:
            new_id = f"n{node_counter}"
            node_counter += 1
            node_obj = {
                "id": new_id,
                "lat": elat,
                "lng": elng,
                "kind": kind,
            }
            node_id_map[new_id] = node_obj
            nodes.append(node_obj)
            landmark_entrance_node[l["id"]] = new_id

    # 3. Create edges with Haversine weights
    edges = []
    edge_pairs = set()

    def add_edge(u, v):
        if u == v:
            return
        pair = tuple(sorted([u, v]))
        if pair in edge_pairs:
            return
        edge_pairs.add(pair)

        n1 = node_id_map[u]
        n2 = node_id_map[v]
        dist = round(haversine([n1["lat"], n1["lng"]], [n2["lat"], n2["lng"]]), 1)
        edges.append(
            {
                "a": u,
                "b": v,
                "w": dist,
                "oneway": False,
                "covered": False,
            }
        )

    # Add walkway network edges
    for edge in walkway_edges:
        u_raw, v_raw = edge[0], edge[1]
        if u_raw in raw_walkway_to_new and v_raw in raw_walkway_to_new:
            add_edge(raw_walkway_to_new[u_raw], raw_walkway_to_new[v_raw])

    # Connect landmark entrance nodes to nearest designated walkway node
    for l in raw_landmarks:
        ent_nid = landmark_entrance_node[l["id"]]
        nearest_raw = l.get("nearestNode")
        if nearest_raw and nearest_raw in raw_walkway_to_new:
            target_nid = raw_walkway_to_new[nearest_raw]
            add_edge(ent_nid, target_nid)

    # 4. Landmarks mapping
    landmarks = []
    category_map = {
        "academic": "academic",
        "services": "services",
        "labs": "labs",
        "landmark": "landmark",
        "administration": "administration",
        "cafeteria": "cafeteria",
        "emergency": "emergency",
        "library": "library",
        "sports": "sports",
        "hostels": "hostels",
        "gate": "gate",
    }

    for l in raw_landmarks:
        b_id = slugify_building(l)
        raw_cat = (l.get("category") or "services").strip().lower()
        cat = category_map.get(raw_cat, "services")

        # Fallback bounding box footprint if polygon missing
        footprint = l.get("footprintPolygon")
        if not footprint or len(footprint) == 0:
            if l.get("id") == "poi-soccer" and raw_meta.get("soccerPolygon"):
                footprint = raw_meta.get("soccerPolygon")
            elif l.get("id") == "poi-cricket":
                clat = 24.93202
                clng = 67.11531
                r_lat = 62.0 / EARTH_RADIUS_M * (180.0 / math.pi)
                r_lng = r_lat / math.cos(math.radians(clat))
                footprint = [
                    [
                        round(clat + r_lat * math.sin(2.0 * math.pi * k / 16), 6),
                        round(clng + r_lng * math.cos(2.0 * math.pi * k / 16), 6),
                    ]
                    for k in range(16)
                ]
            else:
                clat = float(l["coordinates"][0])
                clng = float(l["coordinates"][1])
                # Small ~15m footprint box
                dlat = 0.00012
                dlng = 0.00012
                footprint = [
                    [round(clat - dlat, 6), round(clng - dlng, 6)],
                    [round(clat + dlat, 6), round(clng - dlng, 6)],
                    [round(clat + dlat, 6), round(clng + dlng, 6)],
                    [round(clat - dlat, 6), round(clng + dlng, 6)],
                ]

        landmark_obj = {
            "id": b_id,
            "name": l.get("name", ""),
            "short": l.get("shortName") or l.get("name", ""),
            "nodeId": landmark_entrance_node[l["id"]],
            "category": cat,
            "footprint": [[round(pt[0], 6), round(pt[1], 6)] for pt in footprint],
        }
        landmarks.append(landmark_obj)

    # 5. Meta section
    out_meta = {
        "version": "1.0",
        "origin": raw_meta.get("center", [24.9322, 67.1133]),
        "campusName": raw_meta.get("name", "NED University of Engineering & Technology"),
        "city": raw_meta.get("city", "Karachi, Pakistan"),
        "masterPlanControlCorners": raw_meta.get(
            "masterPlanControlCorners",
            {
                "topLeft": [24.93788, 67.11341],
                "topRight": [24.93076, 67.11837],
                "bottomLeft": [24.93389, 67.10644],
                "bottomRight": [24.92677, 67.11141],
            },
        ),
        "mapOverlay": {
            "image": "/map/ned_master_plan.jpg",
            "corners": raw_meta.get("masterPlanControlCorners", {}),
        },
    }

    graph = {
        "meta": out_meta,
        "nodes": nodes,
        "edges": edges,
        "landmarks": landmarks,
    }

    out_file = os.path.join("data", "graph.json")
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2)

    print(
        f"Extraction successful: {out_file} written.\n"
        f"- Nodes: {len(nodes)}\n"
        f"- Edges: {len(edges)}\n"
        f"- Landmarks: {len(landmarks)}"
    )


if __name__ == "__main__":
    extract()

