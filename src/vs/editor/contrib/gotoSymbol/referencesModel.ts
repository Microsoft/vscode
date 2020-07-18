/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { basename, extUri } from 'vs/base/common/resources';
import { IDisposable, dispose, IReference, DisposableStore } from 'vs/base/common/lifecycle';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { defaultGenerator } from 'vs/base/common/idGenerator';
import { Range, IRange } from 'vs/editor/common/core/range';
import { Location, LocationLink } from 'vs/editor/common/modes';
import { ITextModelService, ITextEditorModel } from 'vs/editor/common/services/resolverService';
import { Position } from 'vs/editor/common/core/position';
import { IMatch } from 'vs/base/common/filters';
import { Constants } from 'vs/base/common/uint';
import { ResourceMap } from 'vs/base/common/map';
import { onUnexpectedError } from 'vs/base/common/errors';

export class OneReference {

	readonly id: string = defaultGenerator.nextId();

	constructor(
		readonly isProviderFirst: boolean,
		readonly parent: FileReferences,
		readonly uri: URI,
		private _range: IRange,
		private _rangeCallback: (ref: OneReference) => void
	) { }

	get range(): IRange {
		return this._range;
	}

	set range(value: IRange) {
		this._range = value;
		this._rangeCallback(this);
	}

	get ariaMessage(): string {
		return localize(
			'aria.oneReference', "symbol in {0} on line {1} at column {2}",
			basename(this.uri), this.range.startLineNumber, this.range.startColumn
		);
	}
}

export class FilePreview implements IDisposable {

	constructor(
		private readonly _modelReference: IReference<ITextEditorModel>
	) { }

	dispose(): void {
		this._modelReference.dispose();
	}

	preview(range: IRange, n: number = 8): { value: string; highlight: IMatch } | undefined {
		const model = this._modelReference.object.textEditorModel;

		if (!model) {
			return undefined;
		}

		const { startLineNumber, startColumn, endLineNumber, endColumn } = range;
		const word = model.getWordUntilPosition({ lineNumber: startLineNumber, column: startColumn - n });
		const beforeRange = new Range(startLineNumber, word.startColumn, startLineNumber, startColumn);
		const afterRange = new Range(endLineNumber, endColumn, endLineNumber, Constants.MAX_SAFE_SMALL_INTEGER);

		const before = model.getValueInRange(beforeRange).replace(/^\s+/, '');
		const inside = model.getValueInRange(range);
		const after = model.getValueInRange(afterRange).replace(/\s+$/, '');

		return {
			value: before + inside + after,
			highlight: { start: before.length, end: before.length + inside.length }
		};
	}
}

export class FileReferences implements IDisposable {

	readonly children: OneReference[] = [];

	private _previews = new ResourceMap<FilePreview>();

	constructor(
		readonly parent: ReferencesModel,
		readonly uri: URI
	) { }

	dispose(): void {
		dispose(this._previews.values());
		this._previews.clear();
	}

	getPreview(child: OneReference): FilePreview | undefined {
		return this._previews.get(child.uri);
	}

	get ariaMessage(): string {
		const len = this.children.length;
		if (len === 1) {
			return localize('aria.fileReferences.1', "1 symbol in {0}, full path {1}", basename(this.uri), this.uri.fsPath);
		} else {
			return localize('aria.fileReferences.N', "{0} symbols in {1}, full path {2}", len, basename(this.uri), this.uri.fsPath);
		}
	}

	async resolve(textModelResolverService: ITextModelService): Promise<FileReferences> {
		if (this._previews.size !== 0) {
			return this;
		}
		for (let child of this.children) {
			if (this._previews.has(child.uri)) {
				continue;
			}
			try {
				const ref = await textModelResolverService.createModelReference(child.uri);
				this._previews.set(child.uri, new FilePreview(ref));
			} catch (err) {
				onUnexpectedError(err);
			}
		}
		return this;
	}
}

export class ReferencesModel implements IDisposable {

	private readonly _disposables = new DisposableStore();
	private readonly _links: LocationLink[];
	private readonly _title: string;

	readonly groups: FileReferences[] = [];
	readonly references: OneReference[] = [];

	readonly _onDidChangeReferenceRange = new Emitter<OneReference>();
	readonly onDidChangeReferenceRange: Event<OneReference> = this._onDidChangeReferenceRange.event;

