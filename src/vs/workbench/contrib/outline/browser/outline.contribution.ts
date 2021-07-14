/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IViewsRegistry, IViewDescriptor, Extensions as ViewExtensions } from 'vs/workbench/common/views';
import { OutlinePane } from './outlinePane';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
// import { VIEW_CONTAINER } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { OutlineConfigKeys } from 'vs/workbench/services/outline/browser/outline';
// import { THIRD_PANEL_VIEWLET_ID } from 'vs/workbench/contrib/thirdPanel/browser/thirdPanel';
import { thirdPanelViewRegistry } from 'vs/workbench/contrib/thirdPanel/browser/thirdPanel.contribution';


const outlineViewIcon = registerIcon('outline-view-icon', Codicon.symbolClass, localize('outlineViewIcon', 'View icon of the outline view.'));

const _outlineDesc = <IViewDescriptor>{
	id: OutlinePane.Id,
	name: localize('name', "Outline"),
	containerIcon: outlineViewIcon,
	ctorDescriptor: new SyncDescriptor(OutlinePane),
	canToggleVisibility: true,
	canMoveView: true,
	hideByDefault: false,
	collapsed: true,
	order: 2,
	weight: 30,
	focusCommand: { id: 'outline.focus' }
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([_outlineDesc], thirdPanelViewRegistry);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	'id': 'outline',
	'order': 117,
	'title': localize('outlineConfigurationTitle', "Outline"),
	'type': 'object',
	'properties': {
		[OutlineConfigKeys.icons]: {
			'description': localize('outline.showIcons', "Render Outline Elements with Icons."),
			'type': 'boolean',
			'default': true
		},
		[OutlineConfigKeys.problemsEnabled]: {
			'description': localize('outline.showProblem', "Show Errors & Warnings on Outline Elements."),
			'type': 'boolean',
			'default': true
		},
		[OutlineConfigKeys.problemsColors]: {
			'description': localize('outline.problem.colors', "Use colors for Errors & Warnings."),
			'type': 'boolean',
			'default': true
		},
		[OutlineConfigKeys.problemsBadges]: {
			'description': localize('outline.problems.badges', "Use badges for Errors & Warnings."),
			'type': 'boolean',
			'default': true
		},
		'outline.showFiles': {
			type: 'boolean',
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			default: true,
			markdownDescription: localize('filteredTypes.file', "When enabled outline shows `file`-symbols.")
		},
		'outline.showModules': {
			type: 'boolean',
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			default: true,
			markdownDescription: localize('filteredTypes.module', "When enabled outline shows `module`-symbols.")
		},
		'outline.showNamespaces': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.namespace', "When enabled outline shows `namespace`-symbols.")
		},
		'outline.showPackages': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.package', "When enabled outline shows `package`-symbols.")
		},
		'outline.showClasses': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.class', "When enabled outline shows `class`-symbols.")
		},
		'outline.showMethods': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.method', "When enabled outline shows `method`-symbols.")
		},
		'outline.showProperties': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.property', "When enabled outline shows `property`-symbols.")
		},
		'outline.showFields': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.field', "When enabled outline shows `field`-symbols.")
		},
		'outline.showConstructors': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.constructor', "When enabled outline shows `constructor`-symbols.")
		},
		'outline.showEnums': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.enum', "When enabled outline shows `enum`-symbols.")
		},
		'outline.showInterfaces': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.interface', "When enabled outline shows `interface`-symbols.")
		},
		'outline.showFunctions': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.function', "When enabled outline shows `function`-symbols.")
		},
		'outline.showVariables': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.variable', "When enabled outline shows `variable`-symbols.")
		},
		'outline.showConstants': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.constant', "When enabled outline shows `constant`-symbols.")
		},
		'outline.showStrings': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.string', "When enabled outline shows `string`-symbols.")
		},
		'outline.showNumbers': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.number', "When enabled outline shows `number`-symbols.")
		},
		'outline.showBooleans': {
			type: 'boolean',
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			default: true,
			markdownDescription: localize('filteredTypes.boolean', "When enabled outline shows `boolean`-symbols.")
		},
		'outline.showArrays': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.array', "When enabled outline shows `array`-symbols.")
		},
		'outline.showObjects': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.object', "When enabled outline shows `object`-symbols.")
		},
		'outline.showKeys': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.key', "When enabled outline shows `key`-symbols.")
		},
		'outline.showNull': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.null', "When enabled outline shows `null`-symbols.")
		},
		'outline.showEnumMembers': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.enumMember', "When enabled outline shows `enumMember`-symbols.")
		},
		'outline.showStructs': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.struct', "When enabled outline shows `struct`-symbols.")
		},
		'outline.showEvents': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.event', "When enabled outline shows `event`-symbols.")
		},
		'outline.showOperators': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.operator', "When enabled outline shows `operator`-symbols.")
		},
		'outline.showTypeParameters': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: localize('filteredTypes.typeParameter', "When enabled outline shows `typeParameter`-symbols.")
		}
	}
});
