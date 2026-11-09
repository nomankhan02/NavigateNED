#!/usr/bin/env python3
"""
tools/generate_evac.py - Emergency Evacuation Assembly Areas & Building Exits Generator.
Outputs data/evac.json per contracts.md and syncs data/graph.json if new assembly nodes are added.
"""

import json
import math
import os
import shutil

EARTH_RADIUS_M = 6371000.0


def haversine(c1, c2):
    """Computes great-circle distance in meters between two [lat, lng] coordinates."""
    lat1, lon1 = c1[0], c1[1]
    lat2, lon2 = c2[0], c2[1]
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return EARTH_RADIUS_M * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


ASSEMBLY_CANDIDATES = [
    {
        "id": "a-cricket-ground",
        "name": "NED Cricket Ground",
        "landmarkId": "b-cricket-ground",
        "coords": [24.93181, 67.11467],
        "capacity": 1800,
    },
    {
        "id": "a-soccer-field",
        "name": "Soccer Field & Athletics Track",
        "landmarkId": "b-soccer-field",
        "coords": [24.93130, 67.11585],
        "capacity": 1500,
    },
    {
        "id": "a-courtyard-fountain",
        "name": "Courtyard Fountain Central Plaza",
        "landmarkId": "b-courtyard-fountain",
        "coords": [24.93182, 67.11278],
        "capacity": 600,
    },
    {
        "id": "a-main-gate",
        "name": "Main Gate (G1) Assembly Zone",
        "landmarkId": "b-main-gate",
        "coords": [24.92901, 67.11350],
        "capacity": 800,
    },
    {
        "id": "a-bank-gate",
        "name": "Bank & Sports Gate (G2) Assembly Zone",
        "landmarkId": "b-bank-gate",
        "coords": [24.93006, 67.11555],
        "capacity": 700,
    },
    {
        "id": "a-squash-tennis",
        "name": "Squash & Tennis Complex Open Lawn",
        "landmarkId": "b-squash-tennis",
        "coords": [24.93276, 67.11561],
        "capacity": 500,
    },
    {
        "id": "a-masjid-plaza",
        "name": "Main Masjid Courtyard Plaza",
        "landmarkId": "b-main-masjid",
        "coords": [24.93399, 67.11127],
        "capacity": 900,
    },
]


def generate_evac():
    graph_path = os.path.join("data", "graph.json")
    web_graph_path = os.path.join("web", "public", "data", "graph.json")
    indoor_dir = os.path.join("data", "indoor")
    evac_path = os.path.join("data", "evac.json")

    with open(graph_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    landmarks = {lm["id"]: lm for lm in graph.get("landmarks", [])}
    node_map = {n["id"]: n for n in nodes}

    graph_modified = False
    assembly_areas = []

    for cand in ASSEMBLY_CANDIDATES:
        target_nid = None
        lmid = cand.get("landmarkId")
        if lmid and lmid in landmarks:
            cand_nid = landmarks[lmid].get("nodeId")
            if cand_nid in node_map:
                target_nid = cand_nid

        # Fallback: snap to nearest node within 25m
        if not target_nid:
            best_dist = float("inf")
            for n in nodes:
                d = haversine(cand["coords"], [n["lat"], n["lng"]])
                if d < best_dist:
                    best_dist = d
                    target_nid = n["id"]
            if best_dist > 25.0:
                target_nid = None

        # If no suitable node exists, add one as kind "assembly" and connect to 2 nearest path nodes
        if not target_nid:
            max_num = max(int(n["id"][1:]) for n in nodes if n["id"].startswith("n") and n["id"][1:].isdigit())
            target_nid = f"n{max_num + 1}"
            new_node = {
                "id": target_nid,
                "lat": round(cand["coords"][0], 6),
                "lng": round(cand["coords"][1], 6),
                "kind": "assembly",
            }
            nodes.append(new_node)
            node_map[target_nid] = new_node

            path_nodes = sorted(
                [n for n in nodes if n["id"] != target_nid],
                key=lambda n: haversine(cand["coords"], [n["lat"], n["lng"]]),
            )[:2]
            for pn in path_nodes:
                w = round(haversine(cand["coords"], [pn["lat"], pn["lng"]]), 1)
                edges.append({
                    "a": target_nid,
                    "b": pn["id"],
                    "w": w,
                    "oneway": False,
                    "covered": False,
                })
            graph_modified = True

        assembly_areas.append({
            "id": cand["id"],
            "name": cand["name"],
            "nodeId": target_nid,
            "capacity": cand["capacity"],
        })

    if graph_modified:
        with open(graph_path, "w", encoding="utf-8") as f:
            json.dump(graph, f, indent=2)
        if os.path.exists( os.path.dirname(web_graph_path) ):
            shutil.copyfile(graph_path, web_graph_path)

    # Collect buildingExits from all indoor buildings (using their exit nodes)
    building_exits = []
    if os.path.isdir(indoor_dir):
        for fname in sorted(os.listdir(indoor_dir)):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(indoor_dir, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                ind = json.load(f)
            bid = ind["id"]
            exit_nodes = [n["id"] for n in ind.get("nodes", []) if n.get("type") == "exit"]
            for ex_nid in exit_nodes:
                building_exits.append({
                    "buildingId": bid,
                    "nodeId": ex_nid,
                })

    evac_data = {
        "assemblyAreas": assembly_areas,
        "buildingExits": building_exits,
    }

    with open(evac_path, "w", encoding="utf-8") as f:
        json.dump(evac_data, f, indent=2)

    print(
        f"Generated {evac_path}:\n"
        f"- Assembly Areas: {len(assembly_areas)} (Total capacity: {sum(a['capacity'] for a in assembly_areas)})\n"
        f"- Building Exits: {len(building_exits)} across {len({b['buildingId'] for b in building_exits})} indoor buildings"
    )


if __name__ == "__main__":
    generate_evac()
