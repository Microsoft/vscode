/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/compositepart';
import { localize } from 'vs/nls';
import { defaultGenerator } from 'vs/base/common/idGenerator';
import { IDisposable, dispose, DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { ActionsOrientation, IActionViewItem, prepareActions } from 'vs/base/browser/ui/actionbar/actionbar';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { IAction, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { Part, IPartOptions } from 'vs/workbench/browser/part';
import { Composite, CompositeRegistry } from 'vs/workbench/browser/composite';
import { IComposite } from 'vs/workbench/common/composite';
import { CompositeProgressIndicator } from 'vs/workbench/services/progress/browser/progressIndicator';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IProgressIndicator, IEditorProgressService } from 'vs/platform/progress/common/progress';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachProgressBarStyler } from 'vs/platform/theme/common/styler';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { Dimension, append, $, hide, show } from 'vs/base/browser/dom';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { assertIsDefined, withNullAsUndefined } from 'vs/base/common/types';

export interface ICompositeTitleLabel {

	/**
	 * Asks to update the title for the composite with the given ID.
	 */
	updateTitle(id: string, title: string, keybinding?: string): void;

	/**
	 * Called when theming information changes.
	 */
	updateStyles(): void;
}

interface CompositeItem {
	composite: Composite;
	disposable: IDisposable;
	progress: IProgressIndicator;
}

export abstract class CompositePart<T extends Composite> extends Part {

	protected readonly onDidCompositeOpen = this._register(new Emitter<{ composite: IComposite, focus: boolean }>());
	protected readonly onDidCompositeClose = this._register(new Emitter<IComposite>());

	protected toolBar: ToolBar | undefined;
	protected titleLabelElement: HTMLElement | undefined;

	private readonly mapCompositeToCompositeContainer = new Map<string, HTMLElement>();
	private readonly mapActionsBindingToComposite = new Map<string, () => void>();
	private activeComposite: Composite | undefined;
	private lastActiveCompositeId: string;
	private readonly instantiatedCompositeItems = new Map<string, CompositeItem>();
	private titleLabel: ICompositeTitleLabel | undefined;
	private progressBar: ProgressBar | undefined;
	private contentAreaSize: Dimension | undefined;
	private readonly telemetryActionsListener = this._register(new MutableDisposable());
	private currentCompositeOpenToken: string | undefined;

	constructor(
		private readonly notificationService: INotificationService,
		protected readonly storageService: IStorageService,
		private readonly telemetryService: ITelemetryService,
		protected readonly contextMenuService: IContextMenuService,
		layoutService: IWorkbenchLayoutService,
		protected readonly keybindingService: IKeybindingService,
		protected readonly instantiationService: IInstantiationService,
		themeService: IThemeService,
		protected readonly registry: CompositeRegistry<T>,
		private readonly activeCompositeSettingsKey: string,
		private readonly defaultCompositeId: string,
		private readonly nameForTelemetry: string,
		private readonly compositeCSSClass: string,
		private readonly titleForegroundColor: string | undefined,
		id: string,
		options: IPartOptions
	) {
		super(id, options, themeService, storageService, layoutService);

		this.lastActiveCompositeId = storageService.get(activeCompositeSettingsKey, StorageScope.WORKSPACE, this.defaultCompositeId);
	}

	protected openComposite(id: string, focus?: boolean): Composite | undefined {

		// Check if composite already visible and just focus in that case
		if (this.activeComposite?.getId() === id) {
			if (focus) {
				this.activeComposite.focus();
			}

			// Fullfill promise with composite that is being opened
			return this.activeComposite;
		}

		// We cannot open the composite if we have not been created yet
		if (!this.element) {
			return;
		}

		// Open
		return this.doOpenComposite(id, focus);
	}

