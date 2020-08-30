/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextBufferBuilder } from 'vs/editor/common/model';
import { BenchmarkSuite } from 'vs/editor/test/common/model/benchmark/benchmarkUtils';
import { generateRandomChunkWithLF, generateRandomReplaces } from 'vs/editor/test/common/model/linesTextBuffer/textBufferAutoTestUtils';

const fileSizes = [1, 1000, 64 * 1000, 32 * 1000 * 1000];

for (const fileSize of fileSizes) {
	const chunks: string[] = [];

	const chunkCnt = Math.floor(fileSize / (64 * 1000));
	if (chunkCnt === 0) {
		chunks.push(generateRandomChunkWithLF(fileSize, fileSize));
	} else {
		const chunk = generateRandomChunkWithLF(64 * 1000, 64 * 1000);
		// try to avoid OOM
		for (let j = 0; j < chunkCnt; j++) {
			chunks.push(Buffer.from(chunk + j).toString());
		}
	}

	const replaceSuite = new BenchmarkSuite({
		name: `File Size: ${fileSize}Byte`,
		iterations: 10
	});

	const edits = generateRandomReplaces(chunks, 500, 5, 10);

	for (const i of [10, 100, 500]) {
		replaceSuite.add({
			name: `replace ${i} occurrences`,
			buildBuffer: (textBufferBuilder: ITextBufferBuilder) => {
				chunks.forEach(ck => textBufferBuilder.acceptChunk(ck));
				return textBufferBuilder.finish();
			},
			preCycle: (textBuffer) => {
				return textBuffer;
			},
			fn: (textBuffer) => {
				textBuffer.applyEdits(edits.slice(0, i), false, false);
			}
		});
	}

	replaceSuite.run();
}
