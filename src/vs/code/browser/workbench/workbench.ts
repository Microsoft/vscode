/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchConstructionOptions, create, ICredentialsProvider, IURLCallbackProvider, IWorkspaceProvider, IWorkspace, IWindowIndicator, IHomeIndicator, IProductQualityChangeHandler, ISettingsSyncOptions } from 'vs/workbench/workbench.web.api';
import { URI, UriComponents } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { generateUuid } from 'vs/base/common/uuid';
import { CancellationToken } from 'vs/base/common/cancellation';
import { streamToBuffer } from 'vs/base/common/buffer';
import { Disposable } from 'vs/base/common/lifecycle';
import { request } from 'vs/base/parts/request/browser/request';
import { isFolderToOpen, isWorkspaceToOpen } from 'vs/platform/windows/common/windows';
import { isEqual } from 'vs/base/common/resources';
import { isStandalone } from 'vs/base/browser/browser';
import { localize } from 'vs/nls';
import { Schemas } from 'vs/base/common/network';
import product from 'vs/platform/product/common/product';
import { parseLogLevel } from 'vs/platform/log/common/log';

function doCreateUri(path: string, queryValues: Map<string, string>): URI {
	let query: string | undefined = undefined;

	if (queryValues) {
		let index = 0;
		queryValues.forEach((value, key) => {
			if (!query) {
				query = '';
			}

			const prefix = (index++ === 0) ? '' : '&';
			query += `${prefix}${key}=${encodeURIComponent(value)}`;
		});
	}

	return URI.parse(window.location.href).with({ path, query });
}

interface ICredential {
	service: string;
	account: string;
	password: string;
}

class LocalStorageCredentialsProvider implements ICredentialsProvider {

	static readonly CREDENTIALS_OPENED_KEY = 'credentials.provider';

	private readonly authService: string | undefined;

	constructor() {
		let authSessionInfo: { readonly id: string, readonly accessToken: string, readonly providerId: string, readonly canSignOut?: boolean, readonly scopes: string[][] } | undefined;
		const authSessionElement = document.getElementById('vscode-workbench-auth-session');
		const authSessionElementAttribute = authSessionElement ? authSessionElement.getAttribute('data-settings') : undefined;
		if (authSessionElementAttribute) {
			try {
				authSessionInfo = JSON.parse(authSessionElementAttribute);
			} catch (error) { /* Invalid session is passed. Ignore. */ }
		}

		if (authSessionInfo) {
			// Settings Sync Entry
			this.setPassword(`${product.urlProtocol}.login`, 'account', JSON.stringify(authSessionInfo));

			// Auth extension Entry
			this.authService = `${product.urlProtocol}-${authSessionInfo.providerId}.login`;
			this.setPassword(this.authService, 'account', JSON.stringify(authSessionInfo.scopes.map(scopes => ({
				id: authSessionInfo!.id,
				scopes,
				accessToken: authSessionInfo!.accessToken
			}))));
		}
	}

	private _credentials: ICredential[] | undefined;
	private get credentials(): ICredential[] {
		if (!this._credentials) {
			try {
				const serializedCredentials = window.localStorage.getItem(LocalStorageCredentialsProvider.CREDENTIALS_OPENED_KEY);
				if (serializedCredentials) {
					this._credentials = JSON.parse(serializedCredentials);
				}
			} catch (error) {
				// ignore
			}

			if (!Array.isArray(this._credentials)) {
				this._credentials = [];
			}
		}

		return this._credentials;
	}

	private save(): void {
		window.localStorage.setItem(LocalStorageCredentialsProvider.CREDENTIALS_OPENED_KEY, JSON.stringify(this.credentials));
	}

	async getPassword(service: string, account: string): Promise<string | null> {
		return this.doGetPassword(service, account);
	}

	private async doGetPassword(service: string, account?: string): Promise<string | null> {
		for (const credential of this.credentials) {
			if (credential.service === service) {
				if (typeof account !== 'string' || account === credential.account) {
					return credential.password;
				}
			}
		}

		return null;
	}

