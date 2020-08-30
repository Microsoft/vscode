/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

export interface IParsedVersion {
	hasCaret: boolean;
	hasGreaterEquals: boolean;
	majorBase: number;
	majorMustEqual: boolean;
	minorBase: number;
	minorMustEqual: boolean;
	patchBase: number;
	patchMustEqual: boolean;
	preRelease: string | null;
}

export interface INormalizedVersion {
	majorBase: number;
	majorMustEqual: boolean;
	minorBase: number;
	minorMustEqual: boolean;
	patchBase: number;
	patchMustEqual: boolean;
	isMinimum: boolean;
}

const VERSION_REGEXP = /^(\^|>=)?((\d+)|x)\.((\d+)|x)\.((\d+)|x)(\-.*)?$/;

export function isValidVersionStr(version: string): boolean {
	version = version.trim();
	return (version === '*' || VERSION_REGEXP.test(version));
}

export function parseVersion(version: string): IParsedVersion | null {
	if (!isValidVersionStr(version)) {
		return null;
	}

	version = version.trim();

	if (version === '*') {
		return {
			hasCaret: false,
			hasGreaterEquals: false,
			majorBase: 0,
			majorMustEqual: false,
			minorBase: 0,
			minorMustEqual: false,
			patchBase: 0,
			patchMustEqual: false,
			preRelease: null
		};
	}

	let m = version.match(VERSION_REGEXP);
	if (!m) {
		return null;
	}
	return {
		hasCaret: m[1] === '^',
		hasGreaterEquals: m[1] === '>=',
		majorBase: m[2] === 'x' ? 0 : parseInt(m[2], 10),
		majorMustEqual: (m[2] === 'x' ? false : true),
		minorBase: m[4] === 'x' ? 0 : parseInt(m[4], 10),
		minorMustEqual: (m[4] === 'x' ? false : true),
		patchBase: m[6] === 'x' ? 0 : parseInt(m[6], 10),
		patchMustEqual: (m[6] === 'x' ? false : true),
		preRelease: m[8] || null
	};
}

export function normalizeVersion(version: IParsedVersion | null): INormalizedVersion | null {
	if (!version) {
		return null;
	}

	let majorBase = version.majorBase,
		majorMustEqual = version.majorMustEqual,
		minorBase = version.minorBase,
		minorMustEqual = version.minorMustEqual,
		patchBase = version.patchBase,
		patchMustEqual = version.patchMustEqual;

	if (version.hasCaret) {
		if (majorBase === 0) {
			patchMustEqual = false;
		} else {
			minorMustEqual = false;
			patchMustEqual = false;
		}
	}

	return {
		majorBase: majorBase,
		majorMustEqual: majorMustEqual,
		minorBase: minorBase,
		minorMustEqual: minorMustEqual,
		patchBase: patchBase,
		patchMustEqual: patchMustEqual,
		isMinimum: version.hasGreaterEquals
	};
}

