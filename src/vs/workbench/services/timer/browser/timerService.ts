/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as perf from 'vs/base/common/performance';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IUpdateService } from 'vs/platform/update/common/update';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { Barrier } from 'vs/base/common/async';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';

/* __GDPR__FRAGMENT__
	"IMemoryInfo" : {
		"workingSetSize" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"privateBytes": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"sharedBytes": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
	}
*/
export interface IMemoryInfo {
	readonly workingSetSize: number;
	readonly privateBytes: number;
	readonly sharedBytes: number;
}

/* __GDPR__FRAGMENT__
	"IStartupMetrics" : {
		"version" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"ellapsed" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"isLatestVersion": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"didUseCachedData": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"windowKind": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"windowCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"viewletId": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"panelId": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"editorIds": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"timers.ellapsedAppReady" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedNlsGeneration" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedLoadMainBundle" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedCrashReporter" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedMainServer" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedWindowCreate" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedWindowLoad" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedWindowLoadToRequire" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedWaitForWindowConfig" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedStorageInit" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedWorkspaceServiceInit" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedSharedProcesConnected" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedRequiredUserDataInit" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedOtherUserDataInit" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedRequire" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedExtensions" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedExtensionsReady" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedViewletRestore" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedPanelRestore" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedEditorRestore" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"timers.ellapsedWorkbench" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"platform" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"release" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"arch" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"totalmem" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"freemem" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"meminfo" : { "${inline}": [ "${IMemoryInfo}" ] },
		"cpus.count" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"cpus.speed" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"cpus.model" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
		"initialStartup" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"hasAccessibilitySupport" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"isVMLikelyhood" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"emptyWorkbench" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
		"loadavg" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	}
*/
export interface IStartupMetrics {

	/**
	 * The version of these metrics.
	 */
	readonly version: 2;

	/**
	 * If this started the main process and renderer or just a renderer (new or reloaded).
	 */
	readonly initialStartup: boolean;

	/**
	 * No folder, no file, no workspace has been opened
	 */
	readonly emptyWorkbench: boolean;

	/**
	 * This is the latest (stable/insider) version. Iff not we should ignore this
	 * measurement.
	 */
	readonly isLatestVersion: boolean;

	/**
	 * Whether we asked for and V8 accepted cached data.
	 */
	readonly didUseCachedData: boolean;

	/**
	 * How/why the window was created. See https://github.com/microsoft/vscode/blob/d1f57d871722f4d6ba63e4ef6f06287121ceb045/src/vs/platform/lifecycle/common/lifecycle.ts#L50
	 */
	readonly windowKind: number;

	/**
	 * The total number of windows that have been restored/created
	 */
	readonly windowCount: number;

	/**
	 * The active viewlet id or `undedined`
	 */
	readonly viewletId?: string;

	/**
	 * The active panel id or `undefined`
	 */
	readonly panelId?: string;

	/**
	 * The editor input types or `[]`
	 */
	readonly editorIds: string[];

	/**
	 * The time it took to create the workbench.
	 *
	 * * Happens in the main-process *and* the renderer-process
	 * * Measured with the *start* and `didStartWorkbench`-performance mark. The *start* is either the start of the
	 * main process or the start of the renderer.
	 * * This should be looked at carefully because times vary depending on
	 *  * This being the first window, the only window, or a reloaded window
	 *  * Cached data being present and used or not
	 *  * The numbers and types of editors being restored
	 *  * The numbers of windows being restored (when starting 'fresh')
	 *  * The viewlet being restored (esp. when it's a contributed viewlet)
	 */
	readonly ellapsed: number;

