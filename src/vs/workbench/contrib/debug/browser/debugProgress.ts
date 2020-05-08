/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IDebugService, VIEWLET_ID, IDebugSession } from 'vs/workbench/contrib/debug/common/debug';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';

export class DebugProgressContribution implements IWorkbenchContribution {

	private toDispose: IDisposable[] = [];

	constructor(
		@IDebugService private readonly debugService: IDebugService,
		@IProgressService private readonly progressService: IProgressService
	) {
		let progressListener: IDisposable | undefined;
		const listenOnProgress = (session: IDebugSession | undefined) => {
			if (progressListener) {
				progressListener.dispose();
				progressListener = undefined;
			}
			if (session) {
				progressListener = session.onDidProgressStart(async progressStartEvent => {
					const promise = new Promise<void>(r => {
						// Show progress until a progress end event comes or the session ends
						const listener = Event.any(Event.filter(session.onDidProgressEnd, e => e.body.progressId === progressStartEvent.body.progressId),
							session.onDidEndAdapter)(() => {
								listener.dispose();
								r();
							});
					});

					this.progressService.withProgress({ location: VIEWLET_ID }, () => promise);
					const source = this.debugService.getConfigurationManager().getDebuggerLabel(session.configuration.type);
					this.progressService.withProgress({
						location: ProgressLocation.Notification,
						title: progressStartEvent.body.title,
						cancellable: progressStartEvent.body.cancellable,
						silent: true,
						source,
						delay: 500
					}, progressStep => {
						let total = 0;
						const reportProgress = (progress: { message?: string, percentage?: number }) => {
							let increment = undefined;
							if (typeof progress.percentage === 'number') {
								increment = progress.percentage - total;
								total += increment;
							}
							progressStep.report({
								message: progress.message,
								increment,
								total: typeof increment === 'number' ? 100 : undefined,
							});
						};

						if (progressStartEvent.body.message) {
							reportProgress(progressStartEvent.body);
						}
						const progressUpdateListener = session.onDidProgressUpdate(e => {
							if (e.body.progressId === progressStartEvent.body.progressId) {
								reportProgress(e.body);
							}
						});

						return promise.then(() => progressUpdateListener.dispose());
					}, () => session.cancel(progressStartEvent.body.progressId));
				});
			}
		};
		this.toDispose.push(this.debugService.getViewModel().onDidFocusSession(listenOnProgress));
		listenOnProgress(this.debugService.getViewModel().focusedSession);
		this.toDispose.push(this.debugService.onWillNewSession(session => {
			if (!progressListener) {
				listenOnProgress(session);
			}
		}));
	}

	dispose(): void {
		dispose(this.toDispose);
	}
}