export function isValidVersion(_version: string | INormalizedVersion, _desiredVersion: string | INormalizedVersion): boolean {
	let version: INormalizedVersion | null;
	if (typeof _version === 'string') {
		version = normalizeVersion(parseVersion(_version));
	} else {
		version = _version;
	}

	let desiredVersion: INormalizedVersion | null;
	if (typeof _desiredVersion === 'string') {
		desiredVersion = normalizeVersion(parseVersion(_desiredVersion));
	} else {
		desiredVersion = _desiredVersion;
	}

	if (!version || !desiredVersion) {
		return false;
	}

	let majorBase = version.majorBase;
	let minorBase = version.minorBase;
	let patchBase = version.patchBase;

	let desiredMajorBase = desiredVersion.majorBase;
	let desiredMinorBase = desiredVersion.minorBase;
	let desiredPatchBase = desiredVersion.patchBase;

	let majorMustEqual = desiredVersion.majorMustEqual;
	let minorMustEqual = desiredVersion.minorMustEqual;
	let patchMustEqual = desiredVersion.patchMustEqual;

	if (desiredVersion.isMinimum) {
		if (majorBase > desiredMajorBase) {
			return true;
		}

		if (majorBase < desiredMajorBase) {
			return false;
		}

		if (minorBase > desiredMinorBase) {
			return true;
		}

		if (minorBase < desiredMinorBase) {
			return false;
		}

		return patchBase >= desiredPatchBase;
	}

	// Anything < 1.0.0 is compatible with >= 1.0.0, except exact matches
	if (majorBase === 1 && desiredMajorBase === 0 && (!majorMustEqual || !minorMustEqual || !patchMustEqual)) {
		desiredMajorBase = 1;
		desiredMinorBase = 0;
		desiredPatchBase = 0;
		majorMustEqual = true;
		minorMustEqual = false;
		patchMustEqual = false;
	}

	if (majorBase < desiredMajorBase) {
		// smaller major version
		return false;
	}

	if (majorBase > desiredMajorBase) {
		// higher major version
		return (!majorMustEqual);
	}

	// at this point, majorBase are equal

	if (minorBase < desiredMinorBase) {
		// smaller minor version
		return false;
	}

	if (minorBase > desiredMinorBase) {
		// higher minor version
		return (!minorMustEqual);
	}

	// at this point, minorBase are equal

	if (patchBase < desiredPatchBase) {
		// smaller patch version
		return false;
	}

	if (patchBase > desiredPatchBase) {
		// higher patch version
		return (!patchMustEqual);
	}

	// at this point, patchBase are equal
	return true;
}

export interface IReducedExtensionDescription {
	isBuiltin: boolean;
	engines: {
		vscode: string;
	};
	main?: string;
}

export function isValidExtensionVersion(version: string, extensionDesc: IReducedExtensionDescription, notices: string[]): boolean {

	if (extensionDesc.isBuiltin || typeof extensionDesc.main === 'undefined') {
		// No version check for builtin or declarative extensions
		return true;
	}

	return isVersionValid(version, extensionDesc.engines.vscode, notices);
}

export function isEngineValid(engine: string, version: string): boolean {
	// TODO@joao: discuss with alex '*' doesn't seem to be a valid engine version
	return engine === '*' || isVersionValid(version, engine);
}

export function isVersionValid(currentVersion: string, requestedVersion: string, notices: string[] = []): boolean {

	let desiredVersion = normalizeVersion(parseVersion(requestedVersion));
	if (!desiredVersion) {
		notices.push(nls.localize('versionSyntax', "Could not parse `engines.vscode` value {0}. Please use, for example: ^1.22.0, ^1.22.x, etc.", requestedVersion));
		return false;
	}

	// enforce that a breaking API version is specified.
	// for 0.X.Y, that means up to 0.X must be specified
	// otherwise for Z.X.Y, that means Z must be specified
	if (desiredVersion.majorBase === 0) {
		// force that major and minor must be specific
		if (!desiredVersion.majorMustEqual || !desiredVersion.minorMustEqual) {
			notices.push(nls.localize('versionSpecificity1', "Version specified in `engines.vscode` ({0}) is not specific enough. For vscode versions before 1.0.0, please define at a minimum the major and minor desired version. E.g. ^0.10.0, 0.10.x, 0.11.0, etc.", requestedVersion));
			return false;
		}
	} else {
		// force that major must be specific
		if (!desiredVersion.majorMustEqual) {
			notices.push(nls.localize('versionSpecificity2', "Version specified in `engines.vscode` ({0}) is not specific enough. For vscode versions after 1.0.0, please define at a minimum the major desired version. E.g. ^1.10.0, 1.10.x, 1.x.x, 2.x.x, etc.", requestedVersion));
			return false;
		}
	}

	if (!isValidVersion(currentVersion, desiredVersion)) {
		notices.push(nls.localize('versionMismatch', "Extension is not compatible with Code {0}. Extension requires: {1}.", currentVersion, requestedVersion));
		return false;
	}

	return true;
}
