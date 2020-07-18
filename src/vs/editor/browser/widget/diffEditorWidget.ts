/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/diffEditor';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { FastDomNode, createFastDomNode } from 'vs/base/browser/fastDomNode';
import { ISashEvent, IVerticalSashLayoutProvider, Sash, SashState, Orientation } from 'vs/base/browser/ui/sash/sash';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import { URI } from 'vs/base/common/uri';
import { Configuration } from 'vs/editor/browser/config/configuration';
import { StableEditorScrollState } from 'vs/editor/browser/core/editorState';
import * as editorBrowser from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { DiffReview } from 'vs/editor/browser/widget/diffReview';
import { IDiffEditorOptions, IEditorOptions, EditorLayoutInfo, IComputedEditorOptions, EditorOption, EditorOptions, EditorFontLigatures } from 'vs/editor/common/config/editorOptions';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { ISelection, Selection } from 'vs/editor/common/core/selection';
import { IStringBuilder, createStringBuilder } from 'vs/editor/common/core/stringBuilder';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { IModelDecorationsChangeAccessor, IModelDeltaDecoration, ITextModel } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { IDiffComputationResult, IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { OverviewRulerZone } from 'vs/editor/common/view/overviewZoneManager';
import { LineDecoration } from 'vs/editor/common/viewLayout/lineDecorations';
import { RenderLineInput, renderViewLine } from 'vs/editor/common/viewLayout/viewLineRenderer';
import { IEditorWhitespace } from 'vs/editor/common/viewLayout/linesLayout';
import { InlineDecoration, InlineDecorationType, ViewLineRenderingData } from 'vs/editor/common/viewModel/viewModel';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { defaultInsertColor, defaultRemoveColor, diffBorder, diffInserted, diffInsertedOutline, diffRemoved, diffRemovedOutline, scrollbarShadow, scrollbarSliderBackground, scrollbarSliderHoverBackground, scrollbarSliderActiveBackground, diffDiagonalFill } from 'vs/platform/theme/common/colorRegistry';
import { IColorTheme, IThemeService, getThemeTypeSelector, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IDiffLinesChange, InlineDiffMargin } from 'vs/editor/browser/widget/inlineDiffMargin';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { Constants } from 'vs/base/common/uint';
import { EditorExtensionsRegistry, IDiffEditorContributionDescription } from 'vs/editor/browser/editorExtensions';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IEditorProgressService, IProgressRunner } from 'vs/platform/progress/common/progress';
import { ElementSizeObserver } from 'vs/editor/browser/config/elementSizeObserver';
import { Codicon, registerIcon } from 'vs/base/common/codicons';
import { MOUSE_CURSOR_TEXT_CSS_CLASS_NAME } from 'vs/base/browser/ui/mouseCursor/mouseCursor';

interface IEditorDiffDecorations {
	decorations: IModelDeltaDecoration[];
	overviewZones: OverviewRulerZone[];
}

interface IEditorDiffDecorationsWithZones extends IEditorDiffDecorations {
	zones: IMyViewZone[];
}

interface IEditorsDiffDecorationsWithZones {
	original: IEditorDiffDecorationsWithZones;
	modified: IEditorDiffDecorationsWithZones;
}

interface IEditorsZones {
	original: IMyViewZone[];
	modified: IMyViewZone[];
}

interface IDiffEditorWidgetStyle {
	getEditorsDiffDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalWhitespaces: IEditorWhitespace[], modifiedWhitespaces: IEditorWhitespace[], originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorsDiffDecorationsWithZones;
	setEnableSplitViewResizing(enableSplitViewResizing: boolean): void;
	applyColors(theme: IColorTheme): boolean;
	layout(): number;
	dispose(): void;
}

class VisualEditorState {
	private _zones: string[];
	private inlineDiffMargins: InlineDiffMargin[];
	private _zonesMap: { [zoneId: string]: boolean; };
	private _decorations: string[];

	constructor(
		private _contextMenuService: IContextMenuService,
		private _clipboardService: IClipboardService
	) {
		this._zones = [];
		this.inlineDiffMargins = [];
		this._zonesMap = {};
		this._decorations = [];
	}

	public getForeignViewZones(allViewZones: IEditorWhitespace[]): IEditorWhitespace[] {
		return allViewZones.filter((z) => !this._zonesMap[String(z.id)]);
	}

	public clean(editor: CodeEditorWidget): void {
		// (1) View zones
		if (this._zones.length > 0) {
			editor.changeViewZones((viewChangeAccessor: editorBrowser.IViewZoneChangeAccessor) => {
				for (let i = 0, length = this._zones.length; i < length; i++) {
					viewChangeAccessor.removeZone(this._zones[i]);
				}
			});
		}
		this._zones = [];
		this._zonesMap = {};

		// (2) Model decorations
		this._decorations = editor.deltaDecorations(this._decorations, []);
	}

	public apply(editor: CodeEditorWidget, overviewRuler: editorBrowser.IOverviewRuler, newDecorations: IEditorDiffDecorationsWithZones, restoreScrollState: boolean): void {

		const scrollState = restoreScrollState ? StableEditorScrollState.capture(editor) : null;

		// view zones
		editor.changeViewZones((viewChangeAccessor: editorBrowser.IViewZoneChangeAccessor) => {
			for (let i = 0, length = this._zones.length; i < length; i++) {
				viewChangeAccessor.removeZone(this._zones[i]);
			}
			for (let i = 0, length = this.inlineDiffMargins.length; i < length; i++) {
				this.inlineDiffMargins[i].dispose();
			}
			this._zones = [];
			this._zonesMap = {};
			this.inlineDiffMargins = [];
			for (let i = 0, length = newDecorations.zones.length; i < length; i++) {
				const viewZone = <editorBrowser.IViewZone>newDecorations.zones[i];
				viewZone.suppressMouseDown = true;
				let zoneId = viewChangeAccessor.addZone(viewZone);
				this._zones.push(zoneId);
				this._zonesMap[String(zoneId)] = true;

				if (newDecorations.zones[i].diff && viewZone.marginDomNode) {
					viewZone.suppressMouseDown = false;
					this.inlineDiffMargins.push(new InlineDiffMargin(zoneId, viewZone.marginDomNode, editor, newDecorations.zones[i].diff!, this._contextMenuService, this._clipboardService));
				}
			}
		});

		if (scrollState) {
			scrollState.restore(editor);
		}

		// decorations
		this._decorations = editor.deltaDecorations(this._decorations, newDecorations.decorations);

		// overview ruler
		if (overviewRuler) {
			overviewRuler.setZones(newDecorations.overviewZones);
		}
	}
}

let DIFF_EDITOR_ID = 0;


const diffInsertIcon = registerIcon('diff-insert', Codicon.add);
const diffRemoveIcon = registerIcon('diff-remove', Codicon.remove);

export class DiffEditorWidget extends Disposable implements editorBrowser.IDiffEditor {

	private static readonly ONE_OVERVIEW_WIDTH = 15;
	public static readonly ENTIRE_DIFF_OVERVIEW_WIDTH = 30;
	private static readonly UPDATE_DIFF_DECORATIONS_DELAY = 200; // ms

	private readonly _onDidDispose: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidDispose: Event<void> = this._onDidDispose.event;

	private readonly _onDidUpdateDiff: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidUpdateDiff: Event<void> = this._onDidUpdateDiff.event;

	private readonly id: number;
	private _state: editorBrowser.DiffEditorState;
	private _updatingDiffProgress: IProgressRunner | null;

	private readonly _domElement: HTMLElement;
	protected readonly _containerDomElement: HTMLElement;
	private readonly _overviewDomElement: HTMLElement;
	private readonly _overviewViewportDomElement: FastDomNode<HTMLElement>;

	private readonly _elementSizeObserver: ElementSizeObserver;

	private readonly originalEditor: CodeEditorWidget;
	private readonly _originalDomNode: HTMLElement;
	private readonly _originalEditorState: VisualEditorState;
	private _originalOverviewRuler: editorBrowser.IOverviewRuler | null;

	private readonly modifiedEditor: CodeEditorWidget;
	private readonly _modifiedDomNode: HTMLElement;
	private readonly _modifiedEditorState: VisualEditorState;
	private _modifiedOverviewRuler: editorBrowser.IOverviewRuler | null;

	private _currentlyChangingViewZones: boolean;
	private _beginUpdateDecorationsTimeout: number;
	private _diffComputationToken: number;
	private _diffComputationResult: IDiffComputationResult | null;

	private _isVisible: boolean;
	private _isHandlingScrollEvent: boolean;

	private _ignoreTrimWhitespace: boolean;
	private _originalIsEditable: boolean;
	private _originalCodeLens: boolean;
	private _modifiedCodeLens: boolean;

	private _renderSideBySide: boolean;
	private _maxComputationTime: number;
	private _renderIndicators: boolean;
	private _enableSplitViewResizing: boolean;
	private _strategy!: IDiffEditorWidgetStyle;

	private readonly _updateDecorationsRunner: RunOnceScheduler;

	private readonly _editorWorkerService: IEditorWorkerService;
	protected _contextKeyService: IContextKeyService;
	private readonly _codeEditorService: ICodeEditorService;
	private readonly _themeService: IThemeService;
	private readonly _notificationService: INotificationService;

	private readonly _reviewPane: DiffReview;

