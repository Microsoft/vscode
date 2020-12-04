/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/platform/registry/common/platform';
import { IJSONSchema, IJSONSchemaMap } from 'vs/base/common/jsonSchema';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { Event, Emitter } from 'vs/base/common/event';
import { localize } from 'vs/nls';
import { Extensions as JSONExtensions, IJSONContributionRegistry } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { RunOnceScheduler } from 'vs/base/common/async';
import * as Codicons from 'vs/base/common/codicons';


//  ------ API types


// color registry
export const Extensions = {
	IconContribution: 'base.contributions.icons'
};

export type IconDefaults = ThemeIcon | IconDefinition;

export interface IconDefinition {
	fontId?: string;
	character: string;
}

export interface IconContribution {
	id: string;
	description: string | undefined;
	deprecationMessage?: string;
	defaults: IconDefaults;
}

export interface IIconRegistry {

	readonly onDidChange: Event<void>;

	/**
	 * Register a icon to the registry.
	 * @param id The icon id
	 * @param defaults The default values
	 * @description the description
	 */
	registerIcon(id: string, defaults: IconDefaults, description?: string): ThemeIcon;

	/**
	 * Register a icon to the registry.
	 */
	deregisterIcon(id: string): void;

	/**
	 * Get all icon contributions
	 */
	getIcons(): IconContribution[];

	/**
	 * Get the icon for the given id
	 */
	getIcon(id: string): IconContribution | undefined;

	/**
	 * JSON schema for an object to assign icon values to one of the color contributions.
	 */
	getIconSchema(): IJSONSchema;

	/**
	 * JSON schema to for a reference to a icon contribution.
	 */
	getIconReferenceSchema(): IJSONSchema;

	/**
	 * The CSS for all icons
	 */
	getCSS(): string;

}

class IconRegistry implements IIconRegistry {

	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private iconsById: { [key: string]: IconContribution };
	private iconSchema: IJSONSchema & { properties: IJSONSchemaMap } = {
		definitions: {
			icons: {
				type: 'object',
				properties: {
					fontId: { type: 'string', description: localize('iconDefintion.fontId', 'The id of the font to use. If not set, the font that is defined first is used.') },
					fontCharacter: { type: 'string', description: localize('iconDefintion.fontCharacter', 'The font character associated with the icon definition.') }
				},
				additionalProperties: false,
				defaultSnippets: [{ body: { fontCharacter: '\\\\e030' } }]
			}
		},
		type: 'object',
		properties: {}
	};
	private iconReferenceSchema: IJSONSchema & { enum: string[], enumDescriptions: string[] } = { type: 'string', enum: [], enumDescriptions: [] };

	constructor() {
		this.iconsById = {};
	}

	public registerIcon(id: string, defaults: IconDefaults, description?: string, deprecationMessage?: string): ThemeIcon {
		const existing = this.iconsById[id];
		if (existing) {
			if (description && !existing.description) {
				existing.description = description;
				this.iconSchema.properties[id].markdownDescription = `${description} $(${id})`;
				const enumIndex = this.iconReferenceSchema.enum.indexOf(id);
				if (enumIndex !== -1) {
					this.iconReferenceSchema.enumDescriptions[enumIndex] = description;
				}
				this._onDidChange.fire();
			}
			return existing;
		}
		let iconContribution: IconContribution = { id, description, defaults, deprecationMessage };
		this.iconsById[id] = iconContribution;
		let propertySchema: IJSONSchema = { $ref: '#/definitions/icons' };
		if (deprecationMessage) {
			propertySchema.deprecationMessage = deprecationMessage;
		}
		if (description) {
			propertySchema.markdownDescription = `${description}: $(${id})`;
		}
		this.iconSchema.properties[id] = propertySchema;
		this.iconReferenceSchema.enum.push(id);
		this.iconReferenceSchema.enumDescriptions.push(description || '');

		this._onDidChange.fire();
		return { id };
	}


	public deregisterIcon(id: string): void {
		delete this.iconsById[id];
		delete this.iconSchema.properties[id];
		const index = this.iconReferenceSchema.enum.indexOf(id);
		if (index !== -1) {
			this.iconReferenceSchema.enum.splice(index, 1);
			this.iconReferenceSchema.enumDescriptions.splice(index, 1);
		}
		this._onDidChange.fire();
	}

