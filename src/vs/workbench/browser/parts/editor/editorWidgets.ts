/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Widget } from 'vs/base/browser/ui/widget';
import { IOverlayWidget, ICodeEditor, IOverlayWidgetPosition, OverlayWidgetPositionPreference } from 'vs/editor/browser/editorBrowser';
import { Emitter } from 'vs/base/common/event';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { $, append, clearNode } from 'vs/base/browser/dom';
import { attachStylerCallback } from 'vs/platform/theme/common/styler';
import { buttonBackground, buttonForeground, editorBackground, editorForeground, contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { hasWorkspaceFileExtension } from 'vs/platform/workspaces/common/workspaces';
import { Disposable, dispose } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { isEqual } from 'vs/base/common/resources';
import { IFileService } from 'vs/platform/files/common/files';

export class FloatingClickWidget extends Widget implements IOverlayWidget {

	private readonly _onClick = this._register(new Emitter<void>());
	readonly onClick = this._onClick.event;

	private _domNode: HTMLElement;

	constructor(
		private editor: ICodeEditor,
		private label: string,
		keyBindingAction: string | null,
		@IKeybindingService keybindingService: IKeybindingService,
		@IThemeService private readonly themeService: IThemeService
	) {
		super();

		this._domNode = $('.floating-click-widget');

		if (keyBindingAction) {
			const keybinding = keybindingService.lookupKeybinding(keyBindingAction);
			if (keybinding) {
				this.label += ` (${keybinding.getLabel()})`;
			}
		}
	}

	getId(): string {
		return 'editor.overlayWidget.floatingClickWidget';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition {
		return {
			preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER
		};
	}

	render() {
		clearNode(this._domNode);

		this._register(attachStylerCallback(this.themeService, { buttonBackground, buttonForeground, editorBackground, editorForeground, contrastBorder }, colors => {
			const backgroundColor = colors.buttonBackground ? colors.buttonBackground : colors.editorBackground;
			if (backgroundColor) {
				this._domNode.style.backgroundColor = backgroundColor.toString();
			}

			const foregroundColor = colors.buttonForeground ? colors.buttonForeground : colors.editorForeground;
			if (foregroundColor) {
				this._domNode.style.color = foregroundColor.toString();
			}

			const borderColor = colors.contrastBorder ? colors.contrastBorder.toString() : '';
			this._domNode.style.borderWidth = borderColor ? '1px' : '';
			this._domNode.style.borderStyle = borderColor ? 'solid' : '';
			this._domNode.style.borderColor = borderColor;
		}));

		append(this._domNode, $('')).textContent = this.label;

		this.onclick(this._domNode, e => this._onClick.fire());

		this.editor.addOverlayWidget(this);
	}

	dispose(): void {
		this.editor.removeOverlayWidget(this);

		super.dispose();
	}
}

export class OpenWorkspaceButtonContribution extends Disposable implements IEditorContribution {

	static get(editor: ICodeEditor): OpenWorkspaceButtonContribution {
		return editor.getContribution<OpenWorkspaceButtonContribution>(OpenWorkspaceButtonContribution.ID);
	}

	public static readonly ID = 'editor.contrib.openWorkspaceButton';

	private openWorkspaceButton: FloatingClickWidget | undefined;

	constructor(
		private editor: ICodeEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IHostService private readonly hostService: IHostService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService
	) {
		super();

		this.update();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.editor.onDidChangeModel(e => this.update()));
	}

	private update(): void {
		if (!this.shouldShowButton(this.editor)) {
			this.disposeOpenWorkspaceWidgetRenderer();
			return;
		}

		this.createOpenWorkspaceWidgetRenderer();
	}

	private shouldShowButton(editor: ICodeEditor): boolean {
		const model = editor.getModel();
		if (!model) {
			return false; // we need a model
		}

		if (!hasWorkspaceFileExtension(model.uri)) {
			return false; // we need a workspace file
		}

		if (!this.fileService.canHandleResource(model.uri)) {
			return false; // needs to be backed by a file service
		}

		if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			const workspaceConfiguration = this.contextService.getWorkspace().configuration;
			if (workspaceConfiguration && isEqual(workspaceConfiguration, model.uri)) {
				return false; // already inside workspace
			}
		}

		return true;
	}

	private createOpenWorkspaceWidgetRenderer(): void {
		if (!this.openWorkspaceButton) {
			this.openWorkspaceButton = this.instantiationService.createInstance(FloatingClickWidget, this.editor, localize('openWorkspace', "Open Workspace"), null);
			this._register(this.openWorkspaceButton.onClick(() => {
				const model = this.editor.getModel();
				if (model) {
					this.hostService.openWindow([{ workspaceUri: model.uri }]);
				}
			}));

			this.openWorkspaceButton.render();
		}
	}

	private disposeOpenWorkspaceWidgetRenderer(): void {
		dispose(this.openWorkspaceButton);
		this.openWorkspaceButton = undefined;
	}

	dispose(): void {
		this.disposeOpenWorkspaceWidgetRenderer();

		super.dispose();
	}
}
