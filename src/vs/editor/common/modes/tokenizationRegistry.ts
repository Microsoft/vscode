/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ColorId, ITokenizationRegistry, ITokenizationSupport, ITokenizationSupportChangedEvent } from 'vs/editor/common/modes';
import { toArray } from 'vs/base/common/arrays';

export class TokenizationRegistryImpl implements ITokenizationRegistry {

	private readonly _map = new Map<string, ITokenizationSupport>();
	private readonly _promises = new Map<string, Thenable<void>>();

	private readonly _onDidChange = new Emitter<ITokenizationSupportChangedEvent>();
	public readonly onDidChange: Event<ITokenizationSupportChangedEvent> = this._onDidChange.event;

	private _colorMap: Color[] | null;

	constructor() {
		this._colorMap = null;
	}

	public fire(languages: string[]): void {
		this._onDidChange.fire({
			changedLanguages: languages,
			changedColorMap: false
		});
	}

	public register(language: string, support: ITokenizationSupport) {
		this._map.set(language, support);
		this.fire([language]);
		return toDisposable(() => {
			if (this._map.get(language) !== support) {
				return;
			}
			this._map.delete(language);
			this.fire([language]);
		});
	}

	public registerPromise(language: string, supportPromise: Thenable<ITokenizationSupport | null>): IDisposable {

		let registration: IDisposable | null = null;
		let isDisposed: boolean = false;

		this._promises.set(language, supportPromise.then(support => {
			this._promises.delete(language);
			if (isDisposed || !support) {
				return;
			}
			registration = this.register(language, support);
		}));

		return toDisposable(() => {
			isDisposed = true;
			if (registration) {
				registration.dispose();
			}
		});
	}

	public getPromise(language: string): Thenable<ITokenizationSupport> | null {
		const support = this.get(language);
		if (support) {
			return Promise.resolve(support);
		}
		const promise = this._promises.get(language);
		if (promise) {
			return promise.then(_ => this.get(language)!);
		}
		return null;
	}

	public get(language: string): ITokenizationSupport | null {
		return (this._map.get(language) || null);
	}

	public setColorMap(colorMap: Color[]): void {
		this._colorMap = colorMap;
		this._onDidChange.fire({
			changedLanguages: toArray(this._map.keys()),
			changedColorMap: true
		});
	}

	public getColorMap(): Color[] | null {
		return this._colorMap;
	}

	public getDefaultBackground(): Color | null {
		if (this._colorMap && this._colorMap.length > ColorId.DefaultBackground) {
			return this._colorMap[ColorId.DefaultBackground];
		}
		return null;
	}
}
