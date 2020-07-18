/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { ITextModelService, ITextModelContentProvider } from 'vs/editor/common/services/resolverService';
import { ITextModel } from 'vs/editor/common/model';
import { ILifecycleService, LifecyclePhase, StartupKindToString } from 'vs/platform/lifecycle/common/lifecycle';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ITimerService, IStartupMetrics } from 'vs/workbench/services/timer/browser/timerService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import * as perf from 'vs/base/common/performance';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { writeTransientState } from 'vs/workbench/contrib/codeEditor/browser/toggleWordWrap';
import { mergeSort } from 'vs/base/common/arrays';
import { IProductService } from 'vs/platform/product/common/productService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IFileService } from 'vs/platform/files/common/files';
import { ILabelService } from 'vs/platform/label/common/label';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';

export class PerfviewContrib {

	private readonly _registration: IDisposable;

	constructor(
		@IInstantiationService instaService: IInstantiationService,
		@ITextModelService textModelResolverService: ITextModelService
	) {
		this._registration = textModelResolverService.registerTextModelContentProvider('perf', instaService.createInstance(PerfModelContentProvider));
	}

	dispose(): void {
		this._registration.dispose();
	}
}

export class PerfviewInput extends ResourceEditorInput {

	static readonly Id = 'PerfviewInput';
	static readonly Uri = URI.from({ scheme: 'perf', path: 'Startup Performance' });

	constructor(
		@ITextModelService textModelResolverService: ITextModelService,
		@ITextFileService textFileService: ITextFileService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IFileService fileService: IFileService,
		@ILabelService labelService: ILabelService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService
	) {
		super(
			PerfviewInput.Uri,
			localize('name', "Startup Performance"),
			undefined,
			undefined,
			textModelResolverService,
			textFileService,
			editorService,
			editorGroupService,
			fileService,
			labelService,
			filesConfigurationService
		);
	}

	getTypeId(): string {
		return PerfviewInput.Id;
	}
}

class PerfModelContentProvider implements ITextModelContentProvider {

