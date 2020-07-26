/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import Severity from 'vs/base/common/severity';
import { EXTENSION_IDENTIFIER_PATTERN } from 'vs/platform/extensionManagement/common/extensionManagement';
import { Extensions, IJSONContributionRegistry } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { IMessage } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionIdentifier, IExtensionDescription, EXTENSION_CATEGORIES } from 'vs/platform/extensions/common/extensions';
import { toArray } from 'vs/base/common/arrays';

const schemaRegistry = Registry.as<IJSONContributionRegistry>(Extensions.JSONContribution);
export type ExtensionKind = 'workspace' | 'ui' | undefined;

export class ExtensionMessageCollector {

	private readonly _messageHandler: (msg: IMessage) => void;
	private readonly _extension: IExtensionDescription;
	private readonly _extensionPointId: string;

	constructor(
		messageHandler: (msg: IMessage) => void,
		extension: IExtensionDescription,
		extensionPointId: string
	) {
		this._messageHandler = messageHandler;
		this._extension = extension;
		this._extensionPointId = extensionPointId;
	}

	private _msg(type: Severity, message: string): void {
		this._messageHandler({
			type: type,
			message: message,
			extensionId: this._extension.identifier,
			extensionPointId: this._extensionPointId
		});
	}

	public error(message: string): void {
		this._msg(Severity.Error, message);
	}

	public warn(message: string): void {
		this._msg(Severity.Warning, message);
	}

	public info(message: string): void {
		this._msg(Severity.Info, message);
	}
}

export interface IExtensionPointUser<T> {
	description: IExtensionDescription;
	value: T;
	collector: ExtensionMessageCollector;
}

export type IExtensionPointHandler<T> = (extensions: readonly IExtensionPointUser<T>[], delta: ExtensionPointUserDelta<T>) => void;

export interface IExtensionPoint<T> {
	name: string;
	setHandler(handler: IExtensionPointHandler<T>): void;
	defaultExtensionKind: ExtensionKind;
}

export class ExtensionPointUserDelta<T> {

	private static _toSet<T>(arr: readonly IExtensionPointUser<T>[]): Set<string> {
		const result = new Set<string>();
		for (let i = 0, len = arr.length; i < len; i++) {
			result.add(ExtensionIdentifier.toKey(arr[i].description.identifier));
		}
		return result;
	}

	public static compute<T>(previous: readonly IExtensionPointUser<T>[] | null, current: readonly IExtensionPointUser<T>[]): ExtensionPointUserDelta<T> {
		if (!previous || !previous.length) {
			return new ExtensionPointUserDelta<T>(current, []);
		}
		if (!current || !current.length) {
			return new ExtensionPointUserDelta<T>([], previous);
		}

		const previousSet = this._toSet(previous);
		const currentSet = this._toSet(current);

		let added = current.filter(user => !previousSet.has(ExtensionIdentifier.toKey(user.description.identifier)));
		let removed = previous.filter(user => !currentSet.has(ExtensionIdentifier.toKey(user.description.identifier)));

		return new ExtensionPointUserDelta<T>(added, removed);
	}

	constructor(
		public readonly added: readonly IExtensionPointUser<T>[],
		public readonly removed: readonly IExtensionPointUser<T>[],
	) { }
}

export class ExtensionPoint<T> implements IExtensionPoint<T> {

	public readonly name: string;
	public readonly defaultExtensionKind: ExtensionKind;

	private _handler: IExtensionPointHandler<T> | null;
	private _users: IExtensionPointUser<T>[] | null;
	private _delta: ExtensionPointUserDelta<T> | null;

	constructor(name: string, defaultExtensionKind: ExtensionKind) {
		this.name = name;
		this.defaultExtensionKind = defaultExtensionKind;
		this._handler = null;
		this._users = null;
		this._delta = null;
	}

	setHandler(handler: IExtensionPointHandler<T>): void {
		if (this._handler !== null) {
			throw new Error('Handler already set!');
		}
		this._handler = handler;
		this._handle();
	}

	acceptUsers(users: IExtensionPointUser<T>[]): void {
		this._delta = ExtensionPointUserDelta.compute(this._users, users);
		this._users = users;
		this._handle();
	}