	constructor(
		domElement: HTMLElement,
		options: IDiffEditorOptions,
		@IClipboardService clipboardService: IClipboardService,
		@IEditorWorkerService editorWorkerService: IEditorWorkerService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IThemeService themeService: IThemeService,
		@INotificationService notificationService: INotificationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IEditorProgressService private readonly _editorProgressService: IEditorProgressService
	) {
		super();

		this._editorWorkerService = editorWorkerService;
		this._codeEditorService = codeEditorService;
		this._contextKeyService = this._register(contextKeyService.createScoped(domElement));
		this._contextKeyService.createKey('isInDiffEditor', true);
		this._themeService = themeService;
		this._notificationService = notificationService;

		this.id = (++DIFF_EDITOR_ID);
		this._state = editorBrowser.DiffEditorState.Idle;
		this._updatingDiffProgress = null;

		this._domElement = domElement;
		options = options || {};

		// renderSideBySide
		this._renderSideBySide = true;
		if (typeof options.renderSideBySide !== 'undefined') {
			this._renderSideBySide = options.renderSideBySide;
		}

		// maxComputationTime
		this._maxComputationTime = 5000;
		if (typeof options.maxComputationTime !== 'undefined') {
			this._maxComputationTime = options.maxComputationTime;
		}

		// ignoreTrimWhitespace
		this._ignoreTrimWhitespace = true;
		if (typeof options.ignoreTrimWhitespace !== 'undefined') {
			this._ignoreTrimWhitespace = options.ignoreTrimWhitespace;
		}

		// renderIndicators
		this._renderIndicators = true;
		if (typeof options.renderIndicators !== 'undefined') {
			this._renderIndicators = options.renderIndicators;
		}

		this._originalIsEditable = false;
		if (typeof options.originalEditable !== 'undefined') {
			this._originalIsEditable = Boolean(options.originalEditable);
		}

		this._originalCodeLens = false;
		if (typeof options.originalCodeLens !== 'undefined') {
			this._originalCodeLens = Boolean(options.originalCodeLens);
		}

		this._modifiedCodeLens = false;
		if (typeof options.modifiedCodeLens !== 'undefined') {
			this._modifiedCodeLens = Boolean(options.modifiedCodeLens);
		}

		this._updateDecorationsRunner = this._register(new RunOnceScheduler(() => this._updateDecorations(), 0));

		this._containerDomElement = document.createElement('div');
		this._containerDomElement.className = DiffEditorWidget._getClassName(this._themeService.getColorTheme(), this._renderSideBySide);
		this._containerDomElement.style.position = 'relative';
		this._containerDomElement.style.height = '100%';
		this._domElement.appendChild(this._containerDomElement);

		this._overviewViewportDomElement = createFastDomNode(document.createElement('div'));
		this._overviewViewportDomElement.setClassName('diffViewport');
		this._overviewViewportDomElement.setPosition('absolute');

		this._overviewDomElement = document.createElement('div');
		this._overviewDomElement.className = 'diffOverview';
		this._overviewDomElement.style.position = 'absolute';

		this._overviewDomElement.appendChild(this._overviewViewportDomElement.domNode);

		this._register(dom.addStandardDisposableListener(this._overviewDomElement, 'mousedown', (e) => {
			this.modifiedEditor.delegateVerticalScrollbarMouseDown(e);
		}));
		this._containerDomElement.appendChild(this._overviewDomElement);

		// Create left side
		this._originalDomNode = document.createElement('div');
		this._originalDomNode.className = 'editor original';
		this._originalDomNode.style.position = 'absolute';
		this._originalDomNode.style.height = '100%';
		this._containerDomElement.appendChild(this._originalDomNode);

		// Create right side
		this._modifiedDomNode = document.createElement('div');
		this._modifiedDomNode.className = 'editor modified';
		this._modifiedDomNode.style.position = 'absolute';
		this._modifiedDomNode.style.height = '100%';
		this._containerDomElement.appendChild(this._modifiedDomNode);

		this._beginUpdateDecorationsTimeout = -1;
		this._currentlyChangingViewZones = false;
		this._diffComputationToken = 0;

		this._originalEditorState = new VisualEditorState(contextMenuService, clipboardService);
		this._modifiedEditorState = new VisualEditorState(contextMenuService, clipboardService);

		this._isVisible = true;
		this._isHandlingScrollEvent = false;

		this._elementSizeObserver = this._register(new ElementSizeObserver(this._containerDomElement, undefined, () => this._onDidContainerSizeChanged()));
		if (options.automaticLayout) {
			this._elementSizeObserver.startObserving();
		}

		this._diffComputationResult = null;

		const leftContextKeyService = this._contextKeyService.createScoped();
		leftContextKeyService.createKey('isInDiffLeftEditor', true);

		const leftServices = new ServiceCollection();
		leftServices.set(IContextKeyService, leftContextKeyService);
		const leftScopedInstantiationService = instantiationService.createChild(leftServices);

		const rightContextKeyService = this._contextKeyService.createScoped();
		rightContextKeyService.createKey('isInDiffRightEditor', true);

		const rightServices = new ServiceCollection();
		rightServices.set(IContextKeyService, rightContextKeyService);
		const rightScopedInstantiationService = instantiationService.createChild(rightServices);

		this.originalEditor = this._createLeftHandSideEditor(options, leftScopedInstantiationService);
		this.modifiedEditor = this._createRightHandSideEditor(options, rightScopedInstantiationService);

		this._originalOverviewRuler = null;
		this._modifiedOverviewRuler = null;

		this._reviewPane = new DiffReview(this);
		this._containerDomElement.appendChild(this._reviewPane.domNode.domNode);
		this._containerDomElement.appendChild(this._reviewPane.shadow.domNode);
		this._containerDomElement.appendChild(this._reviewPane.actionBarContainer.domNode);



		// enableSplitViewResizing
		this._enableSplitViewResizing = true;
		if (typeof options.enableSplitViewResizing !== 'undefined') {
			this._enableSplitViewResizing = options.enableSplitViewResizing;
		}

		if (this._renderSideBySide) {
			this._setStrategy(new DiffEditorWidgetSideBySide(this._createDataSource(), this._enableSplitViewResizing));
		} else {
			this._setStrategy(new DiffEditorWidgetInline(this._createDataSource(), this._enableSplitViewResizing));
		}

		this._register(themeService.onDidColorThemeChange(t => {
			if (this._strategy && this._strategy.applyColors(t)) {
				this._updateDecorationsRunner.schedule();
			}
			this._containerDomElement.className = DiffEditorWidget._getClassName(this._themeService.getColorTheme(), this._renderSideBySide);
		}));

		const contributions: IDiffEditorContributionDescription[] = EditorExtensionsRegistry.getDiffEditorContributions();
		for (const desc of contributions) {
			try {
				this._register(instantiationService.createInstance(desc.ctor, this));
			} catch (err) {
				onUnexpectedError(err);
			}
		}

		this._codeEditorService.addDiffEditor(this);
	}

	public get ignoreTrimWhitespace(): boolean {
		return this._ignoreTrimWhitespace;
	}

	public get renderSideBySide(): boolean {
		return this._renderSideBySide;
	}

	public get maxComputationTime(): number {
		return this._maxComputationTime;
	}

	public get renderIndicators(): boolean {
		return this._renderIndicators;
	}

	private _setState(newState: editorBrowser.DiffEditorState): void {
		if (this._state === newState) {
			return;
		}
		this._state = newState;

		if (this._updatingDiffProgress) {
			this._updatingDiffProgress.done();
			this._updatingDiffProgress = null;
		}

		if (this._state === editorBrowser.DiffEditorState.ComputingDiff) {
			this._updatingDiffProgress = this._editorProgressService.show(true, 1000);
		}
	}

	public hasWidgetFocus(): boolean {
		return dom.isAncestor(document.activeElement, this._domElement);
	}

	public diffReviewNext(): void {
		this._reviewPane.next();
	}

	public diffReviewPrev(): void {
		this._reviewPane.prev();
	}

	private static _getClassName(theme: IColorTheme, renderSideBySide: boolean): string {
		let result = 'monaco-diff-editor monaco-editor-background ';
		if (renderSideBySide) {
			result += 'side-by-side ';
		}
		result += getThemeTypeSelector(theme.type);
		return result;
	}

	private _recreateOverviewRulers(): void {
		if (this._originalOverviewRuler) {
			this._overviewDomElement.removeChild(this._originalOverviewRuler.getDomNode());
			this._originalOverviewRuler.dispose();
		}
		if (this.originalEditor.hasModel()) {
			this._originalOverviewRuler = this.originalEditor.createOverviewRuler('original diffOverviewRuler')!;
			this._overviewDomElement.appendChild(this._originalOverviewRuler.getDomNode());
		}

		if (this._modifiedOverviewRuler) {
			this._overviewDomElement.removeChild(this._modifiedOverviewRuler.getDomNode());
			this._modifiedOverviewRuler.dispose();
		}
		if (this.modifiedEditor.hasModel()) {
			this._modifiedOverviewRuler = this.modifiedEditor.createOverviewRuler('modified diffOverviewRuler')!;
			this._overviewDomElement.appendChild(this._modifiedOverviewRuler.getDomNode());
		}

		this._layoutOverviewRulers();
	}

	private _createLeftHandSideEditor(options: IDiffEditorOptions, instantiationService: IInstantiationService): CodeEditorWidget {
		const editor = this._createInnerEditor(instantiationService, this._originalDomNode, this._adjustOptionsForLeftHandSide(options, this._originalIsEditable, this._originalCodeLens));

		this._register(editor.onDidScrollChange((e) => {
			if (this._isHandlingScrollEvent) {
				return;
			}
			if (!e.scrollTopChanged && !e.scrollLeftChanged && !e.scrollHeightChanged) {
				return;
			}
			this._isHandlingScrollEvent = true;
			this.modifiedEditor.setScrollPosition({
				scrollLeft: e.scrollLeft,
				scrollTop: e.scrollTop
			});
			this._isHandlingScrollEvent = false;

			this._layoutOverviewViewport();
		}));

		this._register(editor.onDidChangeViewZones(() => {
			this._onViewZonesChanged();
		}));

		this._register(editor.onDidChangeModelContent(() => {
			if (this._isVisible) {
				this._beginUpdateDecorationsSoon();
			}
		}));

		return editor;
	}

	private _createRightHandSideEditor(options: IDiffEditorOptions, instantiationService: IInstantiationService): CodeEditorWidget {
		const editor = this._createInnerEditor(instantiationService, this._modifiedDomNode, this._adjustOptionsForRightHandSide(options, this._modifiedCodeLens));

		this._register(editor.onDidScrollChange((e) => {
			if (this._isHandlingScrollEvent) {
				return;
			}
			if (!e.scrollTopChanged && !e.scrollLeftChanged && !e.scrollHeightChanged) {
				return;
			}
			this._isHandlingScrollEvent = true;
			this.originalEditor.setScrollPosition({
				scrollLeft: e.scrollLeft,
				scrollTop: e.scrollTop
			});
			this._isHandlingScrollEvent = false;

			this._layoutOverviewViewport();
		}));

		this._register(editor.onDidChangeViewZones(() => {
			this._onViewZonesChanged();
		}));

		this._register(editor.onDidChangeConfiguration((e) => {
			if (e.hasChanged(EditorOption.fontInfo) && editor.getModel()) {
				this._onViewZonesChanged();
			}
		}));

		this._register(editor.onDidChangeModelContent(() => {
			if (this._isVisible) {
				this._beginUpdateDecorationsSoon();
			}
		}));

		this._register(editor.onDidChangeModelOptions((e) => {
			if (e.tabSize) {
				this._updateDecorationsRunner.schedule();
			}
		}));

		return editor;
	}

	protected _createInnerEditor(instantiationService: IInstantiationService, container: HTMLElement, options: IEditorOptions): CodeEditorWidget {
		return instantiationService.createInstance(CodeEditorWidget, container, options, {});
	}

	public dispose(): void {
		this._codeEditorService.removeDiffEditor(this);

		if (this._beginUpdateDecorationsTimeout !== -1) {
			window.clearTimeout(this._beginUpdateDecorationsTimeout);
			this._beginUpdateDecorationsTimeout = -1;
		}

		this._cleanViewZonesAndDecorations();

		if (this._originalOverviewRuler) {
			this._overviewDomElement.removeChild(this._originalOverviewRuler.getDomNode());
			this._originalOverviewRuler.dispose();
		}
		if (this._modifiedOverviewRuler) {
			this._overviewDomElement.removeChild(this._modifiedOverviewRuler.getDomNode());
			this._modifiedOverviewRuler.dispose();
		}
		this._overviewDomElement.removeChild(this._overviewViewportDomElement.domNode);
		this._containerDomElement.removeChild(this._overviewDomElement);

		this._containerDomElement.removeChild(this._originalDomNode);
		this.originalEditor.dispose();

		this._containerDomElement.removeChild(this._modifiedDomNode);
		this.modifiedEditor.dispose();

		this._strategy.dispose();

		this._containerDomElement.removeChild(this._reviewPane.domNode.domNode);
		this._containerDomElement.removeChild(this._reviewPane.shadow.domNode);
		this._containerDomElement.removeChild(this._reviewPane.actionBarContainer.domNode);
		this._reviewPane.dispose();

		this._domElement.removeChild(this._containerDomElement);

		this._onDidDispose.fire();

		super.dispose();
	}

