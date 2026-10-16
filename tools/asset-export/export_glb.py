"""Export the original game's curated FBXs to compact, textured glTF binaries.

Run via Blender from the BlackoutRun folder after prepare_textures.py. The input
FBX files are read only. Output is Web/public/assets/models on D:.
"""

import bpy
import json
import sys
from mathutils import Vector
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[3]
SOURCE = PROJECT / "Assets/BlackoutRun/Resources/Models"
CACHE = Path(__file__).resolve().parent / "cache/textures"
OUTPUT = PROJECT / "Web/public/assets/models"
OUTPUT.mkdir(parents=True, exist_ok=True)

ASSETS = [
    ("Weapons", "PodBurst"),
    ("Weapons", "SeedRepeater"),
    ("Actors", "TrashCleaner_A"),
    ("Actors", "TrashCleaner_B"),
    ("Actors", "TideHeap"),
    ("Actors", "MothDrone"),
    ("Structures", "SortingConveyor"),
    ("Structures", "CargoContainer"),
    ("Structures", "RescueCrane"),
    ("Structures", "RescueLaunch"),
    ("Environment", "WasteBundle"),
    ("Environment", "IntakeFilter"),
    ("Environment", "FilterFrame"),
    ("Environment", "BatteryModule"),
    ("Environment", "ControlModule"),
    ("Environment", "WindModule"),
    ("Environment", "ServiceTerminal"),
    ("Environment", "WindTurbine"),
]


def image_node(nodes, path: Path, non_color: bool = False):
    if not path.is_file():
        return None
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    node = nodes.new("ShaderNodeTexImage")
    node.image = image
    return node


