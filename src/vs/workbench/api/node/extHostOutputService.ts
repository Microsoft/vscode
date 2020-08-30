/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainThreadOutputServiceShape } from '../common/extHost.protocol';
import type * as vscode from 'vscode';
import { URI } from 'vs/base/common/uri';
import { join } from 'vs/base/common/path';
import { OutputAppender } from 'vs/workbench/services/output/node/outputAppender';
import { toLocalISOString } from 'vs/base/common/date';
import { dirExists, mkdirp } from 'vs/base/node/pfs';
import { AbstractExtHostOutputChannel, ExtHostPushOutputChannel, ExtHostOutputService, LazyOutputChannel } from 'vs/workbench/api/common/extHostOutput';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { MutableDisposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';

export class ExtHostOutputChannelBackedByFile extends AbstractExtHostOutputChannel {

	private _appender: OutputAppender;

	constructor(name: string, appender: OutputAppender, proxy: MainThreadOutputServiceShape) {
		super(name, false, URI.file(appender.file), proxy);
		this._appender = appender;
	}

	append(value: string): void {
		super.append(value);
		this._appender.append(value);
		this._onDidAppend.fire();
	}

	update(): void {
		this._appender.flush();
		super.update();
	}

	show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
		this._appender.flush();
		super.show(columnOrPreserveFocus, preserveFocus);
	}

	clear(): void {
		this._appender.flush();
		super.clear();
	}
}

export class ExtHostOutputService2 extends ExtHostOutputService {

	private _logsLocation: URI;
	private _namePool: number = 1;
	private readonly _channels: Map<string, AbstractExtHostOutputChannel> = new Map<string, AbstractExtHostOutputChannel>();
	private readonly _visibleChannelDisposable = new MutableDisposable();

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@ILogService private readonly logService: ILogService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
	) {
		super(extHostRpc);
		this._logsLocation = initData.logsLocation;
	}

	$setVisibleChannel(channelId: string): void {
		if (channelId) {
			const channel = this._channels.get(channelId);
			if (channel) {
				this._visibleChannelDisposable.value = channel.onDidAppend(() => channel.update());
			}
		}
	}

	createOutputChannel(name: string): vscode.OutputChannel {
		name = name.trim();
		if (!name) {
			throw new Error('illegal argument `name`. must not be falsy');
		}
		const extHostOutputChannel = this._doCreateOutChannel(name);
		extHostOutputChannel.then(channel => channel._id.then(id => this._channels.set(id, channel)));
		return new LazyOutputChannel(name, extHostOutputChannel);
	}

	private async _doCreateOutChannel(name: string): Promise<AbstractExtHostOutputChannel> {
		try {
			const outputDirPath = join(this._logsLocation.fsPath, `output_logging_${toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '')}`);
			const outputDir = await dirExists(outputDirPath).then(exists => exists || mkdirp(outputDirPath).then(() => true)).then(() => outputDirPath);
			const fileName = `${this._namePool++}-${name.replace(/[\\/:\*\?"<>\|]/g, '')}`;
			const file = URI.file(join(outputDir, `${fileName}.log`));
			const appender = new OutputAppender(fileName, file.fsPath);
			return new ExtHostOutputChannelBackedByFile(name, appender, this._proxy);
		} catch (error) {
			// Do not crash if logger cannot be created
			this.logService.error(error);
			return new ExtHostPushOutputChannel(name, this._proxy);
		}
	}
}
