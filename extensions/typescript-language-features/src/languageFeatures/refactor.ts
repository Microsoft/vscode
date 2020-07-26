/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { Command, CommandManager } from '../commands/commandManager';
import { LearnMoreAboutRefactoringsCommand } from '../commands/learnMoreAboutRefactorings';
import type * as Proto from '../protocol';
import { ClientCapability, ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { nulToken } from '../utils/cancellation';
import { conditionalRegistration, requireMinVersion, requireSomeCapability } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as fileSchemes from '../utils/fileSchemes';
import { TelemetryReporter } from '../utils/telemetry';
import * as typeConverters from '../utils/typeConverters';
import FormattingOptionsManager from './fileConfigurationManager';

const localize = nls.loadMessageBundle();


namespace Experimental {
	export interface RefactorActionInfo extends Proto.RefactorActionInfo {
		readonly notApplicableReason?: string;
	}

	export type RefactorTriggerReason = 'implicit' | 'invoked';

	export interface GetApplicableRefactorsRequestArgs extends Proto.FileRangeRequestArgs {
		readonly triggerReason?: RefactorTriggerReason;
	}
}


class ApplyRefactoringCommand implements Command {
	public static readonly ID = '_typescript.applyRefactoring';
	public readonly id = ApplyRefactoringCommand.ID;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly telemetryReporter: TelemetryReporter
	) { }

	public async execute(
		document: vscode.TextDocument,
		refactor: string,
		action: string,
		range: vscode.Range
	): Promise<boolean> {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return false;
		}

		/* __GDPR__
			"refactor.execute" : {
				"action" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
		this.telemetryReporter.logTelemetry('refactor.execute', {
			action: action,
		});

		const args: Proto.GetEditsForRefactorRequestArgs = {
			...typeConverters.Range.toFileRangeRequestArgs(file, range),
			refactor,
			action,
		};
		const response = await this.client.execute('getEditsForRefactor', args, nulToken);
		if (response.type !== 'response' || !response.body) {
			return false;
		}

		if (!response.body.edits.length) {
			vscode.window.showErrorMessage(localize('refactoringFailed', "Could not apply refactoring"));
			return false;
		}

		const workspaceEdit = await this.toWorkspaceEdit(response.body);
		if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
			return false;
		}

		const renameLocation = response.body.renameLocation;
		if (renameLocation) {
			await vscode.commands.executeCommand('editor.action.rename', [
				document.uri,
				typeConverters.Position.fromLocation(renameLocation)
			]);
		}
		return true;
	}

	private async toWorkspaceEdit(body: Proto.RefactorEditInfo) {
		const workspaceEdit = new vscode.WorkspaceEdit();
		for (const edit of body.edits) {
			const resource = this.client.toResource(edit.fileName);
			if (resource.scheme === fileSchemes.file) {
				workspaceEdit.createFile(resource, { ignoreIfExists: true });
			}
		}
		typeConverters.WorkspaceEdit.withFileCodeEdits(workspaceEdit, this.client, body.edits);
		return workspaceEdit;
	}
}

class SelectRefactorCommand implements Command {
	public static readonly ID = '_typescript.selectRefactoring';
	public readonly id = SelectRefactorCommand.ID;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly doRefactoring: ApplyRefactoringCommand
	) { }

	public async execute(
		document: vscode.TextDocument,
		info: Proto.ApplicableRefactorInfo,
		range: vscode.Range
	): Promise<boolean> {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return false;
		}
		const selected = await vscode.window.showQuickPick(info.actions.map((action): vscode.QuickPickItem => ({
			label: action.name,
			description: action.description,
		})));
		if (!selected) {
			return false;
		}
		return this.doRefactoring.execute(document, info.name, selected.label, range);
	}
}

interface CodeActionKind {
	readonly kind: vscode.CodeActionKind;
	matches(refactor: Proto.RefactorActionInfo): boolean;
}

const Extract_Function = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorExtract.append('function'),
	matches: refactor => refactor.name.startsWith('function_')
});

const Extract_Constant = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorExtract.append('constant'),
	matches: refactor => refactor.name.startsWith('constant_')
});

const Extract_Type = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorExtract.append('type'),
	matches: refactor => refactor.name.startsWith('Extract to type alias')
});

const Extract_Interface = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorExtract.append('interface'),
	matches: refactor => refactor.name.startsWith('Extract to interface')
});

const Move_NewFile = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.Refactor.append('move').append('newFile'),
	matches: refactor => refactor.name.startsWith('Move to a new file')
});

const Rewrite_Import = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorRewrite.append('import'),
	matches: refactor => refactor.name.startsWith('Convert namespace import') || refactor.name.startsWith('Convert named imports')
});

const Rewrite_Export = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorRewrite.append('export'),
	matches: refactor => refactor.name.startsWith('Convert default export') || refactor.name.startsWith('Convert named export')
});

const Rewrite_Arrow_Braces = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorRewrite.append('arrow').append('braces'),
	matches: refactor => refactor.name.startsWith('Convert default export') || refactor.name.startsWith('Convert named export')
});

const Rewrite_Parameters_ToDestructured = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorRewrite.append('parameters').append('toDestructured'),
	matches: refactor => refactor.name.startsWith('Convert parameters to destructured object')
});

const Rewrite_Property_GenerateAccessors = Object.freeze<CodeActionKind>({
	kind: vscode.CodeActionKind.RefactorRewrite.append('property').append('generateAccessors'),
	matches: refactor => refactor.name.startsWith('Generate \'get\' and \'set\' accessors')
});

const allKnownCodeActionKinds = [
	Extract_Function,
	Extract_Constant,
	Extract_Type,
	Extract_Interface,
	Move_NewFile,
	Rewrite_Import,
	Rewrite_Export,
	Rewrite_Arrow_Braces,
	Rewrite_Parameters_ToDestructured,
	Rewrite_Property_GenerateAccessors
];

class TypeScriptRefactorProvider implements vscode.CodeActionProvider {
	public static readonly minVersion = API.v240;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly formattingOptionsManager: FormattingOptionsManager,
		commandManager: CommandManager,
		telemetryReporter: TelemetryReporter
	) {
		const doRefactoringCommand = commandManager.register(new ApplyRefactoringCommand(this.client, telemetryReporter));
		commandManager.register(new SelectRefactorCommand(this.client, doRefactoringCommand));
	}

	public static readonly metadata: vscode.CodeActionProviderMetadata = {
		providedCodeActionKinds: [
			vscode.CodeActionKind.Refactor,
			...allKnownCodeActionKinds.map(x => x.kind),
		],
		documentation: [
			{
				kind: vscode.CodeActionKind.Refactor,
				command: {
					command: LearnMoreAboutRefactoringsCommand.id,
					title: localize('refactor.documentation.title', "Learn more about JS/TS refactorings")
				}
			}
		]
	};

	public async provideCodeActions(
		document: vscode.TextDocument,
		rangeOrSelection: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): Promise<vscode.CodeAction[] | undefined> {
		if (!this.shouldTrigger(rangeOrSelection, context)) {
			return undefined;
		}
		if (!this.client.toOpenedFilePath(document)) {
			return undefined;
		}

		const response = await this.client.interruptGetErr(() => {
			const file = this.client.toOpenedFilePath(document);
			if (!file) {
				return undefined;
			}
			this.formattingOptionsManager.ensureConfigurationForDocument(document, token);

			const args: Experimental.GetApplicableRefactorsRequestArgs = {
				...typeConverters.Range.toFileRangeRequestArgs(file, rangeOrSelection),
				triggerReason: this.toTsTriggerReason(context),
			};
			return this.client.execute('getApplicableRefactors', args, token);
		});
		if (response?.type !== 'response' || !response.body) {
			return undefined;
		}

		const actions = this.convertApplicableRefactors(response.body, document, rangeOrSelection);
		if (!context.only) {
			return actions;
		}
		return this.appendInvalidActions(actions);
	}

	private toTsTriggerReason(context: vscode.CodeActionContext): Experimental.RefactorTriggerReason | undefined {
		if (!context.only) {
			return;
		}
		return 'invoked';
	}

	private convertApplicableRefactors(
		body: Proto.ApplicableRefactorInfo[],
		document: vscode.TextDocument,
		rangeOrSelection: vscode.Range | vscode.Selection
	) {
		const actions: vscode.CodeAction[] = [];
		for (const info of body) {
			if (info.inlineable === false) {
				const codeAction = new vscode.CodeAction(info.description, vscode.CodeActionKind.Refactor);
				codeAction.command = {
					title: info.description,
					command: SelectRefactorCommand.ID,
					arguments: [document, info, rangeOrSelection]
				};
				actions.push(codeAction);
			} else {
				for (const action of info.actions) {
					actions.push(this.refactorActionToCodeAction(action, document, info, rangeOrSelection, info.actions));
				}
			}
		}
		return actions;
	}

	private refactorActionToCodeAction(
		action: Experimental.RefactorActionInfo,
		document: vscode.TextDocument,
		info: Proto.ApplicableRefactorInfo,
		rangeOrSelection: vscode.Range | vscode.Selection,
		allActions: readonly Proto.RefactorActionInfo[],
	) {
		const codeAction = new vscode.CodeAction(action.description, TypeScriptRefactorProvider.getKind(action));

		// https://github.com/microsoft/TypeScript/pull/37871
		if (action.notApplicableReason) {
			codeAction.disabled = { reason: action.notApplicableReason };
		} else {
			codeAction.command = {
				title: action.description,
				command: ApplyRefactoringCommand.ID,
				arguments: [document, info.name, action.name, rangeOrSelection],
			};
		}

		codeAction.isPreferred = TypeScriptRefactorProvider.isPreferred(action, allActions);
		return codeAction;
	}

	private shouldTrigger(rangeOrSelection: vscode.Range | vscode.Selection, context: vscode.CodeActionContext) {
		if (context.only && !vscode.CodeActionKind.Refactor.contains(context.only)) {
			return false;
		}

		return rangeOrSelection instanceof vscode.Selection;
	}

	private static getKind(refactor: Proto.RefactorActionInfo) {
		const match = allKnownCodeActionKinds.find(kind => kind.matches(refactor));
		return match ? match.kind : vscode.CodeActionKind.Refactor;
	}

	private static isPreferred(
		action: Proto.RefactorActionInfo,
		allActions: readonly Proto.RefactorActionInfo[],
	): boolean {
		if (Extract_Constant.matches(action)) {
			// Only mark the action with the lowest scope as preferred
			const getScope = (name: string) => {
				const scope = name.match(/scope_(\d)/)?.[1];
				return scope ? +scope : undefined;
			};
			const scope = getScope(action.name);
			if (typeof scope !== 'number') {
				return false;
			}

			return allActions
				.filter(otherAtion => otherAtion !== action && Extract_Constant.matches(otherAtion))
				.every(otherAction => {
					const otherScope = getScope(otherAction.name);
					return typeof otherScope === 'number' ? scope < otherScope : true;
				});
		}
		if (Extract_Type.matches(action) || Extract_Interface.matches(action)) {
			return true;
		}
		return false;
	}

	private appendInvalidActions(actions: vscode.CodeAction[]): vscode.CodeAction[] {
		if (!actions.some(action => action.kind && Extract_Constant.kind.contains(action.kind))) {
			const disabledAction = new vscode.CodeAction(
				localize('extractConstant.disabled.title', "Extract to constant"),
				Extract_Constant.kind);

			disabledAction.disabled = {
				reason: localize('extractConstant.disabled.reason', "The current selection cannot be extracted"),
			};
			disabledAction.isPreferred = true;

			actions.push(disabledAction);
		}

		if (!actions.some(action => action.kind && Extract_Function.kind.contains(action.kind))) {
			const disabledAction = new vscode.CodeAction(
				localize('extractFunction.disabled.title', "Extract to function"),
				Extract_Function.kind);

			disabledAction.disabled = {
				reason: localize('extractFunction.disabled.reason', "The current selection cannot be extracted"),
			};
			actions.push(disabledAction);
		}
		return actions;
	}
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
	formattingOptionsManager: FormattingOptionsManager,
	commandManager: CommandManager,
	telemetryReporter: TelemetryReporter,
) {
	return conditionalRegistration([
		requireMinVersion(client, TypeScriptRefactorProvider.minVersion),
		requireSomeCapability(client, ClientCapability.Semantic),
	], () => {
		return vscode.languages.registerCodeActionsProvider(selector.semantic,
			new TypeScriptRefactorProvider(client, formattingOptionsManager, commandManager, telemetryReporter),
			TypeScriptRefactorProvider.metadata);
	});
}
