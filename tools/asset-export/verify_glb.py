"""Static integrity check for the browser GLB bundle; no game window is opened."""

import json
import struct
from pathlib import Path


MODELS = Path(__file__).resolve().parents[2] / "public/assets/models"
EXPECTED_PIVOTS = {
    "PodBurst": ["Muzzle"],
    "SeedRepeater": ["Muzzle"],
    "TrashCleaner_A": ["Head"],
    "TrashCleaner_B": ["Head"],
    "IslandTechnician": ["Pelvis", "Torso", "Head", "Arm_Left", "Arm_Right", "Leg_Left", "Leg_Right"],
    "IslandTechnician_Green": ["Pelvis", "Torso", "Head", "Arm_Left", "Arm_Right", "Leg_Left", "Leg_Right"],
    "IslandTechnician_Orange": ["Pelvis", "Torso", "Head", "Arm_Left", "Arm_Right", "Leg_Left", "Leg_Right"],
    "EngineerPlayer": ["Pelvis", "Torso", "Head", "Arm_Left", "Arm_Right", "Leg_Left", "Leg_Right"],
    "TideHeap": ["Node_Left", "Node_Right", "RecycleLever"],
    "WindTurbine": ["Rotor"],
}


def inspect(path: Path) -> dict:
    with path.open("rb") as stream:
        magic, version, length = struct.unpack("<4sII", stream.read(12))
        assert magic == b"glTF" and version == 2 and length == path.stat().st_size
        json_length, chunk_type = struct.unpack("<II", stream.read(8))
        assert chunk_type == 0x4E4F534A
        document = json.loads(stream.read(json_length))
        binary_length, binary_type = struct.unpack("<II", stream.read(8))
        assert binary_type == 0x004E4942 and binary_length > 0
    names = {node.get("name") for node in document.get("nodes", [])}
    for pivot in EXPECTED_PIVOTS.get(path.stem, []):
        assert pivot in names, (path.name, "missing pivot", pivot)
    assert document.get("meshes") and document.get("materials")
    assert all(
        "POSITION" in primitive.get("attributes", {})
        and "NORMAL" in primitive.get("attributes", {})
        and "material" in primitive
        for mesh in document["meshes"] for primitive in mesh["primitives"]
    ), path.name
    if path.stem != "MothDrone":
        assert all(
            "baseColorTexture" in material.get("pbrMetallicRoughness", {})
            and "metallicRoughnessTexture" in material.get("pbrMetallicRoughness", {})
            and "normalTexture" in material
            for material in document["materials"]
        ), path.name
    if path.stem.startswith("TrashCleaner_"):
        image_names = {image.get("name") for image in document.get("images", [])}
        for material in document["materials"]:
            prefix = material["name"].removeprefix("BRPBR_")
            assert f"cleaner_{prefix}_BaseColor" in image_names, (path.name, prefix)
            assert f"cleaner_{prefix}_ORM" in image_names, (path.name, prefix)
            if prefix in ("Reclaim_OpticCyan", "Reclaim_HazardRed"):
                assert material.get("emissiveTexture"), (path.name, prefix)
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "meshCount": len(document["meshes"]),
        "materialCount": len(document["materials"]),
        "imageCount": len(document.get("images", [])),
    }


def main() -> None:
    manifest = json.loads((MODELS / "manifest.json").read_text(encoding="utf-8"))
    records = [inspect(MODELS / f"{model['name']}.glb")
               for model in manifest["models"]]
    assert all(model["bytes"] == record["bytes"]
               for model, record in zip(manifest["models"], records))
    assert all(not model["missingPbrMaps"] for model in manifest["models"])
    report = {"status": "PASS", "models": records,
              "totalGlbBytes": sum(record["bytes"] for record in records)}
    target = Path(__file__).resolve().parent / "validation.json"
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("PASS", len(records), "GLBs", round(report["totalGlbBytes"] / 2**20, 2), "MiB")


if __name__ == "__main__":
    main()
