/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { Command, CommandManager } from '../commands/commandManager';
import type * as Proto from '../protocol';
import { ClientCapability, ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { nulToken } from '../utils/cancellation';
import { applyCodeActionCommands, getEditForCodeAction } from '../utils/codeAction';
import { conditionalRegistration, requireSomeCapability } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as fixNames from '../utils/fixNames';
import { memoize } from '../utils/memoize';
import { equals } from '../utils/objects';
import { TelemetryReporter } from '../utils/telemetry';
import * as typeConverters from '../utils/typeConverters';
import { DiagnosticsManager } from './diagnostics';
import FileConfigurationManager from './fileConfigurationManager';

const localize = nls.loadMessageBundle();

class ApplyCodeActionCommand implements Command {
	public static readonly ID = '_typescript.applyCodeActionCommand';
	public readonly id = ApplyCodeActionCommand.ID;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly telemetryReporter: TelemetryReporter,
	) { }

	public async execute(
		action: Proto.CodeFixAction
	): Promise<boolean> {
		/* __GDPR__
			"quickFix.execute" : {
				"fixName" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
		this.telemetryReporter.logTelemetry('quickFix.execute', {
			fixName: action.fixName
		});

		return applyCodeActionCommands(this.client, action.commands, nulToken);
	}
}

type ApplyFixAllCodeAction_args = {
	readonly action: VsCodeFixAllCodeAction;
};

class ApplyFixAllCodeAction implements Command {
	public static readonly ID = '_typescript.applyFixAllCodeAction';
	public readonly id = ApplyFixAllCodeAction.ID;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly telemetryReporter: TelemetryReporter,
	) { }

	public async execute(args: ApplyFixAllCodeAction_args): Promise<void> {
		/* __GDPR__
			"quickFixAll.execute" : {
				"fixName" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
		this.telemetryReporter.logTelemetry('quickFixAll.execute', {
			fixName: args.action.tsAction.fixName
		});

		if (args.action.combinedResponse) {
			await applyCodeActionCommands(this.client, args.action.combinedResponse.body.commands, nulToken);
		}
	}
}

/**
 * Unique set of diagnostics keyed on diagnostic range and error code.
 */
class DiagnosticsSet {
	public static from(diagnostics: vscode.Diagnostic[]) {
		const values = new Map<string, vscode.Diagnostic>();
		for (const diagnostic of diagnostics) {
			values.set(DiagnosticsSet.key(diagnostic), diagnostic);
		}
		return new DiagnosticsSet(values);
	}

	private static key(diagnostic: vscode.Diagnostic) {
		const { start, end } = diagnostic.range;
		return `${diagnostic.code}-${start.line},${start.character}-${end.line},${end.character}`;
	}

	private constructor(
		private readonly _values: Map<string, vscode.Diagnostic>
	) { }

	public get values(): Iterable<vscode.Diagnostic> {
		return this._values.values();
	}

	public get size() {
		return this._values.size;
	}
}

class VsCodeCodeAction extends vscode.CodeAction {
	constructor(
		public readonly tsAction: Proto.CodeFixAction,
		title: string,
		kind: vscode.CodeActionKind
	) {
		super(title, kind);
	}
}

class VsCodeFixAllCodeAction extends VsCodeCodeAction {
	constructor(
		tsAction: Proto.CodeFixAction,
		public readonly file: string,
		title: string,
		kind: vscode.CodeActionKind
	) {
		super(tsAction, title, kind);
	}

	public combinedResponse?: Proto.GetCombinedCodeFixResponse;
}

class CodeActionSet {
	private readonly _actions = new Set<VsCodeCodeAction>();
	private readonly _fixAllActions = new Map<{}, VsCodeCodeAction>();

	public get values(): Iterable<VsCodeCodeAction> {
		return this._actions;
	}

	public addAction(action: VsCodeCodeAction) {
		for (const existing of this._actions) {
			if (action.tsAction.fixName === existing.tsAction.fixName && equals(action.edit, existing.edit)) {
				this._actions.delete(existing);
			}
		}

		this._actions.add(action);

		if (action.tsAction.fixId) {
			// If we have an existing fix all action, then make sure it follows this action
			const existingFixAll = this._fixAllActions.get(action.tsAction.fixId);
			if (existingFixAll) {
				this._actions.delete(existingFixAll);
				this._actions.add(existingFixAll);
			}
		}
	}

	public addFixAllAction(fixId: {}, action: VsCodeCodeAction) {
		const existing = this._fixAllActions.get(fixId);
		if (existing) {
			// reinsert action at back of actions list
			this._actions.delete(existing);
		}
		this.addAction(action);
		this._fixAllActions.set(fixId, action);
	}

	public hasFixAllAction(fixId: {}) {
		return this._fixAllActions.has(fixId);
	}
}

class SupportedCodeActionProvider {
	public constructor(
		private readonly client: ITypeScriptServiceClient
	) { }

	public async getFixableDiagnosticsForContext(context: vscode.CodeActionContext): Promise<DiagnosticsSet> {
		const fixableCodes = await this.fixableDiagnosticCodes;
		return DiagnosticsSet.from(
			context.diagnostics.filter(diagnostic => typeof diagnostic.code !== 'undefined' && fixableCodes.has(diagnostic.code + '')));
	}

	@memoize
	private get fixableDiagnosticCodes(): Thenable<Set<string>> {
		return this.client.execute('getSupportedCodeFixes', null, nulToken)
			.then(response => response.type === 'response' ? response.body || [] : [])
			.then(codes => new Set(codes));
	}
}

class TypeScriptQuickFixProvider implements vscode.CodeActionProvider<VsCodeCodeAction> {

	public static readonly metadata: vscode.CodeActionProviderMetadata = {
		providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
	};

	private readonly supportedCodeActionProvider: SupportedCodeActionProvider;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly formattingConfigurationManager: FileConfigurationManager,
		commandManager: CommandManager,
		private readonly diagnosticsManager: DiagnosticsManager,
		telemetryReporter: TelemetryReporter
	) {
		commandManager.register(new ApplyCodeActionCommand(client, telemetryReporter));
		commandManager.register(new ApplyFixAllCodeAction(client, telemetryReporter));

		this.supportedCodeActionProvider = new SupportedCodeActionProvider(client);
	}

	public async provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): Promise<vscode.CodeAction[]> {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return [];
		}

		const fixableDiagnostics = await this.supportedCodeActionProvider.getFixableDiagnosticsForContext(context);
		if (!fixableDiagnostics.size) {
			return [];
		}

		if (this.client.bufferSyncSupport.hasPendingDiagnostics(document.uri)) {
			return [];
		}

		await this.formattingConfigurationManager.ensureConfigurationForDocument(document, token);

		const results = new CodeActionSet();
		for (const diagnostic of fixableDiagnostics.values) {
			await this.getFixesForDiagnostic(document, file, diagnostic, results, token);
		}

		const allActions = Array.from(results.values);
		for (const action of allActions) {
			action.isPreferred = isPreferredFix(action, allActions);
		}
		return allActions;
	}

	public async resolveCodeAction(codeAction: VsCodeCodeAction, token: vscode.CancellationToken): Promise<VsCodeCodeAction> {
		if (!(codeAction instanceof VsCodeFixAllCodeAction) || !codeAction.tsAction.fixId) {
			return codeAction;
		}

		const arg: Proto.GetCombinedCodeFixRequestArgs = {
			scope: {
				type: 'file',
				args: { file: codeAction.file }
			},
			fixId: codeAction.tsAction.fixId,
		};

		const response = await this.client.execute('getCombinedCodeFix', arg, token);
		if (response.type === 'response') {
			codeAction.combinedResponse = response;
			codeAction.edit = typeConverters.WorkspaceEdit.fromFileCodeEdits(this.client, response.body.changes);
		}

		return codeAction;
	}

	private async getFixesForDiagnostic(
		document: vscode.TextDocument,
		file: string,
		diagnostic: vscode.Diagnostic,
		results: CodeActionSet,
		token: vscode.CancellationToken,
	): Promise<CodeActionSet> {
		const args: Proto.CodeFixRequestArgs = {
			...typeConverters.Range.toFileRangeRequestArgs(file, diagnostic.range),
			errorCodes: [+(diagnostic.code!)]
		};
		const response = await this.client.execute('getCodeFixes', args, token);
		if (response.type !== 'response' || !response.body) {
			return results;
		}

		for (const tsCodeFix of response.body) {
			this.addAllFixesForTsCodeAction(results, document, file, diagnostic, tsCodeFix as Proto.CodeFixAction);
		}
		return results;
	}

	private addAllFixesForTsCodeAction(
		results: CodeActionSet,
		document: vscode.TextDocument,
		file: string,
		diagnostic: vscode.Diagnostic,
		tsAction: Proto.CodeFixAction
	): CodeActionSet {
		results.addAction(this.getSingleFixForTsCodeAction(diagnostic, tsAction));
		this.addFixAllForTsCodeAction(results, document, file, diagnostic, tsAction as Proto.CodeFixAction);
		return results;
	}

	private getSingleFixForTsCodeAction(
		diagnostic: vscode.Diagnostic,
		tsAction: Proto.CodeFixAction
	): VsCodeCodeAction {
		const codeAction = new VsCodeCodeAction(tsAction, tsAction.description, vscode.CodeActionKind.QuickFix);
		codeAction.edit = getEditForCodeAction(this.client, tsAction);
		codeAction.diagnostics = [diagnostic];
		codeAction.command = {
			command: ApplyCodeActionCommand.ID,
			arguments: [tsAction],
			title: ''
		};
		return codeAction;
	}

	private addFixAllForTsCodeAction(
		results: CodeActionSet,
		document: vscode.TextDocument,
		file: string,
		diagnostic: vscode.Diagnostic,
		tsAction: Proto.CodeFixAction,
	): CodeActionSet {
		if (!tsAction.fixId || this.client.apiVersion.lt(API.v270) || results.hasFixAllAction(tsAction.fixId)) {
			return results;
		}

		// Make sure there are multiple diagnostics of the same type in the file
		if (!this.diagnosticsManager.getDiagnostics(document.uri).some(x => {
			if (x === diagnostic) {
				return false;
			}
			return x.code === diagnostic.code
				|| (fixAllErrorCodes.has(x.code as number) && fixAllErrorCodes.get(x.code as number) === fixAllErrorCodes.get(diagnostic.code as number));
		})) {
			return results;
		}

		const action = new VsCodeFixAllCodeAction(
			tsAction,
			file,
			tsAction.fixAllDescription || localize('fixAllInFileLabel', '{0} (Fix all in file)', tsAction.description),
			vscode.CodeActionKind.QuickFix);

		action.diagnostics = [diagnostic];
		action.command = {
			command: ApplyFixAllCodeAction.ID,
			arguments: [<ApplyFixAllCodeAction_args>{ action }],
			title: ''
		};
		results.addFixAllAction(tsAction.fixId, action);
		return results;
	}
}