	private _model: ITextModel | undefined;
	private _modelDisposables: IDisposable[] = [];

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@IModeService private readonly _modeService: IModeService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@ITimerService private readonly _timerService: ITimerService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IProductService private readonly _productService: IProductService
	) { }

	provideTextContent(resource: URI): Promise<ITextModel> {

		if (!this._model || this._model.isDisposed()) {
			dispose(this._modelDisposables);
			const langId = this._modeService.create('markdown');
			this._model = this._modelService.getModel(resource) || this._modelService.createModel('Loading...', langId, resource);

			this._modelDisposables.push(langId.onDidChange(e => {
				if (this._model) {
					this._model.setMode(e);
				}
			}));
			this._modelDisposables.push(langId);
			this._modelDisposables.push(this._extensionService.onDidChangeExtensionsStatus(this._updateModel, this));

			writeTransientState(this._model, { forceWordWrap: 'off', forceWordWrapMinified: false }, this._editorService);
		}
		this._updateModel();
		return Promise.resolve(this._model);
	}

	private _updateModel(): void {

		Promise.all([
			this._timerService.startupMetrics,
			this._lifecycleService.when(LifecyclePhase.Eventually),
			this._extensionService.whenInstalledExtensionsRegistered()
		]).then(([metrics]) => {
			if (this._model && !this._model.isDisposed()) {

				let stats = LoaderStats.get();
				let md = new MarkdownBuilder();
				this._addSummary(md, metrics);
				md.blank();
				this._addSummaryTable(md, metrics, stats);
				md.blank();
				this._addExtensionsTable(md);
				md.blank();
				this._addRawPerfMarks(md);
				md.blank();
				this._addLoaderStats(md, stats);
				md.blank();
				this._addCachedDataStats(md);

				this._model.setValue(md.value);
			}
		});

	}

	private _addSummary(md: MarkdownBuilder, metrics: IStartupMetrics): void {
		md.heading(2, 'System Info');
		md.li(`${this._productService.nameShort}: ${this._productService.version} (${this._productService.commit || '0000000'})`);
		md.li(`OS: ${metrics.platform}(${metrics.release})`);
		if (metrics.cpus) {
			md.li(`CPUs: ${metrics.cpus.model}(${metrics.cpus.count} x ${metrics.cpus.speed})`);
		}
		if (typeof metrics.totalmem === 'number' && typeof metrics.freemem === 'number') {
			md.li(`Memory(System): ${(metrics.totalmem / (1024 * 1024 * 1024)).toFixed(2)} GB(${(metrics.freemem / (1024 * 1024 * 1024)).toFixed(2)}GB free)`);
		}
		if (metrics.meminfo) {
			md.li(`Memory(Process): ${(metrics.meminfo.workingSetSize / 1024).toFixed(2)} MB working set(${(metrics.meminfo.privateBytes / 1024).toFixed(2)}MB private, ${(metrics.meminfo.sharedBytes / 1024).toFixed(2)}MB shared)`);
		}
		md.li(`VM(likelyhood): ${metrics.isVMLikelyhood}%`);
		md.li(`Initial Startup: ${metrics.initialStartup}`);
		md.li(`Has ${metrics.windowCount - 1} other windows`);
		md.li(`Screen Reader Active: ${metrics.hasAccessibilitySupport}`);
		md.li(`Empty Workspace: ${metrics.emptyWorkbench}`);
	}

	private _addSummaryTable(md: MarkdownBuilder, metrics: IStartupMetrics, stats?: LoaderStats): void {

		const table: Array<Array<string | number | undefined>> = [];
		table.push(['start => app.isReady', metrics.timers.ellapsedAppReady, '[main]', `initial startup: ${metrics.initialStartup}`]);
		table.push(['nls:start => nls:end', metrics.timers.ellapsedNlsGeneration, '[main]', `initial startup: ${metrics.initialStartup}`]);
		table.push(['require(main.bundle.js)', metrics.initialStartup ? perf.getDuration('willLoadMainBundle', 'didLoadMainBundle') : undefined, '[main]', `initial startup: ${metrics.initialStartup}`]);
		table.push(['app.isReady => window.loadUrl()', metrics.timers.ellapsedWindowLoad, '[main]', `initial startup: ${metrics.initialStartup}`]);
		table.push(['window.loadUrl() => begin to require(workbench.desktop.main.js)', metrics.timers.ellapsedWindowLoadToRequire, '[main->renderer]', StartupKindToString(metrics.windowKind)]);
		table.push(['require(workbench.desktop.main.js)', metrics.timers.ellapsedRequire, '[renderer]', `cached data: ${(metrics.didUseCachedData ? 'YES' : 'NO')}${stats ? `, node_modules took ${stats.nodeRequireTotal}ms` : ''}`]);
		table.push(['require & init workspace storage', metrics.timers.ellapsedWorkspaceStorageInit, '[renderer]', undefined]);
		table.push(['init workspace service', metrics.timers.ellapsedWorkspaceServiceInit, '[renderer]', undefined]);
		table.push(['register extensions & spawn extension host', metrics.timers.ellapsedExtensions, '[renderer]', undefined]);
		table.push(['restore viewlet', metrics.timers.ellapsedViewletRestore, '[renderer]', metrics.viewletId]);
		table.push(['restore panel', metrics.timers.ellapsedPanelRestore, '[renderer]', metrics.panelId]);
		table.push(['restore editors', metrics.timers.ellapsedEditorRestore, '[renderer]', `${metrics.editorIds.length}: ${metrics.editorIds.join(', ')}`]);
		table.push(['overall workbench load', metrics.timers.ellapsedWorkbench, '[renderer]', undefined]);
		table.push(['workbench ready', metrics.ellapsed, '[main->renderer]', undefined]);
		table.push(['renderer ready', metrics.timers.ellapsedRenderer, '[renderer]', undefined]);
		table.push(['extensions registered', metrics.timers.ellapsedExtensionsReady, '[renderer]', undefined]);

		md.heading(2, 'Performance Marks');
		md.table(['What', 'Duration', 'Process', 'Info'], table);
	}

	private _addExtensionsTable(md: MarkdownBuilder): void {

		const eager: ({ toString(): string })[][] = [];
		const normal: ({ toString(): string })[][] = [];
		let extensionsStatus = this._extensionService.getExtensionsStatus();
		for (let id in extensionsStatus) {
			const { activationTimes: times } = extensionsStatus[id];
			if (!times) {
				continue;
			}
			if (times.activationReason.startup) {
				eager.push([id, times.activationReason.startup, times.codeLoadingTime, times.activateCallTime, times.activateResolvedTime, times.activationReason.activationEvent, times.activationReason.extensionId.value]);
			} else {
				normal.push([id, times.activationReason.startup, times.codeLoadingTime, times.activateCallTime, times.activateResolvedTime, times.activationReason.activationEvent, times.activationReason.extensionId.value]);
			}
		}

		const table = eager.concat(normal);
		if (table.length > 0) {
			md.heading(2, 'Extension Activation Stats');
			md.table(
				['Extension', 'Eager', 'Load Code', 'Call Activate', 'Finish Activate', 'Event', 'By'],
				table
			);
		}
	}

	private _addRawPerfMarks(md: MarkdownBuilder): void {
		md.heading(2, 'Raw Perf Marks');
		md.value += '```\n';
		md.value += `Name\tTimestamp\tDelta\tTotal\n`;
		let lastStartTime = -1;
		let total = 0;
		for (const { name, startTime } of perf.getEntries()) {
			let delta = lastStartTime !== -1 ? startTime - lastStartTime : 0;
			total += delta;
			md.value += `${name}\t${startTime}\t${delta}\t${total}\n`;
			lastStartTime = startTime;
		}
		md.value += '```\n';
	}

	private _addLoaderStats(md: MarkdownBuilder, stats: LoaderStats): void {
		md.heading(2, 'Loader Stats');
		md.heading(3, 'Load AMD-module');
		md.table(['Module', 'Duration'], stats.amdLoad);
		md.blank();
		md.heading(3, 'Load commonjs-module');
		md.table(['Module', 'Duration'], stats.nodeRequire);
		md.blank();
		md.heading(3, 'Invoke AMD-module factory');
		md.table(['Module', 'Duration'], stats.amdInvoke);
		md.blank();
		md.heading(3, 'Invoke commonjs-module');
		md.table(['Module', 'Duration'], stats.nodeEval);
	}

	private _addCachedDataStats(md: MarkdownBuilder): void {

		const map = new Map<LoaderEventType, string[]>();
		map.set(LoaderEventType.CachedDataCreated, []);
		map.set(LoaderEventType.CachedDataFound, []);
		map.set(LoaderEventType.CachedDataMissed, []);
		map.set(LoaderEventType.CachedDataRejected, []);
		for (const stat of require.getStats()) {
			if (map.has(stat.type)) {
				map.get(stat.type)!.push(stat.detail);
			}
		}

		const printLists = (arr?: string[]) => {
			if (arr) {
				arr.sort();
				for (const e of arr) {
					md.li(`${e}`);
				}
				md.blank();
			}
		};

		md.heading(2, 'Node Cached Data Stats');
		md.blank();
		md.heading(3, 'cached data used');
		printLists(map.get(LoaderEventType.CachedDataFound));
		md.heading(3, 'cached data missed');
		printLists(map.get(LoaderEventType.CachedDataMissed));
		md.heading(3, 'cached data rejected');
		printLists(map.get(LoaderEventType.CachedDataRejected));
		md.heading(3, 'cached data created (lazy, might need refreshes)');
		printLists(map.get(LoaderEventType.CachedDataCreated));
	}
}

