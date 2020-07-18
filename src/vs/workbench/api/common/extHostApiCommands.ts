/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import type * as vscode from 'vscode';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import * as types from 'vs/workbench/api/common/extHostTypes';
import { IRawColorInfo, IWorkspaceEditDto, ICallHierarchyItemDto, IIncomingCallDto, IOutgoingCallDto } from 'vs/workbench/api/common/extHost.protocol';
import * as modes from 'vs/editor/common/modes';
import * as search from 'vs/workbench/contrib/search/common/search';
import { ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { CustomCodeAction } from 'vs/workbench/api/common/extHostLanguageFeatures';
import { ICommandsExecutor, OpenFolderAPICommand, DiffAPICommand, OpenAPICommand, RemoveFromRecentlyOpenedAPICommand, SetEditorLayoutAPICommand, OpenIssueReporter, OpenIssueReporterArgs } from './apiCommands';
import { EditorGroupLayout } from 'vs/workbench/services/editor/common/editorGroupsService';
import { isFalsyOrEmpty } from 'vs/base/common/arrays';
import { IRange } from 'vs/editor/common/core/range';
import { IPosition } from 'vs/editor/common/core/position';

//#region --- NEW world

export class ApiCommandArgument<V, O = V> {

	static readonly Uri = new ApiCommandArgument<URI>('uri', 'Uri of a text document', v => URI.isUri(v), v => v);
	static readonly Position = new ApiCommandArgument<types.Position, IPosition>('position', 'A position in a text document', v => types.Position.isPosition(v), typeConverters.Position.from);
	static readonly Range = new ApiCommandArgument<types.Range, IRange>('range', 'A range in a text document', v => types.Range.isRange(v), typeConverters.Range.from);

	static readonly CallHierarchyItem = new ApiCommandArgument('item', 'A call hierarchy item', v => v instanceof types.CallHierarchyItem, typeConverters.CallHierarchyItem.to);

	constructor(
		readonly name: string,
		readonly description: string,
		readonly validate: (v: V) => boolean,
		readonly convert: (v: V) => O
	) { }
}

export class ApiCommandResult<V, O = V> {

	constructor(
		readonly description: string,
		readonly convert: (v: V, apiArgs: any[]) => O
	) { }
}

export class ApiCommand {

	constructor(
		readonly id: string,
		readonly internalId: string,
		readonly description: string,
		readonly args: ApiCommandArgument<any, any>[],
		readonly result: ApiCommandResult<any, any>
	) { }

	register(commands: ExtHostCommands): IDisposable {

		return commands.registerCommand(false, this.id, async (...apiArgs) => {

			const internalArgs = this.args.map((arg, i) => {
				if (!arg.validate(apiArgs[i])) {
					throw new Error(`Invalid argument '${arg.name}' when running '${this.id}', receieved: ${apiArgs[i]}`);
				}
				return arg.convert(apiArgs[i]);
			});

			const internalResult = await commands.executeCommand(this.internalId, ...internalArgs);
			return this.result.convert(internalResult, apiArgs);
		}, undefined, this._getCommandHandlerDesc());
	}

	private _getCommandHandlerDesc(): ICommandHandlerDescription {
		return {
			description: this.description,
			args: this.args,
			returns: this.result.description
		};
	}
}


const newCommands: ApiCommand[] = [
	// -- document highlights
	new ApiCommand(
		'vscode.executeDocumentHighlights', '_executeDocumentHighlights', 'Execute document highlight provider.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position],
		new ApiCommandResult<modes.DocumentHighlight[], types.DocumentHighlight[] | undefined>('A promise that resolves to an array of SymbolInformation and DocumentSymbol instances.', tryMapWith(typeConverters.DocumentHighlight.to))
	),
	// -- document symbols
	new ApiCommand(
		'vscode.executeDocumentSymbolProvider', '_executeDocumentSymbolProvider', 'Execute document symbol provider.',
		[ApiCommandArgument.Uri],
		new ApiCommandResult<modes.DocumentSymbol[], vscode.SymbolInformation[] | undefined>('A promise that resolves to an array of DocumentHighlight-instances.', (value, apiArgs) => {

			if (isFalsyOrEmpty(value)) {
				return undefined;
			}
			class MergedInfo extends types.SymbolInformation implements vscode.DocumentSymbol {
				static to(symbol: modes.DocumentSymbol): MergedInfo {
					const res = new MergedInfo(
						symbol.name,
						typeConverters.SymbolKind.to(symbol.kind),
						symbol.containerName || '',
						new types.Location(apiArgs[0], typeConverters.Range.to(symbol.range))
					);
					res.detail = symbol.detail;
					res.range = res.location.range;
					res.selectionRange = typeConverters.Range.to(symbol.selectionRange);
					res.children = symbol.children ? symbol.children.map(MergedInfo.to) : [];
					return res;
				}

				detail!: string;
				range!: vscode.Range;
				selectionRange!: vscode.Range;
				children!: vscode.DocumentSymbol[];
				containerName!: string;
			}
			return value.map(MergedInfo.to);

		})
	),
	// -- formatting
	new ApiCommand(
		'vscode.executeFormatDocumentProvider', '_executeFormatDocumentProvider', 'Execute document format provider.',
		[ApiCommandArgument.Uri, new ApiCommandArgument('options', 'Formatting options', _ => true, v => v)],
		new ApiCommandResult<modes.TextEdit[], types.TextEdit[] | undefined>('A promise that resolves to an array of TextEdits.', tryMapWith(typeConverters.TextEdit.to))
	),
	new ApiCommand(
		'vscode.executeFormatRangeProvider', '_executeFormatRangeProvider', 'Execute range format provider.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Range, new ApiCommandArgument('options', 'Formatting options', _ => true, v => v)],
		new ApiCommandResult<modes.TextEdit[], types.TextEdit[] | undefined>('A promise that resolves to an array of TextEdits.', tryMapWith(typeConverters.TextEdit.to))
	),
	new ApiCommand(
		'vscode.executeFormatOnTypeProvider', '_executeFormatOnTypeProvider', 'Execute format on type provider.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position, new ApiCommandArgument('ch', 'Trigger character', v => typeof v === 'string', v => v), new ApiCommandArgument('options', 'Formatting options', _ => true, v => v)],
		new ApiCommandResult<modes.TextEdit[], types.TextEdit[] | undefined>('A promise that resolves to an array of TextEdits.', tryMapWith(typeConverters.TextEdit.to))
	),
	// -- go to symbol (definition, type definition, declaration, impl, references)
	new ApiCommand(
		'vscode.executeDefinitionProvider', '_executeDefinitionProvider', 'Execute all definition providers.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position],
		new ApiCommandResult<(modes.Location | modes.LocationLink)[], (types.Location | vscode.LocationLink)[] | undefined>('A promise that resolves to an array of Location or LocationLink instances.', mapLocationOrLocationLink)
	),
	new ApiCommand(
		'vscode.executeTypeDefinitionProvider', '_executeTypeDefinitionProvider', 'Execute all type definition providers.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position],
		new ApiCommandResult<(modes.Location | modes.LocationLink)[], (types.Location | vscode.LocationLink)[] | undefined>('A promise that resolves to an array of Location or LocationLink instances.', mapLocationOrLocationLink)
	),
	new ApiCommand(
		'vscode.executeDeclarationProvider', '_executeDeclarationProvider', 'Execute all declaration providers.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position],
		new ApiCommandResult<(modes.Location | modes.LocationLink)[], (types.Location | vscode.LocationLink)[] | undefined>('A promise that resolves to an array of Location or LocationLink instances.', mapLocationOrLocationLink)
	),
	new ApiCommand(
		'vscode.executeImplementationProvider', '_executeImplementationProvider', 'Execute all implementation providers.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position],
		new ApiCommandResult<(modes.Location | modes.LocationLink)[], (types.Location | vscode.LocationLink)[] | undefined>('A promise that resolves to an array of Location or LocationLink instances.', mapLocationOrLocationLink)
	),
	new ApiCommand(
		'vscode.executeReferenceProvider', '_executeReferenceProvider', 'Execute all reference providers.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position],
		new ApiCommandResult<modes.Location[], types.Location[] | undefined>('A promise that resolves to an array of Location-instances.', tryMapWith(typeConverters.location.to))
	),
	// -- hover
	new ApiCommand(
		'vscode.executeHoverProvider', '_executeHoverProvider', 'Execute all hover providers.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position],
		new ApiCommandResult<modes.Hover[], types.Hover[] | undefined>('A promise that resolves to an array of Hover-instances.', tryMapWith(typeConverters.Hover.to))
	),
	// -- selection range
	new ApiCommand(
		'vscode.executeSelectionRangeProvider', '_executeSelectionRangeProvider', 'Execute selection range provider.',
		[ApiCommandArgument.Uri, new ApiCommandArgument<types.Position[], IPosition[]>('position', 'A positions in a text document', v => Array.isArray(v) && v.every(v => types.Position.isPosition(v)), v => v.map(typeConverters.Position.from))],
		new ApiCommandResult<IRange[][], types.SelectionRange[]>('A promise that resolves to an array of ranges.', result => {
			return result.map(ranges => {
				let node: types.SelectionRange | undefined;
				for (const range of ranges.reverse()) {
					node = new types.SelectionRange(typeConverters.Range.to(range), node);
				}
				return node!;
			});
		})
	),
	// -- symbol search
	new ApiCommand(
		'vscode.executeWorkspaceSymbolProvider', '_executeWorkspaceSymbolProvider', 'Execute all workspace symbol providers.',
		[new ApiCommandArgument('query', 'Search string', v => typeof v === 'string', v => v)],
		new ApiCommandResult<[search.IWorkspaceSymbolProvider, search.IWorkspaceSymbol[]][], types.SymbolInformation[]>('A promise that resolves to an array of SymbolInformation-instances.', value => {
			const result: types.SymbolInformation[] = [];
			if (Array.isArray(value)) {
				for (let tuple of value) {
					result.push(...tuple[1].map(typeConverters.WorkspaceSymbol.to));
				}
			}
			return result;
		})
	),
	// --- call hierarchy
	new ApiCommand(
		'vscode.prepareCallHierarchy', '_executePrepareCallHierarchy', 'Prepare call hierarchy at a position inside a document',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position],
		new ApiCommandResult<ICallHierarchyItemDto[], types.CallHierarchyItem[]>('A CallHierarchyItem or undefined', v => v.map(typeConverters.CallHierarchyItem.to))
	),
	new ApiCommand(
		'vscode.provideIncomingCalls', '_executeProvideIncomingCalls', 'Compute incoming calls for an item',
		[ApiCommandArgument.CallHierarchyItem],
		new ApiCommandResult<IIncomingCallDto[], types.CallHierarchyIncomingCall[]>('A CallHierarchyItem or undefined', v => v.map(typeConverters.CallHierarchyIncomingCall.to))
	),
	new ApiCommand(
		'vscode.provideOutgoingCalls', '_executeProvideOutgoingCalls', 'Compute outgoing calls for an item',
		[ApiCommandArgument.CallHierarchyItem],
		new ApiCommandResult<IOutgoingCallDto[], types.CallHierarchyOutgoingCall[]>('A CallHierarchyItem or undefined', v => v.map(typeConverters.CallHierarchyOutgoingCall.to))
	),
	// --- rename
	new ApiCommand(
		'vscode.executeDocumentRenameProvider', '_executeDocumentRenameProvider', 'Execute rename provider.',
		[ApiCommandArgument.Uri, ApiCommandArgument.Position, new ApiCommandArgument('newName', 'The new symbol name', v => typeof v === 'string', v => v)],
		new ApiCommandResult<IWorkspaceEditDto, types.WorkspaceEdit | undefined>('A promise that resolves to a WorkspaceEdit.', value => {
			if (!value) {
				return undefined;
			}
			if (value.rejectReason) {
				throw new Error(value.rejectReason);
			}
			return typeConverters.WorkspaceEdit.to(value);
		})
	)
];


