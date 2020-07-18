/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import product from 'vs/platform/product/common/product';
import { isMacintosh, isLinux, language } from 'vs/base/common/platform';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';
import { MenuId, Action2, registerAction2, MenuRegistry } from 'vs/platform/actions/common/actions';
import { KeyChord, KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { IProductService } from 'vs/platform/product/common/productService';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

const helpCategory = { value: nls.localize('help', "Help"), original: 'Help' };

class KeybindingsReferenceAction extends Action2 {

	static readonly ID = 'workbench.action.keybindingsReference';
	static readonly AVAILABLE = !!(isLinux ? product.keyboardShortcutsUrlLinux : isMacintosh ? product.keyboardShortcutsUrlMac : product.keyboardShortcutsUrlWin);

	constructor() {
		super({
			id: KeybindingsReferenceAction.ID,
			title: { value: nls.localize('keybindingsReference', "Keyboard Shortcuts Reference"), original: 'Keyboard Shortcuts Reference' },
			category: helpCategory,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: null,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_R)
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		const url = isLinux ? productService.keyboardShortcutsUrlLinux : isMacintosh ? productService.keyboardShortcutsUrlMac : productService.keyboardShortcutsUrlWin;
		if (url) {
			openerService.open(URI.parse(url));
		}
	}
}

class OpenDocumentationUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openDocumentationUrl';
	static readonly AVAILABLE = !!product.documentationUrl;

	constructor() {
		super({
			id: OpenDocumentationUrlAction.ID,
			title: { value: nls.localize('openDocumentationUrl', "Documentation"), original: 'Documentation' },
			category: helpCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.documentationUrl) {
			openerService.open(URI.parse(productService.documentationUrl));
		}
	}
}

class OpenIntroductoryVideosUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openIntroductoryVideosUrl';
	static readonly AVAILABLE = !!product.introductoryVideosUrl;

	constructor() {
		super({
			id: OpenIntroductoryVideosUrlAction.ID,
			title: { value: nls.localize('openIntroductoryVideosUrl', "Introductory Videos"), original: 'Introductory Videos' },
			category: helpCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.introductoryVideosUrl) {
			openerService.open(URI.parse(productService.introductoryVideosUrl));
		}
	}
}

class OpenTipsAndTricksUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openTipsAndTricksUrl';
	static readonly AVAILABLE = !!product.tipsAndTricksUrl;

	constructor() {
		super({
			id: OpenTipsAndTricksUrlAction.ID,
			title: { value: nls.localize('openTipsAndTricksUrl', "Tips and Tricks"), original: 'Tips and Tricks' },
			category: helpCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.tipsAndTricksUrl) {
			openerService.open(URI.parse(productService.tipsAndTricksUrl));
		}
	}
}

class OpenNewsletterSignupUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openNewsletterSignupUrl';
	static readonly AVAILABLE = !!product.newsletterSignupUrl;

	constructor() {
		super({
			id: OpenNewsletterSignupUrlAction.ID,
			title: { value: nls.localize('newsletterSignup', "Signup for the VS Code Newsletter"), original: 'Signup for the VS Code Newsletter' },
			category: helpCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);
		const telemetryService = accessor.get(ITelemetryService);

		const info = await telemetryService.getTelemetryInfo();

		openerService.open(URI.parse(`${productService.newsletterSignupUrl}?machineId=${encodeURIComponent(info.machineId)}`));
	}
}

class OpenTwitterUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openTwitterUrl';
	static readonly AVAILABLE = !!product.twitterUrl;

	constructor() {
		super({
			id: OpenTwitterUrlAction.ID,
			title: { value: nls.localize('openTwitterUrl', "Join Us on Twitter"), original: 'Join Us on Twitter' },
			category: helpCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.twitterUrl) {
			openerService.open(URI.parse(productService.twitterUrl));
		}
	}
}

class OpenRequestFeatureUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openRequestFeatureUrl';
	static readonly AVAILABLE = !!product.requestFeatureUrl;

	constructor() {
		super({
			id: OpenRequestFeatureUrlAction.ID,
			title: { value: nls.localize('openUserVoiceUrl', "Search Feature Requests"), original: 'Search Feature Requests' },
			category: helpCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.requestFeatureUrl) {
			openerService.open(URI.parse(productService.requestFeatureUrl));
		}
	}
}

class OpenLicenseUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openLicenseUrl';
	static readonly AVAILABLE = !!product.licenseUrl;

	constructor() {
		super({
			id: OpenLicenseUrlAction.ID,
			title: { value: nls.localize('openLicenseUrl', "View License"), original: 'View License' },
			category: helpCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.licenseUrl) {
			if (language) {
				const queryArgChar = productService.licenseUrl.indexOf('?') > 0 ? '&' : '?';
				openerService.open(URI.parse(`${productService.licenseUrl}${queryArgChar}lang=${language}`));
			} else {
				openerService.open(URI.parse(productService.licenseUrl));
			}
		}
	}
}

class OpenPrivacyStatementUrlAction extends Action2 {

	static readonly ID = 'workbench.action.openPrivacyStatementUrl';
	static readonly AVAILABE = !!product.privacyStatementUrl;

	constructor() {
		super({
			id: OpenPrivacyStatementUrlAction.ID,
			title: { value: nls.localize('openPrivacyStatement', "Privacy Statement"), original: 'Privacy Statement' },
			category: helpCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const productService = accessor.get(IProductService);
		const openerService = accessor.get(IOpenerService);

		if (productService.privacyStatementUrl) {
			if (language) {
				const queryArgChar = productService.privacyStatementUrl.indexOf('?') > 0 ? '&' : '?';
				openerService.open(URI.parse(`${productService.privacyStatementUrl}${queryArgChar}lang=${language}`));
			} else {
				openerService.open(URI.parse(productService.privacyStatementUrl));
			}
		}
	}
}

// --- Actions Registration

if (KeybindingsReferenceAction.AVAILABLE) {
	registerAction2(KeybindingsReferenceAction);
}

if (OpenDocumentationUrlAction.AVAILABLE) {
	registerAction2(OpenDocumentationUrlAction);
}

if (OpenIntroductoryVideosUrlAction.AVAILABLE) {
	registerAction2(OpenIntroductoryVideosUrlAction);
}

if (OpenTipsAndTricksUrlAction.AVAILABLE) {
	registerAction2(OpenTipsAndTricksUrlAction);
}

if (OpenNewsletterSignupUrlAction.AVAILABLE) {
	registerAction2(OpenNewsletterSignupUrlAction);
}

if (OpenTwitterUrlAction.AVAILABLE) {
	registerAction2(OpenTwitterUrlAction);
}

if (OpenRequestFeatureUrlAction.AVAILABLE) {
	registerAction2(OpenRequestFeatureUrlAction);
}

if (OpenLicenseUrlAction.AVAILABLE) {
	registerAction2(OpenLicenseUrlAction);
}

if (OpenPrivacyStatementUrlAction.AVAILABE) {
	registerAction2(OpenPrivacyStatementUrlAction);
}

// --- Menu Registration

// Help

if (OpenDocumentationUrlAction.AVAILABLE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '1_welcome',
		command: {
			id: OpenDocumentationUrlAction.ID,
			title: nls.localize({ key: 'miDocumentation', comment: ['&& denotes a mnemonic'] }, "&&Documentation")
		},
		order: 3
	});
}

// Reference
if (KeybindingsReferenceAction.AVAILABLE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '2_reference',
		command: {
			id: KeybindingsReferenceAction.ID,
			title: nls.localize({ key: 'miKeyboardShortcuts', comment: ['&& denotes a mnemonic'] }, "&&Keyboard Shortcuts Reference")
		},
		order: 1
	});
}