	private doOpenComposite(id: string, focus: boolean = false): Composite | undefined {

		// Use a generated token to avoid race conditions from long running promises
		const currentCompositeOpenToken = defaultGenerator.nextId();
		this.currentCompositeOpenToken = currentCompositeOpenToken;

		// Hide current
		if (this.activeComposite) {
			this.hideActiveComposite();
		}

		// Update Title
		this.updateTitle(id);

		// Create composite
		const composite = this.createComposite(id, true);

		// Check if another composite opened meanwhile and return in that case
		if ((this.currentCompositeOpenToken !== currentCompositeOpenToken) || (this.activeComposite && this.activeComposite.getId() !== composite.getId())) {
			return undefined;
		}

		// Check if composite already visible and just focus in that case
		if (this.activeComposite?.getId() === composite.getId()) {
			if (focus) {
				composite.focus();
			}

			this.onDidCompositeOpen.fire({ composite, focus });
			return composite;
		}

		// Show Composite and Focus
		this.showComposite(composite);
		if (focus) {
			composite.focus();
		}

		// Return with the composite that is being opened
		if (composite) {
			this.onDidCompositeOpen.fire({ composite, focus });
		}

		return composite;
	}

	protected createComposite(id: string, isActive?: boolean): Composite {

		// Check if composite is already created
		const compositeItem = this.instantiatedCompositeItems.get(id);
		if (compositeItem) {
			return compositeItem.composite;
		}

		// Instantiate composite from registry otherwise
		const compositeDescriptor = this.registry.getComposite(id);
		if (compositeDescriptor) {
			const compositeProgressIndicator = this.instantiationService.createInstance(CompositeProgressIndicator, assertIsDefined(this.progressBar), compositeDescriptor.id, !!isActive);
			const compositeInstantiationService = this.instantiationService.createChild(new ServiceCollection(
				[IEditorProgressService, compositeProgressIndicator] // provide the editor progress service for any editors instantiated within the composite
			));

			const composite = compositeDescriptor.instantiate(compositeInstantiationService);
			const disposable = new DisposableStore();

			// Remember as Instantiated
			this.instantiatedCompositeItems.set(id, { composite, disposable, progress: compositeProgressIndicator });

			// Register to title area update events from the composite
			disposable.add(composite.onTitleAreaUpdate(() => this.onTitleAreaUpdate(composite.getId()), this));

			return composite;
		}

		throw new Error(`Unable to find composite with id ${id}`);
	}