//#endregion


//#region OLD world

export class ExtHostApiCommands {

	static register(commands: ExtHostCommands) {
		newCommands.forEach(command => command.register(commands));
		return new ExtHostApiCommands(commands).registerCommands();
	}

	private _commands: ExtHostCommands;
	private readonly _disposables = new DisposableStore();

	private constructor(commands: ExtHostCommands) {
		this._commands = commands;
	}

	registerCommands() {
		this._register('vscode.executeSignatureHelpProvider', this._executeSignatureHelpProvider, {
			description: 'Execute signature help provider.',
			args: [
				{ name: 'uri', description: 'Uri of a text document', constraint: URI },
				{ name: 'position', description: 'Position in a text document', constraint: types.Position },
				{ name: 'triggerCharacter', description: '(optional) Trigger signature help when the user types the character, like `,` or `(`', constraint: (value: any) => value === undefined || typeof value === 'string' }
			],
			returns: 'A promise that resolves to SignatureHelp.'
		});
		this._register('vscode.executeCompletionItemProvider', this._executeCompletionItemProvider, {
			description: 'Execute completion item provider.',
			args: [
				{ name: 'uri', description: 'Uri of a text document', constraint: URI },
				{ name: 'position', description: 'Position in a text document', constraint: types.Position },
				{ name: 'triggerCharacter', description: '(optional) Trigger completion when the user types the character, like `,` or `(`', constraint: (value: any) => value === undefined || typeof value === 'string' },
				{ name: 'itemResolveCount', description: '(optional) Number of completions to resolve (too large numbers slow down completions)', constraint: (value: any) => value === undefined || typeof value === 'number' }
			],
			returns: 'A promise that resolves to a CompletionList-instance.'
		});
		this._register('vscode.executeCodeActionProvider', this._executeCodeActionProvider, {
			description: 'Execute code action provider.',
			args: [
				{ name: 'uri', description: 'Uri of a text document', constraint: URI },
				{ name: 'rangeOrSelection', description: 'Range in a text document. Some refactoring provider requires Selection object.', constraint: types.Range },
				{ name: 'kind', description: '(optional) Code action kind to return code actions for', constraint: (value: any) => !value || typeof value.value === 'string' },
			],
			returns: 'A promise that resolves to an array of Command-instances.'
		});
		this._register('vscode.executeCodeLensProvider', this._executeCodeLensProvider, {
			description: 'Execute CodeLens provider.',
			args: [
				{ name: 'uri', description: 'Uri of a text document', constraint: URI },
				{ name: 'itemResolveCount', description: '(optional) Number of lenses that should be resolved and returned. Will only return resolved lenses, will impact performance)', constraint: (value: any) => value === undefined || typeof value === 'number' }
			],
			returns: 'A promise that resolves to an array of CodeLens-instances.'
		});

		this._register('vscode.executeLinkProvider', this._executeDocumentLinkProvider, {
			description: 'Execute document link provider.',
			args: [
				{ name: 'uri', description: 'Uri of a text document', constraint: URI }
			],
			returns: 'A promise that resolves to an array of DocumentLink-instances.'
		});
		this._register('vscode.executeDocumentColorProvider', this._executeDocumentColorProvider, {
			description: 'Execute document color provider.',
			args: [
				{ name: 'uri', description: 'Uri of a text document', constraint: URI },
			],
			returns: 'A promise that resolves to an array of ColorInformation objects.'
		});
		this._register('vscode.executeColorPresentationProvider', this._executeColorPresentationProvider, {
			description: 'Execute color presentation provider.',
			args: [
				{ name: 'color', description: 'The color to show and insert', constraint: types.Color },
				{ name: 'context', description: 'Context object with uri and range' }
			],
			returns: 'A promise that resolves to an array of ColorPresentation objects.'
		});

		// -----------------------------------------------------------------
		// The following commands are registered on both sides separately.
		//
		// We are trying to maintain backwards compatibility for cases where
		// API commands are encoded as markdown links, for example.
		// -----------------------------------------------------------------

		type ICommandHandler = (...args: any[]) => any;
		const adjustHandler = (handler: (executor: ICommandsExecutor, ...args: any[]) => any): ICommandHandler => {
			return (...args: any[]) => {
				return handler(this._commands, ...args);
			};
		};

		this._register(OpenFolderAPICommand.ID, adjustHandler(OpenFolderAPICommand.execute), {
			description: 'Open a folder or workspace in the current window or new window depending on the newWindow argument. Note that opening in the same window will shutdown the current extension host process and start a new one on the given folder/workspace unless the newWindow parameter is set to true.',
			args: [
				{ name: 'uri', description: '(optional) Uri of the folder or workspace file to open. If not provided, a native dialog will ask the user for the folder', constraint: (value: any) => value === undefined || URI.isUri(value) },
				{ name: 'options', description: '(optional) Options. Object with the following properties: `forceNewWindow `: Whether to open the folder/workspace in a new window or the same. Defaults to opening in the same window. `noRecentEntry`: Whether the opened URI will appear in the \'Open Recent\' list. Defaults to true. Note, for backward compatibility, options can also be of type boolean, representing the `forceNewWindow` setting.', constraint: (value: any) => value === undefined || typeof value === 'object' || typeof value === 'boolean' }
			]
		});

		this._register(DiffAPICommand.ID, adjustHandler(DiffAPICommand.execute), {
			description: 'Opens the provided resources in the diff editor to compare their contents.',
			args: [
				{ name: 'left', description: 'Left-hand side resource of the diff editor', constraint: URI },
				{ name: 'right', description: 'Right-hand side resource of the diff editor', constraint: URI },
				{ name: 'title', description: '(optional) Human readable title for the diff editor', constraint: (v: any) => v === undefined || typeof v === 'string' },
				{ name: 'options', description: '(optional) Editor options, see vscode.TextDocumentShowOptions' }
			]
		});

		this._register(OpenAPICommand.ID, adjustHandler(OpenAPICommand.execute), {
			description: 'Opens the provided resource in the editor. Can be a text or binary file, or a http(s) url. If you need more control over the options for opening a text file, use vscode.window.showTextDocument instead.',
			args: [
				{ name: 'resource', description: 'Resource to open', constraint: URI },
				{ name: 'columnOrOptions', description: '(optional) Either the column in which to open or editor options, see vscode.TextDocumentShowOptions', constraint: (v: any) => v === undefined || typeof v === 'number' || typeof v === 'object' }
			]
		});

		this._register(RemoveFromRecentlyOpenedAPICommand.ID, adjustHandler(RemoveFromRecentlyOpenedAPICommand.execute), {
			description: 'Removes an entry with the given path from the recently opened list.',
			args: [
				{ name: 'path', description: 'Path to remove from recently opened.', constraint: (value: any) => typeof value === 'string' }
			]
		});

		this._register(SetEditorLayoutAPICommand.ID, adjustHandler(SetEditorLayoutAPICommand.execute), {
			description: 'Sets the editor layout. The layout is described as object with an initial (optional) orientation (0 = horizontal, 1 = vertical) and an array of editor groups within. Each editor group can have a size and another array of editor groups that will be laid out orthogonal to the orientation. If editor group sizes are provided, their sum must be 1 to be applied per row or column. Example for a 2x2 grid: `{ orientation: 0, groups: [{ groups: [{}, {}], size: 0.5 }, { groups: [{}, {}], size: 0.5 }] }`',
			args: [
				{ name: 'layout', description: 'The editor layout to set.', constraint: (value: EditorGroupLayout) => typeof value === 'object' && Array.isArray(value.groups) }
			]
		});

		this._register(OpenIssueReporter.ID, adjustHandler(OpenIssueReporter.execute), {
			description: 'Opens the issue reporter with the provided extension id as the selected source',
			args: [
				{ name: 'extensionId', description: 'extensionId to report an issue on', constraint: (value: unknown) => typeof value === 'string' || (typeof value === 'object' && typeof (value as OpenIssueReporterArgs).extensionId === 'string') }
			]
		});
	}

