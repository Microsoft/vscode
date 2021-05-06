/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

import 'vs/css!./media/dirtydiffDecorator';
import { ThrottledDelayer, first } from 'vs/base/common/async';
import { IDisposable, dispose, toDisposable, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import * as ext from 'vs/workbench/common/contributions';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IResolvedTextEditorModel, ITextModelService } from 'vs/editor/common/services/resolverService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { URI } from 'vs/base/common/uri';
import { ISCMService, ISCMRepository, ISCMProvider } from 'vs/workbench/contrib/scm/common/scm';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { registerThemingParticipant, IColorTheme, ICssStyleCollector, themeColorFromId, IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { registerColor, transparent } from 'vs/platform/theme/common/colorRegistry';
import { Color, RGBA } from 'vs/base/common/color';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { registerEditorAction, registerEditorContribution, ServicesAccessor, EditorAction } from 'vs/editor/browser/editorExtensions';
import { PeekViewWidget, getOuterEditor, peekViewBorder, peekViewTitleBackground, peekViewTitleForeground, peekViewTitleInfoForeground } from 'vs/editor/contrib/peekView/peekView';
import { IContextKeyService, IContextKey, ContextKeyExpr, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Position } from 'vs/editor/common/core/position';
import { rot } from 'vs/base/common/numbers';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { EmbeddedDiffEditorWidget } from 'vs/editor/browser/widget/embeddedCodeEditorWidget';
import { IDiffEditorOptions, EditorOption } from 'vs/editor/common/config/editorOptions';
import { Action, IAction, ActionRunner } from 'vs/base/common/actions';
import { IActionBarOptions } from 'vs/base/browser/ui/actionbar/actionbar';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { basename, isEqualOrParent } from 'vs/base/common/resources';
import { MenuId, IMenuService, IMenu, MenuItemAction, MenuRegistry } from 'vs/platform/actions/common/actions';
import { createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IChange, IEditorModel, ScrollType, IEditorContribution, IDiffEditorModel } from 'vs/editor/common/editorCommon';
import { OverviewRulerLane, ITextModel, IModelDecorationOptions, MinimapPosition } from 'vs/editor/common/model';
import { sortedDiff } from 'vs/base/common/arrays';
import { IMarginData } from 'vs/editor/browser/controller/mouseTarget';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { ISplice } from 'vs/base/common/sequence';
import { createStyleSheet } from 'vs/base/browser/dom';
import { EncodingMode, ITextFileEditorModel, IResolvedTextFileEditorModel, ITextFileService, isTextFileEditorModel } from 'vs/workbench/services/textfile/common/textfiles';
import { gotoNextLocation, gotoPreviousLocation } from 'vs/platform/theme/common/iconRegistry';
import { Codicon } from 'vs/base/common/codicons';

class DiffActionRunner extends ActionRunner {

	override runAction(action: IAction, context: any): Promise<any> {
		if (action instanceof MenuItemAction) {
			return action.run(...context);
		}

		return super.runAction(action, context);
	}
}

export interface IModelRegistry {
	getModel(editorModel: IEditorModel): DirtyDiffModel | null;
}

export const isDirtyDiffVisible = new RawContextKey<boolean>('dirtyDiffVisible', false);

function getChangeHeight(change: IChange): number {
	const modified = change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
	const original = change.originalEndLineNumber - change.originalStartLineNumber + 1;

	if (change.originalEndLineNumber === 0) {
		return modified;
	} else if (change.modifiedEndLineNumber === 0) {
		return original;
	} else {
		return modified + original;
	}
}

function getModifiedEndLineNumber(change: IChange): number {
	if (change.modifiedEndLineNumber === 0) {
		return change.modifiedStartLineNumber === 0 ? 1 : change.modifiedStartLineNumber;
	} else {
		return change.modifiedEndLineNumber;
	}
}

function lineIntersectsChange(lineNumber: number, change: IChange): boolean {
	// deletion at the beginning of the file
	if (lineNumber === 1 && change.modifiedStartLineNumber === 0 && change.modifiedEndLineNumber === 0) {
		return true;
	}

	return lineNumber >= change.modifiedStartLineNumber && lineNumber <= (change.modifiedEndLineNumber || change.modifiedStartLineNumber);
}

class UIEditorAction extends Action {

	private editor: ICodeEditor;
	private action: EditorAction;
	private instantiationService: IInstantiationService;

	constructor(
		editor: ICodeEditor,
		action: EditorAction,
		cssClass: string,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		const keybinding = keybindingService.lookupKeybinding(action.id);
		const label = action.label + (keybinding ? ` (${keybinding.getLabel()})` : '');

		super(action.id, label, cssClass);

		this.instantiationService = instantiationService;
		this.action = action;
		this.editor = editor;
	}

	override run(): Promise<any> {
		return Promise.resolve(this.instantiationService.invokeFunction(accessor => this.action.run(accessor, this.editor, null)));
	}
}

enum ChangeType {
	Modify,
	Add,
	Delete
}

function getChangeType(change: IChange): ChangeType {
	if (change.originalEndLineNumber === 0) {
		return ChangeType.Add;
	} else if (change.modifiedEndLineNumber === 0) {
		return ChangeType.Delete;
	} else {
		return ChangeType.Modify;
	}
}

function getChangeTypeColor(theme: IColorTheme, changeType: ChangeType): Color | undefined {
	switch (changeType) {
		case ChangeType.Modify: return theme.getColor(editorGutterModifiedBackground);
		case ChangeType.Add: return theme.getColor(editorGutterAddedBackground);
		case ChangeType.Delete: return theme.getColor(editorGutterDeletedBackground);
	}
}

function getOuterEditorFromDiffEditor(accessor: ServicesAccessor): ICodeEditor | null {
	const diffEditors = accessor.get(ICodeEditorService).listDiffEditors();

	for (const diffEditor of diffEditors) {
		if (diffEditor.hasTextFocus() && diffEditor instanceof EmbeddedDiffEditorWidget) {
			return diffEditor.getParentEditor();
		}
	}

	return getOuterEditor(accessor);
}

class DirtyDiffWidget extends PeekViewWidget {

	private diffEditor!: EmbeddedDiffEditorWidget;
	private title: string;
	private menu: IMenu;
	private index: number = 0;
	private change: IChange | undefined;
	private height: number | undefined = undefined;

	constructor(
		editor: ICodeEditor,
		private model: DirtyDiffModel,
		@IThemeService private readonly themeService: IThemeService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService _contextKeyService: IContextKeyService
	) {
		super(editor, { isResizeable: true, frameWidth: 1, keepEditorSelection: true }, instantiationService);

		this._disposables.add(themeService.onDidColorThemeChange(this._applyTheme, this));
		this._applyTheme(themeService.getColorTheme());

		const contextKeyService = _contextKeyService.createOverlay([
			['originalResourceScheme', this.model.original!.uri.scheme]
		]);
		this.menu = menuService.createMenu(MenuId.SCMChangeContext, contextKeyService);

		this.create();
		if (editor.hasModel()) {
			this.title = basename(editor.getModel().uri);
		} else {
			this.title = '';
		}
		this.setTitle(this.title);

		this._disposables.add(model.onDidChange(this.renderTitle, this));
	}

	showChange(index: number): void {
		const change = this.model.changes[index];
		this.index = index;
		this.change = change;

		const originalModel = this.model.original;

		if (!originalModel) {
			return;
		}

		const onFirstDiffUpdate = Event.once(this.diffEditor.onDidUpdateDiff);

		// TODO@joao TODO@alex need this setTimeout probably because the
		// non-side-by-side diff still hasn't created the view zones
		onFirstDiffUpdate(() => setTimeout(() => this.revealChange(change), 0));

		this.diffEditor.setModel(this.model as IDiffEditorModel);

		const position = new Position(getModifiedEndLineNumber(change), 1);

		const lineHeight = this.editor.getOption(EditorOption.lineHeight);
		const editorHeight = this.editor.getLayoutInfo().height;
		const editorHeightInLines = Math.floor(editorHeight / lineHeight);
		const height = Math.min(getChangeHeight(change) + /* padding */ 8, Math.floor(editorHeightInLines / 3));

		this.renderTitle();

		const changeType = getChangeType(change);
		const changeTypeColor = getChangeTypeColor(this.themeService.getColorTheme(), changeType);
		this.style({ frameColor: changeTypeColor, arrowColor: changeTypeColor });

		this._actionbarWidget!.context = [this.model.modified!.uri, this.model.changes, index];
		this.show(position, height);
		this.editor.focus();
	}

	private renderTitle(): void {
		const detail = this.model.changes.length > 1
			? nls.localize('changes', "{0} of {1} changes", this.index + 1, this.model.changes.length)
			: nls.localize('change', "{0} of {1} change", this.index + 1, this.model.changes.length);

		this.setTitle(this.title, detail);
	}

	protected override _fillHead(container: HTMLElement): void {
		super._fillHead(container, true);

		const previous = this.instantiationService.createInstance(UIEditorAction, this.editor, new ShowPreviousChangeAction(), ThemeIcon.asClassName(gotoPreviousLocation));
		const next = this.instantiationService.createInstance(UIEditorAction, this.editor, new ShowNextChangeAction(), ThemeIcon.asClassName(gotoNextLocation));

		this._disposables.add(previous);
		this._disposables.add(next);

		const actions: IAction[] = [];
		this._disposables.add(createAndFillInActionBarActions(this.menu, { shouldForwardArgs: true }, actions));
		this._actionbarWidget!.push(actions.reverse(), { label: false, icon: true });
		this._actionbarWidget!.push([next, previous], { label: false, icon: true });
		this._actionbarWidget!.push(new Action('peekview.close', nls.localize('label.close', "Close"), Codicon.close.classNames, true, async () => {
			this.dispose();
		}), { label: false, icon: true });
	}

	protected override _getActionBarOptions(): IActionBarOptions {
		const actionRunner = new DiffActionRunner();

		// close widget on successful action
		actionRunner.onDidRun(e => {
			if (!(e.action instanceof UIEditorAction) && !e.error) {
				this.dispose();
			}
		});

		return {
			...super._getActionBarOptions(),
			actionRunner
		};
	}

	protected _fillBody(container: HTMLElement): void {
		const options: IDiffEditorOptions = {
			scrollBeyondLastLine: true,
			scrollbar: {
				verticalScrollbarSize: 14,
				horizontal: 'auto',
				useShadows: true,
				verticalHasArrows: false,
				horizontalHasArrows: false
			},
			overviewRulerLanes: 2,
			fixedOverflowWidgets: true,
			minimap: { enabled: false },
			renderSideBySide: false,
			readOnly: false,
			ignoreTrimWhitespace: false
		};

		this.diffEditor = this.instantiationService.createInstance(EmbeddedDiffEditorWidget, container, options, this.editor);
	}

	override _onWidth(width: number): void {
		if (typeof this.height === 'undefined') {
			return;
		}

		this.diffEditor.layout({ height: this.height, width });
	}

	protected override _doLayoutBody(height: number, width: number): void {
		super._doLayoutBody(height, width);
		this.diffEditor.layout({ height, width });

		if (typeof this.height === 'undefined' && this.change) {
			this.revealChange(this.change);
		}

		this.height = height;
	}

	private revealChange(change: IChange): void {
		let start: number, end: number;

		if (change.modifiedEndLineNumber === 0) { // deletion
			start = change.modifiedStartLineNumber;
			end = change.modifiedStartLineNumber + 1;
		} else if (change.originalEndLineNumber > 0) { // modification
			start = change.modifiedStartLineNumber - 1;
			end = change.modifiedEndLineNumber + 1;
		} else { // insertion
			start = change.modifiedStartLineNumber;
			end = change.modifiedEndLineNumber;
		}

		this.diffEditor.revealLinesInCenter(start, end, ScrollType.Immediate);
	}

	private _applyTheme(theme: IColorTheme) {
		const borderColor = theme.getColor(peekViewBorder) || Color.transparent;
		this.style({
			arrowColor: borderColor,
			frameColor: borderColor,
			headerBackgroundColor: theme.getColor(peekViewTitleBackground) || Color.transparent,
			primaryHeadingColor: theme.getColor(peekViewTitleForeground),
			secondaryHeadingColor: theme.getColor(peekViewTitleInfoForeground)
		});
	}

	protected override revealLine(lineNumber: number) {
		this.editor.revealLineInCenterIfOutsideViewport(lineNumber, ScrollType.Smooth);
	}

	hasFocus(): boolean {
		return this.diffEditor.hasTextFocus();
	}
}

export class ShowPreviousChangeAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.dirtydiff.previous',
			label: nls.localize('show previous change', "Show Previous Change"),
			alias: 'Show Previous Change',
			precondition: undefined,
			kbOpts: { kbExpr: EditorContextKeys.editorTextFocus, primary: KeyMod.Shift | KeyMod.Alt | KeyCode.F3, weight: KeybindingWeight.EditorContrib }
		});
	}

	run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const outerEditor = getOuterEditorFromDiffEditor(accessor);

		if (!outerEditor) {
			return;
		}

		const controller = DirtyDiffController.get(outerEditor);

		if (!controller) {
			return;
		}

		if (!controller.canNavigate()) {
			return;
		}

		controller.previous();
	}
}
registerEditorAction(ShowPreviousChangeAction);

