/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'vs/base/common/path';
import { promises } from 'fs';
import { getPathFromAmdModule } from 'vs/base/test/node/testUtils';
import { Keybinding, ResolvedKeybinding, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { ScanCodeBinding } from 'vs/base/common/scanCode';
import { writeFile } from 'vs/base/node/pfs';
import { IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';
import { IKeyboardMapper } from 'vs/platform/keyboardLayout/common/keyboardMapper';

export interface IResolvedKeybinding {
	label: string | null;
	ariaLabel: string | null;
	electronAccelerator: string | null;
	userSettingsLabel: string | null;
	isWYSIWYG: boolean;
	isChord: boolean;
	dispatchParts: (string | null)[];
	singleModifierDispatchParts: (string | null)[];
}

function toIResolvedKeybinding(kb: ResolvedKeybinding): IResolvedKeybinding {
	return {
		label: kb.getLabel(),
		ariaLabel: kb.getAriaLabel(),
		electronAccelerator: kb.getElectronAccelerator(),
		userSettingsLabel: kb.getUserSettingsLabel(),
		isWYSIWYG: kb.isWYSIWYG(),
		isChord: kb.isChord(),
		dispatchParts: kb.getDispatchParts(),
		singleModifierDispatchParts: kb.getSingleModifierDispatchParts()
	};
}

export function assertResolveKeybinding(mapper: IKeyboardMapper, keybinding: Keybinding | null, expected: IResolvedKeybinding[]): void {
	let actual: IResolvedKeybinding[] = mapper.resolveKeybinding(keybinding!).map(toIResolvedKeybinding);
	assert.deepStrictEqual(actual, expected);
}

export function assertResolveKeyboardEvent(mapper: IKeyboardMapper, keyboardEvent: IKeyboardEvent, expected: IResolvedKeybinding): void {
	let actual = toIResolvedKeybinding(mapper.resolveKeyboardEvent(keyboardEvent));
	assert.deepStrictEqual(actual, expected);
}

export function assertResolveUserBinding(mapper: IKeyboardMapper, parts: (SimpleKeybinding | ScanCodeBinding)[], expected: IResolvedKeybinding[]): void {
	let actual: IResolvedKeybinding[] = mapper.resolveUserBinding(parts).map(toIResolvedKeybinding);
	assert.deepStrictEqual(actual, expected);
}

export function readRawMapping<T>(file: string): Promise<T> {
	return promises.readFile(getPathFromAmdModule(require, `vs/workbench/services/keybinding/test/electron-browser/${file}.js`)).then((buff) => {
		let contents = buff.toString();
		let func = new Function('define', contents);
		let rawMappings: T | null = null;
		func(function (value: T) {
			rawMappings = value;
		});
		return rawMappings!;
	});
}

export function assertMapping(writeFileIfDifferent: boolean, mapper: IKeyboardMapper, file: string): Promise<void> {
	const filePath = path.normalize(getPathFromAmdModule(require, `vs/workbench/services/keybinding/test/electron-browser/${file}`));

	return promises.readFile(filePath).then((buff) => {
		const expected = buff.toString().replace(/\r\n/g, '\n');
		const actual = mapper.dumpDebugInfo().replace(/\r\n/g, '\n');
		if (actual !== expected && writeFileIfDifferent) {
			const destPath = filePath.replace(/vscode[\/\\]out[\/\\]vs/, 'vscode/src/vs');
			writeFile(destPath, actual);
		}
		assert.deepStrictEqual(actual, expected);
	});
}
