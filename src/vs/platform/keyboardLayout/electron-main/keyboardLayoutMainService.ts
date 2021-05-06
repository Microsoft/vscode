/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nativeKeymap from 'native-keymap';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IKeyboardLayoutData, INativeKeyboardLayoutService } from 'vs/platform/keyboardLayout/common/keyboardLayoutService';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILifecycleMainService, LifecycleMainPhase } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';

export const IKeyboardLayoutMainService = createDecorator<IKeyboardLayoutMainService>('keyboardLayoutMainService');

export interface IKeyboardLayoutMainService extends INativeKeyboardLayoutService { }

export class KeyboardLayoutMainService extends Disposable implements INativeKeyboardLayoutService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeKeyboardLayout = this._register(new Emitter<IKeyboardLayoutData>());
	readonly onDidChangeKeyboardLayout = this._onDidChangeKeyboardLayout.event;

	private _initPromise: Promise<void> | null;
	private _keyboardLayoutData: IKeyboardLayoutData | null;

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService
	) {
		super();
		this._initPromise = null;
		this._keyboardLayoutData = null;

		// perf: automatically trigger initialize after windows
		// have opened so that we can do this work in parallel
		// to the window load.
		lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen).then(() => this._initialize());
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
