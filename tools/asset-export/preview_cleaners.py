"""Render the exported cleaner GLBs for a repeatable, static visual check.

Run with D:\blender.exe --background --factory-startup --python this_file.py.
Output stays in this tool's cache folder on D:.
"""

import bpy
from mathutils import Vector
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "public/assets/models"
PREVIEWS = Path(__file__).resolve().parent / "cache"
PREVIEWS.mkdir(parents=True, exist_ok=True)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / f"{name}.glb"))
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEWS / f"{name}_web_preview.png")
    scene.view_settings.view_transform = "AgX"
    scene.world = bpy.data.worlds.new("Preview sky")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.54, 0.72, 0.77, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7

    floor = bpy.data.materials.new("Preview floor")
    floor.diffuse_color = (0.58, 0.68, 0.7, 1)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0.045))
    bpy.context.object.data.materials.append(floor)

    for location, power, size in [((4, -5, 7), 900, 5), ((-4, 2, 5), 600, 5)]:
        lamp = bpy.data.lights.new("Softbox", "AREA")
        lamp.energy = power
        lamp.shape = "DISK"
        lamp.size = size
        entity = bpy.data.objects.new("Softbox", lamp)
        scene.collection.objects.link(entity)
        entity.location = location
        point_at(entity, (0, 0, 0.9))

    camera = bpy.data.cameras.new("Preview camera")
    camera.type = "ORTHO"
    camera.ortho_scale = 3.35
    entity = bpy.data.objects.new("Preview camera", camera)
    scene.collection.objects.link(entity)
    entity.location = (3.3, -4.6, 2.75)
    point_at(entity, (0, 0, 0.9))
    scene.camera = entity
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath, flush=True)


for model in ("TrashCleaner_A", "TrashCleaner_B"):
    render(model)
