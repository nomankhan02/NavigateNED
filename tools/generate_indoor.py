#!/usr/bin/env python3
"""
tools/generate_indoor.py - Multi-floor Indoor Navigation Graph Generator for NavigateNED.
Outputs data/indoor/<buildingId>.json per contracts.md.
"""

import json
import math
import os
import struct
import zlib


def dist2d(p1, p2):
    return round(math.hypot(p1[0] - p2[0], p1[1] - p2[1]), 1)


def add_walk_edge(edges, edge_set, a, b, node_lookup):
    if a == b:
        return
    key = tuple(sorted([a, b]))
    if key in edge_set:
        return
    edge_set.add(key)
    na = node_lookup[a]
    nb = node_lookup[b]
    w = max(0.5, dist2d((na["x"], na["y"]), (nb["x"], nb["y"])))
    edges.append({
        "a": a,
        "b": b,
        "kind": "walk",
        "w": w,
        "accessible": True,
    })


def build_ring_floor(bid, fl, room_Specs, is_ground, variant="standard"):
    """
    Ring template: 70 x 44 m, corridor width 3.6 m, room width ~6.2 m.
    Corridor centerlines:
      North: y=11.8, x in [11.8, 58.2]
      South: y=32.2, x in [11.8, 58.2]
      West:  x=11.8, y in [11.8, 32.2]
      East:  x=58.2, y in [11.8, 32.2]
    """
    nodes = []
    rooms = []
    walk_links = []

    def nid(suffix):
        return f"{bid}:f{fl}_{suffix}"

    # Corridor backbone nodes
    xs = [11.8, 17.5, 24.3, 31.1, 35.0, 38.9, 45.7, 52.5, 58.2]
    for i, x in enumerate(xs):
        nodes.append({"id": nid(f"cn_{i}"), "x": x, "y": 11.8, "floor": fl, "type": "corridor"})
        if i > 0:
            walk_links.append((nid(f"cn_{i-1}"), nid(f"cn_{i}")))

    for i, x in enumerate(xs):
        nodes.append({"id": nid(f"cs_{i}"), "x": x, "y": 32.2, "floor": fl, "type": "corridor"})
        if i > 0:
            walk_links.append((nid(f"cs_{i-1}"), nid(f"cs_{i}")))

    ys_mid = [17.3, 22.0, 26.7]
    w_chain = [nid("cn_0")] + [nid(f"cw_{j}") for j in range(len(ys_mid))] + [nid("cs_0")]
    e_chain = [nid("cn_8")] + [nid(f"ce_{j}") for j in range(len(ys_mid))] + [nid("cs_8")]

    for j, y in enumerate(ys_mid):
        nodes.append({"id": nid(f"cw_{j}"), "x": 11.8, "y": y, "floor": fl, "type": "corridor"})
        nodes.append({"id": nid(f"ce_{j}"), "x": 58.2, "y": y, "floor": fl, "type": "corridor"})

    for k in range(len(w_chain) - 1):
        walk_links.append((w_chain[k], w_chain[k + 1]))
        walk_links.append((e_chain[k], e_chain[k + 1]))

    # Stairs and Lift inside inner ring core
    stairs_id = nid("stairs")
    lift_id = nid("lift")
    nodes.append({"id": stairs_id, "x": 16.5, "y": 22.0, "floor": fl, "type": "stairs", "name": f"Staircase F{fl}"})
    nodes.append({"id": lift_id, "x": 53.5, "y": 22.0, "floor": fl, "type": "lift", "name": f"Elevator F{fl}"})
    walk_links.append((stairs_id, nid("cw_1")))
    walk_links.append((lift_id, nid("ce_1")))

    # Ground floor entrance and exits
    if is_ground:
        ent_id = f"{bid}:ent"
        exit1_id = f"{bid}:exit_nw"
        exit2_id = f"{bid}:exit_ne"
        nodes.append({"id": ent_id, "x": 35.0, "y": 41.5, "floor": fl, "type": "entrance", "name": "Main Entrance"})
        nodes.append({"id": exit1_id, "x": 11.8, "y": 1.8, "floor": fl, "type": "exit", "name": "North-West Emergency Exit"})
        nodes.append({"id": exit2_id, "x": 58.2, "y": 1.8, "floor": fl, "type": "exit", "name": "North-East Emergency Exit"})
        walk_links.append((ent_id, nid("cs_4")))
        walk_links.append((exit1_id, nid("cn_0")))
        walk_links.append((exit2_id, nid("cn_8")))

    # Candidate non-overlapping room slots (all ~6.2m wide)
    slots = [
        # North outer row (6 rooms, y=2.0, h=7.6, w=6.2)
        (14.4, 2.0, 6.2, 7.6, nid("cn_1")),
        (21.2, 2.0, 6.2, 7.6, nid("cn_2")),
        (28.0, 2.0, 6.2, 7.6, nid("cn_3")),
        (35.8, 2.0, 6.2, 7.6, nid("cn_5")),
        (42.6, 2.0, 6.2, 7.6, nid("cn_6")),
        (49.4, 2.0, 6.2, 7.6, nid("cn_7")),
        # West outer col (2 rooms, x=1.8, w=7.8, h=6.2)
        (1.8, 14.2, 7.8, 6.2, nid("cw_0")),
        (1.8, 23.6, 7.8, 6.2, nid("cw_2")),
        # East outer col (2 rooms, x=60.4, w=7.8, h=6.2)
        (60.4, 14.2, 7.8, 6.2, nid("ce_0")),
        (60.4, 23.6, 7.8, 6.2, nid("ce_2")),
        # South outer row (4 flanking rooms, y=34.4, h=7.6, w=6.2)
        (14.4, 34.4, 6.2, 7.6, nid("cs_1")),
        (21.2, 34.4, 6.2, 7.6, nid("cs_2")),
        (42.6, 34.4, 6.2, 7.6, nid("cs_6")),
        (49.4, 34.4, 6.2, 7.6, nid("cs_7")),
    ]
    if variant == "inner_wings":
        # Inner courtyard rooms for admin variant
        slots.append((22.0, 14.4, 6.2, 6.8, nid("cn_2")))
        slots.append((41.8, 14.4, 6.2, 6.8, nid("cn_6")))
        slots.append((22.0, 22.8, 6.2, 6.8, nid("cs_2")))
        slots.append((41.8, 22.8, 6.2, 6.8, nid("cs_6")))
    else:
        # Inner courtyard seminar rooms for standard ring
        slots.append((24.8, 14.4, 6.2, 7.0, nid("cn_3")))
        slots.append((39.0, 14.4, 6.2, 7.0, nid("cn_5")))

    for idx, (r_code, r_name) in enumerate(room_Specs):
        if idx >= len(slots):
            break
        rx, ry, rw, rh, corr_id = slots[idx]
        r_id = f"{bid}:{r_code}"
        cx = round(rx + rw / 2.0, 1)
        cy = round(ry + rh / 2.0, 1)
        nodes.append({"id": r_id, "x": cx, "y": cy, "floor": fl, "type": "room", "name": r_name})
        rooms.append({"nodeId": r_id, "rect": [round(rx, 1), round(ry, 1), round(rw, 1), round(rh, 1)]})
        walk_links.append((r_id, corr_id))

    return nodes, rooms, walk_links, stairs_id, lift_id


