/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkerService, IMarker, MarkerSeverity, MarkerTag } from 'vs/platform/markers/common/markers';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IModelDeltaDecoration, ITextModel, IModelDecorationOptions, TrackedRangeStickiness, OverviewRulerLane, IModelDecoration, MinimapPosition, IModelDecorationMinimapOptions } from 'vs/editor/common/model';
import { ClassName } from 'vs/editor/common/model/intervalTree';
import { themeColorFromId, ThemeColor } from 'vs/platform/theme/common/themeService';
import { overviewRulerWarning, overviewRulerInfo, overviewRulerError } from 'vs/editor/common/view/editorColorRegistry';
import { IModelService } from 'vs/editor/common/services/modelService';
import { Range } from 'vs/editor/common/core/range';
import { IMarkerDecorationsService } from 'vs/editor/common/services/markersDecorationService';
import { Schemas } from 'vs/base/common/network';
import { Emitter, Event } from 'vs/base/common/event';
import { minimapWarning, minimapError } from 'vs/platform/theme/common/colorRegistry';

function MODEL_ID(resource: URI): string {
	return resource.toString();
}

class MarkerDecorations extends Disposable {

	private readonly _markersData: Map<string, IMarker> = new Map<string, IMarker>();

	constructor(
		readonly model: ITextModel
	) {
		super();
		this._register(toDisposable(() => {
			this.model.deltaDecorations([...this._markersData.keys()], []);
			this._markersData.clear();
		}));
	}

	public update(markers: IMarker[], newDecorations: IModelDeltaDecoration[]): boolean {
		const oldIds = [...this._markersData.keys()];
		this._markersData.clear();
		const ids = this.model.deltaDecorations(oldIds, newDecorations);
		for (let index = 0; index < ids.length; index++) {
			this._markersData.set(ids[index], markers[index]);
		}
		return oldIds.length !== 0 || ids.length !== 0;
	}

	getMarker(decoration: IModelDecoration): IMarker | undefined {
		return this._markersData.get(decoration.id);
	}

	getMarkers(): [Range, IMarker][] {
		const res: [Range, IMarker][] = [];
		this._markersData.forEach((marker, id) => {
			let range = this.model.getDecorationRange(id);
			if (range) {
				res.push([range, marker]);
			}
		});
		return res;
	}
}

