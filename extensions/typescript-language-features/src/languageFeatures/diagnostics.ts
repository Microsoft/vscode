/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ResourceMap } from '../utils/resourceMap';
import { DiagnosticLanguage } from '../utils/languageDescription';
import * as arrays from '../utils/arrays';
import { Disposable } from '../utils/dispose';

function diagnosticsEquals(a: vscode.Diagnostic, b: vscode.Diagnostic): boolean {
	if (a === b) {
		return true;
	}

	return a.code === b.code
		&& a.message === b.message
		&& a.severity === b.severity
		&& a.source === b.source
		&& a.range.isEqual(b.range)
		&& arrays.equals(a.relatedInformation || arrays.empty, b.relatedInformation || arrays.empty, (a, b) => {
			return a.message === b.message
				&& a.location.range.isEqual(b.location.range)
				&& a.location.uri.fsPath === b.location.uri.fsPath;
		})
		&& arrays.equals(a.tags || arrays.empty, b.tags || arrays.empty);
}

export const enum DiagnosticKind {
	Syntax,
	Semantic,
	Suggestion,
}

class FileDiagnostics {
	private readonly _diagnostics = new Map<DiagnosticKind, ReadonlyArray<vscode.Diagnostic>>();

	constructor(
		public readonly file: vscode.Uri,
		public language: DiagnosticLanguage
	) { }

	public updateDiagnostics(
		language: DiagnosticLanguage,
		kind: DiagnosticKind,
		diagnostics: ReadonlyArray<vscode.Diagnostic>
	): boolean {
		if (language !== this.language) {
			this._diagnostics.clear();
			this.language = language;
		}

		const existing = this._diagnostics.get(kind);
		if (arrays.equals(existing || arrays.empty, diagnostics, diagnosticsEquals)) {
			// No need to update
			return false;
		}

		this._diagnostics.set(kind, diagnostics);
		return true;
	}

	public getDiagnostics(settings: DiagnosticSettings): vscode.Diagnostic[] {
		if (!settings.getValidate(this.language)) {
			return [];
		}

		return [
			...this.get(DiagnosticKind.Syntax),
			...this.get(DiagnosticKind.Semantic),
			...this.getSuggestionDiagnostics(settings),
		];
	}

	private getSuggestionDiagnostics(settings: DiagnosticSettings) {
		const enableSuggestions = settings.getEnableSuggestions(this.language);
		return this.get(DiagnosticKind.Suggestion).filter(x => {
			if (!enableSuggestions) {
				// Still show unused
				return x.tags && (x.tags.includes(vscode.DiagnosticTag.Unnecessary) || x.tags.includes(vscode.DiagnosticTag.Deprecated));
			}
			return true;
		});
	}

	private get(kind: DiagnosticKind): ReadonlyArray<vscode.Diagnostic> {
		return this._diagnostics.get(kind) || [];
	}
}

interface LanguageDiagnosticSettings {
	readonly validate: boolean;
	readonly enableSuggestions: boolean;
}

function areLanguageDiagnosticSettingsEqual(currentSettings: LanguageDiagnosticSettings, newSettings: LanguageDiagnosticSettings): boolean {
	return currentSettings.validate === newSettings.validate
		&& currentSettings.enableSuggestions && currentSettings.enableSuggestions;
}

class DiagnosticSettings {
	private static readonly defaultSettings: LanguageDiagnosticSettings = {
		validate: true,
		enableSuggestions: true
	};

	private readonly _languageSettings = new Map<DiagnosticLanguage, LanguageDiagnosticSettings>();

	public getValidate(language: DiagnosticLanguage): boolean {
		return this.get(language).validate;
	}

	public setValidate(language: DiagnosticLanguage, value: boolean): boolean {
		return this.update(language, settings => ({
			validate: value,
			enableSuggestions: settings.enableSuggestions,
		}));
	}

	public getEnableSuggestions(language: DiagnosticLanguage): boolean {
		return this.get(language).enableSuggestions;
	}

	public setEnableSuggestions(language: DiagnosticLanguage, value: boolean): boolean {
		return this.update(language, settings => ({
			validate: settings.validate,
			enableSuggestions: value
		}));
	}

