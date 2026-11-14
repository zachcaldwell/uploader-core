import type { PresignRequest } from './target.ts';

/** Refused before signing: too big, the wrong type, or no size at all. */
export class PresignRefused extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PresignRefused';
	}
}

export const isImage = (contentType: string) => /^image\/[\w.+-]+$/.test(contentType);

/** What every presign helper checks before it signs anything. */
export function checkRequest(
	{ contentType, size }: PresignRequest,
	maxBytes: number,
	accept: (contentType: string) => boolean
): void {
	if (!Number.isInteger(size) || size <= 0) throw new PresignRefused('No size given');
	if (size > maxBytes) throw new PresignRefused(`${size} bytes is over the ${maxBytes} allowed`);
	if (!accept(contentType)) throw new PresignRefused(`${contentType} isn't accepted`);
}
