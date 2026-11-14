import { compress, type OutputFormat } from '../compress.ts';
import { upload, type UploadOptions } from '../upload.ts';
import { accepts } from './accepts.ts';

/** Where one file stands. */
export type FileState = 'queued' | 'compressing' | 'uploading' | 'done' | 'error';

export interface CompleteDetail {
	/** The file as it was added. */
	file: File;
	/** Where it now lives in the bucket: store this. */
	key: string;
	/** What was actually uploaded, after compressing. */
	bytes: number;
	type: string;
	originalBytes: number;
}

export interface PhotoUploadEventMap {
	add: CustomEvent<{ file: File }>;
	progress: CustomEvent<{ file: File; progress: number }>;
	complete: CustomEvent<CompleteDetail>;
	error: CustomEvent<{ file: File; error: unknown }>;
}

interface Item {
	file: File;
	/** The compressed file, once there is one; a retry reuses it. */
	out?: File;
	row: HTMLLIElement;
	controller?: AbortController;
	thumbUrl?: string;
	removed?: boolean;
}

/** Files compressed and uploaded at once. */
const CONCURRENCY = 3;

// Importing this on a server (SSR) must not throw, where there's no HTMLElement to extend.
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

/**
 * `<photo-upload presign="/api/presign">`: pick, drop or paste photos, and each is compressed
 * in the browser and uploaded straight to your bucket. It renders into the light DOM with no
 * classes of its own, so any CSS styles it, by `data-part` and `data-state`:
 *
 * - the element: `data-state` is `idle`, `dragging` or `busy`; `data-count` is how many files it holds
 * - `[data-part=dropzone]`, a `<label>` holding `[data-part=input]` and `[data-part=prompt]`
 *   (the element's own children, if it had any, else a line of text)
 * - `[data-part=files]`, a `<ul>` of `[data-part=file]` rows, each with `data-state` (a `FileState`),
 *   `data-progress` and `--progress` (0 to 1), and inside it `thumb`, `name`, `progress`,
 *   `retry` (hidden but on an error) and `remove`
 *
 * Attributes: `presign`, `accept` (default `image/*`), `multiple`, `max-files`, `max-dimension`
 * (default 2048), `quality` (default 0.82) and `format` (`jpeg`, `png` or `webp`). Set the
 * `presign` property instead for a function, and `presignHeaders` for the presign request's.
 */
export class PhotoUpload extends Base {
	static observedAttributes = ['accept', 'multiple'];

	/** Overrides the `presign` attribute, and takes a function too. */
	presign?: UploadOptions['presign'];
	presignHeaders?: Record<string, string>;

	#items = new Set<Item>();
	#queue: Item[] = [];
	#running = 0;
	#dragging = false;
	#input?: HTMLInputElement;
	#list?: HTMLUListElement;

