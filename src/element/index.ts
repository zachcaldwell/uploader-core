import { PhotoUpload } from './PhotoUpload.ts';

export {
	PhotoUpload,
	type CompleteDetail,
	type FileState,
	type PhotoUploadEventMap
} from './PhotoUpload.ts';

// Importing this module defines <photo-upload>, once, and only where there's a browser to.
if (typeof customElements !== 'undefined' && !customElements.get('photo-upload')) {
	customElements.define('photo-upload', PhotoUpload);
}

declare global {
	interface HTMLElementTagNameMap {
		'photo-upload': PhotoUpload;
	}
}
