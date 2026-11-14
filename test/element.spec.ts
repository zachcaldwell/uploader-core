import { expect, test, type Page } from '@playwright/test';

const BUNDLE = new URL('./.bundle/uploader-core.js', import.meta.url).pathname;
const CSS = new URL('../src/element/element.css', import.meta.url).pathname;
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const APP = 'https://app.test';

interface Bucket {
	puts: number;
}

/**
 * A page at APP with the bundle (and the default stylesheet) loaded and `body` as given, a
 * presign endpoint handing out a key per request, and a bucket answering each PUT with the
 * next of `statuses` (then 200) after `delay` ms.
 */
async function serve(page: Page, body: string, statuses: number[] = [], delay = 0) {
	const bucket: Bucket = { puts: 0 };
	let n = 0;
	await page.route(`${APP}/`, (route) =>
		route.fulfill({ contentType: 'text/html', body: `<!doctype html><body>${body}</body>` })
	);
	await page.route(`${APP}/presign`, (route) => {
		n++;
		return route.fulfill({
			json: {
				url: `${APP}/bucket/${n}`,
				method: 'PUT',
				headers: { 'Content-Type': route.request().postDataJSON().contentType },
				key: `uploads/${n}`
			}
		});
	});
	await page.route(`${APP}/bucket/**`, async (route) => {
		bucket.puts++;
		if (delay) await new Promise((r) => setTimeout(r, delay));
		await route.fulfill({ status: statuses.shift() ?? 200, body: '' }).catch(() => {});
	});
	await page.goto(`${APP}/`);
	await page.addStyleTag({ path: CSS });
	await page.addScriptTag({ path: BUNDLE });
	// Every event the element fires, in order, for the tests to read back.
	await page.evaluate(() => {
		const el = document.querySelector('photo-upload')!;
		const log: unknown[] = ((window as unknown as { log: unknown[] }).log = []);
		for (const type of ['add', 'complete', 'error']) {
			el.addEventListener(type, (e) => {
				const { file, error, ...rest } = (e as CustomEvent).detail;
				log.push({ event: type, name: file.name, ...(error && { error: String(error.message) }), ...rest });
			});
		}
	});
	return bucket;
}

const events = (page: Page) =>
	page.evaluate(() => (window as unknown as { log: Record<string, unknown>[] }).log);

test('renders its parts in the light DOM, keeping its children as the prompt', async ({ page }) => {
	await serve(page, '<photo-upload presign="/presign"><b>Add a photo</b></photo-upload>');
	const el = page.locator('photo-upload');

	expect(await el.evaluate((node) => node.shadowRoot)).toBeNull();
	await expect(el).toHaveAttribute('data-state', 'idle');
	await expect(el).toHaveAttribute('data-count', '0');
	await expect(el.locator('[data-part=dropzone] [data-part=prompt] b')).toHaveText('Add a photo');
	await expect(el.locator('[data-part=input]')).toHaveAttribute('accept', 'image/*');
});

test('compresses and uploads what is picked, then reports where it went', async ({ page }) => {
	const bucket = await serve(page, '<photo-upload presign="/presign" multiple></photo-upload>');
	await page
		.locator('[data-part=input]')
		.setInputFiles([fixture('rotated.jpg'), fixture('panorama.jpg')]);

	const rows = page.locator('[data-part=file]');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toHaveAttribute('data-state', 'done');
	await expect(rows.nth(1)).toHaveAttribute('data-state', 'done');
	await expect(page.locator('photo-upload')).toHaveAttribute('data-state', 'idle');
	await expect(rows.nth(0).locator('[data-part=thumb]')).toBeVisible();

	const complete = (await events(page)).filter((e) => e.event === 'complete');
	expect(complete.map((e) => e.key).sort()).toEqual(['uploads/1', 'uploads/2']);
	for (const e of complete) expect(e.bytes as number).toBeLessThan(e.originalBytes as number);
	expect(bucket.puts).toBe(2);
});