	connectedCallback() {
		// Moving the element in the DOM connects it again: build it, and listen, once.
		if (this.#input) return;

		const prompt = document.createElement('span');
		prompt.dataset.part = 'prompt';
		if (this.childNodes.length) prompt.append(...this.childNodes);
		else prompt.textContent = 'Drop photos here, or choose them';

		const input = document.createElement('input');
		input.type = 'file';
		input.dataset.part = 'input';
		input.addEventListener('change', () => {
			this.add(input.files ?? []);
			input.value = '';
		});

		const dropzone = document.createElement('label');
		dropzone.dataset.part = 'dropzone';
		dropzone.append(input, prompt);

		const list = document.createElement('ul');
		list.dataset.part = 'files';

		this.append(dropzone, list);
		this.#input = input;
		this.#list = list;
		this.#syncInput();

		this.addEventListener('dragover', (e) => {
			if (!e.dataTransfer?.types.includes('Files')) return;
			e.preventDefault();
			this.#setDragging(true);
		});
		this.addEventListener('dragleave', (e) => {
			if (!this.contains(e.relatedTarget as Node | null)) this.#setDragging(false);
		});
		this.addEventListener('drop', (e) => {
			if (!e.dataTransfer?.files.length) return;
			e.preventDefault();
			this.#setDragging(false);
			this.add(e.dataTransfer.files);
		});
		this.addEventListener('paste', (e) => {
			if (e.clipboardData?.files.length) this.add(e.clipboardData.files);
		});

		this.#syncState();
	}

	attributeChangedCallback() {
		this.#syncInput();
	}

	/** Adds files as if they'd been picked: each accepted one is compressed and uploaded. */
	add(files: Iterable<File> | ArrayLike<File>) {
		const accept = this.#accept;
		const maxFiles = Number(this.getAttribute('max-files')) || Infinity;

		for (const file of Array.from(files)) {
			if (!accepts(file, accept)) {
				this.#emit('error', { file, error: new Error(`${file.name} isn't an accepted type`) });
				continue;
			}
			if (this.#items.size >= maxFiles) {
				this.#emit('error', { file, error: new Error(`No more than ${maxFiles} files`) });
				continue;
			}
			const item: Item = { file, row: this.#row(file) };
			item.row.querySelector('[data-part=remove]')!.addEventListener('click', () => this.#remove(item));
			item.row.querySelector('[data-part=retry]')!.addEventListener('click', () => this.#enqueue(item));
			this.#items.add(item);
			this.#list!.append(item.row);
			this.#emit('add', { file });
			this.#enqueue(item);
		}
		this.#syncState();
	}

	/** Removes every file, stopping any still on its way. */
	clear() {
		for (const item of this.#items) this.#remove(item);
	}

	get #accept() {
		return this.getAttribute('accept') ?? 'image/*';
	}

	#syncInput() {
		if (!this.#input) return;
		this.#input.accept = this.#accept;
		this.#input.multiple = this.hasAttribute('multiple');
	}

	#row(file: File): HTMLLIElement {
		const row = document.createElement('li');
		row.dataset.part = 'file';

		const thumb = document.createElement('img');
		thumb.dataset.part = 'thumb';
		thumb.alt = '';
		thumb.hidden = true;

		const name = document.createElement('span');
		name.dataset.part = 'name';
		name.textContent = file.name;

		const progress = document.createElement('progress');
		progress.dataset.part = 'progress';
		progress.max = 1;
		progress.value = 0;

		const retry = document.createElement('button');
		retry.type = 'button';
		retry.dataset.part = 'retry';
		retry.textContent = 'Retry';
		retry.setAttribute('aria-label', `Retry ${file.name}`);
		retry.hidden = true;

		const remove = document.createElement('button');
		remove.type = 'button';
		remove.dataset.part = 'remove';
		remove.textContent = 'Remove';
		remove.setAttribute('aria-label', `Remove ${file.name}`);

		row.append(thumb, name, progress, retry, remove);
		return row;
	}

	#enqueue(item: Item) {
		this.#setFileState(item, 'queued');
		this.#setProgress(item, 0);
		this.#queue.push(item);
		this.#pump();
	}

	#pump() {
		while (this.#running < CONCURRENCY && this.#queue.length) {
			const item = this.#queue.shift()!;
			this.#running++;
			this.#run(item).finally(() => {
				this.#running--;
				this.#pump();
				this.#syncState();
			});
		}
		this.#syncState();
	}

	async #run(item: Item) {
		const controller = (item.controller = new AbortController());
		try {
			if (!item.out) {
				this.#setFileState(item, 'compressing');
				const dimension = Number(this.getAttribute('max-dimension')) || 2048;
				item.out = await compress(item.file, {
					maxWidth: dimension,
					maxHeight: dimension,
					quality: Number(this.getAttribute('quality')) || 0.82,
					format: (this.getAttribute('format') as OutputFormat | null) ?? undefined
				});
				if (item.removed) return;
				this.#showThumb(item);
			}

			const presign = this.presign ?? this.getAttribute('presign');
			if (!presign) throw new Error('<photo-upload> needs a presign attribute or property');

			this.#setFileState(item, 'uploading');
			const result = await upload(item.out, {
				presign,
				presignHeaders: this.presignHeaders,
				signal: controller.signal,
				onProgress: (progress) => {
					this.#setProgress(item, progress);
					this.#emit('progress', { file: item.file, progress });
				}
			});

			this.#setFileState(item, 'done');
			this.#emit('complete', {
				file: item.file,
				key: result.key,
				bytes: result.bytes,
				type: result.type,
				originalBytes: item.file.size
			});
		} catch (error) {
			if (item.removed) return;
			this.#setFileState(item, 'error');
			this.#emit('error', { file: item.file, error });
		}
	}

	#showThumb(item: Item) {
		item.thumbUrl = URL.createObjectURL(item.out!);
		const thumb = item.row.querySelector<HTMLImageElement>('[data-part=thumb]')!;
		thumb.src = item.thumbUrl;
		thumb.hidden = false;
	}

	#remove(item: Item) {
		item.removed = true;
		item.controller?.abort();
		this.#queue = this.#queue.filter((queued) => queued !== item);
		if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
		item.row.remove();
		this.#items.delete(item);
		this.#syncState();
	}

	#setFileState(item: Item, state: FileState) {
		item.row.dataset.state = state;
		item.row.querySelector<HTMLButtonElement>('[data-part=retry]')!.hidden = state !== 'error';
		this.#syncState();
	}

	#setProgress(item: Item, progress: number) {
		const rounded = Math.round(progress * 100) / 100;
		item.row.dataset.progress = String(rounded);
		item.row.style.setProperty('--progress', String(rounded));
		item.row.querySelector<HTMLProgressElement>('[data-part=progress]')!.value = rounded;
	}

	#setDragging(dragging: boolean) {
		this.#dragging = dragging;
		this.#syncState();
	}

	#syncState() {
		const busy = this.#running > 0 || this.#queue.length > 0;
		this.dataset.state = this.#dragging ? 'dragging' : busy ? 'busy' : 'idle';
		this.dataset.count = String(this.#items.size);
	}

	#emit<K extends keyof PhotoUploadEventMap>(
		type: K,
		detail: PhotoUploadEventMap[K]['detail']
	) {
		this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
	}
}
