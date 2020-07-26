/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction, IActionRunner, ActionRunner, IActionViewItem } from 'vs/base/common/actions';
import { Component } from 'vs/workbench/common/component';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IComposite, ICompositeControl } from 'vs/workbench/common/composite';
import { Event, Emitter } from 'vs/base/common/event';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IConstructorSignature0, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { trackFocus, Dimension } from 'vs/base/browser/dom';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { Disposable } from 'vs/base/common/lifecycle';
import { assertIsDefined } from 'vs/base/common/types';

/**
 * Composites are layed out in the sidebar and panel part of the workbench. At a time only one composite
 * can be open in the sidebar, and only one composite can be open in the panel.
 *
 * Each composite has a minimized representation that is good enough to provide some
 * information about the state of the composite data.
 *
 * The workbench will keep a composite alive after it has been created and show/hide it based on
 * user interaction. The lifecycle of a composite goes in the order create(), setVisible(true|false),
 * layout(), focus(), dispose(). During use of the workbench, a composite will often receive a setVisible,
 * layout and focus call, but only one create and dispose call.
 */
export abstract class Composite extends Component implements IComposite {

	private readonly _onTitleAreaUpdate = this._register(new Emitter<void>());
	readonly onTitleAreaUpdate = this._onTitleAreaUpdate.event;

	private _onDidFocus: Emitter<void> | undefined;
	get onDidFocus(): Event<void> {
		if (!this._onDidFocus) {
			this._onDidFocus = this.registerFocusTrackEvents().onDidFocus;
		}

		return this._onDidFocus.event;
	}

	protected fireOnDidFocus(): void {
		if (this._onDidFocus) {
			this._onDidFocus.fire();
		}
	}

	private _onDidBlur: Emitter<void> | undefined;
	get onDidBlur(): Event<void> {
		if (!this._onDidBlur) {
			this._onDidBlur = this.registerFocusTrackEvents().onDidBlur;
		}

		return this._onDidBlur.event;
	}

	private registerFocusTrackEvents(): { onDidFocus: Emitter<void>, onDidBlur: Emitter<void> } {
		const container = assertIsDefined(this.getContainer());
		const focusTracker = this._register(trackFocus(container));

		const onDidFocus = this._onDidFocus = this._register(new Emitter<void>());
		this._register(focusTracker.onDidFocus(() => onDidFocus.fire()));

		const onDidBlur = this._onDidBlur = this._register(new Emitter<void>());
		this._register(focusTracker.onDidBlur(() => onDidBlur.fire()));

		return { onDidFocus, onDidBlur };
	}

	protected actionRunner: IActionRunner | undefined;

	private visible: boolean;
	private parent: HTMLElement | undefined;

	constructor(
		id: string,
		private _telemetryService: ITelemetryService,
		themeService: IThemeService,
		storageService: IStorageService
	) {
		super(id, themeService, storageService);

		this.visible = false;
	}

	getTitle(): string | undefined {
		return undefined;
	}

	protected get telemetryService(): ITelemetryService {
		return this._telemetryService;
	}

	/**
	 * Note: Clients should not call this method, the workbench calls this
	 * method. Calling it otherwise may result in unexpected behavior.
	 *
	 * Called to create this composite on the provided parent. This method is only
	 * called once during the lifetime of the workbench.
	 * Note that DOM-dependent calculations should be performed from the setVisible()
	 * call. Only then the composite will be part of the DOM.
	 */
	create(parent: HTMLElement): void {
		this.parent = parent;
	}

	updateStyles(): void {
		super.updateStyles();
	}

	/**
	 * Returns the container this composite is being build in.
	 */
	getContainer(): HTMLElement | undefined {
		return this.parent;
	}

	/**
	 * Note: Clients should not call this method, the workbench calls this
	 * method. Calling it otherwise may result in unexpected behavior.
	 *
	 * Called to indicate that the composite has become visible or hidden. This method
	 * is called more than once during workbench lifecycle depending on the user interaction.
	 * The composite will be on-DOM if visible is set to true and off-DOM otherwise.
	 *
	 * Typically this operation should be fast though because setVisible might be called many times during a session.
	 * If there is a long running opertaion it is fine to have it running in the background asyncly and return before.
	 */
	setVisible(visible: boolean): void {
		if (this.visible !== !!visible) {
			this.visible = visible;
		}
	}