def attach_pbr(material: bpy.types.Material, cleaner_variant: bool = False) -> tuple[str, list[str], bool]:
    name = material.name
    prefix = name.removeprefix("BRPBR_")
    if name.startswith("BR_") and name.endswith("_PBR"):
        prefix = name[3:-4]
    source_color = tuple(material.diffuse_color)
    missing = []
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    links = material.node_tree.links
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = source_color
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["Roughness"].default_value = 0.65
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    variant = "cleaner_" if cleaner_variant else ""
    base_path = CACHE / f"{variant}{prefix}_BaseColor.jpg"
    base = image_node(nodes, base_path)
    if base:
        shader.inputs["Base Color"].default_value = (1, 1, 1, 1)
        links.new(base.outputs["Color"], shader.inputs["Base Color"])
    elif name.startswith("BRPBR_") or name.startswith("BR_"):
        missing.append(str(base_path))

    orm_path = CACHE / f"{variant}{prefix}_ORM.jpg"
    orm = image_node(nodes, orm_path, non_color=True)
    if orm:
        split = nodes.new("ShaderNodeSeparateColor")
        split.mode = "RGB"
        links.new(orm.outputs["Color"], split.inputs["Color"])
        links.new(split.outputs[1], shader.inputs["Roughness"])
        links.new(split.outputs[2], shader.inputs["Metallic"])
    elif name.startswith("BRPBR_") or name.startswith("BR_"):
        missing.append(str(orm_path))
    else:
        shader.inputs["Metallic"].default_value = 0.7 if any(
            token in name.lower() for token in ("steel", "alloy", "metal")
        ) else 0.0
        shader.inputs["Roughness"].default_value = 0.35 if "glass" in name.lower() else 0.55

    normal_path = CACHE / f"{prefix}_Normal.jpg"
    normal = image_node(nodes, normal_path, non_color=True)
    if normal:
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = 0.85
        links.new(normal.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])

    emission = image_node(nodes, CACHE / f"{prefix}_Emission.jpg")
    if emission:
        links.new(emission.outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = 1.0
    elif cleaner_variant and base and prefix in ("Reclaim_OpticCyan", "Reclaim_HazardRed"):
        # The scanner and warning accents should read even when they face away
        # from the sun. Reuse the base map rather than adding a new texture.
        links.new(base.outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = (
            0.9 if prefix == "Reclaim_OpticCyan" else 0.28
        )
    return prefix, missing, base is None


def gltf_position(point: Vector) -> list[float]:
    return [round(point.x, 5), round(point.z, 5), round(-point.y, 5)]


def process(category: str, name: str) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = SOURCE / category / f"{name}.fbx"
    if not path.is_file():
        return {"name": name, "error": "missing FBX", "source": str(path)}
    bpy.ops.import_scene.fbx(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        return {"name": name, "error": "no mesh"}
    # Unity's importer added .001 to some pivots. Restore stable names for web code.
    for obj in bpy.context.scene.objects:
        if obj.type == "EMPTY" and obj.name.endswith(".001"):
            obj.name = obj.name[:-4]
    bpy.context.view_layer.update()

    material_names = set()
    missing_maps = []
    fallback_materials = []
    for obj in meshes:
        for material in obj.data.materials:
            if material and material.name not in material_names:
                material_names.add(material.name)
                _, missing, fallback = attach_pbr(
                    material, cleaner_variant=name.startswith("TrashCleaner_")
                )
                missing_maps.extend(missing)
                if fallback:
                    fallback_materials.append(material.name)

    # FBX n-gons can prevent the glTF exporter from writing tangent vectors.
    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new("WebTriangulate", "TRIANGULATE")
        modifier.quad_method = "BEAUTY"
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    world_points = [obj.matrix_world @ Vector(corner)
                    for obj in meshes for corner in obj.bound_box]
    bounds = [gltf_position(point) for point in world_points]
    minimum = [round(min(point[axis] for point in bounds), 5) for axis in range(3)]
    maximum = [round(max(point[axis] for point in bounds), 5) for axis in range(3)]
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    pivots = {
        obj.name: gltf_position(obj.matrix_world.translation)
        for obj in bpy.context.scene.objects if obj.type == "EMPTY"
    }
    output_path = OUTPUT / f"{name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        export_yup=True,
        export_normals=True,
        export_tangents=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=True,
    )
    result = {
        "name": name,
        "path": f"/assets/models/{name}.glb",
        "bytes": output_path.stat().st_size,
        "triangles": triangles,
        "boundsMinXYZ": minimum,
        "boundsMaxXYZ": maximum,
        "sizeMetresXYZ": [round(maximum[i] - minimum[i], 5) for i in range(3)],
        "pivotsXYZ": pivots,
        "materials": sorted(material_names),
        "missingPbrMaps": missing_maps,
        "fallbackMaterials": fallback_materials,
        "front": "+Z",
        "up": "+Y",
    }
    print("EXPORTED", name, round(result["bytes"] / 1024 / 1024, 2), "MiB", flush=True)
    return result


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = args[args.index("--only") + 1] if "--only" in args else None
    entries = [(category, name) for category, name in ASSETS if not only or name == only]
    if not entries:
        raise ValueError(f"Unknown model: {only}")
    results = [process(category, name) for category, name in entries]
    manifest_path = OUTPUT / "manifest.json"
    if only and manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["models"] = [
            results[0] if model["name"] == only else model
            for model in manifest["models"]
        ]
    else:
        manifest = {"coordinateSystem": "+Y up, +Z front", "models": results}
        # A browser-only character is built directly from its editable Blender
        # source and therefore has no Unity FBX to re-import here.
        if manifest_path.is_file():
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["models"].extend(
                model for model in previous.get("models", [])
                if (model.get("name", "").startswith("IslandTechnician")
                    or model.get("name") == "EngineerPlayer")
                and (OUTPUT / f"{model['name']}.glb").is_file()
            )
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if any("error" in result or result["missingPbrMaps"] for result in results):
        raise RuntimeError("Missing model or required PBR maps; inspect manifest")


if __name__ == "__main__":
    main()
