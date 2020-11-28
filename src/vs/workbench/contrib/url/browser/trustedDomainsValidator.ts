/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import Severity from 'vs/base/common/severity';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IOpenerService, matchesScheme } from 'vs/platform/opener/common/opener';
import { IProductService } from 'vs/platform/product/common/productService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { configureOpenerTrustedDomainsHandler, readAuthenticationTrustedDomains, readStaticTrustedDomains, readWorkspaceTrustedDomains } from 'vs/workbench/contrib/url/browser/trustedDomains';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IdleValue } from 'vs/base/common/async';
import { IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';

type TrustedDomainsDialogActionClassification = {
	action: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

export class OpenerValidatorContributions implements IWorkbenchContribution {

	private _readWorkspaceTrustedDomainsResult: IdleValue<Promise<string[]>>;
	private _readAuthenticationTrustedDomainsResult: IdleValue<Promise<string[]>>;

	constructor(
		@IOpenerService private readonly _openerService: IOpenerService,
		@IStorageService private readonly _storageService: IStorageService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IProductService private readonly _productService: IProductService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IEditorService private readonly _editorService: IEditorService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		this._openerService.registerValidator({ shouldOpen: r => this.validateLink(r) });

		this._readAuthenticationTrustedDomainsResult = new IdleValue(() =>
			this._instantiationService.invokeFunction(readAuthenticationTrustedDomains));
		this._authenticationService.onDidRegisterAuthenticationProvider(() => {
			this._readAuthenticationTrustedDomainsResult?.dispose();
			this._readAuthenticationTrustedDomainsResult = new IdleValue(() =>
				this._instantiationService.invokeFunction(readAuthenticationTrustedDomains));
		});

		this._readWorkspaceTrustedDomainsResult = new IdleValue(() =>
			this._instantiationService.invokeFunction(readWorkspaceTrustedDomains));
		this._workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this._readWorkspaceTrustedDomainsResult?.dispose();
			this._readWorkspaceTrustedDomainsResult = new IdleValue(() =>
				this._instantiationService.invokeFunction(readWorkspaceTrustedDomains));
		});
	}

	async validateLink(resource: URI | string): Promise<boolean> {
		if (!matchesScheme(resource, Schemas.http) && !matchesScheme(resource, Schemas.https)) {
			return true;
		}

		if (typeof resource === 'string') {
			resource = URI.parse(resource);
		}
		const { scheme, authority, path, query, fragment } = resource;

		const domainToOpen = `${scheme}://${authority}`;
		const [workspaceDomains, userDomains] = await Promise.all([this._readWorkspaceTrustedDomainsResult.value, this._readAuthenticationTrustedDomainsResult.value]);
		const { defaultTrustedDomains, trustedDomains, } = this._instantiationService.invokeFunction(readStaticTrustedDomains);
		const allTrustedDomains = [...defaultTrustedDomains, ...trustedDomains, ...userDomains, ...workspaceDomains];

		if (isURLDomainTrusted(resource, allTrustedDomains)) {
			return true;
		} else {
			let formattedLink = `${scheme}://${authority}${path}`;

			const linkTail = `${query ? '?' + query : ''}${fragment ? '#' + fragment : ''}`;


			const remainingLength = Math.max(0, 60 - formattedLink.length);
			const linkTailLengthToKeep = Math.min(Math.max(5, remainingLength), linkTail.length);

			if (linkTailLengthToKeep === linkTail.length) {
				formattedLink += linkTail;
			} else {
				// keep the first char ? or #
				// add ... and keep the tail end as much as possible
				formattedLink += linkTail.charAt(0) + '...' + linkTail.substring(linkTail.length - linkTailLengthToKeep + 1);
			}

			const { choice } = await this._dialogService.show(
				Severity.Info,
				localize(
					'openExternalLinkAt',
					'Do you want {0} to open the external website?',
					this._productService.nameShort
				),
				[
					localize('open', 'Open'),
					localize('copy', 'Copy'),
					localize('cancel', 'Cancel'),
					localize('configureTrustedDomains', 'Configure Trusted Domains')
				],
				{
					detail: formattedLink,
					cancelId: 2
				}
			);

			// Open Link
			if (choice === 0) {
				this._telemetryService.publicLog2<{ action: string }, TrustedDomainsDialogActionClassification>(
					'trustedDomains.dialogAction',
					{ action: 'open' }
				);
				return true;
			}
			// Copy Link
			else if (choice === 1) {
				this._telemetryService.publicLog2<{ action: string }, TrustedDomainsDialogActionClassification>(
					'trustedDomains.dialogAction',
					{ action: 'copy' }
				);
				this._clipboardService.writeText(resource.toString(true));
			}
			// Configure Trusted Domains
			else if (choice === 3) {
				this._telemetryService.publicLog2<{ action: string }, TrustedDomainsDialogActionClassification>(
					'trustedDomains.dialogAction',
					{ action: 'configure' }
				);

				const pickedDomains = await configureOpenerTrustedDomainsHandler(
					trustedDomains,
					domainToOpen,
					resource,
					this._quickInputService,
					this._storageService,
					this._editorService,
					this._telemetryService,
					this._notificationService,
					this._clipboardService,
				);
				// Trust all domains
				if (pickedDomains.indexOf('*') !== -1) {
					return true;
				}
				// Trust current domain
				if (isURLDomainTrusted(resource, pickedDomains)) {
					return true;
				}
				return false;
			}

			this._telemetryService.publicLog2<{ action: string }, TrustedDomainsDialogActionClassification>(
				'trustedDomains.dialogAction',
				{ action: 'cancel' }
			);

			return false;
		}
	}
}