def build_u_floor(bid, fl, room_specs, is_ground, variant="standard"):
    """
    U template: 70 x 50 m, corridor width 3.6 m, room width ~6.2 m.
    Corridor centerlines:
      West leg:   x=11.8, y in [8.0, 38.2]
      East leg:   x=58.2, y in [8.0, 38.2]
      South base: y=38.2, x in [11.8, 58.2]
    """
    nodes = []
    rooms = []
    walk_links = []

    def nid(suffix):
        return f"{bid}:f{fl}_{suffix}"

    ys = [8.0, 11.5, 18.5, 25.5, 32.5, 38.2]
    for j, y in enumerate(ys):
        nodes.append({"id": nid(f"cw_{j}"), "x": 11.8, "y": y, "floor": fl, "type": "corridor"})
        nodes.append({"id": nid(f"ce_{j}"), "x": 58.2, "y": y, "floor": fl, "type": "corridor"})
        if j > 0:
            walk_links.append((nid(f"cw_{j-1}"), nid(f"cw_{j}")))
            walk_links.append((nid(f"ce_{j-1}"), nid(f"ce_{j}")))

    xs_south = [17.5, 24.0, 31.0, 35.0, 39.0, 46.0, 52.5]
    s_chain = [nid("cw_5")] + [nid(f"cs_{i}") for i in range(len(xs_south))] + [nid("ce_5")]
    for i, x in enumerate(xs_south):
        nodes.append({"id": nid(f"cs_{i}"), "x": x, "y": 38.2, "floor": fl, "type": "corridor"})
    for k in range(len(s_chain) - 1):
        walk_links.append((s_chain[k], s_chain[k + 1]))

    stairs_id = nid("stairs")
    lift_id = nid("lift")
    nodes.append({"id": stairs_id, "x": 24.0, "y": 33.0, "floor": fl, "type": "stairs", "name": f"Staircase F{fl}"})
    nodes.append({"id": lift_id, "x": 46.0, "y": 33.0, "floor": fl, "type": "lift", "name": f"Elevator F{fl}"})
    walk_links.append((stairs_id, nid("cs_1")))
    walk_links.append((lift_id, nid("cs_5")))

    if is_ground:
        ent_id = f"{bid}:ent"
        exit1_id = f"{bid}:exit_w"
        exit2_id = f"{bid}:exit_e"
        nodes.append({"id": ent_id, "x": 35.0, "y": 47.5, "floor": fl, "type": "entrance", "name": "Main Entrance"})
        nodes.append({"id": exit1_id, "x": 11.8, "y": 2.5, "floor": fl, "type": "exit", "name": "West Wing Emergency Exit"})
        nodes.append({"id": exit2_id, "x": 58.2, "y": 2.5, "floor": fl, "type": "exit", "name": "East Wing Emergency Exit"})
        walk_links.append((ent_id, nid("cs_3")))
        walk_links.append((exit1_id, nid("cw_0")))
        walk_links.append((exit2_id, nid("ce_0")))

    if variant == "auditorium":
        # Central Auditorium Bowl + flanking rooms
        slots = [
            (25.0, 8.0, 20.0, 21.0, nid("cs_3")),  # Main Auditorium Bowl / Balcony
            (1.8, 8.4, 7.8, 6.2, nid("cw_1")),
            (1.8, 15.4, 7.8, 6.2, nid("cw_2")),
            (1.8, 22.4, 7.8, 6.2, nid("cw_3")),
            (1.8, 29.4, 7.8, 6.2, nid("cw_4")),
            (60.4, 8.4, 7.8, 6.2, nid("ce_1")),
            (60.4, 15.4, 7.8, 6.2, nid("ce_2")),
            (60.4, 22.4, 7.8, 6.2, nid("ce_3")),
            (60.4, 29.4, 7.8, 6.2, nid("ce_4")),
            (14.4, 40.4, 6.2, 7.6, nid("cs_0")),
            (21.2, 40.4, 6.2, 7.6, nid("cs_1")),
            (42.6, 40.4, 6.2, 7.6, nid("cs_5")),
            (49.4, 40.4, 6.2, 7.6, nid("cs_6")),
        ]
    else:
        slots = [
            # West outer col (4 rooms, h=6.2)
            (1.8, 8.4, 7.8, 6.2, nid("cw_1")),
            (1.8, 15.4, 7.8, 6.2, nid("cw_2")),
            (1.8, 22.4, 7.8, 6.2, nid("cw_3")),
            (1.8, 29.4, 7.8, 6.2, nid("cw_4")),
            # East outer col (4 rooms, h=6.2)
            (60.4, 8.4, 7.8, 6.2, nid("ce_1")),
            (60.4, 15.4, 7.8, 6.2, nid("ce_2")),
            (60.4, 22.4, 7.8, 6.2, nid("ce_3")),
            (60.4, 29.4, 7.8, 6.2, nid("ce_4")),
            # West inner col (2 rooms, h=6.2)
            (14.2, 10.0, 7.6, 6.2, nid("cw_1")),
            (14.2, 18.0, 7.6, 6.2, nid("cw_2")),
            # East inner col (2 rooms, h=6.2)
            (48.2, 10.0, 7.6, 6.2, nid("ce_1")),
            (48.2, 18.0, 7.6, 6.2, nid("ce_2")),
            # South outer row (4 rooms, w=6.2)
            (14.4, 40.4, 6.2, 7.6, nid("cs_0")),
            (21.2, 40.4, 6.2, 7.6, nid("cs_1")),
            (42.6, 40.4, 6.2, 7.6, nid("cs_5")),
            (49.4, 40.4, 6.2, 7.6, nid("cs_6")),
        ]

    for idx, (r_code, r_name) in enumerate(room_specs):
        if idx >= len(slots):
            break
        rx, ry, rw, rh, corr_id = slots[idx]
        r_id = f"{bid}:{r_code}"
        cx = round(rx + rw / 2.0, 1)
        cy = round(ry + rh / 2.0, 1)
        nodes.append({"id": r_id, "x": cx, "y": cy, "floor": fl, "type": "room", "name": r_name})
        rooms.append({"nodeId": r_id, "rect": [round(rx, 1), round(ry, 1), round(rw, 1), round(rh, 1)]})
        walk_links.append((r_id, corr_id))

    return nodes, rooms, walk_links, stairs_id, lift_id