export class ShowNextChangeAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.dirtydiff.next',
			label: nls.localize('show next change', "Show Next Change"),
			alias: 'Show Next Change',
			precondition: undefined,
			kbOpts: { kbExpr: EditorContextKeys.editorTextFocus, primary: KeyMod.Alt | KeyCode.F3, weight: KeybindingWeight.EditorContrib }
		});
	}

	run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const outerEditor = getOuterEditorFromDiffEditor(accessor);

		if (!outerEditor) {
			return;
		}

		const controller = DirtyDiffController.get(outerEditor);

		if (!controller) {
			return;
		}

		if (!controller.canNavigate()) {
			return;
		}

		controller.next();
	}
}
registerEditorAction(ShowNextChangeAction);

// Go to menu
MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '7_change_nav',
	command: {
		id: 'editor.action.dirtydiff.next',
		title: nls.localize({ key: 'miGotoNextChange', comment: ['&& denotes a mnemonic'] }, "Next &&Change")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '7_change_nav',
	command: {
		id: 'editor.action.dirtydiff.previous',
		title: nls.localize({ key: 'miGotoPreviousChange', comment: ['&& denotes a mnemonic'] }, "Previous &&Change")
	},
	order: 2
});

export class MoveToPreviousChangeAction extends EditorAction {

