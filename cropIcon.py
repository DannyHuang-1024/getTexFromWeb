# resize_icons.py
from pathlib import Path
from PIL import Image

SIZES = [16, 32, 48, 128]

def main():
    src = Path("resources/icon.png") 
    out_dir = src.parent               

    if not src.exists():
        raise FileNotFoundError(f"Icon not found: {src.resolve()}")

    out_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(src).convert("RGBA")

    for s in SIZES:
        w, h = img.size
        scale = max(s / w, s / h)
        nw, nh = int(round(w * scale)), int(round(h * scale))
        resized = img.resize((nw, nh), Image.LANCZOS)

        left = (nw - s) // 2
        top = (nh - s) // 2
        cropped = resized.crop((left, top, left + s, top + s))

        out_path = out_dir / f"icon_{s}.png"
        cropped.save(out_path, optimize=True)
        print("saved:", out_path)

if __name__ == "__main__":
    main()
