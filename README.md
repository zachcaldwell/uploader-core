# uploader-core

_Working name._ Compresses images in the browser, then uploads them straight to your own bucket
(S3, Cloudflare R2, or anything S3-compatible). No files pass through your server, and there's no
service in between. Pulled out of Do//Eat.

```ts
import { compress, upload } from 'uploader-core';

const small = await compress(file, { maxWidth: 2048, maxHeight: 2048, quality: 0.8, format: 'webp' });
const { key } = await upload(small, { presign: '/api/presign', onProgress: (p) => (progress = p) });
// Save `key` in your database.
```

Your server needs one small endpoint that signs the upload:

```ts
// e.g. src/routes/api/presign/+server.ts in SvelteKit
import { presignS3, PresignRefused } from 'uploader-core/server';

export async function POST({ request }) {
	try {
		return Response.json(
			await presignS3(
				{ bucket: 'photos', region: 'auto', endpoint: R2_ENDPOINT, accessKeyId, secretAccessKey },
				{ key: `uploads/${crypto.randomUUID()}`, request: await request.json(), maxBytes: 5_000_000 }
			)
		);
	} catch (e) {
		if (e instanceof PresignRefused) return new Response(e.message, { status: 400 });
		throw e;
	}
}
```

Check who's asking before you sign: the endpoint is yours, and so is its auth.

## `compress(file, options?)`

`compress` never throws on a bad file. A file that isn't an image, or that the browser can't decode,
comes back as the same `File` object, so `out === file` tells you nothing ran.

| Option      | Default   | What it does                                                                 |
| ----------- | --------- | ---------------------------------------------------------------------------- |
| `maxWidth`  | `1200`    | The output fits inside `maxWidth` × `maxHeight`, keeping its aspect ratio. It's never scaled up. |
| `maxHeight` | `1200`    |                                                                              |
| `quality`   | `0.85`    | JPEG/WebP quality, from 0 to 1.                                              |
| `maxBytes`  | `500_000` | An image already inside the box and under this size is passed through untouched. `0` always re-encodes. |
| `format`    | (source)  | `'jpeg'`, `'png'` or `'webp'`. If unset, it keeps the source's type when canvas can encode it, otherwise it uses JPEG. WebP falls back to JPEG where the browser can't encode it. |

- **Orientation:** decoding goes through an `<img>`, which applies EXIF orientation, so phone photos
  come out upright.
- **Metadata:** re-encoding drops EXIF, including GPS.
- **Transparency:** a PNG stays a PNG and keeps its alpha channel unless you ask for JPEG.
- **HEIC:** a browser that can decode it (Safari) gets a JPEG back. Other browsers get the file back unchanged.
- **Never worse:** if an image is already inside the box, it's only re-encoded when that makes it
  smaller. Otherwise you get the original back.
- **Lazy:** Pica is loaded on the first `compress()` call.

## `upload(file, options)`

It asks for a presigned target once, then PUTs the file there over XHR, which reports progress
everywhere. It resolves to `{ key, bytes, type }`.

| Option           | What it does                                                                  |
| ---------------- | ----------------------------------------------------------------------------- |
| `presign`        | A URL, which gets a JSON POST of `{ contentType, size, name }` and answers with the target, or a function that returns the target itself. |
| `presignHeaders` | Headers for the presign request, such as `Authorization`.                     |
| `onProgress`     | Called with 0 to 1 as bytes go out.                                           |
| `signal`         | An `AbortSignal`. Aborting stops the upload where it is.                      |
| `retries`        | Tries after the first, default `2`. Only a dropped connection, a 5xx or a 429 is retried, with backoff (0.5s, 1s, …). A refusal (403 and the like) fails at once. |

A failure throws `UploadError`, with `status` set to the HTTP status (absent for a network error).
An abort throws the signal's reason, an `AbortError` by default.

## `presignS3(config, options)` (from `uploader-core/server`)

It makes a presigned PUT, signed with AWS Signature V4 on WebCrypto alone, so it runs on Node,
Deno, Bun and edge runtimes. The signature covers the content type and the exact size the client
declared.

- **`config`:** `{ bucket, region, accessKeyId, secretAccessKey, endpoint? }`. Leave `endpoint` unset
  for AWS. For R2, use `region: 'auto'` and `endpoint: 'https://<account>.r2.cloudflarestorage.com'`.
- **`options`:** `{ key, request, maxBytes, accept?, expiresIn? }`. `request` is what the client sent.
  `accept` defaults to any `image/*`. `expiresIn` defaults to 300 seconds.
- It throws `PresignRefused` for a size over `maxBytes`, a type `accept` turns down, or a missing size.

**Size limits:** S3 refuses a file whose size isn't the one signed. R2 doesn't enforce the signed
size, so there the `maxBytes` check is what holds, and it trusts the size the client declared.

**CORS:** the browser PUTs to the bucket directly, so the bucket has to allow it:

```json
[{ "AllowedOrigins": ["https://your.app"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["Content-Type"] }]
```

Why PUT and not a presigned POST: R2 and Backblaze B2 don't support POST uploads, and one path
covers every provider.

## Development

```sh
npm install
npm run check          # types
npm run test:unit      # node --test: sizing, SigV4 (against AWS's example and the AWS SDK), presignS3
npm run test:browser   # bundles with esbuild, runs Playwright: compress on fixtures, upload against a faked bucket
sh test/make-fixtures.sh   # regenerate fixtures (ImageMagick + Pillow)
```