	constructor() {
		super({
			id: 'workbench.action.editor.previousChange',
			label: nls.localize('move to previous change', "Move to Previous Change"),
			alias: 'Move to Previous Change',
			precondition: undefined,
			kbOpts: { kbExpr: EditorContextKeys.editorTextFocus, primary: KeyMod.Shift | KeyMod.Alt | KeyCode.F5, weight: KeybindingWeight.EditorContrib }
		});
	}

	run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const outerEditor = getOuterEditorFromDiffEditor(accessor);

		if (!outerEditor || !outerEditor.hasModel()) {
			return;
		}

		const controller = DirtyDiffController.get(outerEditor);

		if (!controller || !controller.modelRegistry) {
			return;
		}

		const lineNumber = outerEditor.getPosition().lineNumber;
		const model = controller.modelRegistry.getModel(outerEditor.getModel());

		if (!model || model.changes.length === 0) {
			return;
		}

		const index = model.findPreviousClosestChange(lineNumber, false);
		const change = model.changes[index];

		const position = new Position(change.modifiedStartLineNumber, 1);
		outerEditor.setPosition(position);
		outerEditor.revealPositionInCenter(position);
	}
}
registerEditorAction(MoveToPreviousChangeAction);

export class MoveToNextChangeAction extends EditorAction {

	constructor() {
		super({
			id: 'workbench.action.editor.nextChange',
			label: nls.localize('move to next change', "Move to Next Change"),
			alias: 'Move to Next Change',
			precondition: undefined,
			kbOpts: { kbExpr: EditorContextKeys.editorTextFocus, primary: KeyMod.Alt | KeyCode.F5, weight: KeybindingWeight.EditorContrib }
		});
	}

	run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const outerEditor = getOuterEditorFromDiffEditor(accessor);

		if (!outerEditor || !outerEditor.hasModel()) {
			return;
		}

		const controller = DirtyDiffController.get(outerEditor);

		if (!controller || !controller.modelRegistry) {
			return;
		}

		const lineNumber = outerEditor.getPosition().lineNumber;
		const model = controller.modelRegistry.getModel(outerEditor.getModel());

		if (!model || model.changes.length === 0) {
			return;
		}

		const index = model.findNextClosestChange(lineNumber, false);
		const change = model.changes[index];

		const position = new Position(change.modifiedStartLineNumber, 1);
		outerEditor.setPosition(position);
		outerEditor.revealPositionInCenter(position);
	}
}
registerEditorAction(MoveToNextChangeAction);

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'closeDirtyDiff',
	weight: KeybindingWeight.EditorContrib + 50,
	primary: KeyCode.Escape,
	secondary: [KeyMod.Shift | KeyCode.Escape],
	when: ContextKeyExpr.and(isDirtyDiffVisible),
	handler: (accessor: ServicesAccessor) => {
		const outerEditor = getOuterEditorFromDiffEditor(accessor);

		if (!outerEditor) {
			return;
		}

		const controller = DirtyDiffController.get(outerEditor);

		if (!controller) {
			return;
		}

		controller.close();
	}
});