	private _handle(): void {
		if (this._handler === null || this._users === null || this._delta === null) {
			return;
		}

		try {
			this._handler(this._users, this._delta);
		} catch (err) {
			onUnexpectedError(err);
		}
	}
}

const extensionKindSchema: IJSONSchema = {
	type: 'string',
	enum: [
		'ui',
		'workspace',
		'web'
	],
	enumDescriptions: [
		nls.localize('ui', "UI extension kind. In a remote window, such extensions are enabled only when available on the local machine."),
		nls.localize('workspace', "Workspace extension kind. In a remote window, such extensions are enabled only when available on the remote."),
		nls.localize('web', "Web worker extension kind. Such an extension can execute in a web worker extension host.")
	],
};

const schemaId = 'vscode://schemas/vscode-extensions';
export const schema: IJSONSchema = {
	properties: {
		engines: {
			type: 'object',
			description: nls.localize('vscode.extension.engines', "Engine compatibility."),
			properties: {
				'vscode': {
					type: 'string',
					description: nls.localize('vscode.extension.engines.vscode', 'For VS Code extensions, specifies the VS Code version that the extension is compatible with. Cannot be *. For example: ^0.10.5 indicates compatibility with a minimum VS Code version of 0.10.5.'),
					default: '^1.22.0',
				}
			}
		},
		publisher: {
			description: nls.localize('vscode.extension.publisher', 'The publisher of the VS Code extension.'),
			type: 'string'
		},
		displayName: {
			description: nls.localize('vscode.extension.displayName', 'The display name for the extension used in the VS Code gallery.'),
			type: 'string'
		},
		categories: {
			description: nls.localize('vscode.extension.categories', 'The categories used by the VS Code gallery to categorize the extension.'),
			type: 'array',
			uniqueItems: true,
			items: {
				oneOf: [{
					type: 'string',
					enum: EXTENSION_CATEGORIES,
				},
				{
					type: 'string',
					const: 'Languages',
					deprecationMessage: nls.localize('vscode.extension.category.languages.deprecated', 'Use \'Programming  Languages\' instead'),
				}]
			}
		},
		galleryBanner: {
			type: 'object',
			description: nls.localize('vscode.extension.galleryBanner', 'Banner used in the VS Code marketplace.'),
			properties: {
				color: {
					description: nls.localize('vscode.extension.galleryBanner.color', 'The banner color on the VS Code marketplace page header.'),
					type: 'string'
				},
				theme: {
					description: nls.localize('vscode.extension.galleryBanner.theme', 'The color theme for the font used in the banner.'),
					type: 'string',
					enum: ['dark', 'light']
				}
			}
		},
		contributes: {
			description: nls.localize('vscode.extension.contributes', 'All contributions of the VS Code extension represented by this package.'),
			type: 'object',
			properties: {
				// extensions will fill in
			} as { [key: string]: any },
			default: {}
		},
		preview: {
			type: 'boolean',
			description: nls.localize('vscode.extension.preview', 'Sets the extension to be flagged as a Preview in the Marketplace.'),
		},
		activationEvents: {
			description: nls.localize('vscode.extension.activationEvents', 'Activation events for the VS Code extension.'),
			type: 'array',
			items: {
				type: 'string',
				defaultSnippets: [
					{
						label: 'onLanguage',
						description: nls.localize('vscode.extension.activationEvents.onLanguage', 'An activation event emitted whenever a file that resolves to the specified language gets opened.'),
						body: 'onLanguage:${1:languageId}'
					},
					{
						label: 'onCommand',
						description: nls.localize('vscode.extension.activationEvents.onCommand', 'An activation event emitted whenever the specified command gets invoked.'),
						body: 'onCommand:${2:commandId}'
					},
					{
						label: 'onDebug',
						description: nls.localize('vscode.extension.activationEvents.onDebug', 'An activation event emitted whenever a user is about to start debugging or about to setup debug configurations.'),
						body: 'onDebug'
					},
					{
						label: 'onDebugInitialConfigurations',
						description: nls.localize('vscode.extension.activationEvents.onDebugInitialConfigurations', 'An activation event emitted whenever a "launch.json" needs to be created (and all provideDebugConfigurations methods need to be called).'),
						body: 'onDebugInitialConfigurations'
					},
					{
						label: 'onDebugDynamicConfigurations',
						description: nls.localize('vscode.extension.activationEvents.onDebugDynamicConfigurations', 'An activation event emitted whenever a list of all debug configurations needs to be created (and all provideDebugConfigurations methods for the "dynamic" scope need to be called).'),
						body: 'onDebugDynamicConfigurations'
					},
					{
						label: 'onDebugResolve',
						description: nls.localize('vscode.extension.activationEvents.onDebugResolve', 'An activation event emitted whenever a debug session with the specific type is about to be launched (and a corresponding resolveDebugConfiguration method needs to be called).'),
						body: 'onDebugResolve:${6:type}'
					},
					{
						label: 'onDebugAdapterProtocolTracker',
						description: nls.localize('vscode.extension.activationEvents.onDebugAdapterProtocolTracker', 'An activation event emitted whenever a debug session with the specific type is about to be launched and a debug protocol tracker might be needed.'),
						body: 'onDebugAdapterProtocolTracker:${6:type}'
					},
					{
						label: 'workspaceContains',
						description: nls.localize('vscode.extension.activationEvents.workspaceContains', 'An activation event emitted whenever a folder is opened that contains at least a file matching the specified glob pattern.'),
						body: 'workspaceContains:${4:filePattern}'
					},
					{
						label: 'onStartupFinished',
						description: nls.localize('vscode.extension.activationEvents.onStartupFinished', 'An activation event emitted after the start-up finished (after all `*` activated extensions have finished activating).'),
						body: 'onStartupFinished'
					},
					{
						label: 'onFileSystem',
						description: nls.localize('vscode.extension.activationEvents.onFileSystem', 'An activation event emitted whenever a file or folder is accessed with the given scheme.'),
						body: 'onFileSystem:${1:scheme}'
					},
					{
						label: 'onSearch',
						description: nls.localize('vscode.extension.activationEvents.onSearch', 'An activation event emitted whenever a search is started in the folder with the given scheme.'),
						body: 'onSearch:${7:scheme}'
					},
					{
						label: 'onView',
						body: 'onView:${5:viewId}',
						description: nls.localize('vscode.extension.activationEvents.onView', 'An activation event emitted whenever the specified view is expanded.'),
					},
					{
						label: 'onIdentity',
						body: 'onIdentity:${8:identity}',
						description: nls.localize('vscode.extension.activationEvents.onIdentity', 'An activation event emitted whenever the specified user identity.'),
					},
					{
						label: 'onUri',
						body: 'onUri',
						description: nls.localize('vscode.extension.activationEvents.onUri', 'An activation event emitted whenever a system-wide Uri directed towards this extension is open.'),
					},
					{
						label: 'onCustomEditor',
						body: 'onCustomEditor:${9:viewType}',
						description: nls.localize('vscode.extension.activationEvents.onCustomEditor', 'An activation event emitted whenever the specified custom editor becomes visible.'),
					},
					{
						label: '*',
						description: nls.localize('vscode.extension.activationEvents.star', 'An activation event emitted on VS Code startup. To ensure a great end user experience, please use this activation event in your extension only when no other activation events combination works in your use-case.'),
						body: '*'
					}
				],
			}
		},
		badges: {
			type: 'array',
			description: nls.localize('vscode.extension.badges', 'Array of badges to display in the sidebar of the Marketplace\'s extension page.'),
			items: {
				type: 'object',
				required: ['url', 'href', 'description'],
				properties: {
					url: {
						type: 'string',
						description: nls.localize('vscode.extension.badges.url', 'Badge image URL.')
					},
					href: {
						type: 'string',
						description: nls.localize('vscode.extension.badges.href', 'Badge link.')
					},
					description: {
						type: 'string',
						description: nls.localize('vscode.extension.badges.description', 'Badge description.')
					}
				}
			}
		},
		markdown: {
			type: 'string',
			description: nls.localize('vscode.extension.markdown', "Controls the Markdown rendering engine used in the Marketplace. Either github (default) or standard."),
			enum: ['github', 'standard'],
			default: 'github'
		},
		qna: {
			default: 'marketplace',
			description: nls.localize('vscode.extension.qna', "Controls the Q&A link in the Marketplace. Set to marketplace to enable the default Marketplace Q & A site. Set to a string to provide the URL of a custom Q & A site. Set to false to disable Q & A altogether."),
			anyOf: [
				{
					type: ['string', 'boolean'],
					enum: ['marketplace', false]
				},
				{
					type: 'string'
				}
			]
		},
		extensionDependencies: {
			description: nls.localize('vscode.extension.extensionDependencies', 'Dependencies to other extensions. The identifier of an extension is always ${publisher}.${name}. For example: vscode.csharp.'),
			type: 'array',
			uniqueItems: true,
			items: {
				type: 'string',
				pattern: EXTENSION_IDENTIFIER_PATTERN
			}
		},
		extensionPack: {
			description: nls.localize('vscode.extension.contributes.extensionPack', "A set of extensions that can be installed together. The identifier of an extension is always ${publisher}.${name}. For example: vscode.csharp."),
			type: 'array',
			uniqueItems: true,
			items: {
				type: 'string',
				pattern: EXTENSION_IDENTIFIER_PATTERN
			}
		},
		extensionKind: {
			description: nls.localize('extensionKind', "Define the kind of an extension. `ui` extensions are installed and run on the local machine while `workspace` extensions run on the remote."),
			type: 'array',
			items: extensionKindSchema,
			default: ['workspace'],
			defaultSnippets: [
				{
					body: ['ui'],
					description: nls.localize('extensionKind.ui', "Define an extension which can run only on the local machine when connected to remote window.")
				},
				{
					body: ['workspace'],
					description: nls.localize('extensionKind.workspace', "Define an extension which can run only on the remote machine when connected remote window.")
				},
				{
					body: ['ui', 'workspace'],
					description: nls.localize('extensionKind.ui-workspace', "Define an extension which can run on either side, with a preference towards running on the local machine.")
				},
				{
					body: ['workspace', 'ui'],
					description: nls.localize('extensionKind.workspace-ui', "Define an extension which can run on either side, with a preference towards running on the remote machine.")
				},
				{
					body: [],
					description: nls.localize('extensionKind.empty', "Define an extension which cannot run in a remote context, neither on the local, nor on the remote machine.")
				}
			]
		},
		scripts: {
			type: 'object',
			properties: {
				'vscode:prepublish': {
					description: nls.localize('vscode.extension.scripts.prepublish', 'Script executed before the package is published as a VS Code extension.'),
					type: 'string'
				},
				'vscode:uninstall': {
					description: nls.localize('vscode.extension.scripts.uninstall', 'Uninstall hook for VS Code extension. Script that gets executed when the extension is completely uninstalled from VS Code which is when VS Code is restarted (shutdown and start) after the extension is uninstalled. Only Node scripts are supported.'),
					type: 'string'
				}
			}
		},
		icon: {
			type: 'string',
			description: nls.localize('vscode.extension.icon', 'The path to a 128x128 pixel icon.')
		}
	}
};

