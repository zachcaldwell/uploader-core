import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { CompressOptions } from '../src';

declare global {
	interface Window {
		uploaderCore: typeof import('../src');
	}
}

const BUNDLE = new URL('./.bundle/uploader-core.js', import.meta.url).pathname;
const fixture = (name: string) =>
	readFileSync(new URL(`./fixtures/${name}`, import.meta.url)).toString('base64');

interface Outcome {
	same: boolean;
	name: string;
	type: string;
	bytes: number;
	originalBytes: number;
	width?: number;
	height?: number;
	/** Alpha of the output's top-left pixel, where a PNG should stay transparent. */
	cornerAlpha?: number;
}

/** Compresses a fixture in the page and reports what came back. */
async function run(
	page: Page,
	name: string,
	type: string,
	options?: CompressOptions
): Promise<Outcome> {
	return page.evaluate(
		async ({ base64, name, type, options }) => {
			const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
			const file = new File([bytes], name, { type });
			const out = await window.uploaderCore.compress(file, options);
			const outcome: Outcome = {
				same: out === file,
				name: out.name,
				type: out.type,
				bytes: out.size,
				originalBytes: file.size
			};
			try {
				const bitmap = await createImageBitmap(out);
				outcome.width = bitmap.width;
				outcome.height = bitmap.height;
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(bitmap, 0, 0);
				outcome.cornerAlpha = ctx.getImageData(0, 0, 1, 1).data[3];
			} catch {
				// Not decodable (the corrupt fixture): dimensions stay unset.
			}
			return outcome;
		},
		{ base64: fixture(name), name, type, options }
	);
}

test.beforeEach(async ({ page }) => {
	await page.setContent('<!doctype html><title>uploader-core</title>');
	await page.addScriptTag({ path: BUNDLE });
});

test('turns a phone photo upright and fits it', async ({ page }) => {
	const out = await run(page, 'rotated.jpg', 'image/jpeg');
	expect(out.same).toBe(false);
	expect(out).toMatchObject({ width: 900, height: 1200, type: 'image/jpeg', name: 'rotated.jpg' });
	expect(out.bytes).toBeLessThan(out.originalBytes);
});

test('fits a panorama by its long side', async ({ page }) => {
	const out = await run(page, 'panorama.jpg', 'image/jpeg');
	expect(out).toMatchObject({ width: 1200, height: 200 });
});

test('keeps a PNG transparent', async ({ page }) => {
	const out = await run(page, 'alpha.png', 'image/png');
	expect(out).toMatchObject({ type: 'image/png', width: 1200, height: 1200, cornerAlpha: 0 });
});

test('encodes to WebP when asked, renaming to match', async ({ page }) => {
	const out = await run(page, 'rotated.jpg', 'image/jpeg', { format: 'webp' });
	expect(out).toMatchObject({ type: 'image/webp', name: 'rotated.webp', width: 900 });
});

test('passes an already small image through untouched', async ({ page }) => {
	const out = await run(page, 'tiny.jpg', 'image/jpeg');
	expect(out.same).toBe(true);
});

test("keeps the original when re-encoding it would only make it bigger", async ({ page }) => {
	const out = await run(page, 'crushed.jpg', 'image/jpeg', { quality: 0.95, maxBytes: 0 });
	expect(out.same).toBe(true);
});

test('hands back a file it cannot decode instead of throwing', async ({ page }) => {
	const out = await run(page, 'corrupt.jpg', 'image/jpeg');
	expect(out.same).toBe(true);
});

test('leaves files that are not images alone', async ({ page }) => {
	const out = await run(page, 'corrupt.jpg', 'application/pdf');
	expect(out.same).toBe(true);
});
