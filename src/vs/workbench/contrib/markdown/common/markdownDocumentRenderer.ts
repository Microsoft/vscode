/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as marked from 'vs/base/common/marked/marked';
import { tokenizeToString } from 'vs/editor/common/modes/textToHtmlTokenizer';
import { ITokenizationSupport, TokenizationRegistry } from 'vs/editor/common/modes';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IModeService } from 'vs/editor/common/services/modeService';

/**
 * Renders a string of markdown as a document.
 *
 * Uses VS Code's syntax highlighting code blocks.
 */
export async function renderMarkdownDocument(
	text: string,
	extensionService: IExtensionService,
	modeService: IModeService,
): Promise<string> {
	const renderer = await getRenderer(text, extensionService, modeService);
	return marked(text, { renderer });
}

async function getRenderer(
	text: string,
	extensionService: IExtensionService,
	modeService: IModeService,
): Promise<marked.Renderer> {
	let result: Promise<ITokenizationSupport | null>[] = [];
	const renderer = new marked.Renderer();
	renderer.code = (_code, lang) => {
		const modeId = modeService.getModeIdForLanguageName(lang);
		if (modeId) {
			result.push(extensionService.whenInstalledExtensionsRegistered().then((): PromiseLike<ITokenizationSupport> | null => {
				modeService.triggerMode(modeId);
				return TokenizationRegistry.getPromise(modeId);
			}));
		}
		return '';
	};

	marked(text, { renderer });
	await Promise.all(result);

	renderer.code = (code, lang) => {
		const modeId = modeService.getModeIdForLanguageName(lang);
		return `<code>${tokenizeToString(code, modeId ? TokenizationRegistry.get(modeId)! : undefined)}</code>`;
	};
	return renderer;
}
