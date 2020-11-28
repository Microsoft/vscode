/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { equalsIgnoreCase, startsWithIgnoreCase } from 'vs/base/common/strings';
import { IEditorOptions } from 'vs/platform/editor/common/editor';

export const IOpenerService = createDecorator<IOpenerService>('openerService');

type OpenInternalOptions = {

	/**
	 * Signals that the intent is to open an editor to the side
	 * of the currently active editor.
	 */
	readonly openToSide?: boolean;

	/**
	 * Extra editor options to apply in case an editor is used to open.
	 */
	readonly editorOptions?: IEditorOptions;

	/**
	 * Signals that the editor to open was triggered through a user
	 * action, such as keyboard or mouse usage.
	 */
	readonly fromUserGesture?: boolean;
};

type OpenExternalOptions = { readonly openExternal?: boolean; readonly allowTunneling?: boolean };

export type OpenOptions = OpenInternalOptions & OpenExternalOptions;

export type ResolveExternalUriOptions = { readonly allowTunneling?: boolean };

export interface IResolvedExternalUri extends IDisposable {
	resolved: URI;
}

export interface IOpener {
	open(resource: URI | string, options?: OpenInternalOptions | OpenExternalOptions): Promise<boolean>;
}

export interface IExternalOpener {
	openExternal(href: string): Promise<boolean>;
}

export interface IValidator {
	shouldOpen(resource: URI | string): Promise<boolean>;
}

export interface IExternalUriResolver {
	resolveExternalUri(resource: URI, options?: OpenOptions): Promise<{ resolved: URI, dispose(): void } | undefined>;
}

export interface IOpenerService {

	readonly _serviceBrand: undefined;

	/**
	 * Register a participant that can handle the open() call.
	 */
	registerOpener(opener: IOpener): IDisposable;

	/**
	 * Register a participant that can validate if the URI resource be opened.
	 * Validators are run before openers.
	 */
	registerValidator(validator: IValidator): IDisposable;

	/**
	 * Register a participant that can resolve an external URI resource to be opened.
	 */
	registerExternalUriResolver(resolver: IExternalUriResolver): IDisposable;

	/**
	 * Sets the handler for opening externally. If not provided,
	 * a default handler will be used.
	 */
	setExternalOpener(opener: IExternalOpener): void;

	/**
	 * Opens a resource, like a webaddress, a document uri, or executes command.
	 *
	 * @param resource A resource
	 * @return A promise that resolves when the opening is done.
	 */
	open(resource: URI | string, options?: OpenInternalOptions | OpenExternalOptions): Promise<boolean>;

	/**
	 * Resolve a resource to its external form.
	 */
	resolveExternalUri(resource: URI, options?: ResolveExternalUriOptions): Promise<IResolvedExternalUri>;
}

export const NullOpenerService: IOpenerService = Object.freeze({
	_serviceBrand: undefined,
	registerOpener() { return Disposable.None; },
	registerValidator() { return Disposable.None; },
	registerExternalUriResolver() { return Disposable.None; },
	setExternalOpener() { },
	async open() { return false; },
	async resolveExternalUri(uri: URI) { return { resolved: uri, dispose() { } }; },
});

export function matchesScheme(target: URI | string, scheme: string) {
	if (URI.isUri(target)) {
		return equalsIgnoreCase(target.scheme, scheme);
	} else {
		return startsWithIgnoreCase(target, scheme + ':');
	}
}
