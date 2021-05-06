/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/panel';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { basename } from 'vs/base/common/resources';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { CommentNode, CommentsModel, ResourceWithCommentThreads, ICommentThreadChangedEvent } from 'vs/workbench/contrib/comments/common/commentModel';
import { CommentController } from 'vs/workbench/contrib/comments/browser/commentsEditorContribution';
import { IWorkspaceCommentThreadsEvent, ICommentService } from 'vs/workbench/contrib/comments/browser/commentService';
import { IEditorService, ACTIVE_GROUP, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { textLinkForeground, textLinkActiveForeground, focusBorder, textPreformatForeground } from 'vs/platform/theme/common/colorRegistry';
import { ResourceLabels } from 'vs/workbench/browser/labels';
import { CommentsList, COMMENTS_VIEW_ID, COMMENTS_VIEW_TITLE } from 'vs/workbench/contrib/comments/browser/commentsTreeViewer';
import { ViewPane, IViewPaneOptions, ViewAction } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService, IViewsService } from 'vs/workbench/common/views';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyAndExpr, ContextKeyEqualsExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { Codicon } from 'vs/base/common/codicons';

const CONTEXT_KEY_HAS_COMMENTS = new RawContextKey<boolean>('commentsView.hasComments', false);

export class CommentsPanel extends ViewPane {
	private treeLabels!: ResourceLabels;
	private tree!: CommentsList;
	private treeContainer!: HTMLElement;
	private messageBoxContainer!: HTMLElement;
	private commentsModel!: CommentsModel;
	private readonly hasCommentsContextKey: IContextKey<boolean>;

