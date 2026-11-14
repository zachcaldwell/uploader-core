import { checkRequest, isImage } from '../presign.ts';
import type { PresignRequest, UploadTarget } from '../target.ts';

/**
 * The one method this needs from a Supabase bucket, `supabase.storage.from('photos')`, so the
 * package doesn't depend on supabase-js.
 */
export interface SupabaseBucket {
	createSignedUploadUrl(
		path: string,
		options?: { upsert?: boolean }
	): Promise<{
		data: { signedUrl: string; path: string; token: string } | null;
		error: { message: string } | null;
	}>;
}

export interface PresignSupabaseOptions {
	/** The object's path in the bucket. Make it yourself; never take it from the client as it stands. */
	key: string;
	/** What `upload()` said it's sending. */
	request: PresignRequest;
	/**
	 * The most bytes allowed, checked against the declared size before signing. The bucket's own
	 * file size limit applies to the upload itself either way. Default: no check here.
	 */
	maxBytes?: number;
	/** Content types allowed. Default: any `image/*`. The bucket's allowed types apply too. */
	accept?: (contentType: string) => boolean;
	/** Seconds browsers and the CDN may cache the object. Default 3600, as supabase-js's. */
	cacheControl?: number;
	/** Overwrite an object already at `key`. Default false. */
	upsert?: boolean;
	/** The project's anon (publishable) key, sent along for gateways that ask for one. */
	apikey?: string;
}

/**
 * A target for `upload()` in Supabase Storage, from a signed upload URL. The URL's token is the
 * whole authorization (it's good for two hours), so this runs wherever the bucket's client does:
 * on the server with a service key, or in the browser under the user's own session, where the
 * bucket's RLS decides who may sign which paths.
 *
 * The upload is a raw PUT, the request supabase-js's `uploadToSignedUrl` makes for a body that
 * isn't a Blob.
 */
export async function presignSupabase(
	bucket: SupabaseBucket,
	{
		key,
		request,
		maxBytes = Infinity,
		accept = isImage,
		cacheControl = 3600,
		upsert = false,
		apikey
	}: PresignSupabaseOptions
): Promise<UploadTarget> {
	checkRequest(request, maxBytes, accept);

	const { data, error } = await bucket.createSignedUploadUrl(key, { upsert });
	if (error || !data) throw new Error(`Couldn't sign the upload: ${error?.message ?? 'no URL'}`);

	return {
		url: data.signedUrl,
		method: 'PUT',
		headers: {
			'Content-Type': request.contentType,
			'Cache-Control': `max-age=${cacheControl}`,
			...(apikey && { apikey })
		},
		key: data.path
	};
}
