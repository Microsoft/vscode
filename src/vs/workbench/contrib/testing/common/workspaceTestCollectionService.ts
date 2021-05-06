/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { Iterable } from 'vs/base/common/iterator';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceContextService, IWorkspaceFolder, IWorkspaceFoldersChangeEvent } from 'vs/platform/workspace/common/workspace';
import { ExtHostTestingResource } from 'vs/workbench/api/common/extHost.protocol';
import { IncrementalTestCollectionItem, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';
import { IMainThreadTestCollection, ITestService, waitForAllRoots } from 'vs/workbench/contrib/testing/common/testService';

export interface ITestSubscriptionFolder {
	folder: IWorkspaceFolder;
	getChildren(): Iterable<IncrementalTestCollectionItem>;
}

export interface ITestSubscriptionItem extends IncrementalTestCollectionItem {
	root: ITestSubscriptionFolder;
}

export class TestSubscriptionListener extends Disposable {
	private onDiffEmitter = new Emitter<[workspaceFolder: IWorkspaceFolder, diff: TestsDiff]>();
	private onFolderChangeEmitter = new Emitter<IWorkspaceFoldersChangeEvent>();

	public readonly onDiff = this.onDiffEmitter.event;
	public readonly onFolderChange = this.onFolderChangeEmitter.event;

	public get workspaceFolders() {
		return this.subscription.workspaceFolders;
	}

	public get workspaceFolderCollections() {
		return this.subscription.workspaceFolderCollections;
	}

	constructor(public readonly subscription: TestSubscription, public readonly onDispose: () => void) {
		super();
		this._register(toDisposable(onDispose));
	}

	public async waitForAllRoots(token?: CancellationToken) {
		await Promise.all(this.subscription.workspaceFolderCollections.map(([, c]) => waitForAllRoots(c, token)));
	}

	public publishFolderChange(evt: IWorkspaceFoldersChangeEvent) {
		this.onFolderChangeEmitter.fire(evt);
	}

	public publishDiff(folder: IWorkspaceFolder, diff: TestsDiff) {
		this.onDiffEmitter.fire([folder, diff]);
	}
}

/**
 * Maintains an observable set of tests in the core.
 */
export interface IWorkspaceTestCollectionService {
	readonly _serviceBrand: undefined;

	/**
	 * Gets all workspace folders we're listening to.
	 */
	workspaceFolders(): ReadonlyArray<ITestSubscriptionFolder>;

	/**
	 * Adds a listener that receives updates about tests.
	 */
	subscribeToWorkspaceTests(): TestSubscriptionListener;
}

export const IWorkspaceTestCollectionService = createDecorator<IWorkspaceTestCollectionService>('ITestingViewService');

export class WorkspaceTestCollectionService implements IWorkspaceTestCollectionService {
	declare _serviceBrand: undefined;

	private subscription?: TestSubscription;

	public workspaceFolders() {
		return this.subscription?.workspaceFolders || [];
	}

	constructor(@IInstantiationService protected instantiationService: IInstantiationService) { }

	/**
	 * @inheritdoc
	 */
	public subscribeToWorkspaceTests(): TestSubscriptionListener {
		if (!this.subscription) {
			this.subscription = this.instantiationService.createInstance(TestSubscription);
		}

		const listener = new TestSubscriptionListener(this.subscription, () => {
			if (!this.subscription) {
				return;
			}

			this.subscription.removeListener(listener);
			if (this.subscription.listenerCount === 0) {
				this.subscription.dispose();
				this.subscription = undefined;
			}
		});

		this.subscription.addListener(listener);
		return listener;
	}
}


class TestSubscription extends Disposable {
	private listeners = new Set<TestSubscriptionListener>();
	private pendingRootChangeEmitter = new Emitter<number>();
	private busyProvidersChangeEmitter = new Emitter<number>();
	private readonly collectionsForWorkspaces = new Map<string, {
		listener: IDisposable,
		folder: ITestSubscriptionFolder,
		collection: IMainThreadTestCollection,
	}>();

	public readonly onPendingRootProvidersChange = this.pendingRootChangeEmitter.event;
	public readonly onBusyProvidersChange = this.busyProvidersChangeEmitter.event;

	public get busyProviders() {
		let total = 0;
		for (const { collection } of this.collectionsForWorkspaces.values()) {
			total += collection.busyProviders;
		}

		return total;
	}

	public get pendingRootProviders() {
		let total = 0;
		for (const { collection } of this.collectionsForWorkspaces.values()) {
			total += collection.pendingRootProviders;
		}

		return total;
	}

	public get listenerCount() {
		return this.listeners.size;
	}

	public get workspaceFolders() {
		return [...this.collectionsForWorkspaces.values()].map(v => v.folder);
	}

	public get workspaceFolderCollections() {
		return [...this.collectionsForWorkspaces.values()].map(v => [v.folder, v.collection] as const);
	}

	/**
	 * Returns whether there are any subscriptions with non-empty providers.
	 */
	public get isEmpty() {
		for (const { collection } of this.collectionsForWorkspaces.values()) {
			if (Iterable.some(collection.all, t => !!t.parent)) {
				return false;
			}
		}

		return true;
	}

	constructor(
		@IWorkspaceContextService workspaceContext: IWorkspaceContextService,
		@ITestService private readonly testService: ITestService,
	) {
		super();

		this._register(toDisposable(() => {
			for (const { listener } of this.collectionsForWorkspaces.values()) {
				listener.dispose();
			}
		}));

		this._register(workspaceContext.onDidChangeWorkspaceFolders(evt => {
			for (const folder of evt.added) {
				this.subscribeToWorkspace(folder);
			}

			for (const folder of evt.removed) {
				const existing = this.collectionsForWorkspaces.get(folder.uri.toString());
				if (existing) {
					this.collectionsForWorkspaces.delete(folder.uri.toString());
					existing.listener.dispose();
				}
			}

			for (const listener of this.listeners) {
				listener.publishFolderChange(evt);
			}
		}));

		for (const folder of workspaceContext.getWorkspace().folders) {
			this.subscribeToWorkspace(folder);
		}
	}

	public addListener(listener: TestSubscriptionListener) {
		this.listeners.add(listener);
	}

	public removeListener(listener: TestSubscriptionListener) {
		this.listeners.delete(listener);
	}

	private subscribeToWorkspace(folder: IWorkspaceFolder) {
		const folderNode: ITestSubscriptionFolder = {
			folder,
			getChildren: function* () {
				for (const rootId of ref.object.rootIds) {
					const node = ref.object.getNodeById(rootId);
					if (node) {
						yield node;
					}
				}
			},
		};

		const ref = this.testService.subscribeToDiffs(
			ExtHostTestingResource.Workspace,
			folder.uri,
			diff => {
				for (const listener of this.listeners) {
					listener.publishDiff(folder, diff);
				}
			},
		);

		const disposable = new DisposableStore();
		disposable.add(ref);
		disposable.add(ref.object.onBusyProvidersChange(
			() => this.pendingRootChangeEmitter.fire(this.pendingRootProviders)));
		disposable.add(ref.object.onBusyProvidersChange(
			() => this.busyProvidersChangeEmitter.fire(this.busyProviders)));

		this.collectionsForWorkspaces.set(folder.uri.toString(), {
			listener: disposable,
			collection: ref.object,
			folder: folderNode,
		});
	}
}