	// --- command impl

	private _register(id: string, handler: (...args: any[]) => any, description?: ICommandHandlerDescription): void {
		const disposable = this._commands.registerCommand(false, id, handler, this, description);
		this._disposables.add(disposable);
	}

	private _executeSignatureHelpProvider(resource: URI, position: types.Position, triggerCharacter: string): Promise<types.SignatureHelp | undefined> {
		const args = {
			resource,
			position: position && typeConverters.Position.from(position),
			triggerCharacter
		};
		return this._commands.executeCommand<modes.SignatureHelp>('_executeSignatureHelpProvider', args).then(value => {
			if (value) {
				return typeConverters.SignatureHelp.to(value);
			}
			return undefined;
		});
	}

	private _executeCompletionItemProvider(resource: URI, position: types.Position, triggerCharacter: string, maxItemsToResolve: number): Promise<types.CompletionList | undefined> {
		const args = {
			resource,
			position: position && typeConverters.Position.from(position),
			triggerCharacter,
			maxItemsToResolve
		};
		return this._commands.executeCommand<modes.CompletionList>('_executeCompletionItemProvider', args).then(result => {
			if (result) {
				const items = result.suggestions.map(suggestion => typeConverters.CompletionItem.to(suggestion, this._commands.converter));
				return new types.CompletionList(items, result.incomplete);
			}
			return undefined;
		});
	}

