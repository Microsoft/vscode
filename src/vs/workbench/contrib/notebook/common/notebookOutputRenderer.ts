/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { INotebookRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export class NotebookOutputRendererInfo implements INotebookRendererInfo {

	readonly id: string;
	readonly entrypoint: URI;
	readonly displayName: string;
	readonly extensionLocation: URI;
	readonly extensionId: ExtensionIdentifier;
	// todo: re-add preloads in pure renderer API
	readonly preloads: ReadonlyArray<URI> = [];

	private readonly mimeTypes: readonly string[];
	private readonly mimeTypeGlobs: glob.ParsedPattern[];

	constructor(descriptor: {
		readonly id: string;
		readonly displayName: string;
		readonly entrypoint: string;
		readonly mimeTypes: readonly string[];
		readonly extension: IExtensionDescription;
	}) {
		this.id = descriptor.id;
		this.extensionId = descriptor.extension.identifier;
		this.extensionLocation = descriptor.extension.extensionLocation;
		this.entrypoint = joinPath(this.extensionLocation, descriptor.entrypoint);
		this.displayName = descriptor.displayName;
		this.mimeTypes = descriptor.mimeTypes;
		this.mimeTypeGlobs = this.mimeTypes.map(pattern => glob.parse(pattern));
	}

	matches(mimeType: string) {
		return this.mimeTypeGlobs.some(pattern => pattern(mimeType))
			|| this.mimeTypes.some(pattern => pattern === mimeType);
	}
}
