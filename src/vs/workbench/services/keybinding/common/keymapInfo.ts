/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { isWindows, isLinux } from 'vs/base/common/platform';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { DispatchConfig } from 'vs/workbench/services/keybinding/common/dispatchConfig';
import { IKeyboardMapper } from 'vs/workbench/services/keybinding/common/keyboardMapper';
import { IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';


export interface IWindowsKeyMapping {
	vkey: string;
	value: string;
	withShift: string;
	withAltGr: string;
	withShiftAltGr: string;
}
export interface IWindowsKeyboardMapping {
	[code: string]: IWindowsKeyMapping;
}
export interface ILinuxKeyMapping {
	value: string;
	withShift: string;
	withAltGr: string;
	withShiftAltGr: string;
}
export interface ILinuxKeyboardMapping {
	[code: string]: ILinuxKeyMapping;
}
export interface IMacKeyMapping {
	value: string;
	withShift: string;
	withAltGr: string;
	withShiftAltGr: string;
	valueIsDeadKey: boolean;
	withShiftIsDeadKey: boolean;
	withAltGrIsDeadKey: boolean;
	withShiftAltGrIsDeadKey: boolean;
}
export interface IMacKeyboardMapping {
	[code: string]: IMacKeyMapping;
}

export type IKeyboardMapping = IWindowsKeyboardMapping | ILinuxKeyboardMapping | IMacKeyboardMapping;

/* __GDPR__FRAGMENT__
	"IKeyboardLayoutInfo" : {
		"name" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"id": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"text": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	}
*/
export interface IWindowsKeyboardLayoutInfo {
	name: string;
	id: string;
	text: string;
}

/* __GDPR__FRAGMENT__
	"IKeyboardLayoutInfo" : {
		"model" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"layout": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"variant": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"options": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"rules": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	}
*/
export interface ILinuxKeyboardLayoutInfo {
	model: string;
	layout: string;
	variant: string;
	options: string;
	rules: string;
}

/* __GDPR__FRAGMENT__
	"IKeyboardLayoutInfo" : {
		"id" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"lang": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"localizedName": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	}
*/
export interface IMacKeyboardLayoutInfo {
	id: string;
	lang: string;
	localizedName?: string;
}

export type IKeyboardLayoutInfo = (IWindowsKeyboardLayoutInfo | ILinuxKeyboardLayoutInfo | IMacKeyboardLayoutInfo) & { isUserKeyboardLayout?: boolean; isUSStandard?: true };

export const IKeymapService = createDecorator<IKeymapService>('keymapService');

export interface IKeymapService {
	readonly _serviceBrand: undefined;
	onDidChangeKeyboardMapper: Event<void>;
	getKeyboardMapper(dispatchConfig: DispatchConfig): IKeyboardMapper;
	getCurrentKeyboardLayout(): IKeyboardLayoutInfo | null;
	getAllKeyboardLayouts(): IKeyboardLayoutInfo[];
	getRawKeyboardMapping(): IKeyboardMapping | null;
	validateCurrentKeyboardMapping(keyboardEvent: IKeyboardEvent): void;
}

export function areKeyboardLayoutsEqual(a: IKeyboardLayoutInfo | null, b: IKeyboardLayoutInfo | null): boolean {
	if (!a || !b) {
		return false;
	}

	if ((<IWindowsKeyboardLayoutInfo>a).name && (<IWindowsKeyboardLayoutInfo>b).name && (<IWindowsKeyboardLayoutInfo>a).name === (<IWindowsKeyboardLayoutInfo>b).name) {
		return true;
	}

	if ((<IMacKeyboardLayoutInfo>a).id && (<IMacKeyboardLayoutInfo>b).id && (<IMacKeyboardLayoutInfo>a).id === (<IMacKeyboardLayoutInfo>b).id) {
		return true;
	}

	if ((<ILinuxKeyboardLayoutInfo>a).model &&
		(<ILinuxKeyboardLayoutInfo>b).model &&
		(<ILinuxKeyboardLayoutInfo>a).model === (<ILinuxKeyboardLayoutInfo>b).model &&
		(<ILinuxKeyboardLayoutInfo>a).layout === (<ILinuxKeyboardLayoutInfo>b).layout
	) {
		return true;
	}

	return false;
}

export function parseKeyboardLayoutDescription(layout: IKeyboardLayoutInfo | null): { label: string, description: string } {
	if (!layout) {
		return { label: '', description: '' };
	}

	if ((<IWindowsKeyboardLayoutInfo>layout).name) {
		// windows
		let windowsLayout = <IWindowsKeyboardLayoutInfo>layout;
		return {
			label: windowsLayout.text,
			description: ''
		};
	}

	if ((<IMacKeyboardLayoutInfo>layout).id) {
		let macLayout = <IMacKeyboardLayoutInfo>layout;
		if (macLayout.localizedName) {
			return {
				label: macLayout.localizedName,
				description: ''
			};
		}

		if (/^com\.apple\.keylayout\./.test(macLayout.id)) {
			return {
				label: macLayout.id.replace(/^com\.apple\.keylayout\./, '').replace(/-/, ' '),
				description: ''
			};
		}
		if (/^.*inputmethod\./.test(macLayout.id)) {
			return {
				label: macLayout.id.replace(/^.*inputmethod\./, '').replace(/[-\.]/, ' '),
				description: `Input Method (${macLayout.lang})`
			};
		}

		return {
			label: macLayout.lang,
			description: ''
		};
	}

	let linuxLayout = <ILinuxKeyboardLayoutInfo>layout;

	return {
		label: linuxLayout.layout,
		description: ''
	};
}

export function getKeyboardLayoutId(layout: IKeyboardLayoutInfo): string {
	if ((<IWindowsKeyboardLayoutInfo>layout).name) {
		return (<IWindowsKeyboardLayoutInfo>layout).name;
	}

	if ((<IMacKeyboardLayoutInfo>layout).id) {
		return (<IMacKeyboardLayoutInfo>layout).id;
	}

	return (<ILinuxKeyboardLayoutInfo>layout).layout;
}

function deserializeMapping(serializedMapping: ISerializedMapping) {
	let mapping = serializedMapping;

	let ret: { [key: string]: any } = {};
	for (let key in mapping) {
		let result: (string | number)[] = mapping[key];
		if (result.length) {
			let value = result[0];
			let withShift = result[1];
			let withAltGr = result[2];
			let withShiftAltGr = result[3];
			let mask = Number(result[4]);
			let vkey = result.length === 6 ? result[5] : undefined;
			ret[key] = {
				'value': value,
				'vkey': vkey,
				'withShift': withShift,
				'withAltGr': withAltGr,
				'withShiftAltGr': withShiftAltGr,
				'valueIsDeadKey': (mask & 1) > 0,
				'withShiftIsDeadKey': (mask & 2) > 0,
				'withAltGrIsDeadKey': (mask & 4) > 0,
				'withShiftAltGrIsDeadKey': (mask & 8) > 0
			};
		} else {
			ret[key] = {
				'value': '',
				'valueIsDeadKey': false,
				'withShift': '',
				'withShiftIsDeadKey': false,
				'withAltGr': '',
				'withAltGrIsDeadKey': false,
				'withShiftAltGr': '',
				'withShiftAltGrIsDeadKey': false
			};
		}
	}

	return ret;
}

export interface IRawMixedKeyboardMapping {
	[key: string]: {
		value: string,
		withShift: string;
		withAltGr: string;
		withShiftAltGr: string;
		valueIsDeadKey?: boolean;
		withShiftIsDeadKey?: boolean;
		withAltGrIsDeadKey?: boolean;
		withShiftAltGrIsDeadKey?: boolean;

	};
}

interface ISerializedMapping {
	[key: string]: (string | number)[];
}

export interface IKeymapInfo {
	layout: IKeyboardLayoutInfo;
	secondaryLayouts: IKeyboardLayoutInfo[];
	mapping: ISerializedMapping;
	isUserKeyboardLayout?: boolean;
}

export class KeymapInfo {
	mapping: IRawMixedKeyboardMapping;
	isUserKeyboardLayout: boolean;

	constructor(public layout: IKeyboardLayoutInfo, public secondaryLayouts: IKeyboardLayoutInfo[], keyboardMapping: ISerializedMapping, isUserKeyboardLayout?: boolean) {
		this.mapping = deserializeMapping(keyboardMapping);
		this.isUserKeyboardLayout = !!isUserKeyboardLayout;
		this.layout.isUserKeyboardLayout = !!isUserKeyboardLayout;
	}

	static createKeyboardLayoutFromDebugInfo(layout: IKeyboardLayoutInfo, value: IRawMixedKeyboardMapping, isUserKeyboardLayout?: boolean): KeymapInfo {
		let keyboardLayoutInfo = new KeymapInfo(layout, [], {}, true);
		keyboardLayoutInfo.mapping = value;
		return keyboardLayoutInfo;
	}

	update(other: KeymapInfo) {
		this.layout = other.layout;
		this.secondaryLayouts = other.secondaryLayouts;
		this.mapping = other.mapping;
		this.isUserKeyboardLayout = other.isUserKeyboardLayout;
		this.layout.isUserKeyboardLayout = other.isUserKeyboardLayout;
	}

	getScore(other: IRawMixedKeyboardMapping): number {
		let score = 0;
		for (let key in other) {
			if (isWindows && (key === 'Backslash' || key === 'KeyQ')) {
				// keymap from Chromium is probably wrong.
				continue;
			}

			if (isLinux && (key === 'Backspace' || key === 'Escape')) {
				// native keymap doesn't align with keyboard event
				continue;
			}

			if (this.mapping[key] === undefined) {
				score -= 1;
			}

			let currentMapping = this.mapping[key];
			let otherMapping = other[key];

			if (currentMapping.value !== otherMapping.value) {
				score -= 1;
			}
		}

		return score;
	}

	equal(other: KeymapInfo): boolean {
		if (this.isUserKeyboardLayout !== other.isUserKeyboardLayout) {
			return false;
		}

		if (getKeyboardLayoutId(this.layout) !== getKeyboardLayoutId(other.layout)) {
			return false;
		}

		return this.fuzzyEqual(other.mapping);
	}

	fuzzyEqual(other: IRawMixedKeyboardMapping): boolean {
		for (let key in other) {
			if (isWindows && (key === 'Backslash' || key === 'KeyQ')) {
				// keymap from Chromium is probably wrong.
				continue;
			}
			if (this.mapping[key] === undefined) {
				return false;
			}

			let currentMapping = this.mapping[key];
			let otherMapping = other[key];

			if (currentMapping.value !== otherMapping.value) {
				return false;
			}
		}

		return true;
	}
}