def build_h_floor(bid, fl, room_specs, is_ground):
    """
    H template: 70 x 56 m, corridor width 3.6 m, room width ~6.2 m.
    Corridor centerlines:
      West spine:  x=12.8, y in [6.0, 50.0]
      East spine:  x=57.2, y in [6.0, 50.0]
      Crossbar:    y=28.0, x in [12.8, 57.2]
    """
    nodes = []
    rooms = []
    walk_links = []

    def nid(suffix):
        return f"{bid}:f{fl}_{suffix}"

    ys = [6.0, 9.5, 16.5, 23.0, 28.0, 33.5, 40.5, 47.5, 50.0]
    for j, y in enumerate(ys):
        nodes.append({"id": nid(f"cw_{j}"), "x": 12.8, "y": y, "floor": fl, "type": "corridor"})
        nodes.append({"id": nid(f"ce_{j}"), "x": 57.2, "y": y, "floor": fl, "type": "corridor"})
        if j > 0:
            walk_links.append((nid(f"cw_{j-1}"), nid(f"cw_{j}")))
            walk_links.append((nid(f"ce_{j-1}"), nid(f"ce_{j}")))

    xs_cross = [19.5, 26.5, 32.0, 35.0, 38.0, 43.5, 50.5]
    c_chain = [nid("cw_4")] + [nid(f"cc_{i}") for i in range(len(xs_cross))] + [nid("ce_4")]
    for i, x in enumerate(xs_cross):
        nodes.append({"id": nid(f"cc_{i}"), "x": x, "y": 28.0, "floor": fl, "type": "corridor"})
    for k in range(len(c_chain) - 1):
        walk_links.append((c_chain[k], c_chain[k + 1]))

    stairs_id = nid("stairs")
    lift_id = nid("lift")
    nodes.append({"id": stairs_id, "x": 32.0, "y": 22.0, "floor": fl, "type": "stairs", "name": f"Staircase F{fl}"})
    nodes.append({"id": lift_id, "x": 38.0, "y": 22.0, "floor": fl, "type": "lift", "name": f"Elevator F{fl}"})
    walk_links.append((stairs_id, nid("cc_2")))
    walk_links.append((lift_id, nid("cc_4")))

    if is_ground:
        ent_id = f"{bid}:ent"
        exit1_id = f"{bid}:exit_nw"
        exit2_id = f"{bid}:exit_se"
        nodes.append({"id": ent_id, "x": 35.0, "y": 36.5, "floor": fl, "type": "entrance", "name": "Main Entrance"})
        nodes.append({"id": exit1_id, "x": 12.8, "y": 2.0, "floor": fl, "type": "exit", "name": "North-West Emergency Exit"})
        nodes.append({"id": exit2_id, "x": 57.2, "y": 54.0, "floor": fl, "type": "exit", "name": "South-East Emergency Exit"})
        walk_links.append((ent_id, nid("cc_3")))
        walk_links.append((exit1_id, nid("cw_0")))
        walk_links.append((exit2_id, nid("ce_8")))

    slots = [
        # West outer col (4 rooms, h=6.2)
        (2.0, 6.2, 8.4, 6.2, nid("cw_1")),
        (2.0, 16.5, 8.4, 6.2, nid("cw_2")),
        (2.0, 32.5, 8.4, 6.2, nid("cw_5")),
        (2.0, 42.8, 8.4, 6.2, nid("cw_7")),
        # East outer col (4 rooms, h=6.2)
        (59.6, 6.2, 8.4, 6.2, nid("ce_1")),
        (59.6, 16.5, 8.4, 6.2, nid("ce_2")),
        (59.6, 32.5, 8.4, 6.2, nid("ce_5")),
        (59.6, 42.8, 8.4, 6.2, nid("ce_7")),
        # Central crossbar North row (4 rooms, w=6.2)
        (16.4, 17.6, 6.2, 8.0, nid("cc_0")),
        (23.4, 17.6, 6.2, 8.0, nid("cc_1")),
        (40.4, 17.6, 6.2, 8.0, nid("cc_5")),
        (47.4, 17.6, 6.2, 8.0, nid("cc_6")),
        # Central crossbar South row (4 rooms, w=6.2)
        (16.4, 30.4, 6.2, 8.0, nid("cc_0")),
        (23.4, 30.4, 6.2, 8.0, nid("cc_1")),
        (40.4, 30.4, 6.2, 8.0, nid("cc_5")),
        (47.4, 30.4, 6.2, 8.0, nid("cc_6")),
    ]

    for idx, (r_code, r_name) in enumerate(room_specs):
        if idx >= len(slots):
            break
        rx, ry, rw, rh, corr_id = slots[idx]
        r_id = f"{bid}:{r_code}"
        cx = round(rx + rw / 2.0, 1)
        cy = round(ry + rh / 2.0, 1)
        nodes.append({"id": r_id, "x": cx, "y": cy, "floor": fl, "type": "room", "name": r_name})
        rooms.append({"nodeId": r_id, "rect": [round(rx, 1), round(ry, 1), round(rw, 1), round(rh, 1)]})
        walk_links.append((r_id, corr_id))

    return nodes, rooms, walk_links, stairs_id, lift_id


