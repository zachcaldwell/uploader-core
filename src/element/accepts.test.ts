import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accepts } from './accepts.ts';

const jpeg = { name: 'Pic.JPG', type: 'image/jpeg' };
const heic = { name: 'IMG_0001.HEIC', type: '' };
const pdf = { name: 'menu.pdf', type: 'application/pdf' };

describe('accepts', () => {
	it('takes a wildcard', () => {
		assert.equal(accepts(jpeg, 'image/*'), true);
		assert.equal(accepts(pdf, 'image/*'), false);
	});

	it('takes an exact type', () => {
		assert.equal(accepts(jpeg, 'image/png, image/jpeg'), true);
		assert.equal(accepts(jpeg, 'image/png'), false);
	});

	it('takes an extension, whatever its case, when the type is unknown', () => {
		assert.equal(accepts(heic, 'image/*,.heic'), true);
		assert.equal(accepts(heic, 'image/*'), false);
	});

	it('takes anything with no list', () => {
		assert.equal(accepts(pdf, ''), true);
		assert.equal(accepts(pdf, ' , '), true);
	});
});
