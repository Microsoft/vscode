/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from 'vs/base/browser/dom';
import { CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { generateUuid } from 'vs/base/common/uuid';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IBulkEditService, ResourceEdit } from 'vs/editor/browser/services/bulkEditService';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { CopyPasteActionProvider, CopyPasteActionProviderRegistry } from 'vs/editor/common/modes';

let clipboardItem: undefined | {
	readonly handle: string;
	readonly results: CancelablePromise<Map<CopyPasteActionProvider, unknown | undefined>>;
};

const vscodeClipboardFormat = 'x-vscode/id';

export class CopyPasteActionController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.copyPasteActionController';

	public static get(editor: ICodeEditor): CopyPasteActionController {
		return editor.getContribution<CopyPasteActionController>(CopyPasteActionController.ID);
	}

	private readonly _editor: ICodeEditor;

	constructor(
		editor: ICodeEditor,
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,
	) {
		super();

		this._editor = editor;

		this._register(addDisposableListener(document, 'copy', (e: ClipboardEvent) => {
			if (!e.clipboardData) {
				return;
			}

			const model = editor.getModel();
			const selection = this._editor.getSelection();
			if (!model || !selection) {
				return;
			}

			const providers = CopyPasteActionProviderRegistry.all(model).filter(x => !!x.onDidCopy);
			if (!providers.length) {
				return;
			}

			// Call prevent default to prevent our new clipboard data from being overwritten (is this really required?)
			e.preventDefault();

			// And then fill in raw text again since we prevented default
			const clipboardText = model.getValueInRange(selection);
			e.clipboardData.setData('text/plain', clipboardText);

			// Save off a handle pointing to data that VS Code maintains.
			const handle = generateUuid();
			e.clipboardData.setData(vscodeClipboardFormat, handle);

			const promise = createCancelablePromise(async token => {
				const map = new Map<CopyPasteActionProvider, unknown | undefined>();

				await Promise.all(providers.map(async provider => {
					const result = await provider.onDidCopy!(model, selection, { clipboardText: clipboardText }, token);
					map.set(provider, result);
				}));

				return map;
			});

			clipboardItem = { handle: handle, results: promise };
		}));

		this._register(addDisposableListener(document, 'paste', async (e: ClipboardEvent) => {
			const model = editor.getModel();
			const selection = this._editor.getSelection();
			if (!model || !selection) {
				return;
			}

			const providers = CopyPasteActionProviderRegistry.all(model).filter(x => !!x.onDidCopy);
			if (!providers.length) {
				return;
			}

			const handle = e.clipboardData?.getData(vscodeClipboardFormat);
			const clipboardText = e.clipboardData?.getData('text/plain') ?? '';

			e.preventDefault();
			e.stopImmediatePropagation();

			let results: Map<CopyPasteActionProvider, unknown | undefined> | undefined;
			if (handle && clipboardItem && clipboardItem?.handle === handle) {
				results = await clipboardItem.results;
			}

			const token = CancellationToken.None;

			for (const provider of providers) {
				const data = results?.get(provider);
				const edit = await provider.onWillPaste(model, selection, { clipboardText: clipboardText, clipboardData: data }, token);
				if (!edit) {
					continue;
				}

				await this._bulkEditService.apply(ResourceEdit.convert(edit), { editor });
			}
		}, true));
	}
}
