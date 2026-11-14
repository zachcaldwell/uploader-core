// Builds the site into site/dist: the page, its script and fonts (esbuild), its Tailwind CSS,
// and the demo's service worker. `--serve` also serves it on http://localhost:4173.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { build } from 'esbuild';

const root = new URL('.', import.meta.url).pathname;
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
	entryPoints: [join(root, 'src/main.ts')],
	bundle: true,
	format: 'esm',
	minify: true,
	outdir: dist,
	entryNames: 'main',
	assetNames: 'fonts/[name]-[hash]',
	loader: { '.woff2': 'file', '.woff': 'file' },
	logLevel: 'warning'
});

execFileSync(
	'npx',
	['@tailwindcss/cli', '-i', join(root, 'src/app.css'), '-o', join(dist, 'app.css'), '--minify'],
	{ stdio: ['ignore', 'ignore', 'inherit'] }
);

copyFileSync(join(root, 'index.html'), join(dist, 'index.html'));
copyFileSync(join(root, 'public/sw.js'), join(dist, 'sw.js'));

if (process.argv.includes('--serve')) {
	const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
	createServer(async (req, res) => {
		const path = new URL(req.url, 'http://x').pathname;
		try {
			const body = await readFile(join(dist, path === '/' ? 'index.html' : path));
			res.writeHead(200, { 'Content-Type': types[extname(path) || '.html'] ?? 'application/octet-stream' });
			res.end(body);
		} catch {
			res.writeHead(404).end();
		}
	}).listen(4173, () => console.log('http://localhost:4173'));
}