	/**
	 * Individual timers...
	 */
	readonly timers: {
		/**
		 * The time it took to receieve the [`ready`](https://electronjs.org/docs/api/app#event-ready)-event. Measured from the first line
		 * of JavaScript code till receiving that event.
		 *
		 * * Happens in the main-process
		 * * Measured with the `main:started` and `main:appReady` performance marks.
		 * * This can be compared between insider and stable builds.
		 * * This should be looked at per OS version and per electron version.
		 * * This is often affected by AV software (and can change with AV software updates outside of our release-cycle).
		 * * It is not our code running here and we can only observe what's happening.
		 */
		readonly ellapsedAppReady?: number;

		/**
		 * The time it took to generate NLS data.
		 *
		 * * Happens in the main-process
		 * * Measured with the `nlsGeneration:start` and `nlsGeneration:end` performance marks.
		 * * This only happens when a non-english locale is being used.
		 * * It is our code running here and we should monitor this carefully for regressions.
		 */
		readonly ellapsedNlsGeneration?: number;

		/**
		 * The time it took to load the main bundle.
		 *
		 * * Happens in the main-process
		 * * Measured with the `willLoadMainBundle` and `didLoadMainBundle` performance marks.
		 */
		readonly ellapsedLoadMainBundle?: number;

		/**
		 * The time it took to start the crash reporter.
		 *
		 * * Happens in the main-process
		 * * Measured with the `willStartCrashReporter` and `didStartCrashReporter` performance marks.
		 */
		readonly ellapsedCrashReporter?: number;

		/**
		 * The time it took to create the main instance server.
		 *
		 * * Happens in the main-process
		 * * Measured with the `willStartMainServer` and `didStartMainServer` performance marks.
		 */
		readonly ellapsedMainServer?: number;

		/**
		 * The time it took to create the window.
		 *
		 * * Happens in the main-process
		 * * Measured with the `willCreateCodeWindow` and `didCreateCodeWindow` performance marks.
		 */
		readonly ellapsedWindowCreate?: number;

		/**
		 * The time it took to create the electron browser window.
		 *
		 * * Happens in the main-process
		 * * Measured with the `willCreateCodeBrowserWindow` and `didCreateCodeBrowserWindow` performance marks.
		 */
		readonly ellapsedBrowserWindowCreate?: number;

		/**
		 * The time it took to restore and validate window state.
		 *
		 * * Happens in the main-process
		 * * Measured with the `willRestoreCodeWindowState` and `didRestoreCodeWindowState` performance marks.
		 */
		readonly ellapsedWindowRestoreState?: number;

		/**
		 * The time it took to maximize/show the window.
		 *
		 * * Happens in the main-process
		 * * Measured with the `willMaximizeCodeWindow` and `didMaximizeCodeWindow` performance marks.
		 */
		readonly ellapsedWindowMaximize?: number;

		/**
		 * The time it took to tell electron to open/restore a renderer (browser window).
		 *
		 * * Happens in the main-process
		 * * Measured with the `main:appReady` and `code/willOpenNewWindow` performance marks.
		 * * This can be compared between insider and stable builds.
		 * * It is our code running here and we should monitor this carefully for regressions.
		 */
		readonly ellapsedWindowLoad?: number;

		/**
		 * The time it took to create a new renderer (browser window) and to initialize that to the point
		 * of load the main-bundle (`workbench.desktop.main.js`).
		 *
		 * * Happens in the main-process *and* the renderer-process
		 * * Measured with the `code/willOpenNewWindow` and `willLoadWorkbenchMain` performance marks.
		 * * This can be compared between insider and stable builds.
		 * * It is mostly not our code running here and we can only observe what's happening.
		 *
		 */
		readonly ellapsedWindowLoadToRequire: number;

		/**
		 * The time it took to wait for resolving the window configuration. This time the workbench
		 * will not continue to load and be blocked entirely.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willWaitForWindowConfig` and `didWaitForWindowConfig` performance marks.
		 */
		readonly ellapsedWaitForWindowConfig: number;

		/**
		 * The time it took to init the storage database connection from the workbench.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `code/willInitStorage` and `code/didInitStorage` performance marks.
		 */
		readonly ellapsedStorageInit: number;

		/**
		 * The time it took to initialize the workspace and configuration service.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willInitWorkspaceService` and `didInitWorkspaceService` performance marks.
		 */
		readonly ellapsedWorkspaceServiceInit: number;

		/**
		 * The time it took to connect to the shared process.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willConnectSharedProcess` and `didConnectSharedProcess` performance marks.
		 */
		readonly ellapsedSharedProcesConnected: number;

		/**
		 * The time it took to initialize required user data (settings & global state) using settings sync service.
		 *
		 * * Happens in the renderer-process (only in Web)
		 * * Measured with the `willInitRequiredUserData` and `didInitRequiredUserData` performance marks.
		 */
		readonly ellapsedRequiredUserDataInit: number;

		/**
		 * The time it took to initialize other user data (keybindings, snippets & extensions) using settings sync service.
		 *
		 * * Happens in the renderer-process (only in Web)
		 * * Measured with the `willInitOtherUserData` and `didInitOtherUserData` performance marks.
		 */
		readonly ellapsedOtherUserDataInit: number;

		/**
		 * The time it took to load the main-bundle of the workbench, e.g. `workbench.desktop.main.js`.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willLoadWorkbenchMain` and `didLoadWorkbenchMain` performance marks.
		 * * This varies *a lot* when V8 cached data could be used or not
		 * * This should be looked at with and without V8 cached data usage and per electron/v8 version
		 * * This is affected by the size of our code bundle (which  grows about 3-5% per release)
		 */
		readonly ellapsedRequire: number;

		/**
		 * The time it took to read extensions' package.json-files *and* interpret them (invoking
		 * the contribution points).
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willLoadExtensions` and `didLoadExtensions` performance marks.
		 * * Reading of package.json-files is avoided by caching them all in a single file (after the read,
		 * until another extension is installed)
		 * * Happens in parallel to other things, depends on async timing
		 */
		readonly ellapsedExtensions: number;

		// the time from start till `didLoadExtensions`
		// remove?
		readonly ellapsedExtensionsReady: number;

		/**
		 * The time it took to restore the viewlet.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willRestoreViewlet` and `didRestoreViewlet` performance marks.
		 * * This should be looked at per viewlet-type/id.
		 * * Happens in parallel to other things, depends on async timing
		 */
		readonly ellapsedViewletRestore: number;

		/**
		 * The time it took to restore the panel.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willRestorePanel` and `didRestorePanel` performance marks.
		 * * This should be looked at per panel-type/id.
		 * * Happens in parallel to other things, depends on async timing
		 */
		readonly ellapsedPanelRestore: number;

		/**
		 * The time it took to restore and fully resolve visible editors - that is text editor
		 * and complex editor likes the settings UI or webviews (markdown preview).
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willRestoreEditors` and `didRestoreEditors` performance marks.
		 * * This should be looked at per editor and per editor type.
		 * * Happens in parallel to other things, depends on async timing
		 */
		readonly ellapsedEditorRestore: number;

		/**
		 * The time it took to create the workbench.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `willStartWorkbench` and `didStartWorkbench` performance marks.
		 */
		readonly ellapsedWorkbench: number;

		/**
		 * This time it took inside the renderer to start the workbench.
		 *
		 * * Happens in the renderer-process
		 * * Measured with the `renderer/started` and `didStartWorkbench` performance marks
		 */
		readonly ellapsedRenderer: number;
	};

