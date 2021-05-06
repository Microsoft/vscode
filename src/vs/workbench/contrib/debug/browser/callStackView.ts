/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from 'vs/base/common/async';
import * as dom from 'vs/base/browser/dom';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IDebugService, State, IStackFrame, IDebugSession, IThread, CONTEXT_CALLSTACK_ITEM_TYPE, IDebugModel, CALLSTACK_VIEW_ID, CONTEXT_DEBUG_STATE, getStateLabel, CONTEXT_STACK_FRAME_SUPPORTS_RESTART, CONTEXT_CALLSTACK_SESSION_IS_ATTACH, CONTEXT_CALLSTACK_ITEM_STOPPED, CONTEXT_CALLSTACK_SESSION_HAS_ONE_THREAD } from 'vs/workbench/contrib/debug/common/debug';
import { Thread, StackFrame, ThreadAndSessionIds } from 'vs/workbench/contrib/debug/common/debugModel';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { MenuId, IMenu, IMenuService, MenuItemAction, SubmenuItemAction, registerAction2, MenuRegistry, Icon } from 'vs/platform/actions/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { renderViewTree } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { IAction, Action } from 'vs/base/common/actions';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService, ContextKeyEqualsExpr, ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { ViewPane, ViewAction } from 'vs/workbench/browser/parts/views/viewPane';
import { ILabelService } from 'vs/platform/label/common/label';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { createAndFillInContextMenuActions, createAndFillInActionBarActions, MenuEntryActionViewItem, SubmenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeNode, ITreeContextMenuEvent, IAsyncDataSource } from 'vs/base/browser/ui/tree/tree';
import { WorkbenchCompressibleAsyncDataTree } from 'vs/platform/list/browser/listService';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { createMatches, FuzzyScore, IMatch } from 'vs/base/common/filters';
import { Event } from 'vs/base/common/event';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { isSessionAttach } from 'vs/workbench/contrib/debug/common/debugUtils';
import { STOP_ID, STOP_LABEL, DISCONNECT_ID, DISCONNECT_LABEL, RESTART_SESSION_ID, RESTART_LABEL, STEP_OVER_ID, STEP_OVER_LABEL, STEP_INTO_LABEL, STEP_INTO_ID, STEP_OUT_LABEL, STEP_OUT_ID, PAUSE_ID, PAUSE_LABEL, CONTINUE_ID, CONTINUE_LABEL } from 'vs/workbench/contrib/debug/browser/debugCommands';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { textLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { attachStylerCallback } from 'vs/platform/theme/common/styler';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { commonSuffixLength } from 'vs/base/common/strings';
import { posix } from 'vs/base/common/path';
import { ITreeCompressionDelegate } from 'vs/base/browser/ui/tree/asyncDataTree';
import { ICompressibleTreeRenderer } from 'vs/base/browser/ui/tree/objectTree';
import { ICompressedTreeNode } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';
import * as icons from 'vs/workbench/contrib/debug/browser/debugIcons';
import { localize } from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';

const $ = dom.$;

type CallStackItem = IStackFrame | IThread | IDebugSession | string | ThreadAndSessionIds | IStackFrame[];

export function getContext(element: CallStackItem | null): any {
	return element instanceof StackFrame ? {
		sessionId: element.thread.session.getId(),
		threadId: element.thread.getId(),
		frameId: element.getId()
	} : element instanceof Thread ? {
		sessionId: element.session.getId(),
		threadId: element.getId()
	} : isDebugSession(element) ? {
		sessionId: element.getId()
	} : undefined;
}

// Extensions depend on this context, should not be changed even though it is not fully deterministic
export function getContextForContributedActions(element: CallStackItem | null): string | number {
	if (element instanceof StackFrame) {
		if (element.source.inMemory) {
			return element.source.raw.path || element.source.reference || element.source.name;
		}

		return element.source.uri.toString();
	}
	if (element instanceof Thread) {
		return element.threadId;
	}
	if (isDebugSession(element)) {
		return element.getId();
	}

	return '';
}

export function getSpecificSourceName(stackFrame: IStackFrame): string {
	// To reduce flashing of the path name and the way we fetch stack frames
	// We need to compute the source name based on the other frames in the stale call stack
	let callStack = (<Thread>stackFrame.thread).getStaleCallStack();
	callStack = callStack.length > 0 ? callStack : stackFrame.thread.getCallStack();
	const otherSources = callStack.map(sf => sf.source).filter(s => s !== stackFrame.source);
	let suffixLength = 0;
	otherSources.forEach(s => {
		if (s.name === stackFrame.source.name) {
			suffixLength = Math.max(suffixLength, commonSuffixLength(stackFrame.source.uri.path, s.uri.path));
		}
	});
	if (suffixLength === 0) {
		return stackFrame.source.name;
	}

	const from = Math.max(0, stackFrame.source.uri.path.lastIndexOf(posix.sep, stackFrame.source.uri.path.length - suffixLength - 1));
	return (from > 0 ? '...' : '') + stackFrame.source.uri.path.substr(from);
}

async function expandTo(session: IDebugSession, tree: WorkbenchCompressibleAsyncDataTree<IDebugModel, CallStackItem, FuzzyScore>): Promise<void> {
	if (session.parentSession) {
		await expandTo(session.parentSession, tree);
	}
	await tree.expand(session);
}

export class CallStackView extends ViewPane {
	private stateMessage!: HTMLSpanElement;
	private stateMessageLabel!: HTMLSpanElement;
	private onCallStackChangeScheduler: RunOnceScheduler;
	private needsRefresh = false;
	private ignoreSelectionChangedEvent = false;
	private ignoreFocusStackFrameEvent = false;
	private callStackItemType: IContextKey<string>;
	private callStackSessionIsAttach: IContextKey<boolean>;
	private callStackItemStopped: IContextKey<boolean>;
	private stackFrameSupportsRestart: IContextKey<boolean>;
	private sessionHasOneThread: IContextKey<boolean>;
	private dataSource!: CallStackDataSource;
	private tree!: WorkbenchCompressibleAsyncDataTree<IDebugModel, CallStackItem, FuzzyScore>;
	private menu: IMenu;
	private autoExpandedSessions = new Set<IDebugSession>();
	private selectionNeedsUpdate = false;

	constructor(
		private options: IViewletViewOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IDebugService private readonly debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.callStackItemType = CONTEXT_CALLSTACK_ITEM_TYPE.bindTo(contextKeyService);
		this.callStackSessionIsAttach = CONTEXT_CALLSTACK_SESSION_IS_ATTACH.bindTo(contextKeyService);
		this.stackFrameSupportsRestart = CONTEXT_STACK_FRAME_SUPPORTS_RESTART.bindTo(contextKeyService);
		this.callStackItemStopped = CONTEXT_CALLSTACK_ITEM_STOPPED.bindTo(contextKeyService);
		this.sessionHasOneThread = CONTEXT_CALLSTACK_SESSION_HAS_ONE_THREAD.bindTo(contextKeyService);

		this.menu = menuService.createMenu(MenuId.DebugCallStackContext, contextKeyService);
		this._register(this.menu);

		// Create scheduler to prevent unnecessary flashing of tree when reacting to changes
		this.onCallStackChangeScheduler = new RunOnceScheduler(async () => {
			// Only show the global pause message if we do not display threads.
			// Otherwise there will be a pause message per thread and there is no need for a global one.
			const sessions = this.debugService.getModel().getSessions();
			if (sessions.length === 0) {
				this.autoExpandedSessions.clear();
			}

			const thread = sessions.length === 1 && sessions[0].getAllThreads().length === 1 ? sessions[0].getAllThreads()[0] : undefined;
			if (thread && thread.stoppedDetails) {
				this.stateMessageLabel.textContent = thread.stateLabel;
				this.stateMessageLabel.title = thread.stateLabel;
				this.stateMessageLabel.classList.toggle('exception', thread.stoppedDetails.reason === 'exception');
				this.stateMessage.hidden = false;
			} else if (sessions.length === 1 && sessions[0].state === State.Running) {
				this.stateMessageLabel.textContent = localize({ key: 'running', comment: ['indicates state'] }, "Running");
				this.stateMessageLabel.title = sessions[0].getLabel();
				this.stateMessageLabel.classList.remove('exception');
				this.stateMessage.hidden = false;
			} else {
				this.stateMessage.hidden = true;
			}
			this.updateActions();

			this.needsRefresh = false;
			this.dataSource.deemphasizedStackFramesToShow = [];
			await this.tree.updateChildren();
			try {
				const toExpand = new Set<IDebugSession>();
				sessions.forEach(s => {
					// Automatically expand sessions that have children, but only do this once.
					if (s.parentSession && !this.autoExpandedSessions.has(s.parentSession)) {
						toExpand.add(s.parentSession);
					}
				});
				for (let session of toExpand) {
					await expandTo(session, this.tree);
					this.autoExpandedSessions.add(session);
				}
			} catch (e) {
				// Ignore tree expand errors if element no longer present
			}
			if (this.selectionNeedsUpdate) {
				this.selectionNeedsUpdate = false;
				await this.updateTreeSelection();
			}
		}, 50);
	}

	protected override renderHeaderTitle(container: HTMLElement): void {
		super.renderHeaderTitle(container, this.options.title);

		this.stateMessage = dom.append(container, $('span.call-stack-state-message'));
		this.stateMessage.hidden = true;
		this.stateMessageLabel = dom.append(this.stateMessage, $('span.label'));
	}

	override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.element.classList.add('debug-pane');
		container.classList.add('debug-call-stack');
		const treeContainer = renderViewTree(container);

		this.dataSource = new CallStackDataSource(this.debugService);
		this.tree = <WorkbenchCompressibleAsyncDataTree<IDebugModel, CallStackItem, FuzzyScore>>this.instantiationService.createInstance(WorkbenchCompressibleAsyncDataTree, 'CallStackView', treeContainer, new CallStackDelegate(), new CallStackCompressionDelegate(this.debugService), [
			new SessionsRenderer(this.menu, this.callStackItemType, this.callStackSessionIsAttach, this.callStackItemStopped, this.sessionHasOneThread, this.instantiationService),
			new ThreadsRenderer(this.menu, this.callStackItemType, this.callStackItemStopped),
			this.instantiationService.createInstance(StackFramesRenderer, this.callStackItemType),
			new ErrorsRenderer(),
			new LoadAllRenderer(this.themeService),
			new ShowMoreRenderer(this.themeService)
		], this.dataSource, {
			accessibilityProvider: new CallStackAccessibilityProvider(),
			compressionEnabled: true,
			autoExpandSingleChildren: true,
			identityProvider: {
				getId: (element: CallStackItem) => {
					if (typeof element === 'string') {
						return element;
					}
					if (element instanceof Array) {
						return `showMore ${element[0].getId()}`;
					}

					return element.getId();
				}
			},
			keyboardNavigationLabelProvider: {
				getKeyboardNavigationLabel: (e: CallStackItem) => {
					if (isDebugSession(e)) {
						return e.getLabel();
					}
					if (e instanceof Thread) {
						return `${e.name} ${e.stateLabel}`;
					}
					if (e instanceof StackFrame || typeof e === 'string') {
						return e;
					}
					if (e instanceof ThreadAndSessionIds) {
						return LoadAllRenderer.LABEL;
					}

					return localize('showMoreStackFrames2', "Show More Stack Frames");
				},
				getCompressedNodeKeyboardNavigationLabel: (e: CallStackItem[]) => {
					const firstItem = e[0];
					if (isDebugSession(firstItem)) {
						return firstItem.getLabel();
					}
					return '';
				}
			},
			expandOnlyOnTwistieClick: true,
			overrideStyles: {
				listBackground: this.getBackgroundColor()
			}
		});

		this.tree.setInput(this.debugService.getModel());

		this._register(this.tree.onDidOpen(async e => {
			if (this.ignoreSelectionChangedEvent) {
				return;
			}

			const focusStackFrame = (stackFrame: IStackFrame | undefined, thread: IThread | undefined, session: IDebugSession) => {
				this.ignoreFocusStackFrameEvent = true;
				try {
					this.debugService.focusStackFrame(stackFrame, thread, session, true);
				} finally {
					this.ignoreFocusStackFrameEvent = false;
				}
			};

			const element = e.element;
			if (element instanceof StackFrame) {
				focusStackFrame(element, element.thread, element.thread.session);
				element.openInEditor(this.editorService, e.editorOptions.preserveFocus, e.sideBySide, e.editorOptions.pinned);
			}
			if (element instanceof Thread) {
				focusStackFrame(undefined, element, element.session);
			}
			if (isDebugSession(element)) {
				focusStackFrame(undefined, undefined, element);
			}
			if (element instanceof ThreadAndSessionIds) {
				const session = this.debugService.getModel().getSession(element.sessionId);
				const thread = session && session.getThread(element.threadId);
				if (thread) {
					const totalFrames = thread.stoppedDetails?.totalFrames;
					const remainingFramesCount = typeof totalFrames === 'number' ? (totalFrames - thread.getCallStack().length) : undefined;
					// Get all the remaining frames
					await (<Thread>thread).fetchCallStack(remainingFramesCount);
					await this.tree.updateChildren();
				}
			}
			if (element instanceof Array) {
				this.dataSource.deemphasizedStackFramesToShow.push(...element);
				this.tree.updateChildren();
			}
		}));

		this._register(this.debugService.getModel().onDidChangeCallStack(() => {
			if (!this.isBodyVisible()) {
				this.needsRefresh = true;
				return;
			}

			if (!this.onCallStackChangeScheduler.isScheduled()) {
				this.onCallStackChangeScheduler.schedule();
			}
		}));
		const onFocusChange = Event.any<any>(this.debugService.getViewModel().onDidFocusStackFrame, this.debugService.getViewModel().onDidFocusSession);
		this._register(onFocusChange(async () => {
			if (this.ignoreFocusStackFrameEvent) {
				return;
			}
			if (!this.isBodyVisible()) {
				this.needsRefresh = true;
				return;
			}
			if (this.onCallStackChangeScheduler.isScheduled()) {
				this.selectionNeedsUpdate = true;
				return;
			}

			await this.updateTreeSelection();
		}));
		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));

		// Schedule the update of the call stack tree if the viewlet is opened after a session started #14684
		if (this.debugService.state === State.Stopped) {
			this.onCallStackChangeScheduler.schedule(0);
		}

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible && this.needsRefresh) {
				this.onCallStackChangeScheduler.schedule();
			}
		}));

		this._register(this.debugService.onDidNewSession(s => {
			const sessionListeners: IDisposable[] = [];
			sessionListeners.push(s.onDidChangeName(() => this.tree.rerender(s)));
			sessionListeners.push(s.onDidEndAdapter(() => dispose(sessionListeners)));
			if (s.parentSession) {
				// A session we already expanded has a new child session, allow to expand it again.
				this.autoExpandedSessions.delete(s.parentSession);
			}
		}));
	}

	override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}

	override focus(): void {
		this.tree.domFocus();
	}

	collapseAll(): void {
		this.tree.collapseAll();
	}

	private async updateTreeSelection(): Promise<void> {
		if (!this.tree || !this.tree.getInput()) {
			// Tree not initialized yet
			return;
		}

		const updateSelectionAndReveal = (element: IStackFrame | IDebugSession) => {
			this.ignoreSelectionChangedEvent = true;
			try {
				this.tree.setSelection([element]);
				// If the element is outside of the screen bounds,
				// position it in the middle
				if (this.tree.getRelativeTop(element) === null) {
					this.tree.reveal(element, 0.5);
				} else {
					this.tree.reveal(element);
				}
			} catch (e) { }
			finally {
				this.ignoreSelectionChangedEvent = false;
			}
		};

		const thread = this.debugService.getViewModel().focusedThread;
		const session = this.debugService.getViewModel().focusedSession;
		const stackFrame = this.debugService.getViewModel().focusedStackFrame;
		if (!thread) {
			if (!session) {
				this.tree.setSelection([]);
			} else {
				updateSelectionAndReveal(session);
			}
		} else {
			// Ignore errors from this expansions because we are not aware if we rendered the threads and sessions or we hide them to declutter the view
			try {
				await expandTo(thread.session, this.tree);
			} catch (e) { }
			try {
				await this.tree.expand(thread);
			} catch (e) { }

			const toReveal = stackFrame || session;
			if (toReveal) {
				updateSelectionAndReveal(toReveal);
			}
		}
	}

	private onContextMenu(e: ITreeContextMenuEvent<CallStackItem>): void {
		const element = e.element;
		this.stackFrameSupportsRestart.reset();
		if (isDebugSession(element)) {
			this.callStackItemType.set('session');
		} else if (element instanceof Thread) {
			this.callStackItemType.set('thread');
		} else if (element instanceof StackFrame) {
			this.callStackItemType.set('stackFrame');
			this.stackFrameSupportsRestart.set(element.canRestart);
		} else {
			this.callStackItemType.reset();
		}

		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };
		const actionsDisposable = createAndFillInContextMenuActions(this.menu, { arg: getContextForContributedActions(element), shouldForwardArgs: true }, result, 'inline');

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => result.secondary,
			getActionsContext: () => getContext(element),
			onHide: () => dispose(actionsDisposable)
		});
	}
}

