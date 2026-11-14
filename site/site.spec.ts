import { expect, test } from '@playwright/test';

const fixture = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname;
const shots = (name: string) => new URL(`../test-results/site-${name}.png`, import.meta.url).pathname;

test('the demo uploads through the service worker and weighs what it saved', async ({ page }) => {
	await page.goto('/');
	await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);

	await page
		.locator('photo-upload [data-part=input]')
		.setInputFiles([fixture('rotated.jpg'), fixture('panorama.jpg')]);

	const rows = page.locator('[data-part=file]');
	await expect(rows.nth(0)).toHaveAttribute('data-state', 'done');
	await expect(rows.nth(1)).toHaveAttribute('data-state', 'done');

	const caption = page.locator('#ruler-caption');
	await expect(caption).toContainText('2 photos');
	await expect(caption).toContainText('% lighter');
	const saved = await page.locator('#ruler-saved').evaluate((el) => parseFloat(el.style.width));
	expect(saved).toBeGreaterThan(50);

	// The calculator takes the measured averages.
	await expect(page.locator('#calc-source')).toContainText("your photos' averages");
	await expect(page.locator('[data-out=saved]')).toContainText('less in the first year');
});

test('the calculator matches a worked example', async ({ page }) => {
	await page.goto('/');
	const set = (name: string, value: string) => page.locator(`#calc [name=${name}]`).fill(value);
	// 1,024 photos of 1 MB a month = 1 GB a month: storage is 78 GB-months a year at $0.023,
	// delivery 1,024 views = 1 GB a month for 12 months at $0.09.
	await set('uploads', '1024');
	await set('views', '1024');
	await set('original', '1');
	await expect(page.locator('[data-out=storage-raw]')).toHaveText('$1.79');
	await expect(page.locator('[data-out=delivery-raw]')).toHaveText('$1.08');
	await expect(page.locator('[data-out=total-raw]')).toHaveText('$2.87');

	await page.getByLabel('Cloudflare R2').check();
	await expect(page.locator('[data-out=storage-raw]')).toHaveText('$1.17');
	await expect(page.locator('[data-out=delivery-raw]')).toHaveText('$0.00');
});

test('nothing runs off a phone screen', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 780 });
	await page.goto('/');
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBe(0);
});

test('screenshots', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 860 });
	await page.goto('/');
	await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: shots('hero-empty') });

	await page
		.locator('photo-upload [data-part=input]')
		.setInputFiles([fixture('rotated.jpg'), fixture('panorama.jpg'), fixture('alpha.png')]);
	await expect(page.locator('[data-part=file][data-state=done]')).toHaveCount(3);
	await page.waitForTimeout(600);
	await page.screenshot({ path: shots('hero-used') });
	await page.screenshot({ path: shots('full'), fullPage: true });

	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: shots('phone'), fullPage: true });

	await page.emulateMedia({ colorScheme: 'dark' });
	await page.setViewportSize({ width: 1280, height: 860 });
	await page.waitForTimeout(400); // the default look eases its colors over 120ms
	await page.screenshot({ path: shots('dark') });
});
