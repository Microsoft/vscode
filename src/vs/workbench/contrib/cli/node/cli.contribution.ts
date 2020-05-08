/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as path from 'vs/base/common/path';
import * as cp from 'child_process';
import * as pfs from 'vs/base/node/pfs';
import * as extpath from 'vs/base/node/extpath';
import * as platform from 'vs/base/common/platform';
import { promisify } from 'util';
import { Action } from 'vs/base/common/actions';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import product from 'vs/platform/product/common/product';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import Severity from 'vs/base/common/severity';
import { ILogService } from 'vs/platform/log/common/log';
import { getPathFromAmdModule } from 'vs/base/common/amd';

function ignore<T>(code: string, value: T): (err: any) => Promise<T> {
	return err => err.code === code ? Promise.resolve<T>(value) : Promise.reject<T>(err);
}

let _source: string | null = null;
function getSource(): string {
	if (!_source) {
		const root = getPathFromAmdModule(require, '');
		_source = path.resolve(root, '..', 'bin', 'code');
	}
	return _source;
}

function isAvailable(): Promise<boolean> {
	return Promise.resolve(pfs.exists(getSource()));
}

class InstallAction extends Action {

	static readonly ID = 'workbench.action.installCommandLine';
	static readonly LABEL = nls.localize('install', "Install '{0}' command in PATH", product.applicationName);

	constructor(
		id: string,
		label: string,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ILogService private readonly logService: ILogService
	) {
		super(id, label);
	}

	private get target(): string {
		return `/usr/local/bin/${product.applicationName}`;
	}

	run(): Promise<void> {
		return isAvailable().then(isAvailable => {
			if (!isAvailable) {
				const message = nls.localize('not available', "This command is not available");
				this.notificationService.info(message);
				return undefined;
			}

			return this.isInstalled()
				.then(isInstalled => {
					if (!isAvailable || isInstalled) {
						return Promise.resolve(null);
					} else {
						return pfs.unlink(this.target)
							.then(undefined, ignore('ENOENT', null))
							.then(() => pfs.symlink(getSource(), this.target))
							.then(undefined, err => {
								if (err.code === 'EACCES' || err.code === 'ENOENT') {
									return this.createBinFolderAndSymlinkAsAdmin();
								}

								return Promise.reject(err);
							});
					}
				})
				.then(() => {
					this.logService.trace('cli#install', this.target);
					this.notificationService.info(nls.localize('successIn', "Shell command '{0}' successfully installed in PATH.", product.applicationName));
				});
		});
	}

	private isInstalled(): Promise<boolean> {
		return pfs.lstat(this.target)
			.then(stat => stat.isSymbolicLink())
			.then(() => extpath.realpath(this.target))
			.then(link => link === getSource())
			.then(undefined, ignore('ENOENT', false));
	}

	private createBinFolderAndSymlinkAsAdmin(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const buttons = [nls.localize('ok', "OK"), nls.localize('cancel2', "Cancel")];

			this.dialogService.show(Severity.Info, nls.localize('warnEscalation', "Code will now prompt with 'osascript' for Administrator privileges to install the shell command."), buttons, { cancelId: 1 }).then(result => {
				switch (result.choice) {
					case 0 /* OK */:
						const command = 'osascript -e "do shell script \\"mkdir -p /usr/local/bin && ln -sf \'' + getSource() + '\' \'' + this.target + '\'\\" with administrator privileges"';

						promisify(cp.exec)(command, {})
							.then(undefined, _ => Promise.reject(new Error(nls.localize('cantCreateBinFolder', "Unable to create '/usr/local/bin'."))))
							.then(() => resolve(), reject);
						break;
					case 1 /* Cancel */:
						reject(new Error(nls.localize('aborted', "Aborted")));
						break;
				}
			});
		});
	}
}

class UninstallAction extends Action {

	static readonly ID = 'workbench.action.uninstallCommandLine';
	static readonly LABEL = nls.localize('uninstall', "Uninstall '{0}' command from PATH", product.applicationName);

	constructor(
		id: string,
		label: string,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
		@IDialogService private readonly dialogService: IDialogService
	) {
		super(id, label);
	}

	private get target(): string {
		return `/usr/local/bin/${product.applicationName}`;
	}

	run(): Promise<void> {
		return isAvailable().then(isAvailable => {
			if (!isAvailable) {
				const message = nls.localize('not available', "This command is not available");
				this.notificationService.info(message);
				return undefined;
			}

			const uninstall = () => {
				return pfs.unlink(this.target)
					.then(undefined, ignore('ENOENT', null));
			};

			return uninstall().then(undefined, err => {
				if (err.code === 'EACCES') {
					return this.deleteSymlinkAsAdmin();
				}

				return Promise.reject(err);
			}).then(() => {
				this.logService.trace('cli#uninstall', this.target);
				this.notificationService.info(nls.localize('successFrom', "Shell command '{0}' successfully uninstalled from PATH.", product.applicationName));
			});
		});
	}

	private deleteSymlinkAsAdmin(): Promise<void> {
		return new Promise<void>(async (resolve, reject) => {
			const buttons = [nls.localize('ok', "OK"), nls.localize('cancel2', "Cancel")];

			const { choice } = await this.dialogService.show(Severity.Info, nls.localize('warnEscalationUninstall', "Code will now prompt with 'osascript' for Administrator privileges to uninstall the shell command."), buttons, { cancelId: 1 });
			switch (choice) {
				case 0 /* OK */:
					const command = 'osascript -e "do shell script \\"rm \'' + this.target + '\'\\" with administrator privileges"';

					promisify(cp.exec)(command, {})
						.then(undefined, _ => Promise.reject(new Error(nls.localize('cantUninstall', "Unable to uninstall the shell command '{0}'.", this.target))))
						.then(() => resolve(), reject);
					break;
				case 1 /* Cancel */:
					reject(new Error(nls.localize('aborted', "Aborted")));
					break;
			}
		});
	}
}

if (platform.isMacintosh) {
	const category = nls.localize('shellCommand', "Shell Command");

	const workbenchActionsRegistry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
	workbenchActionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(InstallAction), `Shell Command: Install \'${product.applicationName}\' command in PATH`, category);
	workbenchActionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(UninstallAction), `Shell Command: Uninstall \'${product.applicationName}\' command from PATH`, category);
}
