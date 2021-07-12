/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ITextModel } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import { CodeActionKind } from 'vs/editor/contrib/codeAction/types';
import * as nls from 'vs/nls';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';

const renameKind = CodeActionKind.Refactor.append('rename');

export class RenameRefactorContribution extends Disposable implements IWorkbenchContribution, modes.CodeActionProvider {

	private readonly emptyCodeActionsList = Object.freeze({
		actions: [],
		dispose: () => { }
	});

	constructor() {
		super();
		this._register(modes.CodeActionProviderRegistry.register('*', this));
	}

	public readonly providedCodeActionKinds = Object.freeze([renameKind.value]);

	public async provideCodeActions(model: ITextModel, range: Range | Selection, _context: modes.CodeActionContext, token: CancellationToken): Promise<modes.CodeActionList> {
		const position = range.getStartPosition();
		for (const provider of modes.RenameProviderRegistry.all(model)) {
			if (!provider.resolveRenameLocation) {
				continue;
			}
			const result = await provider.resolveRenameLocation(model, position, token);
			if (result?.rejectReason) {
				continue;
			}
			const title = nls.localize('renameTitle', 'Rename symbol');
			return {
				actions: [{
					title,
					kind: renameKind.value,
					command: {
						id: 'editor.action.rename',
						title,
						arguments: [
							model.uri,
							position
						]
					}
				}],
				dispose: () => { }
			};
		}
		return this.emptyCodeActionsList;
	}
}
