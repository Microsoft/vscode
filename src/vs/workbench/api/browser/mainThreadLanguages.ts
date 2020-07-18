/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { MainThreadLanguagesShape, MainContext, IExtHostContext } from '../common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IPosition } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { StandardTokenType } from 'vs/editor/common/modes';

@extHostNamedCustomer(MainContext.MainThreadLanguages)
export class MainThreadLanguages implements MainThreadLanguagesShape {

	constructor(
		_extHostContext: IExtHostContext,
		@IModeService private readonly _modeService: IModeService,
		@IModelService private readonly _modelService: IModelService
	) {
	}

	dispose(): void {
		// nothing
	}

	$getLanguages(): Promise<string[]> {
		return Promise.resolve(this._modeService.getRegisteredModes());
	}

	$changeLanguage(resource: UriComponents, languageId: string): Promise<void> {
		const uri = URI.revive(resource);
		const model = this._modelService.getModel(uri);
		if (!model) {
			return Promise.reject(new Error('Invalid uri'));
		}
		const languageIdentifier = this._modeService.getLanguageIdentifier(languageId);
		if (!languageIdentifier || languageIdentifier.language !== languageId) {
			return Promise.reject(new Error(`Unknown language id: ${languageId}`));
		}
		this._modelService.setMode(model, this._modeService.create(languageId));
		return Promise.resolve(undefined);
	}

	async $tokensAtPosition(resource: UriComponents, position: IPosition): Promise<undefined | { type: StandardTokenType, range: IRange }> {
		const uri = URI.revive(resource);
		const model = this._modelService.getModel(uri);
		if (!model) {
			return undefined;
		}
		model.tokenizeIfCheap(position.lineNumber);
		const tokens = model.getLineTokens(position.lineNumber);
		const idx = tokens.findTokenIndexAtOffset(position.column - 1);
		return {
			type: tokens.getStandardTokenType(idx),
			range: new Range(position.lineNumber, 1 + tokens.getStartOffset(idx), position.lineNumber, 1 + tokens.getEndOffset(idx))
		};
	}
}