	async setPassword(service: string, account: string, password: string): Promise<void> {
		this.doDeletePassword(service, account);

		this.credentials.push({ service, account, password });

		this.save();

		try {
			if (password && service === this.authService) {
				const value = JSON.parse(password);
				if (Array.isArray(value) && value.length === 0) {
					await this.logout(service);
				}
			}
		} catch (error) {
			console.log(error);
		}
	}

	async deletePassword(service: string, account: string): Promise<boolean> {
		const result = await this.doDeletePassword(service, account);

		if (result && service === this.authService) {
			try {
				await this.logout(service);
			} catch (error) {
				console.log(error);
			}
		}

		return result;
	}

	private async doDeletePassword(service: string, account: string): Promise<boolean> {
		let found = false;

		this._credentials = this.credentials.filter(credential => {
			if (credential.service === service && credential.account === account) {
				found = true;

				return false;
			}

			return true;
		});

		if (found) {
			this.save();
		}

		return found;
	}

	async findPassword(service: string): Promise<string | null> {
		return this.doGetPassword(service);
	}

	async findCredentials(service: string): Promise<Array<{ account: string, password: string }>> {
		return this.credentials
			.filter(credential => credential.service === service)
			.map(({ account, password }) => ({ account, password }));
	}

	private async logout(service: string): Promise<void> {
		const queryValues: Map<string, string> = new Map();
		queryValues.set('logout', String(true));
		queryValues.set('service', service);

		await request({
			url: doCreateUri('/auth/logout', queryValues).toString(true)
		}, CancellationToken.None);
	}
}

class PollingURLCallbackProvider extends Disposable implements IURLCallbackProvider {

	static readonly FETCH_INTERVAL = 500; 			// fetch every 500ms
	static readonly FETCH_TIMEOUT = 5 * 60 * 1000; 	// ...but stop after 5min

	static readonly QUERY_KEYS = {
		REQUEST_ID: 'vscode-requestId',
		SCHEME: 'vscode-scheme',
		AUTHORITY: 'vscode-authority',
		PATH: 'vscode-path',
		QUERY: 'vscode-query',
		FRAGMENT: 'vscode-fragment'
	};

	private readonly _onCallback = this._register(new Emitter<URI>());
	readonly onCallback = this._onCallback.event;

	create(options?: Partial<UriComponents>): URI {
		const queryValues: Map<string, string> = new Map();

		const requestId = generateUuid();
		queryValues.set(PollingURLCallbackProvider.QUERY_KEYS.REQUEST_ID, requestId);

		const { scheme, authority, path, query, fragment } = options ? options : { scheme: undefined, authority: undefined, path: undefined, query: undefined, fragment: undefined };

		if (scheme) {
			queryValues.set(PollingURLCallbackProvider.QUERY_KEYS.SCHEME, scheme);
		}

		if (authority) {
			queryValues.set(PollingURLCallbackProvider.QUERY_KEYS.AUTHORITY, authority);
		}

		if (path) {
			queryValues.set(PollingURLCallbackProvider.QUERY_KEYS.PATH, path);
		}

		if (query) {
			queryValues.set(PollingURLCallbackProvider.QUERY_KEYS.QUERY, query);
		}

		if (fragment) {
			queryValues.set(PollingURLCallbackProvider.QUERY_KEYS.FRAGMENT, fragment);
		}

		// Start to poll on the callback being fired
		this.periodicFetchCallback(requestId, Date.now());

		return doCreateUri('/callback', queryValues);
	}

	private async periodicFetchCallback(requestId: string, startTime: number): Promise<void> {

		// Ask server for callback results
		const queryValues: Map<string, string> = new Map();
		queryValues.set(PollingURLCallbackProvider.QUERY_KEYS.REQUEST_ID, requestId);

		const result = await request({
			url: doCreateUri('/fetch-callback', queryValues).toString(true)
		}, CancellationToken.None);

		// Check for callback results
		const content = await streamToBuffer(result.stream);
		if (content.byteLength > 0) {
			try {
				this._onCallback.fire(URI.revive(JSON.parse(content.toString())));
			} catch (error) {
				console.error(error);
			}

			return; // done
		}

		// Continue fetching unless we hit the timeout
		if (Date.now() - startTime < PollingURLCallbackProvider.FETCH_TIMEOUT) {
			setTimeout(() => this.periodicFetchCallback(requestId, startTime), PollingURLCallbackProvider.FETCH_INTERVAL);
		}
	}
}