def build_l_floor(bid, fl, room_specs, is_ground):
    """
    L template: 60 x 60 m, corridor width 3.6 m, room width ~6.2 m.
    Corridor centerlines:
      West spine:  x=12.8, y in [8.0, 47.2]
      South wing:  y=47.2, x in [12.8, 52.0]
    """
    nodes = []
    rooms = []
    walk_links = []

    def nid(suffix):
        return f"{bid}:f{fl}_{suffix}"

    ys = [8.0, 11.2, 18.2, 25.2, 32.2, 39.2, 47.2]
    for j, y in enumerate(ys):
        nodes.append({"id": nid(f"cw_{j}"), "x": 12.8, "y": y, "floor": fl, "type": "corridor"})
        if j > 0:
            walk_links.append((nid(f"cw_{j-1}"), nid(f"cw_{j}")))

    xs = [19.1, 26.1, 33.1, 35.0, 40.1, 47.1, 52.0]
    s_chain = [nid("cw_6")] + [nid(f"cs_{i}") for i in range(len(xs))]
    for i, x in enumerate(xs):
        nodes.append({"id": nid(f"cs_{i}"), "x": x, "y": 47.2, "floor": fl, "type": "corridor"})
    for k in range(len(s_chain) - 1):
        walk_links.append((s_chain[k], s_chain[k + 1]))

    stairs_id = nid("stairs")
    lift_id = nid("lift")
    nodes.append({"id": stairs_id, "x": 19.1, "y": 41.5, "floor": fl, "type": "stairs", "name": f"Staircase F{fl}"})
    nodes.append({"id": lift_id, "x": 26.1, "y": 41.5, "floor": fl, "type": "lift", "name": f"Elevator F{fl}"})
    walk_links.append((stairs_id, nid("cs_0")))
    walk_links.append((lift_id, nid("cs_1")))

    if is_ground:
        ent_id = f"{bid}:ent"
        exit1_id = f"{bid}:exit_n"
        exit2_id = f"{bid}:exit_e"
        nodes.append({"id": ent_id, "x": 35.0, "y": 56.5, "floor": fl, "type": "entrance", "name": "Main Entrance"})
        nodes.append({"id": exit1_id, "x": 12.8, "y": 2.5, "floor": fl, "type": "exit", "name": "North Spine Emergency Exit"})
        nodes.append({"id": exit2_id, "x": 57.0, "y": 47.2, "floor": fl, "type": "exit", "name": "East Wing Emergency Exit"})
        walk_links.append((ent_id, nid("cs_3")))
        walk_links.append((exit1_id, nid("cw_0")))
        walk_links.append((exit2_id, nid("cs_6")))

    slots = [
        # West outer col (5 rooms, h=6.2)
        (2.0, 8.2, 8.4, 6.2, nid("cw_1")),
        (2.0, 15.2, 8.4, 6.2, nid("cw_2")),
        (2.0, 22.2, 8.4, 6.2, nid("cw_3")),
        (2.0, 29.2, 8.4, 6.2, nid("cw_4")),
        (2.0, 36.2, 8.4, 6.2, nid("cw_5")),
        # West inner col (4 rooms, h=6.2)
        (15.2, 8.2, 8.4, 6.2, nid("cw_1")),
        (15.2, 15.2, 8.4, 6.2, nid("cw_2")),
        (15.2, 22.2, 8.4, 6.2, nid("cw_3")),
        (15.2, 29.2, 8.4, 6.2, nid("cw_4")),
        # South outer row (4 rooms, w=6.2)
        (16.0, 49.6, 6.2, 8.4, nid("cs_0")),
        (23.0, 49.6, 6.2, 8.4, nid("cs_1")),
        (37.0, 49.6, 6.2, 8.4, nid("cs_4")),
        (44.0, 49.6, 6.2, 8.4, nid("cs_5")),
        # South inner row (3 rooms, w=6.2)
        (30.0, 36.4, 6.2, 8.4, nid("cs_2")),
        (37.0, 36.4, 6.2, 8.4, nid("cs_4")),
        (44.0, 36.4, 6.2, 8.4, nid("cs_5")),
    ]

    for idx, (r_code, r_name) in enumerate(room_specs):
        if idx >= len(slots):
            break
        rx, ry, rw, rh, corr_id = slots[idx]
        r_id = f"{bid}:{r_code}"
        cx = round(rx + rw / 2.0, 1)
        cy = round(ry + rh / 2.0, 1)
        nodes.append({"id": r_id, "x": cx, "y": cy, "floor": fl, "type": "room", "name": r_name})
        rooms.append({"nodeId": r_id, "rect": [round(rx, 1), round(ry, 1), round(rw, 1), round(rh, 1)]})
        walk_links.append((r_id, corr_id))

    return nodes, rooms, walk_links, stairs_id, lift_id


def assemble_building(spec, outdoor_node_id):
    bid = spec["id"]
    template = spec["template"]
    variant = spec.get("variant", "standard")
    dims = {
        "ring": (70.0, 44.0),
        "U": (70.0, 50.0),
        "L": (60.0, 60.0),
        "H": (70.0, 56.0),
    }[template]

    all_nodes = []
    all_rooms = []
    all_edges = []
    edge_set = set()
    floors_meta = []
    stairs_by_floor = {}
    lifts_by_floor = {}

    for fl_info in spec["floors"]:
        fl = fl_info["level"]
        floors_meta.append({"level": fl, "label": fl_info["label"]})
        r_specs = fl_info["rooms"]
        is_ground = (fl == 0)

        if template == "ring":
            nodes, rooms, links, st_id, lf_id = build_ring_floor(bid, fl, r_specs, is_ground, variant)
        elif template == "U":
            nodes, rooms, links, st_id, lf_id = build_u_floor(bid, fl, r_specs, is_ground, variant)
        elif template == "H":
            nodes, rooms, links, st_id, lf_id = build_h_floor(bid, fl, r_specs, is_ground)
        elif template == "L":
            nodes, rooms, links, st_id, lf_id = build_l_floor(bid, fl, r_specs, is_ground)
        else:
            raise ValueError(f"Unknown template {template}")

        node_lookup = {n["id"]: n for n in nodes}
        for u, v in links:
            add_walk_edge(all_edges, edge_set, u, v, node_lookup)

        all_nodes.extend(nodes)
        all_rooms.extend(rooms)
        stairs_by_floor[fl] = st_id
        lifts_by_floor[fl] = lf_id

    # Vertical connections across consecutive floors
    levels = sorted(stairs_by_floor.keys())
    for i in range(len(levels) - 1):
        f1, f2 = levels[i], levels[i + 1]
        all_edges.append({
            "a": stairs_by_floor[f1],
            "b": stairs_by_floor[f2],
            "kind": "stairs",
            "w": 10,
            "accessible": False,
        })
        all_edges.append({
            "a": lifts_by_floor[f1],
            "b": lifts_by_floor[f2],
            "kind": "lift",
            "w": 15,
            "accessible": True,
        })

    # Link single building entrance to outdoor landmark entrance node by a 3m edge
    all_edges.append({
        "a": f"{bid}:ent",
        "b": outdoor_node_id,
        "kind": "walk",
        "w": 3.0,
        "accessible": True,
    })

    return {
        "id": bid,
        "name": spec["name"],
        "landmarkId": bid,
        "meta": {
            "demo": True,
            "template": template,
            "width": dims[0],
            "height": dims[1],
            "corridorWidth": 3.6,
            "roomWidth": 6.2,
        },
        "floors": floors_meta,
        "nodes": all_nodes,
        "edges": all_edges,
        "rooms": all_rooms,
    }


