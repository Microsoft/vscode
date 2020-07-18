/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DelegatedLogService, ILogService, ConsoleLogInMainService, ConsoleLogService, MultiplexLogService } from 'vs/platform/log/common/log';
import { BufferLogService } from 'vs/platform/log/common/bufferLog';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { LoggerChannelClient, FollowerLogService } from 'vs/platform/log/common/logIpc';
import { SpdLogService } from 'vs/platform/log/node/spdlogService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';

export class DesktopLogService extends DelegatedLogService {

	private readonly bufferSpdLogService: BufferLogService | undefined;
	private readonly windowId: number;
	private readonly environmentService: NativeWorkbenchEnvironmentService;

	constructor(windowId: number, mainProcessService: IMainProcessService, environmentService: NativeWorkbenchEnvironmentService) {

		const disposables = new DisposableStore();
		const loggerClient = new LoggerChannelClient(mainProcessService.getChannel('logger'));
		let bufferSpdLogService: BufferLogService | undefined;

		// Extension development test CLI: forward everything to main side
		const loggers: ILogService[] = [];
		if (environmentService.isExtensionDevelopment && !!environmentService.extensionTestsLocationURI) {
			loggers.push(
				disposables.add(new ConsoleLogInMainService(loggerClient, environmentService.configuration.logLevel))
			);
		}

		// Normal logger: spdylog and console
		else {
			bufferSpdLogService = disposables.add(new BufferLogService(environmentService.configuration.logLevel));
			loggers.push(
				disposables.add(new ConsoleLogService(environmentService.configuration.logLevel)),
				bufferSpdLogService,
			);
		}

		const multiplexLogger = disposables.add(new MultiplexLogService(loggers));
		const followerLogger = disposables.add(new FollowerLogService(loggerClient, multiplexLogger));
		super(followerLogger);

		this.bufferSpdLogService = bufferSpdLogService;
		this.windowId = windowId;
		this.environmentService = environmentService;

		this._register(disposables);
	}

	init(): void {
		if (this.bufferSpdLogService) {
			this.bufferSpdLogService.logger = this._register(new SpdLogService(`renderer${this.windowId}`, this.environmentService.logsPath, this.getLevel()));
			this.trace('Created Spdlogger');
		}
	}
}

class DesktopLogServiceInitContribution implements IWorkbenchContribution {
	constructor(@ILogService logService: ILogService) {
		if (logService instanceof DesktopLogService) {
			logService.init();
		}
	}
}
Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench).registerWorkbenchContribution(DesktopLogServiceInitContribution, LifecyclePhase.Restored);
