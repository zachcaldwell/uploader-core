/**
 * Whether a file matches an `accept` list, as `<input type="file">` reads one: MIME types
 * (`image/webp`), wildcards (`image/*`) and extensions (`.heic`), comma-separated.
 * An empty list accepts anything.
 */
export function accepts(file: { name: string; type: string }, accept: string): boolean {
	const rules = accept
		.split(',')
		.map((rule) => rule.trim().toLowerCase())
		.filter(Boolean);
	if (rules.length === 0) return true;

	const type = file.type.toLowerCase();
	const name = file.name.toLowerCase();
	return rules.some((rule) =>
		rule.startsWith('.')
			? name.endsWith(rule)
			: rule.endsWith('/*')
				? type.startsWith(rule.slice(0, -1))
				: type === rule
	);
}
