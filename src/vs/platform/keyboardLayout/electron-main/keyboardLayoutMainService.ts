/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IKeyboardLayoutData, IKeyboardLayoutMainService as ICommonKeyboardLayoutMainService } from 'vs/platform/keyboardLayout/common/keyboardLayoutMainService';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as nativeKeymap from 'native-keymap';

export const IKeyboardLayoutMainService = createDecorator<IKeyboardLayoutMainService>('keyboardLayoutMainService');

export interface IKeyboardLayoutMainService extends ICommonKeyboardLayoutMainService { }

export class KeyboardLayoutMainService extends Disposable implements ICommonKeyboardLayoutMainService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeKeyboardLayout = this._register(new Emitter<IKeyboardLayoutData>());
	readonly onDidChangeKeyboardLayout = this._onDidChangeKeyboardLayout.event;

	private _initPromise: Promise<void> | null;
	private _keyboardLayoutData: IKeyboardLayoutData | null;

	constructor() {
		super();
		this._initPromise = null;
		this._keyboardLayoutData = null;
	}

	private _initialize(): Promise<void> {
		if (!this._initPromise) {
			this._initPromise = this._doInitialize();
		}
		return this._initPromise;
	}

	private async _doInitialize(): Promise<void> {
		const nativeKeymapMod = await import('native-keymap');

		this._keyboardLayoutData = readKeyboardLayoutData(nativeKeymapMod);
		nativeKeymapMod.onDidChangeKeyboardLayout(() => {
			this._keyboardLayoutData = readKeyboardLayoutData(nativeKeymapMod);
			this._onDidChangeKeyboardLayout.fire(this._keyboardLayoutData);
		});
	}

	public async getKeyboardLayoutData(): Promise<IKeyboardLayoutData> {
		await this._initialize();
		return this._keyboardLayoutData!;
	}
}

function readKeyboardLayoutData(nativeKeymapMod: typeof nativeKeymap): IKeyboardLayoutData {
	const keyboardMapping = nativeKeymapMod.getKeyMap();
	const keyboardLayoutInfo = nativeKeymapMod.getCurrentKeyboardLayout();
	return { keyboardMapping, keyboardLayoutInfo };
}
