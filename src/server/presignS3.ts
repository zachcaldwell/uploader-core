import { checkRequest, isImage } from '../presign.ts';
import type { PresignRequest, UploadTarget } from '../target.ts';
import { presignUrl, uriEncode } from './sigv4.ts';

export interface S3Config {
	bucket: string;
	/** AWS's region, or `auto` for R2. */
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	/**
	 * An S3-compatible endpoint, such as R2's `https://<account>.r2.cloudflarestorage.com`.
	 * Unset means AWS itself, addressed by bucket subdomain.
	 */
	endpoint?: string;
}

export interface PresignS3Options {
	/** Where the file goes. Make it on the server; never take it from the client as it stands. */
	key: string;
	/** What the client said it's sending. */
	request: PresignRequest;
	/** The most bytes allowed. A request for more is refused before anything is signed. */
	maxBytes: number;
	/** Content types allowed. Default: any `image/*`. */
	accept?: (contentType: string) => boolean;
	/** Seconds the URL stays valid. Default 300. */
	expiresIn?: number;
}

/**
 * A presigned PUT for S3 or anything S3-compatible (R2, MinIO, Backblaze B2). Its signature
 * covers the content type and the exact size the client declared, so S3 refuses a file that
 * isn't what was asked for. R2 doesn't enforce the signed size, so there `maxBytes` is
 * checked here, against what the client declared.
 */
export async function presignS3(
	config: S3Config,
	{ key, request, maxBytes, accept = isImage, expiresIn = 300 }: PresignS3Options
): Promise<UploadTarget> {
	checkRequest(request, maxBytes, accept);
	const { contentType, size } = request;

	const path = key.split('/').map(uriEncode).join('/');
	const url = config.endpoint
		? `${config.endpoint.replace(/\/+$/, '')}/${uriEncode(config.bucket)}/${path}`
		: `https://${config.bucket}.s3.${config.region}.amazonaws.com/${path}`;

	const headers = { 'Content-Type': contentType };
	const signed = await presignUrl({
		method: 'PUT',
		url,
		region: config.region,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		expiresIn,
		// The browser sets Content-Length itself, to the file's size; signing it holds it there.
		headers: { ...headers, 'Content-Length': String(size) }
	});

	return { url: signed, method: 'PUT', headers, key };
}