interface IThreadTemplateData {
	thread: HTMLElement;
	name: HTMLElement;
	stateLabel: HTMLSpanElement;
	label: HighlightedLabel;
	actionBar: ActionBar;
	elementDisposable: IDisposable[];
}

interface ISessionTemplateData {
	session: HTMLElement;
	name: HTMLElement;
	stateLabel: HTMLSpanElement;
	label: HighlightedLabel;
	actionBar: ActionBar;
	elementDisposable: IDisposable[];
}

interface IErrorTemplateData {
	label: HTMLElement;
}

interface ILabelTemplateData {
	label: HTMLElement;
	toDispose: IDisposable;
}

interface IStackFrameTemplateData {
	stackFrame: HTMLElement;
	file: HTMLElement;
	fileName: HTMLElement;
	lineNumber: HTMLElement;
	label: HighlightedLabel;
	actionBar: ActionBar;
}

class SessionsRenderer implements ICompressibleTreeRenderer<IDebugSession, FuzzyScore, ISessionTemplateData> {
	static readonly ID = 'session';

	constructor(
		private menu: IMenu,
		private callStackItemType: IContextKey<string>,
		private callStackSessionIsAttach: IContextKey<boolean>,
		private callStackItemStopped: IContextKey<boolean>,
		private sessionHasOneThread: IContextKey<boolean>,
		private readonly instantiationService: IInstantiationService
	) { }

