/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { firstOrDefault } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Iterable } from 'vs/base/common/iterator';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { LinkedList } from 'vs/base/common/linkedList';
import { isWeb } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import * as modes from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IExternalOpener, IOpenerService } from 'vs/platform/opener/common/opener';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { defaultExternalUriOpenerId, ExternalUriOpenersConfiguration, externalUriOpenersSettingId } from 'vs/workbench/contrib/externalUriOpener/common/configuration';
import { testUrlMatchesGlob } from 'vs/workbench/contrib/url/common/urlGlob';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';


export const IExternalUriOpenerService = createDecorator<IExternalUriOpenerService>('externalUriOpenerService');


export interface IExternalOpenerProvider {
	getOpeners(targetUri: URI): AsyncIterable<IExternalUriOpener>;
}

export interface IExternalUriOpener {
	readonly id: string;
	readonly label: string;

	canOpen(uri: URI, token: CancellationToken): Promise<modes.ExternalUriOpenerPriority>;
	openExternalUri(uri: URI, ctx: { sourceUri: URI }, token: CancellationToken): Promise<boolean>;
}

export interface IExternalUriOpenerService {
	readonly _serviceBrand: undefined

	/**
	 * Registers a provider for external resources openers.
	 */
	registerExternalOpenerProvider(provider: IExternalOpenerProvider): IDisposable;

	/**
	 * Get the configured IExternalUriOpener for the the uri.
	 * If there is no opener configured, then returns the first opener that can handle the uri.
	 */
	getOpener(uri: URI, ctx: { sourceUri: URI, preferredOpenerId?: string }, token: CancellationToken): Promise<IExternalUriOpener | undefined>;
}

export class ExternalUriOpenerService extends Disposable implements IExternalUriOpenerService, IExternalOpener {

	public readonly _serviceBrand: undefined;

	private readonly _providers = new LinkedList<IExternalOpenerProvider>();

	constructor(
		@IOpenerService openerService: IOpenerService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super();
		this._register(openerService.registerExternalOpener(this));
	}

	registerExternalOpenerProvider(provider: IExternalOpenerProvider): IDisposable {
		const remove = this._providers.push(provider);
		return { dispose: remove };
	}

	private async getOpeners(targetUri: URI, allowOptional: boolean, ctx: { sourceUri: URI, preferredOpenerId?: string }, token: CancellationToken): Promise<IExternalUriOpener[]> {
		const allOpeners = await this.getAllOpenersForUri(targetUri);

		if (allOpeners.size === 0) {
			return [];
		}

		// First see if we have a preferredOpener
		if (ctx.preferredOpenerId) {
			if (ctx.preferredOpenerId === defaultExternalUriOpenerId) {
				return [];
			}

			const preferredOpener = allOpeners.get(ctx.preferredOpenerId);
			if (preferredOpener) {
				// Skip the `canOpen` check here since the opener was specifically requested.
				return [preferredOpener];
			}
		}

		// Check to see if we have a configured opener
		const configuredOpener = this.getConfiguredOpenerForUri(allOpeners, targetUri);
		if (configuredOpener) {
			// Skip the `canOpen` check here since the opener was specifically requested.
			return configuredOpener === defaultExternalUriOpenerId ? [] : [configuredOpener];
		}

		// Then check to see if there is a valid opener
		const validOpeners: Array<{ opener: IExternalUriOpener, priority: modes.ExternalUriOpenerPriority }> = [];
		await Promise.all(Array.from(allOpeners.values()).map(async opener => {
			let priority: modes.ExternalUriOpenerPriority;
			try {
				priority = await opener.canOpen(ctx.sourceUri, token);
			} catch (e) {
				this.logService.error(e);
				return;
			}

			switch (priority) {
				case modes.ExternalUriOpenerPriority.Option:
				case modes.ExternalUriOpenerPriority.Default:
				case modes.ExternalUriOpenerPriority.Preferred:
					validOpeners.push({ opener, priority });
					break;
			}
		}));

		if (validOpeners.length === 0) {
			return [];
		}

		// See if we have a preferred opener first
		const preferred = firstOrDefault(validOpeners.filter(x => x.priority === modes.ExternalUriOpenerPriority.Preferred));
		if (preferred) {
			return [preferred.opener];
		}

		// See if we only have optional openers, use the default opener
		if (!allowOptional && validOpeners.every(x => x.priority === modes.ExternalUriOpenerPriority.Option)) {
			return [];
		}

		return validOpeners.map(value => value.opener);
	}

