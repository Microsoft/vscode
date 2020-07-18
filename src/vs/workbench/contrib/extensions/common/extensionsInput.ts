/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { EditorInput } from 'vs/workbench/common/editor';
import { IExtension } from 'vs/workbench/contrib/extensions/common/extensions';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';

export class ExtensionsInput extends EditorInput {

	static readonly ID = 'workbench.extensions.input2';

	get resource() {
		return URI.from({
			scheme: Schemas.extension,
			path: this.extension.identifier.id
		});
	}

	constructor(
		public readonly extension: IExtension
	) {
		super();
	}

	getTypeId(): string {
		return ExtensionsInput.ID;
	}

	getName(): string {
		return localize('extensionsInputName', "Extension: {0}", this.extension.displayName);
	}

	supportsSplitEditor(): boolean {
		return false;
	}

	matches(other: unknown): boolean {
		if (super.matches(other)) {
			return true;
		}

		return other instanceof ExtensionsInput && areSameExtensions(this.extension.identifier, other.extension.identifier);
	}
}
