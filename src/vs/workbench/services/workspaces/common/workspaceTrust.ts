/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { splitName } from 'vs/base/common/labels';
import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { isWeb } from 'vs/base/common/platform';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { WorkspaceTrustRequestOptions, IWorkspaceTrustManagementService, IWorkspaceTrustInfo, IWorkspaceTrustUriInfo, IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust';
import { isSingleFolderWorkspaceIdentifier, isUntitledWorkspace, toWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export const WORKSPACE_TRUST_ENABLED = 'security.workspace.trust.enabled';
export const WORKSPACE_TRUST_STARTUP_PROMPT = 'security.workspace.trust.startupPrompt';
export const WORKSPACE_TRUST_EXTENSION_SUPPORT = 'extensions.supportUntrustedWorkspaces';
export const WORKSPACE_TRUST_STORAGE_KEY = 'content.trust.model.key';

export const WorkspaceTrustContext = {
	IsTrusted: new RawContextKey<boolean>('isWorkspaceTrusted', false, localize('workspaceTrustCtx', "Whether the current workspace has been trusted by the user."))
};

export function isWorkspaceTrustEnabled(configurationService: IConfigurationService): boolean {
	if (isWeb) {
		return false;
	}

	return configurationService.inspect<boolean>(WORKSPACE_TRUST_ENABLED).userValue ?? false;
}

export class WorkspaceTrustManagementService extends Disposable implements IWorkspaceTrustManagementService {

	_serviceBrand: undefined;

	private readonly storageKey = WORKSPACE_TRUST_STORAGE_KEY;

	private readonly _onDidChangeTrust = this._register(new Emitter<boolean>());
	readonly onDidChangeTrust = this._onDidChangeTrust.event;

	private readonly _onDidChangeTrustedFolders = this._register(new Emitter<void>());
	readonly onDidChangeTrustedFolders = this._onDidChangeTrustedFolders.event;

	private _isWorkspaceTrusted: boolean = false;
	private _trustStateInfo: IWorkspaceTrustInfo;

	constructor(
		@IConfigurationService readonly configurationService: IConfigurationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IStorageService private readonly storageService: IStorageService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService
	) {
		super();

		this._trustStateInfo = this.loadTrustInfo();
		this._isWorkspaceTrusted = this.calculateWorkspaceTrust();

		this.registerListeners();
	}

	private set currentTrustState(trusted: boolean) {
		if (this._isWorkspaceTrusted === trusted) { return; }
		this._isWorkspaceTrusted = trusted;

		this._onDidChangeTrust.fire(trusted);
	}

	private registerListeners(): void {
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => this.currentTrustState = this.calculateWorkspaceTrust()));
		this._register(this.workspaceService.onDidChangeWorkbenchState(() => this.currentTrustState = this.calculateWorkspaceTrust()));
		this._register(this.storageService.onDidChangeValue(changeEvent => {
			if (changeEvent.key === this.storageKey) {
				this._trustStateInfo = this.loadTrustInfo();
				this.currentTrustState = this.calculateWorkspaceTrust();

				this._onDidChangeTrustedFolders.fire();
			}
		}));
	}

	private loadTrustInfo(): IWorkspaceTrustInfo {
		const infoAsString = this.storageService.get(this.storageKey, StorageScope.GLOBAL);

		let result: IWorkspaceTrustInfo | undefined;
		try {
			if (infoAsString) {
				result = JSON.parse(infoAsString);
			}
		} catch { }

		if (!result) {
			result = {
				uriTrustInfo: []
			};
		}

		if (!result.uriTrustInfo) {
			result.uriTrustInfo = [];
		}

		result.uriTrustInfo = result.uriTrustInfo.map(info => { return { uri: URI.revive(info.uri), trusted: info.trusted }; });
		result.uriTrustInfo = result.uriTrustInfo.filter(info => info.trusted);

		return result;
	}

	private saveTrustInfo(): void {
		this.storageService.store(this.storageKey, JSON.stringify(this._trustStateInfo), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	private calculateWorkspaceTrust(): boolean {
		if (!isWorkspaceTrustEnabled(this.configurationService)) {
			return true;
		}

		if (this.environmentService.extensionTestsLocationURI) {
			return true; // trust running tests with vscode-test
		}

		if (this.workspaceService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return true;
		}

		const workspaceUris = this.getWorkspaceUris();
		const trusted = this.getUrisTrust(workspaceUris);

		return trusted;
	}

	private getUrisTrust(uris: URI[]): boolean {
		let state = true;
		for (const uri of uris) {
			const { trusted } = this.getUriTrustInfo(uri);

			if (!trusted) {
				state = trusted;
				return state;
			}
		}

		return state;
	}

	private getWorkspaceUris(): URI[] {
		const workspaceUris = this.workspaceService.getWorkspace().folders.map(f => f.uri);
		const workspaceConfiguration = this.workspaceService.getWorkspace().configuration;
		if (workspaceConfiguration && !isUntitledWorkspace(workspaceConfiguration, this.environmentService)) {
			workspaceUris.push(workspaceConfiguration);
		}

		return workspaceUris;
	}

	public getUriTrustInfo(uri: URI): IWorkspaceTrustUriInfo {
		let resultState = false;
		let maxLength = -1;

		let resultUri = uri;

		for (const trustInfo of this._trustStateInfo.uriTrustInfo) {
			if (this.uriIdentityService.extUri.isEqualOrParent(uri, trustInfo.uri)) {
				const fsPath = trustInfo.uri.fsPath;
				if (fsPath.length > maxLength) {
					maxLength = fsPath.length;
					resultState = trustInfo.trusted;
					resultUri = trustInfo.uri;
				}
			}
		}

		return { trusted: resultState, uri: resultUri };
	}

	setUrisTrust(uris: URI[], trusted: boolean): void {
		let changed = false;

		for (const uri of uris) {
			if (trusted) {
				const foundItem = this._trustStateInfo.uriTrustInfo.find(trustInfo => this.uriIdentityService.extUri.isEqual(trustInfo.uri, uri));
				if (!foundItem) {
					this._trustStateInfo.uriTrustInfo.push({ uri, trusted: true });
					changed = true;
				}
			} else {
				const previousLength = this._trustStateInfo.uriTrustInfo.length;
				this._trustStateInfo.uriTrustInfo = this._trustStateInfo.uriTrustInfo.filter(trustInfo => !this.uriIdentityService.extUri.isEqual(trustInfo.uri, uri));
				if (previousLength !== this._trustStateInfo.uriTrustInfo.length) {
					changed = true;
				}
			}
		}

		if (changed) {
			this.saveTrustInfo();
		}
	}

	canSetWorkspaceTrust(): boolean {
		// Empty workspace
		if (this.workspaceService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return false;
		}

		// Untrusted workspace
		if (!this.isWorkpaceTrusted()) {
			return true;
		}

		// Trusted workspace
		// Can only be trusted explicitly in the single folder scenario
		const workspaceIdentifier = toWorkspaceIdentifier(this.workspaceService.getWorkspace());
		if (!(isSingleFolderWorkspaceIdentifier(workspaceIdentifier) && workspaceIdentifier.uri.scheme === Schemas.file)) {
			return false;
		}

		// If the current folder isn't trusted directly, return false
		const trustInfo = this.getUriTrustInfo(workspaceIdentifier.uri);
		if (!trustInfo.trusted || !isEqual(workspaceIdentifier.uri, trustInfo.uri)) {
			return false;
		}

		// Check if the parent is also trusted
		if (this.canSetParentFolderTrust()) {
			const { parentPath } = splitName(workspaceIdentifier.uri.fsPath);
			const parentIsTrusted = this.getUriTrustInfo(URI.file(parentPath)).trusted;
			if (parentIsTrusted) {
				return false;
			}
		}

		return true;
	}

	canSetParentFolderTrust(): boolean {
		const workspaceIdentifier = toWorkspaceIdentifier(this.workspaceService.getWorkspace());
		return isSingleFolderWorkspaceIdentifier(workspaceIdentifier) && workspaceIdentifier.uri.scheme === Schemas.file;
	}

	isWorkpaceTrusted(): boolean {
		return this._isWorkspaceTrusted;
	}

	setParentFolderTrust(trusted: boolean): void {
		const workspaceIdentifier = toWorkspaceIdentifier(this.workspaceService.getWorkspace());
		if (isSingleFolderWorkspaceIdentifier(workspaceIdentifier) && workspaceIdentifier.uri.scheme === Schemas.file) {
			const { parentPath } = splitName(workspaceIdentifier.uri.fsPath);

			this.setUrisTrust([URI.file(parentPath)], trusted);
		}
	}

	setWorkspaceTrust(trusted: boolean): void {
		const workspaceFolders = this.getWorkspaceUris();
		this.setUrisTrust(workspaceFolders, trusted);
	}

	getTrustedFolders(): URI[] {
		return this._trustStateInfo.uriTrustInfo.map(info => info.uri);
	}

	setTrustedFolders(folders: URI[]): void {
		this._trustStateInfo.uriTrustInfo = [];
		for (const folder of folders) {
			this._trustStateInfo.uriTrustInfo.push({
				trusted: true,
				uri: folder
			});
		}

		this.saveTrustInfo();
	}
}

export class WorkspaceTrustRequestService extends Disposable implements IWorkspaceTrustRequestService {
	_serviceBrand: undefined;

	private _trusted!: boolean;
	private _modalTrustRequestPromise?: Promise<boolean | undefined>;
	private _modalTrustRequestResolver?: (trusted: boolean | undefined) => void;
	private readonly _ctxWorkspaceTrustState: IContextKey<boolean>;

	private readonly _onDidInitiateWorkspaceTrustRequest = this._register(new Emitter<WorkspaceTrustRequestOptions | undefined>());
	readonly onDidInitiateWorkspaceTrustRequest = this._onDidInitiateWorkspaceTrustRequest.event;


	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
	) {
		super();

		this._register(this.workspaceTrustManagementService.onDidChangeTrust(trusted => this.onTrustStateChanged(trusted)));

		this._ctxWorkspaceTrustState = WorkspaceTrustContext.IsTrusted.bindTo(contextKeyService);

		this.trusted = this.workspaceTrustManagementService.isWorkpaceTrusted();
	}

	private get trusted(): boolean {
		return this._trusted;
	}

	private set trusted(trusted: boolean) {
		this._trusted = trusted;
		this._ctxWorkspaceTrustState.set(trusted);
	}

	private onTrustStateChanged(trusted: boolean): void {

		this.trusted = trusted;
	}

	cancelRequest(): void {
		if (this._modalTrustRequestResolver) {
			this._modalTrustRequestResolver(undefined);

			this._modalTrustRequestResolver = undefined;
			this._modalTrustRequestPromise = undefined;
		}
	}

	completeRequest(trusted?: boolean): void {
		if (this._modalTrustRequestResolver) {
			this._modalTrustRequestResolver(trusted ?? this.trusted);

			this._modalTrustRequestResolver = undefined;
			this._modalTrustRequestPromise = undefined;
		}

		if (trusted === undefined) {
			return;
		}

		this.workspaceTrustManagementService.setWorkspaceTrust(trusted);
	}

	async requestWorkspaceTrust(options?: WorkspaceTrustRequestOptions): Promise<boolean | undefined> {
		// Trusted workspace
		if (this.trusted) {
			return this.trusted;
		}

		// Modal request
		if (!this._modalTrustRequestPromise) {
			// Create promise
			this._modalTrustRequestPromise = new Promise(resolve => {
				this._modalTrustRequestResolver = resolve;
			});
		} else {
			// Return existing promise
			return this._modalTrustRequestPromise;
		}

		this._onDidInitiateWorkspaceTrustRequest.fire(options);

		return this._modalTrustRequestPromise;
	}
}

registerSingleton(IWorkspaceTrustRequestService, WorkspaceTrustRequestService);
