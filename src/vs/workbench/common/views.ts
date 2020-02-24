/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Command } from 'vs/editor/common/modes';
import { UriComponents, URI } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { ContextKeyExpr, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { localize } from 'vs/nls';
import { IViewlet } from 'vs/workbench/common/viewlet';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { values, keys, getOrSet } from 'vs/base/common/map';
import { Registry } from 'vs/platform/registry/common/platform';
import { IKeybindings } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IAction, IActionViewItem } from 'vs/base/common/actions';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { flatten } from 'vs/base/common/arrays';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { SetMap } from 'vs/base/common/collections';

export const TEST_VIEW_CONTAINER_ID = 'workbench.view.extension.test';

export namespace Extensions {
	export const ViewContainersRegistry = 'workbench.registry.view.containers';
	export const ViewsRegistry = 'workbench.registry.view';
}

export enum ViewContainerLocation {
	Sidebar,
	Panel
}

export interface IViewContainerDescriptor {

	readonly id: string;

	readonly name: string;

	readonly ctorDescriptor: SyncDescriptor<IViewPaneContainer>;

	readonly icon?: string | URI;

	readonly order?: number;

	readonly focusCommand?: { id: string, keybindings?: IKeybindings };

	readonly viewOrderDelegate?: ViewOrderDelegate;

	readonly hideIfEmpty?: boolean;

	readonly extensionId?: ExtensionIdentifier;

}

export interface IViewContainersRegistry {
	/**
	 * An event that is triggered when a view container is registered.
	 */
	readonly onDidRegister: Event<{ viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation }>;

	/**
	 * An event that is triggered when a view container is deregistered.
	 */
	readonly onDidDeregister: Event<{ viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation }>;

	/**
	 * All registered view containers
	 */
	readonly all: ViewContainer[];

	/**
	 * Registers a view container to given location.
	 * No op if a view container is already registered.
	 *
	 * @param viewContainerDescriptor descriptor of view container
	 * @param location location of the view container
	 *
	 * @returns the registered ViewContainer.
	 */
	registerViewContainer(viewContainerDescriptor: IViewContainerDescriptor, location: ViewContainerLocation): ViewContainer;

	/**
	 * Deregisters the given view container
	 * No op if the view container is not registered
	 */
	deregisterViewContainer(viewContainer: ViewContainer): void;

	/**
	 * Returns the view container with given id.
	 *
	 * @returns the view container with given id.
	 */
	get(id: string): ViewContainer | undefined;

	/**
	 * Returns all view containers in the given location
	 */
	getViewContainers(location: ViewContainerLocation): ViewContainer[];

	/**
	 * Returns the view container location
	 */
	getViewContainerLocation(container: ViewContainer): ViewContainerLocation;
}

interface ViewOrderDelegate {
	getOrder(group?: string): number | undefined;
}

export interface ViewContainer extends IViewContainerDescriptor { }

class ViewContainersRegistryImpl extends Disposable implements IViewContainersRegistry {

	private readonly _onDidRegister = this._register(new Emitter<{ viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation }>());
	readonly onDidRegister: Event<{ viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation }> = this._onDidRegister.event;

	private readonly _onDidDeregister = this._register(new Emitter<{ viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation }>());
	readonly onDidDeregister: Event<{ viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation }> = this._onDidDeregister.event;

	private viewContainers: Map<ViewContainerLocation, ViewContainer[]> = new Map<ViewContainerLocation, ViewContainer[]>();

	get all(): ViewContainer[] {
		return flatten(values(this.viewContainers));
	}

	registerViewContainer(viewContainerDescriptor: IViewContainerDescriptor, viewContainerLocation: ViewContainerLocation): ViewContainer {
		const existing = this.get(viewContainerDescriptor.id);
		if (existing) {
			return existing;
		}

		const viewContainer: ViewContainer = { ...viewContainerDescriptor };
		const viewContainers = getOrSet(this.viewContainers, viewContainerLocation, []);
		viewContainers.push(viewContainer);
		this._onDidRegister.fire({ viewContainer, viewContainerLocation });
		return viewContainer;
	}

	deregisterViewContainer(viewContainer: ViewContainer): void {
		for (const viewContainerLocation of keys(this.viewContainers)) {
			const viewContainers = this.viewContainers.get(viewContainerLocation)!;
			const index = viewContainers?.indexOf(viewContainer);
			if (index !== -1) {
				viewContainers?.splice(index, 1);
				if (viewContainers.length === 0) {
					this.viewContainers.delete(viewContainerLocation);
				}
				this._onDidDeregister.fire({ viewContainer, viewContainerLocation });
				return;
			}
		}
	}

