/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IExtensionManifest, ExtensionKind, ExtensionIdentifier, ExtensionUntrustedWorkpaceSupportType } from 'vs/platform/extensions/common/extensions';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { IProductService } from 'vs/platform/product/common/productService';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ExtensionUntrustedWorkspaceSupport } from 'vs/base/common/product';
import { Disposable } from 'vs/base/common/lifecycle';
import { isWorkspaceTrustEnabled, WORKSPACE_TRUST_EXTENSION_SUPPORT } from 'vs/workbench/services/workspaces/common/workspaceTrust';

export const IExtensionManifestPropertiesService = createDecorator<IExtensionManifestPropertiesService>('extensionManifestPropertiesService');

export interface IExtensionManifestPropertiesService {
	readonly _serviceBrand: undefined;

	prefersExecuteOnUI(manifest: IExtensionManifest): boolean;
	prefersExecuteOnWorkspace(manifest: IExtensionManifest): boolean;
	prefersExecuteOnWeb(manifest: IExtensionManifest): boolean;

	canExecuteOnUI(manifest: IExtensionManifest): boolean;
	canExecuteOnWorkspace(manifest: IExtensionManifest): boolean;
	canExecuteOnWeb(manifest: IExtensionManifest): boolean;

	getExtensionKind(manifest: IExtensionManifest): ExtensionKind[];
	getExtensionUntrustedWorkspaceSupportType(manifest: IExtensionManifest): ExtensionUntrustedWorkpaceSupportType;
	canSupportVirtualWorkspace(manifest: IExtensionManifest): boolean;
}

export class ExtensionManifestPropertiesService extends Disposable implements IExtensionManifestPropertiesService {

	readonly _serviceBrand: undefined;

	private _uiExtensionPoints: Set<string> | null = null;
	private _productExtensionKindsMap: Map<string, ExtensionKind[]> | null = null;
	private _configuredExtensionKindsMap: Map<string, ExtensionKind | ExtensionKind[]> | null = null;

	private _productVirtualWorkspaceSupportMap: Map<string, { default?: boolean, override?: boolean }> | null = null;
	private _configuredVirtualWorkspaceSupportMap: Map<string, boolean> | null = null;

	private readonly _configuredExtensionWorkspaceTrustRequestMap: Map<string, { supported: ExtensionUntrustedWorkpaceSupportType, version?: string }>;
	private readonly _productExtensionWorkspaceTrustRequestMap: Map<string, ExtensionUntrustedWorkspaceSupport>;

	constructor(
		@IProductService private readonly productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		// Workspace trust request type (settings.json)
		this._configuredExtensionWorkspaceTrustRequestMap = new Map<string, { supported: ExtensionUntrustedWorkpaceSupportType, version?: string }>();
		const configuredExtensionWorkspaceTrustRequests = configurationService.inspect<{ [key: string]: { supported: ExtensionUntrustedWorkpaceSupportType, version?: string } }>(WORKSPACE_TRUST_EXTENSION_SUPPORT).userValue || {};
		for (const id of Object.keys(configuredExtensionWorkspaceTrustRequests)) {
			this._configuredExtensionWorkspaceTrustRequestMap.set(ExtensionIdentifier.toKey(id), configuredExtensionWorkspaceTrustRequests[id]);
		}

		// Workpace trust request type (products.json)
		this._productExtensionWorkspaceTrustRequestMap = new Map<string, ExtensionUntrustedWorkspaceSupport>();
		if (productService.extensionUntrustedWorkspaceSupport) {
			for (const id of Object.keys(productService.extensionUntrustedWorkspaceSupport)) {
				this._productExtensionWorkspaceTrustRequestMap.set(ExtensionIdentifier.toKey(id), productService.extensionUntrustedWorkspaceSupport[id]);
			}
		}
	}

	prefersExecuteOnUI(manifest: IExtensionManifest): boolean {
		const extensionKind = this.getExtensionKind(manifest);
		return (extensionKind.length > 0 && extensionKind[0] === 'ui');
	}

	prefersExecuteOnWorkspace(manifest: IExtensionManifest): boolean {
		const extensionKind = this.getExtensionKind(manifest);
		return (extensionKind.length > 0 && extensionKind[0] === 'workspace');
	}

	prefersExecuteOnWeb(manifest: IExtensionManifest): boolean {
		const extensionKind = this.getExtensionKind(manifest);
		return (extensionKind.length > 0 && extensionKind[0] === 'web');
	}

	canExecuteOnUI(manifest: IExtensionManifest): boolean {
		const extensionKind = this.getExtensionKind(manifest);
		return extensionKind.some(kind => kind === 'ui');
	}

