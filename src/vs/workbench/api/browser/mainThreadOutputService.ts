/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { IOutputService, IOutputChannel, OUTPUT_VIEW_ID } from 'vs/workbench/contrib/output/common/output';
import { Extensions, IOutputChannelRegistry } from 'vs/workbench/services/output/common/output';
import { MainThreadOutputServiceShape, MainContext, IExtHostContext, ExtHostOutputServiceShape, ExtHostContext } from '../common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { UriComponents, URI } from 'vs/base/common/uri';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { IViewsService } from 'vs/workbench/common/views';

@extHostNamedCustomer(MainContext.MainThreadOutputService)
export class MainThreadOutputService extends Disposable implements MainThreadOutputServiceShape {

	private static _idPool = 1;

	private readonly _proxy: ExtHostOutputServiceShape;
	private readonly _outputService: IOutputService;
	private readonly _viewsService: IViewsService;

	constructor(
		extHostContext: IExtHostContext,
		@IOutputService outputService: IOutputService,
		@IViewsService viewsService: IViewsService
	) {
		super();
		this._outputService = outputService;
		this._viewsService = viewsService;

		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostOutputService);

		const setVisibleChannel = () => {
			const visibleChannel = this._viewsService.isViewVisible(OUTPUT_VIEW_ID) ? this._outputService.getActiveChannel() : undefined;
			this._proxy.$setVisibleChannel(visibleChannel ? visibleChannel.id : null);
		};
		this._register(Event.any<any>(this._outputService.onActiveOutputChannel, Event.filter(this._viewsService.onDidChangeViewVisibility, ({ id }) => id === OUTPUT_VIEW_ID))(() => setVisibleChannel()));
		setVisibleChannel();
	}

	public $register(label: string, log: boolean, file?: UriComponents): Promise<string> {
		const id = 'extension-output-#' + (MainThreadOutputService._idPool++);
		Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).registerChannel({ id, label, file: file ? URI.revive(file) : undefined, log });
		this._register(toDisposable(() => this.$dispose(id)));
		return Promise.resolve(id);
	}

	public $append(channelId: string, value: string): Promise<void> | undefined {
		const channel = this._getChannel(channelId);
		if (channel) {
			channel.append(value);
		}
		return undefined;
	}

	public $update(channelId: string): Promise<void> | undefined {
		const channel = this._getChannel(channelId);
		if (channel) {
			channel.update();
		}
		return undefined;
	}

	public $clear(channelId: string, till: number): Promise<void> | undefined {
		const channel = this._getChannel(channelId);
		if (channel) {
			channel.clear(till);
		}
		return undefined;
	}

	public $reveal(channelId: string, preserveFocus: boolean): Promise<void> | undefined {
		const channel = this._getChannel(channelId);
		if (channel) {
			this._outputService.showChannel(channel.id, preserveFocus);
		}
		return undefined;
	}

	public $close(channelId: string): Promise<void> | undefined {
		if (this._viewsService.isViewVisible(OUTPUT_VIEW_ID)) {
			const activeChannel = this._outputService.getActiveChannel();
			if (activeChannel && channelId === activeChannel.id) {
				this._viewsService.closeView(OUTPUT_VIEW_ID);
			}
		}

		return undefined;
	}

	public $dispose(channelId: string): Promise<void> | undefined {
		const channel = this._getChannel(channelId);
		if (channel) {
			channel.dispose();
		}
		return undefined;
	}

	private _getChannel(channelId: string): IOutputChannel | undefined {
		return this._outputService.getChannel(channelId);
	}
}
