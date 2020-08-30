/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as es from 'event-stream';
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';
import * as File from 'vinyl';
import * as appInsights from 'applicationinsights';

class Entry {
	constructor(readonly name: string, public totalCount: number, public totalSize: number) { }

	toString(pretty?: boolean): string {
		if (!pretty) {
			if (this.totalCount === 1) {
				return `${this.name}: ${this.totalSize} bytes`;
			} else {
				return `${this.name}: ${this.totalCount} files with ${this.totalSize} bytes`;
			}
		} else {
			if (this.totalCount === 1) {
				return `Stats for '${ansiColors.grey(this.name)}': ${Math.round(this.totalSize / 1204)}KB`;

			} else {
				const count = this.totalCount < 100
					? ansiColors.green(this.totalCount.toString())
					: ansiColors.red(this.totalCount.toString());

				return `Stats for '${ansiColors.grey(this.name)}': ${count} files, ${Math.round(this.totalSize / 1204)}KB`;
			}
		}
	}
}

const _entries = new Map<string, Entry>();

export function createStatsStream(group: string, log?: boolean): es.ThroughStream {

	const entry = new Entry(group, 0, 0);
	_entries.set(entry.name, entry);

	return es.through(function (data) {
		const file = data as File;
		if (typeof file.path === 'string') {
			entry.totalCount += 1;
			if (Buffer.isBuffer(file.contents)) {
				entry.totalSize += file.contents.length;
			} else if (file.stat && typeof file.stat.size === 'number') {
				entry.totalSize += file.stat.size;
			} else {
				// funky file...
			}
		}
		this.emit('data', data);
	}, function () {
		if (log) {
			if (entry.totalCount === 1) {
				fancyLog(`Stats for '${ansiColors.grey(entry.name)}': ${Math.round(entry.totalSize / 1204)}KB`);

			} else {
				const count = entry.totalCount < 100
					? ansiColors.green(entry.totalCount.toString())
					: ansiColors.red(entry.totalCount.toString());

				fancyLog(`Stats for '${ansiColors.grey(entry.name)}': ${count} files, ${Math.round(entry.totalSize / 1204)}KB`);
			}
		}

		this.emit('end');
	});
}

export function submitAllStats(productJson: any, commit: string): Promise<boolean> {

	const sorted: Entry[] = [];
	// move entries for single files to the front
	_entries.forEach(value => {
		if (value.totalCount === 1) {
			sorted.unshift(value);
		} else {
			sorted.push(value);
		}
	});

	// print to console
	for (const entry of sorted) {
		console.log(entry.toString(true));
	}

	// send data as telementry event when the
	// product is configured to send telemetry
	if (!productJson || !productJson.aiConfig || typeof productJson.aiConfig.asimovKey !== 'string') {
		return Promise.resolve(false);
	}

	return new Promise(resolve => {
		try {

			const sizes: any = {};
			const counts: any = {};
			for (const entry of sorted) {
				sizes[entry.name] = entry.totalSize;
				counts[entry.name] = entry.totalCount;
			}

			appInsights.setup(productJson.aiConfig.asimovKey)
				.setAutoCollectConsole(false)
				.setAutoCollectExceptions(false)
				.setAutoCollectPerformance(false)
				.setAutoCollectRequests(false)
				.setAutoCollectDependencies(false)
				.setAutoDependencyCorrelation(false)
				.start();

			appInsights.defaultClient.config.endpointUrl = 'https://vortex.data.microsoft.com/collect/v1';

			/* __GDPR__
				"monacoworkbench/packagemetrics" : {
					"commit" : {"classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
					"size" : {"classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
					"count" : {"classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
				}
			*/
			appInsights.defaultClient.trackEvent({
				name: 'monacoworkbench/packagemetrics',
				properties: { commit, size: JSON.stringify(sizes), count: JSON.stringify(counts) }
			});


			appInsights.defaultClient.flush({
				callback: () => {
					appInsights.dispose();
					resolve(true);
				}
			});

		} catch (err) {
			console.error('ERROR sending build stats as telemetry event!');
			console.error(err);
			resolve(false);
		}
	});

}