export class DirtyDiffController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.dirtydiff';

	static get(editor: ICodeEditor): DirtyDiffController {
		return editor.getContribution<DirtyDiffController>(DirtyDiffController.ID);
	}

	modelRegistry: IModelRegistry | null = null;

	private model: DirtyDiffModel | null = null;
	private widget: DirtyDiffWidget | null = null;
	private currentIndex: number = -1;
	private readonly isDirtyDiffVisible!: IContextKey<boolean>;
	private session: IDisposable = Disposable.None;
	private mouseDownInfo: { lineNumber: number } | null = null;
	private enabled = false;
	private gutterActionDisposables = new DisposableStore();
	private stylesheet: HTMLStyleElement;

	constructor(
		private editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this.enabled = !contextKeyService.getContextKeyValue('isInDiffEditor');
		this.stylesheet = createStyleSheet();
		this._register(toDisposable(() => this.stylesheet.remove()));

		if (this.enabled) {
			this.isDirtyDiffVisible = isDirtyDiffVisible.bindTo(contextKeyService);
			this._register(editor.onDidChangeModel(() => this.close()));

			const onDidChangeGutterAction = Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.diffDecorationsGutterAction'));
			this._register(onDidChangeGutterAction(this.onDidChangeGutterAction, this));
			this.onDidChangeGutterAction();
		}
	}

	private onDidChangeGutterAction(): void {
		const gutterAction = this.configurationService.getValue<'diff' | 'none'>('scm.diffDecorationsGutterAction');

		this.gutterActionDisposables.dispose();
		this.gutterActionDisposables = new DisposableStore();

		if (gutterAction === 'diff') {
			this.gutterActionDisposables.add(this.editor.onMouseDown(e => this.onEditorMouseDown(e)));
			this.gutterActionDisposables.add(this.editor.onMouseUp(e => this.onEditorMouseUp(e)));
			this.stylesheet.textContent = `
				.monaco-editor .dirty-diff-glyph {
					cursor: pointer;
				}

				.monaco-editor .margin-view-overlays .dirty-diff-glyph:hover::before {
					width: 9px;
					left: -6px;
				}

				.monaco-editor .margin-view-overlays .dirty-diff-deleted:hover::after {
					bottom: 0;
					border-top-width: 0;
					border-bottom-width: 0;
				}
			`;
		} else {
			this.stylesheet.textContent = ``;
		}
	}

	canNavigate(): boolean {
		return this.currentIndex === -1 || (!!this.model && this.model.changes.length > 1);
	}

	next(lineNumber?: number): void {
		if (!this.assertWidget()) {
			return;
		}
		if (!this.widget || !this.model) {
			return;
		}

		if (this.editor.hasModel() && (typeof lineNumber === 'number' || this.currentIndex === -1)) {
			this.currentIndex = this.model.findNextClosestChange(typeof lineNumber === 'number' ? lineNumber : this.editor.getPosition().lineNumber);
		} else {
			this.currentIndex = rot(this.currentIndex + 1, this.model.changes.length);
		}

		this.widget.showChange(this.currentIndex);
	}

	previous(lineNumber?: number): void {
		if (!this.assertWidget()) {
			return;
		}
		if (!this.widget || !this.model) {
			return;
		}

		if (this.editor.hasModel() && (typeof lineNumber === 'number' || this.currentIndex === -1)) {
			this.currentIndex = this.model.findPreviousClosestChange(typeof lineNumber === 'number' ? lineNumber : this.editor.getPosition().lineNumber);
		} else {
			this.currentIndex = rot(this.currentIndex - 1, this.model.changes.length);
		}

		this.widget.showChange(this.currentIndex);
	}

	close(): void {
		this.session.dispose();
		this.session = Disposable.None;
	}

	private assertWidget(): boolean {
		if (!this.enabled) {
			return false;
		}

		if (this.widget) {
			if (!this.model || this.model.changes.length === 0) {
				this.close();
				return false;
			}

			return true;
		}

		if (!this.modelRegistry) {
			return false;
		}

		const editorModel = this.editor.getModel();

		if (!editorModel) {
			return false;
		}

		const model = this.modelRegistry.getModel(editorModel);

		if (!model) {
			return false;
		}

		if (model.changes.length === 0) {
			return false;
		}

		this.currentIndex = -1;
		this.model = model;
		this.widget = this.instantiationService.createInstance(DirtyDiffWidget, this.editor, model);
		this.isDirtyDiffVisible.set(true);

		const disposables = new DisposableStore();
		disposables.add(Event.once(this.widget.onDidClose)(this.close, this));
		Event.chain(model.onDidChange)
			.filter(e => e.diff.length > 0)
			.map(e => e.diff)
			.event(this.onDidModelChange, this, disposables);

		disposables.add(this.widget);
		disposables.add(toDisposable(() => {
			this.model = null;
			this.widget = null;
			this.currentIndex = -1;
			this.isDirtyDiffVisible.set(false);
			this.editor.focus();
		}));

		this.session = disposables;
		return true;
	}

	private onDidModelChange(splices: ISplice<IChange>[]): void {
		if (!this.model || !this.widget || this.widget.hasFocus()) {
			return;
		}

		for (const splice of splices) {
			if (splice.start <= this.currentIndex) {
				if (this.currentIndex < splice.start + splice.deleteCount) {
					this.currentIndex = -1;
					this.next();
				} else {
					this.currentIndex = rot(this.currentIndex + splice.toInsert.length - splice.deleteCount - 1, this.model.changes.length);
					this.next();
				}
			}
		}
	}

	private onEditorMouseDown(e: IEditorMouseEvent): void {
		this.mouseDownInfo = null;

		const range = e.target.range;

		if (!range) {
			return;
		}

		if (!e.event.leftButton) {
			return;
		}

		if (e.target.type !== MouseTargetType.GUTTER_LINE_DECORATIONS) {
			return;
		}
		if (!e.target.element) {
			return;
		}
		if (e.target.element.className.indexOf('dirty-diff-glyph') < 0) {
			return;
		}

		const data = e.target.detail as IMarginData;
		const offsetLeftInGutter = (e.target.element as HTMLElement).offsetLeft;
		const gutterOffsetX = data.offsetX - offsetLeftInGutter;

		// TODO@joao TODO@alex TODO@martin this is such that we don't collide with folding
		if (gutterOffsetX < -3 || gutterOffsetX > 6) { // dirty diff decoration on hover is 9px wide
			return;
		}

		this.mouseDownInfo = { lineNumber: range.startLineNumber };
	}

	private onEditorMouseUp(e: IEditorMouseEvent): void {
		if (!this.mouseDownInfo) {
			return;
		}

		const { lineNumber } = this.mouseDownInfo;
		this.mouseDownInfo = null;

		const range = e.target.range;

		if (!range || range.startLineNumber !== lineNumber) {
			return;
		}

		if (e.target.type !== MouseTargetType.GUTTER_LINE_DECORATIONS) {
			return;
		}

		if (!this.modelRegistry) {
			return;
		}

		const editorModel = this.editor.getModel();

		if (!editorModel) {
			return;
		}

		const model = this.modelRegistry.getModel(editorModel);

		if (!model) {
			return;
		}

		const index = model.changes.findIndex(change => lineIntersectsChange(lineNumber, change));

		if (index < 0) {
			return;
		}

		if (index === this.currentIndex) {
			this.close();
		} else {
			this.next(lineNumber);
		}
	}

	getChanges(): IChange[] {
		if (!this.modelRegistry) {
			return [];
		}
		if (!this.editor.hasModel()) {
			return [];
		}

		const model = this.modelRegistry.getModel(this.editor.getModel());

		if (!model) {
			return [];
		}

		return model.changes;
	}

	override dispose(): void {
		this.gutterActionDisposables.dispose();
		super.dispose();
	}
}

