import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { presignUrl, uriEncode } from './sigv4.ts';

describe('presignUrl', () => {
	// AWS's own worked example of a presigned URL (Signature Version 4, query-string auth).
	it("matches AWS's documented example", async () => {
		const url = await presignUrl({
			method: 'GET',
			url: 'https://examplebucket.s3.amazonaws.com/test.txt',
			region: 'us-east-1',
			accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
			secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
			expiresIn: 86400,
			date: new Date('2013-05-24T00:00:00Z')
		});
		assert.equal(
			new URL(url).searchParams.get('X-Amz-Signature'),
			'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'
		);
	});

	it('signs the headers it is given, in order', async () => {
		const url = new URL(
			await presignUrl({
				method: 'PUT',
				url: 'https://examplebucket.s3.amazonaws.com/a.jpg',
				region: 'us-east-1',
				accessKeyId: 'AKID',
				secretAccessKey: 'secret',
				expiresIn: 60,
				headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '42' }
			})
		);
		assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
	});
});

describe('uriEncode', () => {
	it('encodes what encodeURIComponent leaves alone', () => {
		assert.equal(uriEncode("a b!'()*~"), 'a%20b%21%27%28%29%2A~');
	});
});

describe('presignUrl against the AWS SDK', () => {
	// Signatures from @aws-sdk/s3-request-presigner's getSignedUrl for the same PUT, signed at
	// the same moment, with content-type and content-length signed. The query parameters are
	// the ones the SDK adds of its own.
	const sdkQuery = {
		'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
		'x-amz-checksum-crc32': 'AAAAAA==',
		'x-amz-sdk-checksum-algorithm': 'CRC32',
		'x-id': 'PutObject'
	};
	const cases = [
		[
			'AWS',
			'https://photos.s3.us-west-2.amazonaws.com/u/a%20b%2B1.webp',
			'us-west-2',
			'30733c5ade6041044c6aaa80c3d4f4004a16eb9c083e0161948587e4e453a41a'
		],
		[
			'R2',
			'https://acct.r2.cloudflarestorage.com/photos/u/a%20b%2B1.webp',
			'auto',
			'a33f0da09f88d6f8317d56d3b2ced8df06dbfe75a4030617d8e1ba5556d6cdc5'
		]
	] as const;

	for (const [name, objectUrl, region, signature] of cases) {
		it(`signs a PUT for ${name} as the SDK does`, async () => {
			const url = await presignUrl({
				method: 'PUT',
				url: objectUrl,
				region,
				accessKeyId: 'AKID',
				secretAccessKey: 'secret',
				expiresIn: 300,
				headers: { 'Content-Type': 'image/webp', 'Content-Length': '120000' },
				query: sdkQuery,
				date: new Date('2026-11-13T12:00:00Z')
			});
			assert.equal(new URL(url).searchParams.get('X-Amz-Signature'), signature);
		});
	}
});