	//------------ begin IDiffEditor methods

	public getId(): string {
		return this.getEditorType() + ':' + this.id;
	}

	public getEditorType(): string {
		return editorCommon.EditorType.IDiffEditor;
	}

	public getLineChanges(): editorCommon.ILineChange[] | null {
		if (!this._diffComputationResult) {
			return null;
		}
		return this._diffComputationResult.changes;
	}

	public getDiffComputationResult(): IDiffComputationResult | null {
		return this._diffComputationResult;
	}

	public getOriginalEditor(): editorBrowser.ICodeEditor {
		return this.originalEditor;
	}

	public getModifiedEditor(): editorBrowser.ICodeEditor {
		return this.modifiedEditor;
	}

	public updateOptions(newOptions: IDiffEditorOptions): void {

		// Handle side by side
		let renderSideBySideChanged = false;
		if (typeof newOptions.renderSideBySide !== 'undefined') {
			if (this._renderSideBySide !== newOptions.renderSideBySide) {
				this._renderSideBySide = newOptions.renderSideBySide;
				renderSideBySideChanged = true;
			}
		}

		if (typeof newOptions.maxComputationTime !== 'undefined') {
			this._maxComputationTime = newOptions.maxComputationTime;
			if (this._isVisible) {
				this._beginUpdateDecorationsSoon();
			}
		}

		let beginUpdateDecorations = false;

		if (typeof newOptions.ignoreTrimWhitespace !== 'undefined') {
			if (this._ignoreTrimWhitespace !== newOptions.ignoreTrimWhitespace) {
				this._ignoreTrimWhitespace = newOptions.ignoreTrimWhitespace;
				// Begin comparing
				beginUpdateDecorations = true;
			}
		}

		if (typeof newOptions.renderIndicators !== 'undefined') {
			if (this._renderIndicators !== newOptions.renderIndicators) {
				this._renderIndicators = newOptions.renderIndicators;
				beginUpdateDecorations = true;
			}
		}

		if (beginUpdateDecorations) {
			this._beginUpdateDecorations();
		}

		if (typeof newOptions.originalEditable !== 'undefined') {
			this._originalIsEditable = Boolean(newOptions.originalEditable);
		}
		if (typeof newOptions.originalCodeLens !== 'undefined') {
			this._originalCodeLens = Boolean(newOptions.originalCodeLens);
		}
		if (typeof newOptions.modifiedCodeLens !== 'undefined') {
			this._modifiedCodeLens = Boolean(newOptions.modifiedCodeLens);
		}

		this.modifiedEditor.updateOptions(this._adjustOptionsForRightHandSide(newOptions, this._modifiedCodeLens));
		this.originalEditor.updateOptions(this._adjustOptionsForLeftHandSide(newOptions, this._originalIsEditable, this._originalCodeLens));

		// enableSplitViewResizing
		if (typeof newOptions.enableSplitViewResizing !== 'undefined') {
			this._enableSplitViewResizing = newOptions.enableSplitViewResizing;
		}
		this._strategy.setEnableSplitViewResizing(this._enableSplitViewResizing);

		// renderSideBySide
		if (renderSideBySideChanged) {
			if (this._renderSideBySide) {
				this._setStrategy(new DiffEditorWidgetSideBySide(this._createDataSource(), this._enableSplitViewResizing));
			} else {
				this._setStrategy(new DiffEditorWidgetInline(this._createDataSource(), this._enableSplitViewResizing));
			}
			// Update class name
			this._containerDomElement.className = DiffEditorWidget._getClassName(this._themeService.getColorTheme(), this._renderSideBySide);
		}
	}

	public getModel(): editorCommon.IDiffEditorModel {
		return {
			original: this.originalEditor.getModel()!,
			modified: this.modifiedEditor.getModel()!
		};
	}

	public setModel(model: editorCommon.IDiffEditorModel): void {
		// Guard us against partial null model
		if (model && (!model.original || !model.modified)) {
			throw new Error(!model.original ? 'DiffEditorWidget.setModel: Original model is null' : 'DiffEditorWidget.setModel: Modified model is null');
		}

		// Remove all view zones & decorations
		this._cleanViewZonesAndDecorations();

		// Update code editor models
		this.originalEditor.setModel(model ? model.original : null);
		this.modifiedEditor.setModel(model ? model.modified : null);
		this._updateDecorationsRunner.cancel();

		// this.originalEditor.onDidChangeModelOptions

		if (model) {
			this.originalEditor.setScrollTop(0);
			this.modifiedEditor.setScrollTop(0);
		}

		// Disable any diff computations that will come in
		this._diffComputationResult = null;
		this._diffComputationToken++;
		this._setState(editorBrowser.DiffEditorState.Idle);

		if (model) {
			this._recreateOverviewRulers();

			// Begin comparing
			this._beginUpdateDecorations();
		}

		this._layoutOverviewViewport();
	}

	public getDomNode(): HTMLElement {
		return this._domElement;
	}

	public getVisibleColumnFromPosition(position: IPosition): number {
		return this.modifiedEditor.getVisibleColumnFromPosition(position);
	}

	public getStatusbarColumn(position: IPosition): number {
		return this.modifiedEditor.getStatusbarColumn(position);
	}

	public getPosition(): Position | null {
		return this.modifiedEditor.getPosition();
	}

	public setPosition(position: IPosition): void {
		this.modifiedEditor.setPosition(position);
	}

	public revealLine(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealLine(lineNumber, scrollType);
	}

	public revealLineInCenter(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealLineInCenter(lineNumber, scrollType);
	}

	public revealLineInCenterIfOutsideViewport(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealLineInCenterIfOutsideViewport(lineNumber, scrollType);
	}

	public revealLineNearTop(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealLineNearTop(lineNumber, scrollType);
	}

	public revealPosition(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealPosition(position, scrollType);
	}

	public revealPositionInCenter(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealPositionInCenter(position, scrollType);
	}

	public revealPositionInCenterIfOutsideViewport(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealPositionInCenterIfOutsideViewport(position, scrollType);
	}

	public revealPositionNearTop(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealPositionNearTop(position, scrollType);
	}

	public getSelection(): Selection | null {
		return this.modifiedEditor.getSelection();
	}

	public getSelections(): Selection[] | null {
		return this.modifiedEditor.getSelections();
	}

	public setSelection(range: IRange): void;
	public setSelection(editorRange: Range): void;
	public setSelection(selection: ISelection): void;
	public setSelection(editorSelection: Selection): void;
	public setSelection(something: any): void {
		this.modifiedEditor.setSelection(something);
	}

	public setSelections(ranges: readonly ISelection[]): void {
		this.modifiedEditor.setSelections(ranges);
	}

	public revealLines(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealLines(startLineNumber, endLineNumber, scrollType);
	}

	public revealLinesInCenter(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealLinesInCenter(startLineNumber, endLineNumber, scrollType);
	}

	public revealLinesInCenterIfOutsideViewport(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealLinesInCenterIfOutsideViewport(startLineNumber, endLineNumber, scrollType);
	}

	public revealLinesNearTop(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealLinesNearTop(startLineNumber, endLineNumber, scrollType);
	}

	public revealRange(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth, revealVerticalInCenter: boolean = false, revealHorizontal: boolean = true): void {
		this.modifiedEditor.revealRange(range, scrollType, revealVerticalInCenter, revealHorizontal);
	}

	public revealRangeInCenter(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealRangeInCenter(range, scrollType);
	}

	public revealRangeInCenterIfOutsideViewport(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealRangeInCenterIfOutsideViewport(range, scrollType);
	}

	public revealRangeNearTop(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealRangeNearTop(range, scrollType);
	}

	public revealRangeNearTopIfOutsideViewport(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealRangeNearTopIfOutsideViewport(range, scrollType);
	}

	public revealRangeAtTop(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this.modifiedEditor.revealRangeAtTop(range, scrollType);
	}

	public getSupportedActions(): editorCommon.IEditorAction[] {
		return this.modifiedEditor.getSupportedActions();
	}

	public saveViewState(): editorCommon.IDiffEditorViewState {
		let originalViewState = this.originalEditor.saveViewState();
		let modifiedViewState = this.modifiedEditor.saveViewState();
		return {
			original: originalViewState,
			modified: modifiedViewState
		};
	}

	public restoreViewState(s: editorCommon.IDiffEditorViewState): void {
		if (s.original && s.modified) {
			let diffEditorState = <editorCommon.IDiffEditorViewState>s;
			this.originalEditor.restoreViewState(diffEditorState.original);
			this.modifiedEditor.restoreViewState(diffEditorState.modified);
		}
	}

	public layout(dimension?: editorCommon.IDimension): void {
		this._elementSizeObserver.observe(dimension);
	}

	public focus(): void {
		this.modifiedEditor.focus();
	}

	public hasTextFocus(): boolean {
		return this.originalEditor.hasTextFocus() || this.modifiedEditor.hasTextFocus();
	}

	public onVisible(): void {
		this._isVisible = true;
		this.originalEditor.onVisible();
		this.modifiedEditor.onVisible();
		// Begin comparing
		this._beginUpdateDecorations();
	}

	public onHide(): void {
		this._isVisible = false;
		this.originalEditor.onHide();
		this.modifiedEditor.onHide();
		// Remove all view zones & decorations
		this._cleanViewZonesAndDecorations();
	}

	public trigger(source: string | null | undefined, handlerId: string, payload: any): void {
		this.modifiedEditor.trigger(source, handlerId, payload);
	}

	public changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any {
		return this.modifiedEditor.changeDecorations(callback);
	}

	//------------ end IDiffEditor methods



	//------------ begin layouting methods

	private _onDidContainerSizeChanged(): void {
		this._doLayout();
	}

	private _getReviewHeight(): number {
		return this._reviewPane.isVisible() ? this._elementSizeObserver.getHeight() : 0;
	}

