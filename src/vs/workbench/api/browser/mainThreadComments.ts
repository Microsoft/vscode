/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { IRange } from 'vs/editor/common/core/range';
import * as modes from 'vs/editor/common/modes';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { ICommentInfo, ICommentService } from 'vs/workbench/contrib/comments/browser/commentService';
import { CommentsPanel } from 'vs/workbench/contrib/comments/browser/commentsView';
import { CommentProviderFeatures, ExtHostCommentsShape, ExtHostContext, IExtHostContext, MainContext, MainThreadCommentsShape, CommentThreadChanges } from '../common/extHost.protocol';
import { COMMENTS_VIEW_ID, COMMENTS_VIEW_TITLE } from 'vs/workbench/contrib/comments/browser/commentsTreeViewer';
import { ViewContainer, IViewContainersRegistry, Extensions as ViewExtensions, ViewContainerLocation, IViewsRegistry, IViewsService, IViewDescriptorService } from 'vs/workbench/common/views';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { localize } from 'vs/nls';


export class MainThreadCommentThread implements modes.CommentThread {
	private _input?: modes.CommentInput;
	get input(): modes.CommentInput | undefined {
		return this._input;
	}

	set input(value: modes.CommentInput | undefined) {
		this._input = value;
		this._onDidChangeInput.fire(value);
	}

	private readonly _onDidChangeInput = new Emitter<modes.CommentInput | undefined>();
	get onDidChangeInput(): Event<modes.CommentInput | undefined> { return this._onDidChangeInput.event; }

	private _label: string | undefined;

	get label(): string | undefined {
		return this._label;
	}

	set label(label: string | undefined) {
		this._label = label;
		this._onDidChangeLabel.fire(this._label);
	}

	private _contextValue: string | undefined;

	get contextValue(): string | undefined {
		return this._contextValue;
	}

	set contextValue(context: string | undefined) {
		this._contextValue = context;
	}

	private readonly _onDidChangeLabel = new Emitter<string | undefined>();
	readonly onDidChangeLabel: Event<string | undefined> = this._onDidChangeLabel.event;

	private _comments: modes.Comment[] | undefined;

	public get comments(): modes.Comment[] | undefined {
		return this._comments;
	}

	public set comments(newComments: modes.Comment[] | undefined) {
		this._comments = newComments;
		this._onDidChangeComments.fire(this._comments);
	}

	private readonly _onDidChangeComments = new Emitter<modes.Comment[] | undefined>();
	get onDidChangeComments(): Event<modes.Comment[] | undefined> { return this._onDidChangeComments.event; }

	set range(range: IRange) {
		this._range = range;
		this._onDidChangeRange.fire(this._range);
	}

	get range(): IRange {
		return this._range;
	}

	private readonly _onDidChangeCanReply = new Emitter<boolean>();
	get onDidChangeCanReply(): Event<boolean> { return this._onDidChangeCanReply.event; }
	set canReply(state: boolean) {
		this._canReply = state;
		this._onDidChangeCanReply.fire(this._canReply);
	}

	get canReply() {
		return this._canReply;
	}

	private readonly _onDidChangeRange = new Emitter<IRange>();
	public onDidChangeRange = this._onDidChangeRange.event;

	private _collapsibleState: modes.CommentThreadCollapsibleState | undefined;
	get collapsibleState() {
		return this._collapsibleState;
	}

	set collapsibleState(newState: modes.CommentThreadCollapsibleState | undefined) {
		this._collapsibleState = newState;
		this._onDidChangeCollasibleState.fire(this._collapsibleState);
	}

	private readonly _onDidChangeCollasibleState = new Emitter<modes.CommentThreadCollapsibleState | undefined>();
	public onDidChangeCollasibleState = this._onDidChangeCollasibleState.event;

	private _isDisposed: boolean;

	get isDisposed(): boolean {
		return this._isDisposed;
	}

	constructor(
		public commentThreadHandle: number,
		public controllerHandle: number,
		public extensionId: string,
		public threadId: string,
		public resource: string,
		private _range: IRange,
		private _canReply: boolean
	) {
		this._isDisposed = false;
	}

