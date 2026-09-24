"""Inspect the supplied 8-bit RGBA PNG with only Python's standard library."""
import struct
import zlib
from collections import Counter
from pathlib import Path

p = Path('assets/elote-ranchero.png').read_bytes()
offset = 8
compressed = bytearray()
while offset < len(p):
    size = struct.unpack('>I', p[offset:offset+4])[0]
    kind = p[offset+4:offset+8]
    payload = p[offset+8:offset+8+size]
    if kind == b'IHDR':
        w, h, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', payload)
    if kind == b'IDAT':
        compressed.extend(payload)
    offset += size + 12
assert (depth, color, interlace) == (8, 6, 0), 'Expected non-interlaced 8-bit RGBA'
raw = zlib.decompress(compressed)
stride = w * 4
previous = bytearray(stride)
counts = Counter()
samples = {}
hole_alpha = {'left_eye': [], 'right_eye': [], 'mouth': []}
for y in range(h):
    start = y * (stride + 1)
    mode = raw[start]
    row = bytearray(raw[start+1:start+1+stride])
    for x in range(stride):
        a = row[x-4] if x >= 4 else 0
        b = previous[x]
        c = previous[x-4] if x >= 4 else 0
        if mode == 1: v = a
        elif mode == 2: v = b
        elif mode == 3: v = (a+b)//2
        elif mode == 4:
            pred = a+b-c
            pa, pb, pc = abs(pred-a), abs(pred-b), abs(pred-c)
            v = a if pa <= pb and pa <= pc else b if pb <= pc else c
        else: v = 0
        row[x] = (row[x]+v) & 255
    counts.update(row[3::4])
    for name, (sx, sy) in {'background':(0,0), 'left_eye':(390,705), 'right_eye':(645,705), 'mouth':(515,923)}.items():
        if y == sy: samples[name] = row[sx*4+3]
        if name in hole_alpha and abs(y-sy) <= 8:
            hole_alpha[name].extend(row[(sx-8)*4+3:(sx+9)*4:4])
    previous = row
print(f'{w}x{h}, RGBA; alpha min={min(counts)}, max={max(counts)}; fully transparent={counts[0]}')
print(f'Alpha samples (0 transparent, 255 opaque): {samples}')
print(f'Max alpha in 17x17 hole centers: { {k:max(v) for k,v in hole_alpha.items()} }')