abstract class LoaderStats {
	abstract get amdLoad(): (string | number)[][];
	abstract get amdInvoke(): (string | number)[][];
	abstract get nodeRequire(): (string | number)[][];
	abstract get nodeEval(): (string | number)[][];
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

		const stats = mergeSort(require.getStats().slice(0), (a, b) => a.timestamp - b.timestamp);

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

		function to2dArray(map: Map<string, number>): (string | number)[][] {
			let res: (string | number)[][] = [];
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
}

class MarkdownBuilder {

	value: string = '';

	heading(level: number, value: string): this {
		this.value += `${'#'.repeat(level)} ${value}\n\n`;
		return this;
	}

	blank() {
		this.value += '\n';
		return this;
	}

	li(value: string) {
		this.value += `* ${value}\n`;
		return this;
	}

	table(header: string[], rows: Array<Array<{ toString(): string } | undefined>>) {
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
		header.forEach((cell, ci) => { this.value += `| ${cell + ' '.repeat(lengths[ci] - cell.toString().length)} `; });
		this.value += '|\n';
		header.forEach((_cell, ci) => { this.value += `| ${'-'.repeat(lengths[ci])} `; });
		this.value += '|\n';

		// cells
		rows.forEach(row => {
			row.forEach((cell, ci) => {
				if (typeof cell !== 'undefined') {
					this.value += `| ${cell + ' '.repeat(lengths[ci] - cell.toString().length)} `;
				}
			});
			this.value += '|\n';
		});
	}
}
