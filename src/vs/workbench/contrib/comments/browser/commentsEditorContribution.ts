/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'vs/base/browser/dom';
import { Action, IAction } from 'vs/base/common/actions';
import { coalesce, findFirstInSorted } from 'vs/base/common/arrays';
import { CancelablePromise, createCancelablePromise, Delayer } from 'vs/base/common/async';
import { onUnexpectedError } from 'vs/base/common/errors';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import 'vs/css!./media/review';
import { IMarginData } from 'vs/editor/browser/controller/mouseTarget';
import { IActiveCodeEditor, ICodeEditor, IEditorMouseEvent, isCodeEditor, isDiffEditor, IViewZone, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { EditorAction, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IRange, Range } from 'vs/editor/common/core/range';
import { IEditorContribution, IModelChangedEvent } from 'vs/editor/common/editorCommon';
import { IModelDecorationOptions } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import * as modes from 'vs/editor/common/modes';
import { peekViewResultsBackground, peekViewResultsSelectionBackground, peekViewTitleBackground } from 'vs/editor/contrib/peekView/peekView';
import * as nls from 'vs/nls';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { editorForeground } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { STATUS_BAR_ITEM_ACTIVE_BACKGROUND, STATUS_BAR_ITEM_HOVER_BACKGROUND } from 'vs/workbench/common/theme';
import { overviewRulerCommentingRangeForeground } from 'vs/workbench/contrib/comments/browser/commentGlyphWidget';
import { ICommentInfo, ICommentService } from 'vs/workbench/contrib/comments/browser/commentService';
import { COMMENTEDITOR_DECORATION_KEY, ReviewZoneWidget } from 'vs/workbench/contrib/comments/browser/commentThreadWidget';
import { ctxCommentEditorFocused, SimpleCommentEditor } from 'vs/workbench/contrib/comments/browser/simpleCommentEditor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EmbeddedCodeEditorWidget } from 'vs/editor/browser/widget/embeddedCodeEditorWidget';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

export const ID = 'editor.contrib.review';

export class ReviewViewZone implements IViewZone {
	public readonly afterLineNumber: number;
	public readonly domNode: HTMLElement;
	private callback: (top: number) => void;

	constructor(afterLineNumber: number, onDomNodeTop: (top: number) => void) {
		this.afterLineNumber = afterLineNumber;
		this.callback = onDomNodeTop;

		this.domNode = $('.review-viewzone');
	}

	onDomNodeTop(top: number): void {
		this.callback(top);
	}
}

class CommentingRangeDecoration {
	private _decorationId: string;

	public get id(): string {
		return this._decorationId;
	}

	constructor(private _editor: ICodeEditor, private _ownerId: string, private _extensionId: string | undefined, private _label: string | undefined, private _range: IRange, commentingOptions: ModelDecorationOptions, private commentingRangesInfo: modes.CommentingRanges) {
		const startLineNumber = _range.startLineNumber;
		const endLineNumber = _range.endLineNumber;
		let commentingRangeDecorations = [{
			range: {
				startLineNumber: startLineNumber, startColumn: 1,
				endLineNumber: endLineNumber, endColumn: 1
			},
			options: commentingOptions
		}];

		this._decorationId = this._editor.deltaDecorations([], commentingRangeDecorations)[0];
	}

	public getCommentAction(): { ownerId: string, extensionId: string | undefined, label: string | undefined, commentingRangesInfo: modes.CommentingRanges } {
		return {
			extensionId: this._extensionId,
			label: this._label,
			ownerId: this._ownerId,
			commentingRangesInfo: this.commentingRangesInfo
		};
	}

	public getOriginalRange() {
		return this._range;
	}

	public getActiveRange() {
		return this._editor.getModel()!.getDecorationRange(this._decorationId);
	}
}
class CommentingRangeDecorator {

	private decorationOptions: ModelDecorationOptions;
	private commentingRangeDecorations: CommentingRangeDecoration[] = [];

	constructor() {
		const decorationOptions: IModelDecorationOptions = {
			isWholeLine: true,
			linesDecorationsClassName: 'comment-range-glyph comment-diff-added'
		};

		this.decorationOptions = ModelDecorationOptions.createDynamic(decorationOptions);
	}

	public update(editor: ICodeEditor, commentInfos: ICommentInfo[]) {
		let model = editor.getModel();
		if (!model) {
			return;
		}

		let commentingRangeDecorations: CommentingRangeDecoration[] = [];
		for (const info of commentInfos) {
			info.commentingRanges.ranges.forEach(range => {
				commentingRangeDecorations.push(new CommentingRangeDecoration(editor, info.owner, info.extensionId, info.label, range, this.decorationOptions, info.commentingRanges));
			});
		}

		let oldDecorations = this.commentingRangeDecorations.map(decoration => decoration.id);
		editor.deltaDecorations(oldDecorations, []);

		this.commentingRangeDecorations = commentingRangeDecorations;
	}

	public getMatchedCommentAction(line: number) {
		let result = [];
		for (const decoration of this.commentingRangeDecorations) {
			const range = decoration.getActiveRange();
			if (range && range.startLineNumber <= line && line <= range.endLineNumber) {
				result.push(decoration.getCommentAction());
			}
		}

		return result;
	}

	public dispose(): void {
		this.commentingRangeDecorations = [];
	}
}

export class CommentController implements IEditorContribution {
	private readonly globalToDispose = new DisposableStore();
	private readonly localToDispose = new DisposableStore();
	private editor!: ICodeEditor;
	private _commentWidgets: ReviewZoneWidget[];
	private _commentInfos: ICommentInfo[];
	private _commentingRangeDecorator!: CommentingRangeDecorator;
	private mouseDownInfo: { lineNumber: number } | null = null;
	private _commentingRangeSpaceReserved = false;
	private _computePromise: CancelablePromise<Array<ICommentInfo | null>> | null;
	private _addInProgress!: boolean;
	private _emptyThreadsToAddQueue: [number, IEditorMouseEvent | undefined][] = [];
	private _computeCommentingRangePromise!: CancelablePromise<ICommentInfo[]> | null;
	private _computeCommentingRangeScheduler!: Delayer<Array<ICommentInfo | null>> | null;
	private _pendingCommentCache: { [key: string]: { [key: string]: string } };

	constructor(
		editor: ICodeEditor,
		@ICommentService private readonly commentService: ICommentService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IContextMenuService readonly contextMenuService: IContextMenuService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		this._commentInfos = [];
		this._commentWidgets = [];
		this._pendingCommentCache = {};
		this._computePromise = null;

		if (editor instanceof EmbeddedCodeEditorWidget) {
			return;
		}

		this.editor = editor;

		this._commentingRangeDecorator = new CommentingRangeDecorator();

		this.globalToDispose.add(this.commentService.onDidDeleteDataProvider(ownerId => {
			delete this._pendingCommentCache[ownerId];
			this.beginCompute();
		}));
		this.globalToDispose.add(this.commentService.onDidSetDataProvider(_ => this.beginCompute()));

		this.globalToDispose.add(this.commentService.onDidSetResourceCommentInfos(e => {
			const editorURI = this.editor && this.editor.hasModel() && this.editor.getModel().uri;
			if (editorURI && editorURI.toString() === e.resource.toString()) {
				this.setComments(e.commentInfos.filter(commentInfo => commentInfo !== null));
			}
		}));

		this.globalToDispose.add(this.editor.onDidChangeModel(e => this.onModelChanged(e)));
		this.codeEditorService.registerDecorationType(COMMENTEDITOR_DECORATION_KEY, {});
		this.beginCompute();
	}

	private beginCompute(): Promise<void> {
		this._computePromise = createCancelablePromise(token => {
			const editorURI = this.editor && this.editor.hasModel() && this.editor.getModel().uri;

			if (editorURI) {
				return this.commentService.getComments(editorURI);
			}

			return Promise.resolve([]);
		});

		return this._computePromise.then(commentInfos => {
			this.setComments(coalesce(commentInfos));
			this._computePromise = null;
		}, error => console.log(error));
	}

	private beginComputeCommentingRanges() {
		if (this._computeCommentingRangeScheduler) {
			if (this._computeCommentingRangePromise) {
				this._computeCommentingRangePromise.cancel();
				this._computeCommentingRangePromise = null;
			}

			this._computeCommentingRangeScheduler.trigger(() => {
				const editorURI = this.editor && this.editor.hasModel() && this.editor.getModel().uri;

				if (editorURI) {
					return this.commentService.getComments(editorURI);
				}

				return Promise.resolve([]);
			}).then(commentInfos => {
				const meaningfulCommentInfos = coalesce(commentInfos);
				this._commentingRangeDecorator.update(this.editor, meaningfulCommentInfos);
			}, (err) => {
				onUnexpectedError(err);
				return null;
			});
		}
	}

	public static get(editor: ICodeEditor): CommentController {
		return editor.getContribution<CommentController>(ID);
	}

	public revealCommentThread(threadId: string, commentUniqueId: number, fetchOnceIfNotExist: boolean): void {
		const commentThreadWidget = this._commentWidgets.filter(widget => widget.commentThread.threadId === threadId);
		if (commentThreadWidget.length === 1) {
			commentThreadWidget[0].reveal(commentUniqueId);
		} else if (fetchOnceIfNotExist) {
			if (this._computePromise) {
				this._computePromise.then(_ => {
					this.revealCommentThread(threadId, commentUniqueId, false);
				});
			} else {
				this.beginCompute().then(_ => {
					this.revealCommentThread(threadId, commentUniqueId, false);
				});
			}
		}
	}

	public nextCommentThread(): void {
		if (!this._commentWidgets.length || !this.editor.hasModel()) {
			return;
		}

		const after = this.editor.getSelection().getEndPosition();
		const sortedWidgets = this._commentWidgets.sort((a, b) => {
			if (a.commentThread.range.startLineNumber < b.commentThread.range.startLineNumber) {
				return -1;
			}

			if (a.commentThread.range.startLineNumber > b.commentThread.range.startLineNumber) {
				return 1;
			}

			if (a.commentThread.range.startColumn < b.commentThread.range.startColumn) {
				return -1;
			}

			if (a.commentThread.range.startColumn > b.commentThread.range.startColumn) {
				return 1;
			}

			return 0;
		});

		let idx = findFirstInSorted(sortedWidgets, widget => {
			if (widget.commentThread.range.startLineNumber > after.lineNumber) {
				return true;
			}

			if (widget.commentThread.range.startLineNumber < after.lineNumber) {
				return false;
			}

			if (widget.commentThread.range.startColumn > after.column) {
				return true;
			}
			return false;
		});

		if (idx === this._commentWidgets.length) {
			this._commentWidgets[0].reveal();
			this.editor.setSelection(this._commentWidgets[0].commentThread.range);
		} else {
			sortedWidgets[idx].reveal();
			this.editor.setSelection(sortedWidgets[idx].commentThread.range);
		}
	}

	public dispose(): void {
		this.globalToDispose.dispose();
		this.localToDispose.dispose();

		this._commentWidgets.forEach(widget => widget.dispose());

		this.editor = null!; // Strict null override — nulling out in dispose
	}

	public onModelChanged(e: IModelChangedEvent): void {
		this.localToDispose.clear();

		this.removeCommentWidgetsAndStoreCache();

		this.localToDispose.add(this.editor.onMouseDown(e => this.onEditorMouseDown(e)));
		this.localToDispose.add(this.editor.onMouseUp(e => this.onEditorMouseUp(e)));

		this._computeCommentingRangeScheduler = new Delayer<ICommentInfo[]>(200);
		this.localToDispose.add({
			dispose: () => {
				if (this._computeCommentingRangeScheduler) {
					this._computeCommentingRangeScheduler.cancel();
				}
				this._computeCommentingRangeScheduler = null;
			}
		});
		this.localToDispose.add(this.editor.onDidChangeModelContent(async () => {
			this.beginComputeCommentingRanges();
		}));
		this.localToDispose.add(this.commentService.onDidUpdateCommentThreads(async e => {
			const editorURI = this.editor && this.editor.hasModel() && this.editor.getModel().uri;
			if (!editorURI) {
				return;
			}

			if (this._computePromise) {
				await this._computePromise;
			}

			let commentInfo = this._commentInfos.filter(info => info.owner === e.owner);
			if (!commentInfo || !commentInfo.length) {
				return;
			}

			let added = e.added.filter(thread => thread.resource && thread.resource.toString() === editorURI.toString());
			let removed = e.removed.filter(thread => thread.resource && thread.resource.toString() === editorURI.toString());
			let changed = e.changed.filter(thread => thread.resource && thread.resource.toString() === editorURI.toString());

			removed.forEach(thread => {
				let matchedZones = this._commentWidgets.filter(zoneWidget => zoneWidget.owner === e.owner && zoneWidget.commentThread.threadId === thread.threadId && zoneWidget.commentThread.threadId !== '');
				if (matchedZones.length) {
					let matchedZone = matchedZones[0];
					let index = this._commentWidgets.indexOf(matchedZone);
					this._commentWidgets.splice(index, 1);
					matchedZone.dispose();
				}
			});

			changed.forEach(thread => {
				let matchedZones = this._commentWidgets.filter(zoneWidget => zoneWidget.owner === e.owner && zoneWidget.commentThread.threadId === thread.threadId);
				if (matchedZones.length) {
					let matchedZone = matchedZones[0];
					matchedZone.update(thread);
				}
			});
			added.forEach(thread => {
				let matchedZones = this._commentWidgets.filter(zoneWidget => zoneWidget.owner === e.owner && zoneWidget.commentThread.threadId === thread.threadId);
				if (matchedZones.length) {
					return;
				}

				let matchedNewCommentThreadZones = this._commentWidgets.filter(zoneWidget => zoneWidget.owner === e.owner && (zoneWidget.commentThread as any).commentThreadHandle === -1 && Range.equalsRange(zoneWidget.commentThread.range, thread.range));

				if (matchedNewCommentThreadZones.length) {
					matchedNewCommentThreadZones[0].update(thread);
					return;
				}

				const pendingCommentText = this._pendingCommentCache[e.owner] && this._pendingCommentCache[e.owner][thread.threadId!];
				this.displayCommentThread(e.owner, thread, pendingCommentText);
				this._commentInfos.filter(info => info.owner === e.owner)[0].threads.push(thread);
			});

		}));

		this.beginCompute();
	}

	private displayCommentThread(owner: string, thread: modes.CommentThread, pendingComment: string | null): void {
		const zoneWidget = this.instantiationService.createInstance(ReviewZoneWidget, this.editor, owner, thread, pendingComment);
		zoneWidget.display(thread.range.startLineNumber);
		this._commentWidgets.push(zoneWidget);
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

		const data = e.target.detail as IMarginData;
		const gutterOffsetX = data.offsetX - data.glyphMarginWidth - data.lineNumbersWidth - data.glyphMarginLeft;

		// don't collide with folding and git decorations
		if (gutterOffsetX > 14) {
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

		if (!e.target.element) {
			return;
		}

		if (e.target.element.className.indexOf('comment-diff-added') >= 0) {
			const lineNumber = e.target.position!.lineNumber;
			this.addOrToggleCommentAtLine(lineNumber, e);
		}
	}

	public async addOrToggleCommentAtLine(lineNumber: number, e: IEditorMouseEvent | undefined): Promise<void> {
		// If an add is already in progress, queue the next add and process it after the current one finishes to
		// prevent empty comment threads from being added to the same line.
		if (!this._addInProgress) {
			this._addInProgress = true;
			// The widget's position is undefined until the widget has been displayed, so rely on the glyph position instead
			const existingCommentsAtLine = this._commentWidgets.filter(widget => widget.getGlyphPosition() === lineNumber);
			if (existingCommentsAtLine.length) {
				existingCommentsAtLine.forEach(widget => widget.toggleExpand(lineNumber));
				this.processNextThreadToAdd();
				return;
			} else {
				this.addCommentAtLine(lineNumber, e);
			}
		} else {
			this._emptyThreadsToAddQueue.push([lineNumber, e]);
		}
	}

	private processNextThreadToAdd(): void {
		this._addInProgress = false;
		const info = this._emptyThreadsToAddQueue.shift();
		if (info) {
			this.addOrToggleCommentAtLine(info[0], info[1]);
		}
	}

	public addCommentAtLine(lineNumber: number, e: IEditorMouseEvent | undefined): Promise<void> {
		const newCommentInfos = this._commentingRangeDecorator.getMatchedCommentAction(lineNumber);
		if (!newCommentInfos.length || !this.editor.hasModel()) {
			return Promise.resolve();
		}

		if (newCommentInfos.length > 1) {
			if (e) {
				const anchor = { x: e.event.posx, y: e.event.posy };

				this.contextMenuService.showContextMenu({
					getAnchor: () => anchor,
					getActions: () => this.getContextMenuActions(newCommentInfos, lineNumber),
					getActionsContext: () => newCommentInfos.length ? newCommentInfos[0] : undefined,
					onHide: () => { this._addInProgress = false; }
				});

				return Promise.resolve();
			} else {
				const picks = this.getCommentProvidersQuickPicks(newCommentInfos);
				return this.quickInputService.pick(picks, { placeHolder: nls.localize('pickCommentService', "Select Comment Provider"), matchOnDescription: true }).then(pick => {
					if (!pick) {
						return;
					}

					const commentInfos = newCommentInfos.filter(info => info.ownerId === pick.id);

					if (commentInfos.length) {
						const { ownerId } = commentInfos[0];
						this.addCommentAtLine2(lineNumber, ownerId);
					}
				}).then(() => {
					this._addInProgress = false;
				});
			}
		} else {
			const { ownerId } = newCommentInfos[0]!;
			this.addCommentAtLine2(lineNumber, ownerId);
		}

		return Promise.resolve();
	}

	private getCommentProvidersQuickPicks(commentInfos: { ownerId: string, extensionId: string | undefined, label: string | undefined, commentingRangesInfo: modes.CommentingRanges | undefined }[]) {
		const picks: QuickPickInput[] = commentInfos.map((commentInfo) => {
			const { ownerId, extensionId, label } = commentInfo;

			return <IQuickPickItem>{
				label: label || extensionId,
				id: ownerId
			};
		});

		return picks;
	}

	private getContextMenuActions(commentInfos: { ownerId: string, extensionId: string | undefined, label: string | undefined, commentingRangesInfo: modes.CommentingRanges }[], lineNumber: number): IAction[] {
		const actions: IAction[] = [];

		commentInfos.forEach(commentInfo => {
			const { ownerId, extensionId, label } = commentInfo;

			actions.push(new Action(
				'addCommentThread',
				`${label || extensionId}`,
				undefined,
				true,
				() => {
					this.addCommentAtLine2(lineNumber, ownerId);
					return Promise.resolve();
				}
			));
		});
		return actions;
	}

	public addCommentAtLine2(lineNumber: number, ownerId: string) {
		const range = new Range(lineNumber, 1, lineNumber, 1);
		this.commentService.createCommentThreadTemplate(ownerId, this.editor.getModel()!.uri, range);
		this.processNextThreadToAdd();
		return;
	}

	private setComments(commentInfos: ICommentInfo[]): void {
		if (!this.editor) {
			return;
		}

		this._commentInfos = commentInfos;
		let lineDecorationsWidth: number = this.editor.getLayoutInfo().decorationsWidth;

		if (this._commentInfos.some(info => Boolean(info.commentingRanges && (Array.isArray(info.commentingRanges) ? info.commentingRanges : info.commentingRanges.ranges).length))) {
			if (!this._commentingRangeSpaceReserved) {
				this._commentingRangeSpaceReserved = true;
				let extraEditorClassName: string[] = [];
				const configuredExtraClassName = this.editor.getRawOptions().extraEditorClassName;
				if (configuredExtraClassName) {
					extraEditorClassName = configuredExtraClassName.split(' ');
				}

				const options = this.editor.getOptions();
				if (options.get(EditorOption.folding)) {
					lineDecorationsWidth -= 16;
				}
				lineDecorationsWidth += 9;
				extraEditorClassName.push('inline-comment');
				this.editor.updateOptions({
					extraEditorClassName: extraEditorClassName.join(' '),
					lineDecorationsWidth: lineDecorationsWidth
				});

				// we only update the lineDecorationsWidth property but keep the width of the whole editor.
				const originalLayoutInfo = this.editor.getLayoutInfo();

				this.editor.layout({
					width: originalLayoutInfo.width,
					height: originalLayoutInfo.height
				});
			}
		}

		// create viewzones
		this.removeCommentWidgetsAndStoreCache();

		this._commentInfos.forEach(info => {
			let providerCacheStore = this._pendingCommentCache[info.owner];
			info.threads = info.threads.filter(thread => !thread.isDisposed);
			info.threads.forEach(thread => {
				let pendingComment: string | null = null;
				if (providerCacheStore) {
					pendingComment = providerCacheStore[thread.threadId!];
				}

				if (pendingComment) {
					thread.collapsibleState = modes.CommentThreadCollapsibleState.Expanded;
				}

				this.displayCommentThread(info.owner, thread, pendingComment);
			});
		});

		this._commentingRangeDecorator.update(this.editor, this._commentInfos);
	}

	public closeWidget(): void {
		if (this._commentWidgets) {
			this._commentWidgets.forEach(widget => widget.hide());
		}

		this.editor.focus();
		this.editor.revealRangeInCenter(this.editor.getSelection()!);
	}

	private removeCommentWidgetsAndStoreCache() {
		if (this._commentWidgets) {
			this._commentWidgets.forEach(zone => {
				let pendingComment = zone.getPendingComment();
				let providerCacheStore = this._pendingCommentCache[zone.owner];

				if (pendingComment) {
					if (!providerCacheStore) {
						this._pendingCommentCache[zone.owner] = {};
					}

					this._pendingCommentCache[zone.owner][zone.commentThread.threadId!] = pendingComment;
				} else {
					if (providerCacheStore) {
						delete providerCacheStore[zone.commentThread.threadId!];
					}
				}

				zone.dispose();
			});
		}

		this._commentWidgets = [];
	}
}

export class NextCommentThreadAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.nextCommentThreadAction',
			label: nls.localize('nextCommentThreadAction', "Go to Next Comment Thread"),
			alias: 'Go to Next Comment Thread',
			precondition: undefined,
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		let controller = CommentController.get(editor);
		if (controller) {
			controller.nextCommentThread();
		}
	}
}


