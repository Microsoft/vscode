/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefaultEndOfLine, ITextBuffer, ITextBufferBuilder, ITextBufferFactory } from 'vs/editor/common/model';
import { PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';

export function doBenchmark<T>(id: string, ts: T[], fn: (t: T) => void) {
	let columns: string[] = [id];
	for (const t of ts) {
		let start = process.hrtime();
		fn(t);
		let diff = process.hrtime(start);
		columns.push(`${(diff[0] * 1000 + diff[1] / 1000000).toFixed(3)} ms`);
	}
	console.log('|' + columns.join('\t|') + '|');
}

export interface IBenchmark {
	name: string;
	/**
	 * Before each cycle, this function will be called to create TextBufferFactory
	 */
	buildBuffer: (textBufferBuilder: ITextBufferBuilder) => ITextBufferFactory;
	/**
	 * Before each cycle, this function will be called to do pre-work for text buffer.
	 * This will be called onece `buildBuffer` is finished.
	 */
	preCycle: (textBuffer: ITextBuffer) => void;
	/**
	 * The function we are benchmarking
	 */
	fn: (textBuffer: ITextBuffer) => void;
}

export class BenchmarkSuite {
	name: string;
	iterations: number;
	benchmarks: IBenchmark[];

	constructor(suiteOptions: { name: string, iterations: number }) {
		this.name = suiteOptions.name;
		this.iterations = suiteOptions.iterations;
		this.benchmarks = [];
	}

	add(benchmark: IBenchmark) {
		this.benchmarks.push(benchmark);
	}

	run() {
		console.log(`|${this.name}\t|line buffer\t|piece table\t|edcore\t`);
		console.log('|---|---|---|---|');
		for (const benchmark of this.benchmarks) {
			let columns: string[] = [benchmark.name];
			[new PieceTreeTextBufferBuilder()].forEach((builder: ITextBufferBuilder) => {
				let timeDiffTotal = 0;
				for (let j = 0; j < this.iterations; j++) {
					let factory = benchmark.buildBuffer(builder);
					let buffer = factory.create(DefaultEndOfLine.LF);
					benchmark.preCycle(buffer);
					let start = process.hrtime();
					benchmark.fn(buffer);
					let diff = process.hrtime(start);
					timeDiffTotal += (diff[0] * 1000 * 1000 + diff[1] / 1000);
				}
				columns.push(`${(timeDiffTotal / 1000 / this.iterations).toFixed(3)} ms`);
			});
			console.log('|' + columns.join('\t|') + '|');
		}
		console.log('\n');
	}
}
