/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ExtHostContext, ExtHostUriOpenersShape, IExtHostContext, MainContext, MainThreadUriOpenersShape } from 'vs/workbench/api/common/extHost.protocol';
import { defaultExternalUriOpenerId } from 'vs/workbench/contrib/externalUriOpener/common/configuration';
import { ContributedExternalUriOpenersStore } from 'vs/workbench/contrib/externalUriOpener/common/contributedOpeners';
import { IExternalOpenerProvider, IExternalUriOpener, IExternalUriOpenerService } from 'vs/workbench/contrib/externalUriOpener/common/externalUriOpenerService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { extHostNamedCustomer } from '../common/extHostCustomers';

interface RegisteredOpenerMetadata {
	readonly schemes: ReadonlySet<string>;
	readonly extensionId: ExtensionIdentifier;
	readonly label: string;
}

@extHostNamedCustomer(MainContext.MainThreadUriOpeners)
export class MainThreadUriOpeners extends Disposable implements MainThreadUriOpenersShape, IExternalOpenerProvider {

	private readonly proxy: ExtHostUriOpenersShape;
	private readonly _registeredOpeners = new Map<string, RegisteredOpenerMetadata>();
	private readonly _contributedExternalUriOpenersStore: ContributedExternalUriOpenersStore;

	constructor(
		context: IExtHostContext,
		@IStorageService storageService: IStorageService,
		@IExternalUriOpenerService externalUriOpenerService: IExternalUriOpenerService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IOpenerService private readonly openerService: IOpenerService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.proxy = context.getProxy(ExtHostContext.ExtHostUriOpeners);

		this._register(externalUriOpenerService.registerExternalOpenerProvider(this));

		this._contributedExternalUriOpenersStore = this._register(new ContributedExternalUriOpenersStore(storageService, extensionService));
	}

	public async *getOpeners(targetUri: URI): AsyncIterable<IExternalUriOpener> {

		// Currently we only allow openers for http and https urls
		if (targetUri.scheme !== Schemas.http && targetUri.scheme !== Schemas.https) {
			return;
		}

		await this.extensionService.activateByEvent(`onOpenExternalUri:${targetUri.scheme}`);

		for (const [id, openerMetadata] of this._registeredOpeners) {
			if (openerMetadata.schemes.has(targetUri.scheme)) {
				yield this.createOpener(id, openerMetadata);
			}
		}
	}

	private createOpener(id: string, metadata: RegisteredOpenerMetadata): IExternalUriOpener {
		return {
			id: id,
			label: metadata.label,
			canOpen: (uri, token) => {
				return this.proxy.$canOpenUri(id, uri, token);
			},
			openExternalUri: async (uri, ctx, token) => {
				try {
					await this.proxy.$openUri(id, { resolvedUri: uri, sourceUri: ctx.sourceUri }, token);
				} catch (e) {
					if (!isPromiseCanceledError(e)) {
						const openDefaultAction = new Action('default', localize('openerFailedUseDefault', "Open using default opener"), undefined, undefined, async () => {
							await this.openerService.open(uri, {
								allowTunneling: false,
								allowContributedOpeners: defaultExternalUriOpenerId,
							});
						});
						openDefaultAction.tooltip = uri.toString();

						this.notificationService.notify({
							severity: Severity.Error,
							message: localize({
								key: 'openerFailedMessage',
								comment: ['{0} is the id of the opener. {1} is the url being opened.'],
							}, 'Could not open uri with \'{0}\': {1}', id, e.toString()),
							actions: {
								primary: [
									openDefaultAction
								]
							}
						});
					}
				}
				return true;
			},
		};
	}

	async $registerUriOpener(
		id: string,
		schemes: readonly string[],
		extensionId: ExtensionIdentifier,
		label: string,
	): Promise<void> {
		if (this._registeredOpeners.has(id)) {
			throw new Error(`Opener with id '${id}' already registered`);
		}

		this._registeredOpeners.set(id, {
			schemes: new Set(schemes),
			label,
			extensionId,
		});

		this._contributedExternalUriOpenersStore.didRegisterOpener(id, extensionId.value);
	}

	async $unregisterUriOpener(id: string): Promise<void> {
		this._registeredOpeners.delete(id);
		this._contributedExternalUriOpenersStore.delete(id);
	}

	override dispose(): void {
		super.dispose();
		this._registeredOpeners.clear();
	}
}
