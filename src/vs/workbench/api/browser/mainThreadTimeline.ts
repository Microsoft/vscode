/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { MainContext, MainThreadTimelineShape, IExtHostContext, ExtHostTimelineShape, ExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { TimelineChangeEvent, TimelineOptions, TimelineProviderDescriptor, ITimelineService, InternalTimelineOptions } from 'vs/workbench/contrib/timeline/common/timeline';

@extHostNamedCustomer(MainContext.MainThreadTimeline)
export class MainThreadTimeline implements MainThreadTimelineShape {
	private readonly _proxy: ExtHostTimelineShape;
	private readonly _providerEmitters = new Map<string, Emitter<TimelineChangeEvent>>();

	constructor(
		context: IExtHostContext,
		@ILogService private readonly logService: ILogService,
		@ITimelineService private readonly _timelineService: ITimelineService
	) {
		this._proxy = context.getProxy(ExtHostContext.ExtHostTimeline);
	}

	$registerTimelineProvider(provider: TimelineProviderDescriptor): void {
		this.logService.trace(`MainThreadTimeline#registerTimelineProvider: id=${provider.id}`);

		const proxy = this._proxy;

		const emitters = this._providerEmitters;
		let onDidChange = emitters.get(provider.id);
		if (onDidChange === undefined) {
			onDidChange = new Emitter<TimelineChangeEvent>();
			emitters.set(provider.id, onDidChange);
		}

		this._timelineService.registerTimelineProvider({
			...provider,
			onDidChange: onDidChange.event,
			provideTimeline(uri: URI, options: TimelineOptions, token: CancellationToken, internalOptions?: InternalTimelineOptions) {
				return proxy.$getTimeline(provider.id, uri, options, token, internalOptions);
			},
			dispose() {
				emitters.delete(provider.id);
				onDidChange?.dispose();
			}
		});
	}

	$unregisterTimelineProvider(id: string): void {
		this.logService.trace(`MainThreadTimeline#unregisterTimelineProvider: id=${id}`);

		this._timelineService.unregisterTimelineProvider(id);
	}

	$emitTimelineChangeEvent(e: TimelineChangeEvent): void {
		this.logService.trace(`MainThreadTimeline#emitChangeEvent: id=${e.id}, uri=${e.uri?.toString(true)}`);

		const emitter = this._providerEmitters.get(e.id!);
		emitter?.fire(e);
	}

	dispose(): void {
		// noop
	}
}
