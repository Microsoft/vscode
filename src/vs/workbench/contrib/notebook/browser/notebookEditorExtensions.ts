/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrandedService, IConstructorSignature1 } from 'vs/platform/instantiation/common/instantiation';
import { INotebookEditor, INotebookEditorContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export type INotebookEditorContributionCtor = IConstructorSignature1<INotebookEditor, INotebookEditorContribution>;


export interface INotebookEditorContributionDescription {
	id: string;
	ctor: INotebookEditorContributionCtor;
}

class EditorContributionRegistry {
	public static readonly INSTANCE = new EditorContributionRegistry();
	private readonly editorContributions: INotebookEditorContributionDescription[];

	constructor() {
		this.editorContributions = [];
	}

	public registerEditorContribution<Services extends BrandedService[]>(id: string, ctor: { new(editor: INotebookEditor, ...services: Services): INotebookEditorContribution }): void {
		this.editorContributions.push({ id, ctor: ctor as INotebookEditorContributionCtor });
	}

	public getEditorContributions(): INotebookEditorContributionDescription[] {
		return this.editorContributions.slice(0);
	}
}

export function registerNotebookContribution<Services extends BrandedService[]>(id: string, ctor: { new(editor: INotebookEditor, ...services: Services): INotebookEditorContribution }): void {
	EditorContributionRegistry.INSTANCE.registerEditorContribution(id, ctor);
}

export namespace NotebookEditorExtensionsRegistry {

	export function getEditorContributions(): INotebookEditorContributionDescription[] {
		return EditorContributionRegistry.INSTANCE.getEditorContributions();
	}
}
