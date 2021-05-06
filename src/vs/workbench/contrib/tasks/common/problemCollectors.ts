/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary, INumberDictionary } from 'vs/base/common/collections';
import { URI } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';

import { IModelService } from 'vs/editor/common/services/modelService';

import { ILineMatcher, createLineMatcher, ProblemMatcher, ProblemMatch, ApplyToKind, WatchingPattern, getResource } from 'vs/workbench/contrib/tasks/common/problemMatcher';
import { IMarkerService, IMarkerData, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { generateUuid } from 'vs/base/common/uuid';
import { IFileService } from 'vs/platform/files/common/files';
import { isWindows } from 'vs/base/common/platform';

export const enum ProblemCollectorEventKind {
	BackgroundProcessingBegins = 'backgroundProcessingBegins',
	BackgroundProcessingEnds = 'backgroundProcessingEnds'
}

export interface ProblemCollectorEvent {
	kind: ProblemCollectorEventKind;
}

namespace ProblemCollectorEvent {
	export function create(kind: ProblemCollectorEventKind) {
		return Object.freeze({ kind });
	}
}

export interface IProblemMatcher {
	processLine(line: string): void;
}

export abstract class AbstractProblemCollector implements IDisposable {

	private matchers: INumberDictionary<ILineMatcher[]>;
	private activeMatcher: ILineMatcher | null;
	private _numberOfMatches: number;
	private _maxMarkerSeverity?: MarkerSeverity;
	private buffer: string[];
	private bufferLength: number;
	private openModels: IStringDictionary<boolean>;
	protected readonly modelListeners = new DisposableStore();
	private tail: Promise<void> | undefined;

	// [owner] -> ApplyToKind
	protected applyToByOwner: Map<string, ApplyToKind>;
	// [owner] -> [resource] -> URI
	private resourcesToClean: Map<string, Map<string, URI>>;
	// [owner] -> [resource] -> [markerkey] -> markerData
	private markers: Map<string, Map<string, Map<string, IMarkerData>>>;
	// [owner] -> [resource] -> number;
	private deliveredMarkers: Map<string, Map<string, number>>;

	protected _onDidStateChange: Emitter<ProblemCollectorEvent>;

	constructor(problemMatchers: ProblemMatcher[], protected markerService: IMarkerService, protected modelService: IModelService, fileService?: IFileService) {
		this.matchers = Object.create(null);
		this.bufferLength = 1;
		problemMatchers.map(elem => createLineMatcher(elem, fileService)).forEach((matcher) => {
			let length = matcher.matchLength;
			if (length > this.bufferLength) {
				this.bufferLength = length;
			}
			let value = this.matchers[length];
			if (!value) {
				value = [];
				this.matchers[length] = value;
			}
			value.push(matcher);
		});
		this.buffer = [];
		this.activeMatcher = null;
		this._numberOfMatches = 0;
		this._maxMarkerSeverity = undefined;
		this.openModels = Object.create(null);
		this.applyToByOwner = new Map<string, ApplyToKind>();
		for (let problemMatcher of problemMatchers) {
			let current = this.applyToByOwner.get(problemMatcher.owner);
			if (current === undefined) {
				this.applyToByOwner.set(problemMatcher.owner, problemMatcher.applyTo);
			} else {
				this.applyToByOwner.set(problemMatcher.owner, this.mergeApplyTo(current, problemMatcher.applyTo));
			}
		}
		this.resourcesToClean = new Map<string, Map<string, URI>>();
		this.markers = new Map<string, Map<string, Map<string, IMarkerData>>>();
		this.deliveredMarkers = new Map<string, Map<string, number>>();
		this.modelService.onModelAdded((model) => {
			this.openModels[model.uri.toString()] = true;
		}, this, this.modelListeners);
		this.modelService.onModelRemoved((model) => {
			delete this.openModels[model.uri.toString()];
		}, this, this.modelListeners);
		this.modelService.getModels().forEach(model => this.openModels[model.uri.toString()] = true);

		this._onDidStateChange = new Emitter();
	}

	public get onDidStateChange(): Event<ProblemCollectorEvent> {
		return this._onDidStateChange.event;
	}

	public processLine(line: string) {
		if (this.tail) {
			const oldTail = this.tail;
			this.tail = oldTail.then(() => {
				return this.processLineInternal(line);
			});
		} else {
			this.tail = this.processLineInternal(line);
		}
	}

	protected abstract processLineInternal(line: string): Promise<void>;

	public dispose() {
		this.modelListeners.dispose();
	}

	public get numberOfMatches(): number {
		return this._numberOfMatches;
	}

	public get maxMarkerSeverity(): MarkerSeverity | undefined {
		return this._maxMarkerSeverity;
	}

	protected tryFindMarker(line: string): ProblemMatch | null {
		let result: ProblemMatch | null = null;
		if (this.activeMatcher) {
			result = this.activeMatcher.next(line);
			if (result) {
				this.captureMatch(result);
				return result;
			}
			this.clearBuffer();
			this.activeMatcher = null;
		}
		if (this.buffer.length < this.bufferLength) {
			this.buffer.push(line);
		} else {
			let end = this.buffer.length - 1;
			for (let i = 0; i < end; i++) {
				this.buffer[i] = this.buffer[i + 1];
			}
			this.buffer[end] = line;
		}

		result = this.tryMatchers();
		if (result) {
			this.clearBuffer();
		}
		return result;
	}

	protected async shouldApplyMatch(result: ProblemMatch): Promise<boolean> {
		switch (result.description.applyTo) {
			case ApplyToKind.allDocuments:
				return true;
			case ApplyToKind.openDocuments:
				return !!this.openModels[(await result.resource).toString()];
			case ApplyToKind.closedDocuments:
				return !this.openModels[(await result.resource).toString()];
			default:
				return true;
		}
	}

	private mergeApplyTo(current: ApplyToKind, value: ApplyToKind): ApplyToKind {
		if (current === value || current === ApplyToKind.allDocuments) {
			return current;
		}
		return ApplyToKind.allDocuments;
	}

	private tryMatchers(): ProblemMatch | null {
		this.activeMatcher = null;
		let length = this.buffer.length;
		for (let startIndex = 0; startIndex < length; startIndex++) {
			let candidates = this.matchers[length - startIndex];
			if (!candidates) {
				continue;
			}
			for (const matcher of candidates) {
				let result = matcher.handle(this.buffer, startIndex);
				if (result.match) {
					this.captureMatch(result.match);
					if (result.continue) {
						this.activeMatcher = matcher;
					}
					return result.match;
				}
			}
		}
		return null;
	}

	private captureMatch(match: ProblemMatch): void {
		this._numberOfMatches++;
		if (this._maxMarkerSeverity === undefined || match.marker.severity > this._maxMarkerSeverity) {
			this._maxMarkerSeverity = match.marker.severity;
		}
	}

	private clearBuffer(): void {
		if (this.buffer.length > 0) {
			this.buffer = [];
		}
	}

	protected recordResourcesToClean(owner: string): void {
		let resourceSetToClean = this.getResourceSetToClean(owner);
		this.markerService.read({ owner: owner }).forEach(marker => resourceSetToClean.set(marker.resource.toString(), marker.resource));
	}

	protected recordResourceToClean(owner: string, resource: URI): void {
		this.getResourceSetToClean(owner).set(resource.toString(), resource);
	}

	protected removeResourceToClean(owner: string, resource: string): void {
		let resourceSet = this.resourcesToClean.get(owner);
		if (resourceSet) {
			resourceSet.delete(resource);
		}
	}

	private getResourceSetToClean(owner: string): Map<string, URI> {
		let result = this.resourcesToClean.get(owner);
		if (!result) {
			result = new Map<string, URI>();
			this.resourcesToClean.set(owner, result);
		}
		return result;
	}

	protected cleanAllMarkers(): void {
		this.resourcesToClean.forEach((value, owner) => {
			this._cleanMarkers(owner, value);
		});
		this.resourcesToClean = new Map<string, Map<string, URI>>();
	}

	protected cleanMarkers(owner: string): void {
		let toClean = this.resourcesToClean.get(owner);
		if (toClean) {
			this._cleanMarkers(owner, toClean);
			this.resourcesToClean.delete(owner);
		}
	}

	private _cleanMarkers(owner: string, toClean: Map<string, URI>): void {
		let uris: URI[] = [];
		let applyTo = this.applyToByOwner.get(owner);
		toClean.forEach((uri, uriAsString) => {
			if (
				applyTo === ApplyToKind.allDocuments ||
				(applyTo === ApplyToKind.openDocuments && this.openModels[uriAsString]) ||
				(applyTo === ApplyToKind.closedDocuments && !this.openModels[uriAsString])
			) {
				uris.push(uri);
			}
		});
		this.markerService.remove(owner, uris);
	}

	protected recordMarker(marker: IMarkerData, owner: string, resourceAsString: string): void {
		let markersPerOwner = this.markers.get(owner);
		if (!markersPerOwner) {
			markersPerOwner = new Map<string, Map<string, IMarkerData>>();
			this.markers.set(owner, markersPerOwner);
		}
		let markersPerResource = markersPerOwner.get(resourceAsString);
		if (!markersPerResource) {
			markersPerResource = new Map<string, IMarkerData>();
			markersPerOwner.set(resourceAsString, markersPerResource);
		}
		let key = IMarkerData.makeKeyOptionalMessage(marker, false);
		let existingMarker;
		if (!markersPerResource.has(key)) {
			markersPerResource.set(key, marker);
		} else if (((existingMarker = markersPerResource.get(key)) !== undefined) && (existingMarker.message.length < marker.message.length) && isWindows) {
			// Most likely https://github.com/microsoft/vscode/issues/77475
			// Heuristic dictates that when the key is the same and message is smaller, we have hit this limitation.
			markersPerResource.set(key, marker);
		}
	}

	protected reportMarkers(): void {
		this.markers.forEach((markersPerOwner, owner) => {
			let deliveredMarkersPerOwner = this.getDeliveredMarkersPerOwner(owner);
			markersPerOwner.forEach((markers, resource) => {
				this.deliverMarkersPerOwnerAndResourceResolved(owner, resource, markers, deliveredMarkersPerOwner);
			});
		});
	}

	protected deliverMarkersPerOwnerAndResource(owner: string, resource: string): void {
		let markersPerOwner = this.markers.get(owner);
		if (!markersPerOwner) {
			return;
		}
		let deliveredMarkersPerOwner = this.getDeliveredMarkersPerOwner(owner);
		let markersPerResource = markersPerOwner.get(resource);
		if (!markersPerResource) {
			return;
		}
		this.deliverMarkersPerOwnerAndResourceResolved(owner, resource, markersPerResource, deliveredMarkersPerOwner);
	}

	private deliverMarkersPerOwnerAndResourceResolved(owner: string, resource: string, markers: Map<string, IMarkerData>, reported: Map<string, number>): void {
		if (markers.size !== reported.get(resource)) {
			let toSet: IMarkerData[] = [];
			markers.forEach(value => toSet.push(value));
			this.markerService.changeOne(owner, URI.parse(resource), toSet);
			reported.set(resource, markers.size);
		}
	}

	private getDeliveredMarkersPerOwner(owner: string): Map<string, number> {
		let result = this.deliveredMarkers.get(owner);
		if (!result) {
			result = new Map<string, number>();
			this.deliveredMarkers.set(owner, result);
		}
		return result;
	}

	protected cleanMarkerCaches(): void {
		this._numberOfMatches = 0;
		this._maxMarkerSeverity = undefined;
		this.markers.clear();
		this.deliveredMarkers.clear();
	}

	public done(): void {
		this.reportMarkers();
		this.cleanAllMarkers();
	}
}

export const enum ProblemHandlingStrategy {
	Clean
}

export class StartStopProblemCollector extends AbstractProblemCollector implements IProblemMatcher {
	private owners: string[];

	private currentOwner: string | undefined;
	private currentResource: string | undefined;

	constructor(problemMatchers: ProblemMatcher[], markerService: IMarkerService, modelService: IModelService, _strategy: ProblemHandlingStrategy = ProblemHandlingStrategy.Clean, fileService?: IFileService) {
		super(problemMatchers, markerService, modelService, fileService);
		let ownerSet: { [key: string]: boolean; } = Object.create(null);
		problemMatchers.forEach(description => ownerSet[description.owner] = true);
		this.owners = Object.keys(ownerSet);
		this.owners.forEach((owner) => {
			this.recordResourcesToClean(owner);
		});
	}

	protected async processLineInternal(line: string): Promise<void> {
		let markerMatch = this.tryFindMarker(line);
		if (!markerMatch) {
			return;
		}

		let owner = markerMatch.description.owner;
		let resource = await markerMatch.resource;
		let resourceAsString = resource.toString();
		this.removeResourceToClean(owner, resourceAsString);
		let shouldApplyMatch = await this.shouldApplyMatch(markerMatch);
		if (shouldApplyMatch) {
			this.recordMarker(markerMatch.marker, owner, resourceAsString);
			if (this.currentOwner !== owner || this.currentResource !== resourceAsString) {
				if (this.currentOwner && this.currentResource) {
					this.deliverMarkersPerOwnerAndResource(this.currentOwner, this.currentResource);
				}
				this.currentOwner = owner;
				this.currentResource = resourceAsString;
			}
		}
	}
}

interface BackgroundPatterns {
	key: string;
	matcher: ProblemMatcher;
	begin: WatchingPattern;
	end: WatchingPattern;
}

export class WatchingProblemCollector extends AbstractProblemCollector implements IProblemMatcher {

	private problemMatchers: ProblemMatcher[];
	private backgroundPatterns: BackgroundPatterns[];

	// workaround for https://github.com/microsoft/vscode/issues/44018
	private _activeBackgroundMatchers: Set<string>;

	// Current State
	private currentOwner: string | undefined;
	private currentResource: string | undefined;

	private lines: string[] = [];

	constructor(problemMatchers: ProblemMatcher[], markerService: IMarkerService, modelService: IModelService, fileService?: IFileService) {
		super(problemMatchers, markerService, modelService, fileService);
		this.problemMatchers = problemMatchers;
		this.resetCurrentResource();
		this.backgroundPatterns = [];
		this._activeBackgroundMatchers = new Set<string>();
		this.problemMatchers.forEach(matcher => {
			if (matcher.watching) {
				const key: string = generateUuid();
				this.backgroundPatterns.push({
					key,
					matcher: matcher,
					begin: matcher.watching.beginsPattern,
					end: matcher.watching.endsPattern
				});
			}
		});

		this.modelListeners.add(this.modelService.onModelRemoved(modelEvent => {
			let markerChanged: IDisposable | undefined =
				Event.debounce(this.markerService.onMarkerChanged, (last: readonly URI[] | undefined, e: readonly URI[]) => {
					return (last ?? []).concat(e);
				}, 500)(async (markerEvent) => {
					markerChanged?.dispose();
					markerChanged = undefined;
					if (!markerEvent.includes(modelEvent.uri) || (this.markerService.read({ resource: modelEvent.uri }).length !== 0)) {
						return;
					}
					const oldLines = Array.from(this.lines);
					for (const line of oldLines) {
						await this.processLineInternal(line);
					}
				});
			setTimeout(async () => {
				markerChanged?.dispose();
				markerChanged = undefined;
			}, 600);
		}));
	}

	public aboutToStart(): void {
		for (let background of this.backgroundPatterns) {
			if (background.matcher.watching && background.matcher.watching.activeOnStart) {
				this._activeBackgroundMatchers.add(background.key);
				this._onDidStateChange.fire(ProblemCollectorEvent.create(ProblemCollectorEventKind.BackgroundProcessingBegins));
				this.recordResourcesToClean(background.matcher.owner);
			}
		}
	}

	protected async processLineInternal(line: string): Promise<void> {
		if (await this.tryBegin(line) || this.tryFinish(line)) {
			return;
		}
		this.lines.push(line);
		let markerMatch = this.tryFindMarker(line);
		if (!markerMatch) {
			return;
		}
		let resource = await markerMatch.resource;
		let owner = markerMatch.description.owner;
		let resourceAsString = resource.toString();
		this.removeResourceToClean(owner, resourceAsString);
		let shouldApplyMatch = await this.shouldApplyMatch(markerMatch);
		if (shouldApplyMatch) {
			this.recordMarker(markerMatch.marker, owner, resourceAsString);
			if (this.currentOwner !== owner || this.currentResource !== resourceAsString) {
				this.reportMarkersForCurrentResource();
				this.currentOwner = owner;
				this.currentResource = resourceAsString;
			}
		}
	}

	public forceDelivery(): void {
		this.reportMarkersForCurrentResource();
	}

	private async tryBegin(line: string): Promise<boolean> {
		let result = false;
		for (const background of this.backgroundPatterns) {
			let matches = background.begin.regexp.exec(line);
			if (matches) {
				if (this._activeBackgroundMatchers.has(background.key)) {
					continue;
				}
				this._activeBackgroundMatchers.add(background.key);
				result = true;
				this.lines = [];
				this.lines.push(line);
				this._onDidStateChange.fire(ProblemCollectorEvent.create(ProblemCollectorEventKind.BackgroundProcessingBegins));
				this.cleanMarkerCaches();
				this.resetCurrentResource();
				let owner = background.matcher.owner;
				let file = matches[background.begin.file!];
				if (file) {
					let resource = getResource(file, background.matcher);
					this.recordResourceToClean(owner, await resource);
				} else {
					this.recordResourcesToClean(owner);
				}
			}
		}
		return result;
	}

	private tryFinish(line: string): boolean {
		let result = false;
		for (const background of this.backgroundPatterns) {
			let matches = background.end.regexp.exec(line);
			if (matches) {
				if (this._activeBackgroundMatchers.has(background.key)) {
					this._activeBackgroundMatchers.delete(background.key);
					this.resetCurrentResource();
					this._onDidStateChange.fire(ProblemCollectorEvent.create(ProblemCollectorEventKind.BackgroundProcessingEnds));
					result = true;
					this.lines.push(line);
					let owner = background.matcher.owner;
					this.cleanMarkers(owner);
					this.cleanMarkerCaches();
				}
			}
		}
		return result;
	}

	private resetCurrentResource(): void {
		this.reportMarkersForCurrentResource();
		this.currentOwner = undefined;
		this.currentResource = undefined;
	}

	private reportMarkersForCurrentResource(): void {
		if (this.currentOwner && this.currentResource) {
			this.deliverMarkersPerOwnerAndResource(this.currentOwner, this.currentResource);
		}
	}

	public override done(): void {
		[...this.applyToByOwner.keys()].forEach(owner => {
			this.recordResourcesToClean(owner);
		});
		super.done();
	}

	public isWatching(): boolean {
		return this.backgroundPatterns.length > 0;
	}
}