	get(id: string): ViewContainer | undefined {
		return this.all.filter(viewContainer => viewContainer.id === id)[0];
	}

	getViewContainers(location: ViewContainerLocation): ViewContainer[] {
		return [...(this.viewContainers.get(location) || [])];
	}

	getViewContainerLocation(container: ViewContainer): ViewContainerLocation {
		return keys(this.viewContainers).filter(location => this.getViewContainers(location).filter(viewContainer => viewContainer.id === container.id).length > 0)[0];
	}
}

Registry.add(Extensions.ViewContainersRegistry, new ViewContainersRegistryImpl());

export interface IViewDescriptor {

	readonly id: string;

	readonly name: string;

	readonly ctorDescriptor: SyncDescriptor<IView>;

	readonly when?: ContextKeyExpr;

	readonly order?: number;

	readonly weight?: number;

	readonly collapsed?: boolean;

	readonly canToggleVisibility?: boolean;

	readonly canMoveView?: boolean;

	readonly containerIcon?: string | URI;

	// Applies only to newly created views
	readonly hideByDefault?: boolean;

	readonly workspace?: boolean;

	readonly focusCommand?: { id: string, keybindings?: IKeybindings };

	// For contributed remote explorer views
	readonly group?: string;

	readonly remoteAuthority?: string | string[];
}

export interface IViewDescriptorCollection extends IDisposable {
	readonly onDidChangeViews: Event<{ added: IViewDescriptor[], removed: IViewDescriptor[] }>;
	readonly onDidChangeActiveViews: Event<{ added: IViewDescriptor[], removed: IViewDescriptor[] }>;
	readonly activeViewDescriptors: IViewDescriptor[];
	readonly allViewDescriptors: IViewDescriptor[];
}

export interface IViewContentDescriptor {
	readonly content: string;
	readonly when?: ContextKeyExpr | 'default';

	/**
	 * ordered preconditions for each button in the content
	 */
	readonly preconditions?: (ContextKeyExpr | undefined)[];
}

export interface IViewsRegistry {

	readonly onViewsRegistered: Event<{ views: IViewDescriptor[], viewContainer: ViewContainer }>;

	readonly onViewsDeregistered: Event<{ views: IViewDescriptor[], viewContainer: ViewContainer }>;

	readonly onDidChangeContainer: Event<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }>;

	registerViews(views: IViewDescriptor[], viewContainer: ViewContainer): void;

	deregisterViews(views: IViewDescriptor[], viewContainer: ViewContainer): void;

	moveViews(views: IViewDescriptor[], viewContainer: ViewContainer): void;

	getViews(viewContainer: ViewContainer): IViewDescriptor[];

	getView(id: string): IViewDescriptor | null;

	getViewContainer(id: string): ViewContainer | null;

	readonly onDidChangeViewWelcomeContent: Event<string>;
	registerViewWelcomeContent(id: string, viewContent: IViewContentDescriptor): IDisposable;
	getViewWelcomeContent(id: string): IViewContentDescriptor[];
}

function compareViewContentDescriptors(a: IViewContentDescriptor, b: IViewContentDescriptor): number {
	return a.content < b.content ? -1 : 1;
}

class ViewsRegistry extends Disposable implements IViewsRegistry {

	private readonly _onViewsRegistered: Emitter<{ views: IViewDescriptor[], viewContainer: ViewContainer }> = this._register(new Emitter<{ views: IViewDescriptor[], viewContainer: ViewContainer }>());
	readonly onViewsRegistered: Event<{ views: IViewDescriptor[], viewContainer: ViewContainer }> = this._onViewsRegistered.event;

	private readonly _onViewsDeregistered: Emitter<{ views: IViewDescriptor[], viewContainer: ViewContainer }> = this._register(new Emitter<{ views: IViewDescriptor[], viewContainer: ViewContainer }>());
	readonly onViewsDeregistered: Event<{ views: IViewDescriptor[], viewContainer: ViewContainer }> = this._onViewsDeregistered.event;

