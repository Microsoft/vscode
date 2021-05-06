/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode } from 'vs/base/common/keyCodes';
import { EditorCommand, registerEditorCommand } from 'vs/editor/browser/editorExtensions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IContextKeyService, RawContextKey, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';
import { LinkedList } from 'vs/base/common/linkedList';
import { createDecorator, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { localize } from 'vs/nls';


const IEditorCancellationTokens = createDecorator<IEditorCancellationTokens>('IEditorCancelService');

interface IEditorCancellationTokens {
	readonly _serviceBrand: undefined;
	add(editor: ICodeEditor, cts: CancellationTokenSource): () => void;
	cancel(editor: ICodeEditor): void;
}

const ctxCancellableOperation = new RawContextKey('cancellableOperation', false, localize('cancellableOperation', 'Whether the editor runs a cancellable operation, e.g. like \'Peek References\''));

registerSingleton(IEditorCancellationTokens, class implements IEditorCancellationTokens {

	declare readonly _serviceBrand: undefined;

	private readonly _tokens = new WeakMap<ICodeEditor, { key: IContextKey<boolean>, tokens: LinkedList<CancellationTokenSource> }>();

	add(editor: ICodeEditor, cts: CancellationTokenSource): () => void {
		let data = this._tokens.get(editor);
		if (!data) {
			data = editor.invokeWithinContext(accessor => {
				const key = ctxCancellableOperation.bindTo(accessor.get(IContextKeyService));
				const tokens = new LinkedList<CancellationTokenSource>();
				return { key, tokens };
			});
			this._tokens.set(editor, data);
		}

		let removeFn: Function | undefined;

		data.key.set(true);
		removeFn = data.tokens.push(cts);

		return () => {
			// remove w/o cancellation
			if (removeFn) {
				removeFn();
				data!.key.set(!data!.tokens.isEmpty());
				removeFn = undefined;
			}
		};
	}

	cancel(editor: ICodeEditor): void {
		const data = this._tokens.get(editor);
		if (!data) {
			return;
		}
		// remove with cancellation
		const cts = data.tokens.pop();
		if (cts) {
			cts.cancel();
			data.key.set(!data.tokens.isEmpty());
		}
	}

}, true);

export class EditorKeybindingCancellationTokenSource extends CancellationTokenSource {

	private readonly _unregister: Function;

	constructor(readonly editor: ICodeEditor, parent?: CancellationToken) {
		super(parent);
		this._unregister = editor.invokeWithinContext(accessor => accessor.get(IEditorCancellationTokens).add(editor, this));
	}

	override dispose(): void {
		this._unregister();
		super.dispose();
	}
}

registerEditorCommand(new class extends EditorCommand {

	constructor() {
		super({
			id: 'editor.cancelOperation',
			kbOpts: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Escape
			},
			precondition: ctxCancellableOperation
		});
	}

	runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor): void {
		accessor.get(IEditorCancellationTokens).cancel(editor);
	}
});
