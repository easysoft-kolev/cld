"""Procedural PBR materials (no image downloads needed) + aerial haze applied to everything."""
import bpy

from lib import (new_material, set_inputs, noise, bump, tex_coord, mix_color, map_range, math_node, NodeBuilder)

NIGHT_NODES = []   # Value nodes multiplied into emissive strengths; set per frame
CONTROLS = {}


def _night_value(nb, name='night'):
    v = nb.node('ShaderNodeValue')
    v.name = name
    v.outputs[0].default_value = 0.0
    NIGHT_NODES.append(v)
    return v.outputs[0]


def concrete():
    m, nb, bsdf, out = new_material('Concrete')
    co = tex_coord(nb, 'Object')
    n1 = noise(nb, 0.35, 8, 0.6, co)
    n2 = noise(nb, 6.0, 6, 0.65, co)
    base = mix_color(nb, n1.outputs['Fac'], (0.36, 0.345, 0.32), (0.47, 0.455, 0.43))
    base = mix_color(nb, map_range(nb, n2.outputs['Fac'], 0.3, 0.7, 0, 0.35), base, (0.3, 0.29, 0.27))
    info = nb.node('ShaderNodeObjectInfo')
    sep = nb.node('ShaderNodeSeparateColor')
    nb.link(info.outputs['Color'], sep.inputs[0])
    wet = sep.outputs[0]                     # object colour R = freshness of the pour
    base = mix_color(nb, wet, base, (0.17, 0.165, 0.155))
    nb.link(base, bsdf.inputs['Base Color'])
    rough = map_range(nb, wet, 0, 1, 0.9, 0.5)
    nb.link(rough, bsdf.inputs['Roughness'])
    vor = nb.node('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 60
    nb.link(co, vor.inputs['Vector'])
    pits = map_range(nb, vor.outputs['Distance'], 0.0, 0.08, 1.0, 0.0)
    h = math_node(nb, 'ADD', n2.outputs['Fac'], math_node(nb, 'MULTIPLY', pits, -0.6))
    nb.link(bump(nb, h, 0.12, 0.02), bsdf.inputs['Normal'])
    return m


def terrain():
    """Plot terrain. Colour attribute 'mask': R grass, G lawn, B excavation depth."""
    m, nb, bsdf, out = new_material('Terrain')
    co = tex_coord(nb, 'Object')
    attr = nb.node('ShaderNodeAttribute', attribute_name='mask')
    sep = nb.node('ShaderNodeSeparateColor')
    nb.link(attr.outputs['Color'], sep.inputs[0])
    grass_k, lawn_k, depth_k = sep.outputs[0], sep.outputs[1], sep.outputs[2]
    n1 = noise(nb, 0.6, 8, 0.6, co)
    n2 = noise(nb, 8.0, 8, 0.7, co)
    vor = nb.node('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 14
    nb.link(co, vor.inputs['Vector'])
    soil = mix_color(nb, n1.outputs['Fac'], (0.16, 0.115, 0.08), (0.27, 0.2, 0.14))
    soil = mix_color(nb, map_range(nb, vor.outputs['Distance'], 0.0, 0.12, 0.55, 0.0), soil, (0.42, 0.38, 0.33))  # pebbles
    clay = mix_color(nb, n2.outputs['Fac'], (0.15, 0.095, 0.055), (0.22, 0.145, 0.085))
    col = mix_color(nb, map_range(nb, depth_k, 0.05, 0.35), soil, clay)
    gn = noise(nb, 2.5, 8, 0.7, co)
    grass = mix_color(nb, gn.outputs['Fac'], (0.05, 0.075, 0.02), (0.11, 0.13, 0.04))
    grass = mix_color(nb, map_range(nb, n2.outputs['Fac'], 0.55, 0.75), grass, (0.16, 0.14, 0.07))  # dry patches
    lawn = mix_color(nb, gn.outputs['Fac'], (0.045, 0.09, 0.02), (0.08, 0.14, 0.03))
    col = mix_color(nb, grass_k, col, grass)
    col = mix_color(nb, lawn_k, col, lawn)
    nb.link(col, bsdf.inputs['Base Color'])
    set_inputs(bsdf, rough=0.96, spec=0.3)
    fine = noise(nb, 40, 4, 0.7, co)
    h = math_node(nb, 'ADD', math_node(nb, 'MULTIPLY', n2.outputs['Fac'], 0.6), math_node(nb, 'MULTIPLY', fine.outputs['Fac'], 0.4))
    nb.link(bump(nb, h, 0.45, 0.06), bsdf.inputs['Normal'])
    return m


def grass_ground():
    m, nb, bsdf, out = new_material('Grass')
    co = tex_coord(nb, 'Object')
    n = noise(nb, 0.08, 6, 0.6, co)
    g = noise(nb, 3, 8, 0.7, co)
    c = mix_color(nb, g.outputs['Fac'], (0.045, 0.07, 0.02), (0.1, 0.12, 0.04))
    c = mix_color(nb, map_range(nb, n.outputs['Fac'], 0.45, 0.65, 0, 0.6), c, (0.15, 0.13, 0.07))
    nb.link(c, bsdf.inputs['Base Color'])
    set_inputs(bsdf, rough=0.95, spec=0.3)
    nb.link(bump(nb, noise(nb, 50, 3, 0.6, co).outputs['Fac'], 0.4, 0.03), bsdf.inputs['Normal'])
    return m


def asphalt():
    m, nb, bsdf, out = new_material('Asphalt')
    co = tex_coord(nb, 'Object')
    n = noise(nb, 0.4, 6, 0.6, co)
    f = noise(nb, 90, 3, 0.6, co)
    c = mix_color(nb, n.outputs['Fac'], (0.045, 0.045, 0.047), (0.08, 0.08, 0.082))
    c = mix_color(nb, map_range(nb, f.outputs['Fac'], 0.55, 0.7, 0, 0.5), c, (0.18, 0.18, 0.18))
    nb.link(c, bsdf.inputs['Base Color'])
    nb.link(map_range(nb, n.outputs['Fac'], 0.3, 0.7, 0.75, 0.95), bsdf.inputs['Roughness'])
    nb.link(bump(nb, f.outputs['Fac'], 0.25, 0.01), bsdf.inputs['Normal'])
    return m


def pavers(name='Pavers', scale=(0.6, 0.3), col_a=(0.42, 0.4, 0.37), col_b=(0.52, 0.5, 0.46)):
    m, nb, bsdf, out = new_material(name)
    co = tex_coord(nb, 'Object')
    br = nb.node('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = 1.0 / scale[0]
    br.inputs['Mortar Size'].default_value = 0.012
    br.inputs['Row Height'].default_value = scale[1] / scale[0] * 0.5
    br.inputs['Color1'].default_value = (*col_a, 1)
    br.inputs['Color2'].default_value = (*col_b, 1)
    br.inputs['Mortar'].default_value = (0.12, 0.115, 0.11, 1)
    br.inputs['Bias'].default_value = 0.0
    nb.link(co, br.inputs['Vector'])
    n = noise(nb, 3, 6, 0.6, co)
    c = mix_color(nb, map_range(nb, n.outputs['Fac'], 0.3, 0.7, 0, 0.3), br.outputs['Color'], (0.2, 0.19, 0.18))
    nb.link(c, bsdf.inputs['Base Color'])
    set_inputs(bsdf, rough=0.85)
    nb.link(bump(nb, br.outputs['Fac'], 0.5, 0.01), bsdf.inputs['Normal'])
    return m


def simple(name, color, rough=0.5, metal=0.0, coat=0.0, noise_amt=0.0, bump_amt=0.0, noise_scale=3.0):
    m, nb, bsdf, out = new_material(name)
    if noise_amt > 0 or bump_amt > 0:
        co = tex_coord(nb, 'Object')
        n = noise(nb, noise_scale, 6, 0.6, co)
        dark = tuple(c * (1 - noise_amt) for c in color)
        nb.link(mix_color(nb, n.outputs['Fac'], dark, color), bsdf.inputs['Base Color'])
        if bump_amt > 0:
            nb.link(bump(nb, noise(nb, noise_scale * 12, 4, 0.6, co).outputs['Fac'], bump_amt, 0.02), bsdf.inputs['Normal'])
    else:
        set_inputs(bsdf, base=color)
    set_inputs(bsdf, rough=rough, metal=metal, coat=coat)
    return m


def machine_paint(name, color):
    """Industrial paint with grime collecting low down."""
    m, nb, bsdf, out = new_material(name)
    co = tex_coord(nb, 'Object')
    geo = nb.node('ShaderNodeNewGeometry')
    sep = nb.node('ShaderNodeSeparateXYZ')
    nb.link(geo.outputs['Position'], sep.inputs[0])
    n = noise(nb, 4, 8, 0.65, co)
    dirt_k = math_node(nb, 'MULTIPLY', map_range(nb, n.outputs['Fac'], 0.45, 0.7, 0, 1), 0.55)
    low = map_range(nb, sep.outputs['Z'], -4.0, 1.4, 0.7, 0.0)
    dirt_k = math_node(nb, 'MAXIMUM', dirt_k, low)
    c = mix_color(nb, dirt_k, color, (0.16, 0.12, 0.08))
    nb.link(c, bsdf.inputs['Base Color'])
    nb.link(map_range(nb, dirt_k, 0, 1, 0.32, 0.85), bsdf.inputs['Roughness'])
    set_inputs(bsdf, coat=0.25, coat_rough=0.2)
    return m


def thin_glass(name, tint=(0.55, 0.62, 0.66), refl=(0.75, 0.8, 0.85), rough=0.02, transp=0.9):
    """Architectural glass: Fresnel-weighted reflection over a tinted see-through layer, no refraction/caustics."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nb = NodeBuilder(m)
    nb.nodes.clear()
    out = nb.node('ShaderNodeOutputMaterial')
    lp = nb.node('ShaderNodeLightPath')
    transparent = nb.node('ShaderNodeBsdfTransparent')
    transparent.inputs['Color'].default_value = (*tint, 1)
    gloss = nb.node('ShaderNodeBsdfGlossy' if 'ShaderNodeBsdfGlossy' in dir(bpy.types) else 'ShaderNodeBsdfAnisotropic')
    gloss.inputs['Color'].default_value = (*refl, 1)
    gloss.inputs['Roughness'].default_value = rough
    fres = nb.node('ShaderNodeLayerWeight')
    fres.inputs['Blend'].default_value = 0.18
    # minimum reflectance so facades still read as glass head-on
    k = math_node(nb, 'MAXIMUM', fres.outputs['Fresnel'], 1 - transp)
    mix = nb.node('ShaderNodeMixShader')
    nb.link(k, mix.inputs['Fac'])
    nb.link(transparent.outputs[0], mix.inputs[1])
    nb.link(gloss.outputs[0], mix.inputs[2])
    shadow = nb.node('ShaderNodeMixShader')
    nb.link(lp.outputs['Is Shadow Ray'], shadow.inputs['Fac'])
    nb.link(mix.outputs[0], shadow.inputs[1])
    nb.link(transparent.outputs[0], shadow.inputs[2])
    nb.link(shadow.outputs[0], out.inputs['Surface'])
    CONTROLS.setdefault('glass_k', []).append(fres.inputs['Blend'])
    return m


def stone():
    m, nb, bsdf, out = new_material('Stone')
    co = tex_coord(nb, 'Object')
    br = nb.node('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = 0.8
    br.inputs['Mortar Size'].default_value = 0.004
    br.inputs['Row Height'].default_value = 0.5
    br.inputs['Brick Width'].default_value = 1.2
    br.inputs['Color1'].default_value = (0.5, 0.45, 0.37, 1)
    br.inputs['Color2'].default_value = (0.55, 0.5, 0.41, 1)
    br.inputs['Mortar'].default_value = (0.4, 0.37, 0.33, 1)
    nb.link(co, br.inputs['Vector'])
    n = noise(nb, 9, 8, 0.65, co)
    c = mix_color(nb, map_range(nb, n.outputs['Fac'], 0.35, 0.65, 0, 0.25), br.outputs['Color'], (0.5, 0.45, 0.37))
    nb.link(c, bsdf.inputs['Base Color'])
    set_inputs(bsdf, rough=0.55, spec=0.45)
    h = math_node(nb, 'ADD', br.outputs['Fac'], math_node(nb, 'MULTIPLY', n.outputs['Fac'], 0.3))
    nb.link(bump(nb, h, 0.3, 0.01), bsdf.inputs['Normal'])
    return m


def interior():
    """Emissive interior cards: random per object, off-rooms, warm/cool mix; dim diffuse look by day."""
    m, nb, bsdf, out = new_material('Interior')
    attr = nb.node('ShaderNodeAttribute', attribute_name='rand')
    r = attr.outputs['Fac']
    warm = mix_color(nb, map_range(nb, r, 0.0, 1.0), (1.0, 0.62, 0.32), (1.0, 0.78, 0.5))
    col = mix_color(nb, map_range(nb, r, 0.82, 0.84), warm, (0.78, 0.85, 1.0))
    on = map_range(nb, r, 0.2, 0.21)                     # ~20 % of rooms stay dark
    bright = map_range(nb, r, 0.0, 1.0, 0.6, 1.3)
    night = _night_value(nb)
    strength = math_node(nb, 'MULTIPLY', math_node(nb, 'MULTIPLY', on, bright), math_node(nb, 'MULTIPLY', night, 3.2))
    nb.link(col, bsdf.inputs['Emission Color'])
    nb.link(strength, bsdf.inputs['Emission Strength'])
    day = mix_color(nb, r, (0.14, 0.12, 0.1), (0.24, 0.21, 0.17))
    nb.link(day, bsdf.inputs['Base Color'])
    set_inputs(bsdf, rough=0.9)
    return m


def city_facade(name, wall_a, wall_b, win_w=0.56, win_h=0.5, cell=(3.2, 3.1)):
    """Procedural windows on any box: u = x + y along walls, v = z. Random lit windows at night."""
    m, nb, bsdf, out = new_material(name)
    co = tex_coord(nb, 'Object')
    info = nb.node('ShaderNodeObjectInfo')
    sep = nb.node('ShaderNodeSeparateXYZ')
    nb.link(co, sep.inputs[0])
    u = math_node(nb, 'ADD', sep.outputs['X'], sep.outputs['Y'])
    u = math_node(nb, 'ADD', u, math_node(nb, 'MULTIPLY', info.outputs['Random'], 37.0))
    v = sep.outputs['Z']
    cu = math_node(nb, 'DIVIDE', u, cell[0])
    cv = math_node(nb, 'DIVIDE', v, cell[1])
    fu = math_node(nb, 'FRACT', cu)
    fv = math_node(nb, 'FRACT', cv)
    inu = math_node(nb, 'MULTIPLY', math_node(nb, 'GREATER_THAN', fu, 0.5 - win_w / 2), math_node(nb, 'LESS_THAN', fu, 0.5 + win_w / 2))
    inv = math_node(nb, 'MULTIPLY', math_node(nb, 'GREATER_THAN', fv, 0.3), math_node(nb, 'LESS_THAN', fv, 0.3 + win_h))
    geo = nb.node('ShaderNodeNewGeometry')
    nsep = nb.node('ShaderNodeSeparateXYZ')
    nb.link(geo.outputs['Normal'], nsep.inputs[0])
    wall_face = math_node(nb, 'LESS_THAN', math_node(nb, 'ABSOLUTE', nsep.outputs['Z']), 0.5)
    ground_floor = math_node(nb, 'GREATER_THAN', v, 2.6)
    win = math_node(nb, 'MULTIPLY', math_node(nb, 'MULTIPLY', inu, inv), math_node(nb, 'MULTIPLY', wall_face, ground_floor))
    wn = nb.node('ShaderNodeTexWhiteNoise', noise_dimensions='3D')
    cell_id = nb.node('ShaderNodeCombineXYZ')
    nb.link(math_node(nb, 'FLOOR', cu), cell_id.inputs['X'])
    nb.link(math_node(nb, 'FLOOR', cv), cell_id.inputs['Y'])
    nb.link(info.outputs['Random'], cell_id.inputs['Z'])
    nb.link(cell_id.outputs[0], wn.inputs['Vector'])
    lit = math_node(nb, 'GREATER_THAN', wn.outputs['Value'], 0.62)
    n = noise(nb, 0.5, 6, 0.6, co)
    wall = mix_color(nb, info.outputs['Random'], wall_a, wall_b)
    wall = mix_color(nb, map_range(nb, n.outputs['Fac'], 0.3, 0.7, 0, 0.25), wall, (0.2, 0.19, 0.17))
    glass = mix_color(nb, wn.outputs['Value'], (0.015, 0.018, 0.022), (0.05, 0.055, 0.06))
    nb.link(mix_color(nb, win, wall, glass), bsdf.inputs['Base Color'])
    nb.link(map_range(nb, win, 0, 1, 0.85, 0.04), bsdf.inputs['Roughness'])
    nb.link(map_range(nb, win, 0, 1, 0.0, 0.6), bsdf.inputs['Metallic'])
    nb.link(bump(nb, n.outputs['Fac'], 0.15, 0.02), bsdf.inputs['Normal'])
    night = _night_value(nb)
    emit = math_node(nb, 'MULTIPLY', math_node(nb, 'MULTIPLY', win, lit), math_node(nb, 'MULTIPLY', night, 2.2))
    wcol = mix_color(nb, wn.outputs['Value'], (1.0, 0.6, 0.3), (1.0, 0.8, 0.55))
    nb.link(wcol, bsdf.inputs['Emission Color'])
    nb.link(emit, bsdf.inputs['Emission Strength'])
    return m


def emissive(name, color, base=(0.1, 0.1, 0.1), k=20.0):
    m, nb, bsdf, out = new_material(name)
    set_inputs(bsdf, base=base, rough=0.4, emit_col=color)
    night = _night_value(nb)
    nb.link(math_node(nb, 'MULTIPLY', night, k), bsdf.inputs['Emission Strength'])
    return m


def leaves(name, a, b):
    m, nb, bsdf, out = new_material(name)
    info = nb.node('ShaderNodeObjectInfo')
    uvn = nb.node('ShaderNodeUVMap')
    sep = nb.node('ShaderNodeSeparateXYZ')
    nb.link(uvn.outputs['UV'], sep.inputs[0])
    # elliptical leaf silhouette inside each quad's 0..1 UV square
    dx = math_node(nb, 'MULTIPLY', math_node(nb, 'SUBTRACT', sep.outputs['X'], 0.5), 2.0)
    dy = math_node(nb, 'MULTIPLY', math_node(nb, 'SUBTRACT', sep.outputs['Y'], 0.5), 3.2)
    d = math_node(nb, 'ADD', math_node(nb, 'MULTIPLY', dx, dx), math_node(nb, 'MULTIPLY', dy, dy))
    alpha = math_node(nb, 'LESS_THAN', d, 1.0)
    attr = nb.node('ShaderNodeAttribute', attribute_name='leafvar')
    c = mix_color(nb, attr.outputs['Fac'], a, b)
    c = mix_color(nb, map_range(nb, info.outputs['Random'], 0, 1, 0, 0.35), c, (0.14, 0.12, 0.03))
    nb.link(c, bsdf.inputs['Base Color'])
    nb.link(alpha, bsdf.inputs['Alpha'])
    set_inputs(bsdf, rough=0.6, sss=0.0)
    # translucency via mix with translucent BSDF
    tr = nb.node('ShaderNodeBsdfTranslucent')
    nb.link(c, tr.inputs['Color'])
    mixs = nb.node('ShaderNodeMixShader')
    mixs.inputs['Fac'].default_value = 0.3
    nb.link(bsdf.outputs[0], mixs.inputs[1])
    nb.link(tr.outputs[0], mixs.inputs[2])
    transparent = nb.node('ShaderNodeBsdfTransparent')
    mask = nb.node('ShaderNodeMixShader')
    nb.link(alpha, mask.inputs['Fac'])
    nb.link(transparent.outputs[0], mask.inputs[1])
    nb.link(mixs.outputs[0], mask.inputs[2])
    nb.link(mask.outputs[0], out.inputs['Surface'])
    return m


def safety_net():
    m, nb, bsdf, out = new_material('SafetyNet')
    co = tex_coord(nb, 'Object')
    sep = nb.node('ShaderNodeSeparateXYZ')
    nb.link(co, sep.inputs[0])
    u = math_node(nb, 'FRACT', math_node(nb, 'MULTIPLY', math_node(nb, 'ADD', sep.outputs['X'], sep.outputs['Y']), 10.0))
    v = math_node(nb, 'FRACT', math_node(nb, 'MULTIPLY', sep.outputs['Z'], 10.0))
    line = math_node(nb, 'MAXIMUM', math_node(nb, 'LESS_THAN', u, 0.16), math_node(nb, 'LESS_THAN', v, 0.16))
    set_inputs(bsdf, base=(0.75, 0.55, 0.05), rough=0.7)
    transparent = nb.node('ShaderNodeBsdfTransparent')
    mix = nb.node('ShaderNodeMixShader')
    nb.link(line, mix.inputs['Fac'])
    nb.link(transparent.outputs[0], mix.inputs[1])
    nb.link(bsdf.outputs[0], mix.inputs[2])
    nb.link(mix.outputs[0], out.inputs['Surface'])
    return m


def plywood():
    m, nb, bsdf, out = new_material('Plywood')
    co = tex_coord(nb, 'Object')
    w = nb.node('ShaderNodeTexWave')
    w.inputs['Scale'].default_value = 3.0
    w.inputs['Distortion'].default_value = 6.0
    nb.link(co, w.inputs['Vector'])
    c = mix_color(nb, w.outputs['Fac'], (0.42, 0.24, 0.1), (0.55, 0.34, 0.15))
    nb.link(c, bsdf.inputs['Base Color'])
    set_inputs(bsdf, rough=0.7)
    return m


def water():
    m, nb, bsdf, out = new_material('Water')
    co = tex_coord(nb, 'Object')
    set_inputs(bsdf, base=(0.01, 0.02, 0.025), rough=0.03, spec=0.5)
    nb.link(bump(nb, noise(nb, 3, 3, 0.5, co).outputs['Fac'], 0.08, 0.02), bsdf.inputs['Normal'])
    return m


# ------------------------------------------------------------------ aerial perspective
def build_haze_group():
    g = bpy.data.node_groups.new('AerialHaze', 'ShaderNodeTree')
    g.interface.new_socket('Fac', in_out='OUTPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket('Color', in_out='OUTPUT', socket_type='NodeSocketColor')
    nodes, links = g.nodes, g.links
    gout = nodes.new('NodeGroupOutput')
    cam = nodes.new('ShaderNodeCameraData')
    dens = nodes.new('ShaderNodeValue')
    dens.name = 'density'
    dens.outputs[0].default_value = 0.002
    col = nodes.new('ShaderNodeRGB')
    col.name = 'color'
    col.outputs[0].default_value = (0.6, 0.65, 0.72, 1)
    lp = nodes.new('ShaderNodeLightPath')
    mul = nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    links.new(cam.outputs['View Distance'], mul.inputs[0])
    links.new(dens.outputs[0], mul.inputs[1])
    neg = nodes.new('ShaderNodeMath'); neg.operation = 'MULTIPLY'; neg.inputs[1].default_value = -1.0
    links.new(mul.outputs[0], neg.inputs[0])
    ex = nodes.new('ShaderNodeMath'); ex.operation = 'EXPONENT'
    links.new(neg.outputs[0], ex.inputs[0])
    one = nodes.new('ShaderNodeMath'); one.operation = 'SUBTRACT'; one.inputs[0].default_value = 1.0
    links.new(ex.outputs[0], one.inputs[1])
    camray = nodes.new('ShaderNodeMath'); camray.operation = 'MULTIPLY'
    links.new(one.outputs[0], camray.inputs[0])
    links.new(lp.outputs['Is Camera Ray'], camray.inputs[1])
    cap = nodes.new('ShaderNodeMath'); cap.operation = 'MINIMUM'; cap.inputs[1].default_value = 0.92
    links.new(camray.outputs[0], cap.inputs[0])
    links.new(cap.outputs[0], gout.inputs['Fac'])
    links.new(col.outputs[0], gout.inputs['Color'])
    CONTROLS['haze_density'] = dens.outputs[0]
    CONTROLS['haze_color'] = col.outputs[0]
    return g


def apply_haze(materials, group):
    for m in materials:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        if not out.inputs['Surface'].links:
            continue
        src = out.inputs['Surface'].links[0].from_socket
        gnode = nt.nodes.new('ShaderNodeGroup')
        gnode.node_tree = group
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(gnode.outputs['Color'], em.inputs['Color'])
        em.inputs['Strength'].default_value = 1.0
        CONTROLS.setdefault('haze_emit', []).append(em.inputs['Strength'])
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(gnode.outputs['Fac'], mix.inputs['Fac'])
        nt.links.new(src, mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs['Surface'])


def build_all():
    M = {}
    M['concrete'] = concrete()
    M['terrain'] = terrain()
    M['grass'] = grass_ground()
    M['asphalt'] = asphalt()
    M['sidewalk'] = pavers('Sidewalk', (0.4, 0.4), (0.33, 0.32, 0.3), (0.38, 0.37, 0.35))
    M['plaza'] = pavers('Plaza', (0.6, 0.3), (0.5, 0.47, 0.42), (0.58, 0.55, 0.5))
    M['curb'] = simple('Curb', (0.45, 0.44, 0.42), 0.8, noise_amt=0.2, bump_amt=0.1)
    M['marking'] = simple('Marking', (0.75, 0.74, 0.7), 0.6, noise_amt=0.3)
    M['yellow'] = machine_paint('PaintYellow', (0.62, 0.38, 0.02))
    M['white_paint'] = machine_paint('PaintWhite', (0.7, 0.7, 0.68))
    M['crane'] = machine_paint('CranePaint', (0.66, 0.42, 0.03))
    M['steel'] = simple('Steel', (0.08, 0.08, 0.085), 0.45, 0.8, noise_amt=0.3)
    M['rubber'] = simple('Rubber', (0.025, 0.025, 0.025), 0.85, noise_amt=0.3, bump_amt=0.1)
    M['chrome'] = simple('Chrome', (0.8, 0.8, 0.8), 0.12, 1.0)
    M['rebar'] = simple('Rebar', (0.22, 0.12, 0.07), 0.55, 0.7, noise_amt=0.5)
    M['membrane'] = simple('Membrane', (0.02, 0.02, 0.022), 0.45)
    M['stone'] = stone()
    M['frame'] = simple('Frame', (0.07, 0.055, 0.045), 0.35, 0.9)
    M['glass'] = thin_glass('Glass')
    M['rail_glass'] = thin_glass('RailGlass', tint=(0.85, 0.92, 0.93), transp=0.96)
    M['vehicle_glass'] = thin_glass('VehicleGlass', tint=(0.2, 0.22, 0.24), transp=0.5)
    M['interior'] = interior()
    M['plywood'] = plywood()
    M['net'] = safety_net()
    M['hoarding'] = simple('Hoarding', (0.03, 0.032, 0.035), 0.45, 0.2, noise_amt=0.15)
    M['brass'] = simple('Brass', (0.6, 0.42, 0.18), 0.3, 1.0)
    M['ink'] = simple('Ink', (0.75, 0.72, 0.66), 0.5)
    M['cabin'] = simple('Cabin', (0.06, 0.065, 0.07), 0.5, 0.4, noise_amt=0.2)
    M['bark'] = simple('Bark', (0.09, 0.07, 0.05), 0.9, noise_amt=0.5, bump_amt=0.3, noise_scale=8)
    M['leaf_a'] = leaves('LeavesA', (0.04, 0.08, 0.015), (0.09, 0.13, 0.03))
    M['leaf_b'] = leaves('LeavesB', (0.06, 0.09, 0.02), (0.12, 0.14, 0.04))
    M['hedge'] = simple('Hedge', (0.035, 0.06, 0.015), 0.85, noise_amt=0.5, bump_amt=0.8, noise_scale=6)
    M['city_panel'] = city_facade('CityPanel', (0.26, 0.25, 0.23), (0.36, 0.33, 0.29))
    M['city_plaster'] = city_facade('CityPlaster', (0.42, 0.3, 0.19), (0.3, 0.29, 0.33), 0.42, 0.48)
    M['city_trim'] = simple('CityTrim', (0.34, 0.33, 0.31), 0.8, noise_amt=0.35, bump_amt=0.1, noise_scale=1.5)
    M['city_brick'] = city_facade('CityBrick', (0.32, 0.14, 0.08), (0.38, 0.18, 0.1), 0.4, 0.5)
    M['city_modern'] = city_facade('CityModern', (0.12, 0.12, 0.13), (0.2, 0.2, 0.21), 0.8, 0.66)
    M['roof'] = simple('Roof', (0.12, 0.115, 0.11), 0.9, noise_amt=0.4, bump_amt=0.2)
    M['lamp'] = emissive('LampHead', (1.0, 0.72, 0.42), k=40)
    M['red_light'] = emissive('AviationLight', (1.0, 0.08, 0.02), base=(0.3, 0.02, 0.01), k=30)
    M['water'] = water()
    M['ridge'] = simple('Ridge', (0.1, 0.11, 0.1), 0.9, noise_amt=0.5, noise_scale=0.01)
    haze = build_haze_group()
    apply_haze([m for k, m in M.items() if k not in ('glass', 'rail_glass', 'vehicle_glass', 'net', 'leaf_a', 'leaf_b')], haze)
    return M
