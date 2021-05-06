/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ICustomEditorInputFactory, IEditorInput } from 'vs/workbench/common/editor';
import { CustomEditorInput } from 'vs/workbench/contrib/customEditor/browser/customEditorInput';
import { IWebviewService, WebviewContentOptions, WebviewContentPurpose, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { SerializedWebviewOptions, DeserializedWebview, reviveWebviewExtensionDescription, SerializedWebview, WebviewEditorInputSerializer, restoreWebviewContentOptions, restoreWebviewOptions } from 'vs/workbench/contrib/webviewPanel/browser/webviewEditorInputSerializer';
import { IWebviewWorkbenchService } from 'vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IWorkingCopyBackupMeta, NO_TYPE_ID } from 'vs/workbench/services/workingCopy/common/workingCopy';

export interface CustomDocumentBackupData extends IWorkingCopyBackupMeta {
	readonly viewType: string;
	readonly editorResource: UriComponents;
	backupId: string;

	readonly extension: undefined | {
		readonly location: UriComponents;
		readonly id: string;
	};

	readonly webview: {
		readonly id: string;
		readonly options: SerializedWebviewOptions;
		readonly state: any;
	};
}

interface SerializedCustomEditor extends SerializedWebview {
	readonly editorResource: UriComponents;
	readonly dirty: boolean;
	readonly backupId?: string;
}


interface DeserializedCustomEditor extends DeserializedWebview {
	readonly editorResource: URI;
	readonly dirty: boolean;
	readonly backupId?: string;
}


export class CustomEditorInputSerializer extends WebviewEditorInputSerializer {

	public static override readonly ID = CustomEditorInput.typeId;

	public constructor(
		@IWebviewWorkbenchService webviewWorkbenchService: IWebviewWorkbenchService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IWebviewService private readonly _webviewService: IWebviewService,
	) {
		super(webviewWorkbenchService);
	}

	public override serialize(input: CustomEditorInput): string | undefined {
		const dirty = input.isDirty();
		const data: SerializedCustomEditor = {
			...this.toJson(input),
			editorResource: input.resource.toJSON(),
			dirty,
			backupId: dirty ? input.backupId : undefined,
		};

		try {
			return JSON.stringify(data);
		} catch {
			return undefined;
		}
	}

	protected override fromJson(data: SerializedCustomEditor): DeserializedCustomEditor {
		return {
			...super.fromJson(data),
			editorResource: URI.from(data.editorResource),
			dirty: data.dirty,
		};
	}

	public override deserialize(
		_instantiationService: IInstantiationService,
		serializedEditorInput: string
	): CustomEditorInput {
		const data = this.fromJson(JSON.parse(serializedEditorInput));
		const webview = reviveWebview(this._webviewService, data);
		const customInput = this._instantiationService.createInstance(CustomEditorInput, data.editorResource, data.viewType, data.id, webview, { startsDirty: data.dirty, backupId: data.backupId });
		if (typeof data.group === 'number') {
			customInput.updateGroup(data.group);
		}
		return customInput;
	}
}

function reviveWebview(webviewService: IWebviewService, data: { id: string, state: any, webviewOptions: WebviewOptions, contentOptions: WebviewContentOptions, extension?: WebviewExtensionDescription, }) {
	const webview = webviewService.createWebviewOverlay(data.id, {
		purpose: WebviewContentPurpose.CustomEditor,
		enableFindWidget: data.webviewOptions.enableFindWidget,
		retainContextWhenHidden: data.webviewOptions.retainContextWhenHidden
	}, data.contentOptions, data.extension);
	webview.state = data.state;
	return webview;
}

export const customEditorInputFactory = new class implements ICustomEditorInputFactory {
	public createCustomEditorInput(resource: URI, instantiationService: IInstantiationService): Promise<IEditorInput> {
		return instantiationService.invokeFunction(async accessor => {
			const webviewService = accessor.get<IWebviewService>(IWebviewService);
			const workingCopyBackupService = accessor.get<IWorkingCopyBackupService>(IWorkingCopyBackupService);

			const backup = await workingCopyBackupService.resolve<CustomDocumentBackupData>({ resource, typeId: NO_TYPE_ID });
			if (!backup?.meta) {
				throw new Error(`No backup found for custom editor: ${resource}`);
			}

			const backupData = backup.meta;
			const id = backupData.webview.id;
			const extension = reviveWebviewExtensionDescription(backupData.extension?.id, backupData.extension?.location);
			const webview = reviveWebview(webviewService, {
				id,
				webviewOptions: restoreWebviewOptions(backupData.webview.options),
				contentOptions: restoreWebviewContentOptions(backupData.webview.options),
				state: backupData.webview.state,
				extension,
			});

			const editor = instantiationService.createInstance(CustomEditorInput, URI.revive(backupData.editorResource), backupData.viewType, id, webview, { backupId: backupData.backupId });
			editor.updateGroup(0);
			return editor;
		});
	}

	public canResolveBackup(editorInput: IEditorInput, backupResource: URI): boolean {
		if (editorInput instanceof CustomEditorInput) {
			if (editorInput.resource.path === backupResource.path && backupResource.authority === editorInput.viewType) {
				return true;
			}
		}

		return false;
	}
};