	private _layoutOverviewRulers(): void {
		if (!this._originalOverviewRuler || !this._modifiedOverviewRuler) {
			return;
		}
		const height = this._elementSizeObserver.getHeight();
		const reviewHeight = this._getReviewHeight();

		let freeSpace = DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH - 2 * DiffEditorWidget.ONE_OVERVIEW_WIDTH;
		let layoutInfo = this.modifiedEditor.getLayoutInfo();
		if (layoutInfo) {
			this._originalOverviewRuler.setLayout({
				top: 0,
				width: DiffEditorWidget.ONE_OVERVIEW_WIDTH,
				right: freeSpace + DiffEditorWidget.ONE_OVERVIEW_WIDTH,
				height: (height - reviewHeight)
			});
			this._modifiedOverviewRuler.setLayout({
				top: 0,
				right: 0,
				width: DiffEditorWidget.ONE_OVERVIEW_WIDTH,
				height: (height - reviewHeight)
			});
		}
	}

	//------------ end layouting methods

	private _onViewZonesChanged(): void {
		if (this._currentlyChangingViewZones) {
			return;
		}
		this._updateDecorationsRunner.schedule();
	}

	private _beginUpdateDecorationsSoon(): void {
		// Clear previous timeout if necessary
		if (this._beginUpdateDecorationsTimeout !== -1) {
			window.clearTimeout(this._beginUpdateDecorationsTimeout);
			this._beginUpdateDecorationsTimeout = -1;
		}
		this._beginUpdateDecorationsTimeout = window.setTimeout(() => this._beginUpdateDecorations(), DiffEditorWidget.UPDATE_DIFF_DECORATIONS_DELAY);
	}

	private _lastOriginalWarning: URI | null = null;
	private _lastModifiedWarning: URI | null = null;

	private static _equals(a: URI | null, b: URI | null): boolean {
		if (!a && !b) {
			return true;
		}
		if (!a || !b) {
			return false;
		}
		return (a.toString() === b.toString());
	}

	private _beginUpdateDecorations(): void {
		this._beginUpdateDecorationsTimeout = -1;
		const currentOriginalModel = this.originalEditor.getModel();
		const currentModifiedModel = this.modifiedEditor.getModel();
		if (!currentOriginalModel || !currentModifiedModel) {
			return;
		}

		// Prevent old diff requests to come if a new request has been initiated
		// The best method would be to call cancel on the Promise, but this is not
		// yet supported, so using tokens for now.
		this._diffComputationToken++;
		let currentToken = this._diffComputationToken;
		this._setState(editorBrowser.DiffEditorState.ComputingDiff);

		if (!this._editorWorkerService.canComputeDiff(currentOriginalModel.uri, currentModifiedModel.uri)) {
			if (
				!DiffEditorWidget._equals(currentOriginalModel.uri, this._lastOriginalWarning)
				|| !DiffEditorWidget._equals(currentModifiedModel.uri, this._lastModifiedWarning)
			) {
				this._lastOriginalWarning = currentOriginalModel.uri;
				this._lastModifiedWarning = currentModifiedModel.uri;
				this._notificationService.warn(nls.localize("diff.tooLarge", "Cannot compare files because one file is too large."));
			}
			return;
		}

		this._editorWorkerService.computeDiff(currentOriginalModel.uri, currentModifiedModel.uri, this._ignoreTrimWhitespace, this._maxComputationTime).then((result) => {
			if (currentToken === this._diffComputationToken
				&& currentOriginalModel === this.originalEditor.getModel()
				&& currentModifiedModel === this.modifiedEditor.getModel()
			) {
				this._setState(editorBrowser.DiffEditorState.DiffComputed);
				this._diffComputationResult = result;
				this._updateDecorationsRunner.schedule();
				this._onDidUpdateDiff.fire();
			}
		}, (error) => {
			if (currentToken === this._diffComputationToken
				&& currentOriginalModel === this.originalEditor.getModel()
				&& currentModifiedModel === this.modifiedEditor.getModel()
			) {
				this._setState(editorBrowser.DiffEditorState.DiffComputed);
				this._diffComputationResult = null;
				this._updateDecorationsRunner.schedule();
			}
		});
	}

	private _cleanViewZonesAndDecorations(): void {
		this._originalEditorState.clean(this.originalEditor);
		this._modifiedEditorState.clean(this.modifiedEditor);
	}

	private _updateDecorations(): void {
		if (!this.originalEditor.getModel() || !this.modifiedEditor.getModel() || !this._originalOverviewRuler || !this._modifiedOverviewRuler) {
			return;
		}
		const lineChanges = (this._diffComputationResult ? this._diffComputationResult.changes : []);

		let foreignOriginal = this._originalEditorState.getForeignViewZones(this.originalEditor.getWhitespaces());
		let foreignModified = this._modifiedEditorState.getForeignViewZones(this.modifiedEditor.getWhitespaces());

		let diffDecorations = this._strategy.getEditorsDiffDecorations(lineChanges, this._ignoreTrimWhitespace, this._renderIndicators, foreignOriginal, foreignModified, this.originalEditor, this.modifiedEditor);

		try {
			this._currentlyChangingViewZones = true;
			this._originalEditorState.apply(this.originalEditor, this._originalOverviewRuler, diffDecorations.original, false);
			this._modifiedEditorState.apply(this.modifiedEditor, this._modifiedOverviewRuler, diffDecorations.modified, true);
		} finally {
			this._currentlyChangingViewZones = false;
		}
	}

	private _adjustOptionsForSubEditor(options: IDiffEditorOptions): IDiffEditorOptions {
		let clonedOptions: IDiffEditorOptions = objects.deepClone(options || {});
		clonedOptions.inDiffEditor = true;
		clonedOptions.wordWrap = 'off';
		clonedOptions.wordWrapMinified = false;
		clonedOptions.automaticLayout = false;
		clonedOptions.scrollbar = clonedOptions.scrollbar || {};
		clonedOptions.scrollbar.vertical = 'visible';
		clonedOptions.folding = false;
		clonedOptions.codeLens = false;
		clonedOptions.fixedOverflowWidgets = true;
		// clonedOptions.lineDecorationsWidth = '2ch';
		if (!clonedOptions.minimap) {
			clonedOptions.minimap = {};
		}
		clonedOptions.minimap.enabled = false;
		return clonedOptions;
	}

	private _adjustOptionsForLeftHandSide(options: IDiffEditorOptions, isEditable: boolean, isCodeLensEnabled: boolean): IEditorOptions {
		let result = this._adjustOptionsForSubEditor(options);
		if (isCodeLensEnabled) {
			result.codeLens = true;
		}
		result.readOnly = !isEditable;
		result.extraEditorClassName = 'original-in-monaco-diff-editor';
		return result;
	}

	private _adjustOptionsForRightHandSide(options: IDiffEditorOptions, isCodeLensEnabled: boolean): IEditorOptions {
		let result = this._adjustOptionsForSubEditor(options);
		if (isCodeLensEnabled) {
			result.codeLens = true;
		}
		result.revealHorizontalRightPadding = EditorOptions.revealHorizontalRightPadding.defaultValue + DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH;
		result.scrollbar!.verticalHasArrows = false;
		result.extraEditorClassName = 'modified-in-monaco-diff-editor';
		return result;
	}

	public doLayout(): void {
		this._elementSizeObserver.observe();
		this._doLayout();
	}

	private _doLayout(): void {
		const width = this._elementSizeObserver.getWidth();
		const height = this._elementSizeObserver.getHeight();
		const reviewHeight = this._getReviewHeight();

		let splitPoint = this._strategy.layout();

		this._originalDomNode.style.width = splitPoint + 'px';
		this._originalDomNode.style.left = '0px';

		this._modifiedDomNode.style.width = (width - splitPoint) + 'px';
		this._modifiedDomNode.style.left = splitPoint + 'px';

		this._overviewDomElement.style.top = '0px';
		this._overviewDomElement.style.height = (height - reviewHeight) + 'px';
		this._overviewDomElement.style.width = DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH + 'px';
		this._overviewDomElement.style.left = (width - DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH) + 'px';
		this._overviewViewportDomElement.setWidth(DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH);
		this._overviewViewportDomElement.setHeight(30);

		this.originalEditor.layout({ width: splitPoint, height: (height - reviewHeight) });
		this.modifiedEditor.layout({ width: width - splitPoint - DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH, height: (height - reviewHeight) });

		if (this._originalOverviewRuler || this._modifiedOverviewRuler) {
			this._layoutOverviewRulers();
		}

		this._reviewPane.layout(height - reviewHeight, width, reviewHeight);

		this._layoutOverviewViewport();
	}

	private _layoutOverviewViewport(): void {
		let layout = this._computeOverviewViewport();
		if (!layout) {
			this._overviewViewportDomElement.setTop(0);
			this._overviewViewportDomElement.setHeight(0);
		} else {
			this._overviewViewportDomElement.setTop(layout.top);
			this._overviewViewportDomElement.setHeight(layout.height);
		}
	}

	private _computeOverviewViewport(): { height: number; top: number; } | null {
		let layoutInfo = this.modifiedEditor.getLayoutInfo();
		if (!layoutInfo) {
			return null;
		}

		let scrollTop = this.modifiedEditor.getScrollTop();
		let scrollHeight = this.modifiedEditor.getScrollHeight();

		let computedAvailableSize = Math.max(0, layoutInfo.height);
		let computedRepresentableSize = Math.max(0, computedAvailableSize - 2 * 0);
		let computedRatio = scrollHeight > 0 ? (computedRepresentableSize / scrollHeight) : 0;

		let computedSliderSize = Math.max(0, Math.floor(layoutInfo.height * computedRatio));
		let computedSliderPosition = Math.floor(scrollTop * computedRatio);

		return {
			height: computedSliderSize,
			top: computedSliderPosition
		};
	}

	private _createDataSource(): IDataSource {
		return {
			getWidth: () => {
				return this._elementSizeObserver.getWidth();
			},

			getHeight: () => {
				return (this._elementSizeObserver.getHeight() - this._getReviewHeight());
			},

			getContainerDomNode: () => {
				return this._containerDomElement;
			},

			relayoutEditors: () => {
				this._doLayout();
			},

			getOriginalEditor: () => {
				return this.originalEditor;
			},

			getModifiedEditor: () => {
				return this.modifiedEditor;
			}
		};
	}

	private _setStrategy(newStrategy: IDiffEditorWidgetStyle): void {
		if (this._strategy) {
			this._strategy.dispose();
		}

		this._strategy = newStrategy;
		newStrategy.applyColors(this._themeService.getColorTheme());

		if (this._diffComputationResult) {
			this._updateDecorations();
		}

		// Just do a layout, the strategy might need it
		this._doLayout();
	}

	private _getLineChangeAtOrBeforeLineNumber(lineNumber: number, startLineNumberExtractor: (lineChange: editorCommon.ILineChange) => number): editorCommon.ILineChange | null {
		const lineChanges = (this._diffComputationResult ? this._diffComputationResult.changes : []);
		if (lineChanges.length === 0 || lineNumber < startLineNumberExtractor(lineChanges[0])) {
			// There are no changes or `lineNumber` is before the first change
			return null;
		}

		let min = 0, max = lineChanges.length - 1;
		while (min < max) {
			let mid = Math.floor((min + max) / 2);
			let midStart = startLineNumberExtractor(lineChanges[mid]);
			let midEnd = (mid + 1 <= max ? startLineNumberExtractor(lineChanges[mid + 1]) : Constants.MAX_SAFE_SMALL_INTEGER);

			if (lineNumber < midStart) {
				max = mid - 1;
			} else if (lineNumber >= midEnd) {
				min = mid + 1;
			} else {
				// HIT!
				min = mid;
				max = mid;
			}
		}
		return lineChanges[min];
	}