export const editorGutterModifiedBackground = registerColor('editorGutter.modifiedBackground', {
	dark: new Color(new RGBA(12, 125, 157)),
	light: new Color(new RGBA(102, 175, 224)),
	hc: new Color(new RGBA(0, 155, 249))
}, nls.localize('editorGutterModifiedBackground', "Editor gutter background color for lines that are modified."));

export const editorGutterAddedBackground = registerColor('editorGutter.addedBackground', {
	dark: new Color(new RGBA(88, 124, 12)),
	light: new Color(new RGBA(129, 184, 139)),
	hc: new Color(new RGBA(51, 171, 78))
}, nls.localize('editorGutterAddedBackground', "Editor gutter background color for lines that are added."));

export const editorGutterDeletedBackground = registerColor('editorGutter.deletedBackground', {
	dark: new Color(new RGBA(148, 21, 27)),
	light: new Color(new RGBA(202, 75, 81)),
	hc: new Color(new RGBA(252, 93, 109))
}, nls.localize('editorGutterDeletedBackground', "Editor gutter background color for lines that are deleted."));

export const minimapGutterModifiedBackground = registerColor('minimapGutter.modifiedBackground', {
	dark: new Color(new RGBA(12, 125, 157)),
	light: new Color(new RGBA(102, 175, 224)),
	hc: new Color(new RGBA(0, 155, 249))
}, nls.localize('minimapGutterModifiedBackground', "Minimap gutter background color for lines that are modified."));

export const minimapGutterAddedBackground = registerColor('minimapGutter.addedBackground', {
	dark: new Color(new RGBA(88, 124, 12)),
	light: new Color(new RGBA(129, 184, 139)),
	hc: new Color(new RGBA(51, 171, 78))
}, nls.localize('minimapGutterAddedBackground', "Minimap gutter background color for lines that are added."));

export const minimapGutterDeletedBackground = registerColor('minimapGutter.deletedBackground', {
	dark: new Color(new RGBA(148, 21, 27)),
	light: new Color(new RGBA(202, 75, 81)),
	hc: new Color(new RGBA(252, 93, 109))
}, nls.localize('minimapGutterDeletedBackground', "Minimap gutter background color for lines that are deleted."));

export const overviewRulerModifiedForeground = registerColor('editorOverviewRuler.modifiedForeground', { dark: transparent(editorGutterModifiedBackground, 0.6), light: transparent(editorGutterModifiedBackground, 0.6), hc: transparent(editorGutterModifiedBackground, 0.6) }, nls.localize('overviewRulerModifiedForeground', 'Overview ruler marker color for modified content.'));
export const overviewRulerAddedForeground = registerColor('editorOverviewRuler.addedForeground', { dark: transparent(editorGutterAddedBackground, 0.6), light: transparent(editorGutterAddedBackground, 0.6), hc: transparent(editorGutterAddedBackground, 0.6) }, nls.localize('overviewRulerAddedForeground', 'Overview ruler marker color for added content.'));
export const overviewRulerDeletedForeground = registerColor('editorOverviewRuler.deletedForeground', { dark: transparent(editorGutterDeletedBackground, 0.6), light: transparent(editorGutterDeletedBackground, 0.6), hc: transparent(editorGutterDeletedBackground, 0.6) }, nls.localize('overviewRulerDeletedForeground', 'Overview ruler marker color for deleted content.'));

class DirtyDiffDecorator extends Disposable {

	static createDecoration(className: string, options: { gutter: boolean, overview: { active: boolean, color: string }, minimap: { active: boolean, color: string }, isWholeLine: boolean }): ModelDecorationOptions {
		const decorationOptions: IModelDecorationOptions = {
			isWholeLine: options.isWholeLine,
		};

		if (options.gutter) {
			decorationOptions.linesDecorationsClassName = `dirty-diff-glyph ${className}`;
		}

		if (options.overview.active) {
			decorationOptions.overviewRuler = {
				color: themeColorFromId(options.overview.color),
				position: OverviewRulerLane.Left
			};
		}

		if (options.minimap.active) {
			decorationOptions.minimap = {
				color: themeColorFromId(options.minimap.color),
				position: MinimapPosition.Gutter
			};
		}

		return ModelDecorationOptions.createDynamic(decorationOptions);
	}

	private modifiedOptions: ModelDecorationOptions;
	private addedOptions: ModelDecorationOptions;
	private deletedOptions: ModelDecorationOptions;
	private decorations: string[] = [];
	private editorModel: ITextModel | null;

