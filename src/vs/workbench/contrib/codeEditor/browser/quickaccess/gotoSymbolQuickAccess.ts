/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IKeyMods, IQuickPickSeparator, IQuickInputService, IQuickPick } from 'vs/platform/quickinput/common/quickInput';
import { IEditor } from 'vs/editor/common/editorCommon';
import { IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IRange } from 'vs/editor/common/core/range';
import { Registry } from 'vs/platform/registry/common/platform';
import { IQuickAccessRegistry, Extensions as QuickaccessExtensions } from 'vs/platform/quickinput/common/quickAccess';
import { AbstractGotoSymbolQuickAccessProvider, IGotoSymbolQuickPickItem } from 'vs/editor/contrib/quickAccess/gotoSymbolQuickAccess';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchEditorConfiguration, IEditorPane } from 'vs/workbench/common/editor';
import { ITextModel } from 'vs/editor/common/model';
import { DisposableStore, IDisposable, toDisposable, Disposable } from 'vs/base/common/lifecycle';
import { timeout } from 'vs/base/common/async';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { prepareQuery } from 'vs/base/common/fuzzyScorer';
import { SymbolKind } from 'vs/editor/common/modes';
import { fuzzyScore, createMatches } from 'vs/base/common/filters';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

export class GotoSymbolQuickAccessProvider extends AbstractGotoSymbolQuickAccessProvider {

	protected readonly onDidActiveTextEditorControlChange = this.editorService.onDidActiveEditorChange;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super({
			openSideBySideDirection: () => this.configuration.openSideBySideDirection
		});
	}

	//#region DocumentSymbols (text editor required)

	protected provideWithTextEditor(editor: IEditor, picker: IQuickPick<IGotoSymbolQuickPickItem>, token: CancellationToken): IDisposable {
		if (this.canPickFromTableOfContents()) {
			return this.doGetTableOfContentsPicks(picker);
		}
		return super.provideWithTextEditor(editor, picker, token);
	}

	private get configuration() {
		const editorConfig = this.configurationService.getValue<IWorkbenchEditorConfiguration>().workbench.editor;

		return {
			openEditorPinned: !editorConfig.enablePreviewFromQuickOpen,
			openSideBySideDirection: editorConfig.openSideBySideDirection
		};
	}

	protected get activeTextEditorControl() {
		return this.editorService.activeTextEditorControl;
	}

	protected gotoLocation(editor: IEditor, options: { range: IRange, keyMods: IKeyMods, forceSideBySide?: boolean, preserveFocus?: boolean }): void {

		// Check for sideBySide use
		if ((options.keyMods.ctrlCmd || options.forceSideBySide) && this.editorService.activeEditor) {
			this.editorService.openEditor(this.editorService.activeEditor, {
				selection: options.range,
				pinned: options.keyMods.alt || this.configuration.openEditorPinned,
				preserveFocus: options.preserveFocus
			}, SIDE_GROUP);
		}

		// Otherwise let parent handle it
		else {
			super.gotoLocation(editor, options);
		}
	}

	//#endregion

	//#region public methods to use this picker from other pickers

	private static readonly SYMBOL_PICKS_TIMEOUT = 8000;

	async getSymbolPicks(model: ITextModel, filter: string, options: { extraContainerLabel?: string }, disposables: DisposableStore, token: CancellationToken): Promise<Array<IGotoSymbolQuickPickItem | IQuickPickSeparator>> {

		// If the registry does not know the model, we wait for as long as
		// the registry knows it. This helps in cases where a language
		// registry was not activated yet for providing any symbols.
		// To not wait forever, we eventually timeout though.
		const result = await Promise.race([
			this.waitForLanguageSymbolRegistry(model, disposables),
			timeout(GotoSymbolQuickAccessProvider.SYMBOL_PICKS_TIMEOUT)
		]);

		if (!result || token.isCancellationRequested) {
			return [];
		}

		return this.doGetSymbolPicks(this.getDocumentSymbols(model, true, token), prepareQuery(filter), options, token);
	}

	addDecorations(editor: IEditor, range: IRange): void {
		super.addDecorations(editor, range);
	}

	clearDecorations(editor: IEditor): void {
		super.clearDecorations(editor);
	}

	//#endregion

	protected provideWithoutTextEditor(picker: IQuickPick<IGotoSymbolQuickPickItem>): IDisposable {
		if (this.canPickFromTableOfContents()) {
			return this.doGetTableOfContentsPicks(picker);
		}
		return super.provideWithoutTextEditor(picker);
	}

	private canPickFromTableOfContents(): boolean {
		return this.editorService.activeEditorPane ? TableOfContentsProviderRegistry.has(this.editorService.activeEditorPane.getId()) : false;
	}

	private doGetTableOfContentsPicks(picker: IQuickPick<IGotoSymbolQuickPickItem>): IDisposable {
		const pane = this.editorService.activeEditorPane;
		if (!pane) {
			return Disposable.None;
		}
		const provider = TableOfContentsProviderRegistry.get(pane.getId())!;
		const cts = new CancellationTokenSource();

		const disposables = new DisposableStore();
		disposables.add(toDisposable(() => cts.dispose(true)));

		picker.busy = true;

		provider.provideTableOfContents(pane, { disposables }, cts.token).then(entries => {

			picker.busy = false;

			if (cts.token.isCancellationRequested || !entries || entries.length === 0) {
				return;
			}

			const items: IGotoSymbolQuickPickItem[] = entries.map((entry, idx) => {
				return {
					kind: SymbolKind.File,
					index: idx,
					score: 0,
					label: entry.icon ? `$(${entry.icon.id}) ${entry.label}` : entry.label,
					ariaLabel: entry.detail ? `${entry.label}, ${entry.detail}` : entry.label,
					detail: entry.detail,
					description: entry.description,
				};
			});

			disposables.add(picker.onDidAccept(() => {
				picker.hide();
				const [entry] = picker.selectedItems;
				entries[entry.index]?.pick();
			}));

			const updatePickerItems = () => {
				const filteredItems = items.filter(item => {
					if (picker.value === '@') {
						// default, no filtering, scoring...
						item.score = 0;
						item.highlights = undefined;
						return true;
					}
					const score = fuzzyScore(picker.value, picker.value.toLowerCase(), 1 /*@-character*/, item.label, item.label.toLowerCase(), 0, true);
					if (!score) {
						return false;
					}
					item.score = score[1];
					item.highlights = { label: createMatches(score) };
					return true;
				});
				if (filteredItems.length === 0) {
					const label = localize('empty', 'No matching entries');
					picker.items = [{ label, index: -1, kind: SymbolKind.String }];
					picker.ariaLabel = label;
				} else {
					picker.items = filteredItems;
				}
			};
			updatePickerItems();
			disposables.add(picker.onDidChangeValue(updatePickerItems));

			disposables.add(picker.onDidChangeActive(() => {
				const [entry] = picker.activeItems;
				if (entry) {
					entries[entry.index]?.preview();
				}
			}));

		}).catch(err => {
			onUnexpectedError(err);
			picker.hide();
		});

		return disposables;
	}
}

