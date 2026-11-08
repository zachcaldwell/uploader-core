#!/usr/bin/env sh
# Regenerates test/fixtures with ImageMagick. The output is committed.
set -e
cd "$(dirname "$0")"
mkdir -p fixtures

# Stored 4000x3000 landscape, tagged "rotate 90° clockwise" (EXIF orientation 6),
# the way a phone held upright saves it: it should come out 900x1200 portrait.
# (ImageMagick doesn't write the EXIF tag itself, so Pillow does.)
python3 - <<'EOF'
from PIL import Image
img = Image.linear_gradient('L').resize((4000, 3000)).convert('RGB')
exif = Image.Exif()
exif[0x0112] = 6  # Orientation
img.save('fixtures/rotated.jpg', quality=90, exif=exif)
EOF

# A panorama far past the box on one side only.
convert -size 12000x2000 gradient:green-yellow -quality 90 fixtures/panorama.jpg

# A PNG whose transparency has to survive: transparent, with an opaque disc.
convert -size 2000x2000 xc:none -fill '#ff6600' -draw 'circle 1000,1000 1000,300' fixtures/alpha.png

# Already small, in both pixels and bytes.
convert -size 100x100 gradient:white-black -quality 85 fixtures/tiny.jpg

# Small in pixels, but heavily compressed: re-encoding it at 0.95 only makes it bigger.
convert -size 600x400 plasma:fractal -quality 10 fixtures/crushed.jpg

# Says it's a JPEG, isn't one.
head -c 2048 /dev/urandom > fixtures/corrupt.jpg
