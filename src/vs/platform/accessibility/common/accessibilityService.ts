/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IAccessibilityService, AccessibilitySupport, CONTEXT_ACCESSIBILITY_MODE_ENABLED } from 'vs/platform/accessibility/common/accessibility';
import { Event, Emitter } from 'vs/base/common/event';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export class AccessibilityService extends Disposable implements IAccessibilityService {
	declare readonly _serviceBrand: undefined;

	private _accessibilityModeEnabledContext: IContextKey<boolean>;
	protected _accessibilitySupport = AccessibilitySupport.Unknown;
	protected readonly _onDidChangeScreenReaderOptimized = new Emitter<void>();

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
	) {
		super();
		this._accessibilityModeEnabledContext = CONTEXT_ACCESSIBILITY_MODE_ENABLED.bindTo(this._contextKeyService);
		const updateContextKey = () => this._accessibilityModeEnabledContext.set(this.isScreenReaderOptimized());
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.accessibilitySupport')) {
				updateContextKey();
				this._onDidChangeScreenReaderOptimized.fire();
			}
		}));
		updateContextKey();
		this.onDidChangeScreenReaderOptimized(() => updateContextKey());
	}

	get onDidChangeScreenReaderOptimized(): Event<void> {
		return this._onDidChangeScreenReaderOptimized.event;
	}

	isScreenReaderOptimized(): boolean {
		const config = this._configurationService.getValue('editor.accessibilitySupport');
		return config === 'on' || (config === 'auto' && this._accessibilitySupport === AccessibilitySupport.Enabled);
	}

	getAccessibilitySupport(): AccessibilitySupport {
		return this._accessibilitySupport;
	}

	alwaysUnderlineAccessKeys(): Promise<boolean> {
		return Promise.resolve(false);
	}

	setAccessibilitySupport(accessibilitySupport: AccessibilitySupport): void {
		if (this._accessibilitySupport === accessibilitySupport) {
			return;
		}

		this._accessibilitySupport = accessibilitySupport;
		this._onDidChangeScreenReaderOptimized.fire();
	}
}
