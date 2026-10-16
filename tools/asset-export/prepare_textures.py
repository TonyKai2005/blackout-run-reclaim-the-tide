"""Prepare compact glTF PBR textures from this project's original Unity maps.

All output stays under Web/tools/asset-export/cache on D:. Run with system Python.
"""

from pathlib import Path
from PIL import Image, ImageStat


PROJECT = Path(__file__).resolve().parents[3]
MODEL_ROOT = PROJECT / "Assets/BlackoutRun/Resources/Models"
CACHE = Path(__file__).resolve().parent / "cache/textures"
SOURCE_DIRS = [
    MODEL_ROOT / "Textures",
    MODEL_ROOT / "Environment/Textures",
    MODEL_ROOT / "Structures",
    MODEL_ROOT / "Weapons",
]
RESAMPLE = Image.Resampling.LANCZOS

# A brighter, cleaner-specific palette keeps the two moving robots readable at
# gameplay distance. The source maps and the maps used by other props stay as-is.
CLEANER_PALETTE = {
    "Reclaim_CastIron": (93, 119, 125),
    "Reclaim_DirtyCanvas": (139, 151, 136),
    "Reclaim_ForestCeramic": (132, 174, 148),
    "Reclaim_HazardRed": (229, 91, 68),
    "Reclaim_OpticCyan": (92, 234, 223),
    "Reclaim_Rubber": (52, 68, 71),
    "Reclaim_RustSteel": (167, 103, 78),
    "Reclaim_SafetyOrange": (237, 164, 76),
    "Reclaim_WastePlastic": (138, 169, 174),
    "Reclaim_WetSteel": (132, 157, 164),
}


def source_for(prefix: str, suffix: str) -> Path | None:
    for folder in SOURCE_DIRS:
        candidate = folder / f"{prefix}_{suffix}.png"
        if candidate.is_file():
            return candidate
    return None


def compact(image: Image.Image, maximum: int = 1024) -> Image.Image:
    image = image.copy()
    image.thumbnail((maximum, maximum), RESAMPLE)
    return image


def cleaner_base_color(source: Image.Image, target: tuple[int, int, int]) -> Image.Image:
    """Retint the original map while retaining its per-pixel wear and mottling."""
    mean = ImageStat.Stat(source).mean
    channels = source.split()
    toned = [
        channel.point(lambda value, center=mean[i], base=target[i]:
                      max(0, min(255, round(base + (value - center) * 1.65))))
        for i, channel in enumerate(channels)
    ]
    return Image.merge("RGB", toned)


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    prefixes = sorted(
        {path.name.removesuffix("_BaseColor.png")
         for folder in SOURCE_DIRS
         for path in folder.glob("*_BaseColor.png")}
    )
    for prefix in prefixes:
        base_path = source_for(prefix, "BaseColor")
        packed_path = source_for(prefix, "MetallicSmoothness")
        if not base_path or not packed_path:
            print("SKIP_MISSING_PBR", prefix)
            continue

        with Image.open(base_path) as source:
            # All selected assets use opaque meshes. Atlas transparency outside
            # occupied UV islands is not material transparency.
            base = compact(source.convert("RGB"))
            base.save(
                CACHE / f"{prefix}_BaseColor.jpg", quality=90,
                subsampling=0, optimize=True,
            )
            if prefix in CLEANER_PALETTE:
                cleaner_base_color(base, CLEANER_PALETTE[prefix]).save(
                    CACHE / f"cleaner_{prefix}_BaseColor.jpg", quality=92,
                    subsampling=0, optimize=True,
                )

        with Image.open(packed_path) as source:
            packed = compact(source.convert("RGBA"))
            metallic = packed.getchannel("R")
            roughness = packed.getchannel("A").point(lambda smooth: 255 - smooth)
            white = Image.new("L", packed.size, 255)
            # glTF metallic-roughness: G = roughness, B = metallic.
            Image.merge("RGB", (white, roughness, metallic)).save(
                CACHE / f"{prefix}_ORM.jpg", quality=92, subsampling=0,
                optimize=True,
            )
            if prefix in CLEANER_PALETTE:
                # Reduce the near-black result of highly metallic materials
                # when the game scene has no reflective environment map.
                cleaner_metallic = metallic.point(lambda value: round(value * 0.3))
                cleaner_roughness = roughness.point(lambda value: max(140, value))
                Image.merge("RGB", (white, cleaner_roughness, cleaner_metallic)).save(
                    CACHE / f"cleaner_{prefix}_ORM.jpg", quality=92,
                    subsampling=0, optimize=True,
                )

        normal_path = source_for(prefix, "Normal")
        if normal_path:
            with Image.open(normal_path) as source:
                compact(source.convert("RGB")).save(
                    CACHE / f"{prefix}_Normal.jpg", quality=93,
                    subsampling=0, optimize=True,
                )

        emission_path = source_for(prefix, "Emission")
        if emission_path:
            with Image.open(emission_path) as source:
                compact(source.convert("RGB")).save(
                    CACHE / f"{prefix}_Emission.jpg", quality=87,
                    subsampling=0, optimize=True,
                )

        print("PREPARED", prefix, base.size, flush=True)


if __name__ == "__main__":
    main()
