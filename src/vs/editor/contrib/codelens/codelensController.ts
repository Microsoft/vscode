/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, RunOnceScheduler, createCancelablePromise, disposableTimeout } from 'vs/base/common/async';
import { onUnexpectedError, onUnexpectedExternalError } from 'vs/base/common/errors';
import { toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { StableEditorScrollState } from 'vs/editor/browser/core/editorState';
import { ICodeEditor, MouseTargetType, IViewZoneChangeAccessor, IActiveCodeEditor } from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution, ServicesAccessor, registerEditorAction, EditorAction } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { IModelDecorationsChangeAccessor } from 'vs/editor/common/model';
import { CodeLensProviderRegistry, CodeLens, Command } from 'vs/editor/common/modes';
import { CodeLensModel, getCodeLensModel, CodeLensItem } from 'vs/editor/contrib/codelens/codelens';
import { CodeLensWidget, CodeLensHelper } from 'vs/editor/contrib/codelens/codelensWidget';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ICodeLensCache } from 'vs/editor/contrib/codelens/codeLensCache';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import * as dom from 'vs/base/browser/dom';
import { hash } from 'vs/base/common/hash';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { localize } from 'vs/nls';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { LanguageFeatureRequestDelays } from 'vs/editor/common/modes/languageFeatureRegistry';

export class CodeLensContribution implements IEditorContribution {

	static readonly ID: string = 'css.editor.codeLens';

	private readonly _disposables = new DisposableStore();
	private readonly _localToDispose = new DisposableStore();
	private readonly _styleElement: HTMLStyleElement;
	private readonly _styleClassName: string;
	private readonly _lenses: CodeLensWidget[] = [];

