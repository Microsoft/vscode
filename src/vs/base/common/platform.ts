/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const LANGUAGE_DEFAULT = 'en';

let _isWindows = false;
let _isMacintosh = false;
let _isLinux = false;
let _isNative = false;
let _isWeb = false;
let _isIOS = false;
let _locale: string | undefined = undefined;
let _language: string = LANGUAGE_DEFAULT;
let _translationsConfigFile: string | undefined = undefined;
let _userAgent: string | undefined = undefined;

interface NLSConfig {
	locale: string;
	availableLanguages: { [key: string]: string; };
	_translationsConfigFile: string;
}

export interface IProcessEnvironment {
	[key: string]: string;
}

interface INodeProcess {
	platform: string;
	env: IProcessEnvironment;
	getuid(): number;
	nextTick: Function;
	versions?: {
		electron?: string;
	};
	type?: string;
}
declare const process: INodeProcess;
declare const global: any;

interface INavigator {
	userAgent: string;
	language: string;
	maxTouchPoints?: number;
}
declare const navigator: INavigator;
declare const self: any;

const isElectronRenderer = (typeof process !== 'undefined' && typeof process.versions !== 'undefined' && typeof process.versions.electron !== 'undefined' && process.type === 'renderer');

// OS detection
if (typeof navigator === 'object' && !isElectronRenderer) {
	_userAgent = navigator.userAgent;
	_isWindows = _userAgent.indexOf('Windows') >= 0;
	_isMacintosh = _userAgent.indexOf('Macintosh') >= 0;
	_isIOS = (_userAgent.indexOf('Macintosh') >= 0 || _userAgent.indexOf('iPad') >= 0 || _userAgent.indexOf('iPhone') >= 0) && !!navigator.maxTouchPoints && navigator.maxTouchPoints > 0;
	_isLinux = _userAgent.indexOf('Linux') >= 0;
	_isWeb = true;
	_locale = navigator.language;
	_language = _locale;
} else if (typeof process === 'object') {
	_isWindows = (process.platform === 'win32');
	_isMacintosh = (process.platform === 'darwin');
	_isLinux = (process.platform === 'linux');
	_locale = LANGUAGE_DEFAULT;
	_language = LANGUAGE_DEFAULT;
	const rawNlsConfig = process.env['VSCODE_NLS_CONFIG'];
	if (rawNlsConfig) {
		try {
			const nlsConfig: NLSConfig = JSON.parse(rawNlsConfig);
			const resolved = nlsConfig.availableLanguages['*'];
			_locale = nlsConfig.locale;
			// VSCode's default language is 'en'
			_language = resolved ? resolved : LANGUAGE_DEFAULT;
			_translationsConfigFile = nlsConfig._translationsConfigFile;
		} catch (e) {
		}
	}
	_isNative = true;
}

export const enum Platform {
	Web,
	Mac,
	Linux,
	Windows
}
export function PlatformToString(platform: Platform) {
	switch (platform) {
		case Platform.Web: return 'Web';
		case Platform.Mac: return 'Mac';
		case Platform.Linux: return 'Linux';
		case Platform.Windows: return 'Windows';
	}
}

let _platform: Platform = Platform.Web;
if (_isMacintosh) {
	_platform = Platform.Mac;
} else if (_isWindows) {
	_platform = Platform.Windows;
} else if (_isLinux) {
	_platform = Platform.Linux;
}

export const isWindows = _isWindows;
export const isMacintosh = _isMacintosh;
export const isLinux = _isLinux;
export const isNative = _isNative;
export const isWeb = _isWeb;
export const isIOS = _isIOS;
export const platform = _platform;
export const userAgent = _userAgent;

export function isRootUser(): boolean {
	return _isNative && !_isWindows && (process.getuid() === 0);
}

/**
 * The language used for the user interface. The format of
 * the string is all lower case (e.g. zh-tw for Traditional
 * Chinese)
 */
export const language = _language;

export namespace Language {

	export function value(): string {
		return language;
	}

	export function isDefaultVariant(): boolean {
		if (language.length === 2) {
			return language === 'en';
		} else if (language.length >= 3) {
			return language[0] === 'e' && language[1] === 'n' && language[2] === '-';
		} else {
			return false;
		}
	}

	export function isDefault(): boolean {
		return language === 'en';
	}
}

/**
 * The OS locale or the locale specified by --locale. The format of
 * the string is all lower case (e.g. zh-tw for Traditional
 * Chinese). The UI is not necessarily shown in the provided locale.
 */
export const locale = _locale;

/**
 * The translatios that are available through language packs.
 */
export const translationsConfigFile = _translationsConfigFile;

const _globals = (typeof self === 'object' ? self : typeof global === 'object' ? global : {} as any);
export const globals: any = _globals;

interface ISetImmediate {
	(callback: (...args: any[]) => void): void;
}

export const setImmediate: ISetImmediate = (function defineSetImmediate() {
	if (globals.setImmediate) {
		return globals.setImmediate.bind(globals);
	}
	if (typeof globals.postMessage === 'function' && !globals.importScripts) {
		interface IQueueElement {
			id: number;
			callback: () => void;
		}
		let pending: IQueueElement[] = [];
		globals.addEventListener('message', (e: MessageEvent) => {
			if (e.data && e.data.vscodeSetImmediateId) {
				for (let i = 0, len = pending.length; i < len; i++) {
					const candidate = pending[i];
					if (candidate.id === e.data.vscodeSetImmediateId) {
						pending.splice(i, 1);
						candidate.callback();
						return;
					}
				}
			}
		});
		let lastId = 0;
		return (callback: () => void) => {
			const myId = ++lastId;
			pending.push({
				id: myId,
				callback: callback
			});
			globals.postMessage({ vscodeSetImmediateId: myId }, '*');
		};
	}
	if (typeof process !== 'undefined' && typeof process.nextTick === 'function') {
		return process.nextTick.bind(process);
	}
	const _promise = Promise.resolve();
	return (callback: (...args: any[]) => void) => _promise.then(callback);
})();

export const enum OperatingSystem {
	Windows = 1,
	Macintosh = 2,
	Linux = 3
}
export const OS = (_isMacintosh || _isIOS ? OperatingSystem.Macintosh : (_isWindows ? OperatingSystem.Windows : OperatingSystem.Linux));

let _isLittleEndian = true;
let _isLittleEndianComputed = false;
export function isLittleEndian(): boolean {
	if (!_isLittleEndianComputed) {
		_isLittleEndianComputed = true;
		const test = new Uint8Array(2);
		test[0] = 1;
		test[1] = 2;
		const view = new Uint16Array(test.buffer);
		_isLittleEndian = (view[0] === (2 << 8) + 1);
	}
	return _isLittleEndian;
}
