/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/workbench/contrib/welcome/walkThrough/browser/editor/vs_code_editor_walkthrough';
import { localize } from 'vs/nls';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Action } from 'vs/base/common/actions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WalkThroughInput, WalkThroughInputOptions } from 'vs/workbench/contrib/welcome/walkThrough/browser/walkThroughInput';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { IEditorInputSerializer, EditorInput } from 'vs/workbench/common/editor';
import { EditorOverride } from 'vs/platform/editor/common/editor';

const typeId = 'workbench.editors.walkThroughInput';
const inputOptions: WalkThroughInputOptions = {
	typeId,
	name: localize('editorWalkThrough.title', "Interactive Playground"),
	resource: FileAccess.asBrowserUri('./vs_code_editor_walkthrough.md', require)
		.with({
			scheme: Schemas.walkThrough,
			query: JSON.stringify({ moduleId: 'vs/workbench/contrib/welcome/walkThrough/browser/editor/vs_code_editor_walkthrough' })
		}),
	telemetryFrom: 'walkThrough'
};

export class EditorWalkThroughAction extends Action {

	public static readonly ID = 'workbench.action.showInteractivePlayground';
	public static readonly LABEL = localize('editorWalkThrough', "Interactive Playground");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(id, label);
	}

	public override run(): Promise<void> {
		const input = this.instantiationService.createInstance(WalkThroughInput, inputOptions);
		return this.editorService.openEditor(input, { pinned: true, override: EditorOverride.DISABLED })
			.then(() => void (0));
	}
}

export class EditorWalkThroughInputSerializer implements IEditorInputSerializer {

	static readonly ID = typeId;

	public canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	public serialize(editorInput: EditorInput): string {
		return '{}';
	}

	public deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): WalkThroughInput {
		return instantiationService.createInstance(WalkThroughInput, inputOptions);
	}
}
