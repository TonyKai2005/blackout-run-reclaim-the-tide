"""Copy approved title art and original audio into the offline web package."""

from pathlib import Path
from shutil import copy2
from PIL import Image


PROJECT = Path(__file__).resolve().parents[3]
ASSETS = PROJECT / "Web/public/assets"
HERO = ASSETS / "hero"
AUDIO = ASSETS / "audio"
SOURCE_ART = Path(__file__).resolve().parent / "source"
APPROVED_IMAGE = Path(
    "D:/codex-official-clean/generated_images/"
    "01a0dc7f-e289-7482-89a1-eb0f8ce8328c/"
    "exec-9b682712-b962-4dce-916a-c67eba5aed1c.png"
)

SFX = [
    "pod_burst", "seed_repeater", "trash_hit", "sorter_start",
    "water_pump", "wind_restart", "recovery_pad_loop",
    "robot_alert", "robot_servo_loop", "grab", "release", "hurt",
    "metal_impact", "power_on", "checkpoint", "drone_scan",
    "extract", "foot_metal_1", "foot_metal_2", "foot_metal_3",
    "foot_metal_4", "land",
]


def main() -> None:
    HERO.mkdir(parents=True, exist_ok=True)
    AUDIO.mkdir(parents=True, exist_ok=True)
    SOURCE_ART.mkdir(parents=True, exist_ok=True)
    source_copy = SOURCE_ART / "daylight-keyart-source.png"
    if not source_copy.is_file():
        if not APPROVED_IMAGE.is_file():
            raise FileNotFoundError(f"Approved title art missing: {APPROVED_IMAGE}")
        copy2(APPROVED_IMAGE, source_copy)
    with Image.open(source_copy) as image:
        image.convert("RGB").save(
            HERO / "daylight-keyart.webp", "WEBP", quality=89,
            method=6,
        )
    sfx_root = PROJECT / "Assets/BlackoutRun/Resources/Audio/Sfx"
    for name in SFX:
        copy2(sfx_root / f"{name}.wav", AUDIO / f"{name}.wav")
    copy2(
        PROJECT / "Assets/BlackoutRun/Resources/Audio/Music/StormCurrent.ogg",
        AUDIO / "StormCurrent.ogg",
    )
    print("COPIED", len(SFX), "sound effects, 1 music loop, 1 optimized title image")


if __name__ == "__main__":
    main()
