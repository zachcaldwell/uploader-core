import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StorageClient } from '@supabase/storage-js';
import { PresignRefused } from '../presign.ts';
import { presignSupabase } from './presignSupabase.ts';

interface Sent {
	method: string;
	url: string;
	headers: Record<string, string>;
}

/**
 * The real storage-js client, its requests caught rather than sent: signing answers as Storage
 * does, with a URL holding a token; an upload answers with the object's key; `signError`
 * makes signing fail as an RLS refusal does.
 */
function client(signError = false) {
	const sent: Sent[] = [];
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const headers: Record<string, string> = {};
		new Headers(init.headers).forEach((value, name) => (headers[name] = value));
		const url = String(input);
		sent.push({ method: init.method ?? 'GET', url, headers });

		if (signError) {
			return Response.json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, { status: 403 });
		}
		const path = decodeURIComponent(new URL(url).pathname.split('/object/upload/sign/')[1]);
		return init.method === 'POST'
			? Response.json({ url: `/object/upload/sign/${path}?token=TKN` })
			: Response.json({ Key: path });
	};
	const storage = new StorageClient(
		'https://proj.supabase.co/storage/v1',
		{ apikey: 'anon-key', Authorization: 'Bearer user-jwt' },
		fetch as typeof globalThis.fetch
	);
	return { bucket: storage.from('photos'), sent };
}

const request = { contentType: 'image/webp', size: 120_000 };

describe('presignSupabase', () => {
	it('targets the same request supabase-js makes for a raw upload', async () => {
		const ours = client();
		const target = await presignSupabase(ours.bucket, {
			key: 'u1/photo.webp',
			request,
			cacheControl: 31536000,
			apikey: 'anon-key'
		});

		// What storage-js itself sends to upload a raw body to that signed URL.
		const theirs = client();
		await theirs.bucket.uploadToSignedUrl('u1/photo.webp', 'TKN', new ArrayBuffer(8), {
			contentType: 'image/webp',
			cacheControl: '31536000'
		});
		const put = theirs.sent.find((s) => s.method === 'PUT')!;

		assert.equal(target.method, put.method);
		assert.equal(target.url, put.url);
		for (const [name, value] of Object.entries(target.headers!)) {
			assert.equal(put.headers[name.toLowerCase()], value, name);
		}
		assert.equal(target.key, 'u1/photo.webp');
	});

	it('asks for an upsert only when told to', async () => {
		const plain = client();
		await presignSupabase(plain.bucket, { key: 'a.webp', request });
		assert.equal(plain.sent[0].headers['x-upsert'], undefined);

		const upsert = client();
		await presignSupabase(upsert.bucket, { key: 'a.webp', request, upsert: true });
		assert.equal(upsert.sent[0].headers['x-upsert'], 'true');
	});

	it('sends no apikey unless given one', async () => {
		const { bucket } = client();
		const target = await presignSupabase(bucket, { key: 'a.webp', request });
		assert.deepEqual(Object.keys(target.headers!), ['Content-Type', 'Cache-Control']);
		assert.equal(target.headers!['Cache-Control'], 'max-age=3600');
	});

	it("passes on Storage's refusal to sign", async () => {
		const { bucket } = client(true);
		await assert.rejects(
			presignSupabase(bucket, { key: 'a.webp', request }),
			/Couldn't sign the upload: new row violates row-level security policy/
		);
	});

	it('refuses before asking Storage anything', async () => {
		const { bucket, sent } = client();
		await assert.rejects(
			presignSupabase(bucket, { key: 'a.webp', request, maxBytes: 1000 }),
			PresignRefused
		);
		await assert.rejects(
			presignSupabase(bucket, { key: 'a.txt', request: { contentType: 'text/html', size: 5 } }),
			PresignRefused
		);
		assert.equal(sent.length, 0);
	});
});