test('turns away a file it does not accept, before uploading anything', async ({ page }) => {
	const bucket = await serve(page, '<photo-upload presign="/presign"></photo-upload>');
	await page.locator('photo-upload').evaluate((el) =>
		(el as HTMLElementTagNameMap['photo-upload']).add([
			new File(['x'], 'notes.txt', { type: 'text/plain' })
		])
	);

	expect(await events(page)).toEqual([
		{ event: 'error', name: 'notes.txt', error: "notes.txt isn't an accepted type" }
	]);
	await expect(page.locator('[data-part=file]')).toHaveCount(0);
	expect(bucket.puts).toBe(0);
});

test('holds no more than max-files', async ({ page }) => {
	await serve(page, '<photo-upload presign="/presign" multiple max-files="1"></photo-upload>');
	await page
		.locator('[data-part=input]')
		.setInputFiles([fixture('tiny.jpg'), fixture('crushed.jpg')]);

	await expect(page.locator('[data-part=file]')).toHaveCount(1);
	const errors = (await events(page)).filter((e) => e.event === 'error');
	expect(errors).toEqual([{ event: 'error', name: 'crushed.jpg', error: 'No more than 1 files' }]);
});

test('shows Retry on a failed upload, and retrying finishes it', async ({ page }) => {
	await serve(page, '<photo-upload presign="/presign"></photo-upload>', [403]);
	await page.locator('[data-part=input]').setInputFiles(fixture('tiny.jpg'));

	const row = page.locator('[data-part=file]');
	await expect(row).toHaveAttribute('data-state', 'error');
	const retry = row.locator('[data-part=retry]');
	await expect(retry).toBeVisible();

	await retry.click();
	await expect(row).toHaveAttribute('data-state', 'done');
	await expect(retry).toBeHidden();
});

test('takes a dropped file, marking itself while one is dragged over', async ({ page }) => {
	await serve(page, '<photo-upload presign="/presign"></photo-upload>');
	const el = page.locator('photo-upload');
	const transfer = await page.evaluateHandle(() => {
		const dt = new DataTransfer();
		dt.items.add(new File([new Uint8Array(8)], 'drop.png', { type: 'image/png' }));
		return dt;
	});

	await el.dispatchEvent('dragover', { dataTransfer: transfer });
	await expect(el).toHaveAttribute('data-state', 'dragging');
	await el.dispatchEvent('drop', { dataTransfer: transfer });

	await expect(page.locator('[data-part=file]')).toHaveAttribute('data-state', /.+/);
	await expect(el).not.toHaveAttribute('data-state', 'dragging');
	expect((await events(page))[0]).toEqual({ event: 'add', name: 'drop.png' });
});

test('removing a file mid-upload stops it, with no error', async ({ page }) => {
	await serve(page, '<photo-upload presign="/presign"></photo-upload>', [], 3000);
	await page.locator('[data-part=input]').setInputFiles(fixture('tiny.jpg'));

	const row = page.locator('[data-part=file]');
	await expect(row).toHaveAttribute('data-state', 'uploading');
	await row.locator('[data-part=remove]').click();

	await expect(row).toHaveCount(0);
	await expect(page.locator('photo-upload')).toHaveAttribute('data-state', 'idle');
	await expect(page.locator('photo-upload')).toHaveAttribute('data-count', '0');
	expect((await events(page)).filter((e) => e.event === 'error')).toEqual([]);
});

test('looks right with the default stylesheet', async ({ page }) => {
	await page.setViewportSize({ width: 520, height: 320 });
	await serve(page, '<photo-upload presign="/presign" multiple style="margin:1rem"></photo-upload>', [403]);
	await page
		.locator('[data-part=input]')
		.setInputFiles([fixture('rotated.jpg'), fixture('panorama.jpg'), fixture('alpha.png')]);
	await expect(page.locator('[data-part=file][data-state=error]')).toHaveCount(1);
	await expect(page.locator('photo-upload')).toHaveAttribute('data-state', 'idle');
	await page.screenshot({ path: 'test-results/element-default.png' });
});