	readonly hasAccessibilitySupport: boolean;
	readonly isVMLikelyhood?: number;
	readonly platform?: string;
	readonly release?: string;
	readonly arch?: string;
	readonly totalmem?: number;
	readonly freemem?: number;
	readonly meminfo?: IMemoryInfo;
	readonly cpus?: { count: number; speed: number; model: string; };
	readonly loadavg?: number[];
}

export interface ITimerService {
	readonly _serviceBrand: undefined;

	/**
	 * A promise that resolved when startup timings and perf marks
	 * are available. This depends on lifecycle phases and extension
	 * hosts being started.
	 */
	whenReady(): Promise<boolean>;

	/**
	 * Startup metrics. Can ONLY be accessed after `whenReady` has resolved.
	 */
	readonly startupMetrics: IStartupMetrics;

	/**
	 * Deliver performance marks from a source, like the main process or extension hosts.
	 * The source argument acts as an identifier and therefore it must be unique.
	 */
	setPerformanceMarks(source: string, marks: perf.PerformanceMark[]): void;

	/**
	 * Get all currently known performance marks by source. There is no sorting of the
	 * returned tuples but the marks of a tuple are guaranteed to be sorted by start times.
	 */
	getPerformanceMarks(): [source: string, marks: readonly perf.PerformanceMark[]][];
}

export const ITimerService = createDecorator<ITimerService>('timerService');


class PerfMarks {

	private readonly _entries: [string, perf.PerformanceMark[]][] = [];

	setMarks(source: string, entries: perf.PerformanceMark[]): void {
		this._entries.push([source, entries]);
	}

	getDuration(from: string, to: string): number {
		const fromEntry = this._findEntry(from);
		if (!fromEntry) {
			return 0;
		}
		const toEntry = this._findEntry(to);
		if (!toEntry) {
			return 0;
		}
		return toEntry.startTime - fromEntry.startTime;
	}

	private _findEntry(name: string): perf.PerformanceMark | void {
		for (let [, marks] of this._entries) {
			for (let i = marks.length - 1; i >= 0; i--) {
				if (marks[i].name === name) {
					return marks[i];
				}
			}
		}
	}

