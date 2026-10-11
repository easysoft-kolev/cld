"""Builds the whole construction scene in Blender and exposes animate(p, t) to pose it for a moment in time.

Coordinates: X east, Y north, Z up (metres). The building's street front faces south (-Y).
"""
import math

import bmesh
import bpy
from mathutils import Vector, Matrix, Euler

from lib import (clamp, lerp, smooth, rng, srng, track, collection, link, new_obj, bevel, smooth_shade,
                 box_mesh, merge_boxes, cylinder_between, seeded)

# ------------------------------------------------------------------ plan (mirrors the website's timeline)
PLOT = dict(x0=-30, x1=30, y0=-25, y1=25)
FOOT = dict(x0=-13, x1=13, y0=-4, y1=12)
PIT = dict(x0=-15, x1=15, y0=-6, y1=14, slope=2.6, depth=4.5)
FENCE = dict(x0=-28, x1=28, y0=-23, y1=23, gate=(10, 20), h=2.4)
PH = dict(x0=-9, x1=9, y0=-0.5, y1=10.5)
CORE = dict(x0=-2.5, x1=2.5, y0=1, y1=7)
LV = [0, 4.2, 7.35, 10.5, 13.65, 16.8, 19.95, 23.1, 26.25, 29.65]
STOREYS = 9
SLAB = 0.3
RAFT_TOP = -PIT['depth'] + 0.8
CRANE = (-21.5, 6.0)
BLOCK = dict(hx=32, hy=27)
PITCH = dict(x=74, y=64)

T = dict(
    stakes=(0.025, 0.07), fence=(0.05, 0.11), cabins=(0.07, 0.11), strip=(0.09, 0.14), dig=(0.13, 0.27),
    rebar=(0.28, 0.31), raft=(0.305, 0.34), basement=(0.335, 0.38), backfill=(0.37, 0.40), craneUp=(0.29, 0.35),
    structure=(0.40, 0.64), envelope=(0.56, 0.79), craneDown=(0.77, 0.845), craneGone=(0.845, 0.86),
    fenceDown=(0.85, 0.885), landscape=(0.80, 0.90), lights=(0.88, 0.97),
)

# camera keyframes converted from the web version: (p, position, target, vertical fov)
def _b(v):
    return (v[0], -v[2], v[1])


CAMERA_KEYS = [(k[0], _b(k[1]), _b(k[2]), k[3]) for k in [
    (0.00, (74, 34, 96), (0, 2, -6), 36),
    (0.06, (40, 24, 52), (0, 0, -4), 38),
    (0.12, (12, 14, 40), (-2, -1, -4), 40),
    (0.20, (-14, 8, 30), (-2, -2, -2), 42),
    (0.28, (22, 18, 30), (0, -3, -4), 40),
    (0.36, (34, 30, 26), (0, -2, -4), 40),
    (0.46, (-34, 16, 36), (0, 6, -4), 42),
    (0.56, (-34, 34, 30), (0, 13, -4), 42),
    (0.66, (30, 14, 34), (0, 14, -4), 42),
    (0.75, (24, 5, 26), (0, 13, -4), 46),
    (0.84, (-2, 6.5, 34.5), (0, 11, -4), 46),
    (0.92, (36, 12, 44), (0, 14, -4), 40),
    (1.00, (-36, 15, 54), (0, 13, -4), 36),
]]


def _catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return tuple(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
                 for a, b, c, d in zip(p0, p1, p2, p3))


def camera_at(p):
    K = CAMERA_KEYS
    p = clamp(p)
    i = 0
    while i < len(K) - 2 and p > K[i + 1][0]:
        i += 1
    a, b, c, d = K[max(0, i - 1)], K[i], K[i + 1], K[min(len(K) - 1, i + 2)]
    t = clamp((p - b[0]) / (c[0] - b[0]))
    return _catmull(a[1], b[1], c[1], d[1], t), _catmull(a[2], b[2], c[2], d[2], t), lerp(b[3], c[3], t)


def sight_lines(n=160):
    return [camera_at(i / n)[:2] for i in range(n + 1)]