	private _getEquivalentLineForOriginalLineNumber(lineNumber: number): number {
		let lineChange = this._getLineChangeAtOrBeforeLineNumber(lineNumber, (lineChange) => lineChange.originalStartLineNumber);

		if (!lineChange) {
			return lineNumber;
		}

		let originalEquivalentLineNumber = lineChange.originalStartLineNumber + (lineChange.originalEndLineNumber > 0 ? -1 : 0);
		let modifiedEquivalentLineNumber = lineChange.modifiedStartLineNumber + (lineChange.modifiedEndLineNumber > 0 ? -1 : 0);
		let lineChangeOriginalLength = (lineChange.originalEndLineNumber > 0 ? (lineChange.originalEndLineNumber - lineChange.originalStartLineNumber + 1) : 0);
		let lineChangeModifiedLength = (lineChange.modifiedEndLineNumber > 0 ? (lineChange.modifiedEndLineNumber - lineChange.modifiedStartLineNumber + 1) : 0);


		let delta = lineNumber - originalEquivalentLineNumber;

		if (delta <= lineChangeOriginalLength) {
			return modifiedEquivalentLineNumber + Math.min(delta, lineChangeModifiedLength);
		}

		return modifiedEquivalentLineNumber + lineChangeModifiedLength - lineChangeOriginalLength + delta;
	}

	private _getEquivalentLineForModifiedLineNumber(lineNumber: number): number {
		let lineChange = this._getLineChangeAtOrBeforeLineNumber(lineNumber, (lineChange) => lineChange.modifiedStartLineNumber);

		if (!lineChange) {
			return lineNumber;
		}

		let originalEquivalentLineNumber = lineChange.originalStartLineNumber + (lineChange.originalEndLineNumber > 0 ? -1 : 0);
		let modifiedEquivalentLineNumber = lineChange.modifiedStartLineNumber + (lineChange.modifiedEndLineNumber > 0 ? -1 : 0);
		let lineChangeOriginalLength = (lineChange.originalEndLineNumber > 0 ? (lineChange.originalEndLineNumber - lineChange.originalStartLineNumber + 1) : 0);
		let lineChangeModifiedLength = (lineChange.modifiedEndLineNumber > 0 ? (lineChange.modifiedEndLineNumber - lineChange.modifiedStartLineNumber + 1) : 0);


		let delta = lineNumber - modifiedEquivalentLineNumber;

		if (delta <= lineChangeModifiedLength) {
			return originalEquivalentLineNumber + Math.min(delta, lineChangeOriginalLength);
		}

		return originalEquivalentLineNumber + lineChangeOriginalLength - lineChangeModifiedLength + delta;
	}

	public getDiffLineInformationForOriginal(lineNumber: number): editorBrowser.IDiffLineInformation | null {
		if (!this._diffComputationResult) {
			// Cannot answer that which I don't know
			return null;
		}
		return {
			equivalentLineNumber: this._getEquivalentLineForOriginalLineNumber(lineNumber)
		};
	}

	public getDiffLineInformationForModified(lineNumber: number): editorBrowser.IDiffLineInformation | null {
		if (!this._diffComputationResult) {
			// Cannot answer that which I don't know
			return null;
		}
		return {
			equivalentLineNumber: this._getEquivalentLineForModifiedLineNumber(lineNumber)
		};
	}
}

interface IDataSource {
	getWidth(): number;
	getHeight(): number;
	getContainerDomNode(): HTMLElement;
	relayoutEditors(): void;

	getOriginalEditor(): editorBrowser.ICodeEditor;
	getModifiedEditor(): editorBrowser.ICodeEditor;
}

abstract class DiffEditorWidgetStyle extends Disposable implements IDiffEditorWidgetStyle {

	_dataSource: IDataSource;
	_insertColor: Color | null;
	_removeColor: Color | null;

	constructor(dataSource: IDataSource) {
		super();
		this._dataSource = dataSource;
		this._insertColor = null;
		this._removeColor = null;
	}

	public applyColors(theme: IColorTheme): boolean {
		let newInsertColor = (theme.getColor(diffInserted) || defaultInsertColor).transparent(2);
		let newRemoveColor = (theme.getColor(diffRemoved) || defaultRemoveColor).transparent(2);
		let hasChanges = !newInsertColor.equals(this._insertColor) || !newRemoveColor.equals(this._removeColor);
		this._insertColor = newInsertColor;
		this._removeColor = newRemoveColor;
		return hasChanges;
	}

	public getEditorsDiffDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalWhitespaces: IEditorWhitespace[], modifiedWhitespaces: IEditorWhitespace[], originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorsDiffDecorationsWithZones {
		// Get view zones
		modifiedWhitespaces = modifiedWhitespaces.sort((a, b) => {
			return a.afterLineNumber - b.afterLineNumber;
		});
		originalWhitespaces = originalWhitespaces.sort((a, b) => {
			return a.afterLineNumber - b.afterLineNumber;
		});
		let zones = this._getViewZones(lineChanges, originalWhitespaces, modifiedWhitespaces, originalEditor, modifiedEditor, renderIndicators);

		// Get decorations & overview ruler zones
		let originalDecorations = this._getOriginalEditorDecorations(lineChanges, ignoreTrimWhitespace, renderIndicators, originalEditor, modifiedEditor);
		let modifiedDecorations = this._getModifiedEditorDecorations(lineChanges, ignoreTrimWhitespace, renderIndicators, originalEditor, modifiedEditor);

		return {
			original: {
				decorations: originalDecorations.decorations,
				overviewZones: originalDecorations.overviewZones,
				zones: zones.original
			},
			modified: {
				decorations: modifiedDecorations.decorations,
				overviewZones: modifiedDecorations.overviewZones,
				zones: zones.modified
			}
		};
	}

	protected abstract _getViewZones(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], modifiedForeignVZ: IEditorWhitespace[], originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor, renderIndicators: boolean): IEditorsZones;
	protected abstract _getOriginalEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorDiffDecorations;
	protected abstract _getModifiedEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorDiffDecorations;

	public abstract setEnableSplitViewResizing(enableSplitViewResizing: boolean): void;
	public abstract layout(): number;
}

interface IMyViewZone {
	shouldNotShrink?: boolean;
	afterLineNumber: number;
	heightInLines: number;
	minWidthInPx?: number;
	domNode: HTMLElement | null;
	marginDomNode?: HTMLElement | null;
	diff?: IDiffLinesChange;
}

class ForeignViewZonesIterator {

	private _index: number;
	private readonly _source: IEditorWhitespace[];
	public current: IEditorWhitespace | null;

	constructor(source: IEditorWhitespace[]) {
		this._source = source;
		this._index = -1;
		this.current = null;
		this.advance();
	}

	public advance(): void {
		this._index++;
		if (this._index < this._source.length) {
			this.current = this._source[this._index];
		} else {
			this.current = null;
		}
	}
}

abstract class ViewZonesComputer {

	private readonly lineChanges: editorCommon.ILineChange[];
	private readonly originalForeignVZ: IEditorWhitespace[];
	private readonly originalLineHeight: number;
	private readonly modifiedForeignVZ: IEditorWhitespace[];
	private readonly modifiedLineHeight: number;