	public getIcons(): IconContribution[] {
		return Object.keys(this.iconsById).map(id => this.iconsById[id]);
	}

	public getIcon(id: string): IconContribution | undefined {
		return this.iconsById[id];
	}

	public getIconSchema(): IJSONSchema {
		return this.iconSchema;
	}

	public getIconReferenceSchema(): IJSONSchema {
		return this.iconReferenceSchema;
	}

	public getCSS() {
		const rules = [];
		for (let id in this.iconsById) {
			const rule = this.formatRule(id);
			if (rule) {
				rules.push(rule);
			}
		}
		return rules.join('\n');
	}

	private formatRule(id: string): string | undefined {
		let definition = this.iconsById[id].defaults;
		while (ThemeIcon.isThemeIcon(definition)) {
			const c = this.iconsById[definition.id];
			if (!c) {
				return undefined;
			}
			definition = c.defaults;
		}
		return `.codicon-${id}:before { content: '${definition.character}'; }`;
	}

	public toString() {
		const sorter = (i1: IconContribution, i2: IconContribution) => {
			const isThemeIcon1 = ThemeIcon.isThemeIcon(i1.defaults);
			const isThemeIcon2 = ThemeIcon.isThemeIcon(i2.defaults);
			if (isThemeIcon1 !== isThemeIcon2) {
				return isThemeIcon1 ? -1 : 1;
			}
			return i1.id.localeCompare(i2.id);
		};
		const classNames = (i: IconContribution) => {
			while (ThemeIcon.isThemeIcon(i.defaults)) {
				i = this.iconsById[i.defaults.id];
			}
			return `codicon codicon-${i ? i.id : ''}`;
		};

		let reference = [];
		let docCss = [];

		const contributions = Object.keys(this.iconsById).map(key => this.iconsById[key]);

		for (const i of contributions.sort(sorter)) {
			reference.push(`|<i class="${classNames(i)}"></i>|${i.id}|${ThemeIcon.isThemeIcon(i.defaults) ? i.defaults.id : ''}|${i.description || ''}|`);

			if (!ThemeIcon.isThemeIcon((i.defaults))) {
				docCss.push(`.codicon-${i.id}:before { content: "${i.defaults.character}" }`);
			}
		}
		return reference.join('\n') + '\n\n' + docCss.join('\n');
	}

}

const iconRegistry = new IconRegistry();
platform.Registry.add(Extensions.IconContribution, iconRegistry);

export function registerIcon(id: string, defaults: IconDefaults, description: string, deprecationMessage?: string): ThemeIcon {
	return iconRegistry.registerIcon(id, defaults, description, deprecationMessage);
}

export function getIconRegistry(): IIconRegistry {
	return iconRegistry;
}

function initialize() {
	for (const icon of Codicons.iconRegistry.all) {
		iconRegistry.registerIcon(icon.id, icon.definition, icon.description);
	}
	Codicons.iconRegistry.onDidRegister(icon => iconRegistry.registerIcon(icon.id, icon.definition, icon.description));
}
initialize();

export const iconsSchemaId = 'vscode://schemas/icons';

let schemaRegistry = platform.Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
schemaRegistry.registerSchema(iconsSchemaId, iconRegistry.getIconSchema());

const delayer = new RunOnceScheduler(() => schemaRegistry.notifySchemaChanged(iconsSchemaId), 200);
iconRegistry.onDidChange(() => {
	if (!delayer.isScheduled()) {
		delayer.schedule();
	}
});


//setTimeout(_ => console.log(iconRegistry.toString()), 5000);


// common icons

export const widgetClose = registerIcon('widget-close', Codicons.Codicon.close, localize('widgetClose', 'Icon for the close action in widgets.'));

export const gotoPreviousLocation = registerIcon('goto-previous-location', Codicons.Codicon.arrowUp, localize('previousChangeIcon', 'Icon for goto previous editor location.'));
export const gotoNextLocation = registerIcon('goto-next-location', Codicons.Codicon.arrowDown, localize('nextChangeIcon', 'Icon for goto next editor location.'));
