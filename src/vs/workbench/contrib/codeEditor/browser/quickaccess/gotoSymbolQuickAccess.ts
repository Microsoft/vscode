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
import { IWorkbenchEditorConfiguration } from 'vs/workbench/common/editor';
import { ITextModel } from 'vs/editor/common/model';
import { DisposableStore, IDisposable, toDisposable, Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { timeout } from 'vs/base/common/async';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { prepareQuery } from 'vs/base/common/fuzzyScorer';
import { SymbolKind } from 'vs/editor/common/modes';
import { fuzzyScore, createMatches } from 'vs/base/common/filters';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IQuickAccessTextEditorContext } from 'vs/editor/contrib/quickAccess/editorNavigationQuickAccess';
import { IOutlineService, OutlineTarget } from 'vs/workbench/services/outline/browser/outline';
import { isCompositeEditor } from 'vs/editor/browser/editorBrowser';

export class GotoSymbolQuickAccessProvider extends AbstractGotoSymbolQuickAccessProvider {

	protected readonly onDidActiveTextEditorControlChange = this.editorService.onDidActiveEditorChange;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IOutlineService private readonly outlineService: IOutlineService,
	) {
		super({
			openSideBySideDirection: () => this.configuration.openSideBySideDirection
		});
	}

	//#region DocumentSymbols (text editor required)

	private get configuration() {
		const editorConfig = this.configurationService.getValue<IWorkbenchEditorConfiguration>().workbench?.editor;

		return {
			openEditorPinned: !editorConfig?.enablePreviewFromQuickOpen || !editorConfig?.enablePreview,
			openSideBySideDirection: editorConfig?.openSideBySideDirection
		};
	}

	protected get activeTextEditorControl() {
		// TODO@bpasero this distinction should go away by adopting `IOutlineService`
		// for all editors (either text based ones or not). Currently text based
		// editors are not yet using the new outline service infrastructure but the
		// "classical" document symbols approach.

		if (isCompositeEditor(this.editorService.activeEditorPane?.getControl())) {
			return undefined;
		}

		return this.editorService.activeTextEditorControl;
	}

	protected override gotoLocation(context: IQuickAccessTextEditorContext, options: { range: IRange, keyMods: IKeyMods, forceSideBySide?: boolean, preserveFocus?: boolean }): void {

		// Check for sideBySide use
		if ((options.keyMods.alt || (this.configuration.openEditorPinned && options.keyMods.ctrlCmd) || options.forceSideBySide) && this.editorService.activeEditor) {
			context.restoreViewState?.(); // since we open to the side, restore view state in this editor

			this.editorService.openEditor(this.editorService.activeEditor, {
				selection: options.range,
				pinned: options.keyMods.ctrlCmd || this.configuration.openEditorPinned,
				preserveFocus: options.preserveFocus
			}, SIDE_GROUP);
		}

		// Otherwise let parent handle it
		else {
			super.gotoLocation(context, options);
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

		return this.doGetSymbolPicks(this.getDocumentSymbols(model, token), prepareQuery(filter), options, token);
	}

	override addDecorations(editor: IEditor, range: IRange): void {
		super.addDecorations(editor, range);
	}

	override clearDecorations(editor: IEditor): void {
		super.clearDecorations(editor);
	}

	//#endregion

	protected override provideWithoutTextEditor(picker: IQuickPick<IGotoSymbolQuickPickItem>): IDisposable {
		if (this.canPickWithOutlineService()) {
			return this.doGetOutlinePicks(picker);
		}
		return super.provideWithoutTextEditor(picker);
	}

	private canPickWithOutlineService(): boolean {
		return this.editorService.activeEditorPane ? this.outlineService.canCreateOutline(this.editorService.activeEditorPane) : false;
	}

	private doGetOutlinePicks(picker: IQuickPick<IGotoSymbolQuickPickItem>): IDisposable {
		const pane = this.editorService.activeEditorPane;
		if (!pane) {
			return Disposable.None;
		}
		const cts = new CancellationTokenSource();

		const disposables = new DisposableStore();
		disposables.add(toDisposable(() => cts.dispose(true)));

		picker.busy = true;

		this.outlineService.createOutline(pane, OutlineTarget.QuickPick, cts.token).then(outline => {

			if (!outline) {
				return;
			}
			if (cts.token.isCancellationRequested) {
				outline.dispose();
				return;
			}

			disposables.add(outline);

			const viewState = outline.captureViewState();
			disposables.add(toDisposable(() => {
				if (picker.selectedItems.length === 0) {
					viewState.dispose();
				}
			}));

			const entries = outline.config.quickPickDataSource.getQuickPickElements();

			const items: IGotoSymbolQuickPickItem[] = entries.map((entry, idx) => {
				return {
					kind: SymbolKind.File,
					index: idx,
					score: 0,
					label: entry.label,
					description: entry.description,
					ariaLabel: entry.ariaLabel,
					iconClasses: entry.iconClasses
				};
			});

			disposables.add(picker.onDidAccept(() => {
				picker.hide();
				const [entry] = picker.selectedItems;
				if (entry && entries[entry.index]) {
					outline.reveal(entries[entry.index].element, {}, false);
				}
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

			const previewDisposable = new MutableDisposable();
			disposables.add(previewDisposable);

			disposables.add(picker.onDidChangeActive(() => {
				const [entry] = picker.activeItems;
				if (entry && entries[entry.index]) {
					previewDisposable.value = outline.preview(entries[entry.index].element);
				} else {
					previewDisposable.clear();
				}
			}));

		}).catch(err => {
			onUnexpectedError(err);
			picker.hide();
		}).finally(() => {
			picker.busy = false;
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