export class MarkerDecorationsService extends Disposable implements IMarkerDecorationsService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeMarker = this._register(new Emitter<ITextModel>());
	readonly onDidChangeMarker: Event<ITextModel> = this._onDidChangeMarker.event;

	private readonly _markerDecorations = new Map<string, MarkerDecorations>();

	constructor(
		@IModelService modelService: IModelService,
		@IMarkerService private readonly _markerService: IMarkerService
	) {
		super();
		modelService.getModels().forEach(model => this._onModelAdded(model));
		this._register(modelService.onModelAdded(this._onModelAdded, this));
		this._register(modelService.onModelRemoved(this._onModelRemoved, this));
		this._register(this._markerService.onMarkerChanged(this._handleMarkerChange, this));
	}

	override dispose() {
		super.dispose();
		this._markerDecorations.forEach(value => value.dispose());
		this._markerDecorations.clear();
	}

	getMarker(uri: URI, decoration: IModelDecoration): IMarker | null {
		const markerDecorations = this._markerDecorations.get(MODEL_ID(uri));
		return markerDecorations ? (markerDecorations.getMarker(decoration) || null) : null;
	}

	getLiveMarkers(uri: URI): [Range, IMarker][] {
		const markerDecorations = this._markerDecorations.get(MODEL_ID(uri));
		return markerDecorations ? markerDecorations.getMarkers() : [];
	}

	private _handleMarkerChange(changedResources: readonly URI[]): void {
		changedResources.forEach((resource) => {
			const markerDecorations = this._markerDecorations.get(MODEL_ID(resource));
			if (markerDecorations) {
				this._updateDecorations(markerDecorations);
			}
		});
	}

	private _onModelAdded(model: ITextModel): void {
		const markerDecorations = new MarkerDecorations(model);
		this._markerDecorations.set(MODEL_ID(model.uri), markerDecorations);
		this._updateDecorations(markerDecorations);
	}

	private _onModelRemoved(model: ITextModel): void {
		const markerDecorations = this._markerDecorations.get(MODEL_ID(model.uri));
		if (markerDecorations) {
			markerDecorations.dispose();
			this._markerDecorations.delete(MODEL_ID(model.uri));
		}

		// clean up markers for internal, transient models
		if (model.uri.scheme === Schemas.inMemory
			|| model.uri.scheme === Schemas.internal
			|| model.uri.scheme === Schemas.vscode) {
			if (this._markerService) {
				this._markerService.read({ resource: model.uri }).map(marker => marker.owner).forEach(owner => this._markerService.remove(owner, [model.uri]));
			}
		}
	}

	private _updateDecorations(markerDecorations: MarkerDecorations): void {
		// Limit to the first 500 errors/warnings
		const markers = this._markerService.read({ resource: markerDecorations.model.uri, take: 500 });
		let newModelDecorations: IModelDeltaDecoration[] = markers.map((marker) => {
			return {
				range: this._createDecorationRange(markerDecorations.model, marker),
				options: this._createDecorationOption(marker)
			};
		});
		if (markerDecorations.update(markers, newModelDecorations)) {
			this._onDidChangeMarker.fire(markerDecorations.model);
		}
	}

	private _createDecorationRange(model: ITextModel, rawMarker: IMarker): Range {

		let ret = Range.lift(rawMarker);

		if (rawMarker.severity === MarkerSeverity.Hint && !this._hasMarkerTag(rawMarker, MarkerTag.Unnecessary) && !this._hasMarkerTag(rawMarker, MarkerTag.Deprecated)) {
			// * never render hints on multiple lines
			// * make enough space for three dots
			ret = ret.setEndPosition(ret.startLineNumber, ret.startColumn + 2);
		}

		ret = model.validateRange(ret);

		if (ret.isEmpty()) {
			let word = model.getWordAtPosition(ret.getStartPosition());
			if (word) {
				ret = new Range(ret.startLineNumber, word.startColumn, ret.endLineNumber, word.endColumn);
			} else {
				let maxColumn = model.getLineLastNonWhitespaceColumn(ret.startLineNumber) ||
					model.getLineMaxColumn(ret.startLineNumber);

				if (maxColumn === 1) {
					// empty line
					// console.warn('marker on empty line:', marker);
				} else if (ret.endColumn >= maxColumn) {
					// behind eol
					ret = new Range(ret.startLineNumber, maxColumn - 1, ret.endLineNumber, maxColumn);
				} else {
					// extend marker to width = 1
					ret = new Range(ret.startLineNumber, ret.startColumn, ret.endLineNumber, ret.endColumn + 1);
				}
			}
		} else if (rawMarker.endColumn === Number.MAX_VALUE && rawMarker.startColumn === 1 && ret.startLineNumber === ret.endLineNumber) {
			let minColumn = model.getLineFirstNonWhitespaceColumn(rawMarker.startLineNumber);
			if (minColumn < ret.endColumn) {
				ret = new Range(ret.startLineNumber, minColumn, ret.endLineNumber, ret.endColumn);
				rawMarker.startColumn = minColumn;
			}
		}
		return ret;
	}

	private _createDecorationOption(marker: IMarker): IModelDecorationOptions {

		let className: string | undefined;
		let color: ThemeColor | undefined = undefined;
		let zIndex: number;
		let inlineClassName: string | undefined = undefined;
		let minimap: IModelDecorationMinimapOptions | undefined;

		switch (marker.severity) {
			case MarkerSeverity.Hint:
				if (this._hasMarkerTag(marker, MarkerTag.Deprecated)) {
					className = undefined;
				} else if (this._hasMarkerTag(marker, MarkerTag.Unnecessary)) {
					className = ClassName.EditorUnnecessaryDecoration;
				} else {
					className = ClassName.EditorHintDecoration;
				}
				zIndex = 0;
				break;
			case MarkerSeverity.Warning:
				className = ClassName.EditorWarningDecoration;
				color = themeColorFromId(overviewRulerWarning);
				zIndex = 20;
				minimap = {
					color: themeColorFromId(minimapWarning),
					position: MinimapPosition.Inline
				};
				break;
			case MarkerSeverity.Info:
				className = ClassName.EditorInfoDecoration;
				color = themeColorFromId(overviewRulerInfo);
				zIndex = 10;
				break;
			case MarkerSeverity.Error:
			default:
				className = ClassName.EditorErrorDecoration;
				color = themeColorFromId(overviewRulerError);
				zIndex = 30;
				minimap = {
					color: themeColorFromId(minimapError),
					position: MinimapPosition.Inline
				};
				break;
		}

		if (marker.tags) {
			if (marker.tags.indexOf(MarkerTag.Unnecessary) !== -1) {
				inlineClassName = ClassName.EditorUnnecessaryInlineDecoration;
			}
			if (marker.tags.indexOf(MarkerTag.Deprecated) !== -1) {
				inlineClassName = ClassName.EditorDeprecatedInlineDecoration;
			}
		}

		return {
			stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
			className,
			showIfCollapsed: true,
			overviewRuler: {
				color,
				position: OverviewRulerLane.Right
			},
			minimap,
			zIndex,
			inlineClassName,
		};
	}

	private _hasMarkerTag(marker: IMarker, tag: MarkerTag): boolean {
		if (marker.tags) {
			return marker.tags.indexOf(tag) >= 0;
		}
		return false;
	}
}