	getEntries() {
		return this._entries.slice(0);
	}
}

export type Writeable<T> = { -readonly [P in keyof T]: Writeable<T[P]> };

export abstract class AbstractTimerService implements ITimerService {

	declare readonly _serviceBrand: undefined;

	private readonly _barrier = new Barrier();
	private readonly _marks = new PerfMarks();
	private _startupMetrics?: IStartupMetrics;

	constructor(
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IUpdateService private readonly _updateService: IUpdateService,
		@IViewletService private readonly _viewletService: IViewletService,
		@IPanelService private readonly _panelService: IPanelService,
		@IEditorService private readonly _editorService: IEditorService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		Promise.all([
			this._extensionService.whenInstalledExtensionsRegistered(), // extensions registered
			_lifecycleService.when(LifecyclePhase.Restored),			// workbench created and parts restored
			layoutService.whenRestored									// layout restored (including visible editors resolved)
		]).then(() => {
			// set perf mark from renderer
			this.setPerformanceMarks('renderer', perf.getMarks());
			return this._computeStartupMetrics();
		}).then(metrics => {
			this._startupMetrics = metrics;
			this._reportStartupTimes(metrics);
			this._barrier.open();
		});
	}

	whenReady(): Promise<boolean> {
		return this._barrier.wait();
	}

	get startupMetrics(): IStartupMetrics {
		if (!this._startupMetrics) {
			throw new Error('illegal state, MUST NOT access startupMetrics before whenReady has resolved');
		}
		return this._startupMetrics;
	}

	setPerformanceMarks(source: string, marks: perf.PerformanceMark[]): void {
		// Perf marks are a shared resource because anyone can generate them
		// and because of that we only accept marks that start with 'code/'
		this._marks.setMarks(source, marks.filter(mark => mark.name.startsWith('code/')));
	}

	getPerformanceMarks(): [source: string, marks: readonly perf.PerformanceMark[]][] {
		return this._marks.getEntries();
	}

	private _reportStartupTimes(metrics: IStartupMetrics): void {
		// report IStartupMetrics as telemetry
		/* __GDPR__
			"startupTimeVaried" : {
				"${include}": [
					"${IStartupMetrics}"
				]
			}
		*/
		this._telemetryService.publicLog('startupTimeVaried', metrics);


		// report raw timers as telemetry. each mark is send a separate telemetry
		// event and it is "normalized" to a relative timestamp where the first mark
		// defines the start
		for (const [source, marks] of this.getPerformanceMarks()) {
			type Mark = { source: string; name: string; relativeStartTime: number; startTime: number; };
			type MarkClassification = {
				source: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth'; },
				name: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth'; },
				relativeStartTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true; },
				startTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true; },
			};