class WorkspaceProvider implements IWorkspaceProvider {

	static QUERY_PARAM_EMPTY_WINDOW = 'ew';
	static QUERY_PARAM_FOLDER = 'folder';
	static QUERY_PARAM_WORKSPACE = 'workspace';

	static QUERY_PARAM_PAYLOAD = 'payload';

	readonly trusted = true;

	constructor(
		public readonly workspace: IWorkspace,
		public readonly payload: object
	) { }

	async open(workspace: IWorkspace, options?: { reuse?: boolean, payload?: object }): Promise<boolean> {
		if (options?.reuse && !options.payload && this.isSame(this.workspace, workspace)) {
			return true; // return early if workspace and environment is not changing and we are reusing window
		}

		const targetHref = this.createTargetUrl(workspace, options);
		if (targetHref) {
			if (options?.reuse) {
				window.location.href = targetHref;
				return true;
			} else {
				let result;
				if (isStandalone) {
					result = window.open(targetHref, '_blank', 'toolbar=no'); // ensures to open another 'standalone' window!
				} else {
					result = window.open(targetHref);
				}

				return !!result;
			}
		}
		return false;
	}

	private createTargetUrl(workspace: IWorkspace, options?: { reuse?: boolean, payload?: object }): string | undefined {

		// Empty
		let targetHref: string | undefined = undefined;
		if (!workspace) {
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_EMPTY_WINDOW}=true`;
		}

		// Folder
		else if (isFolderToOpen(workspace)) {
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_FOLDER}=${encodeURIComponent(workspace.folderUri.toString())}`;
		}

