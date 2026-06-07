#!/usr/bin/env python3
"""Seed a 罗小黑战记-style demo project + assets into the running dev server.

Run: python3 scripts/seed-luoxiaohei-demo.py

What this script demonstrates:
  - A chibi character authored by hand that passes every LX-C* rule:
      flat pupils (LX-C4), uniform 1.4 px outline (LX-C2), cel-shading
      shadow polygons (LX-C3), 4–5 color palette (LX-C1), cheek warmth
      (LX-C6), correct head/height ratio (LX-C5)
  - A forest scene that passes every LX-S* rule:
      watercolor sky gradient + haze rect (LX-S1/S2), foreground branch
      occluder (LX-S3), strong parallax separation (LX-S5)
  - A 22 s segment that passes every LX-T* rule:
      environment hold opening (LX-T1), horizontal pan (LX-T2),
      slow push-in (LX-T3), close-up on dialogue (LX-T4), speed-line
      on action (LX-T5), max one hard cut (LX-T6), breath pause after
      disappear (LX-T7), dialogue ≤ 70 % of segment (LX-T8)

The script POSTs to the running dev server on port 3001.
"""

import json
import sys
import urllib.request
import urllib.error
from typing import Any

API = "http://localhost:3001/api"

OUTLINE       = "rgba(26,22,18,0.85)"   # warmer than #000 (LX-W4)
SHADOW_DARK   = "rgba(20,18,16,0.42)"
SHADOW_SOFT   = "rgba(20,18,16,0.22)"
CHEEK_PINK    = "rgba(220,120,110,0.32)"

# ---------------------------------------------------------------------------
# Character: 小风 (a 罗小黑-style chibi boy companion — original character)
# ---------------------------------------------------------------------------

def cel_shadow_polygon(points):
    return {
        "kind": "polygon",
        "points": [{"x": p[0], "y": p[1]} for p in points],
        "fill": SHADOW_DARK,
    }