Registry.as<IQuickAccessRegistry>(QuickaccessExtensions.Quickaccess).registerQuickAccessProvider({
	ctor: GotoSymbolQuickAccessProvider,
	prefix: AbstractGotoSymbolQuickAccessProvider.PREFIX,
	contextKey: 'inFileSymbolsPicker',
	placeholder: localize('gotoSymbolQuickAccessPlaceholder', "Type the name of a symbol to go to."),
	helpEntries: [
		{ description: localize('gotoSymbolQuickAccess', "Go to Symbol in Editor"), prefix: AbstractGotoSymbolQuickAccessProvider.PREFIX, needsEditor: true },
		{ description: localize('gotoSymbolByCategoryQuickAccess', "Go to Symbol in Editor by Category"), prefix: AbstractGotoSymbolQuickAccessProvider.PREFIX_BY_CATEGORY, needsEditor: true }
	]
});

registerAction2(class GotoSymbolAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.gotoSymbol',
			title: {
				value: localize('gotoSymbol', "Go to Symbol in Editor..."),
				original: 'Go to Symbol in Editor...'
			},
			f1: true,
			keybinding: {
				when: undefined,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_O
			}
		});
	}

	run(accessor: ServicesAccessor) {
		accessor.get(IQuickInputService).quickAccess.show(GotoSymbolQuickAccessProvider.PREFIX);
	}
});

//#region toc definition and logic

export interface ITableOfContentsEntry {
	icon?: ThemeIcon;
	label: string;
	detail?: string;
	description?: string;
	pick(): any;
	preview(): any;
}

export interface ITableOfContentsProvider<T extends IEditorPane = IEditorPane> {

	provideTableOfContents(editor: T, context: { disposables: DisposableStore }, token: CancellationToken): Promise<ITableOfContentsEntry[] | undefined | null>;
}

class ProviderRegistry {

	private readonly _provider = new Map<string, ITableOfContentsProvider>();

	register(type: string, provider: ITableOfContentsProvider): IDisposable {
		this._provider.set(type, provider);
		return toDisposable(() => {
			if (this._provider.get(type) === provider) {
				this._provider.delete(type);
			}
		});
	}

	get(type: string): ITableOfContentsProvider | undefined {
		return this._provider.get(type);
	}

	has(type: string): boolean {
		return this._provider.has(type);
	}
}

export const TableOfContentsProviderRegistry = new ProviderRegistry();

//#endregion
