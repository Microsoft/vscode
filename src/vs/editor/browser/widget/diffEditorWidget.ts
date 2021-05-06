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
import { URI } from 'vs/base/common/uri';
import { Configuration } from 'vs/editor/browser/config/configuration';
import { StableEditorScrollState } from 'vs/editor/browser/core/editorState';
import * as editorBrowser from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { DiffReview } from 'vs/editor/browser/widget/diffReview';
import { IDiffEditorOptions, EditorLayoutInfo, EditorOption, EditorOptions, EditorFontLigatures, stringSet as validateStringSetOption, boolean as validateBooleanOption } from 'vs/editor/common/config/editorOptions';
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
import { ILineBreaksComputer, InlineDecoration, InlineDecorationType, IViewModel, ViewLineRenderingData } from 'vs/editor/common/viewModel/viewModel';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { defaultInsertColor, defaultRemoveColor, diffBorder, diffInserted, diffInsertedOutline, diffRemoved, diffRemovedOutline, scrollbarShadow, scrollbarSliderBackground, scrollbarSliderHoverBackground, scrollbarSliderActiveBackground, diffDiagonalFill } from 'vs/platform/theme/common/colorRegistry';
import { IColorTheme, IThemeService, getThemeTypeSelector, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IDiffLinesChange, InlineDiffMargin } from 'vs/editor/browser/widget/inlineDiffMargin';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { Constants } from 'vs/base/common/uint';
import { EditorExtensionsRegistry, IDiffEditorContributionDescription } from 'vs/editor/browser/editorExtensions';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IEditorProgressService, IProgressRunner } from 'vs/platform/progress/common/progress';
import { ElementSizeObserver } from 'vs/editor/browser/config/elementSizeObserver';
import { Codicon } from 'vs/base/common/codicons';
import { MOUSE_CURSOR_TEXT_CSS_CLASS_NAME } from 'vs/base/browser/ui/mouseCursor/mouseCursor';
import { IViewLineTokens } from 'vs/editor/common/core/lineTokens';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

export interface IDiffCodeEditorWidgetOptions {
	originalEditor?: ICodeEditorWidgetOptions;
	modifiedEditor?: ICodeEditorWidgetOptions;
}

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

class VisualEditorState {
	private _zones: string[];
	private _inlineDiffMargins: InlineDiffMargin[];
	private _zonesMap: { [zoneId: string]: boolean; };
	private _decorations: string[];