	private readonly _onDidChangeContainer: Emitter<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }> = this._register(new Emitter<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }>());
	readonly onDidChangeContainer: Event<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }> = this._onDidChangeContainer.event;

	private readonly _onDidChangeViewWelcomeContent: Emitter<string> = this._register(new Emitter<string>());
	readonly onDidChangeViewWelcomeContent: Event<string> = this._onDidChangeViewWelcomeContent.event;

	private _viewContainers: ViewContainer[] = [];
	private _views: Map<ViewContainer, IViewDescriptor[]> = new Map<ViewContainer, IViewDescriptor[]>();
	private _viewWelcomeContents = new SetMap<string, IViewContentDescriptor>();

	registerViews(views: IViewDescriptor[], viewContainer: ViewContainer): void {
		this.addViews(views, viewContainer);
		this._onViewsRegistered.fire({ views: views, viewContainer });
	}

	deregisterViews(viewDescriptors: IViewDescriptor[], viewContainer: ViewContainer): void {
		const views = this.removeViews(viewDescriptors, viewContainer);
		if (views.length) {
			this._onViewsDeregistered.fire({ views, viewContainer });
		}
	}

	moveViews(viewsToMove: IViewDescriptor[], viewContainer: ViewContainer): void {
		keys(this._views).forEach(container => {
			if (container !== viewContainer) {
				const views = this.removeViews(viewsToMove, container);
				if (views.length) {
					this.addViews(views, viewContainer);
					this._onDidChangeContainer.fire({ views, from: container, to: viewContainer });
				}
			}
		});
	}

	getViews(loc: ViewContainer): IViewDescriptor[] {
		return this._views.get(loc) || [];
	}

	getView(id: string): IViewDescriptor | null {
		for (const viewContainer of this._viewContainers) {
			const viewDescriptor = (this._views.get(viewContainer) || []).filter(v => v.id === id)[0];
			if (viewDescriptor) {
				return viewDescriptor;
			}
		}
		return null;
	}

	getViewContainer(viewId: string): ViewContainer | null {
		for (const viewContainer of this._viewContainers) {
			const viewDescriptor = (this._views.get(viewContainer) || []).filter(v => v.id === viewId)[0];
			if (viewDescriptor) {
				return viewContainer;
			}
		}
		return null;
	}

	registerViewWelcomeContent(id: string, viewContent: IViewContentDescriptor): IDisposable {
		this._viewWelcomeContents.add(id, viewContent);
		this._onDidChangeViewWelcomeContent.fire(id);

		return toDisposable(() => {
			this._viewWelcomeContents.delete(id, viewContent);
			this._onDidChangeViewWelcomeContent.fire(id);
		});
	}

	getViewWelcomeContent(id: string): IViewContentDescriptor[] {
		const result: IViewContentDescriptor[] = [];
		result.sort(compareViewContentDescriptors);
		this._viewWelcomeContents.forEach(id, descriptor => result.push(descriptor));
		return result;
	}

	private addViews(viewDescriptors: IViewDescriptor[], viewContainer: ViewContainer): void {
		let views = this._views.get(viewContainer);
		if (!views) {
			views = [];
			this._views.set(viewContainer, views);
			this._viewContainers.push(viewContainer);
		}
		for (const viewDescriptor of viewDescriptors) {
			if (this.getView(viewDescriptor.id) !== null) {
				throw new Error(localize('duplicateId', "A view with id '{0}' is already registered", viewDescriptor.id));
			}
			views.push(viewDescriptor);
		}
	}

	private removeViews(viewDescriptors: IViewDescriptor[], viewContainer: ViewContainer): IViewDescriptor[] {
		const views = this._views.get(viewContainer);
		if (!views) {
			return [];
		}
		const viewsToDeregister: IViewDescriptor[] = [];
		const remaningViews: IViewDescriptor[] = [];
		for (const view of views) {
			if (viewDescriptors.indexOf(view) === -1) {
				remaningViews.push(view);
			} else {
				viewsToDeregister.push(view);
			}
		}
		if (viewsToDeregister.length) {
			if (remaningViews.length) {
				this._views.set(viewContainer, remaningViews);
			} else {
				this._views.delete(viewContainer);
				this._viewContainers.splice(this._viewContainers.indexOf(viewContainer), 1);
			}
		}
		return viewsToDeregister;
	}
}

Registry.add(Extensions.ViewsRegistry, new ViewsRegistry());

export interface IView {

	readonly id: string;

	isVisible(): boolean;

	isBodyVisible(): boolean;

	setExpanded(expanded: boolean): boolean;

}

export interface IViewsViewlet extends IViewlet {

	openView(id: string, focus?: boolean): IView;

}

export const IViewsService = createDecorator<IViewsService>('viewsService');

export interface IViewsService {

	_serviceBrand: undefined;

