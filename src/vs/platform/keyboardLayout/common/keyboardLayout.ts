/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { ScanCode, ScanCodeUtils } from 'vs/base/common/scanCode';
import { IKeyboardMapper } from 'vs/platform/keyboardLayout/common/keyboardMapper';
import { DispatchConfig } from 'vs/platform/keyboardLayout/common/dispatchConfig';
import { IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';

export const IKeyboardLayoutService = createDecorator<IKeyboardLayoutService>('keyboardLayoutService');

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
	valueIsDeadKey: boolean;
	withShift: string;
	withShiftIsDeadKey: boolean;
	withAltGr: string;
	withAltGrIsDeadKey: boolean;
	withShiftAltGr: string;
	withShiftAltGrIsDeadKey: boolean;
}
export interface IMacKeyboardMapping {
	[code: string]: IMacKeyMapping;
}

export type IMacLinuxKeyMapping = IMacKeyMapping | ILinuxKeyMapping;
export type IMacLinuxKeyboardMapping = IMacKeyboardMapping | ILinuxKeyboardMapping;
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

export interface IKeyboardLayoutService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeKeyboardLayout: Event<void>;

	getRawKeyboardMapping(): IKeyboardMapping | null;
	getCurrentKeyboardLayout(): IKeyboardLayoutInfo | null;
	getAllKeyboardLayouts(): IKeyboardLayoutInfo[];
	getKeyboardMapper(dispatchConfig: DispatchConfig): IKeyboardMapper;
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

function windowsKeyMappingEquals(a: IWindowsKeyMapping, b: IWindowsKeyMapping): boolean {
	if (!a && !b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return (
		a.vkey === b.vkey
		&& a.value === b.value
		&& a.withShift === b.withShift
		&& a.withAltGr === b.withAltGr
		&& a.withShiftAltGr === b.withShiftAltGr
	);
}

export function windowsKeyboardMappingEquals(a: IWindowsKeyboardMapping | null, b: IWindowsKeyboardMapping | null): boolean {
	if (!a && !b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	for (let scanCode = 0; scanCode < ScanCode.MAX_VALUE; scanCode++) {
		const strScanCode = ScanCodeUtils.toString(scanCode);
		const aEntry = a[strScanCode];
		const bEntry = b[strScanCode];
		if (!windowsKeyMappingEquals(aEntry, bEntry)) {
			return false;
		}
	}
	return true;
}

function macLinuxKeyMappingEquals(a: IMacLinuxKeyMapping, b: IMacLinuxKeyMapping): boolean {
	if (!a && !b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return (
		a.value === b.value
		&& a.withShift === b.withShift
		&& a.withAltGr === b.withAltGr
		&& a.withShiftAltGr === b.withShiftAltGr
	);
}

export function macLinuxKeyboardMappingEquals(a: IMacLinuxKeyboardMapping | null, b: IMacLinuxKeyboardMapping | null): boolean {
	if (!a && !b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	for (let scanCode = 0; scanCode < ScanCode.MAX_VALUE; scanCode++) {
		const strScanCode = ScanCodeUtils.toString(scanCode);
		const aEntry = a[strScanCode];
		const bEntry = b[strScanCode];
		if (!macLinuxKeyMappingEquals(aEntry, bEntry)) {
			return false;
		}
	}
	return true;
}
