/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainThreadOutputServiceShape } from '../common/extHost.protocol';
import type * as vscode from 'vscode';
import { URI } from 'vs/base/common/uri';
import { join } from 'vs/base/common/path';
import { toLocalISOString } from 'vs/base/common/date';
import { SymlinkSupport } from 'vs/base/node/pfs';
import { promises } from 'fs';
import { AbstractExtHostOutputChannel, ExtHostPushOutputChannel, ExtHostOutputService, LazyOutputChannel } from 'vs/workbench/api/common/extHostOutput';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { MutableDisposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { createRotatingLogger } from 'vs/platform/log/node/spdlogLog';
import { RotatingLogger } from 'spdlog';
import { ByteSize } from 'vs/platform/files/common/files';

class OutputAppender {

	private appender: RotatingLogger;

	constructor(name: string, readonly file: string) {
		this.appender = createRotatingLogger(name, file, 30 * ByteSize.MB, 1);
		this.appender.clearFormatters();
	}

	append(content: string): void {
		this.appender.critical(content);
	}

	flush(): void {
		this.appender.flush();
	}
}


export class ExtHostOutputChannelBackedByFile extends AbstractExtHostOutputChannel {

	private _appender: OutputAppender;

	constructor(name: string, appender: OutputAppender, proxy: MainThreadOutputServiceShape) {
		super(name, false, URI.file(appender.file), proxy);
		this._appender = appender;
	}

	override append(value: string): void {
		super.append(value);
		this._appender.append(value);
		this._onDidAppend.fire();
	}

	override update(): void {
		this._appender.flush();
		super.update();
	}

	override show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
		this._appender.flush();
		super.show(columnOrPreserveFocus, preserveFocus);
	}

	override clear(): void {
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

	override $setVisibleChannel(channelId: string): void {
		if (channelId) {
			const channel = this._channels.get(channelId);
			if (channel) {
				this._visibleChannelDisposable.value = channel.onDidAppend(() => channel.update());
			}
		}
	}

	override createOutputChannel(name: string): vscode.OutputChannel {
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
			const exists = await SymlinkSupport.existsDirectory(outputDirPath);
			if (!exists) {
				await promises.mkdir(outputDirPath, { recursive: true });
			}
			const fileName = `${this._namePool++}-${name.replace(/[\\/:\*\?"<>\|]/g, '')}`;
			const file = URI.file(join(outputDirPath, `${fileName}.log`));
			const appender = new OutputAppender(fileName, file.fsPath);
			return new ExtHostOutputChannelBackedByFile(name, appender, this._proxy);
		} catch (error) {
			// Do not crash if logger cannot be created
			this.logService.error(error);
			return new ExtHostPushOutputChannel(name, this._proxy);
		}
	}
}
