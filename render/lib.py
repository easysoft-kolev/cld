"""Shared helpers for the Blender construction scene: maths, mesh builders, procedural materials."""
import math
import random

import bmesh
import bpy
from mathutils import Vector, Matrix


# ------------------------------------------------------------------ maths
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    return t * t * (3 - 2 * t)


def rng(a, b, p):
    return clamp((p - a) / (b - a))


def srng(a, b, p):
    return smooth(rng(a, b, p))


def track(keys, p, ease=smooth):
    """keys: [(p, value_or_tuple)] sorted by p."""
    if p <= keys[0][0]:
        return keys[0][1]
    if p >= keys[-1][0]:
        return keys[-1][1]
    i = 0
    while i < len(keys) - 2 and p > keys[i + 1][0]:
        i += 1
    (pa, va), (pb, vb) = keys[i], keys[i + 1]
    t = ease((p - pa) / (pb - pa))
    if isinstance(va, (int, float)):
        return lerp(va, vb, t)
    return tuple(lerp(x, y, t) for x, y in zip(va, vb))


# ------------------------------------------------------------------ scene graph
def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def link(obj, coll):
    coll.objects.link(obj)
    return obj


def new_obj(name, mesh, coll, mat=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, mesh)
    o.location = loc
    if mat is not None:
        if isinstance(mat, (list, tuple)):
            for m in mat:
                mesh.materials.append(m)
        else:
            mesh.materials.append(mat)
    return link(o, coll)


def bevel(obj, width=0.02, segments=2):
    m = obj.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.harden_normals = False
    return m


def smooth_shade(mesh):
    for p in mesh.polygons:
        p.use_smooth = True


# ------------------------------------------------------------------ mesh builders (geometry baked, object at origin unless loc given)
def box_mesh(name, sx, sy, sz, origin='center'):
    """Box with dimensions; origin 'center' or 'bottom' (z from 0..sz) or 'west' (x from 0..sx, z centred)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
        if origin in ('bottom', 'west_bottom'):
            v.co.z += sz / 2
        if origin in ('west', 'west_bottom'):
            v.co.x += sx / 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    # simple box UVs in metres
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.5:
                uv.data[li].uv = (co.x, co.y)
            elif abs(n.x) > 0.5:
                uv.data[li].uv = (co.y, co.z)
            else:
                uv.data[li].uv = (co.x, co.z)
    return me


def merge_boxes(name, boxes):
    """boxes: [(sx, sy, sz, (x, y, z_center))] -> one mesh."""
    bm = bmesh.new()
    for sx, sy, sz, (x, y, z) in boxes:
        geom = bmesh.ops.create_cube(bm, size=1.0)
        for v in geom['verts']:
            v.co.x = v.co.x * sx + x
            v.co.y = v.co.y * sy + y
            v.co.z = v.co.z * sz + z
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def cylinder_between(bm, a, b, r0, r1=None, segs=8):
    """Add a tapered cylinder from point a to point b into bmesh bm."""
    r1 = r0 if r1 is None else r1
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    if length < 1e-6:
        return
    geom = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    mat = Matrix.Translation((a + b) / 2) @ rot
    bmesh.ops.transform(bm, matrix=mat, verts=geom['verts'])


# ------------------------------------------------------------------ materials
class NodeBuilder:
    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.nodes = self.nt.nodes
        self.links = self.nt.links
        self.x = -1200

    def node(self, kind, **props):
        n = self.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 160
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, out, inp):
        self.links.new(out, inp)


def mix_color(nb, fac, a, b):
    """Mix two colours (sockets or tuples) by factor (socket or float). Returns colour output socket."""
    m = nb.node('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
    ins = [s for s in m.inputs if s.enabled]
    f_in, a_in, b_in = ins[0], ins[1], ins[2]
    for src, dst in ((fac, f_in), (a, a_in), (b, b_in)):
        if isinstance(src, bpy.types.NodeSocket):
            nb.link(src, dst)
        elif isinstance(src, (int, float)):
            dst.default_value = src
        else:
            dst.default_value = (*src[:3], 1.0) if len(src) == 3 else src
    return [s for s in m.outputs if s.enabled][0]


def map_range(nb, src, a, b, c=0.0, d=1.0):
    n = nb.node('ShaderNodeMapRange', clamp=True)
    nb.link(src, n.inputs['Value'])
    n.inputs['From Min'].default_value = a
    n.inputs['From Max'].default_value = b
    n.inputs['To Min'].default_value = c
    n.inputs['To Max'].default_value = d
    return n.outputs['Result']


def math_node(nb, op, a, b=None):
    n = nb.node('ShaderNodeMath', operation=op)
    for src, dst in ((a, n.inputs[0]), (b, n.inputs[1])):
        if src is None:
            continue
        if isinstance(src, bpy.types.NodeSocket):
            nb.link(src, dst)
        else:
            dst.default_value = src
    return n.outputs[0]


def noise(nb, scale, detail=6.0, rough=0.55, vector=None, dims='3D'):
    n = nb.node('ShaderNodeTexNoise', noise_dimensions=dims)
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    if vector is not None:
        nb.link(vector, n.inputs['Vector'])
    return n


def new_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nb = NodeBuilder(m)
    bsdf = nb.nodes.get('Principled BSDF')
    out = nb.nodes.get('Material Output')
    bsdf.location = (400, 0)
    out.location = (800, 0)
    return m, nb, bsdf, out


def set_inputs(bsdf, **vals):
    names = {
        'base': 'Base Color', 'metal': 'Metallic', 'rough': 'Roughness', 'ior': 'IOR', 'alpha': 'Alpha',
        'coat': 'Coat Weight', 'coat_rough': 'Coat Roughness', 'spec': 'Specular IOR Level',
        'emit_col': 'Emission Color', 'emit': 'Emission Strength', 'trans': 'Transmission Weight',
        'sss': 'Subsurface Weight',
    }
    for k, v in vals.items():
        sock = bsdf.inputs[names[k]]
        if isinstance(v, (tuple, list)) and len(v) == 3:
            v = (*v, 1.0)
        sock.default_value = v


def bump(nb, height, strength, distance=0.1, normal=None):
    b = nb.node('ShaderNodeBump')
    b.inputs['Strength'].default_value = strength
    b.inputs['Distance'].default_value = distance
    nb.link(height, b.inputs['Height'])
    if normal is not None:
        nb.link(normal, b.inputs['Normal'])
    return b.outputs['Normal']


def tex_coord(nb, kind='Object'):
    return nb.node('ShaderNodeTexCoord').outputs[kind]


def seeded(seed):
    return random.Random(seed)
