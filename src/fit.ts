/** The largest size within maxWidth × maxHeight with the same aspect, never scaled up. */
export function fitWithin(
	width: number,
	height: number,
	maxWidth: number,
	maxHeight: number
): { width: number; height: number } {
	const scale = Math.min(1, maxWidth / width, maxHeight / height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}