BUILDING_SPECS = [
    {
        "id": "b-csit",
        "name": "Depts. of Comp. Sc. & I.T and Maths & Basic Sciences",
        "template": "ring",
        "variant": "standard",
        "floors": [
            {
                "level": 0,
                "label": "Ground Floor",
                "rooms": [
                    ("g01", "CSIT Chairman Office"),
                    ("g02", "CSIT Admin & Coordinations"),
                    ("g03", "Lecture Hall CS-01"),
                    ("g04", "Lecture Hall CS-02"),
                    ("g05", "Lecture Hall CS-03"),
                    ("g06", "Maths General Office"),
                    ("g07", "Student Advisor Office"),
                    ("g08", "Server & Datacenter Room"),
                    ("g09", "Faculty Lounge"),
                    ("g10", "Examination Cell CSIT"),
                    ("g11", "Lecture Hall M-01"),
                    ("g12", "Lecture Hall M-02"),
                    ("g13", "Basic Sciences Seminar Hall"),
                    ("g14", "DSA Course Tutorial Room"),
                    ("g15", "Smart Classroom A"),
                    ("g16", "Smart Classroom B"),
                ],
            },
            {
                "level": 1,
                "label": "First Floor",
                "rooms": [
                    ("101", "Software Engineering Lab"),
                    ("102", "AI & Machine Learning Lab"),
                    ("103", "Lecture Hall CS-101"),
                    ("104", "Lecture Hall CS-102"),
                    ("105", "Data Science Research Lab"),
                    ("106", "Cyber Security Lab"),
                    ("107", "Senior Faculty Offices West"),
                    ("108", "Cloud Computing Studio"),
                    ("109", "Senior Faculty Offices East"),
                    ("110", "Graduate Seminar Room"),
                    ("111", "Lecture Hall M-101"),
                    ("112", "Applied Mathematics Lab"),
                    ("113", "Statistics & Modeling Room"),
                    ("114", "FYP Incubation Lab"),
                    ("115", "CSIT Conference Room"),
                    ("116", "Academic Committee Room"),
                ],
            },
            {
                "level": 2,
                "label": "Second Floor",
                "rooms": [
                    ("201", "High-Speed Networks Lab"),
                    ("202", "IoT & Embedded Systems Lab"),
                    ("203", "Lecture Hall CS-201"),
                    ("204", "Lecture Hall CS-202"),
                    ("205", "Computer Vision Lab"),
                    ("206", "Robotics & Autonomous Lab"),
                    ("207", "Maths Chair & Dean Annex"),
                    ("208", "PhD Scholars Research Room"),
                    ("209", "Visiting Faculty Suite"),
                    ("210", "Digital Library & Reading Room"),
                    ("211", "Lecture Hall M-201"),
                    ("212", "Discrete Structures Room"),
                    ("213", "Computational Physics Room"),
                    ("214", "Postgraduate Lecture Hall"),
                    ("215", "Quality Assurance Archive"),
                    ("216", "Curriculum Design Studio"),
                ],
            },
        ],
    },
    {
        "id": "b-csit-labs",
        "name": "Labs of CSIT Dept. & Maths & Basic Sciences",
        "template": "U",
        "variant": "standard",
        "floors": [
            {
                "level": 0,
                "label": "Ground Floor",
                "rooms": [
                    ("g01", "Programming Fundamentals Lab 1"),
                    ("g02", "Programming Fundamentals Lab 2"),
                    ("g03", "Object-Oriented Programming Lab"),
                    ("g04", "Data Structures & Algorithms Lab"),
                    ("g05", "Database Management Systems Lab"),
                    ("g06", "Operating Systems & Linux Lab"),
                    ("g07", "Hardware Maintenance Workshop"),
                    ("g08", "Network Operations Center"),
                    ("g09", "Lab Engineers Office West"),
                    ("g10", "Equipment Store & Inventory"),
                    ("g11", "Lab Engineers Office East"),
                    ("g12", "UPS & Power Backup Room"),
                    ("g13", "Basic Sciences Physics Lab"),
                    ("g14", "Numerical Computing Lab"),
                    ("g15", "Technical Support Desk"),
                    ("g16", "Student Project Testing Bay"),
                ],
            },
            {
                "level": 1,
                "label": "First Floor",
                "rooms": [
                    ("101", "Computer Graphics & VR Lab"),
                    ("102", "Microprocessor & Assembly Lab"),
                    ("103", "Web & Mobile App Dev Lab"),
                    ("104", "Distributed Computing Lab"),
                    ("105", "Information Security Lab"),
                    ("106", "Parallel Processing Cluster"),
                    ("107", "Mathematical Simulation Lab 1"),
                    ("108", "Mathematical Simulation Lab 2"),
                    ("109", "Hardware Interfacing Studio"),
                    ("110", "Digital Logic Design Lab"),
                    ("111", "Software Quality Testing Lab"),
                    ("112", "Open Source Development Lab"),
                    ("113", "Lab In-Charge Office"),
                    ("114", "Server Rack & Patch Room"),
                    ("115", "FYP Hardware Fabrication Lab"),
                    ("116", "Multimedia & Audio Lab"),
                ],
            },
        ],
    },
    {
        "id": "b-library",
        "name": "Engr. Abul Kalam Library (Circulation Library)",
        "template": "H",
        "variant": "standard",
        "floors": [
            {
                "level": 0,
                "label": "Ground Floor",
                "rooms": [
                    ("g01", "Circulation & Issue Desk"),
                    ("g02", "Book Bank Section"),
                    ("g03", "New Arrivals & Display Hall"),
                    ("g04", "Cataloging & Classification"),
                    ("g05", "Acquisition & Procurement"),
                    ("g06", "Bindery & Preservation Unit"),
                    ("g07", "Chief Librarian Office"),
                    ("g08", "Deputy Librarian Office"),
                    ("g09", "Library Administration"),
                    ("g10", "Security & Locker Bay"),
                    ("g11", "Newspapers & Magazines Lounge"),
                    ("g12", "Reprography & Printing Service"),
                    ("g13", "Undergraduate Reading Hall A"),
                    ("g14", "Undergraduate Reading Hall B"),
                    ("g15", "Reference Inquiry Counter"),
                    ("g16", "OPAC Search Terminals"),
                ],
            },
            {
                "level": 1,
                "label": "First Floor",
                "rooms": [
                    ("101", "Civil & Architecture Book Stack"),
                    ("102", "Mechanical & Manufacturing Stack"),
                    ("103", "Electrical & Electronics Stack"),
                    ("104", "Computer Science & IT Stack"),
                    ("105", "Chemical & Materials Stack"),
                    ("106", "Basic Sciences & Maths Stack"),
                    ("107", "Engineering Quiet Reading Hall"),
                    ("108", "Periodicals & Bound Journals"),
                    ("109", "Standards & Codes Archive"),
                    ("110", "Faculty Study Carrels"),
                    ("111", "Group Discussion Room 1"),
                    ("112", "Group Discussion Room 2"),
                    ("113", "Reference Encyclopedias Wing"),
                    ("114", "Humanities & Economics Stack"),
                    ("115", "Assistant Librarian Desk"),
                    ("116", "Silent Study Zone North"),
                ],
            },
            {
                "level": 2,
                "label": "Second Floor",
                "rooms": [
                    ("201", "Digital Library & HEC E-Books"),
                    ("202", "Postgraduate & MS Thesis Archive"),
                    ("203", "PhD Dissertations Repository"),
                    ("204", "Rare Books & NED Heritage Wing"),
                    ("205", "IEEE & ACM Digital Access Lab"),
                    ("206", "Research Scholars Carrels West"),
                    ("207", "Research Scholars Carrels East"),
                    ("208", "Audio-Visual & Microfilm Room"),
                    ("209", "Seminar & Workshop Room"),
                    ("210", "Bibliometrics & Citation Desk"),
                    ("211", "Digital Scanning & Archiving"),
                    ("212", "Server & IT Support Room"),
                    ("213", "Postgraduate Quiet Hall West"),
                    ("214", "Postgraduate Quiet Hall East"),
                    ("215", "Journal Indexing Office"),
                    ("216", "Collaborative Research Pod"),
                ],
            },
        ],
    },
    {
        "id": "b-dean-offices",
        "name": "Dean Offices & Academic Secretariats",
        "template": "L",
        "variant": "standard",
        "floors": [
            {
                "level": 0,
                "label": "Ground Floor",
                "rooms": [
                    ("g01", "Dean CPL Secretariat"),
                    ("g02", "Dean ECE Secretariat"),
                    ("g03", "Dean MME Secretariat"),
                    ("g04", "Dean ISH Secretariat"),
                    ("g05", "Dean CPG Secretariat"),
                    ("g06", "Dean Architecture & Mgmt"),
                    ("g07", "Academic Council Reception"),
                    ("g08", "Undergraduate Academic Desk"),
                    ("g09", "Postgraduate Studies Desk"),
                    ("g10", "Faculty Records & Dossiers"),
                    ("g11", "Notification & Dispatch Room"),
                    ("g12", "Course Registration Cell"),
                    ("g13", "Academic Calendar Office"),
                    ("g14", "Inter-Department Liaison"),
                    ("g15", "Waiting Lounge & Inquiry"),
                    ("g16", "Document Archival Room"),
                ],
            },
            {
                "level": 1,
                "label": "First Floor",
                "rooms": [
                    ("101", "Dean CPL Chamber"),
                    ("102", "Dean ECE Chamber"),
                    ("103", "Dean MME Chamber"),
                    ("104", "Dean ISH Chamber"),
                    ("105", "Quality Enhancement Cell (QEC)"),
                    ("106", "Director QEC Office"),
                    ("107", "OBE & Accreditation Cell"),
                    ("108", "PEC Liaison Office"),
                    ("109", "Curriculum Review Boardroom"),
                    ("110", "Board of Faculty Hall A"),
                    ("111", "Board of Faculty Hall B"),
                    ("112", "Advanced Studies & Research"),
                    ("113", "Scholarship & Financial Aid"),
                    ("114", "International Collaboration"),
                    ("115", "Deans Committee Lounge"),
                    ("116", "Academic Audit & Analytics"),
                ],
            },
        ],
    },
    {
        "id": "b-admin",
        "name": "Administration Block (VC Secretariat & Registrar)",
        "template": "ring",
        "variant": "inner_wings",
        "floors": [
            {
                "level": 0,
                "label": "Ground Floor",
                "rooms": [
                    ("g01", "Registrar Reception & Diary"),
                    ("g02", "Establishment Section I"),
                    ("g03", "Establishment Section II"),
                    ("g04", "Directorate of Finance Counter"),
                    ("g05", "Student Fee & Challan Cell"),
                    ("g06", "Payroll & Accounts Section"),
                    ("g07", "Controller Student Affairs"),
                    ("g08", "Public Relations & Media"),
                    ("g09", "General Administration Desk"),
                    ("g10", "Central Dispatch & Mail"),
                    ("g11", "Legal & Litigation Cell"),
                    ("g12", "Security & Vigilance Office"),
                    ("g13", "Transport & Fleet Office"),
                    ("g14", "Estate & Protocol Desk"),
                    ("g15", "Verification & NOC Counter"),
                    ("g16", "Pension & Benevolent Fund"),
                    ("g17", "Visitor Waiting Hall"),
                    ("g18", "Admin Records Room"),
                ],
            },
            {
                "level": 1,
                "label": "First Floor",
                "rooms": [
                    ("101", "Registrar Chamber"),
                    ("102", "Deputy Registrar Academic"),
                    ("103", "Deputy Registrar General"),
                    ("104", "Director Finance Chamber"),
                    ("105", "Deputy Director Finance"),
                    ("106", "Resident Auditor Office"),
                    ("107", "Internal Audit Section"),
                    ("108", "Budget & Planning Section"),
                    ("109", "Controller of Examinations"),
                    ("110", "Deputy Controller Secrecy"),
                    ("111", "Transcript & Degree Cell"),
                    ("112", "Tabulation & Results Unit"),
                    ("113", "Procurement & Tender Cell"),
                    ("114", "Director Works & Services"),
                    ("115", "Admin Conference Hall"),
                    ("116", "HR & Selection Board Cell"),
                    ("117", "IT ERP Support Unit"),
                    ("118", "Committee Room 101"),
                ],
            },
            {
                "level": 2,
                "label": "Second Floor",
                "rooms": [
                    ("201", "Vice Chancellor Secretariat"),
                    ("202", "Vice Chancellor Chamber"),
                    ("203", "Pro-Vice Chancellor Chamber"),
                    ("204", "VC Executive Secretary"),
                    ("205", "Syndicate Meeting Hall"),
                    ("206", "Senate Executive Lounge"),
                    ("207", "Director ORIC Chamber"),
                    ("208", "University Industrial Linkages"),
                    ("209", "Strategic Planning Unit"),
                    ("210", "Executive Protocol Suite"),
                    ("211", "Chancellor Committee Room"),
                    ("212", "Endowment Fund Trust Office"),
                    ("213", "Alumni Relations Directorate"),
                    ("214", "Legal Advisor Chamber"),
                    ("215", "Confidential Archives"),
                    ("216", "Executive Briefing Room"),
                    ("217", "VIP Waiting Gallery"),
                    ("218", "Board of Governors Secretariat"),
                ],
            },
        ],
    },
    {
        "id": "b-auditorium",
        "name": "Main Auditorium",
        "template": "U",
        "variant": "auditorium",
        "floors": [
            {
                "level": 0,
                "label": "Ground Floor",
                "rooms": [
                    ("g01", "Main Auditorium Bowl & Stage"),
                    ("g02", "Green Room West (Performers)"),
                    ("g03", "Stage Equipment & Props Bay"),
                    ("g04", "Acoustic & Sound Rack Room"),
                    ("g05", "VIP Reception Lounge"),
                    ("g06", "Green Room East (Speakers)"),
                    ("g07", "Backstage Dressing Room"),
                    ("g08", "Electrical Dimmer & HVAC Room"),
                    ("g09", "Press & Media Briefing Room"),
                    ("g10", "Box Office & Registration"),
                    ("g11", "Cloakroom & Ushers Desk"),
                    ("g12", "Event Coordinator Office"),
                    ("g13", "Refreshment & Catering Pantry"),
                ],
            },
            {
                "level": 1,
                "label": "First Floor Balcony",
                "rooms": [
                    ("101", "Upper Balcony Seating Tier"),
                    ("102", "Main Projection & Laser Booth"),
                    ("103", "Digital Sound Mixing Console"),
                    ("104", "Stage Lighting Control Rig"),
                    ("105", "Live Streaming & Broadcast Studio"),
                    ("106", "Translation & Interpreter Booth"),
                    ("107", "Balcony Lounge West"),
                    ("108", "Balcony Lounge East"),
                    ("109", "AV Archive & Recording Library"),
                    ("110", "Technical Director Office"),
                    ("111", "Rigging & Catwalk Access Bay"),
                    ("112", "Emergency Generator Control"),
                    ("113", "VIP Balcony Viewing Box"),
                ],
            },
        ],
    },
]