	constructor(
		editorModel: ITextModel,
		private model: DirtyDiffModel,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super();
		this.editorModel = editorModel;
		const decorations = configurationService.getValue<string>('scm.diffDecorations');
		const gutter = decorations === 'all' || decorations === 'gutter';
		const overview = decorations === 'all' || decorations === 'overview';
		const minimap = decorations === 'all' || decorations === 'minimap';

		this.modifiedOptions = DirtyDiffDecorator.createDecoration('dirty-diff-modified', {
			gutter,
			overview: { active: overview, color: overviewRulerModifiedForeground },
			minimap: { active: minimap, color: minimapGutterModifiedBackground },
			isWholeLine: true
		});
		this.addedOptions = DirtyDiffDecorator.createDecoration('dirty-diff-added', {
			gutter,
			overview: { active: overview, color: overviewRulerAddedForeground },
			minimap: { active: minimap, color: minimapGutterAddedBackground },
			isWholeLine: true
		});
		this.deletedOptions = DirtyDiffDecorator.createDecoration('dirty-diff-deleted', {
			gutter,
			overview: { active: overview, color: overviewRulerDeletedForeground },
			minimap: { active: minimap, color: minimapGutterDeletedBackground },
			isWholeLine: false
		});

		this._register(model.onDidChange(this.onDidChange, this));
	}

	private onDidChange(): void {
		if (!this.editorModel) {
			return;
		}
		const decorations = this.model.changes.map((change) => {
			const changeType = getChangeType(change);
			const startLineNumber = change.modifiedStartLineNumber;
			const endLineNumber = change.modifiedEndLineNumber || startLineNumber;

			switch (changeType) {
				case ChangeType.Add:
					return {
						range: {
							startLineNumber: startLineNumber, startColumn: 1,
							endLineNumber: endLineNumber, endColumn: 1
						},
						options: this.addedOptions
					};
				case ChangeType.Delete:
					return {
						range: {
							startLineNumber: startLineNumber, startColumn: Number.MAX_VALUE,
							endLineNumber: startLineNumber, endColumn: Number.MAX_VALUE
						},
						options: this.deletedOptions
					};
				case ChangeType.Modify:
					return {
						range: {
							startLineNumber: startLineNumber, startColumn: 1,
							endLineNumber: endLineNumber, endColumn: 1
						},
						options: this.modifiedOptions
					};
			}
		});

		this.decorations = this.editorModel.deltaDecorations(this.decorations, decorations);
	}

	override dispose(): void {
		super.dispose();

		if (this.editorModel && !this.editorModel.isDisposed()) {
			this.editorModel.deltaDecorations(this.decorations, []);
		}

		this.editorModel = null;
		this.decorations = [];
	}
}

function compareChanges(a: IChange, b: IChange): number {
	let result = a.modifiedStartLineNumber - b.modifiedStartLineNumber;

	if (result !== 0) {
		return result;
	}

	result = a.modifiedEndLineNumber - b.modifiedEndLineNumber;

	if (result !== 0) {
		return result;
	}

	result = a.originalStartLineNumber - b.originalStartLineNumber;

	if (result !== 0) {
		return result;
	}

	return a.originalEndLineNumber - b.originalEndLineNumber;
}

export function createProviderComparer(uri: URI): (a: ISCMProvider, b: ISCMProvider) => number {
	return (a, b) => {
		const aIsParent = isEqualOrParent(uri, a.rootUri!);
		const bIsParent = isEqualOrParent(uri, b.rootUri!);

		if (aIsParent && bIsParent) {
			return a.rootUri!.fsPath.length - b.rootUri!.fsPath.length;
		} else if (aIsParent) {
			return -1;
		} else if (bIsParent) {
			return 1;
		} else {
			return 0;
		}
	};
}

export async function getOriginalResource(scmService: ISCMService, uri: URI): Promise<URI | null> {
	const providers = scmService.repositories.map(r => r.provider);
	const rootedProviders = providers.filter(p => !!p.rootUri);

	rootedProviders.sort(createProviderComparer(uri));

	const result = await first(rootedProviders.map(p => () => p.getOriginalResource(uri)));

	if (result) {
		return result;
	}

	const nonRootedProviders = providers.filter(p => !p.rootUri);
	return first(nonRootedProviders.map(p => () => p.getOriginalResource(uri)));
}

export class DirtyDiffModel extends Disposable {

	private _originalResource: URI | null = null;
	private _originalModel: IResolvedTextEditorModel | null = null;
	private _model: ITextFileEditorModel;
	get original(): ITextModel | null { return this._originalModel?.textEditorModel || null; }
	get modified(): ITextModel | null { return this._model.textEditorModel || null; }

	private diffDelayer = new ThrottledDelayer<IChange[] | null>(200);
	private _originalURIPromise?: Promise<URI | null>;
	private repositoryDisposables = new Set<IDisposable>();
	private readonly originalModelDisposables = this._register(new DisposableStore());
	private _disposed = false;

	private readonly _onDidChange = new Emitter<{ changes: IChange[], diff: ISplice<IChange>[] }>();
	readonly onDidChange: Event<{ changes: IChange[], diff: ISplice<IChange>[] }> = this._onDidChange.event;

	private _changes: IChange[] = [];
	get changes(): IChange[] { return this._changes; }

	constructor(
		textFileModel: IResolvedTextFileEditorModel,
		@ISCMService private readonly scmService: ISCMService,
		@IEditorWorkerService private readonly editorWorkerService: IEditorWorkerService,
		@ITextModelService private readonly textModelResolverService: ITextModelService
	) {
		super();
		this._model = textFileModel;

		this._register(textFileModel.textEditorModel.onDidChangeContent(() => this.triggerDiff()));
		this._register(scmService.onDidAddRepository(this.onDidAddRepository, this));
		scmService.repositories.forEach(r => this.onDidAddRepository(r));

		this._register(this._model.onDidChangeEncoding(() => {
			this.diffDelayer.cancel();
			this._originalResource = null;
			this._originalModel = null;
			this._originalURIPromise = undefined;
			this.setChanges([]);
			this.triggerDiff();
		}));

		this.triggerDiff();
	}

