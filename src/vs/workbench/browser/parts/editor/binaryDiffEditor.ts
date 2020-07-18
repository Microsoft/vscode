/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { BINARY_DIFF_EDITOR_ID } from 'vs/workbench/common/editor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { SideBySideEditor } from 'vs/workbench/browser/parts/editor/sideBySideEditor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { BaseBinaryResourceEditor } from 'vs/workbench/browser/parts/editor/binaryEditor';
import { IStorageService } from 'vs/platform/storage/common/storage';

/**
 * An implementation of editor for diffing binary files like images or videos.
 */
export class BinaryResourceDiffEditor extends SideBySideEditor {

	static readonly ID = BINARY_DIFF_EDITOR_ID;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService
	) {
		super(telemetryService, instantiationService, themeService, storageService);
	}

	getMetadata(): string | undefined {
		const primary = this.primaryEditorPane;
		const secondary = this.secondaryEditorPane;

		if (primary instanceof BaseBinaryResourceEditor && secondary instanceof BaseBinaryResourceEditor) {
			return nls.localize('metadataDiff', "{0} ↔ {1}", secondary.getMetadata(), primary.getMetadata());
		}

		return undefined;
	}
}