	constructor(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], originalLineHeight: number, modifiedForeignVZ: IEditorWhitespace[], modifiedLineHeight: number) {
		this.lineChanges = lineChanges;
		this.originalForeignVZ = originalForeignVZ;
		this.originalLineHeight = originalLineHeight;
		this.modifiedForeignVZ = modifiedForeignVZ;
		this.modifiedLineHeight = modifiedLineHeight;
	}

	public getViewZones(): IEditorsZones {
		let result: { original: IMyViewZone[]; modified: IMyViewZone[]; } = {
			original: [],
			modified: []
		};

		let lineChangeModifiedLength: number = 0;
		let lineChangeOriginalLength: number = 0;
		let originalEquivalentLineNumber: number = 0;
		let modifiedEquivalentLineNumber: number = 0;
		let originalEndEquivalentLineNumber: number = 0;
		let modifiedEndEquivalentLineNumber: number = 0;

		let sortMyViewZones = (a: IMyViewZone, b: IMyViewZone) => {
			return a.afterLineNumber - b.afterLineNumber;
		};

		let addAndCombineIfPossible = (destination: IMyViewZone[], item: IMyViewZone) => {
			if (item.domNode === null && destination.length > 0) {
				let lastItem = destination[destination.length - 1];
				if (lastItem.afterLineNumber === item.afterLineNumber && lastItem.domNode === null) {
					lastItem.heightInLines += item.heightInLines;
					return;
				}
			}
			destination.push(item);
		};

		let modifiedForeignVZ = new ForeignViewZonesIterator(this.modifiedForeignVZ);
		let originalForeignVZ = new ForeignViewZonesIterator(this.originalForeignVZ);

		// In order to include foreign view zones after the last line change, the for loop will iterate once more after the end of the `lineChanges` array
		for (let i = 0, length = this.lineChanges.length; i <= length; i++) {
			let lineChange = (i < length ? this.lineChanges[i] : null);

			if (lineChange !== null) {
				originalEquivalentLineNumber = lineChange.originalStartLineNumber + (lineChange.originalEndLineNumber > 0 ? -1 : 0);
				modifiedEquivalentLineNumber = lineChange.modifiedStartLineNumber + (lineChange.modifiedEndLineNumber > 0 ? -1 : 0);
				lineChangeOriginalLength = (lineChange.originalEndLineNumber > 0 ? (lineChange.originalEndLineNumber - lineChange.originalStartLineNumber + 1) : 0);
				lineChangeModifiedLength = (lineChange.modifiedEndLineNumber > 0 ? (lineChange.modifiedEndLineNumber - lineChange.modifiedStartLineNumber + 1) : 0);
				originalEndEquivalentLineNumber = Math.max(lineChange.originalStartLineNumber, lineChange.originalEndLineNumber);
				modifiedEndEquivalentLineNumber = Math.max(lineChange.modifiedStartLineNumber, lineChange.modifiedEndLineNumber);
			} else {
				// Increase to very large value to get the producing tests of foreign view zones running
				originalEquivalentLineNumber += 10000000 + lineChangeOriginalLength;
				modifiedEquivalentLineNumber += 10000000 + lineChangeModifiedLength;
				originalEndEquivalentLineNumber = originalEquivalentLineNumber;
				modifiedEndEquivalentLineNumber = modifiedEquivalentLineNumber;
			}

			// Each step produces view zones, and after producing them, we try to cancel them out, to avoid empty-empty view zone cases
			let stepOriginal: IMyViewZone[] = [];
			let stepModified: IMyViewZone[] = [];

			// ---------------------------- PRODUCE VIEW ZONES

			// [PRODUCE] View zone(s) in original-side due to foreign view zone(s) in modified-side
			while (modifiedForeignVZ.current && modifiedForeignVZ.current.afterLineNumber <= modifiedEndEquivalentLineNumber) {
				let viewZoneLineNumber: number;
				if (modifiedForeignVZ.current.afterLineNumber <= modifiedEquivalentLineNumber) {
					viewZoneLineNumber = originalEquivalentLineNumber - modifiedEquivalentLineNumber + modifiedForeignVZ.current.afterLineNumber;
				} else {
					viewZoneLineNumber = originalEndEquivalentLineNumber;
				}

				let marginDomNode: HTMLDivElement | null = null;
				if (lineChange && lineChange.modifiedStartLineNumber <= modifiedForeignVZ.current.afterLineNumber && modifiedForeignVZ.current.afterLineNumber <= lineChange.modifiedEndLineNumber) {
					marginDomNode = this._createOriginalMarginDomNodeForModifiedForeignViewZoneInAddedRegion();
				}

				stepOriginal.push({
					afterLineNumber: viewZoneLineNumber,
					heightInLines: modifiedForeignVZ.current.height / this.modifiedLineHeight,
					domNode: null,
					marginDomNode: marginDomNode
				});
				modifiedForeignVZ.advance();
			}

			// [PRODUCE] View zone(s) in modified-side due to foreign view zone(s) in original-side
			while (originalForeignVZ.current && originalForeignVZ.current.afterLineNumber <= originalEndEquivalentLineNumber) {
				let viewZoneLineNumber: number;
				if (originalForeignVZ.current.afterLineNumber <= originalEquivalentLineNumber) {
					viewZoneLineNumber = modifiedEquivalentLineNumber - originalEquivalentLineNumber + originalForeignVZ.current.afterLineNumber;
				} else {
					viewZoneLineNumber = modifiedEndEquivalentLineNumber;
				}
				stepModified.push({
					afterLineNumber: viewZoneLineNumber,
					heightInLines: originalForeignVZ.current.height / this.originalLineHeight,
					domNode: null
				});
				originalForeignVZ.advance();
			}

			if (lineChange !== null && isChangeOrInsert(lineChange)) {
				let r = this._produceOriginalFromDiff(lineChange, lineChangeOriginalLength, lineChangeModifiedLength);
				if (r) {
					stepOriginal.push(r);
				}
			}

			if (lineChange !== null && isChangeOrDelete(lineChange)) {
				let r = this._produceModifiedFromDiff(lineChange, lineChangeOriginalLength, lineChangeModifiedLength);
				if (r) {
					stepModified.push(r);
				}
			}

			// ---------------------------- END PRODUCE VIEW ZONES


			// ---------------------------- EMIT MINIMAL VIEW ZONES

			// [CANCEL & EMIT] Try to cancel view zones out
			let stepOriginalIndex = 0;
			let stepModifiedIndex = 0;

			stepOriginal = stepOriginal.sort(sortMyViewZones);
			stepModified = stepModified.sort(sortMyViewZones);

			while (stepOriginalIndex < stepOriginal.length && stepModifiedIndex < stepModified.length) {
				let original = stepOriginal[stepOriginalIndex];
				let modified = stepModified[stepModifiedIndex];

				let originalDelta = original.afterLineNumber - originalEquivalentLineNumber;
				let modifiedDelta = modified.afterLineNumber - modifiedEquivalentLineNumber;

				if (originalDelta < modifiedDelta) {
					addAndCombineIfPossible(result.original, original);
					stepOriginalIndex++;
				} else if (modifiedDelta < originalDelta) {
					addAndCombineIfPossible(result.modified, modified);
					stepModifiedIndex++;
				} else if (original.shouldNotShrink) {
					addAndCombineIfPossible(result.original, original);
					stepOriginalIndex++;
				} else if (modified.shouldNotShrink) {
					addAndCombineIfPossible(result.modified, modified);
					stepModifiedIndex++;
				} else {
					if (original.heightInLines >= modified.heightInLines) {
						// modified view zone gets removed
						original.heightInLines -= modified.heightInLines;
						stepModifiedIndex++;
					} else {
						// original view zone gets removed
						modified.heightInLines -= original.heightInLines;
						stepOriginalIndex++;
					}
				}
			}

			// [EMIT] Remaining original view zones
			while (stepOriginalIndex < stepOriginal.length) {
				addAndCombineIfPossible(result.original, stepOriginal[stepOriginalIndex]);
				stepOriginalIndex++;
			}

			// [EMIT] Remaining modified view zones
			while (stepModifiedIndex < stepModified.length) {
				addAndCombineIfPossible(result.modified, stepModified[stepModifiedIndex]);
				stepModifiedIndex++;
			}

			// ---------------------------- END EMIT MINIMAL VIEW ZONES
		}

		return {
			original: ViewZonesComputer._ensureDomNodes(result.original),
			modified: ViewZonesComputer._ensureDomNodes(result.modified),
		};
	}

	private static _ensureDomNodes(zones: IMyViewZone[]): IMyViewZone[] {
		return zones.map((z) => {
			if (!z.domNode) {
				z.domNode = createFakeLinesDiv();
			}
			return z;
		});
	}

	protected abstract _createOriginalMarginDomNodeForModifiedForeignViewZoneInAddedRegion(): HTMLDivElement | null;

	protected abstract _produceOriginalFromDiff(lineChange: editorCommon.ILineChange, lineChangeOriginalLength: number, lineChangeModifiedLength: number): IMyViewZone | null;

	protected abstract _produceModifiedFromDiff(lineChange: editorCommon.ILineChange, lineChangeOriginalLength: number, lineChangeModifiedLength: number): IMyViewZone | null;
}

function createDecoration(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, options: ModelDecorationOptions) {
	return {
		range: new Range(startLineNumber, startColumn, endLineNumber, endColumn),
		options: options
	};
}

const DECORATIONS = {

	charDelete: ModelDecorationOptions.register({
		className: 'char-delete'
	}),
	charDeleteWholeLine: ModelDecorationOptions.register({
		className: 'char-delete',
		isWholeLine: true
	}),

	charInsert: ModelDecorationOptions.register({
		className: 'char-insert'
	}),
	charInsertWholeLine: ModelDecorationOptions.register({
		className: 'char-insert',
		isWholeLine: true
	}),

	lineInsert: ModelDecorationOptions.register({
		className: 'line-insert',
		marginClassName: 'line-insert',
		isWholeLine: true
	}),
	lineInsertWithSign: ModelDecorationOptions.register({
		className: 'line-insert',
		linesDecorationsClassName: 'insert-sign ' + diffInsertIcon.classNames,
		marginClassName: 'line-insert',
		isWholeLine: true
	}),

	lineDelete: ModelDecorationOptions.register({
		className: 'line-delete',
		marginClassName: 'line-delete',
		isWholeLine: true
	}),
	lineDeleteWithSign: ModelDecorationOptions.register({
		className: 'line-delete',
		linesDecorationsClassName: 'delete-sign ' + diffRemoveIcon.classNames,
		marginClassName: 'line-delete',
		isWholeLine: true

	}),
	lineDeleteMargin: ModelDecorationOptions.register({
		marginClassName: 'line-delete',
	})

};

class DiffEditorWidgetSideBySide extends DiffEditorWidgetStyle implements IDiffEditorWidgetStyle, IVerticalSashLayoutProvider {

	static readonly MINIMUM_EDITOR_WIDTH = 100;

	private _disableSash: boolean;
	private readonly _sash: Sash;
	private _sashRatio: number | null;
	private _sashPosition: number | null;
	private _startSashPosition: number | null;

	constructor(dataSource: IDataSource, enableSplitViewResizing: boolean) {
		super(dataSource);

		this._disableSash = (enableSplitViewResizing === false);
		this._sashRatio = null;
		this._sashPosition = null;
		this._startSashPosition = null;
		this._sash = this._register(new Sash(this._dataSource.getContainerDomNode(), this, { orientation: Orientation.VERTICAL }));

		if (this._disableSash) {
			this._sash.state = SashState.Disabled;
		}

		this._sash.onDidStart(() => this.onSashDragStart());
		this._sash.onDidChange((e: ISashEvent) => this.onSashDrag(e));
		this._sash.onDidEnd(() => this.onSashDragEnd());
		this._sash.onDidReset(() => this.onSashReset());
	}

	public setEnableSplitViewResizing(enableSplitViewResizing: boolean): void {
		let newDisableSash = (enableSplitViewResizing === false);
		if (this._disableSash !== newDisableSash) {
			this._disableSash = newDisableSash;
			this._sash.state = this._disableSash ? SashState.Disabled : SashState.Enabled;
		}
	}

	public layout(sashRatio: number | null = this._sashRatio): number {
		let w = this._dataSource.getWidth();
		let contentWidth = w - DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH;

		let sashPosition = Math.floor((sashRatio || 0.5) * contentWidth);
		let midPoint = Math.floor(0.5 * contentWidth);

		sashPosition = this._disableSash ? midPoint : sashPosition || midPoint;

		if (contentWidth > DiffEditorWidgetSideBySide.MINIMUM_EDITOR_WIDTH * 2) {
			if (sashPosition < DiffEditorWidgetSideBySide.MINIMUM_EDITOR_WIDTH) {
				sashPosition = DiffEditorWidgetSideBySide.MINIMUM_EDITOR_WIDTH;
			}

			if (sashPosition > contentWidth - DiffEditorWidgetSideBySide.MINIMUM_EDITOR_WIDTH) {
				sashPosition = contentWidth - DiffEditorWidgetSideBySide.MINIMUM_EDITOR_WIDTH;
			}
		} else {
			sashPosition = midPoint;
		}

		if (this._sashPosition !== sashPosition) {
			this._sashPosition = sashPosition;
			this._sash.layout();
		}

		return this._sashPosition;
	}

	private onSashDragStart(): void {
		this._startSashPosition = this._sashPosition!;
	}

	private onSashDrag(e: ISashEvent): void {
		let w = this._dataSource.getWidth();
		let contentWidth = w - DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH;
		let sashPosition = this.layout((this._startSashPosition! + (e.currentX - e.startX)) / contentWidth);

		this._sashRatio = sashPosition / contentWidth;

		this._dataSource.relayoutEditors();
	}

	private onSashDragEnd(): void {
		this._sash.layout();
	}

	private onSashReset(): void {
		this._sashRatio = 0.5;
		this._dataSource.relayoutEditors();
		this._sash.layout();
	}

	public getVerticalSashTop(sash: Sash): number {
		return 0;
	}

	public getVerticalSashLeft(sash: Sash): number {
		return this._sashPosition!;
	}

	public getVerticalSashHeight(sash: Sash): number {
		return this._dataSource.getHeight();
	}

	protected _getViewZones(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], modifiedForeignVZ: IEditorWhitespace[], originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorsZones {
		let c = new SideBySideViewZonesComputer(lineChanges, originalForeignVZ, originalEditor.getOption(EditorOption.lineHeight), modifiedForeignVZ, modifiedEditor.getOption(EditorOption.lineHeight));
		return c.getViewZones();
	}

