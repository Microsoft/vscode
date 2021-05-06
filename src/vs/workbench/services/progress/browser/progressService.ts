/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/progressService';

import { localize } from 'vs/nls';
import { IDisposable, dispose, DisposableStore, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IProgressService, IProgressOptions, IProgressStep, ProgressLocation, IProgress, Progress, IProgressCompositeOptions, IProgressNotificationOptions, IProgressRunner, IProgressIndicator, IProgressWindowOptions, IProgressDialogOptions } from 'vs/platform/progress/common/progress';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { StatusbarAlignment, IStatusbarService, IStatusbarEntryAccessor, IStatusbarEntry } from 'vs/workbench/services/statusbar/common/statusbar';
import { RunOnceScheduler, timeout } from 'vs/base/common/async';
import { ProgressBadge, IActivityService } from 'vs/workbench/services/activity/common/activity';
import { INotificationService, Severity, INotificationHandle } from 'vs/platform/notification/common/notification';
import { Action } from 'vs/base/common/actions';
import { Event, Emitter } from 'vs/base/common/event';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Dialog } from 'vs/base/browser/ui/dialog/dialog';
import { attachDialogStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { EventHelper } from 'vs/base/browser/dom';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { parseLinkedText } from 'vs/base/common/linkedText';
import { IViewsService, IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';

export class ProgressService extends Disposable implements IProgressService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IActivityService private readonly activityService: IActivityService,
		@IViewletService private readonly viewletService: IViewletService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IViewsService private readonly viewsService: IViewsService,
		@IPanelService private readonly panelService: IPanelService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IThemeService private readonly themeService: IThemeService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {
		super();
	}

	async withProgress<R = unknown>(options: IProgressOptions, task: (progress: IProgress<IProgressStep>) => Promise<R>, onDidCancel?: (choice?: number) => void): Promise<R> {
		const { location } = options;
		if (typeof location === 'string') {
			if (this.viewletService.getProgressIndicator(location)) {
				return this.withViewletProgress(location, task, { ...options, location });
			}

			if (this.panelService.getProgressIndicator(location)) {
				return this.withPanelProgress(location, task, { ...options, location });
			}

			if (this.viewsService.getViewProgressIndicator(location)) {
				return this.withViewProgress(location, task, { ...options, location });
			}

			throw new Error(`Bad progress location: ${location}`);
		}

		switch (location) {
			case ProgressLocation.Notification:
				return this.withNotificationProgress({ ...options, location }, task, onDidCancel);
			case ProgressLocation.Window:
				if ((options as IProgressWindowOptions).command) {
					// Window progress with command get's shown in the status bar
					return this.withWindowProgress({ ...options, location }, task);
				}
				// Window progress without command can be shown as silent notification
				// which will first appear in the status bar and can then be brought to
				// the front when clicking.
				return this.withNotificationProgress({ delay: 150 /* default for ProgressLocation.Window */, ...options, silent: true, location: ProgressLocation.Notification }, task, onDidCancel);
			case ProgressLocation.Explorer:
				return this.withViewletProgress('workbench.view.explorer', task, { ...options, location });
			case ProgressLocation.Scm:
				return this.withViewletProgress('workbench.view.scm', task, { ...options, location });
			case ProgressLocation.Extensions:
				return this.withViewletProgress('workbench.view.extensions', task, { ...options, location });
			case ProgressLocation.Dialog:
				return this.withDialogProgress(options, task, onDidCancel);
			default:
				throw new Error(`Bad progress location: ${location}`);
		}
	}

	private readonly windowProgressStack: [IProgressOptions, Progress<IProgressStep>][] = [];
	private windowProgressStatusEntry: IStatusbarEntryAccessor | undefined = undefined;

	private withWindowProgress<R = unknown>(options: IProgressWindowOptions, callback: (progress: IProgress<{ message?: string }>) => Promise<R>): Promise<R> {
		const task: [IProgressWindowOptions, Progress<IProgressStep>] = [options, new Progress<IProgressStep>(() => this.updateWindowProgress())];

		const promise = callback(task[1]);

		let delayHandle: any = setTimeout(() => {
			delayHandle = undefined;
			this.windowProgressStack.unshift(task);
			this.updateWindowProgress();

			// show progress for at least 150ms
			Promise.all([
				timeout(150),
				promise
			]).finally(() => {
				const idx = this.windowProgressStack.indexOf(task);
				this.windowProgressStack.splice(idx, 1);
				this.updateWindowProgress();
			});
		}, 150);

		// cancel delay if promise finishes below 150ms
		return promise.finally(() => clearTimeout(delayHandle));
	}

	private updateWindowProgress(idx: number = 0) {

		// We still have progress to show
		if (idx < this.windowProgressStack.length) {
			const [options, progress] = this.windowProgressStack[idx];

			let progressTitle = options.title;
			let progressMessage = progress.value && progress.value.message;
			let progressCommand = (<IProgressWindowOptions>options).command;
			let text: string;
			let title: string;
			const source = options.source && typeof options.source !== 'string' ? options.source.label : options.source;

			if (progressTitle && progressMessage) {
				// <title>: <message>
				text = localize('progress.text2', "{0}: {1}", progressTitle, progressMessage);
				title = source ? localize('progress.title3', "[{0}] {1}: {2}", source, progressTitle, progressMessage) : text;

			} else if (progressTitle) {
				// <title>
				text = progressTitle;
				title = source ? localize('progress.title2', "[{0}]: {1}", source, progressTitle) : text;

			} else if (progressMessage) {
				// <message>
				text = progressMessage;
				title = source ? localize('progress.title2', "[{0}]: {1}", source, progressMessage) : text;

			} else {
				// no title, no message -> no progress. try with next on stack
				this.updateWindowProgress(idx + 1);
				return;
			}

			const statusEntryProperties: IStatusbarEntry = {
				text,
				showProgress: true,
				ariaLabel: text,
				tooltip: title,
				command: progressCommand
			};

			if (this.windowProgressStatusEntry) {
				this.windowProgressStatusEntry.update(statusEntryProperties);
			} else {
				this.windowProgressStatusEntry = this.statusbarService.addEntry(statusEntryProperties, 'status.progress', localize('status.progress', "Progress Message"), StatusbarAlignment.LEFT);
			}
		}

		// Progress is done so we remove the status entry
		else {
			this.windowProgressStatusEntry?.dispose();
			this.windowProgressStatusEntry = undefined;
		}
	}

	private withNotificationProgress<P extends Promise<R>, R = unknown>(options: IProgressNotificationOptions, callback: (progress: IProgress<IProgressStep>) => P, onDidCancel?: (choice?: number) => void): P {

		const progressStateModel = new class extends Disposable {

			private readonly _onDidReport = this._register(new Emitter<IProgressStep>());
			readonly onDidReport = this._onDidReport.event;

			private readonly _onWillDispose = this._register(new Emitter<void>());
			readonly onWillDispose = this._onWillDispose.event;

			private _step: IProgressStep | undefined = undefined;
			get step() { return this._step; }

			private _done = false;
			get done() { return this._done; }

			readonly promise: P;

			constructor() {
				super();

				this.promise = callback(this);

				this.promise.finally(() => {
					this.dispose();
				});
			}

			report(step: IProgressStep): void {
				this._step = step;

				this._onDidReport.fire(step);
			}

			cancel(choice?: number): void {
				onDidCancel?.(choice);

				this.dispose();
			}

			override dispose(): void {
				this._done = true;
				this._onWillDispose.fire();

				super.dispose();
			}
		};

		const createWindowProgress = () => {

			// Create a promise that we can resolve as needed
			// when the outside calls dispose on us
			let promiseResolve: () => void;
			const promise = new Promise<void>(resolve => promiseResolve = resolve);

			this.withWindowProgress({
				location: ProgressLocation.Window,
				title: options.title ? parseLinkedText(options.title).toString() : undefined, // convert markdown links => string
				command: 'notifications.showList'
			}, progress => {

				function reportProgress(step: IProgressStep) {
					if (step.message) {
						progress.report({
							message: parseLinkedText(step.message).toString()  // convert markdown links => string
						});
					}
				}

				// Apply any progress that was made already
				if (progressStateModel.step) {
					reportProgress(progressStateModel.step);
				}

				// Continue to report progress as it happens
				const onDidReportListener = progressStateModel.onDidReport(step => reportProgress(step));
				promise.finally(() => onDidReportListener.dispose());

				// When the progress model gets disposed, we are done as well
				Event.once(progressStateModel.onWillDispose)(() => promiseResolve());

				return promise;
			});

			// Dispose means completing our promise
			return toDisposable(() => promiseResolve());
		};

		const createNotification = (message: string, silent: boolean, increment?: number): INotificationHandle => {
			const notificationDisposables = new DisposableStore();

			const primaryActions = options.primaryActions ? Array.from(options.primaryActions) : [];
			const secondaryActions = options.secondaryActions ? Array.from(options.secondaryActions) : [];

			if (options.buttons) {
				options.buttons.forEach((button, index) => {
					const buttonAction = new class extends Action {
						constructor() {
							super(`progress.button.${button}`, button, undefined, true);
						}

						override async run(): Promise<void> {
							progressStateModel.cancel(index);
						}
					};
					notificationDisposables.add(buttonAction);

					primaryActions.push(buttonAction);
				});
			}

			if (options.cancellable) {
				const cancelAction = new class extends Action {
					constructor() {
						super('progress.cancel', localize('cancel', "Cancel"), undefined, true);
					}

					override async run(): Promise<void> {
						progressStateModel.cancel();
					}
				};
				notificationDisposables.add(cancelAction);

				primaryActions.push(cancelAction);
			}

			const notification = this.notificationService.notify({
				severity: Severity.Info,
				message,
				source: options.source,
				actions: { primary: primaryActions, secondary: secondaryActions },
				progress: typeof increment === 'number' && increment >= 0 ? { total: 100, worked: increment } : { infinite: true },
				silent
			});

			// Switch to window based progress once the notification
			// changes visibility to hidden and is still ongoing.
			// Remove that window based progress once the notification
			// shows again.
			let windowProgressDisposable: IDisposable | undefined = undefined;
			const onVisibilityChange = (visible: boolean) => {
				// Clear any previous running window progress
				dispose(windowProgressDisposable);

				// Create new window progress if notification got hidden
				if (!visible && !progressStateModel.done) {
					windowProgressDisposable = createWindowProgress();
				}
			};
			notificationDisposables.add(notification.onDidChangeVisibility(onVisibilityChange));
			if (silent) {
				onVisibilityChange(false);
			}

			// Clear upon dispose
			Event.once(notification.onDidClose)(() => notificationDisposables.dispose());

			return notification;
		};

		const updateProgress = (notification: INotificationHandle, increment?: number): void => {
			if (typeof increment === 'number' && increment >= 0) {
				notification.progress.total(100); // always percentage based
				notification.progress.worked(increment);
			} else {
				notification.progress.infinite();
			}
		};

		let notificationHandle: INotificationHandle | undefined;
		let notificationTimeout: any | undefined;
		let titleAndMessage: string | undefined; // hoisted to make sure a delayed notification shows the most recent message

		const updateNotification = (step?: IProgressStep): void => {

			// full message (inital or update)
			if (step?.message && options.title) {
				titleAndMessage = `${options.title}: ${step.message}`; // always prefix with overall title if we have it (https://github.com/microsoft/vscode/issues/50932)
			} else {
				titleAndMessage = options.title || step?.message;
			}

			if (!notificationHandle && titleAndMessage) {

				// create notification now or after a delay
				if (typeof options.delay === 'number' && options.delay > 0) {
					if (typeof notificationTimeout !== 'number') {
						notificationTimeout = setTimeout(() => notificationHandle = createNotification(titleAndMessage!, !!options.silent, step?.increment), options.delay);
					}
				} else {
					notificationHandle = createNotification(titleAndMessage, !!options.silent, step?.increment);
				}
			}

			if (notificationHandle) {
				if (titleAndMessage) {
					notificationHandle.updateMessage(titleAndMessage);
				}

				if (typeof step?.increment === 'number') {
					updateProgress(notificationHandle, step.increment);
				}
			}
		};

		// Show initially
		updateNotification(progressStateModel.step);
		const listener = progressStateModel.onDidReport(step => updateNotification(step));
		Event.once(progressStateModel.onWillDispose)(() => listener.dispose());

		// Clean up eventually
		(async () => {
			try {

				// with a delay we only wait for the finish of the promise
				if (typeof options.delay === 'number' && options.delay > 0) {
					await progressStateModel.promise;
				}

				// without a delay we show the notification for at least 800ms
				// to reduce the chance of the notification flashing up and hiding
				else {
					await Promise.all([timeout(800), progressStateModel.promise]);
				}
			} finally {
				clearTimeout(notificationTimeout);
				notificationHandle?.close();
			}
		})();

		return progressStateModel.promise;
	}

	private withViewletProgress<P extends Promise<R>, R = unknown>(viewletId: string, task: (progress: IProgress<IProgressStep>) => P, options: IProgressCompositeOptions): P {

		// show in viewlet
		const promise = this.withCompositeProgress(this.viewletService.getProgressIndicator(viewletId), task, options);

		// show on activity bar
		this.showOnActivityBar<P, R>(viewletId, options, promise);

		return promise;
	}

	private withViewProgress<P extends Promise<R>, R = unknown>(viewId: string, task: (progress: IProgress<IProgressStep>) => P, options: IProgressCompositeOptions): P {

		// show in viewlet
		const promise = this.withCompositeProgress(this.viewsService.getViewProgressIndicator(viewId), task, options);

		const location = this.viewDescriptorService.getViewLocationById(viewId);
		if (location !== ViewContainerLocation.Sidebar) {
			return promise;
		}

		const viewletId = this.viewDescriptorService.getViewContainerByViewId(viewId)?.id;
		if (viewletId === undefined) {
			return promise;
		}

		// show on activity bar
		this.showOnActivityBar(viewletId, options, promise);

		return promise;
	}

	private showOnActivityBar<P extends Promise<R>, R = unknown>(viewletId: string, options: IProgressCompositeOptions, promise: P): void {
		let activityProgress: IDisposable;
		let delayHandle: any = setTimeout(() => {
			delayHandle = undefined;
			const handle = this.activityService.showViewContainerActivity(viewletId, { badge: new ProgressBadge(() => ''), clazz: 'progress-badge', priority: 100 });
			const startTimeVisible = Date.now();
			const minTimeVisible = 300;
			activityProgress = {
				dispose() {
					const d = Date.now() - startTimeVisible;
					if (d < minTimeVisible) {
						// should at least show for Nms
						setTimeout(() => handle.dispose(), minTimeVisible - d);
					} else {
						// shown long enough
						handle.dispose();
					}
				}
			};
		}, options.delay || 300);
		promise.finally(() => {
			clearTimeout(delayHandle);
			dispose(activityProgress);
		});
	}

	private withPanelProgress<P extends Promise<R>, R = unknown>(panelid: string, task: (progress: IProgress<IProgressStep>) => P, options: IProgressCompositeOptions): P {

		// show in panel
		return this.withCompositeProgress(this.panelService.getProgressIndicator(panelid), task, options);
	}

	private withCompositeProgress<P extends Promise<R>, R = unknown>(progressIndicator: IProgressIndicator | undefined, task: (progress: IProgress<IProgressStep>) => P, options: IProgressCompositeOptions): P {
		let progressRunner: IProgressRunner | undefined = undefined;

		const promise = task({
			report: progress => {
				if (!progressRunner) {
					return;
				}

				if (typeof progress.increment === 'number') {
					progressRunner.worked(progress.increment);
				}

				if (typeof progress.total === 'number') {
					progressRunner.total(progress.total);
				}
			}
		});

		if (progressIndicator) {
			if (typeof options.total === 'number') {
				progressRunner = progressIndicator.show(options.total, options.delay);
				promise.catch(() => undefined /* ignore */).finally(() => progressRunner ? progressRunner.done() : undefined);
			} else {
				progressIndicator.showWhile(promise, options.delay);
			}
		}

		return promise;
	}

	private withDialogProgress<P extends Promise<R>, R = unknown>(options: IProgressDialogOptions, task: (progress: IProgress<IProgressStep>) => P, onDidCancel?: (choice?: number) => void): P {
		const disposables = new DisposableStore();

		const allowableCommands = [
			'workbench.action.quit',
			'workbench.action.reloadWindow',
			'copy',
			'cut',
			'editor.action.clipboardCopyAction',
			'editor.action.clipboardCutAction'
		];

		let dialog: Dialog;

		const createDialog = (message: string) => {
			const buttons = options.buttons || [];
			buttons.push(options.cancellable ? localize('cancel', "Cancel") : localize('dismiss', "Dismiss"));

			dialog = new Dialog(
				this.layoutService.container,
				message,
				buttons,
				{
					type: 'pending',
					detail: options.detail,
					cancelId: buttons.length - 1,
					keyEventProcessor: (event: StandardKeyboardEvent) => {
						const resolved = this.keybindingService.softDispatch(event, this.layoutService.container);
						if (resolved?.commandId) {
							if (!allowableCommands.includes(resolved.commandId)) {
								EventHelper.stop(event, true);
							}
						}
					}
				}
			);

			disposables.add(dialog);
			disposables.add(attachDialogStyler(dialog, this.themeService));

			dialog.show().then(dialogResult => {
				onDidCancel?.(dialogResult.button);

				dispose(dialog);
			});

			return dialog;
		};

		// In order to support the `delay` option, we use a scheduler
		// that will guard each access to the dialog behind a delay
		// that is either the original delay for one invocation and
		// otherwise runs without delay.
		let delay = options.delay ?? 0;
		let latestMessage: string | undefined = undefined;
		const scheduler = disposables.add(new RunOnceScheduler(() => {
			delay = 0; // since we have run once, we reset the delay

			if (latestMessage && !dialog) {
				dialog = createDialog(latestMessage);
			} else if (latestMessage) {
				dialog.updateMessage(latestMessage);
			}
		}, 0));

		const updateDialog = function (message?: string): void {
			latestMessage = message;

			// Make sure to only run one dialog update and not multiple
			if (!scheduler.isScheduled()) {
				scheduler.schedule(delay);
			}
		};

		const promise = task({
			report: progress => {
				updateDialog(progress.message);
			}
		});

		promise.finally(() => {
			dispose(disposables);
		});

		if (options.title) {
			updateDialog(options.title);
		}

		return promise;
	}
}

registerSingleton(IProgressService, ProgressService, true);
