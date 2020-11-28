/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { LifecyclePhase, ILifecycleService, StartupKind } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { language } from 'vs/base/common/platform';
import { Disposable } from 'vs/base/common/lifecycle';
import ErrorTelemetry from 'vs/platform/telemetry/browser/errorTelemetry';
import { configurationTelemetry } from 'vs/platform/telemetry/common/telemetryUtils';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { ITextFileService, ITextFileSaveEvent, ITextFileLoadEvent } from 'vs/workbench/services/textfile/common/textfiles';
import { extname, basename, isEqual, isEqualOrParent } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { guessMimeTypes } from 'vs/base/common/mime';
import { hash } from 'vs/base/common/hash';

type TelemetryData = {
	mimeType: string;
	ext: string;
	path: number;
	reason?: number;
	allowlistedjson?: string;
};

type FileTelemetryDataFragment = {
	mimeType: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	ext: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	path: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	reason?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	allowlistedjson?: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

export class TelemetryContribution extends Disposable implements IWorkbenchContribution {

	private static ALLOWLIST_JSON = ['package.json', 'package-lock.json', 'tsconfig.json', 'jsconfig.json', 'bower.json', '.eslintrc.json', 'tslint.json', 'composer.json'];
	private static ALLOWLIST_WORKSPACE_JSON = ['settings.json', 'extensions.json', 'tasks.json', 'launch.json'];

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IActivityBarService activityBarService: IActivityBarService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IEditorService editorService: IEditorService,
		@IKeybindingService keybindingsService: IKeybindingService,
		@IWorkbenchThemeService themeService: IWorkbenchThemeService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IConfigurationService configurationService: IConfigurationService,
		@IViewletService viewletService: IViewletService,
		@ITextFileService textFileService: ITextFileService
	) {
		super();

		const { filesToOpenOrCreate, filesToDiff } = environmentService.configuration;
		const activeViewlet = viewletService.getActiveViewlet();

		type WindowSizeFragment = {
			innerHeight: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
			innerWidth: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
			outerHeight: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
			outerWidth: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
		};

		type WorkspaceLoadClassification = {
			userAgent: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			emptyWorkbench: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
			windowSize: WindowSizeFragment;
			'workbench.filesToOpenOrCreate': { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
			'workbench.filesToDiff': { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
			customKeybindingsCount: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
			theme: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			language: { classification: 'SystemMetaData', purpose: 'BusinessInsight' };
			pinnedViewlets: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			restoredViewlet?: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			restoredEditors: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
			startupKind: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
		};

		type WorkspaceLoadEvent = {
			userAgent: string;
			windowSize: { innerHeight: number, innerWidth: number, outerHeight: number, outerWidth: number };
			emptyWorkbench: boolean;
			'workbench.filesToOpenOrCreate': number;
			'workbench.filesToDiff': number;
			customKeybindingsCount: number;
			theme: string;
			language: string;
			pinnedViewlets: string[];
			restoredViewlet?: string;
			restoredEditors: number;
			startupKind: StartupKind;
		};

		telemetryService.publicLog2<WorkspaceLoadEvent, WorkspaceLoadClassification>('workspaceLoad', {
			userAgent: navigator.userAgent,
			windowSize: { innerHeight: window.innerHeight, innerWidth: window.innerWidth, outerHeight: window.outerHeight, outerWidth: window.outerWidth },
			emptyWorkbench: contextService.getWorkbenchState() === WorkbenchState.EMPTY,
			'workbench.filesToOpenOrCreate': filesToOpenOrCreate && filesToOpenOrCreate.length || 0,
			'workbench.filesToDiff': filesToDiff && filesToDiff.length || 0,
			customKeybindingsCount: keybindingsService.customKeybindingsCount(),
			theme: themeService.getColorTheme().id,
			language,
			pinnedViewlets: activityBarService.getPinnedViewContainerIds(),
			restoredViewlet: activeViewlet ? activeViewlet.getId() : undefined,
			restoredEditors: editorService.visibleEditors.length,
			startupKind: lifecycleService.startupKind
		});

		// Error Telemetry
		this._register(new ErrorTelemetry(telemetryService));

		// Configuration Telemetry
		this._register(configurationTelemetry(telemetryService, configurationService));

		//  Files Telemetry
		this._register(textFileService.files.onDidLoad(e => this.onTextFileModelLoaded(e)));
		this._register(textFileService.files.onDidSave(e => this.onTextFileModelSaved(e)));

		// Lifecycle
		this._register(lifecycleService.onShutdown(() => this.dispose()));
	}

	private onTextFileModelLoaded(e: ITextFileLoadEvent): void {
		const settingsType = this.getTypeIfSettings(e.model.resource);
		if (settingsType) {
			type SettingsReadClassification = {
				settingsType: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			};

			this.telemetryService.publicLog2<{ settingsType: string }, SettingsReadClassification>('settingsRead', { settingsType }); // Do not log read to user settings.json and .vscode folder as a fileGet event as it ruins our JSON usage data
		} else {
			type FileGetClassification = {} & FileTelemetryDataFragment;

			this.telemetryService.publicLog2<TelemetryData, FileGetClassification>('fileGet', this.getTelemetryData(e.model.resource, e.reason));
		}
	}

	private onTextFileModelSaved(e: ITextFileSaveEvent): void {
		const settingsType = this.getTypeIfSettings(e.model.resource);
		if (settingsType) {
			type SettingsWrittenClassification = {
				settingsType: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			};
			this.telemetryService.publicLog2<{ settingsType: string }, SettingsWrittenClassification>('settingsWritten', { settingsType }); // Do not log write to user settings.json and .vscode folder as a filePUT event as it ruins our JSON usage data
		} else {
			type FilePutClassfication = {} & FileTelemetryDataFragment;
			this.telemetryService.publicLog2<TelemetryData, FilePutClassfication>('filePUT', this.getTelemetryData(e.model.resource, e.reason));
		}
	}

	private getTypeIfSettings(resource: URI): string {
		if (extname(resource) !== '.json') {
			return '';
		}

		// Check for global settings file
		if (isEqual(resource, this.environmentService.settingsResource)) {
			return 'global-settings';
		}

		// Check for keybindings file
		if (isEqual(resource, this.environmentService.keybindingsResource)) {
			return 'keybindings';
		}

		// Check for snippets
		if (isEqualOrParent(resource, this.environmentService.snippetsHome)) {
			return 'snippets';
		}

		// Check for workspace settings file
		const folders = this.contextService.getWorkspace().folders;
		for (const folder of folders) {
			if (isEqualOrParent(resource, folder.toResource('.vscode'))) {
				const filename = basename(resource);
				if (TelemetryContribution.ALLOWLIST_WORKSPACE_JSON.indexOf(filename) > -1) {
					return `.vscode/${filename}`;
				}
			}
		}

		return '';
	}

	private getTelemetryData(resource: URI, reason?: number): TelemetryData {
		const ext = extname(resource);
		const fileName = basename(resource);
		const path = resource.scheme === Schemas.file ? resource.fsPath : resource.path;
		const telemetryData = {
			mimeType: guessMimeTypes(resource).join(', '),
			ext,
			path: hash(path),
			reason,
			allowlistedjson: undefined as string | undefined
		};

		if (ext === '.json' && TelemetryContribution.ALLOWLIST_JSON.indexOf(fileName) > -1) {
			telemetryData['allowlistedjson'] = fileName;
		}

		return telemetryData;
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(TelemetryContribution, LifecyclePhase.Restored);
