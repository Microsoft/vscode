/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';

export class NotebookOutputRendererInfo {

	readonly id: string;
	readonly displayName: string;
	readonly mimeTypes: readonly string[];
	readonly mimeTypeGlobs: glob.ParsedPattern[];

	constructor(descriptor: {
		readonly id: string;
		readonly displayName: string;
		readonly mimeTypes: readonly string[];
	}) {
		this.id = descriptor.id;
		this.displayName = descriptor.displayName;
		this.mimeTypes = descriptor.mimeTypes;
		this.mimeTypeGlobs = this.mimeTypes.map(pattern => glob.parse(pattern));
	}

	matches(mimeType: string) {
		let matched = this.mimeTypeGlobs.find(pattern => pattern(mimeType));
		return matched;
	}
}