	private _executeDocumentColorProvider(resource: URI): Promise<types.ColorInformation[]> {
		const args = {
			resource
		};
		return this._commands.executeCommand<IRawColorInfo[]>('_executeDocumentColorProvider', args).then(result => {
			if (result) {
				return result.map(ci => ({ range: typeConverters.Range.to(ci.range), color: typeConverters.Color.to(ci.color) }));
			}
			return [];
		});
	}

	private _executeColorPresentationProvider(color: types.Color, context: { uri: URI, range: types.Range; }): Promise<types.ColorPresentation[]> {
		const args = {
			resource: context.uri,
			color: typeConverters.Color.from(color),
			range: typeConverters.Range.from(context.range),
		};
		return this._commands.executeCommand<modes.IColorPresentation[]>('_executeColorPresentationProvider', args).then(result => {
			if (result) {
				return result.map(typeConverters.ColorPresentation.to);
			}
			return [];
		});
	}


	private _executeCodeActionProvider(resource: URI, rangeOrSelection: types.Range | types.Selection, kind?: string): Promise<(vscode.CodeAction | vscode.Command | undefined)[] | undefined> {
		const args = {
			resource,
			rangeOrSelection: types.Selection.isSelection(rangeOrSelection)
				? typeConverters.Selection.from(rangeOrSelection)
				: typeConverters.Range.from(rangeOrSelection),
			kind
		};
		return this._commands.executeCommand<CustomCodeAction[]>('_executeCodeActionProvider', args)
			.then(tryMapWith(codeAction => {
				if (codeAction._isSynthetic) {
					if (!codeAction.command) {
						throw new Error('Synthetic code actions must have a command');
					}
					return this._commands.converter.fromInternal(codeAction.command);
				} else {
					const ret = new types.CodeAction(
						codeAction.title,
						codeAction.kind ? new types.CodeActionKind(codeAction.kind) : undefined
					);
					if (codeAction.edit) {
						ret.edit = typeConverters.WorkspaceEdit.to(codeAction.edit);
					}
					if (codeAction.command) {
						ret.command = this._commands.converter.fromInternal(codeAction.command);
					}
					ret.isPreferred = codeAction.isPreferred;
					return ret;
				}
			}));
	}

