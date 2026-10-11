"""Render the construction sequence as numbered frames for the scroll player.

Run with Blender's Python module (pip install bpy==5.2.2) or with Blender itself:
    python render/render.py --frames 180 --width 1280 --height 720 --samples 48 --out frames
    blender -b -P render/render.py -- --frames 240 --width 1920 --height 1080 --samples 256 --gpu
Frames already on disk are skipped, so an interrupted render can simply be restarted.
"""
import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import materials  # noqa: E402
from lib import track, srng  # noqa: E402
from scene import Scene, camera_at, T  # noqa: E402


def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', type=int, default=180)
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=720)
    ap.add_argument('--samples', type=int, default=48)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frames'))
    ap.add_argument('--only', default='', help='comma-separated progress values to render as stills (preview mode)')
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--end', type=int, default=-1)
    ap.add_argument('--step', type=int, default=1, help='render every Nth frame (draft pass)')
    ap.add_argument('--gpu', action='store_true')
    ap.add_argument('--format', default='WEBP', choices=['WEBP', 'JPEG', 'PNG'])
    ap.add_argument('--save-blend', default='')
    return ap.parse_args(argv)


# time-of-day arc (same as the website): sunrise → noon → golden hour → blue hour
SUN = dict(
    elev=[(0, 9), (0.12, 16), (0.3, 38), (0.55, 48), (0.76, 26), (0.87, 9), (0.94, 2.2), (1, -1.2)],
    azim=[(0, 28), (0.5, 82), (0.8, 142), (1, 158)],
    strength=[(0, 4.6), (0.4, 6.0), (0.78, 5.4), (0.88, 3.6), (0.95, 0.9), (1, 0.0)],
    color=[(0, (1, 0.7, 0.46)), (0.12, (1, 0.84, 0.7)), (0.3, (1, 0.95, 0.9)), (0.6, (1, 0.96, 0.92)), (0.8, (1, 0.82, 0.62)), (0.92, (1, 0.6, 0.36)), (1, (1, 0.5, 0.3))],
    sky=[(0, 0.4), (0.15, 0.28), (0.5, 0.22), (0.85, 0.28), (0.95, 0.42), (1, 0.6)],
    exposure=[(0, 0.25), (0.12, -0.3), (0.3, -0.55), (0.5, -0.65), (0.82, -0.55), (0.93, -0.3), (1, 0.15)],
    haze=[(0, (0.78, 0.64, 0.52)), (0.15, (0.66, 0.68, 0.72)), (0.5, (0.6, 0.68, 0.8)), (0.82, (0.75, 0.66, 0.58)), (0.93, (0.4, 0.33, 0.33)), (1, (0.08, 0.09, 0.14))],
    haze_k=[(0, 0.0015), (0.5, 0.0014), (1, 0.0026)],
    haze_e=[(0, 0.32), (0.5, 0.34), (0.85, 0.3), (0.95, 0.2), (1, 0.1)],
)


def setup_render(a):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    if a.gpu:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type == kind for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = True
                    cy.device = 'GPU'
                    break
            except TypeError:
                continue
    cy.samples = a.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.03
    cy.use_denoising = True
    try:
        cy.denoiser = 'OPENIMAGEDENOISE'
    except TypeError:
        pass
    cy.max_bounces = 6
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 3
    cy.transmission_bounces = 4
    cy.transparent_max_bounces = 24
    cy.volume_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    cy.sample_clamp_indirect = 8.0
    sc.render.use_persistent_data = True
    sc.render.resolution_x = a.width
    sc.render.resolution_y = a.height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Punchy'
    except TypeError:
        try:
            sc.view_settings.view_transform = 'Filmic'
        except TypeError:
            pass
    st = sc.render.image_settings
    st.file_format = a.format
    if a.format in ('WEBP', 'JPEG'):
        st.quality = 82
    st.color_mode = 'RGB'


def setup_camera():
    cam_data = bpy.data.cameras.new('Camera')
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.clip_start = 0.3
    cam_data.clip_end = 6000
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 8.0
    cam = bpy.data.objects.new('Camera', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def pose(world, cam, p, t):
    night = world.animate(p, t)
    sc = bpy.context.scene
    # camera
    pos, target, fov = camera_at(p)
    pos, target = Vector(pos), Vector(target)
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
    cam.data.angle_y = math.radians(fov)
    cam.data.dof.focus_distance = (target - pos).length
    # sun + sky
    el, az = math.radians(track(SUN['elev'], p)), math.radians(track(SUN['azim'], p))
    d = Vector((math.cos(az) * math.cos(el), -math.sin(az) * math.cos(el), math.sin(el)))
    sun = world.dyn['sun']
    sun.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    sun.data.energy = track(SUN['strength'], p)
    sun.data.color = track(SUN['color'], p)
    sky = world.dyn['sky']
    if hasattr(sky, 'sun_direction') and sky.sky_type in ('PREETHAM', 'HOSEK_WILKIE'):
        sky.sun_direction = d
    else:
        sky.sun_elevation = el
        # Blender's sky rotation is measured clockwise from +Y around Z
        sky.sun_rotation = math.atan2(d.x, d.y) % math.tau
    world.dyn['sky_bg'].inputs['Strength'].default_value = track(SUN['sky'], p)
    sc.view_settings.exposure = track(SUN['exposure'], p)
    # emissives + haze
    for n in materials.NIGHT_NODES:
        n.outputs[0].default_value = night
    C = materials.CONTROLS
    C['haze_color'].default_value = (*track(SUN['haze'], p), 1)
    C['haze_density'].default_value = track(SUN['haze_k'], p)
    for s in C.get('haze_emit', []):
        s.default_value = track(SUN['haze_e'], p)


def main():
    a = parse()
    t0 = time.time()
    # start from an empty scene
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for x in list(coll):
            coll.remove(x)
    setup_render(a)
    M = materials.build_all()
    world = Scene(M)
    for o in bpy.data.objects:  # concrete defaults to cured; animate() sets freshness per element
        o.color = (0, 0, 0, 1)
    cam = setup_camera()
    print(f'scene built in {time.time() - t0:.1f}s, {len(bpy.data.objects)} objects', flush=True)
    if a.save_blend:
        pose(world, cam, 0.6, 0)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save_blend))
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    ext = {'WEBP': 'webp', 'JPEG': 'jpg', 'PNG': 'png'}[a.format]
    if a.only:
        jobs = [(float(v), os.path.join(out, f'still_{float(v):.3f}.{ext}')) for v in a.only.split(',')]
    else:
        end = a.frames if a.end < 0 else min(a.frames, a.end)
        jobs = [(i / (a.frames - 1), os.path.join(out, f'f{i:04d}.{ext}')) for i in range(a.start, end, a.step)]
    for idx, (p, path) in enumerate(jobs):
        if os.path.exists(path):
            continue
        t1 = time.time()
        pose(world, cam, p, p * 400.0)
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f'[{idx + 1}/{len(jobs)}] p={p:.3f} -> {os.path.basename(path)} in {time.time() - t1:.1f}s', flush=True)


if __name__ == '__main__':
    main()