registerEditorContribution(ID, CommentController);
registerEditorAction(NextCommentThreadAction);

CommandsRegistry.registerCommand({
	id: 'workbench.action.addComment',
	handler: (accessor) => {
		const activeEditor = getActiveEditor(accessor);
		if (!activeEditor) {
			return Promise.resolve();
		}

		const controller = CommentController.get(activeEditor);
		if (!controller) {
			return Promise.resolve();
		}

		const position = activeEditor.getPosition();
		return controller.addOrToggleCommentAtLine(position.lineNumber, undefined);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.action.submitComment',
	weight: KeybindingWeight.EditorContrib,
	primary: KeyMod.CtrlCmd | KeyCode.Enter,
	when: ctxCommentEditorFocused,
	handler: (accessor, args) => {
		const activeCodeEditor = accessor.get(ICodeEditorService).getFocusedCodeEditor();
		if (activeCodeEditor instanceof SimpleCommentEditor) {
			activeCodeEditor.getParentThread().submitComment();
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.action.hideComment',
	weight: KeybindingWeight.EditorContrib,
	primary: KeyCode.Escape,
	secondary: [KeyMod.Shift | KeyCode.Escape],
	when: ctxCommentEditorFocused,
	handler: (accessor, args) => {
		const activeCodeEditor = accessor.get(ICodeEditorService).getFocusedCodeEditor();
		if (activeCodeEditor instanceof SimpleCommentEditor) {
			activeCodeEditor.getParentThread().collapse();
		}
	}
});

export function getActiveEditor(accessor: ServicesAccessor): IActiveCodeEditor | null {
	let activeTextEditorControl = accessor.get(IEditorService).activeTextEditorControl;

	if (isDiffEditor(activeTextEditorControl)) {
		if (activeTextEditorControl.getOriginalEditor().hasTextFocus()) {
			activeTextEditorControl = activeTextEditorControl.getOriginalEditor();
		} else {
			activeTextEditorControl = activeTextEditorControl.getModifiedEditor();
		}
	}

	if (!isCodeEditor(activeTextEditorControl) || !activeTextEditorControl.hasModel()) {
		return null;
	}

	return activeTextEditorControl;
}

registerThemingParticipant((theme, collector) => {
	const peekViewBackground = theme.getColor(peekViewResultsBackground);
	if (peekViewBackground) {
		collector.addRule(
			`.monaco-editor .review-widget,` +
			`.monaco-editor .review-widget {` +
			`	background-color: ${peekViewBackground};` +
			`}`);
	}

	const monacoEditorBackground = theme.getColor(peekViewTitleBackground);
	if (monacoEditorBackground) {
		collector.addRule(
			`.monaco-editor .review-widget .body .comment-form .review-thread-reply-button {` +
			`	background-color: ${monacoEditorBackground}` +
			`}`
		);
	}

	const monacoEditorForeground = theme.getColor(editorForeground);
	if (monacoEditorForeground) {
		collector.addRule(
			`.monaco-editor .review-widget .body .monaco-editor {` +
			`	color: ${monacoEditorForeground}` +
			`}` +
			`.monaco-editor .review-widget .body .comment-form .review-thread-reply-button {` +
			`	color: ${monacoEditorForeground};` +
			`	font-size: inherit` +
			`}`
		);
	}

	const selectionBackground = theme.getColor(peekViewResultsSelectionBackground);

	if (selectionBackground) {
		collector.addRule(
			`@keyframes monaco-review-widget-focus {` +
			`	0% { background: ${selectionBackground}; }` +
			`	100% { background: transparent; }` +
			`}` +
			`.monaco-editor .review-widget .body .review-comment.focus {` +
			`	animation: monaco-review-widget-focus 3s ease 0s;` +
			`}`
		);
	}

	const commentingRangeForeground = theme.getColor(overviewRulerCommentingRangeForeground);
	if (commentingRangeForeground) {
		collector.addRule(`
			.monaco-editor .comment-diff-added {
				border-left: 3px solid ${commentingRangeForeground};
			}
			.monaco-editor .comment-diff-added:before {
				background: ${commentingRangeForeground};
			}
			.monaco-editor .comment-thread {
				border-left: 3px solid ${commentingRangeForeground};
			}
			.monaco-editor .comment-thread:before {
				background: ${commentingRangeForeground};
			}
		`);
	}

	const statusBarItemHoverBackground = theme.getColor(STATUS_BAR_ITEM_HOVER_BACKGROUND);
	if (statusBarItemHoverBackground) {
		collector.addRule(`.monaco-editor .review-widget .body .review-comment .review-comment-contents .comment-reactions .action-item a.action-label.active:hover { background-color: ${statusBarItemHoverBackground};}`);
	}

	const statusBarItemActiveBackground = theme.getColor(STATUS_BAR_ITEM_ACTIVE_BACKGROUND);
	if (statusBarItemActiveBackground) {
		collector.addRule(`.monaco-editor .review-widget .body .review-comment .review-comment-contents .comment-reactions .action-item a.action-label:active { background-color: ${statusBarItemActiveBackground}; border: 1px solid transparent;}`);
	}
});