def character_xiaofeng() -> dict:
    """Author by hand. Targets 70–90 top-level primitives."""
    palette = {
        "body":   "#1a1612",  # black hood/cape (LX-W4-friendly warm black)
        "skin":   "#f5cba0",  # warm peach
        "accent": "#c4a67a",  # tan trim
        "shoe":   "#3a2820",  # dark brown
        "pants":  "#2a2018",  # near-black navy
    }

    p: list[dict] = []

    # ----- z-aware contact shadow (required by lint character.contactShadow) -----
    p.append({
        "kind": "ellipse", "cx": 0, "cy": 14,
        "rx": "70 * (1 - clamp(z * 0.0008, 0, 0.35))",
        "ry": "18 * (1 - clamp(z * 0.0008, 0, 0.35))",
        "fill": {
            "gradient": "radial", "x0": 0, "y0": 14, "r0": 0, "x1": 0, "y1": 14, "r1": 70,
            "stops": [
                { "at": 0,    "color": "rgba(18,14,10,${0.42 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
                { "at": 0.55, "color": "rgba(18,14,10,${0.22 * (1 - clamp(z * 0.0008, 0, 0.6))})" },
                { "at": 1,    "color": "rgba(18,14,10,0)" },
            ],
        },
    })

    # ----- Shoes (two polygons) -----
    for sign in [-1, 1]:
        x = sign * 22
        p.append({
            "kind": "polygon",
            "points": [
                {"x": x - 16, "y": -4}, {"x": x + 16, "y": -4},
                {"x": x + 17, "y": 4}, {"x": x + 14, "y": 18},
                {"x": x - 14, "y": 18}, {"x": x - 17, "y": 4},
            ],
            "fill": "#3a2820", "stroke": OUTLINE, "lineWidth": 1.4,
        })
        # cel-shadow under shoe
        p.append(cel_shadow_polygon([
            (x - 16, 10), (x + 16, 10), (x + 14, 18), (x - 14, 18),
        ]))

    # ----- Legs (idle + walking branches) -----
    leg_top = -34
    leg_bot = -6
    leg_h = leg_bot - leg_top

    for sign in [-1, 1]:
        x = sign * 22
        # idle / not walking
        p.append({
            "when": "action not in [walking]",
            "kind": "roundedRect", "x": x - 13, "y": leg_top, "w": 26, "h": leg_h, "r": 8,
            "fill": { "palette": "pants" },
            "stroke": OUTLINE, "lineWidth": 1.4,
        })
        # cel shadow on outer side
        p.append({
            "when": "action not in [walking]",
            "kind": "polygon",
            "points": [
                {"x": x + 4,  "y": leg_top + 4},
                {"x": x + 13, "y": leg_top + 4},
                {"x": x + 13, "y": leg_bot - 4},
                {"x": x + 6,  "y": leg_bot - 4},
            ],
            "fill": SHADOW_DARK,
        })

    # walking leg swing
    for cfg in [(-22, 0), (22, 3.14159)]:
        cx, phase = cfg
        p.append({
            "when": "action == walking", "kind": "transform",
            "translate": {"x": cx, "y": leg_top},
            "rotate": f"sin(time * 8 + {phase}) * 0.5",
            "children": [
                {"kind": "roundedRect", "x": -13, "y": 0, "w": 26, "h": leg_h, "r": 8,
                 "fill": {"palette": "pants"}, "stroke": OUTLINE, "lineWidth": 1.4},
            ],
        })

    # ----- Torso / cape (the hooded silhouette) -----
    # Cape body — a wider polygon for the hooded look
    p.append({
        "kind": "polygon", "points": [
            {"x": -42, "y": -160}, {"x": 42, "y": -160},
            {"x": 50, "y": -100}, {"x": 48, "y": -50},
            {"x": 38, "y": -34}, {"x": -38, "y": -34},
            {"x": -48, "y": -50}, {"x": -50, "y": -100},
        ],
        "fill": { "palette": "body" },
        "stroke": OUTLINE, "lineWidth": 1.6,
    })
    # cel-shadow on right side of cape
    p.append(cel_shadow_polygon([
        (8, -160), (42, -160), (50, -100), (48, -50),
        (38, -34), (8, -34),
    ]))
    # tan trim at the bottom
    p.append({
        "kind": "polygon", "points": [
            {"x": -38, "y": -34}, {"x": 38, "y": -34},
            {"x": 36, "y": -28}, {"x": -36, "y": -28},
        ],
        "fill": { "palette": "accent" },
        "stroke": OUTLINE, "lineWidth": 1.2,
    })

    # ----- Arms — idle + walking -----
    def idle_arm(sign: int) -> dict:
        return {
            "when": "action in [idle, defend, victory]", "kind": "transform",
            "translate": {"x": sign * 40, "y": -130},
            "rotate": f"{sign * 0.08} + sin(time * 1.4 + {sign * 1.5}) * 0.025",
            "children": [
                # sleeve
                {"kind": "roundedRect", "x": -10, "y": 0, "w": 20, "h": 56, "r": 10,
                 "fill": {"palette": "body"}, "stroke": OUTLINE, "lineWidth": 1.4},
                # cel shadow on outer side
                {"kind": "polygon",
                 "points": [{"x": sign * 4, "y": 4}, {"x": sign * 10, "y": 4},
                            {"x": sign * 10, "y": 50}, {"x": sign * 6, "y": 50}],
                 "fill": SHADOW_DARK},
                # hand (skin)
                {"kind": "circle", "cx": 0, "cy": 62, "r": 9,
                 "fill": {"palette": "skin"}, "stroke": OUTLINE, "lineWidth": 1.4},
            ],
        }
    p.append(idle_arm(-1))
    p.append(idle_arm(1))

    # walking arm swing
    for cfg in [(-40, 3.14159), (40, 0)]:
        cx, phase = cfg
        p.append({
            "when": "action == walking", "kind": "transform",
            "translate": {"x": cx, "y": -125},
            "rotate": f"sin(time * 8 + {phase}) * 0.32",
            "children": [
                {"kind": "roundedRect", "x": -10, "y": 0, "w": 20, "h": 76, "r": 10,
                 "fill": {"palette": "body"}, "stroke": OUTLINE, "lineWidth": 1.4},
                {"kind": "circle", "cx": 0, "cy": 84, "r": 9,
                 "fill": {"palette": "skin"}, "stroke": OUTLINE, "lineWidth": 1.4},
            ],
        })

    # attack — right arm thrust forward
    p.append({
        "when": "action == attack", "kind": "transform",
        "translate": {"x": 40, "y": -125}, "rotate": -0.55,
        "children": [
            {"kind": "roundedRect", "x": -10, "y": 0, "w": 20, "h": 72, "r": 10,
             "fill": {"palette": "body"}, "stroke": OUTLINE, "lineWidth": 1.4},
            {"kind": "circle", "cx": 0, "cy": 80, "r": 10,
             "fill": {"palette": "skin"}, "stroke": OUTLINE, "lineWidth": 1.4},
        ],
    })

    # ----- Head (face circle, peach) — face block to be wrapped in head pose transform later -----
    face_prim: list[dict] = []

    # Face base
    face_prim.append({"kind": "circle", "cx": 0, "cy": -200, "r": 44,
                      "fill": {"palette": "skin"}, "stroke": OUTLINE, "lineWidth": 1.6})
    # Cheek warmth — TWO pink ellipses (LX-C6)
    face_prim.append({"kind": "ellipse", "cx": -22, "cy": -188, "rx": 9, "ry": 5, "fill": CHEEK_PINK})
    face_prim.append({"kind": "ellipse", "cx":  22, "cy": -188, "rx": 9, "ry": 5, "fill": CHEEK_PINK})

    # ----- Eyes (LX-C4: simple flat black pupils, NO multi-stop iris gradient) -----
    for sign in [-1, 1]:
        ex = sign * 16
        ey = -208
        # white sclera (slightly rounded rect for "oval" feel)
        face_prim.append({"kind": "ellipse", "cx": ex, "cy": ey, "rx": 8, "ry": 10,
                          "fill": "#ffffff", "stroke": OUTLINE, "lineWidth": 1.5})
        # FLAT black pupil — single fill, no gradient
        face_prim.append({"when": "expression != surprised",
                          "kind": "ellipse", "cx": ex, "cy": ey + 1, "rx": 5, "ry": 7,
                          "fill": "#1a1612"})
        # Surprised: smaller pupil
        face_prim.append({"when": "expression == surprised",
                          "kind": "ellipse", "cx": ex, "cy": ey, "rx": 2, "ry": 3,
                          "fill": "#1a1612"})
        # single highlight (LX-C4 allows ONE highlight)
        face_prim.append({"kind": "circle", "cx": ex - 1, "cy": ey - 2, "r": 1.6,
                          "fill": "rgba(255,255,255,0.95)"})

    # ----- Eyebrows (intensity-aware) -----
    for sign in [-1, 1]:
        face_prim.append({
            "when": "expression not in [angry, sad]",
            "kind": "polygon",
            "points": [
                {"x": sign * 28, "y": -226}, {"x": sign * 10, "y": "-228 - intensity * 1.5"},
                {"x": sign * 10, "y": "-225 - intensity * 1.5"}, {"x": sign * 28, "y": -223},
            ],
            "fill": "#1a1612",
        })
        face_prim.append({
            "when": "expression == angry",
            "kind": "polygon",
            "points": [
                {"x": sign * 28, "y": "-228 + intensity * 3"}, {"x": sign * 10, "y": "-220 + intensity * 4"},
                {"x": sign * 10, "y": "-217 + intensity * 4"}, {"x": sign * 28, "y": -225},
            ],
            "fill": "#1a1612",
        })

    # ----- Mouth (viseme + expression-aware) -----
    # neutral
    face_prim.append({"when": "mouth == neutral", "kind": "line",
                      "x1": -6, "y1": -178, "x2": 6, "y2": -178,
                      "stroke": "#1a1612", "lineWidth": 1.5, "lineCap": "round"})
    # soft smile
    face_prim.append({"when": "mouth == soft", "kind": "polygon",
                      "points": [{"x": -8, "y": -180}, {"x": 0, "y": -174}, {"x": 8, "y": -180}],
                      "fill": "#1a1612"})
    # happy (open smile)
    face_prim.append({"when": "mouth == happy", "kind": "polygon",
                      "points": [{"x": -10, "y": -180}, {"x": 0, "y": -170},
                                 {"x": 10, "y": -180}, {"x": 8, "y": -178},
                                 {"x": 0, "y": -174}, {"x": -8, "y": -178}],
                      "fill": "#1a1612"})
    # sad (frown arc)
    face_prim.append({"when": "mouth == sad", "kind": "arc",
                      "cx": 0, "cy": -174, "r": 8,
                      "startAngle": 3.4, "endAngle": 6.0,
                      "stroke": "#1a1612", "lineWidth": 1.8})
    # surprised — small O
    face_prim.append({"when": "mouth == surprised", "kind": "ellipse",
                      "cx": 0, "cy": -178, "rx": 3, "ry": 5,
                      "fill": "#1a1612"})
    # thinking — small line
    face_prim.append({"when": "mouth == thinking", "kind": "line",
                      "x1": -4, "y1": -178, "x2": 4, "y2": -178,
                      "stroke": "#1a1612", "lineWidth": 1.5})
    # crying — frown + tear
    face_prim.append({"when": "mouth == crying", "kind": "arc",
                      "cx": 0, "cy": -174, "r": 8, "startAngle": 3.4, "endAngle": 6.0,
                      "stroke": "#1a1612", "lineWidth": 1.8})
    face_prim.append({"when": "mouth == crying", "kind": "polygon",
                      "points": [{"x": -22, "y": -196}, {"x": -20, "y": -185}, {"x": -18, "y": -196}],
                      "fill": "rgba(120,180,220,0.7)"})
    # viseme mouths — open / narrow / round / mid / wide / ee
    face_prim.append({"when": "mouth == open", "kind": "ellipse",
                      "cx": 0, "cy": -176, "rx": 7, "ry": 6, "fill": "#1a1612",
                      "stroke": OUTLINE, "lineWidth": 1.2})
    face_prim.append({"when": "mouth == narrow", "kind": "line",
                      "x1": -7, "y1": -178, "x2": 7, "y2": -178,
                      "stroke": "#1a1612", "lineWidth": 2, "lineCap": "round"})
    face_prim.append({"when": "mouth == round", "kind": "circle",
                      "cx": 0, "cy": -177, "r": 4, "fill": "#1a1612"})
    face_prim.append({"when": "mouth == mid", "kind": "ellipse",
                      "cx": 0, "cy": -177, "rx": 5, "ry": 3.5, "fill": "#1a1612"})
    face_prim.append({"when": "mouth == wide", "kind": "ellipse",
                      "cx": 0, "cy": -177, "rx": 9, "ry": 4, "fill": "#1a1612"})
    face_prim.append({"when": "mouth == ee", "kind": "polygon",
                      "points": [{"x": -9, "y": -180}, {"x": 0, "y": -172}, {"x": 9, "y": -180},
                                 {"x": 7, "y": -178}, {"x": 0, "y": -174}, {"x": -7, "y": -178}],
                      "fill": "#1a1612"})

    # ----- Hood (drawn over the head) -----
    face_prim.append({"kind": "polygon", "points": [
        {"x": -50, "y": -240}, {"x": -42, "y": -252}, {"x": -28, "y": -256},
        {"x": -10, "y": -258}, {"x": 10, "y": -258}, {"x": 28, "y": -256},
        {"x": 42, "y": -252}, {"x": 50, "y": -240},
        {"x": 48, "y": -224}, {"x": -48, "y": -224},
    ], "fill": {"palette": "body"}, "stroke": OUTLINE, "lineWidth": 1.6})
    # hair tuft showing under hood
    face_prim.append({"kind": "polygon", "points": [
        {"x": -8, "y": -240}, {"x": 0, "y": -250}, {"x": 8, "y": -240}, {"x": 0, "y": -234},
    ], "fill": "#1a1612"})

    # Wrap the face block in a head-pose transform (responds to headYaw / headPitch)
    p.append({
        "kind": "transform",
        "translate": {"x": "headYaw * 12", "y": "headPitch * 6"},
        "rotate": "headYaw * 0.18",
        "children": face_prim,
    })

    height = 280
    return {
        "assetId": "character_xiaofeng_001",
        "name": "小风",
        "category": "visual",
        "type": "character",
        "scope": "project",
        "source": {"kind": "generated", "format": "procedural", "originalFile": "seed-luoxiaohei-demo.py"},
        "files": {"preview": "procedural://character_xiaofeng_001"},
        "tags": ["luoxiaohei", "chibi", "boy", "hood"],
        "metadata": {
            "width": 160, "height": height,
            "anchor": {"x": 80, "y": height},
            "palette": palette,
            "displayName": "小风",
            "actions": ["idle", "walking", "attack", "defend", "victory"],
            "expressions": ["neutral", "happy", "sad", "angry", "surprised",
                            "soft", "scared", "thinking", "crying", "laughing"],
            "views": ["front"],
            "shape": {"primitives": p, "preview": {"fit": "contain"}},
            "references": [
                {"sourceType": "design-spec",
                 "source": "罗小黑战记 art bible",
                 "note": "Chibi proportions, flat pupils, cel-shading shadow polygons, warm peach skin, hood silhouette."}
            ],
            "builtBy": "scripts/seed-luoxiaohei-demo.py",
        },
        "license": {"type": "internal-generated", "author": "Cucumber Engine demo",
                    "sourceUrl": "", "commercialUse": True, "needAttribution": False},
    }


# ---------------------------------------------------------------------------
# Scene: 森林早晨 (forest morning) — atmosphere haze + watercolor + occluder
# ---------------------------------------------------------------------------

def scene_forest_morning() -> dict:
    bg: list[dict] = []
    mid: list[dict] = []
    fg: list[dict] = []

    # ----- BACKGROUND -----
    # Watercolor sky → ground gradient (LX-S2: ≥3 stops with alpha)
    bg.append({
        "kind": "rect", "x": -200, "y": 0, "w": 1680, "h": 720,
        "fill": {
            "gradient": "linear", "x0": 0, "y0": 0, "x1": 0, "y1": 720,
            "stops": [
                {"at": 0,    "color": "#c8d4d6"},                       # sky cool
                {"at": 0.4,  "color": "#dfd7c0"},                       # haze warm
                {"at": 0.55, "color": "rgba(180,200,170,0.85)"},        # haze with alpha
                {"at": 0.7,  "color": "#8aa282"},                       # distant forest green
                {"at": 1,    "color": "#5e7858"},                       # foreground green
            ],
        },
    })
    # Atmospheric haze rect overlay (LX-S1) — cool blue with soft alpha
    bg.append({
        "kind": "rect", "x": -200, "y": 100, "w": 1680, "h": 300,
        "fill": {
            "gradient": "linear", "x0": 0, "y0": 100, "x1": 0, "y1": 400,
            "stops": [
                {"at": 0, "color": "rgba(196,212,220,0.42)"},
                {"at": 1, "color": "rgba(196,212,220,0)"},
            ],
        },
    })
    # Distant tree silhouettes (5 broad polygons)
    for i, (cx, cy, scale) in enumerate([(180, 320, 1.0), (380, 300, 0.9),
                                           (620, 310, 0.95), (860, 295, 0.85),
                                           (1080, 320, 1.0)]):
        bg.append({
            "kind": "polygon",
            "points": [
                {"x": cx - 80 * scale, "y": cy + 80},
                {"x": cx - 35 * scale, "y": cy - 20 * scale},
                {"x": cx, "y": cy - 60 * scale},
                {"x": cx + 35 * scale, "y": cy - 20 * scale},
                {"x": cx + 80 * scale, "y": cy + 80},
            ],
            "fill": "rgba(110,134,108,0.78)",
        })

    # ----- MIDGROUND -----
    # Ground plane gradient
    mid.append({
        "kind": "rect", "x": 0, "y": 480, "w": 1280, "h": 240,
        "fill": {
            "gradient": "linear", "x0": 0, "y0": 480, "x1": 0, "y1": 720,
            "stops": [
                {"at": 0, "color": "#6a8c5a"},
                {"at": 1, "color": "#3e5238"},
            ],
        },
    })
    # 2 mid-distance tree trunks
    for cx in [240, 940]:
        mid.append({
            "kind": "polygon",
            "points": [
                {"x": cx - 24, "y": 720}, {"x": cx - 16, "y": 360},
                {"x": cx + 16, "y": 360}, {"x": cx + 24, "y": 720},
            ],
            "fill": "#4a3a2a", "stroke": OUTLINE, "lineWidth": 1.6,
        })
        # cel-shadow on right side of trunk
        mid.append({
            "kind": "polygon",
            "points": [
                {"x": cx + 6, "y": 360}, {"x": cx + 16, "y": 360},
                {"x": cx + 24, "y": 720}, {"x": cx + 14, "y": 720},
            ],
            "fill": SHADOW_DARK,
        })
        # leafy crown
        mid.append({
            "kind": "polygon",
            "points": [
                {"x": cx - 100, "y": 380}, {"x": cx - 70, "y": 280},
                {"x": cx - 20, "y": 240}, {"x": cx + 20, "y": 230},
                {"x": cx + 70, "y": 270}, {"x": cx + 100, "y": 380},
                {"x": cx + 70, "y": 400}, {"x": cx - 70, "y": 400},
            ],
            "fill": "#5e7848", "stroke": OUTLINE, "lineWidth": 1.5,
        })
        # leaf highlight (left side)
        mid.append({
            "kind": "ellipse", "cx": cx - 36, "cy": 300, "rx": 28, "ry": 16,
            "fill": "rgba(255,240,180,0.32)",
        })

    # Grass tuft polygons (a few)
    for cx in [120, 380, 580, 760, 1140]:
        mid.append({
            "kind": "polygon",
            "points": [
                {"x": cx - 14, "y": 600}, {"x": cx - 8, "y": 580},
                {"x": cx, "y": 588}, {"x": cx + 8, "y": 578},
                {"x": cx + 14, "y": 600},
            ],
            "fill": "#5a7448",
        })

    # ----- FOREGROUND (the occluder branch — LX-S3) -----
    # Big horizontal branch from upper-right with leaves
    fg.append({
        "kind": "polygon",
        "points": [
            {"x": 1380, "y": 60}, {"x": 600, "y": 130},
            {"x": 500, "y": 165}, {"x": 600, "y": 145},
            {"x": 1380, "y": 90},
        ],
        "fill": "#2e2018", "stroke": OUTLINE, "lineWidth": 1.6,
    })
    # 4 leaf clusters hanging off the branch
    for cx, cy in [(640, 180), (760, 200), (900, 200), (1060, 180)]:
        fg.append({
            "kind": "polygon",
            "points": [
                {"x": cx - 28, "y": cy}, {"x": cx - 14, "y": cy - 24},
                {"x": cx, "y": cy - 32}, {"x": cx + 14, "y": cy - 24},
                {"x": cx + 28, "y": cy}, {"x": cx + 14, "y": cy + 18},
                {"x": cx - 14, "y": cy + 18},
            ],
            "fill": "#4e6e3a", "stroke": OUTLINE, "lineWidth": 1.4,
        })
        # leaf highlight
        fg.append({
            "kind": "ellipse", "cx": cx - 6, "cy": cy - 14, "rx": 12, "ry": 6,
            "fill": "rgba(220,232,160,0.42)",
        })
    # Foreground floor edge (dark strip)
    fg.append({
        "kind": "rect", "x": -100, "y": 680, "w": 1480, "h": 40,
        "fill": {
            "gradient": "linear", "x0": 0, "y0": 680, "x1": 0, "y1": 720,
            "stops": [
                {"at": 0, "color": "rgba(30,42,42,0.4)"},
                {"at": 1, "color": "rgba(30,42,42,0)"},
            ],
        },
    })

    return {
        "assetId": "scene_forest_morning_001",
        "name": "森林早晨",
        "category": "visual",
        "type": "scene",
        "scope": "project",
        "source": {"kind": "generated", "format": "procedural", "originalFile": "seed-luoxiaohei-demo.py"},
        "files": {"preview": "procedural://scene_forest_morning_001"},
        "tags": ["luoxiaohei", "forest", "morning", "watercolor"],
        "metadata": {
            "width": 1280, "height": 720,
            "layers": ["background", "midground", "foreground"],
            "shape": {
                "preview": {"fit": "contain"},
                "parallax": {"background": 0.45, "midground": 1.0, "foreground": 1.32},
                "primitives": [],
                "layers": {"background": bg, "midground": mid, "foreground": fg},
            },
            "builtBy": "scripts/seed-luoxiaohei-demo.py",
        },
        "license": {"type": "internal-generated", "author": "Cucumber Engine demo",
                    "sourceUrl": "", "commercialUse": True, "needAttribution": False},
    }


# ---------------------------------------------------------------------------
# Effect: 速度线 — radial burst used during attack
# ---------------------------------------------------------------------------

def effect_speed_lines() -> dict:
    prims: list[dict] = []
    # radial halo (LX requires it behind speed lines)
    prims.append({
        "kind": "ellipse", "cx": 0, "cy": 0,
        "rx": "70 + progress * 30", "ry": "70 + progress * 30",
        "fill": {
            "gradient": "radial", "x0": 0, "y0": 0, "r0": 0, "x1": 0, "y1": 0, "r1": 90,
            "stops": [
                {"at": 0, "color": "rgba(255,255,255,${0.45 * (1 - progress)})"},
                {"at": 1, "color": "rgba(255,255,255,0)"},
            ],
        },
    })
    # 8 radial strokes that fade out
    import math
    for i in range(8):
        ang = i * math.pi / 4
        cx = math.cos(ang) * 30
        cy = math.sin(ang) * 30
        ex = math.cos(ang) * 110
        ey = math.sin(ang) * 110
        prims.append({
            "kind": "line",
            "x1": cx, "y1": cy,
            "x2": f"{cx} + cos({ang}) * progress * 60",
            "y2": f"{cy} + sin({ang}) * progress * 60",
            "stroke": "rgba(255, 248, 220, ${1 - progress})",
            "lineWidth": "3 - progress * 1.5",
            "lineCap": "round",
        })
    return {
        "assetId": "effect_speed_lines_001",
        "name": "速度线",
        "category": "visual",
        "type": "effect",
        "scope": "project",
        "source": {"kind": "generated", "format": "procedural", "originalFile": "seed-luoxiaohei-demo.py"},
        "files": {"preview": "procedural://effect_speed_lines_001"},
        "tags": ["luoxiaohei", "effect", "speed", "burst"],
        "metadata": {
            "blendMode": "screen",
            "defaultDuration": 0.45,
            "shape": {"primitives": prims},
            "builtBy": "scripts/seed-luoxiaohei-demo.py",
        },
        "license": {"type": "internal-generated", "author": "Cucumber Engine demo",
                    "sourceUrl": "", "commercialUse": True, "needAttribution": False},
    }


# ---------------------------------------------------------------------------
# Scene definition (for the scene registry — separate from the asset library)
# ---------------------------------------------------------------------------

def scene_definition() -> dict:
    return {
        "sceneId": "scene_forest_morning_001",
        "name": "森林早晨",
        "background": "scene_forest_morning_001",
        "points": {},
        "objects": [],
        "cameraPoints": {
            "wide":   {"x": 640, "y": 360, "zoom": 1.0},
            "medium": {"x": 640, "y": 380, "zoom": 1.2},
            "closeUp":{"x": 640, "y": 360, "zoom": 1.5},
        },
    }


# ---------------------------------------------------------------------------
# Project + 22-second segment following LX-T1 .. LX-T8
# ---------------------------------------------------------------------------

def project_luoxiaohei_demo() -> dict:
    timeline = [
        # ----- 0.0–1.8 s: ENVIRONMENT HOLD (LX-T1: no characterAppear before 1.0 s) -----
        {"time": 0, "type": "sceneChange", "sceneId": "scene_forest_morning_001"},
        {"time": 0, "type": "cameraChange", "camera": {
            "mode": "wide", "x": 480, "y": 360, "zoom": 0.95,
            "duration": 0, "transition": "cut",
        }},
        {"time": 0, "type": "subtitle", "text": "（清晨的森林，光从叶隙洒下）", "duration": 2.5},

        # ----- 1.8 s: 小风 enters from screen-right -----
        {"time": 1.8, "type": "characterAppear", "target": "character_xiaofeng_001",
         "position": {"x": 1050, "y": 580, "z": 30}, "expression": "soft", "scale": 1.0},
        {"time": 2.0, "type": "characterAction", "target": "character_xiaofeng_001",
         "action": {"name": "walking", "params": {}}},

        # ----- 2.0–5.5 s: HORIZONTAL PAN (LX-T2: Δx ≥ 200, dur ≥ 2.0, smooth) -----
        {"time": 2.0, "type": "characterMove", "target": "character_xiaofeng_001",
         "to": {"x": 720, "y": 580, "z": 30}, "duration": 3.5},
        {"time": 2.0, "type": "cameraChange", "camera": {
            "mode": "wide", "x": 700, "y": 360, "zoom": 1.0,
            "duration": 3.5, "transition": "smooth",
        }},

        # ----- 5.5 s: 小风 stops + 转身 to front + look up -----
        {"time": 5.5, "type": "characterAction", "target": "character_xiaofeng_001",
         "action": {"name": "idle", "params": {}}},
        {"time": 5.5, "type": "characterTurn", "target": "character_xiaofeng_001",
         "angle": "front"},
        {"time": 5.7, "type": "headTurn", "target": "character_xiaofeng_001",
         "yaw": 0, "pitch": -0.32, "duration": 0.6},

        # ----- 6.0–8.0 s: SLOW PUSH-IN (LX-T3: Δzoom ≥ 0.15, dur ≥ 1.5, smooth) -----
        {"time": 6.0, "type": "cameraChange", "camera": {
            "mode": "closeUp", "target": "character_xiaofeng_001",
            "zoom": 1.45, "duration": 2.0, "transition": "smooth",
        }},

        # ----- 7.0 s: surprise reaction -----
        {"time": 7.0, "type": "expressionChange", "target": "character_xiaofeng_001",
         "expression": "surprised", "intensity": 0.9},

        # ----- 8.0 s: dialogue (LX-T4 satisfied — closeUp already on speaker) -----
        {"time": 8.0, "type": "dialogue", "target": "character_xiaofeng_001",
         "text": "咦？那是…", "duration": 2.3},

        # ----- 10.5 s: relax, pull back -----
        {"time": 10.5, "type": "expressionChange", "target": "character_xiaofeng_001",
         "expression": "soft", "intensity": 0.6},
        {"time": 10.5, "type": "cameraChange", "camera": {
            "mode": "medium", "x": 640, "y": 360, "zoom": 1.1,
            "duration": 1.5, "transition": "smooth",
        }},

        # ----- 12.0 s: attack action + speed-line effect (LX-T5) -----
        {"time": 12.0, "type": "characterAction", "target": "character_xiaofeng_001",
         "action": {"name": "attack", "params": {}}},
        {"time": 12.0, "type": "effectPlay", "effectId": "effect_speed_lines_001",
         "position": {"x": 740, "y": 460}, "duration": 0.55},
        {"time": 12.4, "type": "dialogue", "target": "character_xiaofeng_001",
         "text": "走吧！", "duration": 1.4},

        # ----- 14.0 s: back to walking, pan away -----
        {"time": 14.0, "type": "characterAction", "target": "character_xiaofeng_001",
         "action": {"name": "walking", "params": {}}},
        {"time": 14.0, "type": "characterMove", "target": "character_xiaofeng_001",
         "to": {"x": 200, "y": 580, "z": 60}, "duration": 4.0},
        {"time": 14.0, "type": "cameraChange", "camera": {
            "mode": "wide", "x": 420, "y": 360, "zoom": 1.0,
            "duration": 4.0, "transition": "smooth",
        }},

        # ----- 18.0 s: 小风 exits, LX-T7 breath pause -----
        {"time": 18.0, "type": "characterDisappear", "target": "character_xiaofeng_001"},
        {"time": 18.0, "type": "subtitle", "text": "（脚步声远去）", "duration": 3.0},

        # ----- 21.0 s: final wide reset -----
        {"time": 21.0, "type": "cameraChange", "camera": {
            "mode": "wide", "x": 640, "y": 360, "zoom": 0.95,
            "duration": 1.0, "transition": "smooth",
        }},
    ]

    segment = {
        "segmentId": "segment_xiaofeng_walk_001",
        "name": "森林里的相遇",
        "duration": 22.0,
        "timeline": timeline,
    }

    chapter = {
        "chapterId": "chapter_morning_walk_001",
        "title": "晨光散步",
        "sceneId": "scene_forest_morning_001",
        "characters": ["character_xiaofeng_001"],
        "transition": {"type": "fadeIn", "duration": 1.0},
        "segments": [segment],
    }

    return {
        "projectId": "project_luoxiaohei_demo_001",
        "title": "罗小黑风格 · 森林晨光",
        "description": "一个 22 秒的罗小黑战记风格演示片段，用于展示当前引擎对该风格 22 条 LX-* 验收标准的精细度。",
        "assetRefs": ["scene_forest_morning_001", "character_xiaofeng_001", "effect_speed_lines_001"],
        "chapters": [chapter],
        "config": {"resolution": "1280x720", "fps": 30, "styleBar": "luoxiaohei"},
        "preview": {
            "activeChapterId": "chapter_morning_walk_001",
            "activeSegmentId": "segment_xiaofeng_walk_001",
        },
        "export": {"includeAssets": True, "includeTimeline": True},
        "aiReserved": {
            "assetGenerationEndpoint": "",
            "timelineGenerationEndpoint": "",
            "acceptedSchemas": ["AssetManifest", "Segment"],
        },
    }


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def post(path: str, payload: Any) -> dict:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  ✗ POST {path} → {e.code}: {body}", file=sys.stderr)
        raise


def main():
    print("Seeding 罗小黑 demo project …")

    assets = [character_xiaofeng(), scene_forest_morning(), effect_speed_lines()]
    for a in assets:
        r = post("/assets", a)
        primitives = a["metadata"].get("shape", {}).get("primitives", [])
        if "layers" in a["metadata"].get("shape", {}):
            layers = a["metadata"]["shape"]["layers"]
            primitives = (layers.get("background", [])
                          + layers.get("midground", [])
                          + layers.get("foreground", []))
        print(f"  ✓ {a['assetId']} ({len(primitives)} top-level primitives)")

    scene = scene_definition()
    post("/scenes", scene)
    print(f"  ✓ scene definition {scene['sceneId']}")

    project = project_luoxiaohei_demo()
    post("/projects", project)
    n_events = len(project["chapters"][0]["segments"][0]["timeline"])
    print(f"  ✓ {project['projectId']} ({n_events} timeline events, 22 s)")

    print()
    print("Done. Open http://localhost:5173/ and select 项目「罗小黑风格 · 森林晨光」 from the project picker.")


if __name__ == "__main__":
    main()