if (OpenIntroductoryVideosUrlAction.AVAILABLE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '2_reference',
		command: {
			id: OpenIntroductoryVideosUrlAction.ID,
			title: nls.localize({ key: 'miIntroductoryVideos', comment: ['&& denotes a mnemonic'] }, "Introductory &&Videos")
		},
		order: 2
	});
}

if (OpenTipsAndTricksUrlAction.AVAILABLE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '2_reference',
		command: {
			id: OpenTipsAndTricksUrlAction.ID,
			title: nls.localize({ key: 'miTipsAndTricks', comment: ['&& denotes a mnemonic'] }, "Tips and Tri&&cks")
		},
		order: 3
	});
}

// Feedback
if (OpenTwitterUrlAction.AVAILABLE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '3_feedback',
		command: {
			id: OpenTwitterUrlAction.ID,
			title: nls.localize({ key: 'miTwitter', comment: ['&& denotes a mnemonic'] }, "&&Join Us on Twitter")
		},
		order: 1
	});
}

if (OpenRequestFeatureUrlAction.AVAILABLE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '3_feedback',
		command: {
			id: OpenRequestFeatureUrlAction.ID,
			title: nls.localize({ key: 'miUserVoice', comment: ['&& denotes a mnemonic'] }, "&&Search Feature Requests")
		},
		order: 2
	});
}

// Legal
if (OpenLicenseUrlAction.AVAILABLE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '4_legal',
		command: {
			id: OpenLicenseUrlAction.ID,
			title: nls.localize({ key: 'miLicense', comment: ['&& denotes a mnemonic'] }, "View &&License")
		},
		order: 1
	});
}

if (OpenPrivacyStatementUrlAction.AVAILABE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '4_legal',
		command: {
			id: OpenPrivacyStatementUrlAction.ID,
			title: nls.localize({ key: 'miPrivacyStatement', comment: ['&& denotes a mnemonic'] }, "Privac&&y Statement")
		},
		order: 2
	});
}
