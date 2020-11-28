/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisplayMainService as ICommonDisplayMainService } from 'vs/platform/display/common/displayMainService';
import { Emitter } from 'vs/base/common/event';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { app, Display, screen } from 'electron';
import { RunOnceScheduler } from 'vs/base/common/async';

export const IDisplayMainService = createDecorator<IDisplayMainService>('displayMainService');

export interface IDisplayMainService extends ICommonDisplayMainService { }

export class DisplayMainService extends Disposable implements ICommonDisplayMainService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidDisplayChanged = this._register(new Emitter<void>());
	readonly onDidDisplayChanged = this._onDidDisplayChanged.event;

	constructor() {
		super();

		const displayChangedScheduler = this._register(new RunOnceScheduler(() => {
			this._onDidDisplayChanged.fire();
		}, 100));

		app.whenReady().then(() => {

			const displayChangedListener = (event: Event, display: Display, changedMetrics?: string[]) => {
				displayChangedScheduler.schedule();
			};

			screen.on('display-metrics-changed', displayChangedListener);
			this._register(toDisposable(() => screen.removeListener('display-metrics-changed', displayChangedListener)));

			screen.on('display-added', displayChangedListener);
			this._register(toDisposable(() => screen.removeListener('display-added', displayChangedListener)));

			screen.on('display-removed', displayChangedListener);
			this._register(toDisposable(() => screen.removeListener('display-removed', displayChangedListener)));
		});
	}
}