	batchUpdate(changes: CommentThreadChanges) {
		const modified = (value: keyof CommentThreadChanges): boolean =>
			Object.prototype.hasOwnProperty.call(changes, value);

		if (modified('range')) { this._range = changes.range!; }
		if (modified('label')) { this._label = changes.label; }
		if (modified('contextValue')) { this._contextValue = changes.contextValue; }
		if (modified('comments')) { this._comments = changes.comments; }
		if (modified('collapseState')) { this._collapsibleState = changes.collapseState; }
		if (modified('canReply')) { this.canReply = changes.canReply!; }
	}

	dispose() {
		this._isDisposed = true;
		this._onDidChangeCollasibleState.dispose();
		this._onDidChangeComments.dispose();
		this._onDidChangeInput.dispose();
		this._onDidChangeLabel.dispose();
		this._onDidChangeRange.dispose();
	}

	toJSON(): any {
		return {
			$mid: 7,
			commentControlHandle: this.controllerHandle,
			commentThreadHandle: this.commentThreadHandle,
		};
	}
}

export class MainThreadCommentController {
	get handle(): number {
		return this._handle;
	}

	get id(): string {
		return this._id;
	}

	get contextValue(): string {
		return this._id;
	}

	get proxy(): ExtHostCommentsShape {
		return this._proxy;
	}

	get label(): string {
		return this._label;
	}

	private _reactions: modes.CommentReaction[] | undefined;

	get reactions() {
		return this._reactions;
	}

	set reactions(reactions: modes.CommentReaction[] | undefined) {
		this._reactions = reactions;
	}

	get options() {
		return this._features.options;
	}

	private readonly _threads: Map<number, MainThreadCommentThread> = new Map<number, MainThreadCommentThread>();
	public activeCommentThread?: MainThreadCommentThread;

	get features(): CommentProviderFeatures {
		return this._features;
	}

	constructor(
		private readonly _proxy: ExtHostCommentsShape,
		private readonly _commentService: ICommentService,
		private readonly _handle: number,
		private readonly _uniqueId: string,
		private readonly _id: string,
		private readonly _label: string,
		private _features: CommentProviderFeatures
	) { }

	updateFeatures(features: CommentProviderFeatures) {
		this._features = features;
	}

	createCommentThread(extensionId: string,
		commentThreadHandle: number,
		threadId: string,
		resource: UriComponents,
		range: IRange,
	): modes.CommentThread {
		let thread = new MainThreadCommentThread(
			commentThreadHandle,
			this.handle,
			extensionId,
			threadId,
			URI.revive(resource).toString(),
			range,
			true
		);

		this._threads.set(commentThreadHandle, thread);

		this._commentService.updateComments(this._uniqueId, {
			added: [thread],
			removed: [],
			changed: []
		});

		return thread;
	}

	updateCommentThread(commentThreadHandle: number,
		threadId: string,
		resource: UriComponents,
		changes: CommentThreadChanges): void {
		let thread = this.getKnownThread(commentThreadHandle);
		thread.batchUpdate(changes);

		this._commentService.updateComments(this._uniqueId, {
			added: [],
			removed: [],
			changed: [thread]
		});
	}

	deleteCommentThread(commentThreadHandle: number) {
		let thread = this.getKnownThread(commentThreadHandle);
		this._threads.delete(commentThreadHandle);

		this._commentService.updateComments(this._uniqueId, {
			added: [],
			removed: [thread],
			changed: []
		});

		thread.dispose();
	}

	deleteCommentThreadMain(commentThreadId: string) {
		this._threads.forEach(thread => {
			if (thread.threadId === commentThreadId) {
				this._proxy.$deleteCommentThread(this._handle, thread.commentThreadHandle);
			}
		});
	}

	updateInput(input: string) {
		let thread = this.activeCommentThread;

		if (thread && thread.input) {
			let commentInput = thread.input;
			commentInput.value = input;
			thread.input = commentInput;
		}
	}

