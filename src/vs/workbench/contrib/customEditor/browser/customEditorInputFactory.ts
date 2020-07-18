/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Lazy } from 'vs/base/common/lazy';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorInput } from 'vs/workbench/common/editor';
import { CustomEditorInput } from 'vs/workbench/contrib/customEditor/browser/customEditorInput';
import { IWebviewService, WebviewExtensionDescription, WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';
import { reviveWebviewExtensionDescription, SerializedWebview, WebviewEditorInputFactory, DeserializedWebview } from 'vs/workbench/contrib/webview/browser/webviewEditorInputFactory';
import { IWebviewWorkbenchService, WebviewInputOptions } from 'vs/workbench/contrib/webview/browser/webviewWorkbenchService';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';

export interface CustomDocumentBackupData {
	readonly viewType: string;
	readonly editorResource: UriComponents;
	backupId: string;

	readonly extension: undefined | {
		readonly location: UriComponents;
		readonly id: string;
	};

	readonly webview: {
		readonly id: string;
		readonly options: WebviewInputOptions;
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


export class CustomEditorInputFactory extends WebviewEditorInputFactory {

	public static readonly ID = CustomEditorInput.typeId;

	public constructor(
		@IWebviewWorkbenchService webviewWorkbenchService: IWebviewWorkbenchService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IWebviewService private readonly _webviewService: IWebviewService,
	) {
		super(webviewWorkbenchService);
	}

	public serialize(input: CustomEditorInput): string | undefined {
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

	protected fromJson(data: SerializedCustomEditor): DeserializedCustomEditor {
		return {
			...super.fromJson(data),
			editorResource: URI.from(data.editorResource),
			dirty: data.dirty,
		};
	}

	public deserialize(
		_instantiationService: IInstantiationService,
		serializedEditorInput: string
	): CustomEditorInput {
		const data = this.fromJson(JSON.parse(serializedEditorInput));
		const webview = CustomEditorInputFactory.reviveWebview(data, this._webviewService);
		const customInput = this._instantiationService.createInstance(CustomEditorInput, data.editorResource, data.viewType, data.id, webview, { startsDirty: data.dirty, backupId: data.backupId });
		if (typeof data.group === 'number') {
			customInput.updateGroup(data.group);
		}
		return customInput;
	}

	private static reviveWebview(data: { id: string, state: any, options: WebviewInputOptions, extension?: WebviewExtensionDescription, }, webviewService: IWebviewService) {
		return new Lazy(() => {
			const webview = webviewService.createWebviewOverlay(data.id, {
				purpose: WebviewContentPurpose.CustomEditor,
				enableFindWidget: data.options.enableFindWidget,
				retainContextWhenHidden: data.options.retainContextWhenHidden
			}, data.options, data.extension);
			webview.state = data.state;
			return webview;
		});
	}

	public static createCustomEditorInput(resource: URI, instantiationService: IInstantiationService): Promise<IEditorInput> {
		return instantiationService.invokeFunction(async accessor => {
			const webviewService = accessor.get<IWebviewService>(IWebviewService);
			const backupFileService = accessor.get<IBackupFileService>(IBackupFileService);

			const backup = await backupFileService.resolve<CustomDocumentBackupData>(resource);
			if (!backup?.meta) {
				throw new Error(`No backup found for custom editor: ${resource}`);
			}

			const backupData = backup.meta;
			const id = backupData.webview.id;
			const extension = reviveWebviewExtensionDescription(backupData.extension?.id, backupData.extension?.location);
			const webview = CustomEditorInputFactory.reviveWebview({ id, options: backupData.webview.options, state: backupData.webview.state, extension, }, webviewService);

			const editor = instantiationService.createInstance(CustomEditorInput, URI.revive(backupData.editorResource), backupData.viewType, id, webview, { backupId: backupData.backupId });
			editor.updateGroup(0);
			return editor;
		});
	}

	public static canResolveBackup(editorInput: IEditorInput, backupResource: URI): boolean {
		if (editorInput instanceof CustomEditorInput) {
			if (editorInput.resource.path === backupResource.path && backupResource.authority === editorInput.viewType) {
				return true;
			}
		}

		return false;
	}
}