	readonly onDidChangeViewVisibility: Event<{ id: string, visible: boolean }>;

	isViewVisible(id: string): boolean;

	getActiveViewWithId<T extends IView>(id: string): T | null;

	openView<T extends IView>(id: string, focus?: boolean): Promise<T | null>;

	closeView(id: string): void;

}

/**
 * View Contexts
 */
export const FocusedViewContext = new RawContextKey<string>('focusedView', '');
export function getVisbileViewContextKey(viewId: string): string { return `${viewId}.visible`; }

export const IViewDescriptorService = createDecorator<IViewDescriptorService>('viewDescriptorService');

export interface IViewDescriptorService {

	_serviceBrand: undefined;

	readonly onDidChangeContainer: Event<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }>;
	readonly onDidChangeLocation: Event<{ views: IViewDescriptor[], from: ViewContainerLocation, to: ViewContainerLocation }>;

	moveViewToLocation(view: IViewDescriptor, location: ViewContainerLocation): void;

	moveViewsToContainer(views: IViewDescriptor[], viewContainer: ViewContainer): void;

	getViewDescriptors(container: ViewContainer): IViewDescriptorCollection;

	getViewDescriptor(viewId: string): IViewDescriptor | null;

	getViewContainer(viewId: string): ViewContainer | null;

	getViewContainerLocation(viewContainr: ViewContainer): ViewContainerLocation | null;

	getDefaultContainer(viewId: string): ViewContainer | null;

	getViewLocation(viewId: string): ViewContainerLocation | null;
}

// Custom views

export interface ITreeView extends IDisposable {

	dataProvider: ITreeViewDataProvider | undefined;

	showCollapseAllAction: boolean;

	canSelectMany: boolean;

	message?: string;

	title: string;

	readonly visible: boolean;

	readonly onDidExpandItem: Event<ITreeItem>;

	readonly onDidCollapseItem: Event<ITreeItem>;

	readonly onDidChangeSelection: Event<ITreeItem[]>;

	readonly onDidChangeVisibility: Event<boolean>;

	readonly onDidChangeActions: Event<void>;

	readonly onDidChangeTitle: Event<string>;

	refresh(treeItems?: ITreeItem[]): Promise<void>;

	setVisibility(visible: boolean): void;

	focus(): void;

	layout(height: number, width: number): void;

	getOptimalWidth(): number;

	reveal(item: ITreeItem): Promise<void>;

	expand(itemOrItems: ITreeItem | ITreeItem[]): Promise<void>;

	setSelection(items: ITreeItem[]): void;

	setFocus(item: ITreeItem): void;

	getPrimaryActions(): IAction[];

	getSecondaryActions(): IAction[];
}

export interface IRevealOptions {

	select?: boolean;

	focus?: boolean;

	expand?: boolean | number;

}

export interface ITreeViewDescriptor extends IViewDescriptor {
	treeView: ITreeView;
}

export type TreeViewItemHandleArg = {
	$treeViewId: string,
	$treeItemHandle: string
};

export enum TreeItemCollapsibleState {
	None = 0,
	Collapsed = 1,
	Expanded = 2
}

export interface ITreeItemLabel {

	label: string;

	highlights?: [number, number][];

}

export interface ITreeItem {

	handle: string;

	parentHandle?: string;

	collapsibleState: TreeItemCollapsibleState;

	label?: ITreeItemLabel;

	description?: string | boolean;

	icon?: UriComponents;

	iconDark?: UriComponents;

	themeIcon?: ThemeIcon;

	resourceUri?: UriComponents;

	tooltip?: string;

	contextValue?: any;

	command?: Command;

	children?: ITreeItem[];
}

export interface ITreeViewDataProvider {

	getChildren(element?: ITreeItem): Promise<ITreeItem[]>;

}

export interface IEditableData {
	validationMessage: (value: string) => string | null;
	placeholder?: string | null;
	startingValue?: string | null;
	onFinish: (value: string, success: boolean) => void;
}

export interface IViewPaneContainer {
	onDidAddViews: Event<IView[]>;
	onDidRemoveViews: Event<IView[]>;
	onDidChangeViewVisibility: Event<IView>;

	readonly views: IView[];

	setVisible(visible: boolean): void;
	isVisible(): boolean;
	focus(): void;
	getActions(): IAction[];
	getSecondaryActions(): IAction[];
	getActionViewItem(action: IAction): IActionViewItem | undefined;
	getView(viewId: string): IView | undefined;
	saveState(): void;
}

