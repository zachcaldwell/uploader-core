import type { Pica } from 'pica';
import { fitWithin } from './fit.ts';

// Loaded with the first photo rather than up front: only compressing one needs it.
let pica: Promise<Pica> | undefined;
const loadPica = () => (pica ??= import('pica').then(({ default: createPica }) => createPica()));

export type OutputFormat = 'jpeg' | 'png' | 'webp';

/** Types canvas can re-encode. Anything else decodable (HEIC on iOS) becomes JPEG. */
const ENCODABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

const EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};

export interface CompressOptions {
	maxWidth?: number;
	maxHeight?: number;
	/** JPEG/WebP quality 0–1. */
	quality?: number;
	/** Images already within bounds and under this are passed through untouched. */
	maxBytes?: number;
	/**
	 * What to encode to. Unset keeps the source's type when canvas can encode it, else JPEG.
	 * WebP falls back to JPEG in a browser that can't encode it.
	 */
	format?: OutputFormat;
}

/**
 * Resize an image file down to fit within maxWidth × maxHeight (aspect preserved)
 * and re-encode it, returning a new File. Runs in the browser via canvas + pica.
 *
 * Safe to call on any File: non-images, and images the browser can't decode, are
 * returned unchanged rather than throwing — an upload should never fail because
 * compression couldn't run. So is an image that re-encoding at its own size would
 * only make bigger.
 */
export async function compress(
	file: File,
	{
		maxWidth = 1200,
		maxHeight = 1200,
		quality = 0.85,
		maxBytes = 500_000,
		format
	}: CompressOptions = {}
): Promise<File> {
	if (!file.type.startsWith('image/')) return file;

	let img: HTMLImageElement;
	try {
		img = await loadImage(file);
	} catch {
		return file;
	}

	// The <img> has already applied EXIF orientation, so these are the upright dimensions.
	const { naturalWidth, naturalHeight } = img;
	const withinBounds = naturalWidth <= maxWidth && naturalHeight <= maxHeight;

	// Small enough already — re-encoding would only cost quality.
	if (withinBounds && file.size <= maxBytes) return file;

	const { width, height } = fitWithin(naturalWidth, naturalHeight, maxWidth, maxHeight);

	const sourceCanvas = document.createElement('canvas');
	sourceCanvas.width = naturalWidth;
	sourceCanvas.height = naturalHeight;
	sourceCanvas.getContext('2d')?.drawImage(img, 0, 0);

	const destCanvas = document.createElement('canvas');
	destCanvas.width = width;
	destCanvas.height = height;

	const resizer = await loadPica();
	await resizer.resize(sourceCanvas, destCanvas, {
		quality: 3,
		unsharpAmount: 20,
		unsharpRadius: 0.6,
		unsharpThreshold: 2
	});

	// Canvas silently falls back to PNG for a type it can't encode, so pick the
	// target explicitly, check what came back, and name the file to match.
	const wanted = format
		? `image/${format}`
		: ENCODABLE.has(file.type)
			? file.type
			: 'image/jpeg';
	let blob = await resizer.toBlob(destCanvas, wanted, quality);
	if (blob.type !== wanted) blob = await resizer.toBlob(destCanvas, 'image/jpeg', quality);

	// Same size and no smaller: the original is the better file.
	if (withinBounds && blob.size >= file.size) return file;

	const name = blob.type === file.type ? file.name : renamed(file.name, blob.type);
	return new File([blob], name, { type: blob.type });
}

function renamed(name: string, type: string): string {
	return `${name.replace(/\.[^.]+$/, '')}.${EXTENSIONS[type] ?? 'jpg'}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = document.createElement('img');
		const url = URL.createObjectURL(file);
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = (e) => {
			URL.revokeObjectURL(url);
			reject(e);
		};
		img.src = url;
	});
}
