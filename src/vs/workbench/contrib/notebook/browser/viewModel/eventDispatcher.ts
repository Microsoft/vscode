/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { NotebookDocumentMetadata } from 'vs/workbench/services/notebook/common/notebookCommon';
import { NotebookLayoutChangeEvent, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export enum NotebookViewEventType {
	LayoutChanged = 1,
	MetadataChanged = 2
}

export class NotebookLayoutChangedEvent {
	public readonly type = NotebookViewEventType.LayoutChanged;

	constructor(readonly source: NotebookLayoutChangeEvent, readonly value: NotebookLayoutInfo) {

	}
}


export class NotebookMetadataChangedEvent {
	public readonly type = NotebookViewEventType.MetadataChanged;

	constructor(readonly source: NotebookDocumentMetadata) {

	}
}


export type NotebookViewEvent = NotebookLayoutChangedEvent | NotebookMetadataChangedEvent;

export class NotebookEventDispatcher {
	protected readonly _onDidChangeLayout = new Emitter<NotebookLayoutChangedEvent>();
	readonly onDidChangeLayout = this._onDidChangeLayout.event;
	protected readonly _onDidChangeMetadata = new Emitter<NotebookMetadataChangedEvent>();
	readonly onDidChangeMetadata = this._onDidChangeMetadata.event;

	constructor() {
	}

	emit(events: NotebookViewEvent[]) {
		for (let i = 0, len = events.length; i < len; i++) {
			let e = events[i];

			switch (e.type) {
				case NotebookViewEventType.LayoutChanged:
					this._onDidChangeLayout.fire(e);
					break;
				case NotebookViewEventType.MetadataChanged:
					this._onDidChangeMetadata.fire(e);
					break;
			}
		}
	}
}