	private onDidAddRepository(repository: ISCMRepository): void {
		const disposables = new DisposableStore();

		this.repositoryDisposables.add(disposables);
		disposables.add(toDisposable(() => this.repositoryDisposables.delete(disposables)));

		const onDidChange = Event.any(repository.provider.onDidChange, repository.provider.onDidChangeResources);
		disposables.add(onDidChange(this.triggerDiff, this));

		const onDidRemoveThis = Event.filter(this.scmService.onDidRemoveRepository, r => r === repository);
		disposables.add(onDidRemoveThis(() => dispose(disposables), null));

		this.triggerDiff();
	}

	private triggerDiff(): Promise<any> {
		if (!this.diffDelayer) {
			return Promise.resolve(null);
		}

		return this.diffDelayer
			.trigger(() => this.diff())
			.then((changes: IChange[] | null) => {
				if (this._disposed || this._model.isDisposed() || !this._originalModel || this._originalModel.isDisposed()) {
					return; // disposed
				}

				if (this._originalModel.textEditorModel.getValueLength() === 0) {
					changes = [];
				}

				if (!changes) {
					changes = [];
				}

				this.setChanges(changes);
			});
	}

	private setChanges(changes: IChange[]): void {
		const diff = sortedDiff(this._changes, changes, compareChanges);
		this._changes = changes;
		this._onDidChange.fire({ changes, diff });
	}

	private diff(): Promise<IChange[] | null> {
		return this.getOriginalURIPromise().then(originalURI => {
			if (this._disposed || this._model.isDisposed() || !originalURI) {
				return Promise.resolve([]); // disposed
			}

			if (!this.editorWorkerService.canComputeDirtyDiff(originalURI, this._model.resource)) {
				return Promise.resolve([]); // Files too large
			}

			return this.editorWorkerService.computeDirtyDiff(originalURI, this._model.resource, false);
		});
	}

	private getOriginalURIPromise(): Promise<URI | null> {
		if (this._originalURIPromise) {
			return this._originalURIPromise;
		}

		this._originalURIPromise = this.getOriginalResource().then(originalUri => {
			if (this._disposed) { // disposed
				return null;
			}

			if (!originalUri) {
				this._originalResource = null;
				this._originalModel = null;
				return null;
			}

			if (this._originalResource?.toString() === originalUri.toString()) {
				return originalUri;
			}

			return this.textModelResolverService.createModelReference(originalUri).then(ref => {
				if (this._disposed) { // disposed
					ref.dispose();
					return null;
				}

				this._originalResource = originalUri;
				this._originalModel = ref.object;

				if (isTextFileEditorModel(this._originalModel)) {
					const encoding = this._model.getEncoding();

					if (encoding) {
						this._originalModel.setEncoding(encoding, EncodingMode.Decode);
					}
				}

				this.originalModelDisposables.clear();
				this.originalModelDisposables.add(ref);
				this.originalModelDisposables.add(ref.object.textEditorModel.onDidChangeContent(() => this.triggerDiff()));

				return originalUri;
			}).catch(error => {
				return null; // possibly invalid reference
			});
		});

		return this._originalURIPromise.finally(() => {
			this._originalURIPromise = undefined;
		});
	}

	private async getOriginalResource(): Promise<URI | null> {
		if (this._disposed) {
			return Promise.resolve(null);
		}

		const uri = this._model.resource;
		return getOriginalResource(this.scmService, uri);
	}

	findNextClosestChange(lineNumber: number, inclusive = true): number {
		for (let i = 0; i < this.changes.length; i++) {
			const change = this.changes[i];

			if (inclusive) {
				if (getModifiedEndLineNumber(change) >= lineNumber) {
					return i;
				}
			} else {
				if (change.modifiedStartLineNumber > lineNumber) {
					return i;
				}
			}
		}

		return 0;
	}

	findPreviousClosestChange(lineNumber: number, inclusive = true): number {
		for (let i = this.changes.length - 1; i >= 0; i--) {
			const change = this.changes[i];

			if (inclusive) {
				if (change.modifiedStartLineNumber <= lineNumber) {
					return i;
				}
			} else {
				if (getModifiedEndLineNumber(change) < lineNumber) {
					return i;
				}
			}
		}

		return this.changes.length - 1;
	}

	override dispose(): void {
		super.dispose();

		this._disposed = true;
		this._originalResource = null;
		this._originalModel = null;
		this.diffDelayer.cancel();
		this.repositoryDisposables.forEach(d => dispose(d));
		this.repositoryDisposables.clear();
	}
}

class DirtyDiffItem {

	constructor(readonly model: DirtyDiffModel, readonly decorator: DirtyDiffDecorator) { }

	dispose(): void {
		this.decorator.dispose();
		this.model.dispose();
	}
}

interface IViewState {
	readonly width: number;
	readonly visibility: 'always' | 'hover';
}

export class DirtyDiffWorkbenchController extends Disposable implements ext.IWorkbenchContribution, IModelRegistry {