	get templateId(): string {
		return SessionsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): ISessionTemplateData {
		const session = dom.append(container, $('.session'));
		dom.append(session, $(ThemeIcon.asCSSSelector(icons.callstackViewSession)));
		const name = dom.append(session, $('.name'));
		const stateLabel = dom.append(session, $('span.state.label.monaco-count-badge.long'));
		const label = new HighlightedLabel(name, false);
		const actionBar = new ActionBar(session, {
			actionViewItemProvider: action => {
				if (action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(MenuEntryActionViewItem, action);
				} else if (action instanceof SubmenuItemAction) {
					return this.instantiationService.createInstance(SubmenuEntryActionViewItem, action);
				}

				return undefined;
			}
		});

		return { session, name, stateLabel, label, actionBar, elementDisposable: [] };
	}

	renderElement(element: ITreeNode<IDebugSession, FuzzyScore>, _: number, data: ISessionTemplateData): void {
		this.doRenderElement(element.element, createMatches(element.filterData), data);
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<IDebugSession>, FuzzyScore>, _index: number, templateData: ISessionTemplateData): void {
		const lastElement = node.element.elements[node.element.elements.length - 1];
		const matches = createMatches(node.filterData);
		this.doRenderElement(lastElement, matches, templateData);
	}

	private doRenderElement(session: IDebugSession, matches: IMatch[], data: ISessionTemplateData): void {
		data.session.title = localize({ key: 'session', comment: ['Session is a noun'] }, "Session");
		data.label.set(session.getLabel(), matches);
		const thread = session.getAllThreads().find(t => t.stopped);
		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };
		this.callStackItemType.set('session');
		this.callStackItemStopped.set(session.state === State.Stopped);
		this.sessionHasOneThread.set(session.getAllThreads().length === 1);
		this.callStackSessionIsAttach.set(isSessionAttach(session));
		data.elementDisposable.push(createAndFillInActionBarActions(this.menu, { arg: getContextForContributedActions(session), shouldForwardArgs: true }, result, 'inline'));

