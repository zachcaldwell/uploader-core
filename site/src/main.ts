import '@fontsource-variable/bricolage-grotesque/wdth.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '../../src/element/element.css';
import '../../src/element/index.ts';
import type { CompleteDetail } from '../../src/element/index.ts';

const MB = 1024 * 1024;
const GB = 1024 * MB;

// The demo's bucket ------------------------------------------------------------------------------

const workerReady: Promise<void> =
	'serviceWorker' in navigator
		? navigator.serviceWorker.register('/sw.js').then(async () => {
				await navigator.serviceWorker.ready;
				// The first visit isn't controlled until the worker claims the page.
				if (!navigator.serviceWorker.controller) {
					await new Promise((resolve) =>
						navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
					);
				}
			})
		: Promise.reject(new Error('This browser has no service workers, so the demo can’t upload'));
workerReady.catch(() => {});

const demo = document.querySelector('photo-upload')!;
// What a presign endpoint would do, done in the page: the target is the service worker.
demo.presign = async (request) => {
	await workerReady;
	return {
		url: `/demo-bucket/${crypto.randomUUID()}`,
		method: 'PUT',
		headers: { 'Content-Type': request.contentType },
		key: `demo/${request.name ?? 'photo'}`
	};
};

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
