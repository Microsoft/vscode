/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export abstract class LoaderStats {
	abstract get amdLoad(): [string, number][];
	abstract get amdInvoke(): [string, number][];
	abstract get nodeRequire(): [string, number][];
	abstract get nodeEval(): [string, number][];
	abstract get nodeRequireTotal(): number;

	static get(): LoaderStats {
		const amdLoadScript = new Map<string, number>();
		const amdInvokeFactory = new Map<string, number>();
		const nodeRequire = new Map<string, number>();
		const nodeEval = new Map<string, number>();

		function mark(map: Map<string, number>, stat: LoaderEvent) {
			if (map.has(stat.detail)) {
				// console.warn('BAD events, DOUBLE start', stat);
				// map.delete(stat.detail);
				return;
			}
			map.set(stat.detail, -stat.timestamp);
		}

		function diff(map: Map<string, number>, stat: LoaderEvent) {
			let duration = map.get(stat.detail);
			if (!duration) {
				// console.warn('BAD events, end WITHOUT start', stat);
				// map.delete(stat.detail);
				return;
			}
			if (duration >= 0) {
				// console.warn('BAD events, DOUBLE end', stat);
				// map.delete(stat.detail);
				return;
			}
			map.set(stat.detail, duration + stat.timestamp);
		}

		const stats = require.getStats().slice(0).sort((a, b) => a.timestamp - b.timestamp);

		for (const stat of stats) {
			switch (stat.type) {
				case LoaderEventType.BeginLoadingScript:
					mark(amdLoadScript, stat);
					break;
				case LoaderEventType.EndLoadingScriptOK:
				case LoaderEventType.EndLoadingScriptError:
					diff(amdLoadScript, stat);
					break;

				case LoaderEventType.BeginInvokeFactory:
					mark(amdInvokeFactory, stat);
					break;
				case LoaderEventType.EndInvokeFactory:
					diff(amdInvokeFactory, stat);
					break;

				case LoaderEventType.NodeBeginNativeRequire:
					mark(nodeRequire, stat);
					break;
				case LoaderEventType.NodeEndNativeRequire:
					diff(nodeRequire, stat);
					break;

				case LoaderEventType.NodeBeginEvaluatingScript:
					mark(nodeEval, stat);
					break;
				case LoaderEventType.NodeEndEvaluatingScript:
					diff(nodeEval, stat);
					break;
			}
		}

		let nodeRequireTotal = 0;
		nodeRequire.forEach(value => nodeRequireTotal += value);

		function to2dArray(map: Map<string, number>): [string, number][] {
			let res: [string, number][] = [];
			map.forEach((value, index) => res.push([index, value]));
			return res;
		}

		return {
			amdLoad: to2dArray(amdLoadScript),
			amdInvoke: to2dArray(amdInvokeFactory),
			nodeRequire: to2dArray(nodeRequire),
			nodeEval: to2dArray(nodeEval),
			nodeRequireTotal
		};
	}

	static toMarkdownTable(header: string[], rows: Array<Array<{ toString(): string } | undefined>>): string {
		let result = '';

		let lengths: number[] = [];
		header.forEach((cell, ci) => {
			lengths[ci] = cell.length;
		});
		rows.forEach(row => {
			row.forEach((cell, ci) => {
				if (typeof cell === 'undefined') {
					cell = row[ci] = '-';
				}
				const len = cell.toString().length;
				lengths[ci] = Math.max(len, lengths[ci]);
			});
		});

		// header
		header.forEach((cell, ci) => { result += `| ${cell + ' '.repeat(lengths[ci] - cell.toString().length)} `; });
		result += '|\n';
		header.forEach((_cell, ci) => { result += `| ${'-'.repeat(lengths[ci])} `; });
		result += '|\n';

		// cells
		rows.forEach(row => {
			row.forEach((cell, ci) => {
				if (typeof cell !== 'undefined') {
					result += `| ${cell + ' '.repeat(lengths[ci] - cell.toString().length)} `;
				}
			});
			result += '|\n';
		});

		return result;
	}
}