		data.actionBar.clear();
		data.actionBar.push(primary, { icon: true, label: false });
		data.stateLabel.style.display = '';

		if (thread && thread.stoppedDetails) {
			data.stateLabel.textContent = thread.stateLabel;
			if (thread.stoppedDetails.text) {
				data.session.title = thread.stoppedDetails.text;
			}
		} else {
			data.stateLabel.textContent = localize({ key: 'running', comment: ['indicates state'] }, "Running");
		}
	}

	disposeTemplate(templateData: ISessionTemplateData): void {
		templateData.actionBar.dispose();
	}

	disposeElement(_element: ITreeNode<IDebugSession, FuzzyScore>, _: number, templateData: ISessionTemplateData): void {
		dispose(templateData.elementDisposable);
	}
}

class ThreadsRenderer implements ICompressibleTreeRenderer<IThread, FuzzyScore, IThreadTemplateData> {
	static readonly ID = 'thread';

	constructor(
		private menu: IMenu,
		private callStackItemType: IContextKey<string>,
		private callStackItemStopped: IContextKey<boolean>
	) { }

	get templateId(): string {
		return ThreadsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IThreadTemplateData {
		const thread = dom.append(container, $('.thread'));
		const name = dom.append(thread, $('.name'));
		const stateLabel = dom.append(thread, $('span.state.label.monaco-count-badge.long'));
		const label = new HighlightedLabel(name, false);
		const actionBar = new ActionBar(thread);
		const elementDisposable: IDisposable[] = [];

		return { thread, name, stateLabel, label, actionBar, elementDisposable };
	}

	renderElement(element: ITreeNode<IThread, FuzzyScore>, _index: number, data: IThreadTemplateData): void {
		const thread = element.element;
		data.thread.title = localize('thread', "Thread");
		data.label.set(thread.name, createMatches(element.filterData));
		data.stateLabel.textContent = thread.stateLabel;

		data.actionBar.clear();
		this.callStackItemType.set('thread');
		this.callStackItemStopped.set(thread.stopped);
		const primary: IAction[] = [];
		const result = { primary, secondary: [] };
		data.elementDisposable.push(createAndFillInActionBarActions(this.menu, { arg: getContextForContributedActions(thread), shouldForwardArgs: true }, result, 'inline'));
		data.actionBar.push(primary, { icon: true, label: false });
	}

	renderCompressedElements(_node: ITreeNode<ICompressedTreeNode<IThread>, FuzzyScore>, _index: number, _templateData: IThreadTemplateData, _height: number | undefined): void {
		throw new Error('Method not implemented.');
	}

	disposeElement(_element: any, _index: number, templateData: IThreadTemplateData): void {
		dispose(templateData.elementDisposable);
	}

	disposeTemplate(templateData: IThreadTemplateData): void {
		templateData.actionBar.dispose();
	}
}

class StackFramesRenderer implements ICompressibleTreeRenderer<IStackFrame, FuzzyScore, IStackFrameTemplateData> {
	static readonly ID = 'stackFrame';

