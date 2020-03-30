/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CellOutputKind } from 'vs/workbench/services/notebook/common/notebookCommon';
import { BrandedService, IConstructorSignature1 } from 'vs/platform/instantiation/common/instantiation';
import { INotebookEditor, IOutputTransformContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export type IOutputTransformCtor = IConstructorSignature1<INotebookEditor, IOutputTransformContribution>;

export interface IOutputTransformDescription {
	id: string;
	kind: CellOutputKind;
	ctor: IOutputTransformCtor;
}

export namespace NotebookRegistry {
	export function getOutputTransformContributions(): IOutputTransformDescription[] {
		return NotebookRegistryImpl.INSTANCE.getNotebookOutputTransform();
	}
}

export function registerOutputTransform<Services extends BrandedService[]>(id: string, kind: CellOutputKind, ctor: { new(editor: INotebookEditor, ...services: Services): IOutputTransformContribution }): void {
	NotebookRegistryImpl.INSTANCE.registerOutputTransform(id, kind, ctor);
}

class NotebookRegistryImpl {

	static readonly INSTANCE = new NotebookRegistryImpl();

	private readonly outputTransforms: IOutputTransformDescription[];

	constructor() {
		this.outputTransforms = [];
	}

	registerOutputTransform<Services extends BrandedService[]>(id: string, kind: CellOutputKind, ctor: { new(editor: INotebookEditor, ...services: Services): IOutputTransformContribution }): void {
		this.outputTransforms.push({ id: id, kind: kind, ctor: ctor as IOutputTransformCtor });
	}

	getNotebookOutputTransform(): IOutputTransformDescription[] {
		return this.outputTransforms.slice(0);
	}
}
