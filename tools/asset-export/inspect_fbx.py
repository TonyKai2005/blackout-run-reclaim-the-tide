"""Print FBX object and material metadata without changing source assets."""

import bpy
from pathlib import Path

root = Path(__file__).resolve().parents[3]
for category, name in [
    ("Weapons", "PodBurst"),
    ("Actors", "TideHeap"),
    ("Environment", "BatteryModule"),
    ("Structures", "SortingConveyor"),
]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = root / "Assets/BlackoutRun/Resources/Models" / category / f"{name}.fbx"
    bpy.ops.import_scene.fbx(filepath=str(path))
    print("ASSET", name)
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            print("  MESH", obj.name, [m.name for m in obj.data.materials])
        elif obj.type == "EMPTY":
            print("  EMPTY", obj.name, tuple(obj.location))
