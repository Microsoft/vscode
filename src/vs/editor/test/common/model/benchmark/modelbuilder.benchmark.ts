/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextBufferBuilder } from 'vs/editor/common/model';
import { PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { doBenchmark } from 'vs/editor/test/common/model/benchmark/benchmarkUtils';
import { generateRandomChunkWithLF } from 'vs/editor/test/common/model/linesTextBuffer/textBufferAutoTestUtils';

let pieceTreeTextBufferBuilder = new PieceTreeTextBufferBuilder();
let chunks: string[] = [];

for (let i = 0; i < 100; i++) {
	chunks.push(generateRandomChunkWithLF(16 * 1000, 64 * 1000));
}

let modelBuildBenchmark = function (id: string, builders: ITextBufferBuilder[], chunkCnt: number) {
	doBenchmark(id, builders, builder => {
		for (let i = 0, len = Math.min(chunkCnt, chunks.length); i < len; i++) {
			builder.acceptChunk(chunks[i]);
		}
		builder.finish();
	});
};

console.log(`|model builder\t|line buffer\t|piece table\t|`);
console.log('|---|---|---|');
for (let i of [10, 100]) {
	modelBuildBenchmark(`${i} random chunks`, [pieceTreeTextBufferBuilder], i);
}