FONT_5X7 = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
    ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
    ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}


def write_png(filepath, width, height, rgb_buf):
    """Encodes a raw RGB bytearray (width * height * 3) as a standard PNG file."""
    raw_rows = bytearray()
    stride = width * 3
    for y in range(height):
        raw_rows.append(0)  # Filter type 0 (None)
        row_start = y * stride
        raw_rows.extend(rgb_buf[row_start : row_start + stride])

    def make_chunk(chunk_type, data):
        chunk = struct.pack(">I", len(data)) + chunk_type + data
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return chunk + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), 6)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + make_chunk(b"IHDR", ihdr)
        + make_chunk(b"IDAT", idat)
        + make_chunk(b"IEND", b"")
    )
    with open(filepath, "wb") as f:
        f.write(png_bytes)


def render_floor_previews(indoor_data, preview_dir):
    """Renders PNG previews for each floor of a building and verifies 0 label/room overlaps."""
    os.makedirs(preview_dir, exist_ok=True)
    bid = indoor_data["id"]
    meta = indoor_data["meta"]
    bw = meta["width"]
    bh = meta["height"]

    scale = 14  # pixels per meter
    pad_x = 30
    pad_top = 48
    pad_bot = 24
    img_w = int(bw * scale) + pad_x * 2
    img_h = int(bh * scale) + pad_top + pad_bot

    def to_px(mx, my):
        return int(pad_x + mx * scale), int(pad_top + my * scale)

    def fill_rect(buf, x0, y0, x1, y1, color):
        x0, x1 = max(0, min(img_w, x0)), max(0, min(img_w, x1))
        y0, y1 = max(0, min(img_h, y0)), max(0, min(img_h, y1))
        r, g, b = color
        for y in range(y0, y1):
            base = y * img_w * 3
            for x in range(x0, x1):
                idx = base + x * 3
                buf[idx] = r
                buf[idx + 1] = g
                buf[idx + 2] = b

    def draw_rect_border(buf, x0, y0, x1, y1, color, thickness=1):
        fill_rect(buf, x0, y0, x1, y0 + thickness, color)
        fill_rect(buf, x0, y1 - thickness, x1, y1, color)
        fill_rect(buf, x0, y0, x0 + thickness, y1, color)
        fill_rect(buf, x1 - thickness, y0, x1, y1, color)

    def draw_line(buf, x0, y0, x1, y1, color, thickness=1):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for s in range(steps + 1):
            t = s / steps if steps > 0 else 0
            x = int(x0 + (x1 - x0) * t)
            y = int(y0 + (y1 - y0) * t)
            fill_rect(buf, x - thickness // 2, y - thickness // 2, x + thickness // 2 + 1, y + thickness // 2 + 1, color)

    def draw_text(buf, text, cx, cy, color, font_scale=1):
        text = text.upper()
        char_w = 6 * font_scale
        total_w = len(text) * char_w - font_scale
        start_x = int(cx - total_w // 2)
        start_y = int(cy - (7 * font_scale) // 2)
        r, g, b = color
        for idx_c, ch in enumerate(text):
            glyph = FONT_5X7.get(ch, FONT_5X7[" "])
            gx_base = start_x + idx_c * char_w
            for row_i, row_bits in enumerate(glyph):
                for col_i, bit in enumerate(row_bits):
                    if bit == "1":
                        px0 = gx_base + col_i * font_scale
                        py0 = start_y + row_i * font_scale
                        fill_rect(buf, px0, py0, px0 + font_scale, py0 + font_scale, (r, g, b))
        return (start_x, start_y, start_x + total_w, start_y + 7 * font_scale)

    node_map = {n["id"]: n for n in indoor_data["nodes"]}
    room_rect_map = {r["nodeId"]: r["rect"] for r in indoor_data["rooms"]}

    for fl_info in indoor_data["floors"]:
        fl = fl_info["level"]
        fl_label = fl_info["label"]
        buf = bytearray([248, 250, 249] * (img_w * img_h))

        # Building outer footprint boundary
        bx0, by0 = to_px(0, 0)
        bx1, by1 = to_px(bw, bh)
        fill_rect(buf, bx0, by0, bx1, by1, (238, 242, 240))
        draw_rect_border(buf, bx0, by0, bx1, by1, (140, 155, 148), thickness=2)

        # Header banner
        fill_rect(buf, 0, 0, img_w, 34, (18, 31, 25))
        title = f"{bid.upper()} - {fl_label.upper()} ({meta['template'].upper()} {int(bw)}X{int(bh)}M)"
        draw_text(buf, title, img_w // 2, 17, (255, 255, 255), font_scale=2)

        # Draw rooms for this floor
        fl_nodes = [n for n in indoor_data["nodes"] if n["floor"] == fl]
        for n in fl_nodes:
            if n["type"] == "room" and n["id"] in room_rect_map:
                rx, ry, rw, rh = room_rect_map[n["id"]]
                px0, py0 = to_px(rx, ry)
                px1, py1 = to_px(rx + rw, ry + rh)
                fill_rect(buf, px0, py0, px1, py1, (217, 236, 229))
                draw_rect_border(buf, px0, py0, px1, py1, (11, 92, 70), thickness=2)

        # Draw walk edges on this floor
        for e in indoor_data["edges"]:
            u, v = e["a"], e["b"]
            if u in node_map and v in node_map:
                nu, nv = node_map[u], node_map[v]
                if nu["floor"] == fl and nv["floor"] == fl:
                    ux, uy = to_px(nu["x"], nu["y"])
                    vx, vy = to_px(nv["x"], nv["y"])
                    draw_line(buf, ux, uy, vx, vy, (150, 168, 160), thickness=2)

        # Draw room labels wrapped inside room rect
        for n in fl_nodes:
            if n["type"] == "room" and n["id"] in room_rect_map:
                rx, ry, rw, rh = room_rect_map[n["id"]]
                px0, py0 = to_px(rx, ry)
                px1, py1 = to_px(rx + rw, ry + rh)
                rcx = (px0 + px1) // 2
                rcy = (py0 + py1) // 2
                short_code = n["id"].split(":")[1].upper()
                words = [
                    w.strip("().,")
                    for w in n.get("name", "").split()
                    if w.upper() not in ("&", "OF", "AND", "THE")
                ]
                line1 = short_code
                line2 = words[0][:10] if words else ""
                line3 = words[1][:10] if len(words) > 1 else ""
                draw_text(buf, line1, rcx, rcy - 10, (11, 92, 70), font_scale=1)
                if line2:
                    draw_text(buf, line2, rcx, rcy, (18, 31, 25), font_scale=1)
                if line3:
                    draw_text(buf, line3, rcx, rcy + 10, (72, 92, 82), font_scale=1)

        # Draw nodes (corridor, stairs, lift, entrance, exit)
        for n in fl_nodes:
            nx, ny = to_px(n["x"], n["y"])
            ntype = n["type"]
            if ntype == "corridor":
                fill_rect(buf, nx - 3, ny - 3, nx + 3, ny + 3, (90, 110, 100))
            elif ntype == "stairs":
                fill_rect(buf, nx - 16, ny - 10, nx + 16, ny + 10, (217, 119, 6))
                draw_text(buf, "STAIR", nx, ny, (255, 255, 255), font_scale=1)
            elif ntype == "lift":
                fill_rect(buf, nx - 16, ny - 10, nx + 16, ny + 10, (37, 99, 235))
                draw_text(buf, "LIFT", nx, ny, (255, 255, 255), font_scale=1)
            elif ntype == "entrance":
                fill_rect(buf, nx - 20, ny - 10, nx + 20, ny + 10, (22, 163, 74))
                draw_text(buf, "ENTR", nx, ny, (255, 255, 255), font_scale=1)
            elif ntype == "exit":
                fill_rect(buf, nx - 18, ny - 10, nx + 18, ny + 10, (220, 38, 38))
                draw_text(buf, "EXIT", nx, ny, (255, 255, 255), font_scale=1)

        out_png = os.path.join(preview_dir, f"{bid}_f{fl}.png")
        write_png(out_png, img_w, img_h, buf)


def main():
    graph_path = os.path.join("data", "graph.json")
    with open(graph_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    landmark_lookup = {lm["id"]: lm for lm in graph.get("landmarks", [])}
    out_dir = os.path.join("data", "indoor")
    preview_dir = os.path.join("tools", "previews")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(preview_dir, exist_ok=True)

    for spec in BUILDING_SPECS:
        bid = spec["id"]
        if bid not in landmark_lookup:
            raise KeyError(f"Building '{bid}' not found in data/graph.json landmarks")
        outdoor_nid = landmark_lookup[bid]["nodeId"]
        indoor_data = assemble_building(spec, outdoor_nid)

        out_file = os.path.join(out_dir, f"{bid}.json")
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(indoor_data, f, indent=2)

        render_floor_previews(indoor_data, preview_dir)

        print(
            f"Generated {bid}.json ({spec['template']} template, "
            f"{len(indoor_data['floors'])} floors, "
            f"{len(indoor_data['nodes'])} nodes, "
            f"{len(indoor_data['rooms'])} rooms) + floor PNG previews"
        )


if __name__ == "__main__":
    main()