	private readonly _getCodeLensModelDelays = new LanguageFeatureRequestDelays(CodeLensProviderRegistry, 250, 2500);
	private _getCodeLensModelPromise: CancelablePromise<CodeLensModel> | undefined;
	private _oldCodeLensModels = new DisposableStore();
	private _currentCodeLensModel: CodeLensModel | undefined;
	private readonly _resolveCodeLensesDelays = new LanguageFeatureRequestDelays(CodeLensProviderRegistry, 250, 2500);
	private readonly _resolveCodeLensesScheduler = new RunOnceScheduler(() => this._resolveCodeLensesInViewport(), this._resolveCodeLensesDelays.min);
	private _resolveCodeLensesPromise: CancelablePromise<any> | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		@ICommandService private readonly _commandService: ICommandService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ICodeLensCache private readonly _codeLensCache: ICodeLensCache
	) {

		this._disposables.add(this._editor.onDidChangeModel(() => this._onModelChange()));
		this._disposables.add(this._editor.onDidChangeModelLanguage(() => this._onModelChange()));
		this._disposables.add(this._editor.onDidChangeConfiguration((e) => {
			if (e.hasChanged(EditorOption.fontInfo) || e.hasChanged(EditorOption.codeLensFontSize) || e.hasChanged(EditorOption.codeLensFontFamily)) {
				this._updateLensStyle();
			}
			if (e.hasChanged(EditorOption.codeLens)) {
				this._onModelChange();
			}
		}));
		this._disposables.add(CodeLensProviderRegistry.onDidChange(this._onModelChange, this));
		this._onModelChange();

		this._styleClassName = '_' + hash(this._editor.getId()).toString(16);
		this._styleElement = dom.createStyleSheet(
			dom.isInShadowDOM(this._editor.getContainerDomNode())
				? this._editor.getContainerDomNode()
				: undefined
		);
		this._updateLensStyle();
	}

	dispose(): void {
		this._localDispose();
		this._disposables.dispose();
		this._oldCodeLensModels.dispose();
		this._currentCodeLensModel?.dispose();
		this._styleElement.remove();
	}

	private _getLayoutInfo() {
		let fontSize = this._editor.getOption(EditorOption.codeLensFontSize);
		let codeLensHeight: number;
		if (!fontSize || fontSize < 5) {
			fontSize = (this._editor.getOption(EditorOption.fontSize) * .9) | 0;
			codeLensHeight = this._editor.getOption(EditorOption.lineHeight);
		} else {
			codeLensHeight = (fontSize * Math.max(1.3, this._editor.getOption(EditorOption.lineHeight) / this._editor.getOption(EditorOption.fontSize))) | 0;
		}
		return { codeLensHeight, fontSize };
	}

	private _updateLensStyle(): void {

		const { codeLensHeight, fontSize } = this._getLayoutInfo();
		const fontFamily = this._editor.getOption(EditorOption.codeLensFontFamily);
		const editorFontInfo = this._editor.getOption(EditorOption.fontInfo);

		const fontFamilyVar = `--codelens-font-family${this._styleClassName}`;
		const fontFeaturesVar = `--codelens-font-features${this._styleClassName}`;

		let newStyle = `
		.monaco-editor .codelens-decoration.${this._styleClassName} { line-height: ${codeLensHeight}px; font-size: ${fontSize}px; padding-right: ${Math.round(fontSize * 0.5)}px; font-feature-settings: var(${fontFeaturesVar}) }
		.monaco-editor .codelens-decoration.${this._styleClassName} span.codicon { line-height: ${codeLensHeight}px; font-size: ${fontSize}px; }
		`;
		if (fontFamily) {
			newStyle += `.monaco-editor .codelens-decoration.${this._styleClassName} { font-family: var(${fontFamilyVar})}`;
		}
		this._styleElement.textContent = newStyle;
		this._editor.getContainerDomNode().style.setProperty(fontFamilyVar, fontFamily ?? 'inherit');
		this._editor.getContainerDomNode().style.setProperty(fontFeaturesVar, editorFontInfo.fontFeatureSettings);

		//
		this._editor.changeViewZones(accessor => {
			for (let lens of this._lenses) {
				lens.updateHeight(codeLensHeight, accessor);
			}
		});
	}

	private _localDispose(): void {
		this._getCodeLensModelPromise?.cancel();
		this._getCodeLensModelPromise = undefined;
		this._resolveCodeLensesPromise?.cancel();
		this._resolveCodeLensesPromise = undefined;
		this._localToDispose.clear();
		this._oldCodeLensModels.clear();
		this._currentCodeLensModel?.dispose();
	}

	private _onModelChange(): void {

		this._localDispose();

		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		if (!this._editor.getOption(EditorOption.codeLens)) {
			return;
		}

		const cachedLenses = this._codeLensCache.get(model);
		if (cachedLenses) {
			this._renderCodeLensSymbols(cachedLenses);
		}

		if (!CodeLensProviderRegistry.has(model)) {
			// no provider -> return but check with
			// cached lenses. they expire after 30 seconds
			if (cachedLenses) {
				this._localToDispose.add(disposableTimeout(() => {
					const cachedLensesNow = this._codeLensCache.get(model);
					if (cachedLenses === cachedLensesNow) {
						this._codeLensCache.delete(model);
						this._onModelChange();
					}
				}, 30 * 1000));
			}
			return;
		}

		for (const provider of CodeLensProviderRegistry.all(model)) {
			if (typeof provider.onDidChange === 'function') {
				let registration = provider.onDidChange(() => scheduler.schedule());
				this._localToDispose.add(registration);
			}
		}

		const scheduler = new RunOnceScheduler(() => {
			const t1 = Date.now();

			this._getCodeLensModelPromise?.cancel();
			this._getCodeLensModelPromise = createCancelablePromise(token => getCodeLensModel(model, token));

			this._getCodeLensModelPromise.then(result => {
				if (this._currentCodeLensModel) {
					this._oldCodeLensModels.add(this._currentCodeLensModel);
				}
				this._currentCodeLensModel = result;

				// cache model to reduce flicker
				this._codeLensCache.put(model, result);

				// update moving average
				const newDelay = this._getCodeLensModelDelays.update(model, Date.now() - t1);
				scheduler.delay = newDelay;

				// render lenses
				this._renderCodeLensSymbols(result);
				this._resolveCodeLensesInViewport();
			}, onUnexpectedError);

		}, this._getCodeLensModelDelays.get(model));

		this._localToDispose.add(scheduler);
		this._localToDispose.add(toDisposable(() => this._resolveCodeLensesScheduler.cancel()));
		this._localToDispose.add(this._editor.onDidChangeModelContent(() => {
			this._editor.changeDecorations(decorationsAccessor => {
				this._editor.changeViewZones(viewZonesAccessor => {
					let toDispose: CodeLensWidget[] = [];
					let lastLensLineNumber: number = -1;

					this._lenses.forEach((lens) => {
						if (!lens.isValid() || lastLensLineNumber === lens.getLineNumber()) {
							// invalid -> lens collapsed, attach range doesn't exist anymore
							// line_number -> lenses should never be on the same line
							toDispose.push(lens);

						} else {
							lens.update(viewZonesAccessor);
							lastLensLineNumber = lens.getLineNumber();
						}
					});

					let helper = new CodeLensHelper();
					toDispose.forEach((l) => {
						l.dispose(helper, viewZonesAccessor);
						this._lenses.splice(this._lenses.indexOf(l), 1);
					});
					helper.commit(decorationsAccessor);
				});
			});

			// Ask for all references again
			scheduler.schedule();
		}));
		this._localToDispose.add(this._editor.onDidFocusEditorWidget(() => {
			scheduler.schedule();
		}));
		this._localToDispose.add(this._editor.onDidScrollChange(e => {
			if (e.scrollTopChanged && this._lenses.length > 0) {
				this._resolveCodeLensesInViewportSoon();
			}
		}));
		this._localToDispose.add(this._editor.onDidLayoutChange(() => {
			this._resolveCodeLensesInViewportSoon();
		}));
		this._localToDispose.add(toDisposable(() => {
			if (this._editor.getModel()) {
				const scrollState = StableEditorScrollState.capture(this._editor);
				this._editor.changeDecorations(decorationsAccessor => {
					this._editor.changeViewZones(viewZonesAccessor => {
						this._disposeAllLenses(decorationsAccessor, viewZonesAccessor);
					});
				});
				scrollState.restore(this._editor);
			} else {
				// No accessors available
				this._disposeAllLenses(undefined, undefined);
			}
		}));
		this._localToDispose.add(this._editor.onMouseDown(e => {
			if (e.target.type !== MouseTargetType.CONTENT_WIDGET) {
				return;
			}
			let target = e.target.element;
			if (target?.tagName === 'SPAN') {
				target = target.parentElement;
			}
			if (target?.tagName === 'A') {
				for (const lens of this._lenses) {
					let command = lens.getCommand(target as HTMLLinkElement);
					if (command) {
						this._commandService.executeCommand(command.id, ...(command.arguments || [])).catch(err => this._notificationService.error(err));
						break;
					}
				}
			}
		}));
		scheduler.schedule();
	}

	private _disposeAllLenses(decChangeAccessor: IModelDecorationsChangeAccessor | undefined, viewZoneChangeAccessor: IViewZoneChangeAccessor | undefined): void {
		const helper = new CodeLensHelper();
		for (const lens of this._lenses) {
			lens.dispose(helper, viewZoneChangeAccessor);
		}
		if (decChangeAccessor) {
			helper.commit(decChangeAccessor);
		}
		this._lenses.length = 0;
	}

	private _renderCodeLensSymbols(symbols: CodeLensModel): void {
		if (!this._editor.hasModel()) {
			return;
		}

		let maxLineNumber = this._editor.getModel().getLineCount();
		let groups: CodeLensItem[][] = [];
		let lastGroup: CodeLensItem[] | undefined;

		for (let symbol of symbols.lenses) {
			let line = symbol.symbol.range.startLineNumber;
			if (line < 1 || line > maxLineNumber) {
				// invalid code lens
				continue;
			} else if (lastGroup && lastGroup[lastGroup.length - 1].symbol.range.startLineNumber === line) {
				// on same line as previous
				lastGroup.push(symbol);
			} else {
				// on later line as previous
				lastGroup = [symbol];
				groups.push(lastGroup);
			}
		}

		const scrollState = StableEditorScrollState.capture(this._editor);
		const layoutInfo = this._getLayoutInfo();

		this._editor.changeDecorations(decorationsAccessor => {
			this._editor.changeViewZones(viewZoneAccessor => {

				const helper = new CodeLensHelper();
				let codeLensIndex = 0;
				let groupsIndex = 0;

				while (groupsIndex < groups.length && codeLensIndex < this._lenses.length) {

					let symbolsLineNumber = groups[groupsIndex][0].symbol.range.startLineNumber;
					let codeLensLineNumber = this._lenses[codeLensIndex].getLineNumber();

					if (codeLensLineNumber < symbolsLineNumber) {
						this._lenses[codeLensIndex].dispose(helper, viewZoneAccessor);
						this._lenses.splice(codeLensIndex, 1);
					} else if (codeLensLineNumber === symbolsLineNumber) {
						this._lenses[codeLensIndex].updateCodeLensSymbols(groups[groupsIndex], helper);
						groupsIndex++;
						codeLensIndex++;
					} else {
						this._lenses.splice(codeLensIndex, 0, new CodeLensWidget(groups[groupsIndex], <IActiveCodeEditor>this._editor, this._styleClassName, helper, viewZoneAccessor, layoutInfo.codeLensHeight, () => this._resolveCodeLensesInViewportSoon()));
						codeLensIndex++;
						groupsIndex++;
					}
				}

				// Delete extra code lenses
				while (codeLensIndex < this._lenses.length) {
					this._lenses[codeLensIndex].dispose(helper, viewZoneAccessor);
					this._lenses.splice(codeLensIndex, 1);
				}

				// Create extra symbols
				while (groupsIndex < groups.length) {
					this._lenses.push(new CodeLensWidget(groups[groupsIndex], <IActiveCodeEditor>this._editor, this._styleClassName, helper, viewZoneAccessor, layoutInfo.codeLensHeight, () => this._resolveCodeLensesInViewportSoon()));
					groupsIndex++;
				}

				helper.commit(decorationsAccessor);
			});
		});

		scrollState.restore(this._editor);
	}

	private _resolveCodeLensesInViewportSoon(): void {
		const model = this._editor.getModel();
		if (model) {
			this._resolveCodeLensesScheduler.schedule();
		}
	}

	private _resolveCodeLensesInViewport(): void {

		this._resolveCodeLensesPromise?.cancel();
		this._resolveCodeLensesPromise = undefined;

		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		const toResolve: CodeLensItem[][] = [];
		const lenses: CodeLensWidget[] = [];
		this._lenses.forEach((lens) => {
			const request = lens.computeIfNecessary(model);
			if (request) {
				toResolve.push(request);
				lenses.push(lens);
			}
		});

		if (toResolve.length === 0) {
			return;
		}

		const t1 = Date.now();

		const resolvePromise = createCancelablePromise(token => {

			const promises = toResolve.map((request, i) => {

				const resolvedSymbols = new Array<CodeLens | undefined | null>(request.length);
				const promises = request.map((request, i) => {
					if (!request.symbol.command && typeof request.provider.resolveCodeLens === 'function') {
						return Promise.resolve(request.provider.resolveCodeLens(model, request.symbol, token)).then(symbol => {
							resolvedSymbols[i] = symbol;
						}, onUnexpectedExternalError);
					} else {
						resolvedSymbols[i] = request.symbol;
						return Promise.resolve(undefined);
					}
				});

				return Promise.all(promises).then(() => {
					if (!token.isCancellationRequested && !lenses[i].isDisposed()) {
						lenses[i].updateCommands(resolvedSymbols);
					}
				});
			});

			return Promise.all(promises);
		});
		this._resolveCodeLensesPromise = resolvePromise;

		this._resolveCodeLensesPromise.then(() => {

			// update moving average
			const newDelay = this._resolveCodeLensesDelays.update(model, Date.now() - t1);
			this._resolveCodeLensesScheduler.delay = newDelay;

			if (this._currentCodeLensModel) { // update the cached state with new resolved items
				this._codeLensCache.put(model, this._currentCodeLensModel);
			}
			this._oldCodeLensModels.clear(); // dispose old models once we have updated the UI with the current model
			if (resolvePromise === this._resolveCodeLensesPromise) {
				this._resolveCodeLensesPromise = undefined;
			}
		}, err => {
			onUnexpectedError(err); // can also be cancellation!
			if (resolvePromise === this._resolveCodeLensesPromise) {
				this._resolveCodeLensesPromise = undefined;
			}
		});
	}

	getLenses(): readonly CodeLensWidget[] {
		return this._lenses;
	}
}

