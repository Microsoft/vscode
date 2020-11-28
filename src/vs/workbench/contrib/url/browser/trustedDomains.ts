/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IProductService } from 'vs/platform/product/common/productService';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { IFileService } from 'vs/platform/files/common/files';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';

const TRUSTED_DOMAINS_URI = URI.parse('trustedDomains:/Trusted Domains');

export const TRUSTED_DOMAINS_STORAGE_KEY = 'http.linkProtectionTrustedDomains';
export const TRUSTED_DOMAINS_CONTENT_STORAGE_KEY = 'http.linkProtectionTrustedDomainsContent';

export const manageTrustedDomainSettingsCommand = {
	id: 'workbench.action.manageTrustedDomain',
	description: {
		description: localize('trustedDomain.manageTrustedDomain', 'Manage Trusted Domains'),
		args: []
	},
	handler: async (accessor: ServicesAccessor) => {
		const editorService = accessor.get(IEditorService);
		editorService.openEditor({ resource: TRUSTED_DOMAINS_URI, mode: 'jsonc', options: { pinned: true } });
		return;
	}
};

type ConfigureTrustedDomainsQuickPickItem = IQuickPickItem & ({ id: 'manage'; } | { id: 'trust'; toTrust: string });

type ConfigureTrustedDomainsChoiceClassification = {
	choice: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

export async function configureOpenerTrustedDomainsHandler(
	trustedDomains: string[],
	domainToConfigure: string,
	resource: URI,
	quickInputService: IQuickInputService,
	storageService: IStorageService,
	editorService: IEditorService,
	telemetryService: ITelemetryService,
	notificationService: INotificationService,
	clipboardService: IClipboardService,
) {
	const parsedDomainToConfigure = URI.parse(domainToConfigure);
	const toplevelDomainSegements = parsedDomainToConfigure.authority.split('.');
	const domainEnd = toplevelDomainSegements.slice(toplevelDomainSegements.length - 2).join('.');
	const topLevelDomain = '*.' + domainEnd;
	const options: ConfigureTrustedDomainsQuickPickItem[] = [];

	options.push({
		type: 'item',
		label: localize('trustedDomain.trustDomain', 'Trust {0}', domainToConfigure),
		id: 'trust',
		toTrust: domainToConfigure,
		picked: true
	});

	const isIP =
		toplevelDomainSegements.length === 4 &&
		toplevelDomainSegements.every(segment =>
			Number.isInteger(+segment) || Number.isInteger(+segment.split(':')[0]));

	if (isIP) {
		if (parsedDomainToConfigure.authority.includes(':')) {
			const base = parsedDomainToConfigure.authority.split(':')[0];
			options.push({
				type: 'item',
				label: localize('trustedDomain.trustAllPorts', 'Trust {0} on all ports', base),
				toTrust: base + ':*',
				id: 'trust'
			});
		}
	} else {
		options.push({
			type: 'item',
			label: localize('trustedDomain.trustSubDomain', 'Trust {0} and all its subdomains', domainEnd),
			toTrust: topLevelDomain,
			id: 'trust'
		});
	}

	options.push({
		type: 'item',
		label: localize('trustedDomain.trustAllDomains', 'Trust all domains (disables link protection)'),
		toTrust: '*',
		id: 'trust'
	});
	options.push({
		type: 'item',
		label: localize('trustedDomain.manageTrustedDomains', 'Manage Trusted Domains'),
		id: 'manage'
	});

	const pickedResult = await quickInputService.pick<ConfigureTrustedDomainsQuickPickItem>(
		options, { activeItem: options[0] }
	);

	if (pickedResult && pickedResult.id) {
		telemetryService.publicLog2<{ choice: string }, ConfigureTrustedDomainsChoiceClassification>(
			'trustedDomains.configureTrustedDomainsQuickPickChoice',
			{ choice: pickedResult.id }
		);

		switch (pickedResult.id) {
			case 'manage':
				await editorService.openEditor({
					resource: TRUSTED_DOMAINS_URI,
					mode: 'jsonc',
					options: { pinned: true }
				});
				notificationService.prompt(Severity.Info, localize('configuringURL', "Configuring trust for: {0}", resource.toString()),
					[{ label: 'Copy', run: () => clipboardService.writeText(resource.toString()) }]);
				return trustedDomains;
			case 'trust':
				const itemToTrust = pickedResult.toTrust;
				if (trustedDomains.indexOf(itemToTrust) === -1) {
					storageService.remove(TRUSTED_DOMAINS_CONTENT_STORAGE_KEY, StorageScope.GLOBAL);
					storageService.store(
						TRUSTED_DOMAINS_STORAGE_KEY,
						JSON.stringify([...trustedDomains, itemToTrust]),
						StorageScope.GLOBAL,
						StorageTarget.USER
					);

					return [...trustedDomains, itemToTrust];
				}
		}
	}

	return [];
}

// Exported for testing.
export function extractGitHubRemotesFromGitConfig(gitConfig: string): string[] {
	const domains = new Set<string>();
	let match: RegExpExecArray | null;

	const RemoteMatcher = /^\s*url\s*=\s*(?:git@|https:\/\/)github\.com(?::|\/)(\S*)\s*$/mg;
	while (match = RemoteMatcher.exec(gitConfig)) {
		const repo = match[1].replace(/\.git$/, '');
		if (repo) {
			domains.add(`https://github.com/${repo}/`);
		}
	}
	return [...domains];
}

async function getRemotes(fileService: IFileService, textFileService: ITextFileService, contextService: IWorkspaceContextService): Promise<string[]> {
	const workspaceUris = contextService.getWorkspace().folders.map(folder => folder.uri);
	const domains = await Promise.race([
		new Promise<string[][]>(resolve => setTimeout(() => resolve([]), 2000)),
		Promise.all<string[]>(workspaceUris.map(async workspaceUri => {
			const path = workspaceUri.path;
			const uri = workspaceUri.with({ path: `${path !== '/' ? path : ''}/.git/config` });
			const exists = await fileService.exists(uri);
			if (!exists) {
				return [];
			}
			const gitConfig = (await (textFileService.read(uri, { acceptTextOnly: true }).catch(() => ({ value: '' })))).value;
			return extractGitHubRemotesFromGitConfig(gitConfig);
		}))]);

	const set = domains.reduce((set, list) => list.reduce((set, item) => set.add(item), set), new Set<string>());
	return [...set];
}

export interface IStaticTrustedDomains {
	readonly defaultTrustedDomains: string[];
	readonly trustedDomains: string[];
}

export interface ITrustedDomains extends IStaticTrustedDomains {
	readonly userDomains: string[];
	readonly workspaceDomains: string[];
}

export async function readTrustedDomains(accessor: ServicesAccessor): Promise<ITrustedDomains> {
	const { defaultTrustedDomains, trustedDomains } = readStaticTrustedDomains(accessor);
	const [workspaceDomains, userDomains] = await Promise.all([readWorkspaceTrustedDomains(accessor), readAuthenticationTrustedDomains(accessor)]);
	return {
		workspaceDomains,
		userDomains,
		defaultTrustedDomains,
		trustedDomains,
	};
}

export async function readWorkspaceTrustedDomains(accessor: ServicesAccessor): Promise<string[]> {
	const fileService = accessor.get(IFileService);
	const textFileService = accessor.get(ITextFileService);
	const workspaceContextService = accessor.get(IWorkspaceContextService);
	return getRemotes(fileService, textFileService, workspaceContextService);
}

export async function readAuthenticationTrustedDomains(accessor: ServicesAccessor): Promise<string[]> {
	const authenticationService = accessor.get(IAuthenticationService);
	return authenticationService.isAuthenticationProviderRegistered('github') && ((await authenticationService.getSessions('github')) ?? []).length > 0
		? [`https://github.com`]
		: [];
}

export function readStaticTrustedDomains(accessor: ServicesAccessor): IStaticTrustedDomains {
	const storageService = accessor.get(IStorageService);
	const productService = accessor.get(IProductService);

	const defaultTrustedDomains: string[] = productService.linkProtectionTrustedDomains
		? [...productService.linkProtectionTrustedDomains]
		: [];

	let trustedDomains: string[] = [];
	try {
		const trustedDomainsSrc = storageService.get(TRUSTED_DOMAINS_STORAGE_KEY, StorageScope.GLOBAL);
		if (trustedDomainsSrc) {
			trustedDomains = JSON.parse(trustedDomainsSrc);
		}
	} catch (err) { }

	return {
		defaultTrustedDomains,
		trustedDomains,
	};
}
