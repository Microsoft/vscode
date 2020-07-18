/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { IPanel } from 'vs/workbench/common/panel';
import { CompositeDescriptor, CompositeRegistry } from 'vs/workbench/browser/composite';
import { IConstructorSignature0, BrandedService } from 'vs/platform/instantiation/common/instantiation';
import { assertIsDefined } from 'vs/base/common/types';
import { PaneComposite } from 'vs/workbench/browser/panecomposite';

export abstract class Panel extends PaneComposite implements IPanel { }

/**
 * A panel descriptor is a leightweight descriptor of a panel in the workbench.
 */
export class PanelDescriptor extends CompositeDescriptor<Panel> {

	static create<Services extends BrandedService[]>(ctor: { new(...services: Services): Panel }, id: string, name: string, cssClass?: string, order?: number, requestedIndex?: number, _commandId?: string): PanelDescriptor {
		return new PanelDescriptor(ctor as IConstructorSignature0<Panel>, id, name, cssClass, order, requestedIndex, _commandId);
	}

	private constructor(ctor: IConstructorSignature0<Panel>, id: string, name: string, cssClass?: string, order?: number, requestedIndex?: number, _commandId?: string) {
		super(ctor, id, name, cssClass, order, requestedIndex, _commandId);
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
