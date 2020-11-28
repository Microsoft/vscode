/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { renderMarkdown } from 'vs/base/browser/markdownRenderer';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { DefaultEndOfLine, EndOfLinePreference, ITextBuffer } from 'vs/editor/common/model';
import { Range } from 'vs/editor/common/core/range';
import { PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { handleANSIOutput } from 'vs/workbench/contrib/notebook/browser/view/output/transforms/errorTransform';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';

const SIZE_LIMIT = 65535;
const LINES_LIMIT = 500;

function generateViewMoreElement(outputs: string[], openerService: IOpenerService, textFileService: ITextFileService) {
	const md: IMarkdownString = {
		value: '[show more (open the raw output data in a text editor) ...](command:workbench.action.openLargeOutput)',
		isTrusted: true,
		supportThemeIcons: true
	};

	const element = renderMarkdown(md, {
		actionHandler: {
			callback: (content) => {
				if (content === 'command:workbench.action.openLargeOutput') {
					return textFileService.untitled.resolve({
						associatedResource: undefined,
						mode: 'plaintext',
						initialValue: outputs.join('')
					}).then(model => {
						const resource = model.resource;
						openerService.open(resource);
					});
				}

				return;
			},
			disposeables: new DisposableStore()
		}
	});

	element.classList.add('output-show-more');
	return element;
}

export function truncatedArrayOfString(container: HTMLElement, outputs: string[], openerService: IOpenerService, textFileService: ITextFileService, themeService: IThemeService, renderANSI: boolean) {
	const fullLen = outputs.reduce((p, c) => {
		return p + c.length;
	}, 0);

	let buffer: ITextBuffer | undefined = undefined;

	if (fullLen > SIZE_LIMIT) {
		// it's too large and we should find min(maxSizeLimit, maxLineLimit)
		const bufferBuilder = new PieceTreeTextBufferBuilder();
		outputs.forEach(output => bufferBuilder.acceptChunk(output));
		const factory = bufferBuilder.finish();
		buffer = factory.create(DefaultEndOfLine.LF);
		const sizeBufferLimitPosition = buffer.getPositionAt(SIZE_LIMIT);
		if (sizeBufferLimitPosition.lineNumber < LINES_LIMIT) {
			const truncatedText = buffer.getValueInRange(new Range(1, 1, sizeBufferLimitPosition.lineNumber, sizeBufferLimitPosition.column), EndOfLinePreference.TextDefined);
			if (renderANSI) {
				container.appendChild(handleANSIOutput(truncatedText, themeService));
			} else {
				const pre = DOM.$('div');
				pre.innerText = truncatedText;
				container.appendChild(pre);
			}

			// view more ...
			container.appendChild(generateViewMoreElement(outputs, openerService, textFileService));
			return;
		}
	}

	if (!buffer) {
		const bufferBuilder = new PieceTreeTextBufferBuilder();
		outputs.forEach(output => bufferBuilder.acceptChunk(output));
		const factory = bufferBuilder.finish();
		buffer = factory.create(DefaultEndOfLine.LF);
	}

	if (buffer.getLineCount() < LINES_LIMIT) {
		const lineCount = buffer.getLineCount();
		const fullRange = new Range(1, 1, lineCount, buffer.getLineLastNonWhitespaceColumn(lineCount));

		container.innerText = buffer.getValueInRange(fullRange, EndOfLinePreference.TextDefined);
		return;
	}

	if (renderANSI) {
		container.appendChild(handleANSIOutput(buffer.getValueInRange(new Range(1, 1, LINES_LIMIT - 5, buffer.getLineLastNonWhitespaceColumn(LINES_LIMIT - 5)), EndOfLinePreference.TextDefined), themeService));
	} else {
		const pre = DOM.$('div');
		pre.innerText = buffer.getValueInRange(new Range(1, 1, LINES_LIMIT - 5, buffer.getLineLastNonWhitespaceColumn(LINES_LIMIT - 5)), EndOfLinePreference.TextDefined);
		container.appendChild(pre);
	}


	// view more ...
	container.appendChild(generateViewMoreElement(outputs, openerService, textFileService));

	const lineCount = buffer.getLineCount();
	if (renderANSI) {
		container.appendChild(handleANSIOutput(buffer.getValueInRange(new Range(lineCount - 5, 1, lineCount, buffer.getLineLastNonWhitespaceColumn(lineCount)), EndOfLinePreference.TextDefined), themeService));
	} else {
		const post = DOM.$('div');
		post.innerText = buffer.getValueInRange(new Range(lineCount - 5, 1, lineCount, buffer.getLineLastNonWhitespaceColumn(lineCount)), EndOfLinePreference.TextDefined);
		container.appendChild(post);
	}
}