	constructor(
		private callStackItemType: IContextKey<string>,
		@ILabelService private readonly labelService: ILabelService,
		@INotificationService private readonly notificationService: INotificationService,
	) { }

	get templateId(): string {
		return StackFramesRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IStackFrameTemplateData {
		const stackFrame = dom.append(container, $('.stack-frame'));
		const labelDiv = dom.append(stackFrame, $('span.label.expression'));
		const file = dom.append(stackFrame, $('.file'));
		const fileName = dom.append(file, $('span.file-name'));
		const wrapper = dom.append(file, $('span.line-number-wrapper'));
		const lineNumber = dom.append(wrapper, $('span.line-number.monaco-count-badge'));
		const label = new HighlightedLabel(labelDiv, false);
		const actionBar = new ActionBar(stackFrame);

		return { file, fileName, label, lineNumber, stackFrame, actionBar };
	}

	renderElement(element: ITreeNode<IStackFrame, FuzzyScore>, index: number, data: IStackFrameTemplateData): void {
		const stackFrame = element.element;
		data.stackFrame.classList.toggle('disabled', !stackFrame.source || !stackFrame.source.available || isDeemphasized(stackFrame));
		data.stackFrame.classList.toggle('label', stackFrame.presentationHint === 'label');
		data.stackFrame.classList.toggle('subtle', stackFrame.presentationHint === 'subtle');
		const hasActions = !!stackFrame.thread.session.capabilities.supportsRestartFrame && stackFrame.presentationHint !== 'label' && stackFrame.presentationHint !== 'subtle' && stackFrame.canRestart;
		data.stackFrame.classList.toggle('has-actions', hasActions);

		data.file.title = stackFrame.source.inMemory ? stackFrame.source.uri.path : this.labelService.getUriLabel(stackFrame.source.uri);
		if (stackFrame.source.raw.origin) {
			data.file.title += `\n${stackFrame.source.raw.origin}`;
		}
		data.label.set(stackFrame.name, createMatches(element.filterData), stackFrame.name);
		data.fileName.textContent = getSpecificSourceName(stackFrame);
		if (stackFrame.range.startLineNumber !== undefined) {
			data.lineNumber.textContent = `${stackFrame.range.startLineNumber}`;
			if (stackFrame.range.startColumn) {
				data.lineNumber.textContent += `:${stackFrame.range.startColumn}`;
			}
			data.lineNumber.classList.remove('unavailable');
		} else {
			data.lineNumber.classList.add('unavailable');
		}

		data.actionBar.clear();
		this.callStackItemType.set('stackFrame');
		if (hasActions) {
			const action = new Action('debug.callStack.restartFrame', localize('restartFrame', "Restart Frame"), ThemeIcon.asClassName(icons.debugRestartFrame), true, async () => {
				try {
					await stackFrame.restart();
				} catch (e) {
					this.notificationService.error(e);
				}
			});
			data.actionBar.push(action, { icon: true, label: false });
		}
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<IStackFrame>, FuzzyScore>, index: number, templateData: IStackFrameTemplateData, height: number | undefined): void {
		throw new Error('Method not implemented.');
	}

	disposeTemplate(templateData: IStackFrameTemplateData): void {
		templateData.actionBar.dispose();
	}
}

class ErrorsRenderer implements ICompressibleTreeRenderer<string, FuzzyScore, IErrorTemplateData> {
	static readonly ID = 'error';

