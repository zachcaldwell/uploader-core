import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { presignS3, PresignRefused, type S3Config } from './presignS3.ts';

const aws: S3Config = {
	bucket: 'photos',
	region: 'us-west-2',
	accessKeyId: 'AKID',
	secretAccessKey: 'secret'
};
const r2: S3Config = {
	...aws,
	region: 'auto',
	endpoint: 'https://acct.r2.cloudflarestorage.com/'
};
const request = { contentType: 'image/webp', size: 120_000 };

describe('presignS3', () => {
	it('addresses AWS by bucket subdomain', async () => {
		const target = await presignS3(aws, { key: 'u/1.webp', request, maxBytes: 1_000_000 });
		const url = new URL(target.url);
		assert.equal(url.host, 'photos.s3.us-west-2.amazonaws.com');
		assert.equal(url.pathname, '/u/1.webp');
		assert.deepEqual(target.headers, { 'Content-Type': 'image/webp' });
		assert.equal(target.method, 'PUT');
		assert.equal(target.key, 'u/1.webp');
	});

	it('addresses an S3-compatible endpoint by path', async () => {
		const target = await presignS3(r2, { key: 'u/1.webp', request, maxBytes: 1_000_000 });
		const url = new URL(target.url);
		assert.equal(url.host, 'acct.r2.cloudflarestorage.com');
		assert.equal(url.pathname, '/photos/u/1.webp');
		assert.match(url.searchParams.get('X-Amz-Credential')!, /\/auto\/s3\/aws4_request$/);
	});

	it('signs the type and the exact size', async () => {
		const target = await presignS3(aws, { key: 'k', request, maxBytes: 1_000_000 });
		assert.equal(
			new URL(target.url).searchParams.get('X-Amz-SignedHeaders'),
			'content-length;content-type;host'
		);
	});

	it('refuses a file over the limit', async () => {
		await assert.rejects(
			presignS3(aws, { key: 'k', request, maxBytes: 100_000 }),
			PresignRefused
		);
	});

	it('refuses anything but an image by default', async () => {
		await assert.rejects(
			presignS3(aws, {
				key: 'k',
				request: { contentType: 'text/html', size: 10 },
				maxBytes: 1_000_000
			}),
			PresignRefused
		);
	});

	it('refuses a missing or made-up size', async () => {
		for (const size of [0, -1, 1.5, NaN]) {
			await assert.rejects(
				presignS3(aws, { key: 'k', request: { ...request, size }, maxBytes: 1_000_000 }),
				PresignRefused
			);
		}
	});
});