	readonly onDidChangeVisibility = this.onDidChangeBodyVisibility;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ICommentService private readonly commentService: ICommentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.hasCommentsContextKey = CONTEXT_KEY_HAS_COMMENTS.bindTo(contextKeyService);
	}

	public override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('comments-panel');

		let domContainer = dom.append(container, dom.$('.comments-panel-container'));
		this.treeContainer = dom.append(domContainer, dom.$('.tree-container'));
		this.commentsModel = new CommentsModel();

		this.createTree();
		this.createMessageBox(domContainer);

		this._register(this.commentService.onDidSetAllCommentThreads(this.onAllCommentsChanged, this));
		this._register(this.commentService.onDidUpdateCommentThreads(this.onCommentsUpdated, this));

		const styleElement = dom.createStyleSheet(container);
		this.applyStyles(styleElement);
		this._register(this.themeService.onDidColorThemeChange(_ => this.applyStyles(styleElement)));

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				this.refresh();
			}
		}));

		this.renderComments();
	}

	public override focus(): void {
		if (this.tree && this.tree.getHTMLElement() === document.activeElement) {
			return;
		}

		if (!this.commentsModel.hasCommentThreads() && this.messageBoxContainer) {
			this.messageBoxContainer.focus();
		} else if (this.tree) {
			this.tree.domFocus();
		}
	}

	private applyStyles(styleElement: HTMLStyleElement) {
		const content: string[] = [];

		const theme = this.themeService.getColorTheme();
		const linkColor = theme.getColor(textLinkForeground);
		if (linkColor) {
			content.push(`.comments-panel .comments-panel-container a { color: ${linkColor}; }`);
		}

		const linkActiveColor = theme.getColor(textLinkActiveForeground);
		if (linkActiveColor) {
			content.push(`.comments-panel .comments-panel-container a:hover, a:active { color: ${linkActiveColor}; }`);
		}

		const focusColor = theme.getColor(focusBorder);
		if (focusColor) {
			content.push(`.comments-panel .commenst-panel-container a:focus { outline-color: ${focusColor}; }`);
		}

		const codeTextForegroundColor = theme.getColor(textPreformatForeground);
		if (codeTextForegroundColor) {
			content.push(`.comments-panel .comments-panel-container .text code { color: ${codeTextForegroundColor}; }`);
		}

		styleElement.textContent = content.join('\n');
	}

	private async renderComments(): Promise<void> {
		this.treeContainer.classList.toggle('hidden', !this.commentsModel.hasCommentThreads());
		this.renderMessage();
		await this.tree.setInput(this.commentsModel);
	}

	public collapseAll() {
		if (this.tree) {
			this.tree.collapseAll();
			this.tree.setSelection([]);
			this.tree.setFocus([]);
			this.tree.domFocus();
			this.tree.focusFirst();
		}
	}

	public override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}

	public getTitle(): string {
		return COMMENTS_VIEW_TITLE;
	}

	private createMessageBox(parent: HTMLElement): void {
		this.messageBoxContainer = dom.append(parent, dom.$('.message-box-container'));
		this.messageBoxContainer.setAttribute('tabIndex', '0');
	}

	private renderMessage(): void {
		this.messageBoxContainer.textContent = this.commentsModel.getMessage();
		this.messageBoxContainer.classList.toggle('hidden', this.commentsModel.hasCommentThreads());
	}

	private createTree(): void {
		this.treeLabels = this._register(this.instantiationService.createInstance(ResourceLabels, this));
		this.tree = this._register(this.instantiationService.createInstance(CommentsList, this.treeLabels, this.treeContainer, {
			overrideStyles: { listBackground: this.getBackgroundColor() },
			selectionNavigation: true,
			accessibilityProvider: {
				getAriaLabel(element: any): string {
					if (element instanceof CommentsModel) {
						return nls.localize('rootCommentsLabel', "Comments for current workspace");
					}
					if (element instanceof ResourceWithCommentThreads) {
						return nls.localize('resourceWithCommentThreadsLabel', "Comments in {0}, full path {1}", basename(element.resource), element.resource.fsPath);
					}
					if (element instanceof CommentNode) {
						return nls.localize('resourceWithCommentLabel',
							"Comment from ${0} at line {1} column {2} in {3}, source: {4}",
							element.comment.userName,
							element.range.startLineNumber,
							element.range.startColumn,
							basename(element.resource),
							element.comment.body.value
						);
					}
					return '';
				},
				getWidgetAriaLabel(): string {
					return COMMENTS_VIEW_TITLE;
				}
			}
		}));

		this._register(this.tree.onDidOpen(e => {
			this.openFile(e.element, e.editorOptions.pinned, e.editorOptions.preserveFocus, e.sideBySide);
		}));
	}

	private openFile(element: any, pinned?: boolean, preserveFocus?: boolean, sideBySide?: boolean): boolean {
		if (!element) {
			return false;
		}

		if (!(element instanceof ResourceWithCommentThreads || element instanceof CommentNode)) {
			return false;
		}

		const range = element instanceof ResourceWithCommentThreads ? element.commentThreads[0].range : element.range;

		const activeEditor = this.editorService.activeEditor;
		let currentActiveResource = activeEditor ? activeEditor.resource : undefined;
		if (this.uriIdentityService.extUri.isEqual(element.resource, currentActiveResource)) {
			const threadToReveal = element instanceof ResourceWithCommentThreads ? element.commentThreads[0].threadId : element.threadId;
			const commentToReveal = element instanceof ResourceWithCommentThreads ? element.commentThreads[0].comment.uniqueIdInThread : element.comment.uniqueIdInThread;
			const control = this.editorService.activeTextEditorControl;
			if (threadToReveal && isCodeEditor(control)) {
				const controller = CommentController.get(control);
				controller.revealCommentThread(threadToReveal, commentToReveal, false);
			}

			return true;
		}

		const threadToReveal = element instanceof ResourceWithCommentThreads ? element.commentThreads[0].threadId : element.threadId;
		const commentToReveal = element instanceof ResourceWithCommentThreads ? element.commentThreads[0].comment : element.comment;

		this.editorService.openEditor({
			resource: element.resource,
			options: {
				pinned: pinned,
				preserveFocus: preserveFocus,
				selection: range
			}
		}, sideBySide ? SIDE_GROUP : ACTIVE_GROUP).then(editor => {
			if (editor) {
				const control = editor.getControl();
				if (threadToReveal && isCodeEditor(control)) {
					const controller = CommentController.get(control);
					controller.revealCommentThread(threadToReveal, commentToReveal.uniqueIdInThread, true);
				}
			}
		});

		return true;
	}

	private async refresh(): Promise<void> {
		if (this.isVisible()) {
			this.hasCommentsContextKey.set(this.commentsModel.hasCommentThreads());

			this.treeContainer.classList.toggle('hidden', !this.commentsModel.hasCommentThreads());
			this.renderMessage();
			await this.tree.updateChildren();

			if (this.tree.getSelection().length === 0 && this.commentsModel.hasCommentThreads()) {
				const firstComment = this.commentsModel.resourceCommentThreads[0].commentThreads[0];
				if (firstComment) {
					this.tree.setFocus([firstComment]);
					this.tree.setSelection([firstComment]);
				}
			}
		}
	}

	private onAllCommentsChanged(e: IWorkspaceCommentThreadsEvent): void {
		this.commentsModel.setCommentThreads(e.ownerId, e.commentThreads);
		this.refresh();
	}

	private onCommentsUpdated(e: ICommentThreadChangedEvent): void {
		const didUpdate = this.commentsModel.updateCommentThreads(e);
		if (didUpdate) {
			this.refresh();
		}
	}
}

CommandsRegistry.registerCommand({
	id: 'workbench.action.focusCommentsPanel',
	handler: async (accessor) => {
		const viewsService = accessor.get(IViewsService);
		viewsService.openView(COMMENTS_VIEW_ID, true);
	}
});

registerAction2(class Collapse extends ViewAction<CommentsPanel> {
	constructor() {
		super({
			viewId: COMMENTS_VIEW_ID,
			id: 'comments.collapse',
			title: nls.localize('collapseAll', "Collapse All"),
			f1: false,
			icon: Codicon.collapseAll,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				when: ContextKeyAndExpr.create([ContextKeyEqualsExpr.create('view', COMMENTS_VIEW_ID), CONTEXT_KEY_HAS_COMMENTS])
			}
		});
	}
	runInView(_accessor: ServicesAccessor, view: CommentsPanel) {
		view.collapseAll();
	}
});