	get templateId(): string {
		return ErrorsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IErrorTemplateData {
		const label = dom.append(container, $('.error'));

		return { label };
	}

	renderElement(element: ITreeNode<string, FuzzyScore>, index: number, data: IErrorTemplateData): void {
		const error = element.element;
		data.label.textContent = error;
		data.label.title = error;
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<string>, FuzzyScore>, index: number, templateData: IErrorTemplateData, height: number | undefined): void {
		throw new Error('Method not implemented.');
	}

	disposeTemplate(templateData: IErrorTemplateData): void {
		// noop
	}
}

class LoadAllRenderer implements ICompressibleTreeRenderer<ThreadAndSessionIds, FuzzyScore, ILabelTemplateData> {
	static readonly ID = 'loadAll';
	static readonly LABEL = localize('loadAllStackFrames', "Load All Stack Frames");

	constructor(private readonly themeService: IThemeService) { }

	get templateId(): string {
		return LoadAllRenderer.ID;
	}

	renderTemplate(container: HTMLElement): ILabelTemplateData {
		const label = dom.append(container, $('.load-all'));
		const toDispose = attachStylerCallback(this.themeService, { textLinkForeground }, colors => {
			if (colors.textLinkForeground) {
				label.style.color = colors.textLinkForeground.toString();
			}
		});

		return { label, toDispose };
	}

	renderElement(element: ITreeNode<ThreadAndSessionIds, FuzzyScore>, index: number, data: ILabelTemplateData): void {
		data.label.textContent = LoadAllRenderer.LABEL;
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<ThreadAndSessionIds>, FuzzyScore>, index: number, templateData: ILabelTemplateData, height: number | undefined): void {
		throw new Error('Method not implemented.');
	}

	disposeTemplate(templateData: ILabelTemplateData): void {
		templateData.toDispose.dispose();
	}
}

class ShowMoreRenderer implements ICompressibleTreeRenderer<IStackFrame[], FuzzyScore, ILabelTemplateData> {
	static readonly ID = 'showMore';

	constructor(private readonly themeService: IThemeService) { }


	get templateId(): string {
		return ShowMoreRenderer.ID;
	}

	renderTemplate(container: HTMLElement): ILabelTemplateData {
		const label = dom.append(container, $('.show-more'));
		const toDispose = attachStylerCallback(this.themeService, { textLinkForeground }, colors => {
			if (colors.textLinkForeground) {
				label.style.color = colors.textLinkForeground.toString();
			}
		});

		return { label, toDispose };
	}

	renderElement(element: ITreeNode<IStackFrame[], FuzzyScore>, index: number, data: ILabelTemplateData): void {
		const stackFrames = element.element;
		if (stackFrames.every(sf => !!(sf.source && sf.source.origin && sf.source.origin === stackFrames[0].source.origin))) {
			data.label.textContent = localize('showMoreAndOrigin', "Show {0} More: {1}", stackFrames.length, stackFrames[0].source.origin);
		} else {
			data.label.textContent = localize('showMoreStackFrames', "Show {0} More Stack Frames", stackFrames.length);
		}
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<IStackFrame[]>, FuzzyScore>, index: number, templateData: ILabelTemplateData, height: number | undefined): void {
		throw new Error('Method not implemented.');
	}

