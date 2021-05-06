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
import { join } from 'vs/base/common/path';

export class ExtensionsInput extends EditorInput {

	static readonly ID = 'workbench.extensions.input2';

	override get typeId(): string {
		return ExtensionsInput.ID;
	}

	override get resource() {
		return URI.from({
			scheme: Schemas.extension,
			path: join(this.extension.identifier.id, 'extension')
		});
	}

	constructor(
		public readonly extension: IExtension
	) {
		super();
	}

	override getName(): string {
		return localize('extensionsInputName', "Extension: {0}", this.extension.displayName);
	}

	override canSplit(): boolean {
		return false;
	}

	override matches(other: unknown): boolean {
		if (super.matches(other)) {
			return true;
		}

		return other instanceof ExtensionsInput && areSameExtensions(this.extension.identifier, other.extension.identifier);
	}
}
