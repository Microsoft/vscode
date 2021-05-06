/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { URI } from 'vs/base/common/uri';
import { basename } from 'vs/base/common/path';
import { INotebookExclusiveDocumentFilter, isDocumentExcludePattern, TransientOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ContributedEditorPriority } from 'vs/workbench/services/editor/common/editorOverrideService';

type NotebookSelector = string | glob.IRelativePattern | INotebookExclusiveDocumentFilter;

export interface NotebookEditorDescriptor {
	readonly id: string;
	readonly displayName: string;
	readonly selectors: readonly { filenamePattern?: string; excludeFileNamePattern?: string; }[];
	readonly priority: ContributedEditorPriority;
	readonly providerDisplayName: string;
	readonly exclusive: boolean;
}

export class NotebookProviderInfo {

	readonly id: string;
	readonly displayName: string;

	readonly priority: ContributedEditorPriority;
	// it's optional as the memento might not have it
	readonly providerDisplayName: string;
	readonly exclusive: boolean;
	private _selectors: NotebookSelector[];
	get selectors() {
		return this._selectors;
	}
	private _options: TransientOptions;
	get options() {
		return this._options;
	}

	constructor(descriptor: NotebookEditorDescriptor) {
		this.id = descriptor.id;
		this.displayName = descriptor.displayName;
		this._selectors = descriptor.selectors?.map(selector => ({
			include: selector.filenamePattern,
			exclude: selector.excludeFileNamePattern || ''
		})) || [];
		this.priority = descriptor.priority;
		this.providerDisplayName = descriptor.providerDisplayName;
		this.exclusive = descriptor.exclusive;
		this._options = {
			transientCellMetadata: {},
			transientDocumentMetadata: {},
			transientOutputs: false
		};
	}

	update(args: { selectors?: NotebookSelector[]; options?: TransientOptions }) {
		if (args.selectors) {
			this._selectors = args.selectors;
		}

		if (args.options) {
			this._options = args.options;
		}
	}

	matches(resource: URI): boolean {
		return this.selectors?.some(selector => NotebookProviderInfo.selectorMatches(selector, resource));
	}

	static selectorMatches(selector: NotebookSelector, resource: URI): boolean {
		if (typeof selector === 'string') {
			// filenamePattern
			if (glob.match(selector.toLowerCase(), basename(resource.fsPath).toLowerCase())) {
				return true;
			}
		}

		if (glob.isRelativePattern(selector)) {
			if (glob.match(selector, basename(resource.fsPath).toLowerCase())) {
				return true;
			}
		}

		if (!isDocumentExcludePattern(selector)) {
			return false;
		}

		let filenamePattern = selector.include;
		let excludeFilenamePattern = selector.exclude;

		if (glob.match(filenamePattern, basename(resource.fsPath).toLowerCase())) {
			if (excludeFilenamePattern) {
				if (glob.match(excludeFilenamePattern, basename(resource.fsPath).toLowerCase())) {
					return false;
				}
			}
			return true;
		}

		return false;
	}
}