	disposeTemplate(templateData: ILabelTemplateData): void {
		templateData.toDispose.dispose();
	}
}

class CallStackDelegate implements IListVirtualDelegate<CallStackItem> {

	getHeight(element: CallStackItem): number {
		if (element instanceof StackFrame && element.presentationHint === 'label') {
			return 16;
		}
		if (element instanceof ThreadAndSessionIds || element instanceof Array) {
			return 16;
		}

		return 22;
	}

	getTemplateId(element: CallStackItem): string {
		if (isDebugSession(element)) {
			return SessionsRenderer.ID;
		}
		if (element instanceof Thread) {
			return ThreadsRenderer.ID;
		}
		if (element instanceof StackFrame) {
			return StackFramesRenderer.ID;
		}
		if (typeof element === 'string') {
			return ErrorsRenderer.ID;
		}
		if (element instanceof ThreadAndSessionIds) {
			return LoadAllRenderer.ID;
		}

		// element instanceof Array
		return ShowMoreRenderer.ID;
	}
}

function isDebugModel(obj: any): obj is IDebugModel {
	return typeof obj.getSessions === 'function';
}

function isDebugSession(obj: any): obj is IDebugSession {
	return obj && typeof obj.getAllThreads === 'function';
}

function isDeemphasized(frame: IStackFrame): boolean {
	return frame.source.presentationHint === 'deemphasize' || frame.presentationHint === 'deemphasize';
}

class CallStackDataSource implements IAsyncDataSource<IDebugModel, CallStackItem> {
	deemphasizedStackFramesToShow: IStackFrame[] = [];

	constructor(private debugService: IDebugService) { }

	hasChildren(element: IDebugModel | CallStackItem): boolean {
		if (isDebugSession(element)) {
			const threads = element.getAllThreads();
			return (threads.length > 1) || (threads.length === 1 && threads[0].stopped) || !!(this.debugService.getModel().getSessions().find(s => s.parentSession === element));
		}

		return isDebugModel(element) || (element instanceof Thread && element.stopped);
	}

	async getChildren(element: IDebugModel | CallStackItem): Promise<CallStackItem[]> {
		if (isDebugModel(element)) {
			const sessions = element.getSessions();
			if (sessions.length === 0) {
				return Promise.resolve([]);
			}
			if (sessions.length > 1 || this.debugService.getViewModel().isMultiSessionView()) {
				return Promise.resolve(sessions.filter(s => !s.parentSession));
			}

			const threads = sessions[0].getAllThreads();
			// Only show the threads in the call stack if there is more than 1 thread.
			return threads.length === 1 ? this.getThreadChildren(<Thread>threads[0]) : Promise.resolve(threads);
		} else if (isDebugSession(element)) {
			const childSessions = this.debugService.getModel().getSessions().filter(s => s.parentSession === element);
			const threads: CallStackItem[] = element.getAllThreads();
			if (threads.length === 1) {
				// Do not show thread when there is only one to be compact.
				const children = await this.getThreadChildren(<Thread>threads[0]);
				return children.concat(childSessions);
			}

			return Promise.resolve(threads.concat(childSessions));
		} else {
			return this.getThreadChildren(<Thread>element);
		}
	}

	private getThreadChildren(thread: Thread): Promise<CallStackItem[]> {
		return this.getThreadCallstack(thread).then(children => {
			// Check if some stack frames should be hidden under a parent element since they are deemphasized
			const result: CallStackItem[] = [];
			children.forEach((child, index) => {
				if (child instanceof StackFrame && child.source && isDeemphasized(child)) {
					// Check if the user clicked to show the deemphasized source
					if (this.deemphasizedStackFramesToShow.indexOf(child) === -1) {
						if (result.length) {
							const last = result[result.length - 1];
							if (last instanceof Array) {
								// Collect all the stackframes that will be "collapsed"
								last.push(child);
								return;
							}
						}

						const nextChild = index < children.length - 1 ? children[index + 1] : undefined;
						if (nextChild instanceof StackFrame && nextChild.source && isDeemphasized(nextChild)) {
							// Start collecting stackframes that will be "collapsed"
							result.push([child]);
							return;
						}
					}
				}

				result.push(child);
			});

			return result;
		});
	}

	private async getThreadCallstack(thread: Thread): Promise<Array<IStackFrame | string | ThreadAndSessionIds>> {
		let callStack: any[] = thread.getCallStack();
		if (!callStack || !callStack.length) {
			await thread.fetchCallStack();
			callStack = thread.getCallStack();
		}

		if (callStack.length === 1 && thread.session.capabilities.supportsDelayedStackTraceLoading && thread.stoppedDetails && thread.stoppedDetails.totalFrames && thread.stoppedDetails.totalFrames > 1) {
			// To reduce flashing of the call stack view simply append the stale call stack
			// once we have the correct data the tree will refresh and we will no longer display it.
			callStack = callStack.concat(thread.getStaleCallStack().slice(1));
		}

		if (thread.stoppedDetails && thread.stoppedDetails.framesErrorMessage) {
			callStack = callStack.concat([thread.stoppedDetails.framesErrorMessage]);
		}
		if (!thread.reachedEndOfCallStack && thread.stoppedDetails) {
			callStack = callStack.concat([new ThreadAndSessionIds(thread.session.getId(), thread.threadId)]);
		}

		return callStack;
	}
}

class CallStackAccessibilityProvider implements IListAccessibilityProvider<CallStackItem> {

