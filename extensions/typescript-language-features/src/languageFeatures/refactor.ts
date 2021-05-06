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


interface DidApplyRefactoringCommand_Args {
	readonly codeAction: InlinedCodeAction
}

class DidApplyRefactoringCommand implements Command {
	public static readonly ID = '_typescript.didApplyRefactoring';
	public readonly id = DidApplyRefactoringCommand.ID;

	constructor(
		private readonly telemetryReporter: TelemetryReporter
	) { }

	public async execute(args: DidApplyRefactoringCommand_Args): Promise<void> {
		/* __GDPR__
			"refactor.execute" : {
				"action" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
		this.telemetryReporter.logTelemetry('refactor.execute', {
			action: args.codeAction.action,
		});

		if (!args.codeAction.edit?.size) {
			vscode.window.showErrorMessage(localize('refactoringFailed', "Could not apply refactoring"));
			return;
		}

		const renameLocation = args.codeAction.renameLocation;
		if (renameLocation) {
			// Disable renames in interactive playground https://github.com/microsoft/vscode/issues/75137
			if (args.codeAction.document.uri.scheme !== fileSchemes.walkThroughSnippet) {
				await vscode.commands.executeCommand('editor.action.rename', [
					args.codeAction.document.uri,
					typeConverters.Position.fromLocation(renameLocation)
				]);
			}
		}
	}
}

interface SelectRefactorCommand_Args {
	readonly action: vscode.CodeAction;
	readonly document: vscode.TextDocument;
	readonly info: Proto.ApplicableRefactorInfo;
	readonly rangeOrSelection: vscode.Range | vscode.Selection;
}

class SelectRefactorCommand implements Command {
	public static readonly ID = '_typescript.selectRefactoring';
	public readonly id = SelectRefactorCommand.ID;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly didApplyCommand: DidApplyRefactoringCommand
	) { }

	public async execute(args: SelectRefactorCommand_Args): Promise<void> {
		const file = this.client.toOpenedFilePath(args.document);
		if (!file) {
			return;
		}

		const selected = await vscode.window.showQuickPick(args.info.actions.map((action): vscode.QuickPickItem => ({
			label: action.name,
			description: action.description,
		})));
		if (!selected) {
			return;
		}

		const tsAction = new InlinedCodeAction(this.client, args.action.title, args.action.kind, args.document, args.info.name, selected.label, args.rangeOrSelection);
		await tsAction.resolve(nulToken);

		if (tsAction.edit) {
			if (!(await vscode.workspace.applyEdit(tsAction.edit))) {
				vscode.window.showErrorMessage(localize('refactoringFailed', "Could not apply refactoring"));
				return;
			}
		}

		await this.didApplyCommand.execute({ codeAction: tsAction });
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

class InlinedCodeAction extends vscode.CodeAction {
	constructor(
		public readonly client: ITypeScriptServiceClient,
		title: string,
		kind: vscode.CodeActionKind | undefined,
		public readonly document: vscode.TextDocument,
		public readonly refactor: string,
		public readonly action: string,
		public readonly range: vscode.Range,
	) {
		super(title, kind);
	}

	// Filled in during resolve
	public renameLocation?: Proto.Location;

	public async resolve(token: vscode.CancellationToken): Promise<undefined> {
		const file = this.client.toOpenedFilePath(this.document);
		if (!file) {
			return;
		}

		const args: Proto.GetEditsForRefactorRequestArgs = {
			...typeConverters.Range.toFileRangeRequestArgs(file, this.range),
			refactor: this.refactor,
			action: this.action,
		};

		const response = await this.client.execute('getEditsForRefactor', args, token);
		if (response.type !== 'response' || !response.body) {
			return;
		}

		// Resolve
		this.edit = InlinedCodeAction.getWorkspaceEditForRefactoring(this.client, response.body);
		this.renameLocation = response.body.renameLocation;

		return;
	}

	private static getWorkspaceEditForRefactoring(
		client: ITypeScriptServiceClient,
		body: Proto.RefactorEditInfo,
	): vscode.WorkspaceEdit {
		const workspaceEdit = new vscode.WorkspaceEdit();
		for (const edit of body.edits) {
			const resource = client.toResource(edit.fileName);
			if (resource.scheme === fileSchemes.file) {
				workspaceEdit.createFile(resource, { ignoreIfExists: true });
			}
		}
		typeConverters.WorkspaceEdit.withFileCodeEdits(workspaceEdit, client, body.edits);
		return workspaceEdit;
	}
}

class SelectCodeAction extends vscode.CodeAction {
	constructor(
		info: Proto.ApplicableRefactorInfo,
		document: vscode.TextDocument,
		rangeOrSelection: vscode.Range | vscode.Selection
	) {
		super(info.description, vscode.CodeActionKind.Refactor);
		this.command = {
			title: info.description,
			command: SelectRefactorCommand.ID,
			arguments: [<SelectRefactorCommand_Args>{ action: this, document, info, rangeOrSelection }]
		};
	}
}

type TsCodeAction = InlinedCodeAction | SelectCodeAction;

class TypeScriptRefactorProvider implements vscode.CodeActionProvider<TsCodeAction> {
	public static readonly minVersion = API.v240;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly formattingOptionsManager: FormattingOptionsManager,
		commandManager: CommandManager,
		telemetryReporter: TelemetryReporter
	) {
		const didApplyRefactoringCommand = commandManager.register(new DidApplyRefactoringCommand(telemetryReporter));
		commandManager.register(new SelectRefactorCommand(this.client, didApplyRefactoringCommand));
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
	): Promise<TsCodeAction[] | undefined> {
		if (!this.shouldTrigger(context)) {
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

			const args: Proto.GetApplicableRefactorsRequestArgs & { kind?: string } = {
				...typeConverters.Range.toFileRangeRequestArgs(file, rangeOrSelection),
				triggerReason: this.toTsTriggerReason(context),
				kind: context.only?.value
			};
			return this.client.execute('getApplicableRefactors', args, token);
		});
		if (response?.type !== 'response' || !response.body) {
			return undefined;
		}

		const actions = this.convertApplicableRefactors(response.body, document, rangeOrSelection).filter(action => {
			if (this.client.apiVersion.lt(API.v430)) {
				// Don't show 'infer return type' refactoring unless it has been explicitly requested
				// https://github.com/microsoft/TypeScript/issues/42993
				if (!context.only && action.kind?.value === 'refactor.rewrite.function.returnType') {
					return false;
				}
			}
			return true;
		});

		if (!context.only) {
			return actions;
		}
		return this.pruneInvalidActions(this.appendInvalidActions(actions), context.only, /* numberOfInvalid = */ 5);
	}

	public async resolveCodeAction(
		codeAction: TsCodeAction,
		token: vscode.CancellationToken,
	): Promise<TsCodeAction> {
		if (codeAction instanceof InlinedCodeAction) {
			await codeAction.resolve(token);
		}
		return codeAction;
	}

	private toTsTriggerReason(context: vscode.CodeActionContext): Proto.RefactorTriggerReason | undefined {
		if (context.triggerKind === vscode.CodeActionTriggerKind.Invoke) {
			return 'invoked';
		}
		return undefined;
	}

	private convertApplicableRefactors(
		body: Proto.ApplicableRefactorInfo[],
		document: vscode.TextDocument,
		rangeOrSelection: vscode.Range | vscode.Selection
	): TsCodeAction[] {
		const actions: TsCodeAction[] = [];
		for (const info of body) {
			if (info.inlineable === false) {
				const codeAction = new SelectCodeAction(info, document, rangeOrSelection);
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
		action: Proto.RefactorActionInfo,
		document: vscode.TextDocument,
		info: Proto.ApplicableRefactorInfo,
		rangeOrSelection: vscode.Range | vscode.Selection,
		allActions: readonly Proto.RefactorActionInfo[],
	): InlinedCodeAction {
		const codeAction = new InlinedCodeAction(this.client, action.description, TypeScriptRefactorProvider.getKind(action), document, info.name, action.name, rangeOrSelection);

		// https://github.com/microsoft/TypeScript/pull/37871
		if (action.notApplicableReason) {
			codeAction.disabled = { reason: action.notApplicableReason };
		} else {
			codeAction.command = {
				title: action.description,
				command: DidApplyRefactoringCommand.ID,
				arguments: [<DidApplyRefactoringCommand_Args>{ codeAction }],
			};
		}

		codeAction.isPreferred = TypeScriptRefactorProvider.isPreferred(action, allActions);
		return codeAction;
	}

	private shouldTrigger(context: vscode.CodeActionContext) {
		if (context.only && !vscode.CodeActionKind.Refactor.contains(context.only)) {
			return false;
		}

		return context.triggerKind === vscode.CodeActionTriggerKind.Invoke;
	}

	private static getKind(refactor: Proto.RefactorActionInfo) {
		if ((refactor as Proto.RefactorActionInfo & { kind?: string }).kind) {
			return vscode.CodeActionKind.Empty.append((refactor as Proto.RefactorActionInfo & { kind?: string }).kind!);
		}
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
		if (this.client.apiVersion.gte(API.v400)) {
			// Invalid actions come from TS server instead
			return actions;
		}

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

	private pruneInvalidActions(actions: vscode.CodeAction[], only?: vscode.CodeActionKind, numberOfInvalid?: number): vscode.CodeAction[] {
		if (this.client.apiVersion.lt(API.v400)) {
			// Older TS version don't return extra actions
			return actions;
		}

		const availableActions: vscode.CodeAction[] = [];
		const invalidCommonActions: vscode.CodeAction[] = [];
		const invalidUncommonActions: vscode.CodeAction[] = [];
		for (const action of actions) {
			if (!action.disabled) {
				availableActions.push(action);
				continue;
			}

			// These are the common refactors that we should always show if applicable.
			if (action.kind && (Extract_Constant.kind.contains(action.kind) || Extract_Function.kind.contains(action.kind))) {
				invalidCommonActions.push(action);
				continue;
			}

			// These are the remaining refactors that we can show if we haven't reached the max limit with just common refactors.
			invalidUncommonActions.push(action);
		}

		const prioritizedActions: vscode.CodeAction[] = [];
		prioritizedActions.push(...invalidCommonActions);
		prioritizedActions.push(...invalidUncommonActions);
		const topNInvalid = prioritizedActions.filter(action => !only || (action.kind && only.contains(action.kind))).slice(0, numberOfInvalid);
		availableActions.push(...topNInvalid);
		return availableActions;
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
