# uploader-core

_Working name._ Resizes and compresses images in the browser before they're uploaded. Pica does the
downscaling; the canvas does the encoding. Pulled out of Do//Eat's `compressImage.ts`.

```ts
import { compress } from 'uploader-core';

const small = await compress(file, { maxWidth: 2048, maxHeight: 2048, quality: 0.8, format: 'webp' });
```

`compress` never throws on a bad file. A file that isn't an image, or that the browser can't decode,
comes back as the same `File` object, so `out === file` tells you nothing ran.

## Options

| Option      | Default   | What it does                                                                 |
| ----------- | --------- | ---------------------------------------------------------------------------- |
| `maxWidth`  | `1200`    | The output fits inside `maxWidth` × `maxHeight`, keeping its aspect ratio. It's never scaled up. |
| `maxHeight` | `1200`    |                                                                              |
| `quality`   | `0.85`    | JPEG/WebP quality, from 0 to 1.                                              |
| `maxBytes`  | `500_000` | An image already inside the box and under this size is passed through untouched. `0` always re-encodes. |
| `format`    | (source)  | `'jpeg'`, `'png'` or `'webp'`. If unset, it keeps the source's type when canvas can encode it, otherwise it uses JPEG. WebP falls back to JPEG where the browser can't encode it. |

## Behavior

- **Orientation:** decoding goes through an `<img>`, which applies EXIF orientation, so phone photos
  come out upright.
- **Metadata:** re-encoding drops EXIF, including GPS.
- **Transparency:** a PNG stays a PNG and keeps its alpha channel unless you ask for JPEG.
- **HEIC:** a browser that can decode it (Safari) gets a JPEG back. Other browsers get the file back unchanged.
- **Never worse:** if an image is already inside the box, it's only re-encoded when that makes it
  smaller. Otherwise you get the original back.
- **Lazy:** Pica is loaded on the first `compress()` call.

## Development

```sh
npm install
npm run check          # types
npm run test:unit      # node --test
npm run test:browser   # bundles with esbuild, runs Playwright on test/fixtures
sh test/make-fixtures.sh   # regenerate fixtures (ImageMagick + Pillow)
```
