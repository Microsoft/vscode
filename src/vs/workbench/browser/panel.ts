/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { IPanel } from 'vs/workbench/common/panel';
import { CompositeDescriptor, CompositeRegistry } from 'vs/workbench/browser/composite';
import { IConstructorSignature0, BrandedService, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { assertIsDefined } from 'vs/base/common/types';
import { PaneComposite } from 'vs/workbench/browser/panecomposite';
import { IAction, Separator } from 'vs/base/common/actions';
import { CompositeMenuActions } from 'vs/workbench/browser/menuActions';
import { MenuId } from 'vs/platform/actions/common/actions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';

export abstract class Panel extends PaneComposite implements IPanel {

	private readonly panelActions: CompositeMenuActions;

	constructor(id: string,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
	) {
		super(id, telemetryService, storageService, instantiationService, themeService, contextMenuService, extensionService, contextService);
		this.panelActions = this._register(this.instantiationService.createInstance(CompositeMenuActions, MenuId.PanelTitle, undefined, undefined));
		this._register(this.panelActions.onDidChange(() => this.updateTitleArea()));
	}

	override getActions(): readonly IAction[] {
		return [...super.getActions(), ...this.panelActions.getPrimaryActions()];
	}

	override getSecondaryActions(): readonly IAction[] {
		return this.mergeSecondaryActions(super.getSecondaryActions(), this.panelActions.getSecondaryActions());
	}

	override getContextMenuActions(): readonly IAction[] {
		return this.mergeSecondaryActions(super.getContextMenuActions(), this.panelActions.getContextMenuActions());
	}

	private mergeSecondaryActions(actions: readonly IAction[], panelActions: IAction[]): readonly IAction[] {
		if (panelActions.length && actions.length) {
			return [
				...actions,
				new Separator(),
				...panelActions,
			];
		}
		return panelActions.length ? panelActions : actions;
	}
}

/**
 * A panel descriptor is a leightweight descriptor of a panel in the workbench.
 */
export class PanelDescriptor extends CompositeDescriptor<Panel> {

	static create<Services extends BrandedService[]>(ctor: { new(...services: Services): Panel }, id: string, name: string, cssClass?: string, order?: number, requestedIndex?: number): PanelDescriptor {
		return new PanelDescriptor(ctor as IConstructorSignature0<Panel>, id, name, cssClass, order, requestedIndex);
	}

	private constructor(ctor: IConstructorSignature0<Panel>, id: string, name: string, cssClass?: string, order?: number, requestedIndex?: number) {
		super(ctor, id, name, cssClass, order, requestedIndex);
	}
}

export class PanelRegistry extends CompositeRegistry<Panel> {
	private defaultPanelId: string | undefined;

	/**
	 * Registers a panel to the platform.
	 */
	registerPanel(descriptor: PanelDescriptor): void {
		super.registerComposite(descriptor);
	}

	/**
	 * Deregisters a panel to the platform.
	 */
	deregisterPanel(id: string): void {
		super.deregisterComposite(id);
	}

	/**
	 * Returns a panel by id.
	 */
	getPanel(id: string): PanelDescriptor | undefined {
		return this.getComposite(id);
	}

	/**
	 * Returns an array of registered panels known to the platform.
	 */
	getPanels(): PanelDescriptor[] {
		return this.getComposites();
	}

	/**
	 * Sets the id of the panel that should open on startup by default.
	 */
	setDefaultPanelId(id: string): void {
		this.defaultPanelId = id;
	}

	/**
	 * Gets the id of the panel that should open on startup by default.
	 */
	getDefaultPanelId(): string {
		return assertIsDefined(this.defaultPanelId);
	}

	/**
	 * Find out if a panel exists with the provided ID.
	 */
	hasPanel(id: string): boolean {
		return this.getPanels().some(panel => panel.id === id);
	}
}

export const Extensions = {
	Panels: 'workbench.contributions.panels'
};

Registry.add(Extensions.Panels, new PanelRegistry());
