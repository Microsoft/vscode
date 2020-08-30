/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Profile, ProfileNode } from 'v8-inspect-profiler';
import { TernarySearchTree } from 'vs/base/common/map';
import { realpathSync } from 'vs/base/node/extpath';
import { IExtensionHostProfile, IExtensionService, ProfileSegmentId, ProfileSession } from 'vs/workbench/services/extensions/common/extensions';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { withNullAsUndefined } from 'vs/base/common/types';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';

export class ExtensionHostProfiler {

	constructor(private readonly _port: number, @IExtensionService private readonly _extensionService: IExtensionService) {
	}

	public async start(): Promise<ProfileSession> {
		const profiler = await import('v8-inspect-profiler');
		const session = await profiler.startProfiling({ port: this._port, checkForPaused: true });
		return {
			stop: async () => {
				const profile = await session.stop();
				const extensions = await this._extensionService.getExtensions();
				return this.distill((profile as any).profile, extensions);
			}
		};
	}

	private distill(profile: Profile, extensions: IExtensionDescription[]): IExtensionHostProfile {
		let searchTree = TernarySearchTree.forUris<IExtensionDescription>();
		for (let extension of extensions) {
			if (extension.extensionLocation.scheme === Schemas.file) {
				searchTree.set(URI.file(realpathSync(extension.extensionLocation.fsPath)), extension);
			}
		}

		let nodes = profile.nodes;
		let idsToNodes = new Map<number, ProfileNode>();
		let idsToSegmentId = new Map<number, ProfileSegmentId | null>();
		for (let node of nodes) {
			idsToNodes.set(node.id, node);
		}

		function visit(node: ProfileNode, segmentId: ProfileSegmentId | null) {
			if (!segmentId) {
				switch (node.callFrame.functionName) {
					case '(root)':
						break;
					case '(program)':
						segmentId = 'program';
						break;
					case '(garbage collector)':
						segmentId = 'gc';
						break;
					default:
						segmentId = 'self';
						break;
				}
			} else if (segmentId === 'self' && node.callFrame.url) {
				let extension: IExtensionDescription | undefined;
				try {
					extension = searchTree.findSubstr(URI.parse(node.callFrame.url));
				} catch {
					// ignore
				}
				if (extension) {
					segmentId = extension.identifier.value;
				}
			}
			idsToSegmentId.set(node.id, segmentId);

			if (node.children) {
				for (const child of node.children) {
					const childNode = idsToNodes.get(child);
					if (childNode) {
						visit(childNode, segmentId);
					}
				}
			}
		}
		visit(nodes[0], null);

		const samples = profile.samples || [];
		let timeDeltas = profile.timeDeltas || [];
		let distilledDeltas: number[] = [];
		let distilledIds: ProfileSegmentId[] = [];

		let currSegmentTime = 0;
		let currSegmentId: string | undefined;
		for (let i = 0; i < samples.length; i++) {
			let id = samples[i];
			let segmentId = idsToSegmentId.get(id);
			if (segmentId !== currSegmentId) {
				if (currSegmentId) {
					distilledIds.push(currSegmentId);
					distilledDeltas.push(currSegmentTime);
				}
				currSegmentId = withNullAsUndefined(segmentId);
				currSegmentTime = 0;
			}
			currSegmentTime += timeDeltas[i];
		}
		if (currSegmentId) {
			distilledIds.push(currSegmentId);
			distilledDeltas.push(currSegmentTime);
		}

		return {
			startTime: profile.startTime,
			endTime: profile.endTime,
			deltas: distilledDeltas,
			ids: distilledIds,
			data: profile,
			getAggregatedTimes: () => {
				let segmentsToTime = new Map<ProfileSegmentId, number>();
				for (let i = 0; i < distilledIds.length; i++) {
					let id = distilledIds[i];
					segmentsToTime.set(id, (segmentsToTime.get(id) || 0) + distilledDeltas[i]);
				}
				return segmentsToTime;
			}
		};
	}
}