	private enabled = false;
	private viewState: IViewState = { width: 3, visibility: 'always' };
	private items = new Map<IResolvedTextFileEditorModel, DirtyDiffItem>();
	private readonly transientDisposables = this._register(new DisposableStore());
	private stylesheet: HTMLStyleElement;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITextFileService private readonly textFileService: ITextFileService
	) {
		super();
		this.stylesheet = createStyleSheet();
		this._register(toDisposable(() => this.stylesheet.parentElement!.removeChild(this.stylesheet)));

		const onDidChangeConfiguration = Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.diffDecorations'));
		this._register(onDidChangeConfiguration(this.onDidChangeConfiguration, this));
		this.onDidChangeConfiguration();

		const onDidChangeDiffWidthConfiguration = Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.diffDecorationsGutterWidth'));
		onDidChangeDiffWidthConfiguration(this.onDidChangeDiffWidthConfiguration, this);
		this.onDidChangeDiffWidthConfiguration();

		const onDidChangeDiffVisibilityConfiguration = Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.diffDecorationsGutterVisibility'));
		onDidChangeDiffVisibilityConfiguration(this.onDidChangeDiffVisibiltiyConfiguration, this);
		this.onDidChangeDiffVisibiltiyConfiguration();
	}

	private onDidChangeConfiguration(): void {
		const enabled = this.configurationService.getValue<string>('scm.diffDecorations') !== 'none';

		if (enabled) {
			this.enable();
		} else {
			this.disable();
		}
	}

	private onDidChangeDiffWidthConfiguration(): void {
		let width = this.configurationService.getValue<number>('scm.diffDecorationsGutterWidth');

		if (isNaN(width) || width <= 0 || width > 5) {
			width = 3;
		}

		this.setViewState({ ...this.viewState, width });
	}

	private onDidChangeDiffVisibiltiyConfiguration(): void {
		const visibility = this.configurationService.getValue<'always' | 'hover'>('scm.diffDecorationsGutterVisibility');
		this.setViewState({ ...this.viewState, visibility });
	}

	private setViewState(state: IViewState): void {
		this.viewState = state;
		this.stylesheet.textContent = `
			.monaco-editor .dirty-diff-modified,.monaco-editor .dirty-diff-added{border-left-width:${state.width}px;}
			.monaco-editor .dirty-diff-modified, .monaco-editor .dirty-diff-added, .monaco-editor .dirty-diff-deleted {
				opacity: ${state.visibility === 'always' ? 1 : 0};
			}
		`;
	}

	private enable(): void {
		if (this.enabled) {
			this.disable();
		}

		this.transientDisposables.add(this.editorService.onDidVisibleEditorsChange(() => this.onEditorsChanged()));
		this.onEditorsChanged();
		this.enabled = true;
	}

	private disable(): void {
		if (!this.enabled) {
			return;
		}

		this.transientDisposables.clear();

		for (const [, dirtyDiff] of this.items) {
			dirtyDiff.dispose();
		}

		this.items.clear();
		this.enabled = false;
	}

	// HACK: This is the best current way of figuring out whether to draw these decorations
	// or not. Needs context from the editor, to know whether it is a diff editor, in place editor
	// etc.
	private onEditorsChanged(): void {
		const models = this.editorService.visibleTextEditorControls

			// only interested in code editor widgets
			.filter(c => c instanceof CodeEditorWidget)

			// set model registry and map to models
			.map(editor => {
				const codeEditor = editor as CodeEditorWidget;
				const controller = DirtyDiffController.get(codeEditor);
				controller.modelRegistry = this;
				return codeEditor.getModel();
			})

			// remove nulls and duplicates
			.filter((m, i, a) => !!m && !!m.uri && a.indexOf(m, i + 1) === -1)

			// only want resolved text file service models
			.map(m => this.textFileService.files.get(m!.uri))
			.filter(m => m?.isResolved()) as IResolvedTextFileEditorModel[];

		const set = new Set(models);
		const newModels = models.filter(o => !this.items.has(o));
		const oldModels = [...this.items.keys()].filter(m => !set.has(m));

		oldModels.forEach(m => this.onModelInvisible(m));
		newModels.forEach(m => this.onModelVisible(m));
	}

	private onModelVisible(textFileModel: IResolvedTextFileEditorModel): void {
		const model = this.instantiationService.createInstance(DirtyDiffModel, textFileModel);
		const decorator = new DirtyDiffDecorator(textFileModel.textEditorModel, model, this.configurationService);
		this.items.set(textFileModel, new DirtyDiffItem(model, decorator));
	}

	private onModelInvisible(textFileModel: IResolvedTextFileEditorModel): void {
		this.items.get(textFileModel)!.dispose();
		this.items.delete(textFileModel);
	}

	getModel(editorModel: ITextModel): DirtyDiffModel | null {
		for (const [model, diff] of this.items) {
			if (model.textEditorModel.id === editorModel.id) {
				return diff.model;
			}
		}

		return null;
	}

	override dispose(): void {
		this.disable();
		super.dispose();
	}
}

registerEditorContribution(DirtyDiffController.ID, DirtyDiffController);

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	const editorGutterModifiedBackgroundColor = theme.getColor(editorGutterModifiedBackground);
	if (editorGutterModifiedBackgroundColor) {
		collector.addRule(`
			.monaco-editor .dirty-diff-modified {
				border-left: 3px solid ${editorGutterModifiedBackgroundColor};
				transition: opacity 0.5s;
			}
			.monaco-editor .dirty-diff-modified:before {
				background: ${editorGutterModifiedBackgroundColor};
			}
			.monaco-editor .margin:hover .dirty-diff-modified {
				opacity: 1;
			}
		`);
	}

	const editorGutterAddedBackgroundColor = theme.getColor(editorGutterAddedBackground);
	if (editorGutterAddedBackgroundColor) {
		collector.addRule(`
			.monaco-editor .dirty-diff-added {
				border-left: 3px solid ${editorGutterAddedBackgroundColor};
				transition: opacity 0.5s;
			}
			.monaco-editor .dirty-diff-added:before {
				background: ${editorGutterAddedBackgroundColor};
			}
			.monaco-editor .margin:hover .dirty-diff-added {
				opacity: 1;
			}
		`);
	}

	const editorGutteDeletedBackgroundColor = theme.getColor(editorGutterDeletedBackground);
	if (editorGutteDeletedBackgroundColor) {
		collector.addRule(`
			.monaco-editor .dirty-diff-deleted:after {
				border-left: 4px solid ${editorGutteDeletedBackgroundColor};
				transition: opacity 0.5s;
			}
			.monaco-editor .dirty-diff-deleted:before {
				background: ${editorGutteDeletedBackgroundColor};
			}
			.monaco-editor .margin:hover .dirty-diff-added {
				opacity: 1;
			}
		`);
	}
});
