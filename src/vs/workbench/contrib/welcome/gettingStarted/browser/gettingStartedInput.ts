/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./gettingStarted';
import { localize } from 'vs/nls';
import { EditorInput } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';

export const gettingStartedInputTypeId = 'workbench.editors.gettingStartedInput';

export class GettingStartedInput extends EditorInput {

	static readonly ID = gettingStartedInputTypeId;

	override get typeId(): string {
		return GettingStartedInput.ID;
	}

	get resource(): URI | undefined {
		return URI.from({ scheme: Schemas.walkThrough, authority: 'vscode_getting_started_page' });
	}

	override matches(other: unknown) {
		if (other instanceof GettingStartedInput) {
			return other.selectedCategory === this.selectedCategory;
		}
		return false;
	}

	constructor(
		options: { selectedCategory?: string, selectedStep?: string }
	) {
		super();
		this.selectedCategory = options.selectedCategory;
		this.selectedStep = options.selectedStep;
	}

	override getName() {
		return localize('gettingStarted', "Getting Started");
	}

	selectedCategory: string | undefined;
	selectedStep: string | undefined;
}