	getWidgetAriaLabel(): string {
		return localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'callStackAriaLabel' }, "Debug Call Stack");
	}

	getAriaLabel(element: CallStackItem): string {
		if (element instanceof Thread) {
			return localize({ key: 'threadAriaLabel', comment: ['Placeholders stand for the thread name and the thread state.For example "Thread 1" and "Stopped'] }, "Thread {0} {1}", element.name, element.stateLabel);
		}
		if (element instanceof StackFrame) {
			return localize('stackFrameAriaLabel', "Stack Frame {0}, line {1}, {2}", element.name, element.range.startLineNumber, getSpecificSourceName(element));
		}
		if (isDebugSession(element)) {
			const thread = element.getAllThreads().find(t => t.stopped);
			const state = thread ? thread.stateLabel : localize({ key: 'running', comment: ['indicates state'] }, "Running");
			return localize({ key: 'sessionLabel', comment: ['Placeholders stand for the session name and the session state. For example "Launch Program" and "Running"'] }, "Session {0} {1}", element.getLabel(), state);
		}
		if (typeof element === 'string') {
			return element;
		}
		if (element instanceof Array) {
			return localize('showMoreStackFrames', "Show {0} More Stack Frames", element.length);
		}

		// element instanceof ThreadAndSessionIds
		return LoadAllRenderer.LABEL;
	}
}

class CallStackCompressionDelegate implements ITreeCompressionDelegate<CallStackItem> {

	constructor(private readonly debugService: IDebugService) { }

	isIncompressible(stat: CallStackItem): boolean {
		if (isDebugSession(stat)) {
			if (stat.compact) {
				return false;
			}
			const sessions = this.debugService.getModel().getSessions();
			if (sessions.some(s => s.parentSession === stat && s.compact)) {
				return false;
			}

			return true;
		}

		return true;
	}
}

registerAction2(class Collapse extends ViewAction<CallStackView> {
	constructor() {
		super({
			id: 'callStack.collapse',
			viewId: CALLSTACK_VIEW_ID,
			title: localize('collapse', "Collapse All"),
			f1: false,
			icon: Codicon.collapseAll,
			precondition: CONTEXT_DEBUG_STATE.isEqualTo(getStateLabel(State.Stopped)),
			menu: {
				id: MenuId.ViewTitle,
				order: 10,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', CALLSTACK_VIEW_ID)
			}
		});
	}

	runInView(_accessor: ServicesAccessor, view: CallStackView) {
		view.collapseAll();
	}
});

function registerCallStackInlineMenuItem(id: string, title: string, icon: Icon, when: ContextKeyExpression, order: number, precondition?: ContextKeyExpression): void {
	MenuRegistry.appendMenuItem(MenuId.DebugCallStackContext, {
		group: 'inline',
		order,
		when,
		command: { id, title, icon, precondition }
	});
}

const threadOrSessionWithOneThread = ContextKeyExpr.or(CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), ContextKeyExpr.and(CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'), CONTEXT_CALLSTACK_SESSION_HAS_ONE_THREAD))!;
registerCallStackInlineMenuItem(PAUSE_ID, PAUSE_LABEL, icons.debugPause, ContextKeyExpr.and(threadOrSessionWithOneThread, CONTEXT_CALLSTACK_ITEM_STOPPED.toNegated())!, 10);
registerCallStackInlineMenuItem(CONTINUE_ID, CONTINUE_LABEL, icons.debugContinue, ContextKeyExpr.and(threadOrSessionWithOneThread, CONTEXT_CALLSTACK_ITEM_STOPPED)!, 10);
registerCallStackInlineMenuItem(STEP_OVER_ID, STEP_OVER_LABEL, icons.debugStepOver, threadOrSessionWithOneThread, 20, CONTEXT_CALLSTACK_ITEM_STOPPED);
registerCallStackInlineMenuItem(STEP_INTO_ID, STEP_INTO_LABEL, icons.debugStepInto, threadOrSessionWithOneThread, 30, CONTEXT_CALLSTACK_ITEM_STOPPED);
registerCallStackInlineMenuItem(STEP_OUT_ID, STEP_OUT_LABEL, icons.debugStepOut, threadOrSessionWithOneThread, 40, CONTEXT_CALLSTACK_ITEM_STOPPED);
registerCallStackInlineMenuItem(RESTART_SESSION_ID, RESTART_LABEL, icons.debugRestart, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'), 50);
registerCallStackInlineMenuItem(STOP_ID, STOP_LABEL, icons.debugStop, ContextKeyExpr.and(CONTEXT_CALLSTACK_SESSION_IS_ATTACH.toNegated(), CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'))!, 60);
registerCallStackInlineMenuItem(DISCONNECT_ID, DISCONNECT_LABEL, icons.debugDisconnect, ContextKeyExpr.and(CONTEXT_CALLSTACK_SESSION_IS_ATTACH, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'))!, 60);
