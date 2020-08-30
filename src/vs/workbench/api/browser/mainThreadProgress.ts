/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProgress, IProgressService, IProgressStep, ProgressLocation, IProgressOptions, IProgressNotificationOptions } from 'vs/platform/progress/common/progress';
import { MainThreadProgressShape, MainContext, IExtHostContext, ExtHostProgressShape, ExtHostContext } from '../common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { Action } from 'vs/base/common/actions';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { localize } from 'vs/nls';

class ManageExtensionAction extends Action {
	constructor(id: ExtensionIdentifier, label: string, commandService: ICommandService) {
		super(id.value, label, undefined, true, () => {
			return commandService.executeCommand('_extensions.manage', id.value);
		});
	}
}

@extHostNamedCustomer(MainContext.MainThreadProgress)
export class MainThreadProgress implements MainThreadProgressShape {

	private readonly _progressService: IProgressService;
	private _progress = new Map<number, { resolve: () => void, progress: IProgress<IProgressStep> }>();
	private readonly _proxy: ExtHostProgressShape;

	constructor(
		extHostContext: IExtHostContext,
		@IProgressService progressService: IProgressService,
		@ICommandService private readonly _commandService: ICommandService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostProgress);
		this._progressService = progressService;
	}

	dispose(): void {
		this._progress.forEach(handle => handle.resolve());
		this._progress.clear();
	}

	$startProgress(handle: number, options: IProgressOptions, extension?: IExtensionDescription): void {
		const task = this._createTask(handle);

		if (options.location === ProgressLocation.Notification && extension && !extension.isUnderDevelopment) {
			const notificationOptions: IProgressNotificationOptions = {
				...options,
				location: ProgressLocation.Notification,
				secondaryActions: [new ManageExtensionAction(extension.identifier, localize('manageExtension', "Manage Extension"), this._commandService)]
			};

			options = notificationOptions;
		}

		this._progressService.withProgress(options, task, () => this._proxy.$acceptProgressCanceled(handle));
	}

	$progressReport(handle: number, message: IProgressStep): void {
		const entry = this._progress.get(handle);
		if (entry) {
			entry.progress.report(message);
		}
	}

	$progressEnd(handle: number): void {
		const entry = this._progress.get(handle);
		if (entry) {
			entry.resolve();
			this._progress.delete(handle);
		}
	}

	private _createTask(handle: number) {
		return (progress: IProgress<IProgressStep>) => {
			return new Promise<any>(resolve => {
				this._progress.set(handle, { resolve, progress });
			});
		};
	}
}
