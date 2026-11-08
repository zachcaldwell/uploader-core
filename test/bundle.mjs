// Bundles the package (pica included) into one script the browser tests inject.
import { build } from 'esbuild';

await build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	format: 'iife',
	globalName: 'uploaderCore',
	outfile: 'test/.bundle/uploader-core.js',
	logLevel: 'warning'
});