	private getKnownThread(commentThreadHandle: number): MainThreadCommentThread {
		const thread = this._threads.get(commentThreadHandle);
		if (!thread) {
			throw new Error('unknown thread');
		}
		return thread;
	}

	async getDocumentComments(resource: URI, token: CancellationToken) {
		let ret: modes.CommentThread[] = [];
		for (let thread of [...this._threads.keys()]) {
			const commentThread = this._threads.get(thread)!;
			if (commentThread.resource === resource.toString()) {
				ret.push(commentThread);
			}
		}

		let commentingRanges = await this._proxy.$provideCommentingRanges(this.handle, resource, token);

		return <ICommentInfo>{
			owner: this._uniqueId,
			label: this.label,
			threads: ret,
			commentingRanges: {
				resource: resource,
				ranges: commentingRanges || []
			}
		};
	}

	async getCommentingRanges(resource: URI, token: CancellationToken): Promise<IRange[]> {
		let commentingRanges = await this._proxy.$provideCommentingRanges(this.handle, resource, token);
		return commentingRanges || [];
	}

	async toggleReaction(uri: URI, thread: modes.CommentThread, comment: modes.Comment, reaction: modes.CommentReaction, token: CancellationToken): Promise<void> {
		return this._proxy.$toggleReaction(this._handle, thread.commentThreadHandle, uri, comment, reaction);
	}

	getAllComments(): MainThreadCommentThread[] {
		let ret: MainThreadCommentThread[] = [];
		for (let thread of [...this._threads.keys()]) {
			ret.push(this._threads.get(thread)!);
		}

		return ret;
	}

	createCommentThreadTemplate(resource: UriComponents, range: IRange): void {
		this._proxy.$createCommentThreadTemplate(this.handle, resource, range);
	}

	async updateCommentThreadTemplate(threadHandle: number, range: IRange) {
		await this._proxy.$updateCommentThreadTemplate(this.handle, threadHandle, range);
	}

	toJSON(): any {
		return {
			$mid: 6,
			handle: this.handle
		};
	}
}


const commentsViewIcon = registerIcon('comments-view-icon', Codicon.commentDiscussion, localize('commentsViewIcon', 'View icon of the comments view.'));

@extHostNamedCustomer(MainContext.MainThreadComments)
export class MainThreadComments extends Disposable implements MainThreadCommentsShape {
	private readonly _proxy: ExtHostCommentsShape;
	private _documentProviders = new Map<number, IDisposable>();
	private _workspaceProviders = new Map<number, IDisposable>();
	private _handlers = new Map<number, string>();
	private _commentControllers = new Map<number, MainThreadCommentController>();

	private _activeCommentThread?: MainThreadCommentThread;
	private readonly _activeCommentThreadDisposables = this._register(new DisposableStore());

	private _openViewListener: IDisposable | null = null;


	constructor(
		extHostContext: IExtHostContext,
		@ICommentService private readonly _commentService: ICommentService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostComments);