	private _executeCodeLensProvider(resource: URI, itemResolveCount: number): Promise<vscode.CodeLens[] | undefined> {
		const args = { resource, itemResolveCount };
		return this._commands.executeCommand<modes.CodeLens[]>('_executeCodeLensProvider', args)
			.then(tryMapWith(item => {
				return new types.CodeLens(
					typeConverters.Range.to(item.range),
					item.command ? this._commands.converter.fromInternal(item.command) : undefined);
			}));

	}

	private _executeDocumentLinkProvider(resource: URI): Promise<vscode.DocumentLink[] | undefined> {
		return this._commands.executeCommand<modes.ILink[]>('_executeLinkProvider', resource)
			.then(tryMapWith(typeConverters.DocumentLink.to));
	}
}

function tryMapWith<T, R>(f: (x: T) => R) {
	return (value: T[]) => {
		if (Array.isArray(value)) {
			return value.map(f);
		}
		return undefined;
	};
}

function mapLocationOrLocationLink(values: (modes.Location | modes.LocationLink)[]): (types.Location | vscode.LocationLink)[] | undefined {
	if (!Array.isArray(values)) {
		return undefined;
	}
	const result: (types.Location | vscode.LocationLink)[] = [];
	for (const item of values) {
		if (modes.isLocationLink(item)) {
			result.push(typeConverters.DefinitionLink.to(item));
		} else {
			result.push(typeConverters.location.to(item));
		}
	}
	return result;
}
