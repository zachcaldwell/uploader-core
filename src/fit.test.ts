import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitWithin } from './fit.ts';

describe('fitWithin', () => {
	it('leaves an image already inside the box alone', () => {
		assert.deepEqual(fitWithin(800, 600, 1200, 1200), { width: 800, height: 600 });
	});

	it('scales landscape by its width', () => {
		assert.deepEqual(fitWithin(4000, 3000, 1200, 1200), { width: 1200, height: 900 });
	});

	it('scales portrait by its height', () => {
		assert.deepEqual(fitWithin(3000, 4000, 1200, 1200), { width: 900, height: 1200 });
	});

	it('fits whichever side overflows a non-square box', () => {
		// Wider than tall, but it's the height that's over the box.
		assert.deepEqual(fitWithin(1000, 900, 1200, 600), { width: 667, height: 600 });
	});

	it('never rounds a sliver down to zero', () => {
		assert.deepEqual(fitWithin(20000, 10, 1200, 1200), { width: 1200, height: 1 });
	});
});