	canExecuteOnWorkspace(manifest: IExtensionManifest): boolean {
		const extensionKind = this.getExtensionKind(manifest);
		return extensionKind.some(kind => kind === 'workspace');
	}

	canExecuteOnWeb(manifest: IExtensionManifest): boolean {
		const extensionKind = this.getExtensionKind(manifest);
		return extensionKind.some(kind => kind === 'web');
	}

	getExtensionKind(manifest: IExtensionManifest): ExtensionKind[] {
		// check in config
		let result = this.getConfiguredExtensionKind(manifest);
		if (typeof result !== 'undefined') {
			return this.toArray(result);
		}

		// check product.json
		result = this.getProductExtensionKind(manifest);
		if (typeof result !== 'undefined') {
			return result;
		}

		// check the manifest itself
		result = manifest.extensionKind;
		if (typeof result !== 'undefined') {
			return this.toArray(result);
		}

		return this.deduceExtensionKind(manifest);
	}

	getExtensionUntrustedWorkspaceSupportType(manifest: IExtensionManifest): ExtensionUntrustedWorkpaceSupportType {
		// Workspace trust feature is disabled, or extension has no entry point
		if (!isWorkspaceTrustEnabled(this.configurationService) || !manifest.main) {
			return true;
		}

		// Get extension workspace trust requirements from settings.json
		const configuredWorkspaceTrustRequest = this.getConfiguredExtensionWorkspaceTrustRequest(manifest);

		// Get extension workspace trust requirements from product.json
		const productWorkspaceTrustRequest = this.getProductExtensionWorkspaceTrustRequest(manifest);

		// Use settings.json override value if it exists
		if (configuredWorkspaceTrustRequest) {
			return configuredWorkspaceTrustRequest;
		}

		// Use product.json override value if it exists
		if (productWorkspaceTrustRequest?.override) {
			return productWorkspaceTrustRequest.override;
		}

		// Use extension manifest value if it exists
		if (manifest.capabilities?.untrustedWorkspaces?.supported !== undefined) {
			return manifest.capabilities.untrustedWorkspaces.supported;
		}

		// Use product.json default value if it exists
		if (productWorkspaceTrustRequest?.default) {
			return productWorkspaceTrustRequest.default;
		}

		return false;
	}

	canSupportVirtualWorkspace(manifest: IExtensionManifest): boolean {
		// check user configured
		const userConfiguredVirtualWorkspaceSupport = this.getConfiguredVirtualWorkspaceSupport(manifest);
		if (userConfiguredVirtualWorkspaceSupport !== undefined) {
			return userConfiguredVirtualWorkspaceSupport;
		}

		const productConfiguredWorkspaceSchemes = this.getProductVirtualWorkspaceSupport(manifest);

		// check override from product
		if (productConfiguredWorkspaceSchemes?.override !== undefined) {
			return productConfiguredWorkspaceSchemes.override;
		}

		// check the manifest
		if (manifest.capabilities?.virtualWorkspaces !== undefined) {
			return manifest.capabilities?.virtualWorkspaces;
		}

		// check default from product
		if (productConfiguredWorkspaceSchemes?.default !== undefined) {
			return productConfiguredWorkspaceSchemes.default;
		}

		// Default - supports virtual workspace
		return true;
	}

	deduceExtensionKind(manifest: IExtensionManifest): ExtensionKind[] {
		// Not an UI extension if it has main
		if (manifest.main) {
			if (manifest.browser) {
				return ['workspace', 'web'];
			}
			return ['workspace'];
		}

		if (manifest.browser) {
			return ['web'];
		}

		// Not an UI nor web extension if it has dependencies or an extension pack
		if (isNonEmptyArray(manifest.extensionDependencies) || isNonEmptyArray(manifest.extensionPack)) {
			return ['workspace'];
		}

		if (manifest.contributes) {
			// Not an UI nor web extension if it has no ui contributions
			for (const contribution of Object.keys(manifest.contributes)) {
				if (!this.isUIExtensionPoint(contribution)) {
					return ['workspace'];
				}
			}
		}

		return ['ui', 'workspace', 'web'];
	}

	private isUIExtensionPoint(extensionPoint: string): boolean {
		if (this._uiExtensionPoints === null) {
			const uiExtensionPoints = new Set<string>();
			ExtensionsRegistry.getExtensionPoints().filter(e => e.defaultExtensionKind !== 'workspace').forEach(e => {
				uiExtensionPoints.add(e.name);
			});
			this._uiExtensionPoints = uiExtensionPoints;
		}
		return this._uiExtensionPoints.has(extensionPoint);
	}