export interface IExtensionPointDescriptor {
	extensionPoint: string;
	deps?: IExtensionPoint<any>[];
	jsonSchema: IJSONSchema;
	defaultExtensionKind?: ExtensionKind;
}

export class ExtensionsRegistryImpl {

	private readonly _extensionPoints = new Map<string, ExtensionPoint<any>>();

	public registerExtensionPoint<T>(desc: IExtensionPointDescriptor): IExtensionPoint<T> {
		if (this._extensionPoints.has(desc.extensionPoint)) {
			throw new Error('Duplicate extension point: ' + desc.extensionPoint);
		}
		const result = new ExtensionPoint<T>(desc.extensionPoint, desc.defaultExtensionKind);
		this._extensionPoints.set(desc.extensionPoint, result);

		schema.properties!['contributes'].properties![desc.extensionPoint] = desc.jsonSchema;
		schemaRegistry.registerSchema(schemaId, schema);

		return result;
	}

	public getExtensionPoints(): ExtensionPoint<any>[] {
		return toArray(this._extensionPoints.values());
	}
}

const PRExtensions = {
	ExtensionsRegistry: 'ExtensionsRegistry'
};
Registry.add(PRExtensions.ExtensionsRegistry, new ExtensionsRegistryImpl());
export const ExtensionsRegistry: ExtensionsRegistryImpl = Registry.as(PRExtensions.ExtensionsRegistry);

schemaRegistry.registerSchema(schemaId, schema);
