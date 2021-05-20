/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { Command } from '../commandManager';
import { MarkdownPreviewManager, DynamicPreviewSettings } from '../features/previewManager';
import { TelemetryReporter } from '../telemetryReporter';

interface ShowPreviewSettings {
	readonly sideBySide?: boolean;
	readonly locked?: boolean;
	readonly static?: boolean;
}

async function showPreview(
	webviewManager: MarkdownPreviewManager,
	telemetryReporter: TelemetryReporter | undefined,
	uri: vscode.Uri | undefined,
	previewSettings: ShowPreviewSettings,
): Promise<any> {
	let resource = uri;
	if (!(resource instanceof vscode.Uri)) {
		if (vscode.window.activeTextEditor) {
			// we are relaxed and don't check for markdown files
			resource = vscode.window.activeTextEditor.document.uri;
		}
	}

	if (!(resource instanceof vscode.Uri)) {
		if (!vscode.window.activeTextEditor && !previewSettings.static) {
			// this is most likely toggling the preview
			return vscode.commands.executeCommand('markdown.showSource');
		}
		// nothing found that could be shown or toggled
		return;
	}

	if (previewSettings.static) {
		webviewManager.openStaticPreview(resource);
		return;
	}
	const resourceColumn = (vscode.window.activeTextEditor && vscode.window.activeTextEditor.viewColumn) || vscode.ViewColumn.One;
	webviewManager.openDynamicPreview(resource, {
		resourceColumn: resourceColumn,
		previewColumn: previewSettings.sideBySide ? resourceColumn + 1 : resourceColumn,
		locked: !!previewSettings.locked
	});
	if (telemetryReporter) {
		telemetryReporter.sendTelemetryEvent('openPreview', {
			where: previewSettings.sideBySide ? 'sideBySide' : 'inPlace',
			how: (uri instanceof vscode.Uri) ? 'action' : 'pallete'
		});
	}
}

export class ShowPreviewCommand implements Command {
	public readonly id = 'markdown.showPreview';

	public constructor(
		private readonly webviewManager: MarkdownPreviewManager,
		private readonly telemetryReporter: TelemetryReporter
	) { }

	public execute(mainUri?: vscode.Uri, allUris?: vscode.Uri[], previewSettings?: DynamicPreviewSettings) {
		for (const uri of Array.isArray(allUris) ? allUris : [mainUri]) {
			showPreview(this.webviewManager, this.telemetryReporter, uri, {
				sideBySide: false,
				locked: previewSettings && previewSettings.locked
			});
		}
	}
}

export class ShowPreviewToSideCommand implements Command {
	public readonly id = 'markdown.showPreviewToSide';

	public constructor(
		private readonly webviewManager: MarkdownPreviewManager,
		private readonly telemetryReporter: TelemetryReporter
	) { }

	public execute(uri?: vscode.Uri, previewSettings?: DynamicPreviewSettings) {
		showPreview(this.webviewManager, this.telemetryReporter, uri, {
			sideBySide: true,
			locked: previewSettings && previewSettings.locked
		});
	}
}


export class ShowLockedPreviewToSideCommand implements Command {
	public readonly id = 'markdown.showLockedPreviewToSide';

	public constructor(
		private readonly webviewManager: MarkdownPreviewManager,
		private readonly telemetryReporter: TelemetryReporter
	) { }

	public execute(uri?: vscode.Uri) {
		showPreview(this.webviewManager, this.telemetryReporter, uri, {
			sideBySide: true,
			locked: true
		});
	}
}

export class ShowStaticPreviewCommand implements Command {
	public readonly id = 'markdown.showStaticPreview';

	public constructor(
		private readonly webviewManager: MarkdownPreviewManager,
	) { }

	public execute(uri?: vscode.Uri) {
		showPreview(this.webviewManager, undefined, uri, {
			static: true
		});
	}
}

export class ShowTextEditorCommand implements Command {
	public readonly id = 'markdown.showTextEditor';

	public constructor(
		private readonly webviewManager: MarkdownPreviewManager,
	) { }

	public execute() {
		this.webviewManager.openTextEditor();
	}
}

export class ToggleStaticPreviewCommand implements Command {
	public readonly id = 'markdown.toggleStaticPreview';

	public constructor(
		private readonly webviewManager: MarkdownPreviewManager,
	) { }

	public execute(uri?: vscode.Uri) {
		this.webviewManager.toggleStaticPreview(uri);
	}
}
