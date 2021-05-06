/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorInputSerializer } from 'vs/workbench/common/editor';
import { WebviewContentOptions, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewIcons } from 'vs/workbench/contrib/webviewPanel/browser/webviewIconManager';
import { WebviewInput } from './webviewEditorInput';
import { IWebviewWorkbenchService } from './webviewWorkbenchService';

export type SerializedWebviewOptions = WebviewOptions & WebviewContentOptions;

interface SerializedIconPath {
	light: string | UriComponents;
	dark: string | UriComponents;
}

export interface SerializedWebview {
	readonly id: string;
	readonly viewType: string;
	readonly title: string;
	readonly options: SerializedWebviewOptions;
	readonly extensionLocation: UriComponents | undefined;
	readonly extensionId: string | undefined;
	readonly state: any;
	readonly iconPath: SerializedIconPath | undefined;
	readonly group?: number;
}

export interface DeserializedWebview {
	readonly id: string;
	readonly viewType: string;
	readonly title: string;
	readonly webviewOptions: WebviewOptions;
	readonly contentOptions: WebviewContentOptions;
	readonly extension: WebviewExtensionDescription | undefined;
	readonly state: any;
	readonly iconPath: WebviewIcons | undefined;
	readonly group?: number;
}

export class WebviewEditorInputSerializer implements IEditorInputSerializer {

	public static readonly ID = WebviewInput.typeId;

	public constructor(
		@IWebviewWorkbenchService private readonly _webviewWorkbenchService: IWebviewWorkbenchService
	) { }

	public canSerialize(input: WebviewInput): boolean {
		return this._webviewWorkbenchService.shouldPersist(input);
	}

	public serialize(input: WebviewInput): string | undefined {
		if (!this._webviewWorkbenchService.shouldPersist(input)) {
			return undefined;
		}

		const data = this.toJson(input);
		try {
			return JSON.stringify(data);
		} catch {
			return undefined;
		}
	}

	public deserialize(
		_instantiationService: IInstantiationService,
		serializedEditorInput: string
	): WebviewInput {
		const data = this.fromJson(JSON.parse(serializedEditorInput));
		return this._webviewWorkbenchService.reviveWebview({
			id: data.id,
			viewType: data.viewType,
			title: data.title,
			iconPath: data.iconPath,
			state: data.state,
			webviewOptions: data.webviewOptions,
			contentOptions: data.contentOptions,
			extension: data.extension,
			group: data.group
		});
	}

	protected fromJson(data: SerializedWebview): DeserializedWebview {
		return {
			...data,
			extension: reviveWebviewExtensionDescription(data.extensionId, data.extensionLocation),
			iconPath: reviveIconPath(data.iconPath),
			state: reviveState(data.state),
			webviewOptions: restoreWebviewOptions(data.options),
			contentOptions: restoreWebviewContentOptions(data.options),
		};
	}

	protected toJson(input: WebviewInput): SerializedWebview {
		return {
			id: input.id,
			viewType: input.viewType,
			title: input.getName(),
			options: { ...input.webview.options, ...input.webview.contentOptions },
			extensionLocation: input.extension ? input.extension.location : undefined,
			extensionId: input.extension && input.extension.id ? input.extension.id.value : undefined,
			state: input.webview.state,
			iconPath: input.iconPath ? { light: input.iconPath.light, dark: input.iconPath.dark, } : undefined,
			group: input.group
		};
	}
}

export function reviveWebviewExtensionDescription(
	extensionId: string | undefined,
	extensionLocation: UriComponents | undefined,
): WebviewExtensionDescription | undefined {
	if (!extensionId) {
		return undefined;
	}

	const location = reviveUri(extensionLocation);
	if (!location) {
		return undefined;
	}

	return {
		id: new ExtensionIdentifier(extensionId),
		location,
	};
}

function reviveIconPath(data: SerializedIconPath | undefined) {
	if (!data) {
		return undefined;
	}

	const light = reviveUri(data.light);
	const dark = reviveUri(data.dark);
	return light && dark ? { light, dark } : undefined;
}

function reviveUri(data: string | UriComponents): URI;
function reviveUri(data: string | UriComponents | undefined): URI | undefined;
function reviveUri(data: string | UriComponents | undefined): URI | undefined {
	if (!data) {
		return undefined;
	}

	try {
		if (typeof data === 'string') {
			return URI.parse(data);
		}
		return URI.from(data);
	} catch {
		return undefined;
	}
}

function reviveState(state: unknown | undefined): undefined | string {
	return typeof state === 'string' ? state : undefined;
}

export function restoreWebviewOptions(options: SerializedWebviewOptions): WebviewOptions {
	return options;
}

export function restoreWebviewContentOptions(options: SerializedWebviewOptions): WebviewContentOptions {
	return {
		...options,
		localResourceRoots: options.localResourceRoots?.map(uri => reviveUri(uri)),
	};
}