	constructor(
		private _contextMenuService: IContextMenuService,
		private _clipboardService: IClipboardService
	) {
		this._zones = [];
		this._inlineDiffMargins = [];
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
				for (const zoneId of this._zones) {
					viewChangeAccessor.removeZone(zoneId);
				}
			});
		}
		this._zones = [];
		this._zonesMap = {};

		// (2) Model decorations
		this._decorations = editor.deltaDecorations(this._decorations, []);
	}

	public apply(editor: CodeEditorWidget, overviewRuler: editorBrowser.IOverviewRuler | null, newDecorations: IEditorDiffDecorationsWithZones, restoreScrollState: boolean): void {

		const scrollState = restoreScrollState ? StableEditorScrollState.capture(editor) : null;

		// view zones
		editor.changeViewZones((viewChangeAccessor: editorBrowser.IViewZoneChangeAccessor) => {
			for (const zoneId of this._zones) {
				viewChangeAccessor.removeZone(zoneId);
			}
			for (const inlineDiffMargin of this._inlineDiffMargins) {
				inlineDiffMargin.dispose();
			}
			this._zones = [];
			this._zonesMap = {};
			this._inlineDiffMargins = [];
			for (let i = 0, length = newDecorations.zones.length; i < length; i++) {
				const viewZone = <editorBrowser.IViewZone>newDecorations.zones[i];
				viewZone.suppressMouseDown = true;
				const zoneId = viewChangeAccessor.addZone(viewZone);
				this._zones.push(zoneId);
				this._zonesMap[String(zoneId)] = true;

				if (newDecorations.zones[i].diff && viewZone.marginDomNode) {
					viewZone.suppressMouseDown = false;
					this._inlineDiffMargins.push(new InlineDiffMargin(zoneId, viewZone.marginDomNode, editor, newDecorations.zones[i].diff!, this._contextMenuService, this._clipboardService));
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


const diffInsertIcon = registerIcon('diff-insert', Codicon.add, nls.localize('diffInsertIcon', 'Line decoration for inserts in the diff editor.'));
const diffRemoveIcon = registerIcon('diff-remove', Codicon.remove, nls.localize('diffRemoveIcon', 'Line decoration for removals in the diff editor.'));
const ttPolicy = window.trustedTypes?.createPolicy('diffEditorWidget', { createHTML: value => value });

export class DiffEditorWidget extends Disposable implements editorBrowser.IDiffEditor {

	private static readonly ONE_OVERVIEW_WIDTH = 15;
	public static readonly ENTIRE_DIFF_OVERVIEW_WIDTH = 30;
	private static readonly UPDATE_DIFF_DECORATIONS_DELAY = 200; // ms

	private readonly _onDidDispose: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidDispose: Event<void> = this._onDidDispose.event;

	private readonly _onDidUpdateDiff: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidUpdateDiff: Event<void> = this._onDidUpdateDiff.event;

	private readonly _onDidContentSizeChange: Emitter<editorCommon.IContentSizeChangedEvent> = this._register(new Emitter<editorCommon.IContentSizeChangedEvent>());
	public readonly onDidContentSizeChange: Event<editorCommon.IContentSizeChangedEvent> = this._onDidContentSizeChange.event;

	private readonly _id: number;
	private _state: editorBrowser.DiffEditorState;
	private _updatingDiffProgress: IProgressRunner | null;

	private readonly _domElement: HTMLElement;
	protected readonly _containerDomElement: HTMLElement;
	private readonly _overviewDomElement: HTMLElement;
	private readonly _overviewViewportDomElement: FastDomNode<HTMLElement>;

	private readonly _elementSizeObserver: ElementSizeObserver;

	private readonly _originalEditor: CodeEditorWidget;
	private readonly _originalDomNode: HTMLElement;
	private readonly _originalEditorState: VisualEditorState;
	private _originalOverviewRuler: editorBrowser.IOverviewRuler | null;

	private readonly _modifiedEditor: CodeEditorWidget;
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
	private _diffCodeLens: boolean;
	private _diffWordWrap: 'off' | 'on' | 'inherit';

	private _renderSideBySide: boolean;
	private _maxComputationTime: number;
	private _renderIndicators: boolean;
	private _enableSplitViewResizing: boolean;
	private _renderOverviewRuler: boolean;
	private _strategy!: DiffEditorWidgetStyle;

	private readonly _updateDecorationsRunner: RunOnceScheduler;

	private readonly _editorWorkerService: IEditorWorkerService;
	private readonly _contextKeyService: IContextKeyService;
	private readonly _instantiationService: IInstantiationService;
	private readonly _codeEditorService: ICodeEditorService;
	private readonly _themeService: IThemeService;
	private readonly _notificationService: INotificationService;

	private readonly _reviewPane: DiffReview;

	constructor(
		domElement: HTMLElement,
		options: Readonly<editorBrowser.IDiffEditorConstructionOptions>,
		codeEditorWidgetOptions: IDiffCodeEditorWidgetOptions,
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
		this._instantiationService = instantiationService.createChild(new ServiceCollection([IContextKeyService, this._contextKeyService]));
		this._contextKeyService.createKey('isInDiffEditor', true);
		this._themeService = themeService;
		this._notificationService = notificationService;

		this._id = (++DIFF_EDITOR_ID);
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

		this._originalIsEditable = validateBooleanOption(options.originalEditable, false);
		this._diffCodeLens = validateBooleanOption(options.diffCodeLens, false);
		this._diffWordWrap = validateDiffWordWrap(options.diffWordWrap, 'inherit');

		if (typeof options.isInEmbeddedEditor !== 'undefined') {
			this._contextKeyService.createKey('isInEmbeddedDiffEditor', options.isInEmbeddedEditor);
		} else {
			this._contextKeyService.createKey('isInEmbeddedDiffEditor', false);
		}

		this._renderOverviewRuler = true;
		if (typeof options.renderOverviewRuler !== 'undefined') {
			this._renderOverviewRuler = Boolean(options.renderOverviewRuler);
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
			this._modifiedEditor.delegateVerticalScrollbarMouseDown(e);
		}));
		if (this._renderOverviewRuler) {
			this._containerDomElement.appendChild(this._overviewDomElement);
		}

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

		this._elementSizeObserver = this._register(new ElementSizeObserver(this._containerDomElement, options.dimension, () => this._onDidContainerSizeChanged()));
		if (options.automaticLayout) {
			this._elementSizeObserver.startObserving();
		}

		this._diffComputationResult = null;

		this._originalEditor = this._createLeftHandSideEditor(options, codeEditorWidgetOptions.originalEditor || {});
		this._modifiedEditor = this._createRightHandSideEditor(options, codeEditorWidgetOptions.modifiedEditor || {});

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

	public getContentHeight(): number {
		return this._modifiedEditor.getContentHeight();
	}

	public getViewWidth(): number {
		return this._elementSizeObserver.getWidth();
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
		if (!this._renderOverviewRuler) {
			return;
		}

		if (this._originalOverviewRuler) {
			this._overviewDomElement.removeChild(this._originalOverviewRuler.getDomNode());
			this._originalOverviewRuler.dispose();
		}
		if (this._originalEditor.hasModel()) {
			this._originalOverviewRuler = this._originalEditor.createOverviewRuler('original diffOverviewRuler')!;
			this._overviewDomElement.appendChild(this._originalOverviewRuler.getDomNode());
		}

		if (this._modifiedOverviewRuler) {
			this._overviewDomElement.removeChild(this._modifiedOverviewRuler.getDomNode());
			this._modifiedOverviewRuler.dispose();
		}
		if (this._modifiedEditor.hasModel()) {
			this._modifiedOverviewRuler = this._modifiedEditor.createOverviewRuler('modified diffOverviewRuler')!;
			this._overviewDomElement.appendChild(this._modifiedOverviewRuler.getDomNode());
		}

		this._layoutOverviewRulers();
	}

	private _createLeftHandSideEditor(options: Readonly<editorBrowser.IDiffEditorConstructionOptions>, codeEditorWidgetOptions: ICodeEditorWidgetOptions): CodeEditorWidget {
		const editor = this._createInnerEditor(this._instantiationService, this._originalDomNode, this._adjustOptionsForLeftHandSide(options), codeEditorWidgetOptions);

		this._register(editor.onDidScrollChange((e) => {
			if (this._isHandlingScrollEvent) {
				return;
			}
			if (!e.scrollTopChanged && !e.scrollLeftChanged && !e.scrollHeightChanged) {
				return;
			}
			this._isHandlingScrollEvent = true;
			this._modifiedEditor.setScrollPosition({
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
			if (!editor.getModel()) {
				return;
			}
			if (e.hasChanged(EditorOption.fontInfo)) {
				this._updateDecorationsRunner.schedule();
			}
			if (e.hasChanged(EditorOption.wrappingInfo)) {
				this._updateDecorationsRunner.cancel();
				this._updateDecorations();
			}
		}));

		this._register(editor.onDidChangeModelContent(() => {
			if (this._isVisible) {
				this._beginUpdateDecorationsSoon();
			}
		}));

		const isInDiffLeftEditorKey = this._contextKeyService.createKey<boolean>('isInDiffLeftEditor', editor.hasWidgetFocus());
		this._register(editor.onDidFocusEditorWidget(() => isInDiffLeftEditorKey.set(true)));
		this._register(editor.onDidBlurEditorWidget(() => isInDiffLeftEditorKey.set(false)));

		this._register(editor.onDidContentSizeChange(e => {
			const width = this._originalEditor.getContentWidth() + this._modifiedEditor.getContentWidth() + DiffEditorWidget.ONE_OVERVIEW_WIDTH;
			const height = Math.max(this._modifiedEditor.getContentHeight(), this._originalEditor.getContentHeight());

			this._onDidContentSizeChange.fire({
				contentHeight: height,
				contentWidth: width,
				contentHeightChanged: e.contentHeightChanged,
				contentWidthChanged: e.contentWidthChanged
			});
		}));

		return editor;
	}

	private _createRightHandSideEditor(options: Readonly<editorBrowser.IDiffEditorConstructionOptions>, codeEditorWidgetOptions: ICodeEditorWidgetOptions): CodeEditorWidget {
		const editor = this._createInnerEditor(this._instantiationService, this._modifiedDomNode, this._adjustOptionsForRightHandSide(options), codeEditorWidgetOptions);

		this._register(editor.onDidScrollChange((e) => {
			if (this._isHandlingScrollEvent) {
				return;
			}
			if (!e.scrollTopChanged && !e.scrollLeftChanged && !e.scrollHeightChanged) {
				return;
			}
			this._isHandlingScrollEvent = true;
			this._originalEditor.setScrollPosition({
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
			if (!editor.getModel()) {
				return;
			}
			if (e.hasChanged(EditorOption.fontInfo)) {
				this._updateDecorationsRunner.schedule();
			}
			if (e.hasChanged(EditorOption.wrappingInfo)) {
				this._updateDecorationsRunner.cancel();
				this._updateDecorations();
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

		const isInDiffRightEditorKey = this._contextKeyService.createKey<boolean>('isInDiffRightEditor', editor.hasWidgetFocus());
		this._register(editor.onDidFocusEditorWidget(() => isInDiffRightEditorKey.set(true)));
		this._register(editor.onDidBlurEditorWidget(() => isInDiffRightEditorKey.set(false)));

		this._register(editor.onDidContentSizeChange(e => {
			const width = this._originalEditor.getContentWidth() + this._modifiedEditor.getContentWidth() + DiffEditorWidget.ONE_OVERVIEW_WIDTH;
			const height = Math.max(this._modifiedEditor.getContentHeight(), this._originalEditor.getContentHeight());

			this._onDidContentSizeChange.fire({
				contentHeight: height,
				contentWidth: width,
				contentHeightChanged: e.contentHeightChanged,
				contentWidthChanged: e.contentWidthChanged
			});
		}));

		return editor;
	}

	protected _createInnerEditor(instantiationService: IInstantiationService, container: HTMLElement, options: Readonly<editorBrowser.IEditorConstructionOptions>, editorWidgetOptions: ICodeEditorWidgetOptions): CodeEditorWidget {
		return instantiationService.createInstance(CodeEditorWidget, container, options, editorWidgetOptions);
	}

	public override dispose(): void {
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
		if (this._renderOverviewRuler) {
			this._containerDomElement.removeChild(this._overviewDomElement);
		}

		this._containerDomElement.removeChild(this._originalDomNode);
		this._originalEditor.dispose();

		this._containerDomElement.removeChild(this._modifiedDomNode);
		this._modifiedEditor.dispose();

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
		return this.getEditorType() + ':' + this._id;
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
		return this._originalEditor;
	}

	public getModifiedEditor(): editorBrowser.ICodeEditor {
		return this._modifiedEditor;
	}

	public updateOptions(newOptions: Readonly<IDiffEditorOptions>): void {

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

		this._originalIsEditable = validateBooleanOption(newOptions.originalEditable, this._originalIsEditable);
		this._diffCodeLens = validateBooleanOption(newOptions.diffCodeLens, this._diffCodeLens);
		this._diffWordWrap = validateDiffWordWrap(newOptions.diffWordWrap, this._diffWordWrap);

		this._modifiedEditor.updateOptions(this._adjustOptionsForRightHandSide(newOptions));
		this._originalEditor.updateOptions(this._adjustOptionsForLeftHandSide(newOptions));

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

		// renderOverviewRuler
		if (typeof newOptions.renderOverviewRuler !== 'undefined' && this._renderOverviewRuler !== newOptions.renderOverviewRuler) {
			this._renderOverviewRuler = newOptions.renderOverviewRuler;
			if (this._renderOverviewRuler) {
				this._containerDomElement.appendChild(this._overviewDomElement);
			} else {
				this._containerDomElement.removeChild(this._overviewDomElement);
			}
		}
	}

	public getModel(): editorCommon.IDiffEditorModel {
		return {
			original: this._originalEditor.getModel()!,
			modified: this._modifiedEditor.getModel()!
		};
	}

	public setModel(model: editorCommon.IDiffEditorModel | null): void {
		// Guard us against partial null model
		if (model && (!model.original || !model.modified)) {
			throw new Error(!model.original ? 'DiffEditorWidget.setModel: Original model is null' : 'DiffEditorWidget.setModel: Modified model is null');
		}

		// Remove all view zones & decorations
		this._cleanViewZonesAndDecorations();

		// Update code editor models
		this._originalEditor.setModel(model ? model.original : null);
		this._modifiedEditor.setModel(model ? model.modified : null);
		this._updateDecorationsRunner.cancel();

		// this.originalEditor.onDidChangeModelOptions

		if (model) {
			this._originalEditor.setScrollTop(0);
			this._modifiedEditor.setScrollTop(0);
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
		return this._modifiedEditor.getVisibleColumnFromPosition(position);
	}

	public getStatusbarColumn(position: IPosition): number {
		return this._modifiedEditor.getStatusbarColumn(position);
	}

	public getPosition(): Position | null {
		return this._modifiedEditor.getPosition();
	}

	public setPosition(position: IPosition): void {
		this._modifiedEditor.setPosition(position);
	}

	public revealLine(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealLine(lineNumber, scrollType);
	}

	public revealLineInCenter(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealLineInCenter(lineNumber, scrollType);
	}

	public revealLineInCenterIfOutsideViewport(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealLineInCenterIfOutsideViewport(lineNumber, scrollType);
	}

	public revealLineNearTop(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealLineNearTop(lineNumber, scrollType);
	}

	public revealPosition(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealPosition(position, scrollType);
	}

	public revealPositionInCenter(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealPositionInCenter(position, scrollType);
	}

	public revealPositionInCenterIfOutsideViewport(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealPositionInCenterIfOutsideViewport(position, scrollType);
	}

	public revealPositionNearTop(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealPositionNearTop(position, scrollType);
	}

	public getSelection(): Selection | null {
		return this._modifiedEditor.getSelection();
	}

	public getSelections(): Selection[] | null {
		return this._modifiedEditor.getSelections();
	}

	public setSelection(range: IRange): void;
	public setSelection(editorRange: Range): void;
	public setSelection(selection: ISelection): void;
	public setSelection(editorSelection: Selection): void;
	public setSelection(something: any): void {
		this._modifiedEditor.setSelection(something);
	}

	public setSelections(ranges: readonly ISelection[]): void {
		this._modifiedEditor.setSelections(ranges);
	}

	public revealLines(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealLines(startLineNumber, endLineNumber, scrollType);
	}

	public revealLinesInCenter(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealLinesInCenter(startLineNumber, endLineNumber, scrollType);
	}

	public revealLinesInCenterIfOutsideViewport(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealLinesInCenterIfOutsideViewport(startLineNumber, endLineNumber, scrollType);
	}

	public revealLinesNearTop(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealLinesNearTop(startLineNumber, endLineNumber, scrollType);
	}

	public revealRange(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth, revealVerticalInCenter: boolean = false, revealHorizontal: boolean = true): void {
		this._modifiedEditor.revealRange(range, scrollType, revealVerticalInCenter, revealHorizontal);
	}

	public revealRangeInCenter(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealRangeInCenter(range, scrollType);
	}

	public revealRangeInCenterIfOutsideViewport(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealRangeInCenterIfOutsideViewport(range, scrollType);
	}

	public revealRangeNearTop(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealRangeNearTop(range, scrollType);
	}

	public revealRangeNearTopIfOutsideViewport(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealRangeNearTopIfOutsideViewport(range, scrollType);
	}

	public revealRangeAtTop(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._modifiedEditor.revealRangeAtTop(range, scrollType);
	}

	public getSupportedActions(): editorCommon.IEditorAction[] {
		return this._modifiedEditor.getSupportedActions();
	}

	public saveViewState(): editorCommon.IDiffEditorViewState {
		const originalViewState = this._originalEditor.saveViewState();
		const modifiedViewState = this._modifiedEditor.saveViewState();
		return {
			original: originalViewState,
			modified: modifiedViewState
		};
	}

	public restoreViewState(s: editorCommon.IDiffEditorViewState): void {
		if (s && s.original && s.modified) {
			const diffEditorState = <editorCommon.IDiffEditorViewState>s;
			this._originalEditor.restoreViewState(diffEditorState.original);
			this._modifiedEditor.restoreViewState(diffEditorState.modified);
		}
	}

	public layout(dimension?: editorCommon.IDimension): void {
		this._elementSizeObserver.observe(dimension);
	}

	public focus(): void {
		this._modifiedEditor.focus();
	}

	public hasTextFocus(): boolean {
		return this._originalEditor.hasTextFocus() || this._modifiedEditor.hasTextFocus();
	}

	public onVisible(): void {
		this._isVisible = true;
		this._originalEditor.onVisible();
		this._modifiedEditor.onVisible();
		// Begin comparing
		this._beginUpdateDecorations();
	}

	public onHide(): void {
		this._isVisible = false;
		this._originalEditor.onHide();
		this._modifiedEditor.onHide();
		// Remove all view zones & decorations
		this._cleanViewZonesAndDecorations();
	}

	public trigger(source: string | null | undefined, handlerId: string, payload: any): void {
		this._modifiedEditor.trigger(source, handlerId, payload);
	}

	public changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any {
		return this._modifiedEditor.changeDecorations(callback);
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
		if (!this._renderOverviewRuler) {
			return;
		}

		if (!this._originalOverviewRuler || !this._modifiedOverviewRuler) {
			return;
		}
		const height = this._elementSizeObserver.getHeight();
		const reviewHeight = this._getReviewHeight();

		const freeSpace = DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH - 2 * DiffEditorWidget.ONE_OVERVIEW_WIDTH;
		const layoutInfo = this._modifiedEditor.getLayoutInfo();
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
		const currentOriginalModel = this._originalEditor.getModel();
		const currentModifiedModel = this._modifiedEditor.getModel();
		if (!currentOriginalModel || !currentModifiedModel) {
			return;
		}

		// Prevent old diff requests to come if a new request has been initiated
		// The best method would be to call cancel on the Promise, but this is not
		// yet supported, so using tokens for now.
		this._diffComputationToken++;
		const currentToken = this._diffComputationToken;
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
				&& currentOriginalModel === this._originalEditor.getModel()
				&& currentModifiedModel === this._modifiedEditor.getModel()
			) {
				this._setState(editorBrowser.DiffEditorState.DiffComputed);
				this._diffComputationResult = result;
				this._updateDecorationsRunner.schedule();
				this._onDidUpdateDiff.fire();
			}
		}, (error) => {
			if (currentToken === this._diffComputationToken
				&& currentOriginalModel === this._originalEditor.getModel()
				&& currentModifiedModel === this._modifiedEditor.getModel()
			) {
				this._setState(editorBrowser.DiffEditorState.DiffComputed);
				this._diffComputationResult = null;
				this._updateDecorationsRunner.schedule();
			}
		});
	}

	private _cleanViewZonesAndDecorations(): void {
		this._originalEditorState.clean(this._originalEditor);
		this._modifiedEditorState.clean(this._modifiedEditor);
	}

	private _updateDecorations(): void {
		if (!this._originalEditor.getModel() || !this._modifiedEditor.getModel()) {
			return;
		}

		const lineChanges = (this._diffComputationResult ? this._diffComputationResult.changes : []);

		const foreignOriginal = this._originalEditorState.getForeignViewZones(this._originalEditor.getWhitespaces());
		const foreignModified = this._modifiedEditorState.getForeignViewZones(this._modifiedEditor.getWhitespaces());

		const diffDecorations = this._strategy.getEditorsDiffDecorations(lineChanges, this._ignoreTrimWhitespace, this._renderIndicators, foreignOriginal, foreignModified);

		try {
			this._currentlyChangingViewZones = true;
			this._originalEditorState.apply(this._originalEditor, this._originalOverviewRuler, diffDecorations.original, false);
			this._modifiedEditorState.apply(this._modifiedEditor, this._modifiedOverviewRuler, diffDecorations.modified, true);
		} finally {
			this._currentlyChangingViewZones = false;
		}
	}

	private _adjustOptionsForSubEditor(options: Readonly<editorBrowser.IDiffEditorConstructionOptions>): editorBrowser.IEditorConstructionOptions {
		const clonedOptions = { ...options };
		clonedOptions.inDiffEditor = true;
		clonedOptions.automaticLayout = false;
		// Clone scrollbar options before changing them
		clonedOptions.scrollbar = { ...(clonedOptions.scrollbar || {}) };
		clonedOptions.scrollbar.vertical = 'visible';
		clonedOptions.folding = false;
		clonedOptions.codeLens = this._diffCodeLens;
		clonedOptions.fixedOverflowWidgets = true;
		// clonedOptions.lineDecorationsWidth = '2ch';
		// Clone minimap options before changing them
		clonedOptions.minimap = { ...(clonedOptions.minimap || {}) };
		clonedOptions.minimap.enabled = false;
		return clonedOptions;
	}

	private _adjustOptionsForLeftHandSide(options: Readonly<editorBrowser.IDiffEditorConstructionOptions>): editorBrowser.IEditorConstructionOptions {
		const result = this._adjustOptionsForSubEditor(options);
		if (!this._renderSideBySide) {
			// never wrap hidden editor
			result.wordWrapOverride1 = 'off';
		} else {
			result.wordWrapOverride1 = this._diffWordWrap;
		}
		if (options.originalAriaLabel) {
			result.ariaLabel = options.originalAriaLabel;
		}
		result.readOnly = !this._originalIsEditable;
		result.extraEditorClassName = 'original-in-monaco-diff-editor';
		return {
			...result,
			dimension: {
				height: 0,
				width: 0
			}
		};
	}

	private _adjustOptionsForRightHandSide(options: Readonly<editorBrowser.IDiffEditorConstructionOptions>): editorBrowser.IEditorConstructionOptions {
		const result = this._adjustOptionsForSubEditor(options);
		if (options.modifiedAriaLabel) {
			result.ariaLabel = options.modifiedAriaLabel;
		}

		result.wordWrapOverride1 = this._diffWordWrap;
		result.revealHorizontalRightPadding = EditorOptions.revealHorizontalRightPadding.defaultValue + DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH;
		result.scrollbar!.verticalHasArrows = false;
		result.extraEditorClassName = 'modified-in-monaco-diff-editor';
		return {
			...result,
			dimension: {
				height: 0,
				width: 0
			}
		};
	}

	public doLayout(): void {
		this._elementSizeObserver.observe();
		this._doLayout();
	}

	private _doLayout(): void {
		const width = this._elementSizeObserver.getWidth();
		const height = this._elementSizeObserver.getHeight();
		const reviewHeight = this._getReviewHeight();

		const splitPoint = this._strategy.layout();

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

		this._originalEditor.layout({ width: splitPoint, height: (height - reviewHeight) });
		this._modifiedEditor.layout({ width: width - splitPoint - (this._renderOverviewRuler ? DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH : 0), height: (height - reviewHeight) });

		if (this._originalOverviewRuler || this._modifiedOverviewRuler) {
			this._layoutOverviewRulers();
		}

		this._reviewPane.layout(height - reviewHeight, width, reviewHeight);

		this._layoutOverviewViewport();
	}

	private _layoutOverviewViewport(): void {
		const layout = this._computeOverviewViewport();
		if (!layout) {
			this._overviewViewportDomElement.setTop(0);
			this._overviewViewportDomElement.setHeight(0);
		} else {
			this._overviewViewportDomElement.setTop(layout.top);
			this._overviewViewportDomElement.setHeight(layout.height);
		}
	}

	private _computeOverviewViewport(): { height: number; top: number; } | null {
		const layoutInfo = this._modifiedEditor.getLayoutInfo();
		if (!layoutInfo) {
			return null;
		}

		const scrollTop = this._modifiedEditor.getScrollTop();
		const scrollHeight = this._modifiedEditor.getScrollHeight();

		const computedAvailableSize = Math.max(0, layoutInfo.height);
		const computedRepresentableSize = Math.max(0, computedAvailableSize - 2 * 0);
		const computedRatio = scrollHeight > 0 ? (computedRepresentableSize / scrollHeight) : 0;

		const computedSliderSize = Math.max(0, Math.floor(layoutInfo.height * computedRatio));
		const computedSliderPosition = Math.floor(scrollTop * computedRatio);

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

			getOptions: () => {
				return {
					renderOverviewRuler: this._renderOverviewRuler
				};
			},

			getContainerDomNode: () => {
				return this._containerDomElement;
			},

			relayoutEditors: () => {
				this._doLayout();
			},

			getOriginalEditor: () => {
				return this._originalEditor;
			},

			getModifiedEditor: () => {
				return this._modifiedEditor;
			}
		};
	}

	private _setStrategy(newStrategy: DiffEditorWidgetStyle): void {
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

		let min = 0;
		let max = lineChanges.length - 1;
		while (min < max) {
			const mid = Math.floor((min + max) / 2);
			const midStart = startLineNumberExtractor(lineChanges[mid]);
			const midEnd = (mid + 1 <= max ? startLineNumberExtractor(lineChanges[mid + 1]) : Constants.MAX_SAFE_SMALL_INTEGER);

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
		const lineChange = this._getLineChangeAtOrBeforeLineNumber(lineNumber, (lineChange) => lineChange.originalStartLineNumber);

		if (!lineChange) {
			return lineNumber;
		}

		const originalEquivalentLineNumber = lineChange.originalStartLineNumber + (lineChange.originalEndLineNumber > 0 ? -1 : 0);
		const modifiedEquivalentLineNumber = lineChange.modifiedStartLineNumber + (lineChange.modifiedEndLineNumber > 0 ? -1 : 0);
		const lineChangeOriginalLength = (lineChange.originalEndLineNumber > 0 ? (lineChange.originalEndLineNumber - lineChange.originalStartLineNumber + 1) : 0);
		const lineChangeModifiedLength = (lineChange.modifiedEndLineNumber > 0 ? (lineChange.modifiedEndLineNumber - lineChange.modifiedStartLineNumber + 1) : 0);


		const delta = lineNumber - originalEquivalentLineNumber;

		if (delta <= lineChangeOriginalLength) {
			return modifiedEquivalentLineNumber + Math.min(delta, lineChangeModifiedLength);
		}

		return modifiedEquivalentLineNumber + lineChangeModifiedLength - lineChangeOriginalLength + delta;
	}

	private _getEquivalentLineForModifiedLineNumber(lineNumber: number): number {
		const lineChange = this._getLineChangeAtOrBeforeLineNumber(lineNumber, (lineChange) => lineChange.modifiedStartLineNumber);

		if (!lineChange) {
			return lineNumber;
		}

		const originalEquivalentLineNumber = lineChange.originalStartLineNumber + (lineChange.originalEndLineNumber > 0 ? -1 : 0);
		const modifiedEquivalentLineNumber = lineChange.modifiedStartLineNumber + (lineChange.modifiedEndLineNumber > 0 ? -1 : 0);
		const lineChangeOriginalLength = (lineChange.originalEndLineNumber > 0 ? (lineChange.originalEndLineNumber - lineChange.originalStartLineNumber + 1) : 0);
		const lineChangeModifiedLength = (lineChange.modifiedEndLineNumber > 0 ? (lineChange.modifiedEndLineNumber - lineChange.modifiedStartLineNumber + 1) : 0);


		const delta = lineNumber - modifiedEquivalentLineNumber;

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
	getOptions(): { renderOverviewRuler: boolean; };
	getContainerDomNode(): HTMLElement;
	relayoutEditors(): void;

	getOriginalEditor(): CodeEditorWidget;
	getModifiedEditor(): CodeEditorWidget;
}

abstract class DiffEditorWidgetStyle extends Disposable {

	protected _dataSource: IDataSource;
	protected _insertColor: Color | null;
	protected _removeColor: Color | null;

	constructor(dataSource: IDataSource) {
		super();
		this._dataSource = dataSource;
		this._insertColor = null;
		this._removeColor = null;
	}

	public applyColors(theme: IColorTheme): boolean {
		const newInsertColor = (theme.getColor(diffInserted) || defaultInsertColor).transparent(2);
		const newRemoveColor = (theme.getColor(diffRemoved) || defaultRemoveColor).transparent(2);
		const hasChanges = !newInsertColor.equals(this._insertColor) || !newRemoveColor.equals(this._removeColor);
		this._insertColor = newInsertColor;
		this._removeColor = newRemoveColor;
		return hasChanges;
	}

	public getEditorsDiffDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean, originalWhitespaces: IEditorWhitespace[], modifiedWhitespaces: IEditorWhitespace[]): IEditorsDiffDecorationsWithZones {
		// Get view zones
		modifiedWhitespaces = modifiedWhitespaces.sort((a, b) => {
			return a.afterLineNumber - b.afterLineNumber;
		});
		originalWhitespaces = originalWhitespaces.sort((a, b) => {
			return a.afterLineNumber - b.afterLineNumber;
		});
		const zones = this._getViewZones(lineChanges, originalWhitespaces, modifiedWhitespaces, renderIndicators);

		// Get decorations & overview ruler zones
		const originalDecorations = this._getOriginalEditorDecorations(lineChanges, ignoreTrimWhitespace, renderIndicators);
		const modifiedDecorations = this._getModifiedEditorDecorations(lineChanges, ignoreTrimWhitespace, renderIndicators);

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

	protected abstract _getViewZones(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], modifiedForeignVZ: IEditorWhitespace[], renderIndicators: boolean): IEditorsZones;
	protected abstract _getOriginalEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean): IEditorDiffDecorations;
	protected abstract _getModifiedEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean): IEditorDiffDecorations;

	public abstract setEnableSplitViewResizing(enableSplitViewResizing: boolean): void;
	public abstract layout(): number;
}

interface IMyViewZone {
	shouldNotShrink?: boolean;
	afterLineNumber: number;
	afterColumn?: number;
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

	constructor(
		private readonly _lineChanges: editorCommon.ILineChange[],
		private readonly _originalForeignVZ: IEditorWhitespace[],
		private readonly _modifiedForeignVZ: IEditorWhitespace[],
		protected readonly _originalEditor: CodeEditorWidget,
		protected readonly _modifiedEditor: CodeEditorWidget
	) {
	}

	private static _getViewLineCount(editor: CodeEditorWidget, startLineNumber: number, endLineNumber: number): number {
		const model = editor.getModel();
		const viewModel = editor._getViewModel();
		if (model && viewModel) {
			const viewRange = getViewRange(model, viewModel, startLineNumber, endLineNumber);
			return (viewRange.endLineNumber - viewRange.startLineNumber + 1);
		}

		return (endLineNumber - startLineNumber + 1);
	}

	public getViewZones(): IEditorsZones {
		const originalLineHeight = this._originalEditor.getOption(EditorOption.lineHeight);
		const modifiedLineHeight = this._modifiedEditor.getOption(EditorOption.lineHeight);
		const originalHasWrapping = (this._originalEditor.getOption(EditorOption.wrappingInfo).wrappingColumn !== -1);
		const modifiedHasWrapping = (this._modifiedEditor.getOption(EditorOption.wrappingInfo).wrappingColumn !== -1);
		const hasWrapping = (originalHasWrapping || modifiedHasWrapping);
		const originalModel = this._originalEditor.getModel()!;
		const originalCoordinatesConverter = this._originalEditor._getViewModel()!.coordinatesConverter;
		const modifiedCoordinatesConverter = this._modifiedEditor._getViewModel()!.coordinatesConverter;

		const result: { original: IMyViewZone[]; modified: IMyViewZone[]; } = {
			original: [],
			modified: []
		};

		let lineChangeModifiedLength: number = 0;
		let lineChangeOriginalLength: number = 0;
		let originalEquivalentLineNumber: number = 0;
		let modifiedEquivalentLineNumber: number = 0;
		let originalEndEquivalentLineNumber: number = 0;
		let modifiedEndEquivalentLineNumber: number = 0;

		const sortMyViewZones = (a: IMyViewZone, b: IMyViewZone) => {
			return a.afterLineNumber - b.afterLineNumber;
		};

		const addAndCombineIfPossible = (destination: IMyViewZone[], item: IMyViewZone) => {
			if (item.domNode === null && destination.length > 0) {
				const lastItem = destination[destination.length - 1];
				if (lastItem.afterLineNumber === item.afterLineNumber && lastItem.domNode === null) {
					lastItem.heightInLines += item.heightInLines;
					return;
				}
			}
			destination.push(item);
		};

		const modifiedForeignVZ = new ForeignViewZonesIterator(this._modifiedForeignVZ);
		const originalForeignVZ = new ForeignViewZonesIterator(this._originalForeignVZ);

		let lastOriginalLineNumber = 1;
		let lastModifiedLineNumber = 1;

		// In order to include foreign view zones after the last line change, the for loop will iterate once more after the end of the `lineChanges` array
		for (let i = 0, length = this._lineChanges.length; i <= length; i++) {
			const lineChange = (i < length ? this._lineChanges[i] : null);

			if (lineChange !== null) {
				originalEquivalentLineNumber = lineChange.originalStartLineNumber + (lineChange.originalEndLineNumber > 0 ? -1 : 0);
				modifiedEquivalentLineNumber = lineChange.modifiedStartLineNumber + (lineChange.modifiedEndLineNumber > 0 ? -1 : 0);
				lineChangeOriginalLength = (lineChange.originalEndLineNumber > 0 ? ViewZonesComputer._getViewLineCount(this._originalEditor, lineChange.originalStartLineNumber, lineChange.originalEndLineNumber) : 0);
				lineChangeModifiedLength = (lineChange.modifiedEndLineNumber > 0 ? ViewZonesComputer._getViewLineCount(this._modifiedEditor, lineChange.modifiedStartLineNumber, lineChange.modifiedEndLineNumber) : 0);
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

			// [PRODUCE] View zones due to line mapping differences (equal lines but wrapped differently)
			if (hasWrapping) {
				let count: number;
				if (lineChange) {
					if (lineChange.originalEndLineNumber > 0) {
						count = lineChange.originalStartLineNumber - lastOriginalLineNumber;
					} else {
						count = lineChange.modifiedStartLineNumber - lastModifiedLineNumber;
					}
				} else {
					count = originalModel.getLineCount() - lastOriginalLineNumber;
				}

				for (let i = 0; i < count; i++) {
					const originalLineNumber = lastOriginalLineNumber + i;
					const modifiedLineNumber = lastModifiedLineNumber + i;

					const originalViewLineCount = originalCoordinatesConverter.getModelLineViewLineCount(originalLineNumber);
					const modifiedViewLineCount = modifiedCoordinatesConverter.getModelLineViewLineCount(modifiedLineNumber);

					if (originalViewLineCount < modifiedViewLineCount) {
						stepOriginal.push({
							afterLineNumber: originalLineNumber,
							heightInLines: modifiedViewLineCount - originalViewLineCount,
							domNode: null,
							marginDomNode: null
						});
					} else if (originalViewLineCount > modifiedViewLineCount) {
						stepModified.push({
							afterLineNumber: modifiedLineNumber,
							heightInLines: originalViewLineCount - modifiedViewLineCount,
							domNode: null,
							marginDomNode: null
						});
					}
				}
				if (lineChange) {
					lastOriginalLineNumber = (lineChange.originalEndLineNumber > 0 ? lineChange.originalEndLineNumber : lineChange.originalStartLineNumber) + 1;
					lastModifiedLineNumber = (lineChange.modifiedEndLineNumber > 0 ? lineChange.modifiedEndLineNumber : lineChange.modifiedStartLineNumber) + 1;
				}
			}

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
					heightInLines: modifiedForeignVZ.current.height / modifiedLineHeight,
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
					heightInLines: originalForeignVZ.current.height / originalLineHeight,
					domNode: null
				});
				originalForeignVZ.advance();
			}

			if (lineChange !== null && isChangeOrInsert(lineChange)) {
				const r = this._produceOriginalFromDiff(lineChange, lineChangeOriginalLength, lineChangeModifiedLength);
				if (r) {
					stepOriginal.push(r);
				}
			}

			if (lineChange !== null && isChangeOrDelete(lineChange)) {
				const r = this._produceModifiedFromDiff(lineChange, lineChangeOriginalLength, lineChangeModifiedLength);
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
				const original = stepOriginal[stepOriginalIndex];
				const modified = stepModified[stepModifiedIndex];

				const originalDelta = original.afterLineNumber - originalEquivalentLineNumber;
				const modifiedDelta = modified.afterLineNumber - modifiedEquivalentLineNumber;

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
		linesDecorationsClassName: 'insert-sign ' + ThemeIcon.asClassName(diffInsertIcon),
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
		linesDecorationsClassName: 'delete-sign ' + ThemeIcon.asClassName(diffRemoveIcon),
		marginClassName: 'line-delete',
		isWholeLine: true

	}),
	lineDeleteMargin: ModelDecorationOptions.register({
		marginClassName: 'line-delete',
	})

};

class DiffEditorWidgetSideBySide extends DiffEditorWidgetStyle implements IVerticalSashLayoutProvider {

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

		this._sash.onDidStart(() => this._onSashDragStart());
		this._sash.onDidChange((e: ISashEvent) => this._onSashDrag(e));
		this._sash.onDidEnd(() => this._onSashDragEnd());
		this._sash.onDidReset(() => this._onSashReset());
	}

	public setEnableSplitViewResizing(enableSplitViewResizing: boolean): void {
		const newDisableSash = (enableSplitViewResizing === false);
		if (this._disableSash !== newDisableSash) {
			this._disableSash = newDisableSash;
			this._sash.state = this._disableSash ? SashState.Disabled : SashState.Enabled;
		}
	}

	public layout(sashRatio: number | null = this._sashRatio): number {
		const w = this._dataSource.getWidth();
		const contentWidth = w - (this._dataSource.getOptions().renderOverviewRuler ? DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH : 0);

		let sashPosition = Math.floor((sashRatio || 0.5) * contentWidth);
		const midPoint = Math.floor(0.5 * contentWidth);

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

	private _onSashDragStart(): void {
		this._startSashPosition = this._sashPosition!;
	}

	private _onSashDrag(e: ISashEvent): void {
		const w = this._dataSource.getWidth();
		const contentWidth = w - (this._dataSource.getOptions().renderOverviewRuler ? DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH : 0);
		const sashPosition = this.layout((this._startSashPosition! + (e.currentX - e.startX)) / contentWidth);

		this._sashRatio = sashPosition / contentWidth;

		this._dataSource.relayoutEditors();
	}

	private _onSashDragEnd(): void {
		this._sash.layout();
	}

	private _onSashReset(): void {
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

	protected _getViewZones(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], modifiedForeignVZ: IEditorWhitespace[]): IEditorsZones {
		const originalEditor = this._dataSource.getOriginalEditor();
		const modifiedEditor = this._dataSource.getModifiedEditor();
		const c = new SideBySideViewZonesComputer(lineChanges, originalForeignVZ, modifiedForeignVZ, originalEditor, modifiedEditor);
		return c.getViewZones();
	}

	protected _getOriginalEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean): IEditorDiffDecorations {
		const originalEditor = this._dataSource.getOriginalEditor();
		const overviewZoneColor = String(this._removeColor);

		const result: IEditorDiffDecorations = {
			decorations: [],
			overviewZones: []
		};

		const originalModel = originalEditor.getModel()!;
		const originalViewModel = originalEditor._getViewModel()!;

		for (const lineChange of lineChanges) {

			if (isChangeOrDelete(lineChange)) {
				result.decorations.push({
					range: new Range(lineChange.originalStartLineNumber, 1, lineChange.originalEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER),
					options: (renderIndicators ? DECORATIONS.lineDeleteWithSign : DECORATIONS.lineDelete)
				});
				if (!isChangeOrInsert(lineChange) || !lineChange.charChanges) {
					result.decorations.push(createDecoration(lineChange.originalStartLineNumber, 1, lineChange.originalEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER, DECORATIONS.charDeleteWholeLine));
				}

				const viewRange = getViewRange(originalModel, originalViewModel, lineChange.originalStartLineNumber, lineChange.originalEndLineNumber);
				result.overviewZones.push(new OverviewRulerZone(viewRange.startLineNumber, viewRange.endLineNumber, overviewZoneColor));

				if (lineChange.charChanges) {
					for (const charChange of lineChange.charChanges) {
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

	protected _getModifiedEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean): IEditorDiffDecorations {
		const modifiedEditor = this._dataSource.getModifiedEditor();
		const overviewZoneColor = String(this._insertColor);

		const result: IEditorDiffDecorations = {
			decorations: [],
			overviewZones: []
		};

		const modifiedModel = modifiedEditor.getModel()!;
		const modifiedViewModel = modifiedEditor._getViewModel()!;

		for (const lineChange of lineChanges) {

			if (isChangeOrInsert(lineChange)) {

				result.decorations.push({
					range: new Range(lineChange.modifiedStartLineNumber, 1, lineChange.modifiedEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER),
					options: (renderIndicators ? DECORATIONS.lineInsertWithSign : DECORATIONS.lineInsert)
				});
				if (!isChangeOrDelete(lineChange) || !lineChange.charChanges) {
					result.decorations.push(createDecoration(lineChange.modifiedStartLineNumber, 1, lineChange.modifiedEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER, DECORATIONS.charInsertWholeLine));
				}

				const viewRange = getViewRange(modifiedModel, modifiedViewModel, lineChange.modifiedStartLineNumber, lineChange.modifiedEndLineNumber);
				result.overviewZones.push(new OverviewRulerZone(viewRange.startLineNumber, viewRange.endLineNumber, overviewZoneColor));

				if (lineChange.charChanges) {
					for (const charChange of lineChange.charChanges) {
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

	constructor(
		lineChanges: editorCommon.ILineChange[],
		originalForeignVZ: IEditorWhitespace[],
		modifiedForeignVZ: IEditorWhitespace[],
		originalEditor: CodeEditorWidget,
		modifiedEditor: CodeEditorWidget,
	) {
		super(lineChanges, originalForeignVZ, modifiedForeignVZ, originalEditor, modifiedEditor);
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

class DiffEditorWidgetInline extends DiffEditorWidgetStyle {

	private _decorationsLeft: number;

	constructor(dataSource: IDataSource, enableSplitViewResizing: boolean) {
		super(dataSource);

		this._decorationsLeft = dataSource.getOriginalEditor().getLayoutInfo().decorationsLeft;

		this._register(dataSource.getOriginalEditor().onDidLayoutChange((layoutInfo: EditorLayoutInfo) => {
			if (this._decorationsLeft !== layoutInfo.decorationsLeft) {
				this._decorationsLeft = layoutInfo.decorationsLeft;
				dataSource.relayoutEditors();
			}
		}));
	}

	public setEnableSplitViewResizing(enableSplitViewResizing: boolean): void {
		// Nothing to do..
	}

	protected _getViewZones(lineChanges: editorCommon.ILineChange[], originalForeignVZ: IEditorWhitespace[], modifiedForeignVZ: IEditorWhitespace[], renderIndicators: boolean): IEditorsZones {
		const originalEditor = this._dataSource.getOriginalEditor();
		const modifiedEditor = this._dataSource.getModifiedEditor();
		const computer = new InlineViewZonesComputer(lineChanges, originalForeignVZ, modifiedForeignVZ, originalEditor, modifiedEditor, renderIndicators);
		return computer.getViewZones();
	}

	protected _getOriginalEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean): IEditorDiffDecorations {
		const overviewZoneColor = String(this._removeColor);

		const result: IEditorDiffDecorations = {
			decorations: [],
			overviewZones: []
		};

		const originalEditor = this._dataSource.getOriginalEditor();
		const originalModel = originalEditor.getModel()!;
		const originalViewModel = originalEditor._getViewModel()!;

		for (const lineChange of lineChanges) {

			// Add overview zones in the overview ruler
			if (isChangeOrDelete(lineChange)) {
				result.decorations.push({
					range: new Range(lineChange.originalStartLineNumber, 1, lineChange.originalEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER),
					options: DECORATIONS.lineDeleteMargin
				});

				const viewRange = getViewRange(originalModel, originalViewModel, lineChange.originalStartLineNumber, lineChange.originalEndLineNumber);
				result.overviewZones.push(new OverviewRulerZone(viewRange.startLineNumber, viewRange.endLineNumber, overviewZoneColor));
			}
		}

		return result;
	}

	protected _getModifiedEditorDecorations(lineChanges: editorCommon.ILineChange[], ignoreTrimWhitespace: boolean, renderIndicators: boolean): IEditorDiffDecorations {
		const modifiedEditor = this._dataSource.getModifiedEditor();
		const overviewZoneColor = String(this._insertColor);

		const result: IEditorDiffDecorations = {
			decorations: [],
			overviewZones: []
		};

		const modifiedModel = modifiedEditor.getModel()!;
		const modifiedViewModel = modifiedEditor._getViewModel()!;

		for (const lineChange of lineChanges) {

			// Add decorations & overview zones
			if (isChangeOrInsert(lineChange)) {
				result.decorations.push({
					range: new Range(lineChange.modifiedStartLineNumber, 1, lineChange.modifiedEndLineNumber, Constants.MAX_SAFE_SMALL_INTEGER),
					options: (renderIndicators ? DECORATIONS.lineInsertWithSign : DECORATIONS.lineInsert)
				});

				const viewRange = getViewRange(modifiedModel, modifiedViewModel, lineChange.modifiedStartLineNumber, lineChange.modifiedEndLineNumber);
				result.overviewZones.push(new OverviewRulerZone(viewRange.startLineNumber, viewRange.endLineNumber, overviewZoneColor));

				if (lineChange.charChanges) {
					for (const charChange of lineChange.charChanges) {
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
		return Math.max(5, this._decorationsLeft);
	}

}

interface InlineModifiedViewZone extends IMyViewZone {
	shouldNotShrink: boolean;
	afterLineNumber: number;
	heightInLines: number;
	minWidthInPx: number;
	domNode: HTMLElement;
	marginDomNode: HTMLElement;
	diff: IDiffLinesChange;
}

class InlineViewZonesComputer extends ViewZonesComputer {

	private readonly _originalModel: ITextModel;
	private readonly _renderIndicators: boolean;
	private readonly _pendingLineChange: editorCommon.ILineChange[];
	private readonly _pendingViewZones: InlineModifiedViewZone[];
	private readonly _lineBreaksComputer: ILineBreaksComputer;

	constructor(
		lineChanges: editorCommon.ILineChange[],
		originalForeignVZ: IEditorWhitespace[],
		modifiedForeignVZ: IEditorWhitespace[],
		originalEditor: CodeEditorWidget,
		modifiedEditor: CodeEditorWidget,
		renderIndicators: boolean
	) {
		super(lineChanges, originalForeignVZ, modifiedForeignVZ, originalEditor, modifiedEditor);
		this._originalModel = originalEditor.getModel()!;
		this._renderIndicators = renderIndicators;
		this._pendingLineChange = [];
		this._pendingViewZones = [];
		this._lineBreaksComputer = this._modifiedEditor._getViewModel()!.createLineBreaksComputer();
	}

	public override getViewZones(): IEditorsZones {
		const result = super.getViewZones();
		this._finalize(result);
		return result;
	}

	protected _createOriginalMarginDomNodeForModifiedForeignViewZoneInAddedRegion(): HTMLDivElement | null {
		const result = document.createElement('div');
		result.className = 'inline-added-margin-view-zone';
		return result;
	}

	protected _produceOriginalFromDiff(lineChange: editorCommon.ILineChange, lineChangeOriginalLength: number, lineChangeModifiedLength: number): IMyViewZone | null {
		const marginDomNode = document.createElement('div');
		marginDomNode.className = 'inline-added-margin-view-zone';

		return {
			afterLineNumber: Math.max(lineChange.originalStartLineNumber, lineChange.originalEndLineNumber),
			heightInLines: lineChangeModifiedLength,
			domNode: document.createElement('div'),
			marginDomNode: marginDomNode
		};
	}

	protected _produceModifiedFromDiff(lineChange: editorCommon.ILineChange, lineChangeOriginalLength: number, lineChangeModifiedLength: number): IMyViewZone | null {
		const domNode = document.createElement('div');
		domNode.className = `view-lines line-delete ${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME}`;

		const marginDomNode = document.createElement('div');
		marginDomNode.className = 'inline-deleted-margin-view-zone';

		const viewZone: InlineModifiedViewZone = {
			shouldNotShrink: true,
			afterLineNumber: (lineChange.modifiedEndLineNumber === 0 ? lineChange.modifiedStartLineNumber : lineChange.modifiedStartLineNumber - 1),
			heightInLines: lineChangeOriginalLength,
			minWidthInPx: 0,
			domNode: domNode,
			marginDomNode: marginDomNode,
			diff: {
				originalStartLineNumber: lineChange.originalStartLineNumber,
				originalEndLineNumber: lineChange.originalEndLineNumber,
				modifiedStartLineNumber: lineChange.modifiedStartLineNumber,
				modifiedEndLineNumber: lineChange.modifiedEndLineNumber,
				originalModel: this._originalModel,
				viewLineCounts: null,
			}
		};

		for (let lineNumber = lineChange.originalStartLineNumber; lineNumber <= lineChange.originalEndLineNumber; lineNumber++) {
			this._lineBreaksComputer.addRequest(this._originalModel.getLineContent(lineNumber), null);
		}

		this._pendingLineChange.push(lineChange);
		this._pendingViewZones.push(viewZone);

		return viewZone;
	}

	private _finalize(result: IEditorsZones): void {
		const modifiedEditorOptions = this._modifiedEditor.getOptions();
		const tabSize = this._modifiedEditor.getModel()!.getOptions().tabSize;
		const fontInfo = modifiedEditorOptions.get(EditorOption.fontInfo);
		const disableMonospaceOptimizations = modifiedEditorOptions.get(EditorOption.disableMonospaceOptimizations);
		const typicalHalfwidthCharacterWidth = fontInfo.typicalHalfwidthCharacterWidth;
		const scrollBeyondLastColumn = modifiedEditorOptions.get(EditorOption.scrollBeyondLastColumn);
		const mightContainNonBasicASCII = this._originalModel.mightContainNonBasicASCII();
		const mightContainRTL = this._originalModel.mightContainRTL();
		const lineHeight = modifiedEditorOptions.get(EditorOption.lineHeight);
		const layoutInfo = modifiedEditorOptions.get(EditorOption.layoutInfo);
		const lineDecorationsWidth = layoutInfo.decorationsWidth;
		const stopRenderingLineAfter = modifiedEditorOptions.get(EditorOption.stopRenderingLineAfter);
		const renderWhitespace = modifiedEditorOptions.get(EditorOption.renderWhitespace);
		const renderControlCharacters = modifiedEditorOptions.get(EditorOption.renderControlCharacters);
		const fontLigatures = modifiedEditorOptions.get(EditorOption.fontLigatures);

		const lineBreaks = this._lineBreaksComputer.finalize();
		let lineBreakIndex = 0;

		for (let i = 0; i < this._pendingLineChange.length; i++) {
			const lineChange = this._pendingLineChange[i];
			const viewZone = this._pendingViewZones[i];
			const domNode = viewZone.domNode;
			Configuration.applyFontInfoSlow(domNode, fontInfo);

			const marginDomNode = viewZone.marginDomNode;
			Configuration.applyFontInfoSlow(marginDomNode, fontInfo);

			const decorations: InlineDecoration[] = [];
			if (lineChange.charChanges) {
				for (const charChange of lineChange.charChanges) {
					if (isChangeOrDelete(charChange)) {
						decorations.push(new InlineDecoration(
							new Range(charChange.originalStartLineNumber, charChange.originalStartColumn, charChange.originalEndLineNumber, charChange.originalEndColumn),
							'char-delete',
							InlineDecorationType.Regular
						));
					}
				}
			}
			const hasCharChanges = (decorations.length > 0);

			const sb = createStringBuilder(10000);
			let maxCharsPerLine = 0;
			let renderedLineCount = 0;
			let viewLineCounts: number[] | null = null;
			for (let lineNumber = lineChange.originalStartLineNumber; lineNumber <= lineChange.originalEndLineNumber; lineNumber++) {
				const lineIndex = lineNumber - lineChange.originalStartLineNumber;
				const lineTokens = this._originalModel.getLineTokens(lineNumber);
				const lineContent = lineTokens.getLineContent();
				const lineBreakData = lineBreaks[lineBreakIndex++];
				const actualDecorations = LineDecoration.filter(decorations, lineNumber, 1, lineContent.length + 1);

				if (lineBreakData) {
					let lastBreakOffset = 0;
					for (const breakOffset of lineBreakData.breakOffsets) {
						const viewLineTokens = lineTokens.sliceAndInflate(lastBreakOffset, breakOffset, 0);
						const viewLineContent = lineContent.substring(lastBreakOffset, breakOffset);
						maxCharsPerLine = Math.max(maxCharsPerLine, this._renderOriginalLine(
							renderedLineCount++,
							viewLineContent,
							viewLineTokens,
							LineDecoration.extractWrapped(actualDecorations, lastBreakOffset, breakOffset),
							hasCharChanges,
							mightContainNonBasicASCII,
							mightContainRTL,
							fontInfo,
							disableMonospaceOptimizations,
							lineHeight,
							lineDecorationsWidth,
							stopRenderingLineAfter,
							renderWhitespace,
							renderControlCharacters,
							fontLigatures,
							tabSize,
							sb,
							marginDomNode
						));
						lastBreakOffset = breakOffset;
					}
					if (!viewLineCounts) {
						viewLineCounts = [];
					}
					// make sure all lines before this one have an entry in `viewLineCounts`
					while (viewLineCounts.length < lineIndex) {
						viewLineCounts[viewLineCounts.length] = 1;
					}
					viewLineCounts[lineIndex] = lineBreakData.breakOffsets.length;
					viewZone.heightInLines += (lineBreakData.breakOffsets.length - 1);
					const marginDomNode2 = document.createElement('div');
					marginDomNode2.className = 'line-delete';
					result.original.push({
						afterLineNumber: lineNumber,
						afterColumn: 0,
						heightInLines: lineBreakData.breakOffsets.length - 1,
						domNode: createFakeLinesDiv(),
						marginDomNode: marginDomNode2
					});
				} else {
					maxCharsPerLine = Math.max(maxCharsPerLine, this._renderOriginalLine(
						renderedLineCount++,
						lineContent,
						lineTokens,
						actualDecorations,
						hasCharChanges,
						mightContainNonBasicASCII,
						mightContainRTL,
						fontInfo,
						disableMonospaceOptimizations,
						lineHeight,
						lineDecorationsWidth,
						stopRenderingLineAfter,
						renderWhitespace,
						renderControlCharacters,
						fontLigatures,
						tabSize,
						sb,
						marginDomNode
					));
				}
			}
			maxCharsPerLine += scrollBeyondLastColumn;

			const html = sb.build();
			const trustedhtml = ttPolicy ? ttPolicy.createHTML(html) : html;
			domNode.innerHTML = trustedhtml as string;
			viewZone.minWidthInPx = (maxCharsPerLine * typicalHalfwidthCharacterWidth);

			if (viewLineCounts) {
				// make sure all lines have an entry in `viewLineCounts`
				const cnt = lineChange.originalEndLineNumber - lineChange.originalStartLineNumber;
				while (viewLineCounts.length <= cnt) {
					viewLineCounts[viewLineCounts.length] = 1;
				}
			}
			viewZone.diff.viewLineCounts = viewLineCounts;
		}

		result.original.sort((a, b) => {
			return a.afterLineNumber - b.afterLineNumber;
		});
	}

	private _renderOriginalLine(
		renderedLineCount: number,
		lineContent: string,
		lineTokens: IViewLineTokens,
		decorations: LineDecoration[],
		hasCharChanges: boolean,
		mightContainNonBasicASCII: boolean,
		mightContainRTL: boolean,
		fontInfo: FontInfo,
		disableMonospaceOptimizations: boolean,
		lineHeight: number,
		lineDecorationsWidth: number,
		stopRenderingLineAfter: number,
		renderWhitespace: 'selection' | 'none' | 'boundary' | 'trailing' | 'all',
		renderControlCharacters: boolean,
		fontLigatures: string,
		tabSize: number,
		sb: IStringBuilder,
		marginDomNode: HTMLElement
	): number {

		sb.appendASCIIString('<div class="view-line');
		if (!hasCharChanges) {
			// No char changes
			sb.appendASCIIString(' char-delete');
		}
		sb.appendASCIIString('" style="top:');
		sb.appendASCIIString(String(renderedLineCount * lineHeight));
		sb.appendASCIIString('px;width:1000000px;">');

		const isBasicASCII = ViewLineRenderingData.isBasicASCII(lineContent, mightContainNonBasicASCII);
		const containsRTL = ViewLineRenderingData.containsRTL(lineContent, isBasicASCII, mightContainRTL);
		const output = renderViewLine(new RenderLineInput(
			(fontInfo.isMonospace && !disableMonospaceOptimizations),
			fontInfo.canUseHalfwidthRightwardsArrow,
			lineContent,
			false,
			isBasicASCII,
			containsRTL,
			0,
			lineTokens,
			decorations,
			tabSize,
			0,
			fontInfo.spaceWidth,
			fontInfo.middotWidth,
			fontInfo.wsmiddotWidth,
			stopRenderingLineAfter,
			renderWhitespace,
			renderControlCharacters,
			fontLigatures !== EditorFontLigatures.OFF,
			null // Send no selections, original line cannot be selected
		), sb);

		sb.appendASCIIString('</div>');

		if (this._renderIndicators) {
			const marginElement = document.createElement('div');
			marginElement.className = `delete-sign ${ThemeIcon.asClassName(diffRemoveIcon)}`;
			marginElement.setAttribute('style', `position:absolute;top:${renderedLineCount * lineHeight}px;width:${lineDecorationsWidth}px;height:${lineHeight}px;right:0;`);
			marginDomNode.appendChild(marginElement);
		}

		const absoluteOffsets = output.characterMapping.getAbsoluteOffsets();
		return absoluteOffsets.length > 0 ? absoluteOffsets[absoluteOffsets.length - 1] : 0;
	}
}

function validateDiffWordWrap(value: 'off' | 'on' | 'inherit' | undefined, defaultValue: 'off' | 'on' | 'inherit'): 'off' | 'on' | 'inherit' {
	return validateStringSetOption<'off' | 'on' | 'inherit'>(value, defaultValue, ['off', 'on', 'inherit']);
}

function isChangeOrInsert(lineChange: editorCommon.IChange): boolean {
	return lineChange.modifiedEndLineNumber > 0;
}

function isChangeOrDelete(lineChange: editorCommon.IChange): boolean {
	return lineChange.originalEndLineNumber > 0;
}

function createFakeLinesDiv(): HTMLElement {
	const r = document.createElement('div');
	r.className = 'diagonal-fill';
	return r;
}

function getViewRange(model: ITextModel, viewModel: IViewModel, startLineNumber: number, endLineNumber: number): Range {
	const lineCount = model.getLineCount();
	startLineNumber = Math.min(lineCount, Math.max(1, startLineNumber));
	endLineNumber = Math.min(lineCount, Math.max(1, endLineNumber));
	return viewModel.coordinatesConverter.convertModelRangeToViewRange(new Range(
		startLineNumber, model.getLineMinColumn(startLineNumber),
		endLineNumber, model.getLineMaxColumn(endLineNumber)
	));
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
