// The demo's bucket: takes the uploads that would go to S3 or R2 and keeps nothing, so the
// visitor's photos never leave their browser. Presigning happens in the page; only the PUT
// comes here.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin || !url.pathname.includes('/demo-bucket/')) return;
	if (event.request.method !== 'PUT') return;
	event.respondWith(
		event.request.arrayBuffer().then(() => new Response(null, { status: 200 }))
	);
});
