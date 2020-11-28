/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as path from 'vs/base/common/path';
import * as cp from 'child_process';
import * as pfs from 'vs/base/node/pfs';
import * as extpath from 'vs/base/node/extpath';
import { promisify } from 'util';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import product from 'vs/platform/product/common/product';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import Severity from 'vs/base/common/severity';
import { ILogService } from 'vs/platform/log/common/log';
import { FileAccess } from 'vs/base/common/network';
import { IProductService } from 'vs/platform/product/common/productService';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IsMacNativeContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

function ignore<T>(code: string, value: T): (err: any) => Promise<T> {
	return err => err.code === code ? Promise.resolve<T>(value) : Promise.reject<T>(err);
}

let _source: string | null = null;
function getSource(): string {
	if (!_source) {
		const root = FileAccess.asFileUri('', require).fsPath;
		_source = path.resolve(root, '..', 'bin', 'code');
	}
	return _source;
}

function isAvailable(): Promise<boolean> {
	return Promise.resolve(pfs.exists(getSource()));
}

const category = nls.localize('shellCommand', "Shell Command");

class InstallAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.installCommandLine',
			title: {
				value: nls.localize('install', "Install '{0}' command in PATH", product.applicationName),
				original: `Shell Command: Install \'${product.applicationName}\' command in PATH`
			},
			category,
			f1: true,
			precondition: ContextKeyExpr.and(IsMacNativeContext, ContextKeyExpr.equals('remoteName', ''))
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const productService = accessor.get(IProductService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);
		const dialogService = accessor.get(IDialogService);
		const target = `/usr/local/bin/${productService.applicationName}`;

		return isAvailable().then(isAvailable => {
			if (!isAvailable) {
				const message = nls.localize('not available', "This command is not available");
				notificationService.info(message);
				return undefined;
			}

			return this.isInstalled(target)
				.then(isInstalled => {
					if (!isAvailable || isInstalled) {
						return Promise.resolve(null);
					} else {
						return pfs.unlink(target)
							.then(undefined, ignore('ENOENT', null))
							.then(() => pfs.symlink(getSource(), target))
							.then(undefined, err => {
								if (err.code === 'EACCES' || err.code === 'ENOENT') {
									return new Promise<void>((resolve, reject) => {
										const buttons = [nls.localize('ok', "OK"), nls.localize('cancel2', "Cancel")];

										dialogService.show(Severity.Info, nls.localize('warnEscalation', "Code will now prompt with 'osascript' for Administrator privileges to install the shell command."), buttons, { cancelId: 1 }).then(result => {
											switch (result.choice) {
												case 0 /* OK */:
													const command = 'osascript -e "do shell script \\"mkdir -p /usr/local/bin && ln -sf \'' + getSource() + '\' \'' + target + '\'\\" with administrator privileges"';

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

								return Promise.reject(err);
							});
					}
				})
				.then(() => {
					logService.trace('cli#install', target);
					notificationService.info(nls.localize('successIn', "Shell command '{0}' successfully installed in PATH.", productService.applicationName));
				});
		});
	}

	private isInstalled(target: string): Promise<boolean> {
		return pfs.lstat(target)
			.then(stat => stat.isSymbolicLink())
			.then(() => extpath.realpath(target))
			.then(link => link === getSource())
			.then(undefined, ignore('ENOENT', false));
	}
}

class UninstallAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.uninstallCommandLine',
			title: {
				value: nls.localize('uninstall', "Uninstall '{0}' command from PATH", product.applicationName),
				original: `Shell Command: Uninstall \'${product.applicationName}\' command from PATH`
			},
			category,
			f1: true,
			precondition: ContextKeyExpr.and(IsMacNativeContext, ContextKeyExpr.equals('remoteName', ''))
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const productService = accessor.get(IProductService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);
		const dialogService = accessor.get(IDialogService);
		const target = `/usr/local/bin/${productService.applicationName}`;

		return isAvailable().then(isAvailable => {
			if (!isAvailable) {
				const message = nls.localize('not available', "This command is not available");
				notificationService.info(message);
				return undefined;
			}

			const uninstall = () => {
				return pfs.unlink(target)
					.then(undefined, ignore('ENOENT', null));
			};

			return uninstall().then(undefined, err => {
				if (err.code === 'EACCES') {
					return new Promise<void>(async (resolve, reject) => {
						const buttons = [nls.localize('ok', "OK"), nls.localize('cancel2', "Cancel")];

						const { choice } = await dialogService.show(Severity.Info, nls.localize('warnEscalationUninstall', "Code will now prompt with 'osascript' for Administrator privileges to uninstall the shell command."), buttons, { cancelId: 1 });
						switch (choice) {
							case 0 /* OK */:
								const command = 'osascript -e "do shell script \\"rm \'' + target + '\'\\" with administrator privileges"';

								promisify(cp.exec)(command, {})
									.then(undefined, _ => Promise.reject(new Error(nls.localize('cantUninstall', "Unable to uninstall the shell command '{0}'.", target))))
									.then(() => resolve(), reject);
								break;
							case 1 /* Cancel */:
								reject(new Error(nls.localize('aborted', "Aborted")));
								break;
						}
					});
				}

				return Promise.reject(err);
			}).then(() => {
				logService.trace('cli#uninstall', target);
				notificationService.info(nls.localize('successFrom', "Shell command '{0}' successfully uninstalled from PATH.", productService.applicationName));
			});
		});
	}
}

registerAction2(InstallAction);
registerAction2(UninstallAction);
