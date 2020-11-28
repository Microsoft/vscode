/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import * as platform from 'vs/base/common/platform';

export namespace Schemas {

	/**
	 * A schema that is used for models that exist in memory
	 * only and that have no correspondence on a server or such.
	 */
	export const inMemory = 'inmemory';

	/**
	 * A schema that is used for setting files
	 */
	export const vscode = 'vscode';

	/**
	 * A schema that is used for internal private files
	 */
	export const internal = 'private';

	/**
	 * A walk-through document.
	 */
	export const walkThrough = 'walkThrough';

	/**
	 * An embedded code snippet.
	 */
	export const walkThroughSnippet = 'walkThroughSnippet';

	export const http = 'http';

	export const https = 'https';

	export const file = 'file';

	export const mailto = 'mailto';

	export const untitled = 'untitled';

	export const data = 'data';

	export const command = 'command';

	export const vscodeRemote = 'vscode-remote';

	export const vscodeRemoteResource = 'vscode-remote-resource';

	export const userData = 'vscode-userdata';

	export const vscodeCustomEditor = 'vscode-custom-editor';

	export const vscodeNotebook = 'vscode-notebook';

	export const vscodeNotebookCell = 'vscode-notebook-cell';

	export const vscodeSettings = 'vscode-settings';

	export const webviewPanel = 'webview-panel';

	/**
	 * Scheme used for loading the wrapper html and script in webviews.
	 */
	export const vscodeWebview = 'vscode-webview';

	/**
	 * Scheme used for loading resources inside of webviews.
	 */
	export const vscodeWebviewResource = 'vscode-webview-resource';

	/**
	 * Scheme used for extension pages
	 */
	export const extension = 'extension';

	/**
	 * Scheme used as a replacement of `file` scheme to load
	 * files with our custom protocol handler (desktop only).
	 */
	export const vscodeFileResource = 'vscode-file';
}

class RemoteAuthoritiesImpl {
	private readonly _hosts: { [authority: string]: string | undefined; } = Object.create(null);
	private readonly _ports: { [authority: string]: number | undefined; } = Object.create(null);
	private readonly _connectionTokens: { [authority: string]: string | undefined; } = Object.create(null);
	private _preferredWebSchema: 'http' | 'https' = 'http';
	private _delegate: ((uri: URI) => URI) | null = null;

	setPreferredWebSchema(schema: 'http' | 'https') {
		this._preferredWebSchema = schema;
	}

	setDelegate(delegate: (uri: URI) => URI): void {
		this._delegate = delegate;
	}

	set(authority: string, host: string, port: number): void {
		this._hosts[authority] = host;
		this._ports[authority] = port;
	}

	setConnectionToken(authority: string, connectionToken: string): void {
		this._connectionTokens[authority] = connectionToken;
	}

	rewrite(uri: URI): URI {
		if (this._delegate) {
			return this._delegate(uri);
		}
		const authority = uri.authority;
		let host = this._hosts[authority];
		if (host && host.indexOf(':') !== -1) {
			host = `[${host}]`;
		}
		const port = this._ports[authority];
		const connectionToken = this._connectionTokens[authority];
		let query = `path=${encodeURIComponent(uri.path)}`;
		if (typeof connectionToken === 'string') {
			query += `&tkn=${encodeURIComponent(connectionToken)}`;
		}
		return URI.from({
			scheme: platform.isWeb ? this._preferredWebSchema : Schemas.vscodeRemoteResource,
			authority: `${host}:${port}`,
			path: `/vscode-remote-resource`,
			query
		});
	}
}

export const RemoteAuthorities = new RemoteAuthoritiesImpl();

class FileAccessImpl {

	private readonly FALLBACK_AUTHORITY = 'vscode-app';

	/**
	 * Returns a URI to use in contexts where the browser is responsible
	 * for loading (e.g. fetch()) or when used within the DOM.
	 *
	 * **Note:** use `dom.ts#asCSSUrl` whenever the URL is to be used in CSS context.
	 */
	asBrowserUri(uri: URI): URI;
	asBrowserUri(moduleId: string, moduleIdToUrl: { toUrl(moduleId: string): string }): URI;
	asBrowserUri(uriOrModule: URI | string, moduleIdToUrl?: { toUrl(moduleId: string): string }): URI {
		const uri = this.toUri(uriOrModule, moduleIdToUrl);

		// Handle remote URIs via `RemoteAuthorities`
		if (uri.scheme === Schemas.vscodeRemote) {
			return RemoteAuthorities.rewrite(uri);
		}

		// Only convert the URI if we are in a native context and it has `file:` scheme
		if (platform.isElectronSandboxed && platform.isNative && uri.scheme === Schemas.file) {
			return this.toCodeFileUri(uri);
		}

		return uri;
	}

	/**
	 * TODO@bpasero remove me eventually when vscode-file is adopted everywhere
	 */
	_asCodeFileUri(uri: URI): URI;
	_asCodeFileUri(moduleId: string, moduleIdToUrl: { toUrl(moduleId: string): string }): URI;
	_asCodeFileUri(uriOrModule: URI | string, moduleIdToUrl?: { toUrl(moduleId: string): string }): URI {
		const uri = this.toUri(uriOrModule, moduleIdToUrl);

		return this.toCodeFileUri(uri);
	}

	private toCodeFileUri(uri: URI): URI {
		return uri.with({
			scheme: Schemas.vscodeFileResource,
			// We need to provide an authority here so that it can serve
			// as origin for network and loading matters in chromium.
			// If the URI is not coming with an authority already, we
			// add our own
			authority: uri.authority || this.FALLBACK_AUTHORITY,
			query: null,
			fragment: null
		});
	}

	/**
	 * Returns the `file` URI to use in contexts where node.js
	 * is responsible for loading.
	 */
	asFileUri(uri: URI): URI;
	asFileUri(moduleId: string, moduleIdToUrl: { toUrl(moduleId: string): string }): URI;
	asFileUri(uriOrModule: URI | string, moduleIdToUrl?: { toUrl(moduleId: string): string }): URI {
		const uri = this.toUri(uriOrModule, moduleIdToUrl);

		// Only convert the URI if it is `vscode-file:` scheme
		if (uri.scheme === Schemas.vscodeFileResource) {
			return uri.with({
				scheme: Schemas.file,
				// Only preserve the `authority` if it is different from
				// our fallback authority. This ensures we properly preserve
				// Windows UNC paths that come with their own authority.
				authority: uri.authority !== this.FALLBACK_AUTHORITY ? uri.authority : null,
				query: null,
				fragment: null
			});
		}

		return uri;
	}

	private toUri(uriOrModule: URI | string, moduleIdToUrl?: { toUrl(moduleId: string): string }): URI {
		if (URI.isUri(uriOrModule)) {
			return uriOrModule;
		}

		return URI.parse(moduleIdToUrl!.toUrl(uriOrModule));
	}
}

export const FileAccess = new FileAccessImpl();
