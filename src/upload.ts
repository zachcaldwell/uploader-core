import type { PresignRequest, UploadTarget } from './target.ts';

export interface UploadOptions {
	/**
	 * Where to get the upload's target: a URL `upload()` POSTs the file's type, size and name to
	 * as JSON (answered with an `UploadTarget`), or a function that returns the target itself.
	 */
	presign: string | ((request: PresignRequest) => Promise<UploadTarget>);
	/** Headers for the presign request, such as an `Authorization` your endpoint checks. */
	presignHeaders?: Record<string, string>;
	/** Called as bytes go out, from 0 to 1. */
	onProgress?: (fraction: number) => void;
	signal?: AbortSignal;
	/** Tries after the first, for a dropped connection or a 5xx/429. Default 2. */
	retries?: number;
}

export interface UploadResult {
	key: string;
	bytes: number;
	type: string;
}

/** A failed presign or upload. `status` is the HTTP status, absent for a network error. */
export class UploadError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'UploadError';
	}
}

// Worth another try: the connection, the server's trouble, or being told to slow down.
const retriable = (error: unknown) =>
	error instanceof UploadError &&
	(error.status === undefined || error.status >= 500 || error.status === 429);

/**
 * Upload a file straight to storage: ask for a presigned target, then send the file there.
 * The target is asked for once; only sending it is retried, with backoff.
 */
export async function upload(
	file: Blob,
	{ presign, presignHeaders, onProgress, signal, retries = 2 }: UploadOptions
): Promise<UploadResult> {
	signal?.throwIfAborted();
	const request: PresignRequest = {
		contentType: file.type || 'application/octet-stream',
		size: file.size,
		name: file instanceof File ? file.name : undefined
	};
	const target =
		typeof presign === 'string'
			? await fetchTarget(presign, request, presignHeaders, signal)
			: await presign(request);

	for (let attempt = 0; ; attempt++) {
		try {
			await send(file, target, onProgress, signal);
			onProgress?.(1);
			return { key: target.key, bytes: file.size, type: request.contentType };
		} catch (error) {
			if (attempt >= retries || !retriable(error)) throw error;
			await wait(500 * 2 ** attempt, signal);
		}
	}
}

async function fetchTarget(
	url: string,
	request: PresignRequest,
	headers: Record<string, string> | undefined,
	signal: AbortSignal | undefined
): Promise<UploadTarget> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify(request),
			signal
		});
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new UploadError(`Couldn't reach ${url}`);
	}
	if (!response.ok) throw new UploadError(`Presign failed: ${response.status}`, response.status);
	return response.json();
}

// XHR rather than fetch: it reports upload progress everywhere, and fetch doesn't yet.
function send(
	file: Blob,
	target: UploadTarget,
	onProgress: UploadOptions['onProgress'],
	signal: AbortSignal | undefined
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(target.method, target.url);
		for (const [name, value] of Object.entries(target.headers ?? {})) {
			xhr.setRequestHeader(name, value);
		}

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
		};
		xhr.onload = () =>
			xhr.status >= 200 && xhr.status < 300
				? resolve()
				: reject(new UploadError(`Upload failed: ${xhr.status}`, xhr.status));
		xhr.onerror = () => reject(new UploadError('Upload failed: network error'));

		const abort = () => xhr.abort();
		xhr.onabort = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
		xhr.onloadend = () => signal?.removeEventListener('abort', abort);
		signal?.addEventListener('abort', abort, { once: true });

		xhr.send(file);
	});
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true }
		);
	});
}