		this._register(this._commentService.onDidChangeActiveCommentThread(async thread => {
			let handle = (thread as MainThreadCommentThread).controllerHandle;
			let controller = this._commentControllers.get(handle);

			if (!controller) {
				return;
			}

			this._activeCommentThreadDisposables.clear();
			this._activeCommentThread = thread as MainThreadCommentThread;
			controller.activeCommentThread = this._activeCommentThread;
		}));
	}

	$registerCommentController(handle: number, id: string, label: string): void {
		const providerId = generateUuid();
		this._handlers.set(handle, providerId);

		const provider = new MainThreadCommentController(this._proxy, this._commentService, handle, providerId, id, label, {});
		this._commentService.registerCommentController(providerId, provider);
		this._commentControllers.set(handle, provider);

		const commentsPanelAlreadyConstructed = !!this._viewDescriptorService.getViewDescriptorById(COMMENTS_VIEW_ID);
		if (!commentsPanelAlreadyConstructed) {
			this.registerView(commentsPanelAlreadyConstructed);
			this.registerViewOpenedListener(commentsPanelAlreadyConstructed);
		}
		this._commentService.setWorkspaceComments(String(handle), []);
	}

	$unregisterCommentController(handle: number): void {
		const providerId = this._handlers.get(handle);
		if (typeof providerId !== 'string') {
			throw new Error('unknown handler');
		}
		this._commentService.unregisterCommentController(providerId);
		this._handlers.delete(handle);
		this._commentControllers.delete(handle);
	}

	$updateCommentControllerFeatures(handle: number, features: CommentProviderFeatures): void {
		let provider = this._commentControllers.get(handle);

		if (!provider) {
			return undefined;
		}

		provider.updateFeatures(features);
	}

	$createCommentThread(handle: number,
		commentThreadHandle: number,
		threadId: string,
		resource: UriComponents,
		range: IRange,
		extensionId: ExtensionIdentifier
	): modes.CommentThread | undefined {
		let provider = this._commentControllers.get(handle);

		if (!provider) {
			return undefined;
		}

		return provider.createCommentThread(extensionId.value, commentThreadHandle, threadId, resource, range);
	}

	$updateCommentThread(handle: number,
		commentThreadHandle: number,
		threadId: string,
		resource: UriComponents,
		changes: CommentThreadChanges): void {
		let provider = this._commentControllers.get(handle);

		if (!provider) {
			return undefined;
		}

		return provider.updateCommentThread(commentThreadHandle, threadId, resource, changes);
	}

	$deleteCommentThread(handle: number, commentThreadHandle: number) {
		let provider = this._commentControllers.get(handle);

		if (!provider) {
			return;
		}

		return provider.deleteCommentThread(commentThreadHandle);
	}

	private registerView(commentsViewAlreadyRegistered: boolean) {
		if (!commentsViewAlreadyRegistered) {
			const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
				id: COMMENTS_VIEW_ID,
				title: COMMENTS_VIEW_TITLE,
				ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [COMMENTS_VIEW_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
				storageId: COMMENTS_VIEW_TITLE,
				hideIfEmpty: true,
				icon: commentsViewIcon,
				order: 10,
			}, ViewContainerLocation.Panel);

			Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
				id: COMMENTS_VIEW_ID,
				name: COMMENTS_VIEW_TITLE,
				canToggleVisibility: false,
				ctorDescriptor: new SyncDescriptor(CommentsPanel),
				canMoveView: true,
				containerIcon: commentsViewIcon,
				focusCommand: {
					id: 'workbench.action.focusCommentsPanel'
				}
			}], VIEW_CONTAINER);
		}
	}

	/**
	 * If the comments view has never been opened, the constructor for it has not yet run so it has
	 * no listeners for comment threads being set or updated. Listen for the view opening for the
	 * first time and send it comments then.
	 */
	private registerViewOpenedListener(commentsPanelAlreadyConstructed: boolean) {
		if (!commentsPanelAlreadyConstructed && !this._openViewListener) {
			this._openViewListener = this._viewsService.onDidChangeViewVisibility(e => {
				if (e.id === COMMENTS_VIEW_ID && e.visible) {
					[...this._commentControllers.keys()].forEach(handle => {
						let threads = this._commentControllers.get(handle)!.getAllComments();

						if (threads.length) {
							const providerId = this.getHandler(handle);
							this._commentService.setWorkspaceComments(providerId, threads);
						}
					});

					if (this._openViewListener) {
						this._openViewListener.dispose();
						this._openViewListener = null;
					}
				}
			});
		}
	}

	private getHandler(handle: number) {
		if (!this._handlers.has(handle)) {
			throw new Error('Unknown handler');
		}
		return this._handlers.get(handle)!;
	}

	$onDidCommentThreadsChange(handle: number, event: modes.CommentThreadChangedEvent) {
		// notify comment service
		const providerId = this.getHandler(handle);
		this._commentService.updateComments(providerId, event);
	}

	override dispose(): void {
		super.dispose();
		this._workspaceProviders.forEach(value => dispose(value));
		this._workspaceProviders.clear();
		this._documentProviders.forEach(value => dispose(value));
		this._documentProviders.clear();
	}
}