	protected _getOriginalEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorDiffDecorations {
		const overviewZoneColor = String(this._removeColor);

		let result: IEditorDiffDecorations = {
			decorations: [],
			overviewZones: []
		};

		let originalModel = originalEditor.getModel()!;

		for (let i = 0, length = lineChanges.length; i < length; i++) {
			let lineChange = lineChanges[i];

			if (isChangeOrDelete(lineChange)) {
				result.decorations.push({
					range: new Range(lineChange.originalStartLineNumber, 1, lineChange.originalEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER),
					options: (renderIndicators ? DECORATIONS.lineDeleteWithSign : DECORATIONS.lineDelete)
				});
				if (!isChangeOrInsert(lineChange) || !lineChange.charChanges) {
					result.decorations.push(createDecoration(lineChange.originalStartLineNumber, 1, lineChange.originalEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER, DECORATIONS.charDeleteWholeLine));
				}

				result.overviewZones.push(new OverviewRulerZone(
					lineChange.originalStartLineNumber,
					lineChange.originalEndLineNumber,
					overviewZoneColor
				));

				if (lineChange.charChanges) {
					for (let j = 0, lengthJ = lineChange.charChanges.length; j < lengthJ; j++) {
						let charChange = lineChange.charChanges[j];
						if (isChangeOrDelete(charChange)) {
							if (ignoreTrimWhitespace) {
								for (let lineNumber = charChange.originalStartLineNumber; lineNumber <= charChange.originalEndLineNumber; lineNumber++) {
									let startColumn: number;
									let endColumn: number;
									if (lineNumber === charChange.originalStartLineNumber) {
										startColumn = charChange.originalStartColumn;
									} else {
										startColumn = originalModel.getLineFirstNonWhitespaceColumn(lineNumber);
									}
									if (lineNumber === charChange.originalEndLineNumber) {
										endColumn = charChange.originalEndColumn;
									} else {
										endColumn = originalModel.getLineLastNonWhitespaceColumn(lineNumber);
									}
									result.decorations.push(createDecoration(lineNumber, startColumn, lineNumber, endColumn, DECORATIONS.charDelete));
								}
							} else {
								result.decorations.push(createDecoration(charChange.originalStartLineNumber, charChange.originalStartColumn, charChange.originalEndLineNumber, charChange.originalEndColumn, DECORATIONS.charDelete));
							}
						}
					}
				}
			}
		}

		return result;
	}

	protected _getModifiedEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorDiffDecorations {
		const overviewZoneColor = String(this._insertColor);

		let result: IEditorDiffDecorations = {
			decorations: [],
			overviewZones: []
		};

		let modifiedModel = modifiedEditor.getModel()!;

		for (let i = 0, length = lineChanges.length; i < length; i++) {
			let lineChange = lineChanges[i];

			if (isChangeOrInsert(lineChange)) {

				result.decorations.push({
					range: new Range(lineChange.modifiedStartLineNumber, 1, lineChange.modifiedEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER),
					options: (renderIndicators ? DECORATIONS.lineInsertWithSign : DECORATIONS.lineInsert)
				});
				if (!isChangeOrDelete(lineChange) || !lineChange.charChanges) {
					result.decorations.push(createDecoration(lineChange.modifiedStartLineNumber, 1, lineChange.modifiedEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER, DECORATIONS.charInsertWholeLine));
				}
				result.overviewZones.push(new OverviewRulerZone(
					lineChange.modifiedStartLineNumber,
					lineChange.modifiedEndLineNumber,
					overviewZoneColor
				));

				if (lineChange.charChanges) {
					for (let j = 0, lengthJ = lineChange.charChanges.length; j < lengthJ; j++) {
						let charChange = lineChange.charChanges[j];
						if (isChangeOrInsert(charChange)) {
							if (ignoreTrimWhitespace) {
								for (let lineNumber = charChange.modifiedStartLineNumber; lineNumber <= charChange.modifiedEndLineNumber; lineNumber++) {
									let startColumn: number;
									let endColumn: number;
									if (lineNumber === charChange.modifiedStartLineNumber) {
										startColumn = charChange.modifiedStartColumn;
									} else {
										startColumn = modifiedModel.getLineFirstNonWhitespaceColumn(lineNumber);
									}
									if (lineNumber === charChange.modifiedEndLineNumber) {
										endColumn = charChange.modifiedEndColumn;
									} else {
										endColumn = modifiedModel.getLineLastNonWhitespaceColumn(lineNumber);
									}
									result.decorations.push(createDecoration(lineNumber, startColumn, lineNumber, endColumn, DECORATIONS.charInsert));
								}
							} else {
								result.decorations.push(createDecoration(charChange.modifiedStartLineNumber, charChange.modifiedStartColumn, charChange.modifiedEndLineNumber, charChange.modifiedEndColumn, DECORATIONS.charInsert));
							}
						}
					}
				}

			}
		}
		return result;
	}
}

class SideBySideViewZonesComputer extends ViewZonesComputer {

	constructor(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], originalLineHeight: number, modifiedForeignVZ: IEditorWhitespace[], modifiedLineHeight: number) {
		super(lineChanges, originalForeignVZ, originalLineHeight, modifiedForeignVZ, modifiedLineHeight);
	}

	protected _createOriginalMarginDomNodeForModifiedForeignViewZoneInAddedRegion(): HTMLDivElement | null {
		return null;
	}

	protected _produceOriginalFromDiff(lineChange: editorCommon.ILineChange, lineChangeOriginalLength: number, lineChangeModifiedLength: number): IMyViewZone | null {
		if (lineChangeModifiedLength > lineChangeOriginalLength) {
			return {
				afterLineNumber: Math.max(lineChange.originalStartLineNumber, lineChange.originalEndLineNumber),
				heightInLines: (lineChangeModifiedLength - lineChangeOriginalLength),
				domNode: null
			};
		}
		return null;
	}

	protected _produceModifiedFromDiff(lineChange: editorCommon.ILineChange, lineChangeOriginalLength: number, lineChangeModifiedLength: number): IMyViewZone | null {
		if (lineChangeOriginalLength > lineChangeModifiedLength) {
			return {
				afterLineNumber: Math.max(lineChange.modifiedStartLineNumber, lineChange.modifiedEndLineNumber),
				heightInLines: (lineChangeOriginalLength - lineChangeModifiedLength),
				domNode: null
			};
		}
		return null;
	}
}

class DiffEditorWidgetInline extends DiffEditorWidgetStyle implements IDiffEditorWidgetStyle {

	private decorationsLeft: number;

	constructor(dataSource: IDataSource, enableSplitViewResizing: boolean) {
		super(dataSource);

		this.decorationsLeft = dataSource.getOriginalEditor().getLayoutInfo().decorationsLeft;

		this._register(dataSource.getOriginalEditor().onDidLayoutChange((layoutInfo: EditorLayoutInfo) => {
			if (this.decorationsLeft !== layoutInfo.decorationsLeft) {
				this.decorationsLeft = layoutInfo.decorationsLeft;
				dataSource.relayoutEditors();
			}
		}));
	}

	public setEnableSplitViewResizing(enableSplitViewResizing: boolean): void {
		// Nothing to do..
	}

	protected _getViewZones(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], modifiedForeignVZ: IEditorWhitespace[], originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor, renderIndicators: boolean): IEditorsZones {
		let computer = new InlineViewZonesComputer(lineChanges, originalForeignVZ, modifiedForeignVZ, originalEditor, modifiedEditor, renderIndicators);
		return computer.getViewZones();
	}

	protected _getOriginalEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorDiffDecorations {
		const overviewZoneColor = String(this._removeColor);

		let result: IEditorDiffDecorations = {
			decorations: [],
			overviewZones: []
		};

		for (let i = 0, length = lineChanges.length; i < length; i++) {
			let lineChange = lineChanges[i];

			// Add overview zones in the overview ruler
			if (isChangeOrDelete(lineChange)) {
				result.decorations.push({
					range: new Range(lineChange.originalStartLineNumber, 1, lineChange.originalEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER),
					options: DECORATIONS.lineDeleteMargin
				});

				result.overviewZones.push(new OverviewRulerZone(
					lineChange.originalStartLineNumber,
					lineChange.originalEndLineNumber,
					overviewZoneColor
				));
			}
		}

		return result;
	}

	protected _getModifiedEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor): IEditorDiffDecorations {
		const overviewZoneColor = String(this._insertColor);

		let result: IEditorDiffDecorations = {
			decorations: [],
			overviewZones: []
		};

		let modifiedModel = modifiedEditor.getModel()!;

		for (let i = 0, length = lineChanges.length; i < length; i++) {
			let lineChange = lineChanges[i];

			// Add decorations & overview zones
			if (isChangeOrInsert(lineChange)) {
				result.decorations.push({
					range: new Range(lineChange.modifiedStartLineNumber, 1, lineChange.modifiedEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER),
					options: (renderIndicators ? DECORATIONS.lineInsertWithSign : DECORATIONS.lineInsert)
				});

				result.overviewZones.push(new OverviewRulerZone(
					lineChange.modifiedStartLineNumber,
					lineChange.modifiedEndLineNumber,
					overviewZoneColor
				));

				if (lineChange.charChanges) {
					for (let j = 0, lengthJ = lineChange.charChanges.length; j < lengthJ; j++) {
						let charChange = lineChange.charChanges[j];
						if (isChangeOrInsert(charChange)) {
							if (ignoreTrimWhitespace) {
								for (let lineNumber = charChange.modifiedStartLineNumber; lineNumber <= charChange.modifiedEndLineNumber; lineNumber++) {
									let startColumn: number;
									let endColumn: number;
									if (lineNumber === charChange.modifiedStartLineNumber) {
										startColumn = charChange.modifiedStartColumn;
									} else {
										startColumn = modifiedModel.getLineFirstNonWhitespaceColumn(lineNumber);
									}
									if (lineNumber === charChange.modifiedEndLineNumber) {
										endColumn = charChange.modifiedEndColumn;
									} else {
										endColumn = modifiedModel.getLineLastNonWhitespaceColumn(lineNumber);
									}
									result.decorations.push(createDecoration(lineNumber, startColumn, lineNumber, endColumn, DECORATIONS.charInsert));
								}
							} else {
								result.decorations.push(createDecoration(charChange.modifiedStartLineNumber, charChange.modifiedStartColumn, charChange.modifiedEndLineNumber, charChange.modifiedEndColumn, DECORATIONS.charInsert));
							}
						}
					}
				} else {
					result.decorations.push(createDecoration(lineChange.modifiedStartLineNumber, 1, lineChange.modifiedEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER, DECORATIONS.charInsertWholeLine));
				}
			}
		}

		return result;
	}

	public layout(): number {
		// An editor should not be smaller than 5px
		return Math.max(5, this.decorationsLeft);
	}

}

class InlineViewZonesComputer extends ViewZonesComputer {

