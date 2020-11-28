/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import * as modes from 'vs/editor/common/modes';
import { ActionsOrientation, ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { Action, IActionRunner, IAction, Separator } from 'vs/base/common/actions';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommentService } from 'vs/workbench/contrib/comments/browser/commentService';
import { SimpleCommentEditor } from 'vs/workbench/contrib/comments/browser/simpleCommentEditor';
import { Selection } from 'vs/editor/common/core/selection';
import { Emitter, Event } from 'vs/base/common/event';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { ToggleReactionsAction, ReactionAction, ReactionActionViewItem } from './reactionsAction';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { ICommentThreadWidget } from 'vs/workbench/contrib/comments/common/commentThreadWidget';
import { MenuItemAction, SubmenuItemAction, IMenu } from 'vs/platform/actions/common/actions';
import { MenuEntryActionViewItem, SubmenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { CommentFormActions } from 'vs/workbench/contrib/comments/browser/commentFormActions';
import { MOUSE_CURSOR_TEXT_CSS_CLASS_NAME } from 'vs/base/browser/ui/mouseCursor/mouseCursor';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { DropdownMenuActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownActionViewItem';
import { Codicon } from 'vs/base/common/codicons';

export class CommentNode extends Disposable {
	private _domNode: HTMLElement;
	private _body: HTMLElement;
	private _md: HTMLElement;
	private _clearTimeout: any;

	private _editAction: Action | null = null;
	private _commentEditContainer: HTMLElement | null = null;
	private _commentDetailsContainer: HTMLElement;
	private _actionsToolbarContainer!: HTMLElement;
	private _reactionsActionBar?: ActionBar;
	private _reactionActionsContainer?: HTMLElement;
	private _commentEditor: SimpleCommentEditor | null = null;
	private _commentEditorDisposables: IDisposable[] = [];
	private _commentEditorModel: ITextModel | null = null;
	private _isPendingLabel!: HTMLElement;
	private _contextKeyService: IContextKeyService;
	private _commentContextValue: IContextKey<string>;

	protected actionRunner?: IActionRunner;
	protected toolbar: ToolBar | undefined;
	private _commentFormActions: CommentFormActions | null = null;

	private readonly _onDidClick = new Emitter<CommentNode>();

	public get domNode(): HTMLElement {
		return this._domNode;
	}

	public isEditing: boolean = false;

	constructor(
		private commentThread: modes.CommentThread,
		public comment: modes.Comment,
		private owner: string,
		private resource: URI,
		private parentEditor: ICodeEditor,
		private parentThread: ICommentThreadWidget,
		private markdownRenderer: MarkdownRenderer,
		@IThemeService private themeService: IThemeService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@ICommentService private commentService: ICommentService,
		@IModelService private modelService: IModelService,
		@IModeService private modeService: IModeService,
		@INotificationService private notificationService: INotificationService,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();

		this._domNode = dom.$('div.review-comment');
		this._contextKeyService = contextKeyService.createScoped(this._domNode);
		this._commentContextValue = this._contextKeyService.createKey('comment', comment.contextValue);

		this._domNode.tabIndex = -1;
		const avatar = dom.append(this._domNode, dom.$('div.avatar-container'));
		if (comment.userIconPath) {
			const img = <HTMLImageElement>dom.append(avatar, dom.$('img.avatar'));
			img.src = comment.userIconPath.toString();
			img.onerror = _ => img.remove();
		}
		this._commentDetailsContainer = dom.append(this._domNode, dom.$('.review-comment-contents'));

		this.createHeader(this._commentDetailsContainer);

		this._body = dom.append(this._commentDetailsContainer, dom.$(`div.comment-body.${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME}`));
		this._md = this.markdownRenderer.render(comment.body).element;
		this._body.appendChild(this._md);

		if (this.comment.commentReactions && this.comment.commentReactions.length && this.comment.commentReactions.filter(reaction => !!reaction.count).length) {
			this.createReactionsContainer(this._commentDetailsContainer);
		}

		this._domNode.setAttribute('aria-label', `${comment.userName}, ${comment.body.value}`);
		this._domNode.setAttribute('role', 'treeitem');
		this._clearTimeout = null;

		this._register(dom.addDisposableListener(this._domNode, dom.EventType.CLICK, () => this.isEditing || this._onDidClick.fire(this)));
	}

	public get onDidClick(): Event<CommentNode> {
		return this._onDidClick.event;
	}

	private createHeader(commentDetailsContainer: HTMLElement): void {
		const header = dom.append(commentDetailsContainer, dom.$(`div.comment-title.${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME}`));
		const author = dom.append(header, dom.$('strong.author'));
		author.innerText = this.comment.userName;

		this._isPendingLabel = dom.append(header, dom.$('span.isPending'));

		if (this.comment.label) {
			this._isPendingLabel.innerText = this.comment.label;
		} else {
			this._isPendingLabel.innerText = '';
		}

		this._actionsToolbarContainer = dom.append(header, dom.$('.comment-actions.hidden'));
		this.createActionsToolbar();
	}

	private getToolbarActions(menu: IMenu): { primary: IAction[], secondary: IAction[] } {
		const contributedActions = menu.getActions({ shouldForwardArgs: true });
		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };
		fillInActions(contributedActions, result, false, g => /^inline/.test(g));
		return result;
	}

	private createToolbar() {
		this.toolbar = new ToolBar(this._actionsToolbarContainer, this.contextMenuService, {
			actionViewItemProvider: action => {
				if (action.id === ToggleReactionsAction.ID) {
					return new DropdownMenuActionViewItem(
						action,
						(<ToggleReactionsAction>action).menuActions,
						this.contextMenuService,
						{
							actionViewItemProvider: action => this.actionViewItemProvider(action as Action),
							actionRunner: this.actionRunner,
							classNames: ['toolbar-toggle-pickReactions', ...Codicon.reactions.classNamesArray],
							anchorAlignmentProvider: () => AnchorAlignment.RIGHT
						}
					);
				}
				return this.actionViewItemProvider(action as Action);
			},
			orientation: ActionsOrientation.HORIZONTAL
		});

		this.toolbar.context = {
			thread: this.commentThread,
			commentUniqueId: this.comment.uniqueIdInThread,
			$mid: 9
		};

		this.registerActionBarListeners(this._actionsToolbarContainer);
		this._register(this.toolbar);
	}

	private createActionsToolbar() {
		const actions: IAction[] = [];

		let hasReactionHandler = this.commentService.hasReactionHandler(this.owner);

		if (hasReactionHandler) {
			let toggleReactionAction = this.createReactionPicker(this.comment.commentReactions || []);
			actions.push(toggleReactionAction);
		}

		let commentMenus = this.commentService.getCommentMenus(this.owner);
		const menu = commentMenus.getCommentTitleActions(this.comment, this._contextKeyService);
		this._register(menu);
		this._register(menu.onDidChange(e => {
			const { primary, secondary } = this.getToolbarActions(menu);
			if (!this.toolbar && (primary.length || secondary.length)) {
				this.createToolbar();
			}

			this.toolbar!.setActions(primary, secondary);
		}));

		const { primary, secondary } = this.getToolbarActions(menu);
		actions.push(...primary);

		if (actions.length || secondary.length) {
			this.createToolbar();
			this.toolbar!.setActions(actions, secondary);
		}
	}

	actionViewItemProvider(action: Action) {
		let options = {};
		if (action.id === ToggleReactionsAction.ID) {
			options = { label: false, icon: true };
		} else {
			options = { label: false, icon: true };
		}

		if (action.id === ReactionAction.ID) {
			let item = new ReactionActionViewItem(action);
			return item;
		} else if (action instanceof MenuItemAction) {
			return this.instantiationService.createInstance(MenuEntryActionViewItem, action);
		} else if (action instanceof SubmenuItemAction) {
			return this.instantiationService.createInstance(SubmenuEntryActionViewItem, action);
		} else {
			let item = new ActionViewItem({}, action, options);
			return item;
		}
	}

	private createReactionPicker(reactionGroup: modes.CommentReaction[]): ToggleReactionsAction {
		let toggleReactionActionViewItem: DropdownMenuActionViewItem;
		let toggleReactionAction = this._register(new ToggleReactionsAction(() => {
			if (toggleReactionActionViewItem) {
				toggleReactionActionViewItem.show();
			}
		}, nls.localize('commentToggleReaction', "Toggle Reaction")));

		let reactionMenuActions: Action[] = [];
		if (reactionGroup && reactionGroup.length) {
			reactionMenuActions = reactionGroup.map((reaction) => {
				return new Action(`reaction.command.${reaction.label}`, `${reaction.label}`, '', true, async () => {
					try {
						await this.commentService.toggleReaction(this.owner, this.resource, this.commentThread, this.comment, reaction);
					} catch (e) {
						const error = e.message
							? nls.localize('commentToggleReactionError', "Toggling the comment reaction failed: {0}.", e.message)
							: nls.localize('commentToggleReactionDefaultError', "Toggling the comment reaction failed");
						this.notificationService.error(error);
					}
				});
			});
		}

		toggleReactionAction.menuActions = reactionMenuActions;

		toggleReactionActionViewItem = new DropdownMenuActionViewItem(
			toggleReactionAction,
			(<ToggleReactionsAction>toggleReactionAction).menuActions,
			this.contextMenuService,
			{
				actionViewItemProvider: action => {
					if (action.id === ToggleReactionsAction.ID) {
						return toggleReactionActionViewItem;
					}
					return this.actionViewItemProvider(action as Action);
				},
				actionRunner: this.actionRunner,
				classNames: 'toolbar-toggle-pickReactions',
				anchorAlignmentProvider: () => AnchorAlignment.RIGHT
			}
		);

		return toggleReactionAction;
	}

	private createReactionsContainer(commentDetailsContainer: HTMLElement): void {
		this._reactionActionsContainer = dom.append(commentDetailsContainer, dom.$('div.comment-reactions'));
		this._reactionsActionBar = new ActionBar(this._reactionActionsContainer, {
			actionViewItemProvider: action => {
				if (action.id === ToggleReactionsAction.ID) {
					return new DropdownMenuActionViewItem(
						action,
						(<ToggleReactionsAction>action).menuActions,
						this.contextMenuService,
						{
							actionViewItemProvider: action => this.actionViewItemProvider(action as Action),
							actionRunner: this.actionRunner,
							classNames: 'toolbar-toggle-pickReactions',
							anchorAlignmentProvider: () => AnchorAlignment.RIGHT
						}
					);
				}
				return this.actionViewItemProvider(action as Action);
			}
		});
		this._register(this._reactionsActionBar);

		let hasReactionHandler = this.commentService.hasReactionHandler(this.owner);
		this.comment.commentReactions!.filter(reaction => !!reaction.count).map(reaction => {
			let action = new ReactionAction(`reaction.${reaction.label}`, `${reaction.label}`, reaction.hasReacted && (reaction.canEdit || hasReactionHandler) ? 'active' : '', (reaction.canEdit || hasReactionHandler), async () => {
				try {
					await this.commentService.toggleReaction(this.owner, this.resource, this.commentThread, this.comment, reaction);
				} catch (e) {
					let error: string;

					if (reaction.hasReacted) {
						error = e.message
							? nls.localize('commentDeleteReactionError', "Deleting the comment reaction failed: {0}.", e.message)
							: nls.localize('commentDeleteReactionDefaultError', "Deleting the comment reaction failed");
					} else {
						error = e.message
							? nls.localize('commentAddReactionError', "Deleting the comment reaction failed: {0}.", e.message)
							: nls.localize('commentAddReactionDefaultError', "Deleting the comment reaction failed");
					}
					this.notificationService.error(error);
				}
			}, reaction.iconPath, reaction.count);

			if (this._reactionsActionBar) {
				this._reactionsActionBar.push(action, { label: true, icon: true });
			}
		});

		if (hasReactionHandler) {
			let toggleReactionAction = this.createReactionPicker(this.comment.commentReactions || []);
			this._reactionsActionBar.push(toggleReactionAction, { label: false, icon: true });
		}
	}

	private createCommentEditor(editContainer: HTMLElement): void {
		const container = dom.append(editContainer, dom.$('.edit-textarea'));
		this._commentEditor = this.instantiationService.createInstance(SimpleCommentEditor, container, SimpleCommentEditor.getEditorOptions(), this.parentEditor, this.parentThread);
		const resource = URI.parse(`comment:commentinput-${this.comment.uniqueIdInThread}-${Date.now()}.md`);
		this._commentEditorModel = this.modelService.createModel('', this.modeService.createByFilepathOrFirstLine(resource), resource, false);

		this._commentEditor.setModel(this._commentEditorModel);
		this._commentEditor.setValue(this.comment.body.value);
		this._commentEditor.layout({ width: container.clientWidth - 14, height: 90 });
		this._commentEditor.focus();

		dom.scheduleAtNextAnimationFrame(() => {
			this._commentEditor!.layout({ width: container.clientWidth - 14, height: 90 });
			this._commentEditor!.focus();
		});

		const lastLine = this._commentEditorModel.getLineCount();
		const lastColumn = this._commentEditorModel.getLineContent(lastLine).length + 1;
		this._commentEditor.setSelection(new Selection(lastLine, lastColumn, lastLine, lastColumn));

		let commentThread = this.commentThread;
		commentThread.input = {
			uri: this._commentEditor.getModel()!.uri,
			value: this.comment.body.value
		};
		this.commentService.setActiveCommentThread(commentThread);

		this._commentEditorDisposables.push(this._commentEditor.onDidFocusEditorWidget(() => {
			commentThread.input = {
				uri: this._commentEditor!.getModel()!.uri,
				value: this.comment.body.value
			};
			this.commentService.setActiveCommentThread(commentThread);
		}));

		this._commentEditorDisposables.push(this._commentEditor.onDidChangeModelContent(e => {
			if (commentThread.input && this._commentEditor && this._commentEditor.getModel()!.uri === commentThread.input.uri) {
				let newVal = this._commentEditor.getValue();
				if (newVal !== commentThread.input.value) {
					let input = commentThread.input;
					input.value = newVal;
					commentThread.input = input;
					this.commentService.setActiveCommentThread(commentThread);
				}
			}
		}));

		this._register(this._commentEditor);
		this._register(this._commentEditorModel);
	}

	private removeCommentEditor() {
		this.isEditing = false;
		if (this._editAction) {
			this._editAction.enabled = true;
		}
		this._body.classList.remove('hidden');

		if (this._commentEditorModel) {
			this._commentEditorModel.dispose();
		}

		this._commentEditorDisposables.forEach(dispose => dispose.dispose());
		this._commentEditorDisposables = [];
		if (this._commentEditor) {
			this._commentEditor.dispose();
			this._commentEditor = null;
		}

		this._commentEditContainer!.remove();
	}

	layout() {
		this._commentEditor?.layout();
	}

	public switchToEditMode() {
		if (this.isEditing) {
			return;
		}

		this.isEditing = true;
		this._body.classList.add('hidden');
		this._commentEditContainer = dom.append(this._commentDetailsContainer, dom.$('.edit-container'));
		this.createCommentEditor(this._commentEditContainer);
		const formActions = dom.append(this._commentEditContainer, dom.$('.form-actions'));

		const menus = this.commentService.getCommentMenus(this.owner);
		const menu = menus.getCommentActions(this.comment, this._contextKeyService);

		this._register(menu);
		this._register(menu.onDidChange(() => {
			if (this._commentFormActions) {
				this._commentFormActions.setActions(menu);
			}
		}));

		this._commentFormActions = new CommentFormActions(formActions, (action: IAction): void => {
			let text = this._commentEditor!.getValue();

			action.run({
				thread: this.commentThread,
				commentUniqueId: this.comment.uniqueIdInThread,
				text: text,
				$mid: 10
			});

			this.removeCommentEditor();
		}, this.themeService);

		this._commentFormActions.setActions(menu);
	}

	setFocus(focused: boolean, visible: boolean = false) {
		if (focused) {
			this._domNode.focus();
			this._actionsToolbarContainer.classList.remove('hidden');
			this._actionsToolbarContainer.classList.add('tabfocused');
			this._domNode.tabIndex = 0;
			if (this.comment.mode === modes.CommentMode.Editing) {
				this._commentEditor?.focus();
			}
		} else {
			if (this._actionsToolbarContainer.classList.contains('tabfocused') && !this._actionsToolbarContainer.classList.contains('mouseover')) {
				this._actionsToolbarContainer.classList.add('hidden');
				this._domNode.tabIndex = -1;
			}
			this._actionsToolbarContainer.classList.remove('tabfocused');
		}
	}

	private registerActionBarListeners(actionsContainer: HTMLElement): void {
		this._register(dom.addDisposableListener(this._domNode, 'mouseenter', () => {
			actionsContainer.classList.remove('hidden');
			actionsContainer.classList.add('mouseover');
		}));
		this._register(dom.addDisposableListener(this._domNode, 'mouseleave', () => {
			if (actionsContainer.classList.contains('mouseover') && !actionsContainer.classList.contains('tabfocused')) {
				actionsContainer.classList.add('hidden');
			}
			actionsContainer.classList.remove('mouseover');
		}));
	}

	update(newComment: modes.Comment) {

		if (newComment.body !== this.comment.body) {
			this._body.removeChild(this._md);
			this._md = this.markdownRenderer.render(newComment.body).element;
			this._body.appendChild(this._md);
		}

		if (newComment.mode !== undefined && newComment.mode !== this.comment.mode) {
			if (newComment.mode === modes.CommentMode.Editing) {
				this.switchToEditMode();
			} else {
				this.removeCommentEditor();
			}
		}

		this.comment = newComment;

		if (newComment.label) {
			this._isPendingLabel.innerText = newComment.label;
		} else {
			this._isPendingLabel.innerText = '';
		}

		// update comment reactions
		if (this._reactionActionsContainer) {
			this._reactionActionsContainer.remove();
		}

		if (this._reactionsActionBar) {
			this._reactionsActionBar.clear();
		}

		if (this.comment.commentReactions && this.comment.commentReactions.some(reaction => !!reaction.count)) {
			this.createReactionsContainer(this._commentDetailsContainer);
		}

		if (this.comment.contextValue) {
			this._commentContextValue.set(this.comment.contextValue);
		} else {
			this._commentContextValue.reset();
		}
	}

	focus() {
		this.domNode.focus();
		if (!this._clearTimeout) {
			this.domNode.classList.add('focus');
			this._clearTimeout = setTimeout(() => {
				this.domNode.classList.remove('focus');
			}, 3000);
		}
	}
}

function fillInActions(groups: [string, Array<MenuItemAction | SubmenuItemAction>][], target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, useAlternativeActions: boolean, isPrimaryGroup: (group: string) => boolean = group => group === 'navigation'): void {
	for (let tuple of groups) {
		let [group, actions] = tuple;
		if (useAlternativeActions) {
			actions = actions.map(a => (a instanceof MenuItemAction) && !!a.alt ? a.alt : a);
		}

		if (isPrimaryGroup(group)) {
			const to = Array.isArray(target) ? target : target.primary;

			to.unshift(...actions);
		} else {
			const to = Array.isArray(target) ? target : target.secondary;

			if (to.length > 0) {
				to.push(new Separator());
			}

			to.push(...actions);
		}
	}
}
