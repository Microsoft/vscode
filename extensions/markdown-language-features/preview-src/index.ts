/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActiveLineMarker } from './activeLineMarker';
import { onceDocumentLoaded } from './events';
import { createPosterForVsCode } from './messaging';
import { getEditorLineNumberForPageOffset, scrollToRevealSourceLine, getLineElementForFragment } from './scroll-sync';
import { getSettings, getData } from './settings';
import throttle = require('lodash.throttle');

declare let acquireVsCodeApi: any;

let scrollDisabledCount = 0;
const marker = new ActiveLineMarker();
const settings = getSettings();

const vscode = acquireVsCodeApi();

const originalState = vscode.getState();

const state = {
	...(typeof originalState === 'object' ? originalState : {}),
	...getData<any>('data-state')
};

// Make sure to sync VS Code state here
vscode.setState(state);

const messaging = createPosterForVsCode(vscode);

window.cspAlerter.setPoster(messaging);
window.styleLoadingMonitor.setPoster(messaging);

window.onload = () => {
	updateImageSizes();
};


function doAfterImagesLoaded(cb: () => void) {
	const imgElements = document.getElementsByTagName('img');
	if (imgElements.length > 0) {
		const ps = Array.from(imgElements, e => {
			if (e.complete) {
				return Promise.resolve();
			} else {
				return new Promise<void>((resolve) => {
					e.addEventListener('load', () => resolve());
					e.addEventListener('error', () => resolve());
				});
			}
		});
		Promise.all(ps).then(() => setImmediate(cb));
	} else {
		setImmediate(cb);
	}
}

onceDocumentLoaded(() => {
	const scrollProgress = state.scrollProgress;

	if (typeof scrollProgress === 'number' && !settings.fragment) {
		doAfterImagesLoaded(() => {
			scrollDisabledCount += 1;
			window.scrollTo(0, scrollProgress * document.body.clientHeight);
		});
		return;
	}

	if (settings.scrollPreviewWithEditor) {
		doAfterImagesLoaded(() => {
			// Try to scroll to fragment if available
			if (settings.fragment) {
				state.fragment = undefined;
				vscode.setState(state);

				const element = getLineElementForFragment(settings.fragment);
				if (element) {
					scrollDisabledCount += 1;
					scrollToRevealSourceLine(element.line);
				}
			} else {
				if (!isNaN(settings.line!)) {
					scrollDisabledCount += 1;
					scrollToRevealSourceLine(settings.line!);
				}
			}
		});
	}
});

const onUpdateView = (() => {
	const doScroll = throttle((line: number) => {
		scrollDisabledCount += 1;
		doAfterImagesLoaded(() => scrollToRevealSourceLine(line));
	}, 50);

	return (line: number) => {
		if (!isNaN(line)) {
			state.line = line;

			doScroll(line);
		}
	};
})();

let updateImageSizes = throttle(() => {
	const imageInfo: { id: string, height: number, width: number; }[] = [];
	let images = document.getElementsByTagName('img');
	if (images) {
		let i;
		for (i = 0; i < images.length; i++) {
			const img = images[i];

			if (img.classList.contains('loading')) {
				img.classList.remove('loading');
			}

			imageInfo.push({
				id: img.id,
				height: img.height,
				width: img.width
			});
		}

		messaging.postMessage('cacheImageSizes', imageInfo);
	}
}, 50);

window.addEventListener('resize', () => {
	scrollDisabledCount += 1;
	updateScrollProgress();
	updateImageSizes();
}, true);

window.addEventListener('message', event => {
	if (event.data.source !== settings.source) {
		return;
	}

	switch (event.data.type) {
		case 'onDidChangeTextEditorSelection':
			marker.onDidChangeTextEditorSelection(event.data.line);
			break;

		case 'updateView':
			onUpdateView(event.data.line);
			break;
	}
}, false);

document.addEventListener('dblclick', event => {
	if (!settings.doubleClickToSwitchToEditor) {
		return;
	}

	// Ignore clicks on links
	for (let node = event.target as HTMLElement; node; node = node.parentNode as HTMLElement) {
		if (node.tagName === 'A') {
			return;
		}
	}

	const offset = event.pageY;
	const line = getEditorLineNumberForPageOffset(offset);
	if (typeof line === 'number' && !isNaN(line)) {
		messaging.postMessage('didClick', { line: Math.floor(line) });
	}
});

const passThroughLinkSchemes = ['http:', 'https:', 'mailto:', 'vscode:', 'vscode-insiders:'];

document.addEventListener('click', event => {
	if (!event) {
		return;
	}

	let node: any = event.target;
	while (node) {
		if (node.tagName && node.tagName === 'A' && node.href) {
			if (node.getAttribute('href').startsWith('#')) {
				return;
			}

			let hrefText = node.getAttribute('data-href');
			if (!hrefText) {
				// Pass through known schemes
				if (passThroughLinkSchemes.some(scheme => node.href.startsWith(scheme))) {
					return;
				}
				hrefText = node.getAttribute('href');
			}

			// If original link doesn't look like a url, delegate back to VS Code to resolve
			if (!/^[a-z\-]+:/i.test(hrefText)) {
				messaging.postMessage('openLink', { href: hrefText });
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			return;
		}
		node = node.parentNode;
	}
}, true);

window.addEventListener('scroll', throttle(() => {
	updateScrollProgress();

	if (scrollDisabledCount > 0) {
		scrollDisabledCount -= 1;
	} else {
		const line = getEditorLineNumberForPageOffset(window.scrollY);
		if (typeof line === 'number' && !isNaN(line)) {
			messaging.postMessage('revealLine', { line });
		}
	}
}, 50));

function updateScrollProgress() {
	state.scrollProgress = window.scrollY / document.body.clientHeight;
	vscode.setState(state);
}