	constructor(links: LocationLink[], title: string) {
		this._links = links;
		this._title = title;

		// grouping and sorting
		const [providersFirst] = links;
		links.sort(ReferencesModel._compareReferences);

		let current: FileReferences | undefined;
		for (let link of links) {
			if (!current || !extUri.isEqual(current.uri, link.uri, true)) {
				// new group
				current = new FileReferences(this, link.uri);
				this.groups.push(current);
			}

			// append, check for equality first!
			if (current.children.length === 0 || ReferencesModel._compareReferences(link, current.children[current.children.length - 1]) !== 0) {

				const oneRef = new OneReference(
					providersFirst === link,
					current,
					link.uri,
					link.targetSelectionRange || link.range,
					ref => this._onDidChangeReferenceRange.fire(ref)
				);
				this.references.push(oneRef);
				current.children.push(oneRef);
			}
		}
	}

	dispose(): void {
		dispose(this.groups);
		this._disposables.dispose();
		this._onDidChangeReferenceRange.dispose();
		this.groups.length = 0;
	}

	clone(): ReferencesModel {
		return new ReferencesModel(this._links, this._title);
	}

	get title(): string {
		return this._title;
	}

	get isEmpty(): boolean {
		return this.groups.length === 0;
	}

	get ariaMessage(): string {
		if (this.isEmpty) {
			return localize('aria.result.0', "No results found");
		} else if (this.references.length === 1) {
			return localize('aria.result.1', "Found 1 symbol in {0}", this.references[0].uri.fsPath);
		} else if (this.groups.length === 1) {
			return localize('aria.result.n1', "Found {0} symbols in {1}", this.references.length, this.groups[0].uri.fsPath);
		} else {
			return localize('aria.result.nm', "Found {0} symbols in {1} files", this.references.length, this.groups.length);
		}
	}

	nextOrPreviousReference(reference: OneReference, next: boolean): OneReference {

		let { parent } = reference;

		let idx = parent.children.indexOf(reference);
		let childCount = parent.children.length;
		let groupCount = parent.parent.groups.length;

		if (groupCount === 1 || next && idx + 1 < childCount || !next && idx > 0) {
			// cycling within one file
			if (next) {
				idx = (idx + 1) % childCount;
			} else {
				idx = (idx + childCount - 1) % childCount;
			}
			return parent.children[idx];
		}

		idx = parent.parent.groups.indexOf(parent);
		if (next) {
			idx = (idx + 1) % groupCount;
			return parent.parent.groups[idx].children[0];
		} else {
			idx = (idx + groupCount - 1) % groupCount;
			return parent.parent.groups[idx].children[parent.parent.groups[idx].children.length - 1];
		}
	}

	nearestReference(resource: URI, position: Position): OneReference | undefined {

		const nearest = this.references.map((ref, idx) => {
			return {
				idx,
				prefixLen: strings.commonPrefixLength(ref.uri.toString(), resource.toString()),
				offsetDist: Math.abs(ref.range.startLineNumber - position.lineNumber) * 100 + Math.abs(ref.range.startColumn - position.column)
			};
		}).sort((a, b) => {
			if (a.prefixLen > b.prefixLen) {
				return -1;
			} else if (a.prefixLen < b.prefixLen) {
				return 1;
			} else if (a.offsetDist < b.offsetDist) {
				return -1;
			} else if (a.offsetDist > b.offsetDist) {
				return 1;
			} else {
				return 0;
			}
		})[0];

		if (nearest) {
			return this.references[nearest.idx];
		}
		return undefined;
	}

	referenceAt(resource: URI, position: Position): OneReference | undefined {
		for (const ref of this.references) {
			if (ref.uri.toString() === resource.toString()) {
				if (Range.containsPosition(ref.range, position)) {
					return ref;
				}
			}
		}
		return undefined;
	}

	firstReference(): OneReference | undefined {
		for (const ref of this.references) {
			if (ref.isProviderFirst) {
				return ref;
			}
		}
		return this.references[0];
	}

	private static _compareReferences(a: Location, b: Location): number {
		return extUri.compare(a.uri, b.uri) || Range.compareRangesUsingStarts(a.range, b.range);
	}
}