# ================================================================== world
class Scene:
    def __init__(self, M):
        self.M = M
        self.root = bpy.context.scene.collection
        self.dyn = {}           # named things animate() touches
        self.lines = [(Vector(a), Vector(b)) for a, b in sight_lines()]
        self.build_world()
        self.build_city()
        self.build_site()
        self.build_building()
        self.build_machines()
        self.build_landscape()

    # -------------------------------------------------------------- helpers
    def blocks_view(self, x0, y0, z0, x1, y1, z1):
        lo, hi = Vector((x0, y0, z0)), Vector((x1, y1, z1))
        for a, b in self.lines:
            d = b - a
            tmin, tmax = 0.0, 1.0
            ok = True
            for k in range(3):
                if abs(d[k]) < 1e-9:
                    if a[k] < lo[k] or a[k] > hi[k]:
                        ok = False
                        break
                else:
                    t1, t2 = (lo[k] - a[k]) / d[k], (hi[k] - a[k]) / d[k]
                    t1, t2 = min(t1, t2), max(t1, t2)
                    tmin, tmax = max(tmin, t1), min(tmax, t2)
                    if tmin > tmax:
                        ok = False
                        break
            if ok:
                return True
        return False

    def near_camera(self, cx, cy, w, d, h):
        for a, _ in self.lines:
            dx = max(abs(a.x - cx) - w / 2, 0)
            dy = max(abs(a.y - cy) - d / 2, 0)
            if math.hypot(dx, dy) < 34 and h > a.z - 14:
                return True
        return False

    def box(self, name, coll, size, loc, mat, origin='center', bev=0.0):
        o = new_obj(name, box_mesh(name, *size, origin=origin), coll, mat, loc)
        if bev:
            bevel(o, bev)
        return o

    # -------------------------------------------------------------- sky, sun, ground, ridges
    def build_world(self):
        sc = bpy.context.scene
        world = bpy.data.worlds.new('Sky')
        sc.world = world
        world.use_nodes = True
        nt = world.node_tree
        nt.nodes.clear()
        sky = nt.nodes.new('ShaderNodeTexSky')
        types = [i.identifier for i in sky.bl_rna.properties['sky_type'].enum_items]
        for pref in ('MULTIPLE_SCATTERING', 'SINGLE_SCATTERING', 'NISHITA'):
            if pref in types:
                sky.sky_type = pref
                break
        if hasattr(sky, 'sun_disc'):
            sky.sun_disc = False
        bg = nt.nodes.new('ShaderNodeBackground')
        out = nt.nodes.new('ShaderNodeOutputWorld')
        nt.links.new(sky.outputs[0], bg.inputs['Color'])
        nt.links.new(bg.outputs[0], out.inputs['Surface'])
        self.dyn['sky'] = sky
        self.dyn['sky_bg'] = bg

        sun_data = bpy.data.lights.new('Sun', 'SUN')
        sun_data.angle = math.radians(0.6)
        sun = bpy.data.objects.new('Sun', sun_data)
        self.root.objects.link(sun)
        self.dyn['sun'] = sun

        g = collection('Ground')
        G = 1600
        P = PLOT
        for (x0, y0, x1, y1) in [(-G, P['y1'], G, G), (-G, -G, G, P['y0']), (-G, P['y0'], P['x0'], P['y1']), (P['x1'], P['y0'], G, P['y1'])]:
            me = bpy.data.meshes.new('ground')
            me.from_pydata([(x0, y0, -0.03), (x1, y0, -0.03), (x1, y1, -0.03), (x0, y1, -0.03)], [], [(0, 1, 2, 3)])
            new_obj('Ground', me, g, self.M['grass'])

        # distant ridge to the north
        r = seeded(5)
        waves = [(2 + i * 2.7 + r.random() * 2, 1 / (1 + i * 0.9), r.random() * 6.28) for i in range(7)]
        verts, faces = [], []
        seg = 200
        for layer, (R, h0, h1) in enumerate([(1000, 70, 200), (1500, 120, 320)]):
            base = len(verts)
            for i in range(seg + 1):
                a = math.radians(5 + 170 * i / seg)
                h = sum(abs(math.sin(a * f + ph + layer)) * w for f, w, ph in waves) / sum(w for _, w, _ in waves)
                edge = clamp(min(i, seg - i) / 30)
                z = (h0 + (h1 - h0) * h) * (0.35 + 0.65 * edge)
                verts += [(math.cos(a) * R, math.sin(a) * R, -20), (math.cos(a) * R, math.sin(a) * R, z)]
                if i < seg:
                    b = base + i * 2
                    faces.append((b, b + 2, b + 3, b + 1))
        me = bpy.data.meshes.new('ridges')
        me.from_pydata(verts, [], faces)
        new_obj('Ridges', me, g, self.M['ridge'])

    # -------------------------------------------------------------- city context
    def build_city(self):
        M = self.M
        c = collection('City')
        r = seeded(42)
        RANGE = 3
        span = (RANGE + 0.5) * PITCH['x'] * 2
        road_boxes_x, road_boxes_y, marks = [], [], []
        for j in range(-RANGE - 1, RANGE + 1):
            y = j * PITCH['y'] + PITCH['y'] / 2
            road_boxes_x.append((span, 10, 0.04, (0, y, 0.0)))
            for x in range(-int(span / 2), int(span / 2), 12):
                marks.append((6, 0.15, 0.01, (x + 3, y, 0.025)))
        for i in range(-RANGE - 1, RANGE + 1):
            x = i * PITCH['x'] + PITCH['x'] / 2
            road_boxes_y.append((10, span, 0.04, (x, 0, 0.005)))
        new_obj('RoadsX', merge_boxes('roadsx', road_boxes_x), c, M['asphalt'])
        new_obj('RoadsY', merge_boxes('roadsy', road_boxes_y), c, M['asphalt'])
        new_obj('Markings', merge_boxes('marks', marks), c, M['marking'])

        pads, curbs, lawns = [], [], []
        for i in range(-RANGE, RANGE + 1):
            for j in range(-RANGE, RANGE + 1):
                bx, by = i * PITCH['x'], j * PITCH['y']
                if i == 0 and j == 0:
                    continue
                pads.append((BLOCK['hx'] * 2, BLOCK['hy'] * 2, 0.16, (bx, by, 0.08)))
                lawns.append((BLOCK['hx'] * 2 - 8, BLOCK['hy'] * 2 - 8, 0.02, (bx, by, 0.17)))
        P = PLOT
        pads += [
            (BLOCK['hx'] * 2, BLOCK['hy'] - P['y1'], 0.16, (0, (P['y1'] + BLOCK['hy']) / 2, 0.08)),
            (BLOCK['hx'] * 2, BLOCK['hy'] - P['y1'], 0.16, (0, -(P['y1'] + BLOCK['hy']) / 2, 0.08)),
            (BLOCK['hx'] - P['x1'], P['y1'] * 2, 0.16, ((P['x1'] + BLOCK['hx']) / 2, 0, 0.08)),
            (BLOCK['hx'] - P['x1'], P['y1'] * 2, 0.16, (-(P['x1'] + BLOCK['hx']) / 2, 0, 0.08)),
        ]
        new_obj('Sidewalks', merge_boxes('pads', pads), c, M['sidewalk'])
        new_obj('Lawns', merge_boxes('lawns', lawns), c, M['grass'])

        styles = [('city_panel', 0.45), ('city_plaster', 0.27), ('city_brick', 0.14), ('city_modern', 0.14)]
        roofs = []
        trims = []
        self.occupied = []
        for i in range(-RANGE, RANGE + 1):
            for j in range(-RANGE, RANGE + 1):
                if i == 0 and j == 0:
                    continue
                bx, by = i * PITCH['x'], j * PITCH['y']
                dist = math.hypot(i, j)
                for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                    if r.random() < 0.15:
                        continue
                    roll, acc, style = r.random(), 0, styles[0][0]
                    for s, w in styles:
                        acc += w
                        if roll < acc:
                            style = s
                            break
                    w = 14 + r.random() * 10
                    d = 12 + r.random() * 8
                    if style == 'city_brick':
                        floors = 3 + round(r.random() * 3)
                    elif style == 'city_panel':
                        floors = 6 + round(r.random() * (3 if dist < 1.5 else 8))
                    else:
                        floors = 4 + round(r.random() * 6)
                    h = floors * 3.1
                    cx = bx + sx * (BLOCK['hx'] - w / 2 - 4 - r.random() * 4)
                    cy = by + sy * (BLOCK['hy'] - d / 2 - 4 - r.random() * 3)
                    if self.near_camera(cx, cy, w, d, h):
                        continue
                    if self.blocks_view(cx - w / 2 - 3, cy - d / 2 - 3, 0, cx + w / 2 + 3, cy + d / 2 + 3, h + 3):
                        continue
                    o = new_obj('Bldg', box_mesh('bldg', w, d, h, origin='bottom'), c, M[style], (cx, cy, 0.16))
                    o.pass_index = 0
                    # facade relief: floor ledges, balconies, cornice, ground-floor canopy
                    if style in ('city_panel', 'city_plaster'):
                        for k in range(1, floors):
                            trims.append((w + 0.24, d + 0.24, 0.16, (cx, cy, 0.16 + k * 3.1)))
                        nb = max(1, int(w // 3.2))
                        for k in range(1, floors):
                            for b in range(nb):
                                if (b + k * (1 + int(cx) % 2)) % 3 == 0 or r.random() < 0.2:
                                    continue
                                bxp = cx - w / 2 + (b + 0.5) * w / nb
                                for side in (-1, 1):
                                    y0 = cy + side * (d / 2 + 0.6)
                                    trims.append((2.6, 1.2, 0.14, (bxp, y0, 0.16 + k * 3.1)))
                                    trims.append((2.6, 0.08, 1.0, (bxp, cy + side * (d / 2 + 1.16), 0.16 + k * 3.1 + 0.55)))
                    elif style == 'city_brick':
                        trims.append((w + 0.5, d + 0.5, 0.4, (cx, cy, 0.16 + h - 0.3)))
                        trims.append((w + 0.2, d + 0.2, 0.25, (cx, cy, 0.16 + 3.2)))
                    else:
                        for k in range(1, floors + 1):
                            trims.append((w + 0.5, d + 0.5, 0.22, (cx, cy, 0.16 + k * 3.1 - 0.1)))
                    roofs.append((w + 0.3, d + 0.3, 0.5, (cx, cy, h + 0.16 + 0.2)))
                    roofs.append((min(6, w * 0.3), min(5, d * 0.3), 2.6, (cx + (r.random() - 0.5) * w * 0.4, cy + (r.random() - 0.5) * d * 0.4, h + 1.6)))
                    self.occupied.append((cx, cy, w, d))
        new_obj('Roofs', merge_boxes('roofs', roofs), c, M['roof'])
        new_obj('CityTrim', merge_boxes('trims', trims), c, M['city_trim'])

        # street lamps (emissive heads only — Cycles' light tree samples them efficiently)
        poles, heads = [], []
        for j in range(-RANGE - 1, RANGE + 1):
            y = j * PITCH['y'] + PITCH['y'] / 2
            for x in range(-RANGE * PITCH['x'], RANGE * PITCH['x'] + 1, 28):
                for lx, ly, sgn in ((x + 9, y + 5.6, -1), (x + 23, y - 5.6, 1)):
                    across = ((lx - PITCH['x'] / 2) % PITCH['x'] + PITCH['x'] * 1.5) % PITCH['x'] - PITCH['x'] / 2
                    if abs(across) < 6:
                        continue
                    if abs(lx) < 22 and -30 < ly < -20:
                        continue
                    if self.blocks_view(lx - 0.3, ly - 0.3, 0, lx + 0.3, ly + 0.3, 7.2):
                        continue
                    poles.append((0.14, 0.14, 7, (lx, ly, 3.5)))
                    poles.append((0.1, 1.6, 0.1, (lx, ly + sgn * 0.75, 6.95)))
                    heads.append((0.34, 0.7, 0.1, (lx, ly + sgn * 1.45, 6.85)))
        new_obj('LampPoles', merge_boxes('poles', poles), c, M['steel'])
        new_obj('LampHeads', merge_boxes('heads', heads), c, M['lamp'])

        # street trees
        self.tree_meshes = [make_tree_mesh(s, M) for s in (11, 23, 37)]
        tc = collection('StreetTrees')
        for i in range(-2, 3):
            for j in range(-2, 3):
                bx, by = i * PITCH['x'], j * PITCH['y']
                own = i == 0 and j == 0
                spots = []
                x = -BLOCK['hx'] + 5
                while x <= BLOCK['hx'] - 5:
                    if not own:
                        spots.append((bx + x, by - BLOCK['hy'] + 1.2))
                    spots.append((bx + x, by + BLOCK['hy'] - 1.2))
                    x += 12 + r.random() * 5
                yy = -BLOCK['hy'] + 6
                while yy <= BLOCK['hy'] - 6:
                    spots.append((bx + BLOCK['hx'] - 1.2, by + yy))
                    if not own:
                        spots.append((bx - BLOCK['hx'] + 1.2, by + yy))
                    yy += 12 + r.random() * 5
                for tx, ty in spots:
                    if self.blocks_view(tx - 2.8, ty - 2.8, 0, tx + 2.8, ty + 2.8, 8):
                        continue
                    if any(math.hypot(a.x - tx, a.y - ty) < 16 and a.z < 16 for a, _ in self.lines):
                        continue
                    if any(abs(tx - cx) < w / 2 + 2.5 and abs(ty - cy) < d / 2 + 2.5 for cx, cy, w, d in self.occupied):
                        continue
                    self.place_tree(tc, tx, ty, 0.16, 0.8 + r.random() * 0.4, r.random() * 6.28, r)

    def place_tree(self, coll, x, y, z, s, rot, r):
        me = self.tree_meshes[int(r.random() * len(self.tree_meshes))]
        o = bpy.data.objects.new('Tree', me)
        o.location = (x, y, z)
        o.rotation_euler = (0, 0, rot)
        o.scale = (s, s, s)
        coll.objects.link(o)
        return o

    # -------------------------------------------------------------- the plot
    def build_site(self):
        M = self.M
        c = collection('Site')
        P = PLOT
        nx, ny = int((P['x1'] - P['x0']) * 2), int((P['y1'] - P['y0']) * 2)
        verts, faces = [], []
        for j in range(ny + 1):
            for i in range(nx + 1):
                verts.append((P['x0'] + i * 0.5, P['y0'] + j * 0.5, 0.0))
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                faces.append((a, a + 1, a + nx + 2, a + nx + 1))
        me = bpy.data.meshes.new('terrain')
        me.from_pydata(verts, [], faces)
        smooth_shade(me)
        me.color_attributes.new('mask', 'FLOAT_COLOR', 'POINT')
        self.terrain = new_obj('Terrain', me, c, M['terrain'])
        self.terrain_xy = [(v[0], v[1]) for v in verts]
        self.terrain_state = None

        # hoarding with printed brand line
        fence = bpy.data.objects.new('Fence', None)
        c.objects.link(fence)
        F = FENCE
        segs = [((F['x0'], F['y0']), (F['gate'][0], F['y0'])), ((F['gate'][1], F['y0']), (F['x1'], F['y0'])),
                ((F['x1'], F['y0']), (F['x1'], F['y1'])), ((F['x1'], F['y1']), (F['x0'], F['y1'])), ((F['x0'], F['y1']), (F['x0'], F['y0']))]
        for (x0, y0), (x1, y1) in segs:
            L = math.hypot(x1 - x0, y1 - y0)
            ang = math.atan2(y1 - y0, x1 - x0)
            seg = bpy.data.objects.new('FenceSeg', None)
            c.objects.link(seg)
            seg.parent = fence
            seg.location = (x0, y0, 0)
            seg.rotation_euler = (0, 0, ang)
            panel = self.box('Hoard', c, (L, 0.06, F['h']), (L / 2, 0, F['h'] / 2), M['hoarding'], bev=0.01)
            panel.parent = seg
            band = self.box('HoardBand', c, (L, 0.07, 0.08), (L / 2, 0, F['h'] - 0.25), M['brass'])
            band.parent = seg
            for k in range(int(L // 16) + 1):
                if k * 16 + 12 > L:
                    break
                for text, size, dx, dz, mat in (('BULSTROY GROUP', 0.42, 2.0, 1.1, M['ink']), ('BUILDING SOFIA SINCE 2003', 0.16, 7.6, 1.18, M['ink'])):
                    for side, rotz, off in ((1, 0, -0.04), (-1, math.pi, 0.04)):
                        cu = bpy.data.curves.new('txt', 'FONT')
                        cu.body = text
                        cu.size = size
                        cu.extrude = 0.004
                        t = bpy.data.objects.new('HoardText', cu)
                        cu.materials.append(mat)
                        c.objects.link(t)
                        t.parent = seg
                        x = k * 16 + dx if side == 1 else k * 16 + dx + (len(text) * size * 0.62)
                        t.location = (x, off, dz)
                        t.rotation_euler = (math.pi / 2, 0, rotz)
        self.dyn['fence'] = fence

        # survey stakes + total station
        sv = bpy.data.objects.new('Survey', None)
        c.objects.link(sv)
        stake = box_mesh('stake', 0.08, 0.08, 1.0, origin='bottom')
        tip = box_mesh('tip', 0.1, 0.1, 0.15, origin='bottom')
        tipmat = simple_mat('StakeTip', (0.7, 0.15, 0.03))
        woodmat = simple_mat('StakeWood', (0.35, 0.25, 0.15), 0.8)
        off = 2.2
        for x, y in ((FOOT['x0'], FOOT['y0']), (FOOT['x1'], FOOT['y0']), (FOOT['x1'], FOOT['y1']), (FOOT['x0'], FOOT['y1'])):
            sx = math.copysign(off, x)
            sy = off if y > 4 else -off
            for px, py in ((x + sx, y), (x, y + sy), (x + sx * 0.6, y + sy * 0.6)):
                o = new_obj('Stake', stake, c, woodmat, (px, py, 0)); o.parent = sv
                o = new_obj('Tip', tip, c, tipmat, (px, py, 1.0)); o.parent = sv
        strings = []
        for (x0, y0, x1, y1) in ((FOOT['x0'] - off, FOOT['y0'], FOOT['x1'] + off, FOOT['y0']), (FOOT['x0'] - off, FOOT['y1'], FOOT['x1'] + off, FOOT['y1']),
                                 (FOOT['x0'], FOOT['y0'] - off, FOOT['x0'], FOOT['y1'] + off), (FOOT['x1'], FOOT['y0'] - off, FOOT['x1'], FOOT['y1'] + off)):
            strings.append((max(abs(x1 - x0), 0.012), max(abs(y1 - y0), 0.012), 0.012, ((x0 + x1) / 2, (y0 + y1) / 2, 0.85)))
        o = new_obj('Strings', merge_boxes('strings', strings), c, simple_mat('String', (0.8, 0.8, 0.75), 0.6)); o.parent = sv
        bm = bmesh.new()
        for k in range(3):
            a = k / 3 * math.tau
            cylinder_between(bm, (math.cos(a) * 0.55, math.sin(a) * 0.55, 0), (0, 0, 1.6), 0.025, 0.02, 6)
        me = bpy.data.meshes.new('tripod'); bm.to_mesh(me); bm.free()
        o = new_obj('Tripod', me, c, M['brass'], (7, -12, 0)); o.parent = sv
        o = new_obj('Instrument', box_mesh('inst', 0.22, 0.18, 0.32, 'bottom'), c, simple_mat('Instr', (0.75, 0.72, 0.65), 0.4), (7, -12, 1.6)); o.parent = sv
        self.dyn['survey'] = sv

        # site offices (two-high container stack)
        cab = bpy.data.objects.new('Cabins', None)
        c.objects.link(cab)
        for lvl, k in ((0, 0), (0, 1), (1, 0)):
            b = self.box('Cabin', c, (6.06, 2.44, 2.6), (0, -k * 2.6, lvl * 2.62 + 1.3), M['cabin'], bev=0.03); b.parent = cab
            t = self.box('CabinTrim', c, (6.08, 2.46, 0.12), (0, -k * 2.6, lvl * 2.62 + 2.45), M['brass']); t.parent = cab
            for wx in (-1.8, 0, 1.8):
                w = self.box('CabinWin', c, (1.1, 0.05, 0.9), (wx, -k * 2.6 - 1.23, lvl * 2.62 + 1.5), M['vehicle_glass']); w.parent = cab
        cab.location = (-22, -16, 0)
        self.dyn['cabins'] = cab

        # spoil heap
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
        rr = seeded(9)
        ph = [rr.random() * 6 for _ in range(4)]
        for v in list(bm.verts):
            if v.co.z < 0:
                v.co.z = 0
            n = 1 + 0.12 * math.sin(v.co.x * 7 + ph[0]) * math.sin(v.co.y * 5 + ph[1]) + 0.06 * math.sin(v.co.x * 17 + v.co.y * 13 + ph[2])
            v.co.x *= n; v.co.y *= n
            v.co.z = (max(v.co.z, 0) ** 0.8) * n
        me = bpy.data.meshes.new('heap'); bm.to_mesh(me); bm.free(); smooth_shade(me)
        me.color_attributes.new('mask', 'FLOAT_COLOR', 'POINT')
        ca = me.color_attributes['mask']
        for i in range(len(ca.data)):
            ca.data[i].color = (0, 0, 0.6, 1)
        self.dyn['heap'] = new_obj('Heap', me, c, M['terrain'], (-21, 19, -0.1))

        # laydown: rebar bundles, block pallets, plywood
        ld = bpy.data.objects.new('Laydown', None)
        c.objects.link(ld)
        for k in range(3):
            o = self.box('Bundle', c, (6, 0.6, 0.35), (0, -k * 0.9, 0.36), M['rebar'], bev=0.02); o.parent = ld
            o = self.box('Bearer', c, (6.2, 0.12, 0.18), (0, -k * 0.9, 0.09), M['plywood']); o.parent = ld
        for k in range(4):
            o = self.box('Pallet', c, (1.2, 1.0, 0.14), (-2 + k * 1.5, -3.6, 0.07), M['plywood']); o.parent = ld
            o = self.box('Blocks', c, (1.15, 0.95, 1.0), (-2 + k * 1.5, -3.6, 0.64), M['curb'], bev=0.01); o.parent = ld
        for k in range(6):
            o = self.box('Ply', c, (2.5, 1.25, 0.05), (4.2, -3.4, 0.1 + k * 0.06), M['plywood']); o.parent = ld
        ld.location = (-24, -1, 0)
        self.dyn['laydown'] = ld

    def depth_at(self, x, y, dig, back):
        dx = max(PIT['x0'] - x, 0, x - PIT['x1'])
        dy = max(PIT['y0'] - y, 0, y - PIT['y1'])
        slope = clamp(1 - math.hypot(dx, dy) / PIT['slope'])
        if slope <= 0 or dig <= 0:
            return 0.0
        front = lerp(PIT['x0'] - PIT['slope'] - 4, PIT['x1'] + PIT['slope'] + 1, dig)
        dug = smooth(clamp((front - x) / 6))
        d = PIT['depth'] * slope * dug
        in_foot = FOOT['x0'] + 1e-3 < x < FOOT['x1'] - 1e-3 and FOOT['y0'] + 1e-3 < y < FOOT['y1'] - 1e-3
        if not in_foot:
            d *= 1 - back
        return d

    def height_at(self, x, y, p):
        if not (PLOT['x0'] <= x <= PLOT['x1'] and PLOT['y0'] <= y <= PLOT['y1']):
            return 0.0
        return -self.depth_at(x, y, rng(*T['dig'], p), srng(*T['backfill'], p))

    def update_terrain(self, p):
        dig, back = rng(*T['dig'], p), srng(*T['backfill'], p)
        strip, land = srng(*T['strip'], p), srng(*T['landscape'], p)
        key = (round(dig, 4), round(back, 4), round(strip, 4), round(land, 4))
        if key == self.terrain_state:
            return
        self.terrain_state = key
        me = self.terrain.data
        n = len(me.vertices)
        co = [0.0] * (n * 3)
        col = [0.0] * (n * 4)
        F = FENCE
        for i, (x, y) in enumerate(self.terrain_xy):
            d = self.depth_at(x, y, dig, back)
            co[i * 3] = x; co[i * 3 + 1] = y; co[i * 3 + 2] = -d
            edge = min(x - F['x0'], F['x1'] - x, y - F['y0'], F['y1'] - y)
            inside = smooth(clamp(edge / 1.5 + 0.5))
            grass = 1 - strip * inside
            in_foot = FOOT['x0'] < x < FOOT['x1'] and FOOT['y0'] < y < FOOT['y1']
            lawn = 0.0 if in_foot else land
            col[i * 4] = grass
            col[i * 4 + 1] = lawn
            col[i * 4 + 2] = clamp(d / PIT['depth'])
            col[i * 4 + 3] = 1.0
        me.vertices.foreach_set('co', co)
        me.color_attributes['mask'].data.foreach_set('color', col)
        me.update()

    # -------------------------------------------------------------- building
    def build_building(self):
        M = self.M
        c = collection('Building')
        fw, fd = FOOT['x1'] - FOOT['x0'], FOOT['y1'] - FOOT['y0']
        fcx, fcy = (FOOT['x0'] + FOOT['x1']) / 2, (FOOT['y0'] + FOOT['y1']) / 2

        # rebar mat (two layers of bars) — revealed progressively
        bm = bmesh.new()
        self.rebar_rows = []
        y = FOOT['y0'] - 0.25
        while y <= FOOT['y1'] + 0.25:
            cylinder_between(bm, (FOOT['x0'] - 0.3, y, -PIT['depth'] + 0.38), (FOOT['x1'] + 0.3, y, -PIT['depth'] + 0.38), 0.028, None, 5)
            y += 0.4
        me = bpy.data.meshes.new('rebarX'); bm.to_mesh(me); bm.free()
        self.dyn['rebarX'] = new_obj('RebarX', me, c, M['rebar'])
        bm = bmesh.new()
        x = FOOT['x0'] - 0.25
        while x <= FOOT['x1'] + 0.25:
            cylinder_between(bm, (x, FOOT['y0'] - 0.3, -PIT['depth'] + 0.44), (x, FOOT['y1'] + 0.3, -PIT['depth'] + 0.44), 0.028, None, 5)
            x += 0.4
        me = bpy.data.meshes.new('rebarY'); bm.to_mesh(me); bm.free()
        self.dyn['rebarY'] = new_obj('RebarY', me, c, M['rebar'])

        raft = self.box('Raft', c, (fw + 1, fd + 1, 0.8), (FOOT['x0'] - 0.5, fcy, -PIT['depth']), M['concrete'], origin='west_bottom', bev=0.02)
        self.dyn['raft'] = raft
        bh = -SLAB - RAFT_TOP
        walls = merge_boxes('bwalls', [(fw, 0.3, 1, (fcx, FOOT['y0'] + 0.15, 0.5)), (fw, 0.3, 1, (fcx, FOOT['y1'] - 0.15, 0.5)),
                                       (0.3, fd - 0.6, 1, (FOOT['x0'] + 0.15, fcy, 0.5)), (0.3, fd - 0.6, 1, (FOOT['x1'] - 0.15, fcy, 0.5))])
        self.dyn['bwalls'] = new_obj('BasementWalls', walls, c, M['concrete'], (0, 0, RAFT_TOP))
        self.bwall_h = bh
        mem = merge_boxes('membrane', [(fw + 0.08, 0.03, bh, (fcx, FOOT['y0'] - 0.015, RAFT_TOP + bh / 2)), (fw + 0.08, 0.03, bh, (fcx, FOOT['y1'] + 0.015, RAFT_TOP + bh / 2)),
                                       (0.03, fd, bh, (FOOT['x0'] - 0.015, fcy, RAFT_TOP + bh / 2)), (0.03, fd, bh, (FOOT['x1'] + 0.015, fcy, RAFT_TOP + bh / 2))])
        self.dyn['membrane'] = new_obj('Membrane', mem, c, M['membrane'])

        # columns
        gx, gy = (-12.5, -6.25, 0, 6.25, 12.5), (11.5, 4, -3.5)
        col_mesh = box_mesh('column', 0.5, 0.5, 1.0, origin='bottom')
        self.columns = []

        def add_cols(level, z0, z1, filt=None):
            for x in gx:
                for y in gy:
                    if CORE['x0'] < x < CORE['x1'] and CORE['y0'] < y < CORE['y1']:
                        continue
                    if filt and not filt(x, y):
                        continue
                    o = new_obj('Column', col_mesh, c, M['concrete'], (x, y, z0))
                    self.columns.append((o, level, z1 - z0))
        add_cols(-1, RAFT_TOP, -SLAB)
        for i in range(STOREYS - 1):
            add_cols(i, LV[i], LV[i + 1] - SLAB)
        add_cols(8, LV[8], LV[9] - SLAB, lambda x, y: PH['x0'] < x < PH['x1'] and PH['y0'] < y < PH['y1'])
        for x, y in ((PH['x0'] + 0.4, PH['y0'] + 0.4), (PH['x1'] - 0.4, PH['y0'] + 0.4), (PH['x0'] + 0.4, PH['y1'] - 0.4), (PH['x1'] - 0.4, PH['y1'] - 0.4)):
            o = new_obj('Column', col_mesh, c, M['concrete'], (x, y, LV[8]))
            self.columns.append((o, 8, LV[9] - SLAB - LV[8]))

        core_mesh = box_mesh('core', CORE['x1'] - CORE['x0'], CORE['y1'] - CORE['y0'], 1.0, origin='bottom')
        self.cores = []
        for i in range(STOREYS):
            top = LV[9] + 1.6 if i == STOREYS - 1 else LV[i + 1]
            o = new_obj('Core', core_mesh, c, M['concrete'], ((CORE['x0'] + CORE['x1']) / 2, (CORE['y0'] + CORE['y1']) / 2, LV[i]))
            self.cores.append((o, top - LV[i]))

        self.slabs = []
        for k in range(STOREYS + 1):
            rc = dict(x0=PH['x0'] - 1.4, x1=PH['x1'] + 1.4, y0=PH['y0'] - 1.4, y1=PH['y1'] + 1.4) if k == STOREYS else FOOT
            w, d = rc['x1'] - rc['x0'], rc['y1'] - rc['y0']
            th = 0.38 if k == STOREYS else SLAB
            s = self.box('Slab', c, (w, d, th), (rc['x0'], (rc['y0'] + rc['y1']) / 2, LV[k] - SLAB), M['concrete'], origin='west_bottom', bev=0.015)
            ply = self.box('Formwork', c, (w - 0.1, d - 0.1, 0.05), ((rc['x0'] + rc['x1']) / 2, (rc['y0'] + rc['y1']) / 2, LV[k] - SLAB - 0.03), M['plywood'])
            self.slabs.append((s, ply))

        # edge protection on the working deck
        net = bpy.data.objects.new('EdgeNet', None)
        c.objects.link(net)
        for (sx, sy, x, y) in ((fw, 0.01, fcx, FOOT['y0'] - 0.05), (fw, 0.01, fcx, FOOT['y1'] + 0.05), (0.01, fd, FOOT['x0'] - 0.05, fcy), (0.01, fd, FOOT['x1'] + 0.05, fcy)):
            o = self.box('Net', c, (sx, sy, 1.2), (x, y, 0.6), M['net']); o.parent = net
            o = self.box('NetRail', c, (max(sx, 0.05), max(sy, 0.05), 0.05), (x, y, 1.2), M['crane']); o.parent = net
        self.dyn['net'] = net

        # facade, floor by floor
        self.faces = []
        for level in range(STOREYS):
            kind = 'ground' if level == 0 else 'penthouse' if level == STOREYS - 1 else 'typical'
            for order, f in enumerate(sides(FOOT)):
                self.faces.append((self.build_face(c, level, f, 'roof' if kind == 'penthouse' else kind), level, order))
            if kind == 'penthouse':
                for order, f in enumerate(sides(PH)):
                    self.faces.append((self.build_face(c, level, f, 'penthouse'), level, order))

        plant = bpy.data.objects.new('RoofPlant', None)
        c.objects.link(plant)
        for x, y, w, d in ((-5.5, 7.5, 3.2, 2), (5.5, 7.5, 3.2, 2), (5.5, 3.5, 2, 1.6)):
            o = self.box('AHU', c, (w, d, 1.4), (x, y, LV[9]), M['steel'], origin='bottom', bev=0.03); o.parent = plant
        for k in range(4):
            o = self.box('PV', c, (1.7, 3.4, 0.05), (-7 + k * 2, 1.5, LV[9] + 0.55), M['vehicle_glass'])
            o.rotation_euler = (math.radians(14), 0, 0)
            o.parent = plant
        self.dyn['plant'] = plant

    def build_face(self, c, level, f, kind):
        """f: dict(origin, rot, L, side). Geometry built in local space: x along face, -y outward, z up."""
        M = self.M
        H = LV[level + 1] - LV[level]
        L = f['L']
        parts = {'stone': [], 'glass': [], 'frame': [], 'rail': []}
        ext = 0.16 if f['side'] in 'SN' else 0.0
        gtop = H - SLAB - 0.04
        cards = []

        def B(key, sx, sz, sw, x, z, w):
            # sw = thickness in outward direction, w = outward offset of centre (positive = outside)
            parts[key].append((sx, sw, sz, (x, -w, z)))

        if kind == 'ground':
            B('glass', L, gtop, 0.04, L / 2, gtop / 2, -0.9)
            x = 0.4
            while x <= L - 0.39:
                B('frame', 0.07, gtop, 0.14, x, gtop / 2, -0.85); x += 1.3
            n = round(L / 5.2)
            for k in range(n + 1):
                xx = clamp(k * L / n, 0.35, L - 0.35)
                B('stone', 0.7, H - SLAB, 0.7, xx, (H - SLAB) / 2, -0.25)
            B('stone', L + ext * 2, 0.55, 0.3, L / 2, H - SLAB - 0.15, 0.0)
            if f['side'] == 'S':
                B('stone', 9, 0.32, 3.4, L / 2, 3.55, 1.5)
            x = 1.3
            while x < L:
                cards.append((x, -2.6, 0.15, gtop - 0.1)); x += 2.6
        elif kind == 'typical':
            B('stone', L + ext * 2, 0.5, 0.18, L / 2, -0.09, 0.03)
            B('glass', L, gtop - 0.16, 0.04, L / 2, 0.16 + (gtop - 0.16) / 2, -0.14)
            x = 1.3
            while x < L - 0.1:
                B('frame', 0.06, gtop - 0.16, 0.16, x, 0.16 + (gtop - 0.16) / 2, -0.08); x += 1.3
            n = round(L / 5.2)
            for k in range(n + 1):
                xx = clamp(k * L / n, 0.2, L - 0.2)
                B('stone', 0.4 if k in (0, n) else 0.32, gtop, 0.5, xx, gtop / 2, 0.12)
            if f['side'] == 'S':
                for b in range(n):
                    if (b + level) % 2:
                        continue
                    cx, bw = (b + 0.5) * L / n, L / n - 0.5
                    B('stone', bw, 0.2, 1.75, cx, 0.06, 1.0)
                    B('rail', bw - 0.06, 1.0, 0.025, cx, 0.66, 1.85)
                    B('rail', 0.025, 1.0, 1.6, cx - bw / 2 + 0.03, 0.66, 1.05)
                    B('rail', 0.025, 1.0, 1.6, cx + bw / 2 - 0.03, 0.66, 1.05)
                    B('frame', bw, 0.05, 0.06, cx, 1.18, 1.85)
            x = 1.3
            while x < L:
                cards.append((x, -1.6, 0.2, gtop - 0.15)); x += 2.6
        elif kind == 'roof':
            B('stone', L + ext * 2, 0.62, 0.18, L / 2, -0.03, 0.03)
            B('rail', L, 1.05, 0.03, L / 2, 0.8, -0.05)
            B('frame', L, 0.05, 0.07, L / 2, 1.33, -0.05)
        elif kind == 'penthouse':
            B('glass', L, gtop, 0.04, L / 2, gtop / 2, -0.1)
            x = 1.5
            while x < L - 0.1:
                B('frame', 0.05, gtop, 0.12, x, gtop / 2, -0.05); x += 1.5
            x = 1.3
            while x < L:
                cards.append((x, -1.8, 0.15, gtop - 0.1)); x += 2.6

        g = bpy.data.objects.new('Face', None)
        c.objects.link(g)
        g.location = (f['o'][0], f['o'][1], LV[level])
        g.rotation_euler = (0, 0, f['rot'])
        for key, mat, bev in (('stone', M['stone'], 0.012), ('frame', M['frame'], 0.0), ('glass', M['glass'], 0.0), ('rail', M['rail_glass'], 0.0)):
            if not parts[key]:
                continue
            o = new_obj('Face_' + key, merge_boxes('face_' + key, parts[key]), c, mat)
            o.parent = g
            if bev:
                bevel(o, bev, 1)
        if cards:
            verts, faces, rand = [], [], []
            rr = seeded(level * 31 + int(f['rot'] * 100) + len(self.faces))
            for (x, w, z0, z1) in cards:
                b = len(verts)
                hw = 1.2
                y = -w
                verts += [(x - hw, y, z0), (x + hw, y, z0), (x + hw, y, z1), (x - hw, y, z1)]
                faces.append((b, b + 3, b + 2, b + 1))  # normal faces outward (-y)
                rand.append(rr.random())
            me = bpy.data.meshes.new('cards')
            me.from_pydata(verts, [], faces)
            a = me.attributes.new('rand', 'FLOAT', 'FACE')
            a.data.foreach_set('value', rand)
            o = new_obj('Interior', me, c, M['interior'])
            o.parent = g
            self.dyn.setdefault('cards', []).append((o, level))
        return g

    # -------------------------------------------------------------- machines
    def build_machines(self):
        M = self.M
        c = collection('Machines')
        self.ex = build_excavator(c, M)
        self.truck = build_truck(c, M)
        self.crane = build_crane(c, M)
        self.crane['root'].location = (CRANE[0], CRANE[1], 0)

    # -------------------------------------------------------------- landscaping
    def build_landscape(self):
        M = self.M
        c = collection('Landscape')
        land = bpy.data.objects.new('Landscape', None)
        c.objects.link(land)
        pav = []
        for x0, y0, x1, y1 in ((-8, PLOT['y0'], 8, FOOT['y0']), (FOOT['x0'] - 2, FOOT['y0'] - 2, -8, FOOT['y0']), (8, FOOT['y0'] - 2, FOOT['x1'] + 2, FOOT['y0']),
                               (FOOT['x0'] - 2, FOOT['y0'], FOOT['x0'], FOOT['y1'] + 2), (FOOT['x1'], FOOT['y0'], FOOT['x1'] + 2, FOOT['y1'] + 2),
                               (FOOT['x0'] - 2, FOOT['y1'], FOOT['x1'] + 2, FOOT['y1'] + 2), (FOOT['x1'] + 2, 2, PLOT['x1'], 6)):
            pav.append((x1 - x0, y1 - y0, 0.12, ((x0 + x1) / 2, (y0 + y1) / 2, -0.06)))
        o = new_obj('Paving', merge_boxes('paving', pav), c, M['plaza'])
        self.dyn['paving'] = o
        hedges = []
        for side in (-1, 1):
            for y0, y1 in ((-24 + 1.5, -15.5), (-13, FOOT['y0'] - 3)):
                hedges.append((0.9, y1 - y0, 0.8, (side * 8.9, (y0 + y1) / 2, 0.4)))
        h = new_obj('Hedges', merge_boxes('hedges', hedges), c, M['hedge'])
        bevel(h, 0.25, 3)
        self.dyn['hedge'] = h
        basin = self.box('Basin', c, (7, 3.2, 0.5), (0, -15.5, 0), M['stone'], origin='bottom', bev=0.04)
        water = self.box('WaterSurf', c, (6.4, 2.6, 0.05), (0, -15.5, 0.45), M['water'], origin='bottom')
        self.dyn['basin'] = (basin, water)
        bol = []
        self.plaza_lights = []
        for side in (-1, 1):
            for y in (-7.5, -11.5, -19, -23):
                b = self.box('Bollard', c, (0.2, 0.2, 0.9), (side * 7.6, y, 0), M['steel'], origin='bottom', bev=0.03)
                hd = self.box('BollardHead', c, (0.21, 0.21, 0.12), (side * 7.6, y, 0.78), M['lamp'], origin='bottom')
                bol += [b, hd]
        for x, y in ((-5, -9), (5, -9), (-5, -20), (5, -20)):
            ld = bpy.data.lights.new('PlazaLight', 'POINT')
            ld.color = (1.0, 0.75, 0.5)
            ld.shadow_soft_size = 0.3
            lo = bpy.data.objects.new('PlazaLight', ld)
            lo.location = (x, y, 1.4)
            c.objects.link(lo)
            self.plaza_lights.append(lo)
        self.dyn['bollards'] = bol
        r = seeded(77)
        spots = []
        for side in (-1, 1):
            for y in (-8, -13.5, -19, -23.5):
                spots.append((side * 11.5, y))
            spots += [(side * 18, 16), (side * 23, 10), (side * 21, -2), (side * 24, -12), (side * 17.5, -20)]
        spots += [(-6, 18), (6, 19), (0, 21.5)]
        self.site_trees = []
        tc = collection('SiteTrees')
        for x, y in spots:
            s = 0.85 + r.random() * 0.3
            o = self.place_tree(tc, x, y, 0.0, s, r.random() * 6.28, r)
            self.site_trees.append((o, s, r.random() * 0.5))

    # ================================================================== animate
    def animate(self, p, t):
        """Pose everything for construction progress p (0..1) at clip time t (seconds, drives machine cycles)."""
        M = self.M
        self.update_terrain(p)
        hide = lambda o, h: setattr(o, 'hide_render', h)

        def hide_tree(o, h):
            hide(o, h)
            for ch in o.children_recursive:
                ch.hide_render = h

        # site furniture
        fv = srng(*T['fence'], p) * (1 - srng(*T['fenceDown'], p))
        hide_tree(self.dyn['fence'], fv < 0.001)
        self.dyn['fence'].location.z = (fv - 1) * (FENCE['h'] + 0.5)
        st = srng(*T['stakes'], p) * (1 - srng(0.125, 0.145, p))
        hide_tree(self.dyn['survey'], st < 0.001)
        self.dyn['survey'].scale = (1, 1, max(st, 0.001))
        cin, cout = srng(*T['cabins'], p), srng(0.795, 0.825, p)
        cab = self.dyn['cabins']
        hide_tree(cab, cin < 0.001 or cout > 0.999)
        cab.location.z = (1 - cin) * 9 - cout * 5.6
        dig = rng(*T['dig'], p)
        hk = min(dig * 1.15, 1) * (1 - 0.6 * srng(*T['backfill'], p)) * (1 - srng(0.78, 0.82, p))
        heap = self.dyn['heap']
        hide(heap, hk < 0.01)
        heap.scale = (5 * math.sqrt(hk) + 0.01, 3.8 * math.sqrt(hk) + 0.01, 3.4 * hk + 0.01)
        ld = srng(0.3, 0.34, p) * (1 - srng(0.78, 0.81, p))
        hide_tree(self.dyn['laydown'], ld < 0.001)
        self.dyn['laydown'].scale = (1, 1, max(ld, 0.001))

        # foundations
        rb = rng(*T['rebar'], p)
        show_rebar = T['rebar'][0] < p < T['raft'][1] + 0.01
        hide(self.dyn['rebarX'], not show_rebar or rb <= 0)
        hide(self.dyn['rebarY'], not show_rebar or rb < 0.5)
        self.dyn['rebarX'].scale = (1, max(0.001, clamp(rb * 2)), 1)
        self.dyn['rebarX'].location.y = (FOOT['y0'] - 0.25) * (1 - clamp(rb * 2))
        self.dyn['rebarY'].scale = (max(0.001, clamp(rb * 2 - 1)), 1, 1)
        self.dyn['rebarY'].location.x = (FOOT['x0'] - 0.25) * (1 - clamp(rb * 2 - 1))
        rf = rng(*T['raft'], p)
        raft = self.dyn['raft']
        hide(raft, rf <= 0)
        raft.scale = (max(0.001, rf), 1, 1)
        raft.color = (1 - rng(T['raft'][1], T['basement'][1], p), 0, 0, 1)
        bw = srng(T['basement'][0], T['basement'][1] - 0.008, p)
        hide(self.dyn['bwalls'], bw <= 0)
        self.dyn['bwalls'].scale = (1, 1, max(0.001, bw * self.bwall_h))
        self.dyn['bwalls'].color = (1 - rng(T['basement'][1], 0.43, p), 0, 0, 1)
        hide(self.dyn['membrane'], p < T['basement'][1] - 0.01)

        # frame
        s = rng(*T['structure'], p)
        def level_t(lvl):
            return rng(T['basement'][0], T['basement'][1], p) if lvl < 0 else clamp(s * STOREYS - lvl)
        cure_cols = clamp(s * 1.6)
        for o, lvl, h in self.columns:
            k = srng(0, 0.5, level_t(lvl))
            hide(o, k <= 0)
            o.scale = (1, 1, max(0.001, h * k))
            o.color = (1 - cure_cols if lvl >= 0 else 1 - rng(T['basement'][1], 0.43, p), 0, 0, 1)
        for i, (o, h) in enumerate(self.cores):
            k = srng(0, 0.42, level_t(i))
            hide(o, k <= 0)
            o.scale = (1, 1, max(0.001, h * k))
            o.color = (1 - cure_cols, 0, 0, 1)
        for k, (sl, ply) in enumerate(self.slabs):
            tk = rng(T['backfill'][0] + 0.005, T['backfill'][1], p) if k == 0 else rng(0.5, 1, level_t(k - 1))
            hide(sl, tk <= 0)
            sl.scale = (max(0.001, tk), 1, 1)
            age = rng(T['backfill'][1], 0.45, p) if k == 0 else clamp((s * STOREYS - k) / 1.5)
            sl.color = (1 - age, 0, 0, 1)
            lt = 0 if k == 0 else level_t(k - 1)
            hide(ply, not (k > 0 and lt > 0.42 and s * STOREYS < k + 1.2 and s < 1))
        working = min(STOREYS - 1, int(s * STOREYS))
        hide_tree(self.dyn['net'], not (0 < s < 1 and p < 0.66))
        self.dyn['net'].location.z = LV[working]

        # envelope
        e = rng(*T['envelope'], p)
        def level_f(lvl):
            return clamp((e * (STOREYS + 1.5) - lvl) / 1.5)
        for g, lvl, order in self.faces:
            k = srng(order * 0.15, order * 0.15 + 0.55, level_f(lvl))
            hide_tree(g, k <= 0)
            g.scale = (1, 1, max(0.001, k))
        for o, lvl in self.dyn['cards']:
            hide(o, level_f(lvl) <= 0.7)
        hide_tree(self.dyn['plant'], level_f(STOREYS - 1) <= 0.6)

        # landscaping
        lt = rng(*T['landscape'], p)
        hide(self.dyn['paving'], lt <= 0)
        self.dyn['paving'].location.z = lerp(-0.2, 0.1, srng(0, 0.35, lt))
        hide(self.dyn['hedge'], lt < 0.35)
        self.dyn['hedge'].scale = (1, 1, max(0.001, srng(0.35, 0.8, lt)))
        for o in self.dyn['basin']:
            hide(o, lt < 0.3)
            o.scale = (1, 1, max(0.001, srng(0.3, 0.6, lt)))
        for o in self.dyn['bollards']:
            hide(o, lt < 0.6)
        for o, sc, delay in self.site_trees:
            g = smooth(clamp((lt - 0.25 - delay * 0.5) / 0.4))
            hide(o, g <= 0.01)
            o.scale = (sc * max(g, 0.01),) * 3

        night = srng(*T['lights'], p)
        for lo in self.plaza_lights:
            lo.data.energy = 120 * night
            lo.hide_render = night < 0.01

        self.animate_machines(p, t)
        return night

    def animate_machines(self, p, t):
        ex, tr, cr = self.ex, self.truck, self.crane
        dig = rng(*T['dig'], p)
        F0, F1 = PIT['x0'] - PIT['slope'] - 4, PIT['x1'] + PIT['slope'] + 1
        front = lerp(F0, F1, dig)
        EX_Y, TR_Y = 3.0, 9.0
        PARK = (-25.0, -9.5)

        def place(obj, x, y, heading, length=3.6):
            obj = obj['root']
            fx, fy = math.cos(heading), math.sin(heading)
            yf = self.height_at(x + fx * length / 2, y + fy * length / 2, p)
            yb = self.height_at(x - fx * length / 2, y - fy * length / 2, p)
            z = self.height_at(x, y, p)
            obj.location = (x, y, max(z, (yf + yb) / 2))
            obj.rotation_euler = Euler((0, -math.atan2(yf - yb, length), heading), 'XYZ')

        def follow(pts, k):
            segs, total = [], 0
            for a, b in zip(pts, pts[1:]):
                l = math.hypot(b[0] - a[0], b[1] - a[1]); segs.append((a, b, l)); total += l
            d = clamp(k) * total
            for a, b, l in segs:
                if d <= l or (a, b, l) == segs[-1]:
                    q = clamp(d / l) if l else 0
                    return lerp(a[0], b[0], q), lerp(a[1], b[1], q), math.atan2(b[1] - a[1], b[0] - a[0])
                d -= l
            return pts[0][0], pts[0][1], 0

        visible = 0.085 <= p <= 0.83
        pose = (0, -0.25, -2.2, -2.0)
        digging = False
        if visible:
            if p < T['dig'][0]:
                k = srng(0.085, 0.125, p)
                x, y, h = follow([(42, -32), (15, -32), (15, -22), (F0 + 2.5, EX_Y)], k)
                place(ex, x, y, math.pi if k > 0.98 else h)
            elif p <= T['dig'][1]:
                place(ex, front + 2.5, EX_Y, math.pi)
                digging = True
            elif p < 0.78:
                k = srng(0.295, 0.335, p)
                x, y, h = follow([(F1 + 2.5, EX_Y), (22.5, -12), (-20, -12.5), PARK], k)
                place(ex, x, y, -math.pi / 2 if k > 0.98 else h)
            else:
                k = srng(0.78, 0.83, p)
                x, y, h = follow([PARK, (-10, -12.5), (13, -20), (15, -24), (15, -32), (140, -32)], k)
                place(ex, x, y, h)
        hide_all(ex['root'], not visible)
        if digging:
            phase = (t * 0.11) % 1
            pose = track(DIG, phase)
            ex['dirt'].hide_render = not (0.3 < phase < 0.72)
        else:
            ex['dirt'].hide_render = True
        ex['house'].rotation_euler.z = pose[0]
        ex['boom'].rotation_euler.y = -pose[1]
        ex['stick'].rotation_euler.y = -pose[2]
        ex['bucket'].rotation_euler.y = -pose[3]

        tv = 0.11 < p < 0.295
        if tv:
            if p < T['dig'][0]:
                k = srng(0.11, T['dig'][0], p)
                x, y, h = follow([(70, -32), (15, -32), (15, -21), (-24, -21), (-25, TR_Y), (F0 + 3.7, TR_Y)], k)
                place(tr, x, y, 0 if k > 0.98 else h, 7)
            elif p <= T['dig'][1]:
                place(tr, front + 3.7, TR_Y, 0, 7)
            else:
                k = srng(T['dig'][1], 0.295, p)
                x, y, h = follow([(F1 + 3.7, TR_Y), (25, 9), (25, -12), (17, -19), (15, -24), (15, -32), (-160, -32)], k)
                place(tr, x, y, h, 7)
            tr['load'].scale.z = 0.2 + (int(t * 0.11) % 6) / 5
            tr['load'].hide_render = p <= T['dig'][0]
        hide_all(tr['root'], not tv)

        # tower crane
        top = self.top_at(p)
        h_target = max(36, top + 12)
        up = srng(T['craneUp'][0], T['craneUp'][1] - 0.02, p)
        fold = srng(T['craneDown'][0], T['craneDown'][0] + 0.03, p)
        down = srng(T['craneDown'][0] + 0.03, T['craneDown'][1], p)
        H = max(0.5, h_target * up * (1 - down) + (3 * (1 - down) if down > 0 else 0))
        crane_vis = T['craneUp'][0] < p < T['craneGone'][0]
        hide_all(cr['root'], not (T['craneUp'][0] - 0.005 < p < T['craneGone'][1]))
        if crane_vis or (T['craneUp'][0] - 0.005 < p < T['craneGone'][1]):
            nseg = int(H / 1.7)
            for i, sg in enumerate(cr['segments']):
                sg.hide_render = not crane_vis or i >= nseg
            Hs = max(1.7, nseg * 1.7)
            cr['top'].location.z = Hs
            hide_all(cr['top'], not crane_vis)
            jk = srng(T['craneUp'][1] - 0.02, T['craneUp'][1], p) * (1 - fold)
            cr['jib'].scale.x = max(0.001, jk)
            cr['cjib'].scale.x = max(0.001, jk)
            working = jk > 0.99 and crane_vis
            for o in (cr['trolley'], cr['cable']):
                o.hide_render = not working
            hide_all(cr['hook'], not working)
            if working:
                deck = self.deck_at(p)
                pick = (-24 - CRANE[0], -2.6 - CRANE[1])
                cyc = t / 19
                ci = int(cyc)
                ph = cyc - ci
                dx = -9.4 if ci % 2 else 9.4
                drop = (dx - CRANE[0], (8 if ci % 4 < 2 else 1) - CRANE[1])
                aP = math.atan2(pick[1], pick[0])
                aD0 = math.atan2(drop[1], drop[0])
                dA = math.atan2(math.sin(aD0 - aP), math.cos(aD0 - aP))
                aD = aP + dA
                rP, rD = math.hypot(*pick), math.hypot(*drop)
                pickZ, dropZ = 1.2 + 3.62, deck + 0.06 + 3.62
                travel = min(Hs - 1.2, max(pickZ, max(top, deck) + 3.62) + 4.5)
                K = [(0, (aP, rP, travel, 0)), (0.1, (aP, rP, pickZ, 0)), (0.17, (aP, rP, pickZ, 1)), (0.3, (aP, rP, travel, 1)),
                     (0.55, (aD, rD, travel, 1)), (0.68, (aD, rD, dropZ, 1)), (0.74, (aD, rD, dropZ, 0)), (0.85, (aD, rD, travel, 0)), (1, (aP, rP, travel, 0))]
                ang, rad, hz, carry = track(K, ph)
                cr['top'].rotation_euler.z = ang
                cr['trolley'].location.x = rad
                cr['cable'].location.x = rad
                cr['cable'].scale.z = max(0.5, Hs + 1.0 - hz)
                cr['hook'].location = (rad, 0, hz - Hs)
                hide_all(cr['load'], carry < 0.5)
            else:
                cr['top'].rotation_euler.z = -0.6

    def top_at(self, p):
        s = rng(*T['structure'], p)
        k = clamp(s * STOREYS, 0, STOREYS)
        i = int(k)
        return LV[STOREYS] if i >= STOREYS else lerp(LV[i], LV[i + 1], k - i)

    def deck_at(self, p):
        s = rng(*T['structure'], p)
        if s <= 0:
            return RAFT_TOP if p < T['backfill'][1] else 0
        return LV[min(STOREYS, int(s * STOREYS))]


# ================================================================== components
def simple_mat(name, color, rough=0.5):
    from materials import simple
    return simple(name, color, rough)


def sides(rc):
    return [
        dict(o=(rc['x0'], rc['y0']), rot=0.0, L=rc['x1'] - rc['x0'], side='S'),
        dict(o=(rc['x1'], rc['y0']), rot=math.pi / 2, L=rc['y1'] - rc['y0'], side='E'),
        dict(o=(rc['x1'], rc['y1']), rot=math.pi, L=rc['x1'] - rc['x0'], side='N'),
        dict(o=(rc['x0'], rc['y1']), rot=-math.pi / 2, L=rc['y1'] - rc['y0'], side='W'),
    ]


def hide_all(o, h):
    o.hide_render = h
    for ch in o.children_recursive:
        ch.hide_render = h


def empty(name, coll, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    coll.objects.link(o)
    o.parent = parent
    o.location = loc
    return o


def part(name, coll, parent, mesh, mat, loc=(0, 0, 0), bev=0.0):
    o = new_obj(name, mesh, coll, mat, loc)
    o.parent = parent
    if bev:
        bevel(o, bev, 2)
    return o


def profile_mesh(name, pts, depth):
    """Extrude a 2D profile in the XZ plane by depth along Y (centred)."""
    bm = bmesh.new()
    vs0 = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    vs1 = [bm.verts.new((x, depth / 2, z)) for x, z in pts]
    bm.faces.new(vs0)
    bm.faces.new(list(reversed(vs1)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vs0[i], vs0[j], vs1[j], vs1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


DIG = [
    (0.0, (0, -0.05, -0.9, -0.6)), (0.16, (0, -0.5, -1.0, -0.4)), (0.34, (0, -0.4, -1.9, -1.7)), (0.46, (-0.4, 0.4, -1.8, -2.0)),
    (0.62, (-1.57, 0.7, -1.75, -2.0)), (0.72, (-1.57, 0.7, -1.6, -0.2)), (0.84, (-0.5, 0.3, -1.2, -0.5)), (1.0, (0, -0.05, -0.9, -0.6)),
]


def build_excavator(c, M):
    root = empty('Excavator', c)
    for y in (-1.05, 1.05):
        part('Track', c, root, box_mesh('trk', 3.6, 0.62, 0.82, 'bottom'), M['rubber'], (0, y, 0), 0.05)
        for x in (-1.8, 1.8):
            bm = bmesh.new()
            cylinder_between(bm, (x, y - 0.31, 0.41), (x, y + 0.31, 0.41), 0.41, None, 24)
            me = bpy.data.meshes.new('idler'); bm.to_mesh(me); bm.free(); smooth_shade(me)
            part('Idler', c, root, me, M['rubber'])
        part('TrackFrame', c, root, box_mesh('tf', 3.0, 0.66, 0.16, 'bottom'), M['steel'], (0, y, 0.78), 0.02)
        # track shoes texture via thin ribs
        ribs = merge_boxes('ribs', [(0.08, 0.64, 0.04, (x * 0.22, 0, 0.84)) for x in range(-8, 9)])
        part('Ribs', c, root, ribs, M['rubber'], (0, y, 0))
    part('Carbody', c, root, box_mesh('cb', 2.0, 1.5, 0.45, 'bottom'), M['steel'], (0, 0, 0.68), 0.03)
    house = empty('House', c, root, (0, 0, 1.12))
    part('Swing', c, house, box_mesh('sw', 1.8, 1.8, 0.2, 'bottom'), M['steel'], (0, 0, -0.1), 0.05)
    part('Body', c, house, box_mesh('body', 2.9, 2.5, 1.0, 'bottom'), M['yellow'], (-0.35, 0, 0.1), 0.08)
    part('Counterweight', c, house, profile_mesh('cw', [(0, 0), (0.9, 0), (0.9, 1.0), (0.15, 1.0), (0, 0.75)], 2.5), M['yellow'], (-2.7, 0, 0.1), 0.06)
    part('Hood', c, house, box_mesh('hood', 1.5, 1.4, 0.38, 'bottom'), M['yellow'], (-1.0, 0.45, 1.1), 0.05)
    part('Exhaust', c, house, box_mesh('exh', 0.12, 0.12, 0.6, 'bottom'), M['steel'], (-0.6, 0.9, 1.4))
    cab = empty('Cab', c, house, (0.55, -0.68, 1.1))
    part('CabGlass', c, cab, box_mesh('cg', 0.98, 0.93, 1.5, 'bottom'), M['vehicle_glass'])
    part('CabRoof', c, cab, box_mesh('cr', 1.06, 1.0, 0.08, 'bottom'), M['yellow'], (0, 0, 1.5), 0.02)
    for x, y in ((0.49, 0.45), (0.49, -0.45), (-0.49, 0.45), (-0.49, -0.45)):
        part('Pillar', c, cab, box_mesh('pl', 0.06, 0.06, 1.5, 'bottom'), M['yellow'], (x, y, 0))
    boom = empty('Boom', c, house, (1.0, 0.2, 1.0))
    part('BoomArm', c, boom, profile_mesh('boom', [(0, 0.28), (0.05, -0.28), (2.9, 1.72), (5.7, 0.35), (5.7, 0.85), (2.9, 2.3)], 0.48), M['yellow'], bev=0.04)
    bm = bmesh.new(); cylinder_between(bm, (3.0, 0, 2.55), (5.0, 0, 1.45), 0.11, None, 12)
    me = bpy.data.meshes.new('rod'); bm.to_mesh(me); bm.free(); smooth_shade(me)
    part('Rod', c, boom, me, M['chrome'])
    bm = bmesh.new(); cylinder_between(bm, (2.4, 0, 2.55), (3.7, 0, 1.95), 0.16, None, 12)
    me = bpy.data.meshes.new('barrel'); bm.to_mesh(me); bm.free(); smooth_shade(me)
    part('Barrel', c, boom, me, M['yellow'])
    stick = empty('Stick', c, boom, (5.6, 0, 0.6))
    part('StickArm', c, stick, profile_mesh('stick', [(-0.6, 0.25), (-0.6, -0.3), (2.9, -0.15), (2.9, 0.15)], 0.36), M['yellow'], bev=0.03)
    bucket = empty('Bucket', c, stick, (2.85, 0, 0))
    part('BucketShell', c, bucket, profile_mesh('bucket', [(0, 0.15), (0.75, 0.1), (1.15, -0.45), (0.95, -1.0), (0.25, -0.75)], 1.05), M['steel'], bev=0.03)
    for k in range(-2, 3):
        o = part('Tooth', c, bucket, box_mesh('tooth', 0.22, 0.1, 0.08), M['steel'], (1.22, k * 0.22, -0.5))
        o.rotation_euler = (0, -0.5, 0)
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.45)
    me = bpy.data.meshes.new('dirt'); bm.to_mesh(me); bm.free(); smooth_shade(me)
    dirt = part('Dirt', c, bucket, me, M['terrain'], (0.65, 0, -0.35))
    dirt.scale = (1, 1.2, 0.6)
    return dict(root=root, house=house, boom=boom, stick=stick, bucket=bucket, dirt=dirt)


def build_truck(c, M):
    root = empty('Truck', c)
    part('Chassis', c, root, box_mesh('ch', 8.2, 1.4, 0.5), M['steel'], (0, 0, 1.0), 0.03)
    part('Cab', c, root, box_mesh('cab', 2.2, 2.5, 2.3), M['white_paint'], (3.0, 0, 2.15), 0.08)
    part('Windscreen', c, root, box_mesh('ws', 0.06, 2.2, 0.9), M['vehicle_glass'], (4.12, 0, 2.65))
    part('CabStripe', c, root, box_mesh('st', 2.24, 2.54, 0.1), M['brass'], (3.0, 0, 1.2))
    bed = empty('Bed', c, root, (-1.2, 0, 1.3))
    part('BedFloor', c, bed, box_mesh('bf', 5.6, 2.5, 0.15), M['steel'], (0, 0, 0.08), 0.02)
    part('BedSideA', c, bed, box_mesh('bs', 5.6, 0.1, 1.4), M['steel'], (0, 1.2, 0.8), 0.02)
    part('BedSideB', c, bed, box_mesh('bs2', 5.6, 0.1, 1.4), M['steel'], (0, -1.2, 0.8), 0.02)
    part('BedFront', c, bed, box_mesh('bfr', 0.1, 2.5, 1.6), M['steel'], (2.75, 0, 0.9), 0.02)
    part('BedBack', c, bed, box_mesh('bbk', 0.1, 2.5, 1.2), M['steel'], (-2.75, 0, 0.7), 0.02)
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=1.0)
    for v in bm.verts:
        v.co.z = max(v.co.z, 0)
    me = bpy.data.meshes.new('load'); bm.to_mesh(me); bm.free(); smooth_shade(me)
    load = part('Load', c, bed, me, M['terrain'], (0, 0, 0.15))
    load.scale = (2.5, 1.1, 1.1)
    for x in (3.0, -0.6, -2.4):
        for y in (-1.1, 1.1):
            bm = bmesh.new(); cylinder_between(bm, (x, y - 0.22, 0.55), (x, y + 0.22, 0.55), 0.55, None, 24)
            me = bpy.data.meshes.new('wheel'); bm.to_mesh(me); bm.free(); smooth_shade(me)
            part('Wheel', c, root, me, M['rubber'])
            bm = bmesh.new(); cylinder_between(bm, (x, y - 0.23 * (1 if y > 0 else -1), 0.55), (x, y + 0.235 * (1 if y > 0 else -1), 0.55), 0.3, None, 16)
            me = bpy.data.meshes.new('hub'); bm.to_mesh(me); bm.free()
            part('Hub', c, root, me, M['steel'])
    return dict(root=root, load=load)


def lattice_segment(name, w, h):
    """One square mast section of a lattice tower: 4 chords + bracing."""
    bm = bmesh.new()
    corners = [(-w / 2, -w / 2), (w / 2, -w / 2), (w / 2, w / 2), (-w / 2, w / 2)]
    for x, y in corners:
        cylinder_between(bm, (x, y, 0), (x, y, h), 0.07, None, 6)
    for i in range(4):
        (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % 4]
        cylinder_between(bm, (x0, y0, 0.02), (x1, y1, 0.02), 0.035, None, 5)
        cylinder_between(bm, (x0, y0, 0.05), (x1, y1, h - 0.05), 0.03, None, 5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def truss(name, length, w, h, step):
    """Triangular jib truss along +X from 0..length."""
    bm = bmesh.new()
    a, b, top = (0, -w / 2, 0), (0, w / 2, 0), (0, 0, h)
    for (y, z) in ((-w / 2, 0), (w / 2, 0), (0, h)):
        cylinder_between(bm, (0, y, z), (length, y, z), 0.06, None, 6)
    x = 0.0
    k = 0
    while x < length - 1e-3:
        x1 = min(length, x + step)
        cylinder_between(bm, (x, -w / 2, 0), (x, w / 2, 0), 0.03, None, 5)
        if k % 2 == 0:
            cylinder_between(bm, (x, -w / 2, 0), (x1, 0, h), 0.03, None, 5)
            cylinder_between(bm, (x, w / 2, 0), (x1, 0, h), 0.03, None, 5)
        else:
            cylinder_between(bm, (x, 0, h), (x1, -w / 2, 0), 0.03, None, 5)
            cylinder_between(bm, (x, 0, h), (x1, w / 2, 0), 0.03, None, 5)
        x = x1
        k += 1
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def build_crane(c, M):
    root = empty('Crane', c)
    part('CranePad', c, root, box_mesh('pad', 5, 5, 1.2), M['concrete'], (0, 0, -0.45), 0.03)
    seg_mesh = lattice_segment('mastseg', 1.7, 1.7)
    segments = []
    for i in range(28):
        o = part('MastSeg', c, root, seg_mesh, M['crane'], (0, 0, i * 1.7))
        segments.append(o)
    top = empty('CraneTop', c, root)
    part('Slewing', c, top, box_mesh('slew', 2.3, 2.3, 0.9, 'bottom'), M['crane'], (0, 0, 0), 0.05)
    part('Ring', c, top, box_mesh('ring', 1.9, 1.9, 0.35, 'bottom'), M['steel'], (0, 0, 0.9), 0.05)
    cab = empty('CraneCab', c, top, (0.9, -1.55, 1.3))
    part('CraneCabBody', c, cab, box_mesh('ccb', 1.7, 1.25, 2.0, 'bottom'), M['crane'], (0, 0, 0), 0.05)
    part('CraneCabGlass', c, cab, box_mesh('ccg', 1.2, 1.28, 1.3, 'bottom'), M['vehicle_glass'], (0.3, 0, 0.45))
    jib = empty('Jib', c, top, (0, 0, 1.25))
    part('JibTruss', c, jib, truss('jib', 42, 1.4, 1.6, 2.0), M['crane'])
    part('JibLight', c, jib, box_mesh('jl', 0.4, 0.4, 0.4, 'bottom'), M['red_light'], (41.8, 0, 1.6))
    cjib = empty('CounterJib', c, top, (0, 0, 1.25))
    o = part('CJibTruss', c, cjib, truss('cjib', 13, 1.8, 1.0, 1.6), M['crane'])
    o.rotation_euler = (0, 0, math.pi)
    part('CJibDeck', c, cjib, box_mesh('cjd', 13, 2.0, 0.12, 'bottom'), M['steel'], (-6.5, 0, 0), 0.02)
    for k in range(4):
        part('Counterweight', c, cjib, box_mesh('cwt', 0.62, 2.0, 2.3), M['concrete'], (-12.4 + k * 0.66, 0, -0.6), 0.03)
    part('Winch', c, cjib, box_mesh('winch', 1.8, 1.4, 1.2, 'bottom'), M['steel'], (-4.5, 0, 0.12), 0.04)
    part('TopLight', c, top, box_mesh('tl', 0.35, 0.35, 0.35, 'bottom'), M['red_light'], (0, 0, 3.0))
    part('TopPost', c, top, box_mesh('tp', 0.3, 0.3, 2.0, 'bottom'), M['crane'], (0, 0, 1.2))
    trolley = part('Trolley', c, top, box_mesh('trol', 1.3, 1.3, 0.35), M['steel'], (10, 0, 1.05), 0.03)
    bm = bmesh.new(); cylinder_between(bm, (0, 0, 0), (0, 0, -1), 0.025, None, 6)
    me = bpy.data.meshes.new('cable'); bm.to_mesh(me); bm.free()
    cable = part('Cable', c, top, me, M['steel'], (10, 0, 1.0))
    hook = empty('Hook', c, top)
    part('HookBlock', c, hook, box_mesh('hb', 0.55, 0.35, 0.8), M['crane'], (0, 0, -0.4), 0.03)
    load = empty('Load', c, hook)
    bm = bmesh.new()
    for x, y in ((-1.1, -0.5), (1.1, -0.5), (-1.1, 0.5), (1.1, 0.5)):
        cylinder_between(bm, (0, 0, -0.9), (x, y, -3.0), 0.012, None, 4)
    me = bpy.data.meshes.new('slings'); bm.to_mesh(me); bm.free()
    part('Slings', c, load, me, M['steel'])
    part('Pallet', c, load, box_mesh('lp', 2.6, 1.3, 0.12), M['plywood'], (0, 0, -3.56))
    part('Cargo', c, load, box_mesh('lc', 2.4, 1.2, 0.5), M['curb'], (0, 0, -3.25), 0.02)
    return dict(root=root, segments=segments, top=top, jib=jib, cjib=cjib, trolley=trolley, cable=cable, hook=hook, load=load)


def make_tree_mesh(seed, M):
    """Recursive broadleaf tree: tapered branches + thousands of leaf cards with per-leaf colour variation."""
    r = seeded(seed)
    bm = bmesh.new()
    leaves = []

    def branch(a, d, length, radius, depth):
        b = a + d * length
        cylinder_between(bm, a, b, radius, radius * 0.62, 7 if depth < 2 else 5)
        if depth >= 3:
            for _ in range(18):
                leaves.append(b + Vector((r.gauss(0, 0.7), r.gauss(0, 0.7), r.gauss(0.15, 0.55))))
            return
        n = 3 if depth == 0 else r.choice((2, 3, 3))
        for i in range(n):
            ang = i / n * math.tau + r.random() * 0.9
            tilt = 0.45 + r.random() * 0.4 + depth * 0.1
            nd = (d * (1 - tilt) + Vector((math.cos(ang), math.sin(ang), 0)) * tilt).normalized()
            nd.z = max(nd.z, 0.15)
            nd.normalize()
            branch(b, nd, length * (0.62 + r.random() * 0.15), radius * 0.62, depth + 1)
        if depth >= 1:
            for _ in range(10):
                leaves.append(b + Vector((r.gauss(0, 0.6), r.gauss(0, 0.6), r.gauss(0.1, 0.5))))

    branch(Vector((0, 0, 0)), Vector((r.gauss(0, 0.05), r.gauss(0, 0.05), 1)).normalized(), 3.4, 0.2, 0)
    me_wood = bpy.data.meshes.new('wood')
    bm.to_mesh(me_wood)
    bm.free()
    # leaf cards
    verts, faces, uvs, var = [], [], [], []
    for c in leaves:
        for _ in range(3):
            pc = c + Vector((r.gauss(0, 0.35), r.gauss(0, 0.35), r.gauss(0, 0.3)))
            size = 0.22 + r.random() * 0.12
            rot = Euler((r.random() * 6.28, r.random() * 6.28, r.random() * 6.28)).to_matrix()
            u, v = rot @ Vector((size * 0.6, 0, 0)), rot @ Vector((0, size, 0))
            b = len(verts)
            verts += [pc - u - v, pc + u - v, pc + u + v, pc - u + v]
            faces.append((b, b + 1, b + 2, b + 3))
            uvs += [(0, 0), (1, 0), (1, 1), (0, 1)]
            var.append(r.random())
    me_leaf = bpy.data.meshes.new('leaves')
    me_leaf.from_pydata([tuple(v) for v in verts], [], faces)
    uvl = me_leaf.uv_layers.new(name='UVMap')
    uvl.data.foreach_set('uv', [c for uv in uvs for c in uv])
    a = me_leaf.attributes.new('leafvar', 'FLOAT', 'FACE')
    a.data.foreach_set('value', var)
    # join into one mesh with two materials
    bm = bmesh.new()
    bm.from_mesh(me_wood)
    nwood = len(bm.faces)
    bm.from_mesh(me_leaf)
    bm.faces.ensure_lookup_table()
    for i, f in enumerate(bm.faces):
        f.material_index = 0 if i < nwood else 1
    me = bpy.data.meshes.new('tree%d' % seed)
    bm.to_mesh(me)
    bm.free()
    smooth_shade(me)
    me.materials.append(M['bark'])
    me.materials.append(M['leaf_a'] if seed % 2 else M['leaf_b'])
    return me