			let lastMark: perf.PerformanceMark = marks[0];
			for (const mark of marks) {
				let delta = mark.startTime - lastMark.startTime;
				this._telemetryService.publicLog2<Mark, MarkClassification>('startup.timer.mark', {
					source,
					name: mark.name,
					relativeStartTime: delta,
					startTime: mark.startTime
				});
				lastMark = mark;
			}
		}
	}

	private async _computeStartupMetrics(): Promise<IStartupMetrics> {
		const initialStartup = this._isInitialStartup();
		const startMark = initialStartup ? 'code/didStartMain' : 'code/willOpenNewWindow';

		const activeViewlet = this._viewletService.getActiveViewlet();
		const activePanel = this._panelService.getActivePanel();
		const info: Writeable<IStartupMetrics> = {
			version: 2,
			ellapsed: this._marks.getDuration(startMark, 'code/didStartWorkbench'),

			// reflections
			isLatestVersion: Boolean(await this._updateService.isLatestVersion()),
			didUseCachedData: this._didUseCachedData(),
			windowKind: this._lifecycleService.startupKind,
			windowCount: await this._getWindowCount(),
			viewletId: activeViewlet?.getId(),
			editorIds: this._editorService.visibleEditors.map(input => input.typeId),
			panelId: activePanel ? activePanel.getId() : undefined,

			// timers
			timers: {
				ellapsedAppReady: initialStartup ? this._marks.getDuration('code/didStartMain', 'code/mainAppReady') : undefined,
				ellapsedNlsGeneration: initialStartup ? this._marks.getDuration('code/willGenerateNls', 'code/didGenerateNls') : undefined,
				ellapsedLoadMainBundle: initialStartup ? this._marks.getDuration('code/willLoadMainBundle', 'code/didLoadMainBundle') : undefined,
				ellapsedCrashReporter: initialStartup ? this._marks.getDuration('code/willStartCrashReporter', 'code/didStartCrashReporter') : undefined,
				ellapsedMainServer: initialStartup ? this._marks.getDuration('code/willStartMainServer', 'code/didStartMainServer') : undefined,
				ellapsedWindowCreate: initialStartup ? this._marks.getDuration('code/willCreateCodeWindow', 'code/didCreateCodeWindow') : undefined,
				ellapsedWindowRestoreState: initialStartup ? this._marks.getDuration('code/willRestoreCodeWindowState', 'code/didRestoreCodeWindowState') : undefined,
				ellapsedBrowserWindowCreate: initialStartup ? this._marks.getDuration('code/willCreateCodeBrowserWindow', 'code/didCreateCodeBrowserWindow') : undefined,
				ellapsedWindowMaximize: initialStartup ? this._marks.getDuration('code/willMaximizeCodeWindow', 'code/didMaximizeCodeWindow') : undefined,
				ellapsedWindowLoad: initialStartup ? this._marks.getDuration('code/mainAppReady', 'code/willOpenNewWindow') : undefined,
				ellapsedWindowLoadToRequire: this._marks.getDuration('code/willOpenNewWindow', 'code/willLoadWorkbenchMain'),
				ellapsedRequire: this._marks.getDuration('code/willLoadWorkbenchMain', 'code/didLoadWorkbenchMain'),
				ellapsedWaitForWindowConfig: this._marks.getDuration('code/willWaitForWindowConfig', 'code/didWaitForWindowConfig'),
				ellapsedStorageInit: this._marks.getDuration('code/willInitStorage', 'code/didInitStorage'),
				ellapsedSharedProcesConnected: this._marks.getDuration('code/willConnectSharedProcess', 'code/didConnectSharedProcess'),
				ellapsedWorkspaceServiceInit: this._marks.getDuration('code/willInitWorkspaceService', 'code/didInitWorkspaceService'),
				ellapsedRequiredUserDataInit: this._marks.getDuration('code/willInitRequiredUserData', 'code/didInitRequiredUserData'),
				ellapsedOtherUserDataInit: this._marks.getDuration('code/willInitOtherUserData', 'code/didInitOtherUserData'),
				ellapsedExtensions: this._marks.getDuration('code/willLoadExtensions', 'code/didLoadExtensions'),
				ellapsedEditorRestore: this._marks.getDuration('code/willRestoreEditors', 'code/didRestoreEditors'),
				ellapsedViewletRestore: this._marks.getDuration('code/willRestoreViewlet', 'code/didRestoreViewlet'),
				ellapsedPanelRestore: this._marks.getDuration('code/willRestorePanel', 'code/didRestorePanel'),
				ellapsedWorkbench: this._marks.getDuration('code/willStartWorkbench', 'code/didStartWorkbench'),
				ellapsedExtensionsReady: this._marks.getDuration(startMark, 'code/didLoadExtensions'),
				ellapsedRenderer: this._marks.getDuration('code/didStartRenderer', 'code/didStartWorkbench')
			},

			// system info
			platform: undefined,
			release: undefined,
			arch: undefined,
			totalmem: undefined,
			freemem: undefined,
			meminfo: undefined,
			cpus: undefined,
			loadavg: undefined,
			isVMLikelyhood: undefined,
			initialStartup,
			hasAccessibilitySupport: this._accessibilityService.isScreenReaderOptimized(),
			emptyWorkbench: this._contextService.getWorkbenchState() === WorkbenchState.EMPTY
		};

		await this._extendStartupInfo(info);
		return info;
	}

	protected abstract _isInitialStartup(): boolean;

	protected abstract _didUseCachedData(): boolean;

	protected abstract _getWindowCount(): Promise<number>;

	protected abstract _extendStartupInfo(info: Writeable<IStartupMetrics>): Promise<void>;
}


export class TimerService extends AbstractTimerService {

	protected _isInitialStartup(): boolean {
		return false;
	}
	protected _didUseCachedData(): boolean {
		return false;
	}
	protected async _getWindowCount(): Promise<number> {
		return 1;
	}
	protected async _extendStartupInfo(info: Writeable<IStartupMetrics>): Promise<void> {
		info.isVMLikelyhood = 0;
		info.platform = navigator.userAgent;
		info.release = navigator.appVersion;
	}
}