// Some fix all actions can actually fix multiple differnt diagnostics. Make sure we still show the fix all action
// in such cases
const fixAllErrorCodes = new Map<number, number>([
	// Missing async
	[2339, 2339],
	[2345, 2339],
]);

const preferredFixes = new Map<string, { readonly value: number, readonly thereCanOnlyBeOne?: boolean }>([
	[fixNames.annotateWithTypeFromJSDoc, { value: 1 }],
	[fixNames.constructorForDerivedNeedSuperCall, { value: 1 }],
	[fixNames.extendsInterfaceBecomesImplements, { value: 1 }],
	[fixNames.awaitInSyncFunction, { value: 1 }],
	[fixNames.classIncorrectlyImplementsInterface, { value: 3 }],
	[fixNames.classDoesntImplementInheritedAbstractMember, { value: 3 }],
	[fixNames.unreachableCode, { value: 1 }],
	[fixNames.unusedIdentifier, { value: 1 }],
	[fixNames.forgottenThisPropertyAccess, { value: 1 }],
	[fixNames.spelling, { value: 2 }],
	[fixNames.addMissingAwait, { value: 1 }],
	[fixNames.fixImport, { value: 0, thereCanOnlyBeOne: true }],
]);

function isPreferredFix(
	action: VsCodeCodeAction,
	allActions: readonly VsCodeCodeAction[]
): boolean {
	if (action instanceof VsCodeFixAllCodeAction) {
		return false;
	}

	const fixPriority = preferredFixes.get(action.tsAction.fixName);
	if (!fixPriority) {
		return false;
	}

	return allActions.every(otherAction => {
		if (otherAction === action) {
			return true;
		}

		if (otherAction instanceof VsCodeFixAllCodeAction) {
			return true;
		}

		const otherFixPriority = preferredFixes.get(otherAction.tsAction.fixName);
		if (!otherFixPriority || otherFixPriority.value < fixPriority.value) {
			return true;
		} else if (otherFixPriority.value > fixPriority.value) {
			return false;
		}

		if (fixPriority.thereCanOnlyBeOne && action.tsAction.fixName === otherAction.tsAction.fixName) {
			return false;
		}

		return true;
	});
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
	fileConfigurationManager: FileConfigurationManager,
	commandManager: CommandManager,
	diagnosticsManager: DiagnosticsManager,
	telemetryReporter: TelemetryReporter
) {
	return conditionalRegistration([
		requireSomeCapability(client, ClientCapability.Semantic),
	], () => {
		return vscode.languages.registerCodeActionsProvider(selector.semantic,
			new TypeScriptQuickFixProvider(client, fileConfigurationManager, commandManager, diagnosticsManager, telemetryReporter),
			TypeScriptQuickFixProvider.metadata);
	});
}
