import { expect, test, type Page, type Route } from '@playwright/test';

declare global {
	interface Window {
		uploaderCore: typeof import('../src/index.ts');
	}
}

const BUNDLE = new URL('./.bundle/uploader-core.js', import.meta.url).pathname;
const APP = 'https://app.test';
const PUT_URL = `${APP}/bucket/u/1.webp?X-Amz-Signature=abc`;

interface Seen {
	presign: unknown[];
	puts: { contentType: string | null; bytes: number }[];
}

/**
 * Serves a blank page at APP, a presign endpoint at /presign answering with a target at
 * PUT_URL, and the bucket, which answers each PUT with the next of `statuses` (then 200).
 */
async function serve(page: Page, statuses: number[] = []): Promise<Seen> {
	const seen: Seen = { presign: [], puts: [] };
	await page.route(`${APP}/`, (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title>' })
	);
	await page.route(`${APP}/presign`, async (route) => {
		seen.presign.push(route.request().postDataJSON());
		await route.fulfill({
			json: {
				url: PUT_URL,
				method: 'PUT',
				headers: { 'Content-Type': 'image/webp' },
				key: 'u/1.webp'
			}
		});
	});
	await page.route(`${APP}/bucket/**`, async (route: Route) => {
		const request = route.request();
		seen.puts.push({
			contentType: await request.headerValue('content-type'),
			bytes: request.postDataBuffer()?.length ?? 0
		});
		await route.fulfill({ status: statuses.shift() ?? 200, body: '' });
	});
	await page.goto(`${APP}/`);
	await page.addScriptTag({ path: BUNDLE });
	return seen;
}

/** Uploads 2,000 bytes from the page, reporting the result, the error and the progress seen. */
function run(page: Page, options: { retries?: number; abortBefore?: boolean } = {}) {
	return page.evaluate(async ({ retries, abortBefore }) => {
		const file = new File([new Uint8Array(2000)], 'pic.webp', { type: 'image/webp' });
		const progress: number[] = [];
		const controller = new AbortController();
		if (abortBefore) controller.abort();
		try {
			const result = await window.uploaderCore.upload(file, {
				presign: '/presign',
				presignHeaders: { Authorization: 'Bearer t' },
				onProgress: (p) => progress.push(p),
				signal: controller.signal,
				retries
			});
			return { result, progress };
		} catch (e) {
			const error = e as Error & { status?: number };
			return { error: { name: error.name, status: error.status }, progress };
		}
	}, options);
}

test('presigns, then puts the file with the signed headers', async ({ page }) => {
	const seen = await serve(page);
	const out = await run(page);

	expect(out.result).toEqual({ key: 'u/1.webp', bytes: 2000, type: 'image/webp' });
	expect(seen.presign).toEqual([{ contentType: 'image/webp', size: 2000, name: 'pic.webp' }]);
	expect(seen.puts).toEqual([{ contentType: 'image/webp', bytes: 2000 }]);
	expect(out.progress.at(-1)).toBe(1);
});

test('sends its own headers with the presign request', async ({ page }) => {
	await serve(page);
	const auth = page.waitForRequest(`${APP}/presign`);
	await run(page);
	expect(await (await auth).headerValue('authorization')).toBe('Bearer t');
});

test('retries a 5xx, without presigning again', async ({ page }) => {
	const seen = await serve(page, [500]);
	const out = await run(page);

	expect(out.result?.key).toBe('u/1.webp');
	expect(seen.presign).toHaveLength(1);
	expect(seen.puts).toHaveLength(2);
});

test('gives up once its retries are spent', async ({ page }) => {
	const seen = await serve(page, [503, 503, 503]);
	const out = await run(page, { retries: 2 });

	expect(out.error).toEqual({ name: 'UploadError', status: 503 });
	expect(seen.puts).toHaveLength(3);
});

test("doesn't retry a refusal", async ({ page }) => {
	const seen = await serve(page, [403]);
	const out = await run(page);

	expect(out.error).toEqual({ name: 'UploadError', status: 403 });
	expect(seen.puts).toHaveLength(1);
});

test('stops before asking anything once aborted', async ({ page }) => {
	const seen = await serve(page);
	const out = await run(page, { abortBefore: true });

	expect(out.error?.name).toBe('AbortError');
	expect(seen.presign).toHaveLength(0);
	expect(seen.puts).toHaveLength(0);
});

test('reports a refused presign with its status', async ({ page }) => {
	await serve(page);
	await page.route(`${APP}/presign`, (route) => route.fulfill({ status: 401, body: '' }));
	const out = await run(page);

	expect(out.error).toEqual({ name: 'UploadError', status: 401 });
});

test('takes a presign function in place of a URL', async ({ page }) => {
	const seen = await serve(page);
	const result = await page.evaluate(async (url) => {
		const file = new File([new Uint8Array(10)], 'x.webp', { type: 'image/webp' });
		return window.uploaderCore.upload(file, {
			presign: async (request) => ({
				url,
				method: 'PUT',
				headers: { 'Content-Type': request.contentType },
				key: `k/${request.size}`
			})
		});
	}, PUT_URL);

	expect(result.key).toBe('k/10');
	expect(seen.presign).toHaveLength(0);
	expect(seen.puts).toEqual([{ contentType: 'image/webp', bytes: 10 }]);
});

test('aborts mid-upload without retrying', async ({ page }) => {
	const seen = await serve(page);
	await page.route(`${APP}/bucket/**`, async (route) => {
		seen.puts.push({ contentType: null, bytes: 0 });
		await new Promise((r) => setTimeout(r, 2000));
		await route.fulfill({ status: 200, body: '' }).catch(() => {});
	});
	const name = await page.evaluate(async () => {
		const file = new File([new Uint8Array(10)], 'x.webp', { type: 'image/webp' });
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 200);
		try {
			await window.uploaderCore.upload(file, { presign: '/presign', signal: controller.signal });
			return 'finished';
		} catch (e) {
			return (e as Error).name;
		}
	});

	expect(name).toBe('AbortError');
	expect(seen.puts).toHaveLength(1);
});