	async openExternal(href: string, ctx: { sourceUri: URI, preferredOpenerId?: string }, token: CancellationToken): Promise<boolean> {

		const targetUri = typeof href === 'string' ? URI.parse(href) : href;

		const allOpeners = await this.getOpeners(targetUri, false, ctx, token);
		if (allOpeners.length === 0) {
			return false;
		} else if (allOpeners.length === 1) {
			return allOpeners[0].openExternalUri(targetUri, ctx, token);
		}

		// Otherwise prompt
		return this.showOpenerPrompt(allOpeners, targetUri, ctx, token);
	}

	async getOpener(targetUri: URI, ctx: { sourceUri: URI, preferredOpenerId?: string }, token: CancellationToken): Promise<IExternalUriOpener | undefined> {
		const allOpeners = await this.getOpeners(targetUri, true, ctx, token);
		if (allOpeners.length >= 1) {
			return allOpeners[0];
		}
		return undefined;
	}

	private async getAllOpenersForUri(targetUri: URI): Promise<Map<string, IExternalUriOpener>> {
		const allOpeners = new Map<string, IExternalUriOpener>();
		await Promise.all(Iterable.map(this._providers, async (provider) => {
			for await (const opener of provider.getOpeners(targetUri)) {
				allOpeners.set(opener.id, opener);
			}
		}));
		return allOpeners;
	}

	private getConfiguredOpenerForUri(openers: Map<string, IExternalUriOpener>, targetUri: URI): IExternalUriOpener | 'default' | undefined {
		const config = this.configurationService.getValue<ExternalUriOpenersConfiguration>(externalUriOpenersSettingId) || {};
		for (const [uriGlob, id] of Object.entries(config)) {
			if (testUrlMatchesGlob(targetUri.toString(), uriGlob)) {
				if (id === defaultExternalUriOpenerId) {
					return 'default';
				}

				const entry = openers.get(id);
				if (entry) {
					return entry;
				}
			}
		}
		return undefined;
	}

	private async showOpenerPrompt(
		openers: ReadonlyArray<IExternalUriOpener>,
		targetUri: URI,
		ctx: { sourceUri: URI },
		token: CancellationToken
	): Promise<boolean> {
		type PickItem = IQuickPickItem & { opener?: IExternalUriOpener | 'configureDefault' };

		const items: Array<PickItem | IQuickPickSeparator> = openers.map((opener): PickItem => {
			return {
				label: opener.label,
				opener: opener
			};
		});
		items.push(
			{
				label: isWeb
					? nls.localize('selectOpenerDefaultLabel.web', 'Open in new browser window')
					: nls.localize('selectOpenerDefaultLabel', 'Open in default browser'),
				opener: undefined
			},
			{ type: 'separator' },
			{
				label: nls.localize('selectOpenerConfigureTitle', "Configure default opener..."),
				opener: 'configureDefault'
			});

		const picked = await this.quickInputService.pick(items, {
			placeHolder: nls.localize('selectOpenerPlaceHolder', "How would you like to open: {0}", targetUri.toString())
		});

		if (!picked) {
			// Still cancel the default opener here since we prompted the user
			return true;
		}

		if (typeof picked.opener === 'undefined') {
			return false; // Fallback to default opener
		} else if (picked.opener === 'configureDefault') {
			await this.preferencesService.openGlobalSettings(true, {
				revealSetting: { key: externalUriOpenersSettingId, edit: true }
			});
			return true;
		} else {
			return picked.opener.openExternalUri(targetUri, ctx, token);
		}
	}
}
