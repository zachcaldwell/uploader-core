import '@fontsource-variable/bricolage-grotesque/wdth.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '../../src/element/element.css';
import '../../src/element/index.ts';
import type { CompleteDetail } from '../../src/element/index.ts';

const MB = 1024 * 1024;
const GB = 1024 * MB;

// The demo's bucket ------------------------------------------------------------------------------

const BUCKET = 'demo-bucket/';

/**
 * Where service workers run, one stands in for the bucket (`public/sw.js`). Where they don't
 * (a sandboxed frame, some private windows), the page does it itself: see `fakeBucket`.
 */
const bucketReady: Promise<void> = (async () => {
	try {
		// A worker that's refused may say so, or may simply never become ready: wait 3s at most.
		await Promise.race([
			useServiceWorker(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('No service worker')), 3000))
		]);
	} catch {
		fakeBucket();
	}
})();

async function useServiceWorker() {
	await navigator.serviceWorker.register('sw.js');
	await navigator.serviceWorker.ready;
	// The first visit isn't controlled until the worker claims the page.
	if (!navigator.serviceWorker.controller) {
		await new Promise((resolve) =>
			navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
		);
	}
}

const demo = document.querySelector('photo-upload')!;
// What a presign endpoint would do, done in the page: the target is the stand-in bucket.
demo.presign = async (request) => {
	await bucketReady;
	return {
		url: new URL(`${BUCKET}${crypto.randomUUID()}`, location.href).href,
		method: 'PUT',
		headers: { 'Content-Type': request.contentType },
		key: `demo/${request.name ?? 'photo'}`
	};
};

/**
 * The bucket, in the page: an XMLHttpRequest to it never goes out, but reports progress over
 * about half a second and then a 200, and stops if aborted. Every other request is untouched.
 */
function fakeBucket() {
	type Demo = XMLHttpRequest & { demoTimer?: ReturnType<typeof setTimeout>; isDemo?: boolean };
	const { open, send, abort } = XMLHttpRequest.prototype;

	XMLHttpRequest.prototype.open = function (this: Demo, method: string, url: string | URL) {
		this.isDemo = new URL(url, location.href).pathname.includes(`/${BUCKET}`);
		// eslint-disable-next-line prefer-rest-params
		return open.apply(this, arguments as unknown as Parameters<typeof open>);
	};

	XMLHttpRequest.prototype.send = function (this: Demo, body) {
		if (!this.isDemo) return send.call(this, body);
		const total = body instanceof Blob ? body.size : 0;
		let step = 0;
		const tick = () => {
			step++;
			const loaded = Math.min(total, Math.round((total * step) / 8));
			this.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded, total }));
			if (step < 8) {
				this.demoTimer = setTimeout(tick, 60);
				return;
			}
			Object.defineProperty(this, 'status', { value: 200 });
			this.dispatchEvent(new ProgressEvent('load'));
			this.dispatchEvent(new ProgressEvent('loadend'));
		};
		this.demoTimer = setTimeout(tick, 60);
	};

	XMLHttpRequest.prototype.abort = function (this: Demo) {
		if (!this.isDemo) return abort.call(this);
		clearTimeout(this.demoTimer);
		this.dispatchEvent(new ProgressEvent('abort'));
		this.dispatchEvent(new ProgressEvent('loadend'));
	};
}

// The ruler --------------------------------------------------------------------------------------

const totals = { photos: 0, original: 0, uploaded: 0 };
const ruler = document.getElementById('ruler')!;
const uploadedBar = document.getElementById('ruler-uploaded')!;
const savedBar = document.getElementById('ruler-saved')!;
const caption = document.getElementById('ruler-caption')!;

const size = (bytes: number) =>
	bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

demo.addEventListener('complete', (event) => {
	const { bytes, originalBytes } = (event as CustomEvent<CompleteDetail>).detail;
	totals.photos++;
	totals.original += originalBytes;
	totals.uploaded += bytes;

	const share = totals.uploaded / totals.original;
	uploadedBar.style.width = `${share * 100}%`;
	savedBar.style.width = `${(1 - share) * 100}%`;
	ruler.removeAttribute('data-empty');
	document.getElementById('ruler-max')!.textContent = size(totals.original);

	const photos = totals.photos === 1 ? '1 photo' : `${totals.photos} photos`;
	const saved = Math.round((1 - share) * 100);
	caption.textContent =
		saved > 0
			? `${photos}: ${size(totals.original)} in, ${size(totals.uploaded)} uploaded. ${saved}% lighter.`
			: `${photos}: already small at ${size(totals.original)}, so uploaded as they were.`;

	useMeasuredSizes();
});

// The calculator ---------------------------------------------------------------------------------

const PRICES = {
	s3: { storage: 0.023, egress: 0.09 },
	r2: { storage: 0.015, egress: 0 }
} as const;

const form = document.getElementById('calc') as HTMLFormElement;
const out = (name: string) => form.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
const money = (dollars: number) =>
	dollars.toLocaleString('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: dollars < 100 ? 2 : 0
	});

/** A year's bill for photos of `bytes` each. Photos are kept, so month m stores m months' worth. */
function yearCost(bytes: number, uploads: number, views: number, provider: keyof typeof PRICES) {
	const { storage, egress } = PRICES[provider];
	const monthGB = (uploads * bytes) / GB;
	const storageCost = monthGB * storage * (12 * 13) / 2; // 1 + 2 + … + 12 months' worth
	const deliveryCost = ((views * bytes) / GB) * egress * 12;
	return { storage: storageCost, delivery: deliveryCost, total: storageCost + deliveryCost };
}

function calculate() {
	const data = new FormData(form);
	const num = (name: string) => Math.max(0, Number(data.get(name)) || 0);
	const provider = data.get('provider') as keyof typeof PRICES;
	const raw = yearCost(num('original') * MB, num('uploads'), num('views'), provider);
	const small = yearCost(num('compressed') * 1024, num('uploads'), num('views'), provider);

	out('storage-raw').textContent = money(raw.storage);
	out('storage-small').textContent = money(small.storage);
	out('delivery-raw').textContent = money(raw.delivery);
	out('delivery-small').textContent = money(small.delivery);
	out('total-raw').textContent = money(raw.total);
	out('total-small').textContent = money(small.total);
	const saved = raw.total - small.total;
	out('saved').textContent =
		saved > 0 ? `${money(saved)} less in the first year.` : 'No savings at these sizes.';
}

/** Once the demo has measured real photos, the calculator uses their averages. */
function useMeasuredSizes() {
	const original = form.elements.namedItem('original') as HTMLInputElement;
	const compressed = form.elements.namedItem('compressed') as HTMLInputElement;
	original.value = (totals.original / totals.photos / MB).toFixed(1);
	compressed.value = String(Math.round(totals.uploaded / totals.photos / 1024));
	document.getElementById('calc-source')!.textContent =
		`The sizes are your photos' averages from the demo above. Change any number to match your app.`;
	calculate();
}

form.addEventListener('input', calculate);
form.addEventListener('submit', (e) => e.preventDefault());
calculate();
