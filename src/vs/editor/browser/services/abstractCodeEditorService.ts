/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditor, IDiffEditor } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IDecorationRenderOptions } from 'vs/editor/common/editorCommon';
import { IModelDecorationOptions, ITextModel } from 'vs/editor/common/model';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { URI } from 'vs/base/common/uri';

export abstract class AbstractCodeEditorService extends Disposable implements ICodeEditorService {

	declare readonly _serviceBrand: undefined;

	private readonly _onCodeEditorAdd: Emitter<ICodeEditor> = this._register(new Emitter<ICodeEditor>());
	public readonly onCodeEditorAdd: Event<ICodeEditor> = this._onCodeEditorAdd.event;

	private readonly _onCodeEditorRemove: Emitter<ICodeEditor> = this._register(new Emitter<ICodeEditor>());
	public readonly onCodeEditorRemove: Event<ICodeEditor> = this._onCodeEditorRemove.event;

	private readonly _onDiffEditorAdd: Emitter<IDiffEditor> = this._register(new Emitter<IDiffEditor>());
	public readonly onDiffEditorAdd: Event<IDiffEditor> = this._onDiffEditorAdd.event;

	private readonly _onDiffEditorRemove: Emitter<IDiffEditor> = this._register(new Emitter<IDiffEditor>());
	public readonly onDiffEditorRemove: Event<IDiffEditor> = this._onDiffEditorRemove.event;

	private readonly _onDidChangeTransientModelProperty: Emitter<ITextModel> = this._register(new Emitter<ITextModel>());
	public readonly onDidChangeTransientModelProperty: Event<ITextModel> = this._onDidChangeTransientModelProperty.event;


	private readonly _codeEditors: { [editorId: string]: ICodeEditor; };
	private readonly _diffEditors: { [editorId: string]: IDiffEditor; };

	constructor() {
		super();
		this._codeEditors = Object.create(null);
		this._diffEditors = Object.create(null);
	}

	addCodeEditor(editor: ICodeEditor): void {
		this._codeEditors[editor.getId()] = editor;
		this._onCodeEditorAdd.fire(editor);
	}

	removeCodeEditor(editor: ICodeEditor): void {
		if (delete this._codeEditors[editor.getId()]) {
			this._onCodeEditorRemove.fire(editor);
		}
	}

	listCodeEditors(): ICodeEditor[] {
		return Object.keys(this._codeEditors).map(id => this._codeEditors[id]);
	}

	addDiffEditor(editor: IDiffEditor): void {
		this._diffEditors[editor.getId()] = editor;
		this._onDiffEditorAdd.fire(editor);
	}

	removeDiffEditor(editor: IDiffEditor): void {
		if (delete this._diffEditors[editor.getId()]) {
			this._onDiffEditorRemove.fire(editor);
		}
	}

	listDiffEditors(): IDiffEditor[] {
		return Object.keys(this._diffEditors).map(id => this._diffEditors[id]);
	}

	getFocusedCodeEditor(): ICodeEditor | null {
		let editorWithWidgetFocus: ICodeEditor | null = null;

		const editors = this.listCodeEditors();
		for (const editor of editors) {

			if (editor.hasTextFocus()) {
				// bingo!
				return editor;
			}

			if (editor.hasWidgetFocus()) {
				editorWithWidgetFocus = editor;
			}
		}

		return editorWithWidgetFocus;
	}

	abstract registerDecorationType(key: string, options: IDecorationRenderOptions, parentTypeKey?: string, editor?: ICodeEditor): void;
	abstract removeDecorationType(key: string): void;
	abstract resolveDecorationOptions(decorationTypeKey: string | undefined, writable: boolean): IModelDecorationOptions;

	private readonly _transientWatchers: { [uri: string]: ModelTransientSettingWatcher; } = {};
	private readonly _modelProperties = new Map<string, Map<string, any>>();

	public setModelProperty(resource: URI, key: string, value: any): void {
		const key1 = resource.toString();
		let dest: Map<string, any>;
		if (this._modelProperties.has(key1)) {
			dest = this._modelProperties.get(key1)!;
		} else {
			dest = new Map<string, any>();
			this._modelProperties.set(key1, dest);
		}

		dest.set(key, value);
	}

	public getModelProperty(resource: URI, key: string): any {
		const key1 = resource.toString();
		if (this._modelProperties.has(key1)) {
			const innerMap = this._modelProperties.get(key1)!;
			return innerMap.get(key);
		}
		return undefined;
	}

	public setTransientModelProperty(model: ITextModel, key: string, value: any): void {
		const uri = model.uri.toString();

		let w: ModelTransientSettingWatcher;
		if (this._transientWatchers.hasOwnProperty(uri)) {
			w = this._transientWatchers[uri];
		} else {
			w = new ModelTransientSettingWatcher(uri, model, this);
			this._transientWatchers[uri] = w;
		}

		w.set(key, value);
		this._onDidChangeTransientModelProperty.fire(model);
	}

	public getTransientModelProperty(model: ITextModel, key: string): any {
		const uri = model.uri.toString();

		if (!this._transientWatchers.hasOwnProperty(uri)) {
			return undefined;
		}

		return this._transientWatchers[uri].get(key);
	}

	public getTransientModelProperties(model: ITextModel): [string, any][] | undefined {
		const uri = model.uri.toString();

		if (!this._transientWatchers.hasOwnProperty(uri)) {
			return undefined;
		}

		return this._transientWatchers[uri].keys().map(key => [key, this._transientWatchers[uri].get(key)]);
	}

	_removeWatcher(w: ModelTransientSettingWatcher): void {
		delete this._transientWatchers[w.uri];
	}

	abstract getActiveCodeEditor(): ICodeEditor | null;
	abstract openCodeEditor(input: IResourceEditorInput, source: ICodeEditor | null, sideBySide?: boolean): Promise<ICodeEditor | null>;
}

export class ModelTransientSettingWatcher {
	public readonly uri: string;
	private readonly _values: { [key: string]: any; };

	constructor(uri: string, model: ITextModel, owner: AbstractCodeEditorService) {
		this.uri = uri;
		this._values = {};
		model.onWillDispose(() => owner._removeWatcher(this));
	}

	public set(key: string, value: any): void {
		this._values[key] = value;
	}

	public get(key: string): any {
		return this._values[key];
	}

	public keys(): string[] {
		return Object.keys(this._values);
	}
}
