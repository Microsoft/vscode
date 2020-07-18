/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { URI } from 'vs/base/common/uri';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IFileService, FileSystemProviderCapabilities, IFileSystemProviderCapabilitiesChangeEvent, IFileSystemProviderRegistrationEvent } from 'vs/platform/files/common/files';
import { ExtUri, IExtUri, normalizePath } from 'vs/base/common/resources';
import { SkipList } from 'vs/base/common/skipList';
import { Event } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';

class Entry {
	static _clock = 0;
	time: number = Entry._clock++;
	constructor(readonly uri: URI) { }
	touch() {
		this.time = Entry._clock++;
		return this;
	}
}

export class UriIdentityService implements IUriIdentityService {

	declare readonly _serviceBrand: undefined;

	readonly extUri: IExtUri;

	private readonly _dispooables = new DisposableStore();
	private readonly _canonicalUris: SkipList<URI, Entry>;
	private readonly _limit = 2 ** 16;

	constructor(@IFileService private readonly _fileService: IFileService) {

		const schemeIgnoresPathCasingCache = new Map<string, boolean>();

		// assume path casing matters unless the file system provider spec'ed the opposite.
		// for all other cases path casing matters, e.g for
		// * virtual documents
		// * in-memory uris
		// * all kind of "private" schemes
		const ignorePathCasing = (uri: URI): boolean => {
			let ignorePathCasing = schemeIgnoresPathCasingCache.get(uri.scheme);
			if (ignorePathCasing === undefined) {
				// retrieve once and then case per scheme until a change happens
				ignorePathCasing = _fileService.canHandleResource(uri) && !this._fileService.hasCapability(uri, FileSystemProviderCapabilities.PathCaseSensitive);
				schemeIgnoresPathCasingCache.set(uri.scheme, ignorePathCasing);
			}
			return ignorePathCasing;
		};
		this._dispooables.add(Event.any<IFileSystemProviderCapabilitiesChangeEvent | IFileSystemProviderRegistrationEvent>(
			_fileService.onDidChangeFileSystemProviderRegistrations,
			_fileService.onDidChangeFileSystemProviderCapabilities
		)(e => {
			// remove from cache
			schemeIgnoresPathCasingCache.delete(e.scheme);
		}));

		this.extUri = new ExtUri(ignorePathCasing);
		this._canonicalUris = new SkipList((a, b) => this.extUri.compare(a, b, true), this._limit);
	}

	dispose(): void {
		this._dispooables.dispose();
		this._canonicalUris.clear();
	}

	asCanonicalUri(uri: URI): URI {

		// (1) normalize URI
		if (this._fileService.canHandleResource(uri)) {
			uri = normalizePath(uri);
		}

		// (2) find the uri in its canonical form or use this uri to define it
		let item = this._canonicalUris.get(uri);
		if (item) {
			return item.touch().uri.with({ fragment: uri.fragment });
		}

		// this uri is first and defines the canonical form
		this._canonicalUris.set(uri, new Entry(uri));
		this._checkTrim();

		return uri;
	}

	private _checkTrim(): void {
		if (this._canonicalUris.size < this._limit) {
			return;
		}

		// get all entries, sort by touch (MRU) and re-initalize
		// the uri cache and the entry clock. this is an expensive
		// operation and should happen rarely
		const entries = [...this._canonicalUris.entries()].sort((a, b) => {
			if (a[1].touch < b[1].touch) {
				return 1;
			} else if (a[1].touch > b[1].touch) {
				return -1;
			} else {
				return 0;
			}
		});

		Entry._clock = 0;
		this._canonicalUris.clear();
		const newSize = this._limit * 0.5;
		for (let i = 0; i < newSize; i++) {
			this._canonicalUris.set(entries[i][0], entries[i][1].touch());
		}
	}
}

registerSingleton(IUriIdentityService, UriIdentityService, true);
