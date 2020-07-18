/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { registerEditorAction, ServicesAccessor, EditorAction } from 'vs/editor/browser/editorExtensions';
import { IModeService } from 'vs/editor/common/services/modeService';
import { LanguageId } from 'vs/editor/common/modes';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ISnippetsService } from 'vs/workbench/contrib/snippets/browser/snippets.contribution';
import { SnippetController2 } from 'vs/editor/contrib/snippet/snippetController2';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { Snippet, SnippetSource } from 'vs/workbench/contrib/snippets/browser/snippetsFile';
import { IQuickPickItem, IQuickInputService, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';

interface ISnippetPick extends IQuickPickItem {
	snippet: Snippet;
}

class Args {

	static fromUser(arg: any): Args {
		if (!arg || typeof arg !== 'object') {
			return Args._empty;
		}
		let { snippet, name, langId } = arg;
		if (typeof snippet !== 'string') {
			snippet = undefined;
		}
		if (typeof name !== 'string') {
			name = undefined;
		}
		if (typeof langId !== 'string') {
			langId = undefined;
		}
		return new Args(snippet, name, langId);
	}

	private static readonly _empty = new Args(undefined, undefined, undefined);

	private constructor(
		public readonly snippet: string | undefined,
		public readonly name: string | undefined,
		public readonly langId: string | undefined
	) { }
}

class InsertSnippetAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.insertSnippet',
			label: nls.localize('snippet.suggestions.label', "Insert Snippet"),
			alias: 'Insert Snippet',
			precondition: EditorContextKeys.writable,
			description: {
				description: `Insert Snippet`,
				args: [{
					name: 'args',
					schema: {
						'type': 'object',
						'properties': {
							'snippet': {
								'type': 'string'
							},
							'langId': {
								'type': 'string',

							},
							'name': {
								'type': 'string'
							}
						},
					}
				}]
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor, arg: any): Promise<void> {
		const modeService = accessor.get(IModeService);
		const snippetService = accessor.get(ISnippetsService);

		if (!editor.hasModel()) {
			return;
		}

		const clipboardService = accessor.get(IClipboardService);
		const quickInputService = accessor.get(IQuickInputService);

		const snippet = await new Promise<Snippet>(async (resolve, reject) => {

			const { lineNumber, column } = editor.getPosition();
			let { snippet, name, langId } = Args.fromUser(arg);

			if (snippet) {
				return resolve(new Snippet(
					[],
					'',
					'',
					'',
					snippet,
					'',
					SnippetSource.User,
				));
			}

			let languageId = LanguageId.Null;
			if (langId) {
				const otherLangId = modeService.getLanguageIdentifier(langId);
				if (otherLangId) {
					languageId = otherLangId.id;
				}
			} else {
				editor.getModel().tokenizeIfCheap(lineNumber);
				languageId = editor.getModel().getLanguageIdAtPosition(lineNumber, column);

				// validate the `languageId` to ensure this is a user
				// facing language with a name and the chance to have
				// snippets, else fall back to the outer language
				const otherLangId = modeService.getLanguageIdentifier(languageId);
				if (otherLangId && !modeService.getLanguageName(otherLangId.language)) {
					languageId = editor.getModel().getLanguageIdentifier().id;
				}
			}

			if (name) {
				// take selected snippet
				(await snippetService.getSnippets(languageId)).every(snippet => {
					if (snippet.name !== name) {
						return true;
					}
					resolve(snippet);
					return false;
				});
			} else {
				// let user pick a snippet
				const snippets = (await snippetService.getSnippets(languageId)).sort(Snippet.compare);
				const picks: QuickPickInput<ISnippetPick>[] = [];
				let prevSnippet: Snippet | undefined;
				for (const snippet of snippets) {
					const pick: ISnippetPick = {
						label: snippet.prefix,
						detail: snippet.description,
						snippet
					};
					if (!prevSnippet || prevSnippet.snippetSource !== snippet.snippetSource) {
						let label = '';
						switch (snippet.snippetSource) {
							case SnippetSource.User:
								label = nls.localize('sep.userSnippet', "User Snippets");
								break;
							case SnippetSource.Extension:
								label = nls.localize('sep.extSnippet', "Extension Snippets");
								break;
							case SnippetSource.Workspace:
								label = nls.localize('sep.workspaceSnippet', "Workspace Snippets");
								break;
						}
						picks.push({ type: 'separator', label });

					}
					picks.push(pick);
					prevSnippet = snippet;
				}
				return quickInputService.pick(picks, { matchOnDetail: true }).then(pick => resolve(pick && pick.snippet), reject);
			}
		});

		if (!snippet) {
			return;
		}
		let clipboardText: string | undefined;
		if (snippet.needsClipboard) {
			clipboardText = await clipboardService.readText();
		}
		SnippetController2.get(editor).insert(snippet.codeSnippet, { clipboardText });
	}
}

registerEditorAction(InsertSnippetAction);

// compatibility command to make sure old keybinding are still working
CommandsRegistry.registerCommand('editor.action.showSnippets', accessor => {
	return accessor.get(ICommandService).executeCommand('editor.action.insertSnippet');
});