	private readonly originalModel: ITextModel;
	private readonly modifiedEditorOptions: IComputedEditorOptions;
	private readonly modifiedEditorTabSize: number;
	private readonly renderIndicators: boolean;

	constructor(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], modifiedForeignVZ: IEditorWhitespace[], originalEditor: editorBrowser.ICodeEditor, modifiedEditor: editorBrowser.ICodeEditor, renderIndicators: boolean) {
		super(lineChanges, originalForeignVZ, originalEditor.getOption(EditorOption.lineHeight), modifiedForeignVZ, modifiedEditor.getOption(EditorOption.lineHeight));
		this.originalModel = originalEditor.getModel()!;
		this.modifiedEditorOptions = modifiedEditor.getOptions();
		this.modifiedEditorTabSize = modifiedEditor.getModel()!.getOptions().tabSize;
		this.renderIndicators = renderIndicators;
	}

	protected _createOriginalMarginDomNodeForModifiedForeignViewZoneInAddedRegion(): HTMLDivElement | null {
		let result = document.createElement('div');
		result.className = 'inline-added-margin-view-zone';
		return result;
	}

	protected _produceOriginalFromDiff(lineChange: editorCommon.ILineChange, lineChangeOriginalLength: number, lineChangeModifiedLength: number): IMyViewZone | null {
		let marginDomNode = document.createElement('div');
		marginDomNode.className = 'inline-added-margin-view-zone';

		return {
			afterLineNumber: Math.max(lineChange.originalStartLineNumber, lineChange.originalEndLineNumber),
			heightInLines: lineChangeModifiedLength,
			domNode: document.createElement('div'),
			marginDomNode: marginDomNode
		};
	}

	protected _produceModifiedFromDiff(lineChange: editorCommon.ILineChange, lineChangeOriginalLength: number, lineChangeModifiedLength: number): IMyViewZone | null {
		let decorations: InlineDecoration[] = [];
		if (lineChange.charChanges) {
			for (let j = 0, lengthJ = lineChange.charChanges.length; j < lengthJ; j++) {
				let charChange = lineChange.charChanges[j];
				if (isChangeOrDelete(charChange)) {
					decorations.push(new InlineDecoration(
						new Range(charChange.originalStartLineNumber, charChange.originalStartColumn, charChange.originalEndLineNumber, charChange.originalEndColumn),
						'char-delete',
						InlineDecorationType.Regular
					));
				}
			}
		}

		let sb = createStringBuilder(10000);
		let marginHTML: string[] = [];
		const layoutInfo = this.modifiedEditorOptions.get(EditorOption.layoutInfo);
		const fontInfo = this.modifiedEditorOptions.get(EditorOption.fontInfo);
		const lineDecorationsWidth = layoutInfo.decorationsWidth;

		let lineHeight = this.modifiedEditorOptions.get(EditorOption.lineHeight);
		const typicalHalfwidthCharacterWidth = fontInfo.typicalHalfwidthCharacterWidth;
		let maxCharsPerLine = 0;
		const originalContent: string[] = [];
		for (let lineNumber = lineChange.originalStartLineNumber; lineNumber <= lineChange.originalEndLineNumber; lineNumber++) {
			maxCharsPerLine = Math.max(maxCharsPerLine, this._renderOriginalLine(lineNumber - lineChange.originalStartLineNumber, this.originalModel, this.modifiedEditorOptions, this.modifiedEditorTabSize, lineNumber, decorations, sb));
			originalContent.push(this.originalModel.getLineContent(lineNumber));

			if (this.renderIndicators) {
				let index = lineNumber - lineChange.originalStartLineNumber;
				marginHTML = marginHTML.concat([
					`<div class="delete-sign ${diffRemoveIcon.classNames}" style="position:absolute;top:${index * lineHeight}px;width:${lineDecorationsWidth}px;height:${lineHeight}px;right:0;"></div>`
				]);
			}
		}
		maxCharsPerLine += this.modifiedEditorOptions.get(EditorOption.scrollBeyondLastColumn);

		let domNode = document.createElement('div');
		domNode.className = `view-lines line-delete ${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME}`;
		domNode.innerHTML = sb.build();
		Configuration.applyFontInfoSlow(domNode, fontInfo);

		let marginDomNode = document.createElement('div');
		marginDomNode.className = 'inline-deleted-margin-view-zone';
		marginDomNode.innerHTML = marginHTML.join('');
		Configuration.applyFontInfoSlow(marginDomNode, fontInfo);

		return {
			shouldNotShrink: true,
			afterLineNumber: (lineChange.modifiedEndLineNumber === 0 ? lineChange.modifiedStartLineNumber : lineChange.modifiedStartLineNumber - 1),
			heightInLines: lineChangeOriginalLength,
			minWidthInPx: (maxCharsPerLine * typicalHalfwidthCharacterWidth),
			domNode: domNode,
			marginDomNode: marginDomNode,
			diff: {
				originalStartLineNumber: lineChange.originalStartLineNumber,
				originalEndLineNumber: lineChange.originalEndLineNumber,
				modifiedStartLineNumber: lineChange.modifiedStartLineNumber,
				modifiedEndLineNumber: lineChange.modifiedEndLineNumber,
				originalContent: originalContent
			}
		};
	}

	private _renderOriginalLine(count: number, originalModel: ITextModel, options: IComputedEditorOptions, tabSize: number, lineNumber: number, decorations: InlineDecoration[], sb: IStringBuilder): number {
		const lineTokens = originalModel.getLineTokens(lineNumber);
		const lineContent = lineTokens.getLineContent();
		const fontInfo = options.get(EditorOption.fontInfo);

		const actualDecorations = LineDecoration.filter(decorations, lineNumber, 1, lineContent.length + 1);

		sb.appendASCIIString('<div class="view-line');
		if (decorations.length === 0) {
			// No char changes
			sb.appendASCIIString(' char-delete');
		}
		sb.appendASCIIString('" style="top:');
		sb.appendASCIIString(String(count * options.get(EditorOption.lineHeight)));
		sb.appendASCIIString('px;width:1000000px;">');

		const isBasicASCII = ViewLineRenderingData.isBasicASCII(lineContent, originalModel.mightContainNonBasicASCII());
		const containsRTL = ViewLineRenderingData.containsRTL(lineContent, isBasicASCII, originalModel.mightContainRTL());
		const output = renderViewLine(new RenderLineInput(
			(fontInfo.isMonospace && !options.get(EditorOption.disableMonospaceOptimizations)),
			fontInfo.canUseHalfwidthRightwardsArrow,
			lineContent,
			false,
			isBasicASCII,
			containsRTL,
			0,
			lineTokens,
			actualDecorations,
			tabSize,
			0,
			fontInfo.spaceWidth,
			fontInfo.middotWidth,
			fontInfo.wsmiddotWidth,
			options.get(EditorOption.stopRenderingLineAfter),
			options.get(EditorOption.renderWhitespace),
			options.get(EditorOption.renderControlCharacters),
			options.get(EditorOption.fontLigatures) !== EditorFontLigatures.OFF,
			null // Send no selections, original line cannot be selected
		), sb);

		sb.appendASCIIString('</div>');

		const absoluteOffsets = output.characterMapping.getAbsoluteOffsets();
		return absoluteOffsets.length > 0 ? absoluteOffsets[absoluteOffsets.length - 1] : 0;
	}
}

function isChangeOrInsert(lineChange: editorCommon.IChange): boolean {
	return lineChange.modifiedEndLineNumber > 0;
}

function isChangeOrDelete(lineChange: editorCommon.IChange): boolean {
	return lineChange.originalEndLineNumber > 0;
}

function createFakeLinesDiv(): HTMLElement {
	let r = document.createElement('div');
	r.className = 'diagonal-fill';
	return r;
}

registerThemingParticipant((theme, collector) => {
	const added = theme.getColor(diffInserted);
	if (added) {
		collector.addRule(`.monaco-editor .line-insert, .monaco-editor .char-insert { background-color: ${added}; }`);
		collector.addRule(`.monaco-diff-editor .line-insert, .monaco-diff-editor .char-insert { background-color: ${added}; }`);
		collector.addRule(`.monaco-editor .inline-added-margin-view-zone { background-color: ${added}; }`);
	}

	const removed = theme.getColor(diffRemoved);
	if (removed) {
		collector.addRule(`.monaco-editor .line-delete, .monaco-editor .char-delete { background-color: ${removed}; }`);
		collector.addRule(`.monaco-diff-editor .line-delete, .monaco-diff-editor .char-delete { background-color: ${removed}; }`);
		collector.addRule(`.monaco-editor .inline-deleted-margin-view-zone { background-color: ${removed}; }`);
	}

	const addedOutline = theme.getColor(diffInsertedOutline);
	if (addedOutline) {
		collector.addRule(`.monaco-editor .line-insert, .monaco-editor .char-insert { border: 1px ${theme.type === 'hc' ? 'dashed' : 'solid'} ${addedOutline}; }`);
	}

	const removedOutline = theme.getColor(diffRemovedOutline);
	if (removedOutline) {
		collector.addRule(`.monaco-editor .line-delete, .monaco-editor .char-delete { border: 1px ${theme.type === 'hc' ? 'dashed' : 'solid'} ${removedOutline}; }`);
	}

	const shadow = theme.getColor(scrollbarShadow);
	if (shadow) {
		collector.addRule(`.monaco-diff-editor.side-by-side .editor.modified { box-shadow: -6px 0 5px -5px ${shadow}; }`);
	}

	const border = theme.getColor(diffBorder);
	if (border) {
		collector.addRule(`.monaco-diff-editor.side-by-side .editor.modified { border-left: 1px solid ${border}; }`);
	}

	const scrollbarSliderBackgroundColor = theme.getColor(scrollbarSliderBackground);
	if (scrollbarSliderBackgroundColor) {
		collector.addRule(`
			.monaco-diff-editor .diffViewport {
				background: ${scrollbarSliderBackgroundColor};
			}
		`);
	}

	const scrollbarSliderHoverBackgroundColor = theme.getColor(scrollbarSliderHoverBackground);
	if (scrollbarSliderHoverBackgroundColor) {
		collector.addRule(`
			.monaco-diff-editor .diffViewport:hover {
				background: ${scrollbarSliderHoverBackgroundColor};
			}
		`);
	}

	const scrollbarSliderActiveBackgroundColor = theme.getColor(scrollbarSliderActiveBackground);
	if (scrollbarSliderActiveBackgroundColor) {
		collector.addRule(`
			.monaco-diff-editor .diffViewport:active {
				background: ${scrollbarSliderActiveBackgroundColor};
			}
		`);
	}

	const diffDiagonalFillColor = theme.getColor(diffDiagonalFill);
	collector.addRule(`
	.monaco-editor .diagonal-fill {
		background-image: linear-gradient(
			-45deg,
			${diffDiagonalFillColor} 12.5%,
			#0000 12.5%, #0000 50%,
			${diffDiagonalFillColor} 50%, ${diffDiagonalFillColor} 62.5%,
			#0000 62.5%, #0000 100%
		);
		background-size: 8px 8px;
	}
	`);
});
