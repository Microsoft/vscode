/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const MarkdownIt = require('markdown-it');

export async function activate(ctx: {
	dependencies: ReadonlyArray<{ entrypoint: string }>
}) {
	let markdownIt = new MarkdownIt({
		html: true
	});

	// Should we load the deps before this point?
	// Also could we await inside `renderMarkup`?
	await Promise.all(ctx.dependencies.map(async (dep) => {
		try {
			const api = await import(dep.entrypoint);
			if (api?.extendMarkdownIt) {
				markdownIt = api.extendMarkdownIt(markdownIt);
			}
		} catch (e) {
			console.error('Could not load markdown entryPoint', e);
		}
	}));

	return {
		renderMarkup: (context: { element: HTMLElement, content: string }) => {
			const rendered = markdownIt.render(context.content);
			context.element.innerHTML = rendered;

			// Insert styles into markdown preview shadow dom so that they are applied
			for (const markdownStyleNode of document.getElementsByClassName('markdown-style')) {
				context.element.insertAdjacentElement('beforebegin', markdownStyleNode.cloneNode(true) as Element);
			}
		}
	};
}