	/**
	 * Called when this composite should receive keyboard focus.
	 */
	focus(): void {
		// Subclasses can implement
	}

	/**
	 * Layout the contents of this composite using the provided dimensions.
	 */
	abstract layout(dimension: Dimension): void;

	/**
	 * Returns an array of actions to show in the action bar of the composite.
	 */
	getActions(): ReadonlyArray<IAction> {
		return [];
	}

	/**
	 * Returns an array of actions to show in the action bar of the composite
	 * in a less prominent way then action from getActions.
	 */
	getSecondaryActions(): ReadonlyArray<IAction> {
		return [];
	}

	/**
	 * Returns an array of actions to show in the context menu of the composite
	 */
	getContextMenuActions(): ReadonlyArray<IAction> {
		return [];
	}

	/**
	 * For any of the actions returned by this composite, provide an IActionViewItem in
	 * cases where the implementor of the composite wants to override the presentation
	 * of an action. Returns undefined to indicate that the action is not rendered through
	 * an action item.
	 */
	getActionViewItem(action: IAction): IActionViewItem | undefined {
		return undefined;
	}

	/**
	 * Provide a context to be passed to the toolbar.
	 */
	getActionsContext(): unknown {
		return null;
	}

	/**
	 * Returns the instance of IActionRunner to use with this composite for the
	 * composite tool bar.
	 */
	getActionRunner(): IActionRunner {
		if (!this.actionRunner) {
			this.actionRunner = new ActionRunner();
		}

		return this.actionRunner;
	}

	/**
	 * Method for composite implementors to indicate to the composite container that the title or the actions
	 * of the composite have changed. Calling this method will cause the container to ask for title (getTitle())
	 * and actions (getActions(), getSecondaryActions()) if the composite is visible or the next time the composite
	 * gets visible.
	 */
	protected updateTitleArea(): void {
		this._onTitleAreaUpdate.fire();
	}

	/**
	 * Returns true if this composite is currently visible and false otherwise.
	 */
	isVisible(): boolean {
		return this.visible;
	}

	/**
	 * Returns the underlying composite control or `undefined` if it is not accessible.
	 */
	getControl(): ICompositeControl | undefined {
		return undefined;
	}
}

/**
 * A composite descriptor is a leightweight descriptor of a composite in the workbench.
 */
export abstract class CompositeDescriptor<T extends Composite> {

	constructor(
		private readonly ctor: IConstructorSignature0<T>,
		readonly id: string,
		readonly name: string,
		readonly cssClass?: string,
		readonly order?: number,
		readonly requestedIndex?: number,
		readonly keybindingId?: string,
	) { }

	instantiate(instantiationService: IInstantiationService): T {
		return instantiationService.createInstance(this.ctor);
	}
}

export abstract class CompositeRegistry<T extends Composite> extends Disposable {

	private readonly _onDidRegister = this._register(new Emitter<CompositeDescriptor<T>>());
	readonly onDidRegister = this._onDidRegister.event;

	private readonly _onDidDeregister = this._register(new Emitter<CompositeDescriptor<T>>());
	readonly onDidDeregister = this._onDidDeregister.event;

	private readonly composites: CompositeDescriptor<T>[] = [];

	protected registerComposite(descriptor: CompositeDescriptor<T>): void {
		if (this.compositeById(descriptor.id)) {
			return;
		}

		this.composites.push(descriptor);
		this._onDidRegister.fire(descriptor);
	}

	protected deregisterComposite(id: string): void {
		const descriptor = this.compositeById(id);
		if (!descriptor) {
			return;
		}

		this.composites.splice(this.composites.indexOf(descriptor), 1);
		this._onDidDeregister.fire(descriptor);
	}

	getComposite(id: string): CompositeDescriptor<T> | undefined {
		return this.compositeById(id);
	}

	protected getComposites(): CompositeDescriptor<T>[] {
		return this.composites.slice(0);
	}

	private compositeById(id: string): CompositeDescriptor<T> | undefined {
		return this.composites.find(composite => composite.id === id);
	}
}
