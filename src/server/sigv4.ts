// AWS Signature Version 4 for presigned URLs (query-string auth), on WebCrypto alone, so it
// runs the same on Node, Deno, Bun and edge runtimes.

export interface PresignParams {
	method: string;
	/** Full URL of the object, without a query string. */
	url: string;
	region: string;
	service?: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** Seconds the URL stays valid (1 to 604800). */
	expiresIn: number;
	/** Headers the request must carry exactly, beside `host` (always signed). */
	headers?: Record<string, string>;
	/** Query parameters to sign beside SigV4's own. */
	query?: Record<string, string>;
	/** When it's signed. Defaults to now; fixed only in tests. */
	date?: Date;
}

const encoder = new TextEncoder();

/** RFC 3986 encoding, as SigV4 wants it: encodeURIComponent leaves !'()* alone. */
export function uriEncode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

const toHex = (buffer: ArrayBuffer) =>
	Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(value: string): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(key: BufferSource, value: string): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
}

export async function presignUrl({
	method,
	url,
	region,
	service = 's3',
	accessKeyId,
	secretAccessKey,
	expiresIn,
	headers = {},
	query: extraQuery = {},
	date = new Date()
}: PresignParams): Promise<string> {
	const target = new URL(url);
	const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
	const day = amzDate.slice(0, 8);
	const scope = `${day}/${region}/${service}/aws4_request`;

	const signed = Object.entries({ ...headers, host: target.host })
		.map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
		.sort(([a], [b]) => (a < b ? -1 : 1));
	const signedHeaders = signed.map(([name]) => name).join(';');

	const query: [string, string][] = [
		['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
		['X-Amz-Credential', `${accessKeyId}/${scope}`],
		['X-Amz-Date', amzDate],
		['X-Amz-Expires', String(expiresIn)],
		['X-Amz-SignedHeaders', signedHeaders],
		...Object.entries(extraQuery)
	];
	const canonicalQuery = query
		.map(([k, v]) => [uriEncode(k), uriEncode(v)])
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([k, v]) => `${k}=${v}`)
		.join('&');

	// The path as the URL has it, each segment decoded then encoded once.
	const canonicalUri = target.pathname
		.split('/')
		.map((segment) => uriEncode(decodeURIComponent(segment)))
		.join('/');

	const canonicalRequest = [
		method.toUpperCase(),
		canonicalUri,
		canonicalQuery,
		signed.map(([name, value]) => `${name}:${value}\n`).join(''),
		signedHeaders,
		'UNSIGNED-PAYLOAD'
	].join('\n');

	const stringToSign = [
		'AWS4-HMAC-SHA256',
		amzDate,
		scope,
		await sha256Hex(canonicalRequest)
	].join('\n');

	let key: ArrayBuffer = await hmac(encoder.encode(`AWS4${secretAccessKey}`), day);
	for (const part of [region, service, 'aws4_request']) key = await hmac(key, part);
	const signature = toHex(await hmac(key, stringToSign));

	return `${target.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