	private getProductExtensionKind(manifest: IExtensionManifest): ExtensionKind[] | undefined {
		if (this._productExtensionKindsMap === null) {
			const productExtensionKindsMap = new Map<string, ExtensionKind[]>();
			if (this.productService.extensionKind) {
				for (const id of Object.keys(this.productService.extensionKind)) {
					productExtensionKindsMap.set(ExtensionIdentifier.toKey(id), this.productService.extensionKind[id]);
				}
			}
			this._productExtensionKindsMap = productExtensionKindsMap;
		}

		const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
		return this._productExtensionKindsMap.get(ExtensionIdentifier.toKey(extensionId));
	}

	private getConfiguredExtensionKind(manifest: IExtensionManifest): ExtensionKind | ExtensionKind[] | undefined {
		if (this._configuredExtensionKindsMap === null) {
			const configuredExtensionKindsMap = new Map<string, ExtensionKind | ExtensionKind[]>();
			const configuredExtensionKinds = this.configurationService.getValue<{ [key: string]: ExtensionKind | ExtensionKind[] }>('remote.extensionKind') || {};
			for (const id of Object.keys(configuredExtensionKinds)) {
				configuredExtensionKindsMap.set(ExtensionIdentifier.toKey(id), configuredExtensionKinds[id]);
			}
			this._configuredExtensionKindsMap = configuredExtensionKindsMap;
		}

		const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
		return this._configuredExtensionKindsMap.get(ExtensionIdentifier.toKey(extensionId));
	}

	private getProductVirtualWorkspaceSupport(manifest: IExtensionManifest): { default?: boolean, override?: boolean } | undefined {
		if (this._productVirtualWorkspaceSupportMap === null) {
			const productWorkspaceSchemesMap = new Map<string, { default?: boolean, override?: boolean }>();
			if (this.productService.extensionVirtualWorkspacesSupport) {
				for (const id of Object.keys(this.productService.extensionVirtualWorkspacesSupport)) {
					productWorkspaceSchemesMap.set(ExtensionIdentifier.toKey(id), this.productService.extensionVirtualWorkspacesSupport[id]);
				}
			}
			this._productVirtualWorkspaceSupportMap = productWorkspaceSchemesMap;
		}

		const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
		return this._productVirtualWorkspaceSupportMap.get(ExtensionIdentifier.toKey(extensionId));
	}

	private getConfiguredVirtualWorkspaceSupport(manifest: IExtensionManifest): boolean | undefined {
		if (this._configuredVirtualWorkspaceSupportMap === null) {
			const configuredWorkspaceSchemesMap = new Map<string, boolean>();
			const configuredWorkspaceSchemes = this.configurationService.getValue<{ [key: string]: boolean }>('extensions.supportVirtualWorkspaces') || {};
			for (const id of Object.keys(configuredWorkspaceSchemes)) {
				if (configuredWorkspaceSchemes[id] !== undefined) {
					configuredWorkspaceSchemesMap.set(ExtensionIdentifier.toKey(id), configuredWorkspaceSchemes[id]);
				}
			}
			this._configuredVirtualWorkspaceSupportMap = configuredWorkspaceSchemesMap;
		}

		const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
		return this._configuredVirtualWorkspaceSupportMap.get(ExtensionIdentifier.toKey(extensionId));
	}

	private getConfiguredExtensionWorkspaceTrustRequest(manifest: IExtensionManifest): ExtensionUntrustedWorkpaceSupportType | undefined {
		const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
		const extensionWorkspaceTrustRequest = this._configuredExtensionWorkspaceTrustRequestMap.get(ExtensionIdentifier.toKey(extensionId));

		if (extensionWorkspaceTrustRequest && (extensionWorkspaceTrustRequest.version === undefined || extensionWorkspaceTrustRequest.version === manifest.version)) {
			return extensionWorkspaceTrustRequest.supported;
		}

		return undefined;
	}

	private getProductExtensionWorkspaceTrustRequest(manifest: IExtensionManifest): ExtensionUntrustedWorkspaceSupport | undefined {
		const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
		return this._productExtensionWorkspaceTrustRequestMap.get(ExtensionIdentifier.toKey(extensionId));
	}

	private toArray(extensionKind: ExtensionKind | ExtensionKind[]): ExtensionKind[] {
		if (Array.isArray(extensionKind)) {
			return extensionKind;
		}
		return extensionKind === 'ui' ? ['ui', 'workspace'] : [extensionKind];
	}
}

registerSingleton(IExtensionManifestPropertiesService, ExtensionManifestPropertiesService);