registerEditorContribution(CodeLensContribution.ID, CodeLensContribution);

registerEditorAction(class ShowLensesInCurrentLine extends EditorAction {

	constructor() {
		super({
			id: 'codelens.showLensesInCurrentLine',
			precondition: EditorContextKeys.hasCodeLensProvider,
			label: localize('showLensOnLine', "Show CodeLens Commands For Current Line"),
			alias: 'Show CodeLens Commands For Current Line',
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {

		if (!editor.hasModel()) {
			return;
		}

		const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);
		const notificationService = accessor.get(INotificationService);

		const lineNumber = editor.getSelection().positionLineNumber;
		const codelensController = editor.getContribution<CodeLensContribution>(CodeLensContribution.ID);
		const items: { label: string, command: Command }[] = [];

		for (let lens of codelensController.getLenses()) {
			if (lens.getLineNumber() === lineNumber) {
				for (let item of lens.getItems()) {
					const { command } = item.symbol;
					if (command) {
						items.push({
							label: command.title,
							command: command
						});
					}
				}
			}
		}

		if (items.length === 0) {
			// We dont want an empty picker
			return;
		}

		const item = await quickInputService.pick(items, { canPickMany: false });
		if (!item) {
			// Nothing picked
			return;
		}

		try {
			await commandService.executeCommand(item.command.id, ...(item.command.arguments || []));
		} catch (err) {
			notificationService.error(err);
		}
	}
});