	private get(language: DiagnosticLanguage): LanguageDiagnosticSettings {
		return this._languageSettings.get(language) || DiagnosticSettings.defaultSettings;
	}

	private update(language: DiagnosticLanguage, f: (x: LanguageDiagnosticSettings) => LanguageDiagnosticSettings): boolean {
		const currentSettings = this.get(language);
		const newSettings = f(currentSettings);
		this._languageSettings.set(language, newSettings);
		return areLanguageDiagnosticSettingsEqual(currentSettings, newSettings);
	}
}

export class DiagnosticsManager extends Disposable {
	private readonly _diagnostics: ResourceMap<FileDiagnostics>;
	private readonly _settings = new DiagnosticSettings();
	private readonly _currentDiagnostics: vscode.DiagnosticCollection;
	private readonly _pendingUpdates: ResourceMap<any>;

	private readonly _updateDelay = 50;

	constructor(
		owner: string,
		onCaseInsenitiveFileSystem: boolean
	) {
		super();
		this._diagnostics = new ResourceMap<FileDiagnostics>(undefined, { onCaseInsenitiveFileSystem });
		this._pendingUpdates = new ResourceMap<any>(undefined, { onCaseInsenitiveFileSystem });

		this._currentDiagnostics = this._register(vscode.languages.createDiagnosticCollection(owner));
	}

	public dispose() {
		super.dispose();

		for (const value of this._pendingUpdates.values) {
			clearTimeout(value);
		}
		this._pendingUpdates.clear();
	}

	public reInitialize(): void {
		this._currentDiagnostics.clear();
		this._diagnostics.clear();
	}

	public setValidate(language: DiagnosticLanguage, value: boolean) {
		const didUpdate = this._settings.setValidate(language, value);
		if (didUpdate) {
			this.rebuild();
		}
	}

	public setEnableSuggestions(language: DiagnosticLanguage, value: boolean) {
		const didUpdate = this._settings.setEnableSuggestions(language, value);
		if (didUpdate) {
			this.rebuild();
		}
	}

	public updateDiagnostics(
		file: vscode.Uri,
		language: DiagnosticLanguage,
		kind: DiagnosticKind,
		diagnostics: ReadonlyArray<vscode.Diagnostic>
	): void {
		let didUpdate = false;
		const entry = this._diagnostics.get(file);
		if (entry) {
			didUpdate = entry.updateDiagnostics(language, kind, diagnostics);
		} else if (diagnostics.length) {
			const fileDiagnostics = new FileDiagnostics(file, language);
			fileDiagnostics.updateDiagnostics(language, kind, diagnostics);
			this._diagnostics.set(file, fileDiagnostics);
			didUpdate = true;
		}

		if (didUpdate) {
			this.scheduleDiagnosticsUpdate(file);
		}
	}

	public configFileDiagnosticsReceived(
		file: vscode.Uri,
		diagnostics: ReadonlyArray<vscode.Diagnostic>
	): void {
		this._currentDiagnostics.set(file, diagnostics);
	}

	public delete(resource: vscode.Uri): void {
		this._currentDiagnostics.delete(resource);
		this._diagnostics.delete(resource);
	}

	public getDiagnostics(file: vscode.Uri): ReadonlyArray<vscode.Diagnostic> {
		return this._currentDiagnostics.get(file) || [];
	}

	private scheduleDiagnosticsUpdate(file: vscode.Uri) {
		if (!this._pendingUpdates.has(file)) {
			this._pendingUpdates.set(file, setTimeout(() => this.updateCurrentDiagnostics(file), this._updateDelay));
		}
	}

	private updateCurrentDiagnostics(file: vscode.Uri): void {
		if (this._pendingUpdates.has(file)) {
			clearTimeout(this._pendingUpdates.get(file));
			this._pendingUpdates.delete(file);
		}

		const fileDiagnostics = this._diagnostics.get(file);
		this._currentDiagnostics.set(file, fileDiagnostics ? fileDiagnostics.getDiagnostics(this._settings) : []);
	}

	private rebuild(): void {
		this._currentDiagnostics.clear();
		for (const fileDiagnostic of this._diagnostics.values) {
			this._currentDiagnostics.set(fileDiagnostic.file, fileDiagnostic.getDiagnostics(this._settings));
		}
	}
}
