/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

export default class API {
	public static fromSimpleString(value: string): API {
		return new API(value, value, value);
	}

	public static readonly defaultVersion = API.fromSimpleString('1.0.0');
	public static readonly v240 = API.fromSimpleString('2.4.0');
	public static readonly v250 = API.fromSimpleString('2.5.0');
	public static readonly v260 = API.fromSimpleString('2.6.0');
	public static readonly v270 = API.fromSimpleString('2.7.0');
	public static readonly v280 = API.fromSimpleString('2.8.0');
	public static readonly v290 = API.fromSimpleString('2.9.0');
	public static readonly v291 = API.fromSimpleString('2.9.1');
	public static readonly v300 = API.fromSimpleString('3.0.0');
	public static readonly v310 = API.fromSimpleString('3.1.0');
	public static readonly v314 = API.fromSimpleString('3.1.4');
	public static readonly v320 = API.fromSimpleString('3.2.0');
	public static readonly v333 = API.fromSimpleString('3.3.3');
	public static readonly v340 = API.fromSimpleString('3.4.0');
	public static readonly v345 = API.fromSimpleString('3.4.5');
	public static readonly v350 = API.fromSimpleString('3.5.0');
	public static readonly v380 = API.fromSimpleString('3.8.0');
	public static readonly v381 = API.fromSimpleString('3.8.1');
	public static readonly v390 = API.fromSimpleString('3.9.0');
	public static readonly v400 = API.fromSimpleString('4.0.0');
	public static readonly v401 = API.fromSimpleString('4.0.1');
	public static readonly v420 = API.fromSimpleString('4.2.0');
	public static readonly v430 = API.fromSimpleString('4.3.0');

	public static fromVersionString(versionString: string): API {
		let version = semver.valid(versionString);
		if (!version) {
			return new API(localize('invalidVersion', 'invalid version'), '1.0.0', '1.0.0');
		}

		// Cut off any prerelease tag since we sometimes consume those on purpose.
		const index = versionString.indexOf('-');
		if (index >= 0) {
			version = version.substr(0, index);
		}
		return new API(versionString, version, versionString);
	}

	private constructor(
		/**
		 * Human readable string for the current version. Displayed in the UI
		 */
		public readonly displayName: string,

		/**
		 * Semver version, e.g. '3.9.0'
		 */
		public readonly version: string,

		/**
		 * Full version string including pre-release tags, e.g. '3.9.0-beta'
		 */
		public readonly fullVersionString: string,
	) { }

	public eq(other: API): boolean {
		return semver.eq(this.version, other.version);
	}

	public gte(other: API): boolean {
		return semver.gte(this.version, other.version);
	}

	public lt(other: API): boolean {
		return !this.gte(other);
	}
}