	protected showComposite(composite: Composite): void {

		// Remember Composite
		this.activeComposite = composite;

		// Store in preferences
		const id = this.activeComposite.getId();
		if (id !== this.defaultCompositeId) {
			this.storageService.store(this.activeCompositeSettingsKey, id, StorageScope.WORKSPACE, StorageTarget.USER);
		} else {
			this.storageService.remove(this.activeCompositeSettingsKey, StorageScope.WORKSPACE);
		}

		// Remember
		this.lastActiveCompositeId = this.activeComposite.getId();

		// Composites created for the first time
		let compositeContainer = this.mapCompositeToCompositeContainer.get(composite.getId());
		if (!compositeContainer) {

			// Build Container off-DOM
			compositeContainer = $('.composite');
			compositeContainer.classList.add(...this.compositeCSSClass.split(' '));
			compositeContainer.id = composite.getId();

			composite.create(compositeContainer);
			composite.updateStyles();

			// Remember composite container
			this.mapCompositeToCompositeContainer.set(composite.getId(), compositeContainer);
		}

		// Fill Content and Actions
		// Make sure that the user meanwhile did not open another composite or closed the part containing the composite
		if (!this.activeComposite || composite.getId() !== this.activeComposite.getId()) {
			return undefined;
		}

		// Take Composite on-DOM and show
		const contentArea = this.getContentArea();
		if (contentArea) {
			contentArea.appendChild(compositeContainer);
		}
		show(compositeContainer);

		// Setup action runner
		const toolBar = assertIsDefined(this.toolBar);
		toolBar.actionRunner = composite.getActionRunner();

		// Update title with composite title if it differs from descriptor
		const descriptor = this.registry.getComposite(composite.getId());
		if (descriptor && descriptor.name !== composite.getTitle()) {
			this.updateTitle(composite.getId(), composite.getTitle());
		}

		// Handle Composite Actions
		let actionsBinding = this.mapActionsBindingToComposite.get(composite.getId());
		if (!actionsBinding) {
			actionsBinding = this.collectCompositeActions(composite);
			this.mapActionsBindingToComposite.set(composite.getId(), actionsBinding);
		}
		actionsBinding();

		// Action Run Handling
		this.telemetryActionsListener.value = toolBar.actionRunner.onDidRun(e => {

			// Check for Error
			if (e.error && !isPromiseCanceledError(e.error)) {
				this.notificationService.error(e.error);
			}

			// Log in telemetry
			this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: e.action.id, from: this.nameForTelemetry });
		});

		// Indicate to composite that it is now visible
		composite.setVisible(true);

		// Make sure that the user meanwhile did not open another composite or closed the part containing the composite
		if (!this.activeComposite || composite.getId() !== this.activeComposite.getId()) {
			return;
		}

		// Make sure the composite is layed out
		if (this.contentAreaSize) {
			composite.layout(this.contentAreaSize);
		}
	}

	protected onTitleAreaUpdate(compositeId: string): void {
		// Title
		const composite = this.instantiatedCompositeItems.get(compositeId);
		if (composite) {
			this.updateTitle(compositeId, composite.composite.getTitle());
		}

		// Active Composite
		if (this.activeComposite?.getId() === compositeId) {
			// Actions
			const actionsBinding = this.collectCompositeActions(this.activeComposite);
			this.mapActionsBindingToComposite.set(this.activeComposite.getId(), actionsBinding);
			actionsBinding();
		}

		// Otherwise invalidate actions binding for next time when the composite becomes visible
		else {
			this.mapActionsBindingToComposite.delete(compositeId);
		}
	}

	private updateTitle(compositeId: string, compositeTitle?: string): void {
		const compositeDescriptor = this.registry.getComposite(compositeId);
		if (!compositeDescriptor || !this.titleLabel) {
			return;
		}

		if (!compositeTitle) {
			compositeTitle = compositeDescriptor.name;
		}

		const keybinding = this.keybindingService.lookupKeybinding(compositeId);

		this.titleLabel.updateTitle(compositeId, compositeTitle, withNullAsUndefined(keybinding?.getLabel()));

		const toolBar = assertIsDefined(this.toolBar);
		toolBar.setAriaLabel(localize('ariaCompositeToolbarLabel', "{0} actions", compositeTitle));
	}

	private collectCompositeActions(composite?: Composite): () => void {

		// From Composite
		const primaryActions: IAction[] = composite?.getActions().slice(0) || [];
		const secondaryActions: IAction[] = composite?.getSecondaryActions().slice(0) || [];

		// Update context
		const toolBar = assertIsDefined(this.toolBar);
		toolBar.context = this.actionsContextProvider();

		// Return fn to set into toolbar
		return () => toolBar.setActions(prepareActions(primaryActions), prepareActions(secondaryActions));
	}

	protected getActiveComposite(): IComposite | undefined {
		return this.activeComposite;
	}

	protected getLastActiveCompositetId(): string {
		return this.lastActiveCompositeId;
	}

	protected hideActiveComposite(): Composite | undefined {
		if (!this.activeComposite) {
			return undefined; // Nothing to do
		}

		const composite = this.activeComposite;
		this.activeComposite = undefined;

		const compositeContainer = this.mapCompositeToCompositeContainer.get(composite.getId());

		// Indicate to Composite
		composite.setVisible(false);

		// Take Container Off-DOM and hide
		if (compositeContainer) {
			compositeContainer.remove();
			hide(compositeContainer);
		}

		// Clear any running Progress
		if (this.progressBar) {
			this.progressBar.stop().hide();
		}

		// Empty Actions
		if (this.toolBar) {
			this.collectCompositeActions()();
		}
		this.onDidCompositeClose.fire(composite);

		return composite;
	}

	override createTitleArea(parent: HTMLElement): HTMLElement {

		// Title Area Container
		const titleArea = append(parent, $('.composite'));
		titleArea.classList.add('title');

		// Left Title Label
		this.titleLabel = this.createTitleLabel(titleArea);

		// Right Actions Container
		const titleActionsContainer = append(titleArea, $('.title-actions'));

		// Toolbar
		this.toolBar = this._register(new ToolBar(titleActionsContainer, this.contextMenuService, {
			actionViewItemProvider: action => this.actionViewItemProvider(action),
			orientation: ActionsOrientation.HORIZONTAL,
			getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
			anchorAlignmentProvider: () => this.getTitleAreaDropDownAnchorAlignment(),
			toggleMenuTitle: localize('viewsAndMoreActions', "Views and More Actions...")
		}));

		this.collectCompositeActions()();

		return titleArea;
	}

	protected createTitleLabel(parent: HTMLElement): ICompositeTitleLabel {
		const titleContainer = append(parent, $('.title-label'));
		const titleLabel = append(titleContainer, $('h2'));
		this.titleLabelElement = titleLabel;

		const $this = this;
		return {
			updateTitle: (id, title, keybinding) => {
				// The title label is shared for all composites in the base CompositePart
				if (!this.activeComposite || this.activeComposite.getId() === id) {
					titleLabel.innerText = title;
					titleLabel.title = keybinding ? localize('titleTooltip', "{0} ({1})", title, keybinding) : title;
				}
			},

			updateStyles: () => {
				titleLabel.style.color = $this.titleForegroundColor ? $this.getColor($this.titleForegroundColor) || '' : '';
			}
		};
	}

	override updateStyles(): void {
		super.updateStyles();

		// Forward to title label
		const titleLabel = assertIsDefined(this.titleLabel);
		titleLabel.updateStyles();
	}

	protected actionViewItemProvider(action: IAction): IActionViewItem | undefined {

		// Check Active Composite
		if (this.activeComposite) {
			return this.activeComposite.getActionViewItem(action);
		}

		return undefined;
	}

	protected actionsContextProvider(): unknown {

		// Check Active Composite
		if (this.activeComposite) {
			return this.activeComposite.getActionsContext();
		}

		return null;
	}

	override createContentArea(parent: HTMLElement): HTMLElement {
		const contentContainer = append(parent, $('.content'));

		this.progressBar = this._register(new ProgressBar(contentContainer));
		this._register(attachProgressBarStyler(this.progressBar, this.themeService));
		this.progressBar.hide();

		return contentContainer;
	}

	getProgressIndicator(id: string): IProgressIndicator | undefined {
		const compositeItem = this.instantiatedCompositeItems.get(id);

		return compositeItem ? compositeItem.progress : undefined;
	}

	protected getTitleAreaDropDownAnchorAlignment(): AnchorAlignment {
		return AnchorAlignment.RIGHT;
	}

	override layout(width: number, height: number): void {
		super.layout(width, height);

		// Layout contents
		this.contentAreaSize = Dimension.lift(super.layoutContents(width, height).contentSize);

		// Layout composite
		if (this.activeComposite) {
			this.activeComposite.layout(this.contentAreaSize);
		}
	}

	protected removeComposite(compositeId: string): boolean {
		if (this.activeComposite?.getId() === compositeId) {
			return false; // do not remove active composite
		}

		this.mapCompositeToCompositeContainer.delete(compositeId);
		this.mapActionsBindingToComposite.delete(compositeId);
		const compositeItem = this.instantiatedCompositeItems.get(compositeId);
		if (compositeItem) {
			compositeItem.composite.dispose();
			dispose(compositeItem.disposable);
			this.instantiatedCompositeItems.delete(compositeId);
		}

		return true;
	}

	override dispose(): void {
		this.mapCompositeToCompositeContainer.clear();
		this.mapActionsBindingToComposite.clear();

		this.instantiatedCompositeItems.forEach(compositeItem => {
			compositeItem.composite.dispose();
			dispose(compositeItem.disposable);
		});

		this.instantiatedCompositeItems.clear();

		super.dispose();
	}
}