const rLocalhost = /^localhost(:\d+)?$/i;
const r127 = /^127.0.0.1(:\d+)?$/;

function isLocalhostAuthority(authority: string) {
	return rLocalhost.test(authority) || r127.test(authority);
}

/**
 * Case-normalize some case-insensitive URLs, such as github.
 */
function normalizeURL(url: string | URI): string {
	const caseInsensitiveAuthorities = ['github.com'];
	try {
		const parsed = typeof url === 'string' ? URI.parse(url, true) : url;
		if (caseInsensitiveAuthorities.includes(parsed.authority)) {
			return parsed.with({ path: parsed.path.toLowerCase() }).toString(true);
		} else {
			return parsed.toString(true);
		}
	} catch { return url.toString(); }
}

/**
 * Check whether a domain like https://www.microsoft.com matches
 * the list of trusted domains.
 *
 * - Schemes must match
 * - There's no subdomain matching. For example https://microsoft.com doesn't match https://www.microsoft.com
 * - Star matches all subdomains. For example https://*.microsoft.com matches https://www.microsoft.com and https://foo.bar.microsoft.com
 */
export function isURLDomainTrusted(url: URI, trustedDomains: string[]) {
	url = URI.parse(normalizeURL(url));
	trustedDomains = trustedDomains.map(normalizeURL);

	if (isLocalhostAuthority(url.authority)) {
		return true;
	}

	for (let i = 0; i < trustedDomains.length; i++) {
		if (trustedDomains[i] === '*') {
			return true;
		}

		if (isTrusted(url.toString(), trustedDomains[i])) {
			return true;
		}
	}

	return false;
}

export const isTrusted = (url: string, trustedURL: string): boolean => {
	const normalize = (url: string) => url.replace(/\/+$/, '');
	trustedURL = normalize(trustedURL);
	url = normalize(url);

	const memo = Array.from({ length: url.length + 1 }).map(() =>
		Array.from({ length: trustedURL.length + 1 }).map(() => undefined),
	);

	if (/^[^./:]*:\/\//.test(trustedURL)) {
		return doURLMatch(memo, url, trustedURL, 0, 0);
	}

	const scheme = /^(https?):\/\//.exec(url)?.[1];
	if (scheme) {
		return doURLMatch(memo, url, `${scheme}://${trustedURL}`, 0, 0);
	}

	return false;
};

const doURLMatch = (
	memo: (boolean | undefined)[][],
	url: string,
	trustedURL: string,
	urlOffset: number,
	trustedURLOffset: number,
): boolean => {
	if (memo[urlOffset]?.[trustedURLOffset] !== undefined) {
		return memo[urlOffset][trustedURLOffset]!;
	}

	const options = [];

	// Endgame.
	// Fully exact match
	if (urlOffset === url.length) {
		return trustedURLOffset === trustedURL.length;
	}

	// Some path remaining in url
	if (trustedURLOffset === trustedURL.length) {
		const remaining = url.slice(urlOffset);
		return remaining[0] === '/';
	}

	if (url[urlOffset] === trustedURL[trustedURLOffset]) {
		// Exact match.
		options.push(doURLMatch(memo, url, trustedURL, urlOffset + 1, trustedURLOffset + 1));
	}

	if (trustedURL[trustedURLOffset] + trustedURL[trustedURLOffset + 1] === '*.') {
		// Any subdomain match. Either consume one thing that's not a / or : and don't advance base or consume nothing and do.
		if (!['/', ':'].includes(url[urlOffset])) {
			options.push(doURLMatch(memo, url, trustedURL, urlOffset + 1, trustedURLOffset));
		}
		options.push(doURLMatch(memo, url, trustedURL, urlOffset, trustedURLOffset + 2));
	}

	if (trustedURL[trustedURLOffset] === '*') {
		// Any match. Either consume one thing and don't advance base or consume nothing and do.
		if (urlOffset + 1 === url.length) {
			// If we're at the end of the input url consume one from both.
			options.push(doURLMatch(memo, url, trustedURL, urlOffset + 1, trustedURLOffset + 1));
		} else {
			options.push(doURLMatch(memo, url, trustedURL, urlOffset + 1, trustedURLOffset));
		}
		options.push(doURLMatch(memo, url, trustedURL, urlOffset, trustedURLOffset + 1));
	}

	if (trustedURL[trustedURLOffset] + trustedURL[trustedURLOffset + 1] === ':*') {
		// any port match. Consume a port if it exists otherwise nothing. Always comsume the base.
		if (url[urlOffset] === ':') {
			let endPortIndex = urlOffset + 1;
			do { endPortIndex++; } while (/[0-9]/.test(url[endPortIndex]));
			options.push(doURLMatch(memo, url, trustedURL, endPortIndex, trustedURLOffset + 2));
		} else {
			options.push(doURLMatch(memo, url, trustedURL, urlOffset, trustedURLOffset + 2));
		}
	}

	return (memo[urlOffset][trustedURLOffset] = options.some(a => a === true));
};
