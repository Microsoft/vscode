/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { URI } from 'vs/base/common/uri';
import { basename } from 'vs/base/common/path';
import { INotebookKernelInfoDto, NotebookEditorPriority } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export interface NotebookSelector {
	readonly filenamePattern?: string;
	readonly excludeFileNamePattern?: string;
}

export interface NotebookEditorDescriptor {
	readonly id: string;
	readonly displayName: string;
	readonly selector: readonly NotebookSelector[];
	readonly priority: NotebookEditorPriority;
	readonly providerExtensionId?: string;
	readonly providerDescription?: string;
	readonly providerDisplayName: string;
	readonly providerExtensionLocation: URI;
	kernel?: INotebookKernelInfoDto;
}

export class NotebookProviderInfo implements NotebookEditorDescriptor {

	readonly id: string;
	readonly displayName: string;
	readonly selector: readonly NotebookSelector[];
	readonly priority: NotebookEditorPriority;
	// it's optional as the memento might not have it
	readonly providerExtensionId?: string;
	readonly providerDescription?: string;
	readonly providerDisplayName: string;
	readonly providerExtensionLocation: URI;
	kernel?: INotebookKernelInfoDto;

	constructor(descriptor: NotebookEditorDescriptor) {
		this.id = descriptor.id;
		this.displayName = descriptor.displayName;
		this.selector = descriptor.selector;
		this.priority = descriptor.priority;
		this.providerExtensionId = descriptor.providerExtensionId;
		this.providerDescription = descriptor.providerDescription;
		this.providerDisplayName = descriptor.providerDisplayName;
		this.providerExtensionLocation = descriptor.providerExtensionLocation;
	}

	matches(resource: URI): boolean {
		return this.selector.some(selector => NotebookProviderInfo.selectorMatches(selector, resource));
	}

	static selectorMatches(selector: NotebookSelector, resource: URI): boolean {
		if (selector.filenamePattern) {
			if (glob.match(selector.filenamePattern.toLowerCase(), basename(resource.fsPath).toLowerCase())) {
				if (selector.excludeFileNamePattern) {
					if (glob.match(selector.excludeFileNamePattern.toLowerCase(), basename(resource.fsPath).toLowerCase())) {
						// should exclude

						return false;
					}
				}
				return true;
			}
		}
		return false;
	}
}
