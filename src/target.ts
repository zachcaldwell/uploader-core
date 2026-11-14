/**
 * Where a file goes and how to send it: what a presign endpoint answers with,
 * and what `presignS3` builds on the server.
 */
export interface UploadTarget {
	/** The URL to send the file to. */
	url: string;
	method: 'PUT';
	/** Headers to send with the file. A presigned URL's signature covers them, so send them as given. */
	headers?: Record<string, string>;
	/** Where the file will live in the bucket, for the caller to store. */
	key: string;
}

/** What `upload()` tells a presign endpoint about the file it's about to send. */
export interface PresignRequest {
	contentType: string;
	/** Bytes. */
	size: number;
	/** The file's own name, if it has one. Never use it as the key as it stands. */
	name?: string;
}
