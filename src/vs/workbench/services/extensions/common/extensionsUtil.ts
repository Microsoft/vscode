/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IExtensionManifest, ExtensionKind, ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { IProductService } from 'vs/platform/product/common/productService';

export function prefersExecuteOnUI(manifest: IExtensionManifest, productService: IProductService, configurationService: IConfigurationService): boolean {
	const extensionKind = getExtensionKind(manifest, productService, configurationService);
	return (extensionKind.length > 0 && extensionKind[0] === 'ui');
}

export function prefersExecuteOnWorkspace(manifest: IExtensionManifest, productService: IProductService, configurationService: IConfigurationService): boolean {
	const extensionKind = getExtensionKind(manifest, productService, configurationService);
	return (extensionKind.length > 0 && extensionKind[0] === 'workspace');
}

export function prefersExecuteOnWeb(manifest: IExtensionManifest, productService: IProductService, configurationService: IConfigurationService): boolean {
	const extensionKind = getExtensionKind(manifest, productService, configurationService);
	return (extensionKind.length > 0 && extensionKind[0] === 'web');
}

export function canExecuteOnUI(manifest: IExtensionManifest, productService: IProductService, configurationService: IConfigurationService): boolean {
	const extensionKind = getExtensionKind(manifest, productService, configurationService);
	return extensionKind.some(kind => kind === 'ui');
}

export function canExecuteOnWorkspace(manifest: IExtensionManifest, productService: IProductService, configurationService: IConfigurationService): boolean {
	const extensionKind = getExtensionKind(manifest, productService, configurationService);
	return extensionKind.some(kind => kind === 'workspace');
}

export function canExecuteOnWeb(manifest: IExtensionManifest, productService: IProductService, configurationService: IConfigurationService): boolean {
	const extensionKind = getExtensionKind(manifest, productService, configurationService);
	return extensionKind.some(kind => kind === 'web');
}

export function getExtensionKind(manifest: IExtensionManifest, productService: IProductService, configurationService: IConfigurationService): ExtensionKind[] {
	// check in config
	let result = getConfiguredExtensionKind(manifest, configurationService);
	if (typeof result !== 'undefined') {
		return toArray(result);
	}

	// check product.json
	result = getProductExtensionKind(manifest, productService);
	if (typeof result !== 'undefined') {
		return result;
	}

	// check the manifest itself
	result = manifest.extensionKind;
	if (typeof result !== 'undefined') {
		return toArray(result);
	}

	return deduceExtensionKind(manifest);
}

export function deduceExtensionKind(manifest: IExtensionManifest): ExtensionKind[] {
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
			if (!isUIExtensionPoint(contribution)) {
				return ['workspace'];
			}
		}
	}

	return ['ui', 'workspace', 'web'];
}

let _uiExtensionPoints: Set<string> | null = null;
function isUIExtensionPoint(extensionPoint: string): boolean {
	if (_uiExtensionPoints === null) {
		const uiExtensionPoints = new Set<string>();
		ExtensionsRegistry.getExtensionPoints().filter(e => e.defaultExtensionKind !== 'workspace').forEach(e => {
			uiExtensionPoints.add(e.name);
		});
		_uiExtensionPoints = uiExtensionPoints;
	}
	return _uiExtensionPoints.has(extensionPoint);
}

let _productExtensionKindsMap: Map<string, ExtensionKind[]> | null = null;
function getProductExtensionKind(manifest: IExtensionManifest, productService: IProductService): ExtensionKind[] | undefined {
	if (_productExtensionKindsMap === null) {
		const productExtensionKindsMap = new Map<string, ExtensionKind[]>();
		if (productService.extensionKind) {
			for (const id of Object.keys(productService.extensionKind)) {
				productExtensionKindsMap.set(ExtensionIdentifier.toKey(id), productService.extensionKind[id]);
			}
		}
		_productExtensionKindsMap = productExtensionKindsMap;
	}

	const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
	return _productExtensionKindsMap.get(ExtensionIdentifier.toKey(extensionId));
}

let _configuredExtensionKindsMap: Map<string, ExtensionKind | ExtensionKind[]> | null = null;
function getConfiguredExtensionKind(manifest: IExtensionManifest, configurationService: IConfigurationService): ExtensionKind | ExtensionKind[] | undefined {
	if (_configuredExtensionKindsMap === null) {
		const configuredExtensionKindsMap = new Map<string, ExtensionKind | ExtensionKind[]>();
		const configuredExtensionKinds = configurationService.getValue<{ [key: string]: ExtensionKind | ExtensionKind[] }>('remote.extensionKind') || {};
		for (const id of Object.keys(configuredExtensionKinds)) {
			configuredExtensionKindsMap.set(ExtensionIdentifier.toKey(id), configuredExtensionKinds[id]);
		}
		_configuredExtensionKindsMap = configuredExtensionKindsMap;
	}

	const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
	return _configuredExtensionKindsMap.get(ExtensionIdentifier.toKey(extensionId));
}

function toArray(extensionKind: ExtensionKind | ExtensionKind[]): ExtensionKind[] {
	if (Array.isArray(extensionKind)) {
		return extensionKind;
	}
	return extensionKind === 'ui' ? ['ui', 'workspace'] : [extensionKind];
}