		// Workspace
		else if (isWorkspaceToOpen(workspace)) {
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_WORKSPACE}=${encodeURIComponent(workspace.workspaceUri.toString())}`;
		}

		// Append payload if any
		if (options?.payload) {
			targetHref += `&${WorkspaceProvider.QUERY_PARAM_PAYLOAD}=${encodeURIComponent(JSON.stringify(options.payload))}`;
		}

		return targetHref;
	}

	private isSame(workspaceA: IWorkspace, workspaceB: IWorkspace): boolean {
		if (!workspaceA || !workspaceB) {
			return workspaceA === workspaceB; // both empty
		}

		if (isFolderToOpen(workspaceA) && isFolderToOpen(workspaceB)) {
			return isEqual(workspaceA.folderUri, workspaceB.folderUri); // same workspace
		}

		if (isWorkspaceToOpen(workspaceA) && isWorkspaceToOpen(workspaceB)) {
			return isEqual(workspaceA.workspaceUri, workspaceB.workspaceUri); // same workspace
		}

		return false;
	}

	hasRemote(): boolean {
		if (this.workspace) {
			if (isFolderToOpen(this.workspace)) {
				return this.workspace.folderUri.scheme === Schemas.vscodeRemote;
			}

			if (isWorkspaceToOpen(this.workspace)) {
				return this.workspace.workspaceUri.scheme === Schemas.vscodeRemote;
			}
		}

		return true;
	}
}

class WindowIndicator implements IWindowIndicator {

	readonly onDidChange = Event.None;

	readonly label: string;
	readonly tooltip: string;
	readonly command: string | undefined;

	constructor(workspace: IWorkspace) {
		let repositoryOwner: string | undefined = undefined;
		let repositoryName: string | undefined = undefined;

		if (workspace) {
			let uri: URI | undefined = undefined;
			if (isFolderToOpen(workspace)) {
				uri = workspace.folderUri;
			} else if (isWorkspaceToOpen(workspace)) {
				uri = workspace.workspaceUri;
			}

			if (uri?.scheme === 'github' || uri?.scheme === 'codespace') {
				[repositoryOwner, repositoryName] = uri.authority.split('+');
			}
		}

		// Repo
		if (repositoryName && repositoryOwner) {
			this.label = localize('playgroundLabelRepository', "$(remote) VS Code Web Playground: {0}/{1}", repositoryOwner, repositoryName);
			this.tooltip = localize('playgroundRepositoryTooltip', "VS Code Web Playground: {0}/{1}", repositoryOwner, repositoryName);
		}

		// No Repo
		else {
			this.label = localize('playgroundLabel', "$(remote) VS Code Web Playground");
			this.tooltip = localize('playgroundTooltip', "VS Code Web Playground");
		}
	}
}

(function () {

	// Find config by checking for DOM
	const configElement = document.getElementById('vscode-workbench-web-configuration');
	const configElementAttribute = configElement ? configElement.getAttribute('data-settings') : undefined;
	if (!configElement || !configElementAttribute) {
		throw new Error('Missing web configuration element');
	}

	const config: IWorkbenchConstructionOptions & { folderUri?: UriComponents, workspaceUri?: UriComponents } = JSON.parse(configElementAttribute);

	// Find workspace to open and payload
	let foundWorkspace = false;
	let workspace: IWorkspace;
	let payload = Object.create(null);
	let logLevel: string | undefined = undefined;

	const query = new URL(document.location.href).searchParams;
	query.forEach((value, key) => {
		switch (key) {

			// Folder
			case WorkspaceProvider.QUERY_PARAM_FOLDER:
				workspace = { folderUri: URI.parse(value) };
				foundWorkspace = true;
				break;

			// Workspace
			case WorkspaceProvider.QUERY_PARAM_WORKSPACE:
				workspace = { workspaceUri: URI.parse(value) };
				foundWorkspace = true;
				break;

			// Empty
			case WorkspaceProvider.QUERY_PARAM_EMPTY_WINDOW:
				workspace = undefined;
				foundWorkspace = true;
				break;

			// Payload
			case WorkspaceProvider.QUERY_PARAM_PAYLOAD:
				try {
					payload = JSON.parse(value);
				} catch (error) {
					console.error(error); // possible invalid JSON
				}
				break;

			// Log level
			case 'logLevel':
				logLevel = value;
				break;
		}
	});

	// If no workspace is provided through the URL, check for config attribute from server
	if (!foundWorkspace) {
		if (config.folderUri) {
			workspace = { folderUri: URI.revive(config.folderUri) };
		} else if (config.workspaceUri) {
			workspace = { workspaceUri: URI.revive(config.workspaceUri) };
		} else {
			workspace = undefined;
		}
	}

	// Workspace Provider
	const workspaceProvider = new WorkspaceProvider(workspace, payload);

	// Home Indicator
	const homeIndicator: IHomeIndicator = {
		href: 'https://github.com/microsoft/vscode',
		icon: 'code',
		title: localize('home', "Home")
	};

	// Window indicator (unless connected to a remote)
	let windowIndicator: WindowIndicator | undefined = undefined;
	if (!workspaceProvider.hasRemote()) {
		windowIndicator = new WindowIndicator(workspace);
	}

	// Product Quality Change Handler
	const productQualityChangeHandler: IProductQualityChangeHandler = (quality) => {
		let queryString = `quality=${quality}`;

		// Save all other query params we might have
		const query = new URL(document.location.href).searchParams;
		query.forEach((value, key) => {
			if (key !== 'quality') {
				queryString += `&${key}=${value}`;
			}
		});

		window.location.href = `${window.location.origin}?${queryString}`;
	};

	// settings sync options
	const settingsSyncOptions: ISettingsSyncOptions | undefined = config.settingsSyncOptions ? {
		enabled: config.settingsSyncOptions.enabled,
		enablementHandler: (enablement) => {
			let queryString = `settingsSync=${enablement ? 'true' : 'false'}`;

			// Save all other query params we might have
			const query = new URL(document.location.href).searchParams;
			query.forEach((value, key) => {
				if (key !== 'settingsSync') {
					queryString += `&${key}=${value}`;
				}
			});

			window.location.href = `${window.location.origin}?${queryString}`;
		}
	} : undefined;

	// Finally create workbench
	create(document.body, {
		...config,
		developmentOptions: {
			logLevel: logLevel ? parseLogLevel(logLevel) : undefined,
			...config.developmentOptions
		},
		settingsSyncOptions,
		homeIndicator,
		windowIndicator,
		productQualityChangeHandler,
		workspaceProvider,
		urlCallbackProvider: new PollingURLCallbackProvider(),
		credentialsProvider: new LocalStorageCredentialsProvider()
	});
})();
