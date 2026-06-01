"""Generate minimal solid-colour PNG icons using Python stdlib only."""
import struct, zlib
from pathlib import Path

ICONS_DIR = Path(__file__).parent.parent / "docs" / "icons"

def make_png(w, h, r, g, b):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    raw  = b''.join(b'\x00' + bytes([r, g, b] * w) for _ in range(h))
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

def run():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    # BookKit accent colour: purple #7c3aed → 124, 58, 237
    bg = (124, 58, 237)
    for name, size in [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]:
        (ICONS_DIR / name).write_bytes(make_png(size, size, *bg))
        print(f"Written {ICONS_DIR / name} ({size}×{size})")

if __name__ == "__main__":
    run()
