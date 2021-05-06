/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { setUnexpectedErrorHandler, errorHandler } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import * as types from 'vs/workbench/api/common/extHostTypes';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { TestRPCProtocol } from './testRPCProtocol';
import { MarkerService } from 'vs/platform/markers/common/markerService';
import { IMarkerService } from 'vs/platform/markers/common/markers';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ExtHostLanguageFeatures } from 'vs/workbench/api/common/extHostLanguageFeatures';
import { MainThreadLanguageFeatures } from 'vs/workbench/api/browser/mainThreadLanguageFeatures';
import { ExtHostApiCommands } from 'vs/workbench/api/common/extHostApiCommands';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { MainThreadCommands } from 'vs/workbench/api/browser/mainThreadCommands';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { MainContext, ExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostDiagnostics } from 'vs/workbench/api/common/extHostDiagnostics';
import type * as vscode from 'vscode';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import 'vs/workbench/contrib/search/browser/search.contribution';
import { NullLogService } from 'vs/platform/log/common/log';
import { ITextModel } from 'vs/editor/common/model';
import { nullExtensionDescription, IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { dispose, ImmortalReference } from 'vs/base/common/lifecycle';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { mock } from 'vs/base/test/common/mock';
import { NullApiDeprecationService } from 'vs/workbench/api/common/extHostApiDeprecationService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { IResolvedTextEditorModel, ITextModelService } from 'vs/editor/common/services/resolverService';

import 'vs/editor/contrib/codeAction/codeAction';
import 'vs/editor/contrib/codelens/codelens';
import 'vs/editor/contrib/colorPicker/color';
import 'vs/editor/contrib/format/format';
import 'vs/editor/contrib/gotoSymbol/goToCommands';
import 'vs/editor/contrib/documentSymbols/documentSymbols';
import 'vs/editor/contrib/hover/getHover';
import 'vs/editor/contrib/links/getLinks';
import 'vs/editor/contrib/parameterHints/provideSignatureHelp';
import 'vs/editor/contrib/smartSelect/smartSelect';
import 'vs/editor/contrib/suggest/suggest';
import 'vs/editor/contrib/rename/rename';
import 'vs/editor/contrib/inlayHints/inlayHintsController';

const defaultSelector = { scheme: 'far' };
const model: ITextModel = createTextModel(
	[
		'This is the first line',
		'This is the second line',
		'This is the third line',
	].join('\n'),
	undefined,
	undefined,
	URI.parse('far://testing/file.b'));

let rpcProtocol: TestRPCProtocol;
let extHost: ExtHostLanguageFeatures;
let mainThread: MainThreadLanguageFeatures;
let commands: ExtHostCommands;
let disposables: vscode.Disposable[] = [];
let originalErrorHandler: (e: any) => any;

function assertRejects(fn: () => Promise<any>, message: string = 'Expected rejection') {
	return fn().then(() => assert.ok(false, message), _err => assert.ok(true));
}

function isLocation(value: vscode.Location | vscode.LocationLink): value is vscode.Location {
	const candidate = value as vscode.Location;
	return candidate && candidate.uri instanceof URI && candidate.range instanceof types.Range;
}

suite('ExtHostLanguageFeatureCommands', function () {

	suiteSetup(() => {

		originalErrorHandler = errorHandler.getUnexpectedErrorHandler();
		setUnexpectedErrorHandler(() => { });

		// Use IInstantiationService to get typechecking when instantiating
		let insta: IInstantiationService;
		rpcProtocol = new TestRPCProtocol();
		const services = new ServiceCollection();
		services.set(IExtensionService, new class extends mock<IExtensionService>() {
			override async activateByEvent() {

			}

		});
		services.set(ICommandService, new SyncDescriptor(class extends mock<ICommandService>() {

			override executeCommand(id: string, ...args: any): any {
				const command = CommandsRegistry.getCommands().get(id);
				if (!command) {
					return Promise.reject(new Error(id + ' NOT known'));
				}
				const { handler } = command;
				return Promise.resolve(insta.invokeFunction(handler, ...args));
			}
		}));
		services.set(IMarkerService, new MarkerService());
		services.set(IModelService, new class extends mock<IModelService>() {
			override getModel() { return model; }
		});
		services.set(ITextModelService, new class extends mock<ITextModelService>() {
			override async createModelReference() {
				return new ImmortalReference<IResolvedTextEditorModel>(new class extends mock<IResolvedTextEditorModel>() {
					override textEditorModel = model;
				});
			}
		});
		services.set(IEditorWorkerService, new class extends mock<IEditorWorkerService>() {
			override async computeMoreMinimalEdits(_uri: any, edits: any) {
				return edits || undefined;
			}
		});

		insta = new InstantiationService(services);

		const extHostDocumentsAndEditors = new ExtHostDocumentsAndEditors(rpcProtocol, new NullLogService());
		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({
			addedDocuments: [{
				isDirty: false,
				versionId: model.getVersionId(),
				modeId: model.getLanguageIdentifier().language,
				uri: model.uri,
				lines: model.getValue().split(model.getEOL()),
				EOL: model.getEOL(),
			}]
		});
		const extHostDocuments = new ExtHostDocuments(rpcProtocol, extHostDocumentsAndEditors);
		rpcProtocol.set(ExtHostContext.ExtHostDocuments, extHostDocuments);

		commands = new ExtHostCommands(rpcProtocol, new NullLogService());
		rpcProtocol.set(ExtHostContext.ExtHostCommands, commands);
		rpcProtocol.set(MainContext.MainThreadCommands, insta.createInstance(MainThreadCommands, rpcProtocol));
		ExtHostApiCommands.register(commands);

		const diagnostics = new ExtHostDiagnostics(rpcProtocol, new NullLogService());
		rpcProtocol.set(ExtHostContext.ExtHostDiagnostics, diagnostics);

		extHost = new ExtHostLanguageFeatures(rpcProtocol, null, extHostDocuments, commands, diagnostics, new NullLogService(), NullApiDeprecationService);
		rpcProtocol.set(ExtHostContext.ExtHostLanguageFeatures, extHost);

		mainThread = rpcProtocol.set(MainContext.MainThreadLanguageFeatures, insta.createInstance(MainThreadLanguageFeatures, rpcProtocol));

		return rpcProtocol.sync();
	});

	suiteTeardown(() => {
		setUnexpectedErrorHandler(originalErrorHandler);
		model.dispose();
		mainThread.dispose();
	});

	teardown(() => {
		disposables = dispose(disposables);
		return rpcProtocol.sync();
	});

	// --- workspace symbols

	test('WorkspaceSymbols, invalid arguments', function () {
		let promises = [
			assertRejects(() => commands.executeCommand('vscode.executeWorkspaceSymbolProvider')),
			assertRejects(() => commands.executeCommand('vscode.executeWorkspaceSymbolProvider', null)),
			assertRejects(() => commands.executeCommand('vscode.executeWorkspaceSymbolProvider', undefined)),
			assertRejects(() => commands.executeCommand('vscode.executeWorkspaceSymbolProvider', true))
		];
		return Promise.all(promises);
	});

	test('WorkspaceSymbols, back and forth', function () {

		disposables.push(extHost.registerWorkspaceSymbolProvider(nullExtensionDescription, <vscode.WorkspaceSymbolProvider>{
			provideWorkspaceSymbols(query): any {
				return [
					new types.SymbolInformation(query, types.SymbolKind.Array, new types.Range(0, 0, 1, 1), URI.parse('far://testing/first')),
					new types.SymbolInformation(query, types.SymbolKind.Array, new types.Range(0, 0, 1, 1), URI.parse('far://testing/second'))
				];
			}
		}));

		disposables.push(extHost.registerWorkspaceSymbolProvider(nullExtensionDescription, <vscode.WorkspaceSymbolProvider>{
			provideWorkspaceSymbols(query): any {
				return [
					new types.SymbolInformation(query, types.SymbolKind.Array, new types.Range(0, 0, 1, 1), URI.parse('far://testing/first'))
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', 'testing').then(value => {

				for (let info of value) {
					assert.strictEqual(info instanceof types.SymbolInformation, true);
					assert.strictEqual(info.name, 'testing');
					assert.strictEqual(info.kind, types.SymbolKind.Array);
				}
				assert.strictEqual(value.length, 3);
			});
		});
	});

	test('executeWorkspaceSymbolProvider should accept empty string, #39522', async function () {

		disposables.push(extHost.registerWorkspaceSymbolProvider(nullExtensionDescription, {
			provideWorkspaceSymbols(): vscode.SymbolInformation[] {
				return [new types.SymbolInformation('hello', types.SymbolKind.Array, new types.Range(0, 0, 0, 0), URI.parse('foo:bar')) as vscode.SymbolInformation];
			}
		}));

		await rpcProtocol.sync();
		let symbols = await commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', '');
		assert.strictEqual(symbols.length, 1);

		await rpcProtocol.sync();
		symbols = await commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', '*');
		assert.strictEqual(symbols.length, 1);
	});

	// --- formatting
	test('executeFormatDocumentProvider, back and forth', async function () {

		disposables.push(extHost.registerDocumentFormattingEditProvider(nullExtensionDescription, defaultSelector, new class implements vscode.DocumentFormattingEditProvider {
			provideDocumentFormattingEdits() {
				return [types.TextEdit.insert(new types.Position(0, 0), '42')];
			}
		}));

		await rpcProtocol.sync();
		let edits = await commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeFormatDocumentProvider', model.uri);
		assert.strictEqual(edits.length, 1);
	});


	// --- rename
	test('vscode.executeDocumentRenameProvider', async function () {
		disposables.push(extHost.registerRenameProvider(nullExtensionDescription, defaultSelector, new class implements vscode.RenameProvider {
			provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string) {
				const edit = new types.WorkspaceEdit();
				edit.insert(document.uri, <types.Position>position, newName);
				return edit;
			}
		}));

		await rpcProtocol.sync();

		const edit = await commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', model.uri, new types.Position(0, 12), 'newNameOfThis');

		assert.ok(edit);
		assert.strictEqual(edit.has(model.uri), true);
		const textEdits = edit.get(model.uri);
		assert.strictEqual(textEdits.length, 1);
		assert.strictEqual(textEdits[0].newText, 'newNameOfThis');
	});

	// --- definition

	test('Definition, invalid arguments', function () {
		let promises = [
			assertRejects(() => commands.executeCommand('vscode.executeDefinitionProvider')),
			assertRejects(() => commands.executeCommand('vscode.executeDefinitionProvider', null)),
			assertRejects(() => commands.executeCommand('vscode.executeDefinitionProvider', undefined)),
			assertRejects(() => commands.executeCommand('vscode.executeDefinitionProvider', true, false))
		];

		return Promise.all(promises);
	});

	test('Definition, back and forth', function () {

		disposables.push(extHost.registerDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(doc: any): any {
				return new types.Location(doc.uri, new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(doc: any): any {
				// duplicate result will get removed
				return new types.Location(doc.uri, new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(doc: any): any {
				return [
					new types.Location(doc.uri, new types.Range(2, 0, 0, 0)),
					new types.Location(doc.uri, new types.Range(3, 0, 0, 0)),
					new types.Location(doc.uri, new types.Range(4, 0, 0, 0)),
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 4);
				for (let v of values) {
					assert.ok(v.uri instanceof URI);
					assert.ok(v.range instanceof types.Range);
				}
			});
		});
	});


	test('Definition, back and forth (sorting & de-deduping)', function () {

		disposables.push(extHost.registerDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(doc: any): any {
				return new types.Location(URI.parse('file:///b'), new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(doc: any): any {
				// duplicate result will get removed
				return new types.Location(URI.parse('file:///b'), new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(doc: any): any {
				return [
					new types.Location(URI.parse('file:///a'), new types.Range(2, 0, 0, 0)),
					new types.Location(URI.parse('file:///c'), new types.Range(3, 0, 0, 0)),
					new types.Location(URI.parse('file:///d'), new types.Range(4, 0, 0, 0)),
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 4);

				assert.strictEqual(values[0].uri.path, '/a');
				assert.strictEqual(values[1].uri.path, '/b');
				assert.strictEqual(values[2].uri.path, '/c');
				assert.strictEqual(values[3].uri.path, '/d');
			});
		});
	});

	test('Definition Link', () => {
		disposables.push(extHost.registerDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(doc: any): (vscode.Location | vscode.LocationLink)[] {
				return [
					new types.Location(doc.uri, new types.Range(0, 0, 0, 0)),
					{ targetUri: doc.uri, targetRange: new types.Range(1, 0, 0, 0), targetSelectionRange: new types.Range(1, 1, 1, 1), originSelectionRange: new types.Range(2, 2, 2, 2) }
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 2);
				for (let v of values) {
					if (isLocation(v)) {
						assert.ok(v.uri instanceof URI);
						assert.ok(v.range instanceof types.Range);
					} else {
						assert.ok(v.targetUri instanceof URI);
						assert.ok(v.targetRange instanceof types.Range);
						assert.ok(v.targetSelectionRange instanceof types.Range);
						assert.ok(v.originSelectionRange instanceof types.Range);
					}
				}
			});
		});
	});

	// --- declaration

	test('Declaration, back and forth', function () {

		disposables.push(extHost.registerDeclarationProvider(nullExtensionDescription, defaultSelector, <vscode.DeclarationProvider>{
			provideDeclaration(doc: any): any {
				return new types.Location(doc.uri, new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerDeclarationProvider(nullExtensionDescription, defaultSelector, <vscode.DeclarationProvider>{
			provideDeclaration(doc: any): any {
				// duplicate result will get removed
				return new types.Location(doc.uri, new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerDeclarationProvider(nullExtensionDescription, defaultSelector, <vscode.DeclarationProvider>{
			provideDeclaration(doc: any): any {
				return [
					new types.Location(doc.uri, new types.Range(2, 0, 0, 0)),
					new types.Location(doc.uri, new types.Range(3, 0, 0, 0)),
					new types.Location(doc.uri, new types.Range(4, 0, 0, 0)),
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.Location[]>('vscode.executeDeclarationProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 4);
				for (let v of values) {
					assert.ok(v.uri instanceof URI);
					assert.ok(v.range instanceof types.Range);
				}
			});
		});
	});

	test('Declaration Link', () => {
		disposables.push(extHost.registerDeclarationProvider(nullExtensionDescription, defaultSelector, <vscode.DeclarationProvider>{
			provideDeclaration(doc: any): (vscode.Location | vscode.LocationLink)[] {
				return [
					new types.Location(doc.uri, new types.Range(0, 0, 0, 0)),
					{ targetUri: doc.uri, targetRange: new types.Range(1, 0, 0, 0), targetSelectionRange: new types.Range(1, 1, 1, 1), originSelectionRange: new types.Range(2, 2, 2, 2) }
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDeclarationProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 2);
				for (let v of values) {
					if (isLocation(v)) {
						assert.ok(v.uri instanceof URI);
						assert.ok(v.range instanceof types.Range);
					} else {
						assert.ok(v.targetUri instanceof URI);
						assert.ok(v.targetRange instanceof types.Range);
						assert.ok(v.targetSelectionRange instanceof types.Range);
						assert.ok(v.originSelectionRange instanceof types.Range);
					}
				}
			});
		});
	});

	// --- type definition

	test('Type Definition, invalid arguments', function () {
		const promises = [
			assertRejects(() => commands.executeCommand('vscode.executeTypeDefinitionProvider')),
			assertRejects(() => commands.executeCommand('vscode.executeTypeDefinitionProvider', null)),
			assertRejects(() => commands.executeCommand('vscode.executeTypeDefinitionProvider', undefined)),
			assertRejects(() => commands.executeCommand('vscode.executeTypeDefinitionProvider', true, false))
		];

		return Promise.all(promises);
	});

	test('Type Definition, back and forth', function () {

		disposables.push(extHost.registerTypeDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.TypeDefinitionProvider>{
			provideTypeDefinition(doc: any): any {
				return new types.Location(doc.uri, new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerTypeDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.TypeDefinitionProvider>{
			provideTypeDefinition(doc: any): any {
				// duplicate result will get removed
				return new types.Location(doc.uri, new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerTypeDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.TypeDefinitionProvider>{
			provideTypeDefinition(doc: any): any {
				return [
					new types.Location(doc.uri, new types.Range(2, 0, 0, 0)),
					new types.Location(doc.uri, new types.Range(3, 0, 0, 0)),
					new types.Location(doc.uri, new types.Range(4, 0, 0, 0)),
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.Location[]>('vscode.executeTypeDefinitionProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 4);
				for (const v of values) {
					assert.ok(v.uri instanceof URI);
					assert.ok(v.range instanceof types.Range);
				}
			});
		});
	});

	test('Type Definition Link', () => {
		disposables.push(extHost.registerTypeDefinitionProvider(nullExtensionDescription, defaultSelector, <vscode.TypeDefinitionProvider>{
			provideTypeDefinition(doc: any): (vscode.Location | vscode.LocationLink)[] {
				return [
					new types.Location(doc.uri, new types.Range(0, 0, 0, 0)),
					{ targetUri: doc.uri, targetRange: new types.Range(1, 0, 0, 0), targetSelectionRange: new types.Range(1, 1, 1, 1), originSelectionRange: new types.Range(2, 2, 2, 2) }
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeTypeDefinitionProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 2);
				for (let v of values) {
					if (isLocation(v)) {
						assert.ok(v.uri instanceof URI);
						assert.ok(v.range instanceof types.Range);
					} else {
						assert.ok(v.targetUri instanceof URI);
						assert.ok(v.targetRange instanceof types.Range);
						assert.ok(v.targetSelectionRange instanceof types.Range);
						assert.ok(v.originSelectionRange instanceof types.Range);
					}
				}
			});
		});
	});

	// --- implementation

	test('Implementation, invalid arguments', function () {
		const promises = [
			assertRejects(() => commands.executeCommand('vscode.executeImplementationProvider')),
			assertRejects(() => commands.executeCommand('vscode.executeImplementationProvider', null)),
			assertRejects(() => commands.executeCommand('vscode.executeImplementationProvider', undefined)),
			assertRejects(() => commands.executeCommand('vscode.executeImplementationProvider', true, false))
		];

		return Promise.all(promises);
	});

	test('Implementation, back and forth', function () {

		disposables.push(extHost.registerImplementationProvider(nullExtensionDescription, defaultSelector, <vscode.ImplementationProvider>{
			provideImplementation(doc: any): any {
				return new types.Location(doc.uri, new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerImplementationProvider(nullExtensionDescription, defaultSelector, <vscode.ImplementationProvider>{
			provideImplementation(doc: any): any {
				// duplicate result will get removed
				return new types.Location(doc.uri, new types.Range(1, 0, 0, 0));
			}
		}));
		disposables.push(extHost.registerImplementationProvider(nullExtensionDescription, defaultSelector, <vscode.ImplementationProvider>{
			provideImplementation(doc: any): any {
				return [
					new types.Location(doc.uri, new types.Range(2, 0, 0, 0)),
					new types.Location(doc.uri, new types.Range(3, 0, 0, 0)),
					new types.Location(doc.uri, new types.Range(4, 0, 0, 0)),
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.Location[]>('vscode.executeImplementationProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 4);
				for (const v of values) {
					assert.ok(v.uri instanceof URI);
					assert.ok(v.range instanceof types.Range);
				}
			});
		});
	});

	test('Implementation Definition Link', () => {
		disposables.push(extHost.registerImplementationProvider(nullExtensionDescription, defaultSelector, <vscode.ImplementationProvider>{
			provideImplementation(doc: any): (vscode.Location | vscode.LocationLink)[] {
				return [
					new types.Location(doc.uri, new types.Range(0, 0, 0, 0)),
					{ targetUri: doc.uri, targetRange: new types.Range(1, 0, 0, 0), targetSelectionRange: new types.Range(1, 1, 1, 1), originSelectionRange: new types.Range(2, 2, 2, 2) }
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeImplementationProvider', model.uri, new types.Position(0, 0)).then(values => {
				assert.strictEqual(values.length, 2);
				for (let v of values) {
					if (isLocation(v)) {
						assert.ok(v.uri instanceof URI);
						assert.ok(v.range instanceof types.Range);
					} else {
						assert.ok(v.targetUri instanceof URI);
						assert.ok(v.targetRange instanceof types.Range);
						assert.ok(v.targetSelectionRange instanceof types.Range);
						assert.ok(v.originSelectionRange instanceof types.Range);
					}
				}
			});
		});
	});

	// --- references

	test('reference search, back and forth', function () {

		disposables.push(extHost.registerReferenceProvider(nullExtensionDescription, defaultSelector, <vscode.ReferenceProvider>{
			provideReferences() {
				return [
					new types.Location(URI.parse('some:uri/path'), new types.Range(0, 1, 0, 5))
				];
			}
		}));

		return commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', model.uri, new types.Position(0, 0)).then(values => {
			assert.strictEqual(values.length, 1);
			let [first] = values;
			assert.strictEqual(first.uri.toString(), 'some:uri/path');
			assert.strictEqual(first.range.start.line, 0);
			assert.strictEqual(first.range.start.character, 1);
			assert.strictEqual(first.range.end.line, 0);
			assert.strictEqual(first.range.end.character, 5);
		});
	});

	// --- outline

	test('Outline, back and forth', function () {
		disposables.push(extHost.registerDocumentSymbolProvider(nullExtensionDescription, defaultSelector, <vscode.DocumentSymbolProvider>{
			provideDocumentSymbols(): any {
				return [
					new types.SymbolInformation('testing1', types.SymbolKind.Enum, new types.Range(1, 0, 1, 0)),
					new types.SymbolInformation('testing2', types.SymbolKind.Enum, new types.Range(0, 1, 0, 3)),
				];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeDocumentSymbolProvider', model.uri).then(values => {
				assert.strictEqual(values.length, 2);
				let [first, second] = values;
				assert.strictEqual(first instanceof types.SymbolInformation, true);
				assert.strictEqual(second instanceof types.SymbolInformation, true);
				assert.strictEqual(first.name, 'testing2');
				assert.strictEqual(second.name, 'testing1');
			});
		});
	});

	test('vscode.executeDocumentSymbolProvider command only returns SymbolInformation[] rather than DocumentSymbol[] #57984', function () {
		disposables.push(extHost.registerDocumentSymbolProvider(nullExtensionDescription, defaultSelector, <vscode.DocumentSymbolProvider>{
			provideDocumentSymbols(): any {
				return [
					new types.SymbolInformation('SymbolInformation', types.SymbolKind.Enum, new types.Range(1, 0, 1, 0))
				];
			}
		}));
		disposables.push(extHost.registerDocumentSymbolProvider(nullExtensionDescription, defaultSelector, <vscode.DocumentSymbolProvider>{
			provideDocumentSymbols(): any {
				let root = new types.DocumentSymbol('DocumentSymbol', 'DocumentSymbol#detail', types.SymbolKind.Enum, new types.Range(1, 0, 1, 0), new types.Range(1, 0, 1, 0));
				root.children = [new types.DocumentSymbol('DocumentSymbol#child', 'DocumentSymbol#detail#child', types.SymbolKind.Enum, new types.Range(1, 0, 1, 0), new types.Range(1, 0, 1, 0))];
				return [root];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<(vscode.SymbolInformation & vscode.DocumentSymbol)[]>('vscode.executeDocumentSymbolProvider', model.uri).then(values => {
				assert.strictEqual(values.length, 2);
				let [first, second] = values;
				assert.strictEqual(first instanceof types.SymbolInformation, true);
				assert.strictEqual(first instanceof types.DocumentSymbol, false);
				assert.strictEqual(second instanceof types.SymbolInformation, true);
				assert.strictEqual(first.name, 'DocumentSymbol');
				assert.strictEqual(first.children.length, 1);
				assert.strictEqual(second.name, 'SymbolInformation');
			});
		});
	});

	// --- suggest

	test('Suggest, back and forth', function () {
		disposables.push(extHost.registerCompletionItemProvider(nullExtensionDescription, defaultSelector, <vscode.CompletionItemProvider>{
			provideCompletionItems(): any {
				let a = new types.CompletionItem('item1');
				let b = new types.CompletionItem('item2');
				b.textEdit = types.TextEdit.replace(new types.Range(0, 4, 0, 8), 'foo'); // overwite after
				let c = new types.CompletionItem('item3');
				c.textEdit = types.TextEdit.replace(new types.Range(0, 1, 0, 6), 'foobar'); // overwite before & after

				// snippet string!
				let d = new types.CompletionItem('item4');
				d.range = new types.Range(0, 1, 0, 4);// overwite before
				d.insertText = new types.SnippetString('foo$0bar');
				return [a, b, c, d];
			}
		}, []));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', model.uri, new types.Position(0, 4)).then(list => {

				assert.ok(list instanceof types.CompletionList);
				let values = list.items;
				assert.ok(Array.isArray(values));
				assert.strictEqual(values.length, 4);
				let [first, second, third, fourth] = values;
				assert.strictEqual(first.label, 'item1');
				assert.strictEqual(first.textEdit, undefined);// no text edit, default ranges
				assert.ok(!types.Range.isRange(first.range));

				assert.strictEqual(second.label, 'item2');
				assert.strictEqual(second.textEdit!.newText, 'foo');
				assert.strictEqual(second.textEdit!.range.start.line, 0);
				assert.strictEqual(second.textEdit!.range.start.character, 4);
				assert.strictEqual(second.textEdit!.range.end.line, 0);
				assert.strictEqual(second.textEdit!.range.end.character, 8);

				assert.strictEqual(third.label, 'item3');
				assert.strictEqual(third.textEdit!.newText, 'foobar');
				assert.strictEqual(third.textEdit!.range.start.line, 0);
				assert.strictEqual(third.textEdit!.range.start.character, 1);
				assert.strictEqual(third.textEdit!.range.end.line, 0);
				assert.strictEqual(third.textEdit!.range.end.character, 6);

				assert.strictEqual(fourth.label, 'item4');
				assert.strictEqual(fourth.textEdit, undefined);

				const range: any = fourth.range!;
				assert.ok(types.Range.isRange(range));
				assert.strictEqual(range.start.line, 0);
				assert.strictEqual(range.start.character, 1);
				assert.strictEqual(range.end.line, 0);
				assert.strictEqual(range.end.character, 4);
				assert.ok(fourth.insertText instanceof types.SnippetString);
				assert.strictEqual((<types.SnippetString>fourth.insertText).value, 'foo$0bar');
			});
		});
	});

	test('Suggest, return CompletionList !array', function () {
		disposables.push(extHost.registerCompletionItemProvider(nullExtensionDescription, defaultSelector, <vscode.CompletionItemProvider>{
			provideCompletionItems(): any {
				let a = new types.CompletionItem('item1');
				let b = new types.CompletionItem('item2');
				return new types.CompletionList(<any>[a, b], true);
			}
		}, []));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', model.uri, new types.Position(0, 4)).then(list => {
				assert.ok(list instanceof types.CompletionList);
				assert.strictEqual(list.isIncomplete, true);
			});
		});
	});

	test('Suggest, resolve completion items', async function () {

		let resolveCount = 0;

		disposables.push(extHost.registerCompletionItemProvider(nullExtensionDescription, defaultSelector, <vscode.CompletionItemProvider>{
			provideCompletionItems(): any {
				let a = new types.CompletionItem('item1');
				let b = new types.CompletionItem('item2');
				let c = new types.CompletionItem('item3');
				let d = new types.CompletionItem('item4');
				return new types.CompletionList([a, b, c, d], false);
			},
			resolveCompletionItem(item) {
				resolveCount += 1;
				return item;
			}
		}, []));

		await rpcProtocol.sync();

		let list = await commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			model.uri,
			new types.Position(0, 4),
			undefined,
			2 // maxItemsToResolve
		);

		assert.ok(list instanceof types.CompletionList);
		assert.strictEqual(resolveCount, 2);

	});

	test('"vscode.executeCompletionItemProvider" doesnot return a preselect field #53749', async function () {
		disposables.push(extHost.registerCompletionItemProvider(nullExtensionDescription, defaultSelector, <vscode.CompletionItemProvider>{
			provideCompletionItems(): any {
				let a = new types.CompletionItem('item1');
				a.preselect = true;
				let b = new types.CompletionItem('item2');
				let c = new types.CompletionItem('item3');
				c.preselect = true;
				let d = new types.CompletionItem('item4');
				return new types.CompletionList([a, b, c, d], false);
			}
		}, []));

		await rpcProtocol.sync();

		let list = await commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			model.uri,
			new types.Position(0, 4),
			undefined
		);

		assert.ok(list instanceof types.CompletionList);
		assert.strictEqual(list.items.length, 4);

		let [a, b, c, d] = list.items;
		assert.strictEqual(a.preselect, true);
		assert.strictEqual(b.preselect, undefined);
		assert.strictEqual(c.preselect, true);
		assert.strictEqual(d.preselect, undefined);
	});

	test('executeCompletionItemProvider doesn\'t capture commitCharacters #58228', async function () {
		disposables.push(extHost.registerCompletionItemProvider(nullExtensionDescription, defaultSelector, <vscode.CompletionItemProvider>{
			provideCompletionItems(): any {
				let a = new types.CompletionItem('item1');
				a.commitCharacters = ['a', 'b'];
				let b = new types.CompletionItem('item2');
				return new types.CompletionList([a, b], false);
			}
		}, []));

		await rpcProtocol.sync();

		let list = await commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			model.uri,
			new types.Position(0, 4),
			undefined
		);

		assert.ok(list instanceof types.CompletionList);
		assert.strictEqual(list.items.length, 2);

		let [a, b] = list.items;
		assert.deepStrictEqual(a.commitCharacters, ['a', 'b']);
		assert.strictEqual(b.commitCharacters, undefined);
	});

	test('vscode.executeCompletionItemProvider returns the wrong CompletionItemKinds in insiders #95715', async function () {
		disposables.push(extHost.registerCompletionItemProvider(nullExtensionDescription, defaultSelector, <vscode.CompletionItemProvider>{
			provideCompletionItems(): any {
				return [
					new types.CompletionItem('My Method', types.CompletionItemKind.Method),
					new types.CompletionItem('My Property', types.CompletionItemKind.Property),
				];
			}
		}, []));

		await rpcProtocol.sync();

		let list = await commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			model.uri,
			new types.Position(0, 4),
			undefined
		);

		assert.ok(list instanceof types.CompletionList);
		assert.strictEqual(list.items.length, 2);

		const [a, b] = list.items;
		assert.strictEqual(a.kind, types.CompletionItemKind.Method);
		assert.strictEqual(b.kind, types.CompletionItemKind.Property);
	});

	// --- signatureHelp

	test('Parameter Hints, back and forth', async () => {
		disposables.push(extHost.registerSignatureHelpProvider(nullExtensionDescription, defaultSelector, new class implements vscode.SignatureHelpProvider {
			provideSignatureHelp(_document: vscode.TextDocument, _position: vscode.Position, _token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.SignatureHelp {
				return {
					activeSignature: 0,
					activeParameter: 1,
					signatures: [
						{
							label: 'abc',
							documentation: `${context.triggerKind === 1 /* vscode.SignatureHelpTriggerKind.Invoke */ ? 'invoked' : 'unknown'} ${context.triggerCharacter}`,
							parameters: []
						}
					]
				};
			}
		}, []));

		await rpcProtocol.sync();

		const firstValue = await commands.executeCommand<vscode.SignatureHelp>('vscode.executeSignatureHelpProvider', model.uri, new types.Position(0, 1), ',');
		assert.strictEqual(firstValue.activeSignature, 0);
		assert.strictEqual(firstValue.activeParameter, 1);
		assert.strictEqual(firstValue.signatures.length, 1);
		assert.strictEqual(firstValue.signatures[0].label, 'abc');
		assert.strictEqual(firstValue.signatures[0].documentation, 'invoked ,');
	});

	// --- quickfix

	test('QuickFix, back and forth', function () {
		disposables.push(extHost.registerCodeActionProvider(nullExtensionDescription, defaultSelector, {
			provideCodeActions(): vscode.Command[] {
				return [{ command: 'testing', title: 'Title', arguments: [1, 2, true] }];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.Command[]>('vscode.executeCodeActionProvider', model.uri, new types.Range(0, 0, 1, 1)).then(value => {
				assert.strictEqual(value.length, 1);
				let [first] = value;
				assert.strictEqual(first.title, 'Title');
				assert.strictEqual(first.command, 'testing');
				assert.deepStrictEqual(first.arguments, [1, 2, true]);
			});
		});
	});

	test('vscode.executeCodeActionProvider results seem to be missing their `command` property #45124', function () {
		disposables.push(extHost.registerCodeActionProvider(nullExtensionDescription, defaultSelector, {
			provideCodeActions(document, range): vscode.CodeAction[] {
				return [{
					command: {
						arguments: [document, range],
						command: 'command',
						title: 'command_title',
					},
					kind: types.CodeActionKind.Empty.append('foo'),
					title: 'title',
				}];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', model.uri, new types.Range(0, 0, 1, 1)).then(value => {
				assert.strictEqual(value.length, 1);
				const [first] = value;
				assert.ok(first.command);
				assert.strictEqual(first.command!.command, 'command');
				assert.strictEqual(first.command!.title, 'command_title');
				assert.strictEqual(first.kind!.value, 'foo');
				assert.strictEqual(first.title, 'title');

			});
		});
	});

	test('vscode.executeCodeActionProvider passes Range to provider although Selection is passed in #77997', function () {
		disposables.push(extHost.registerCodeActionProvider(nullExtensionDescription, defaultSelector, {
			provideCodeActions(document, rangeOrSelection): vscode.CodeAction[] {
				return [{
					command: {
						arguments: [document, rangeOrSelection],
						command: 'command',
						title: 'command_title',
					},
					kind: types.CodeActionKind.Empty.append('foo'),
					title: 'title',
				}];
			}
		}));

		const selection = new types.Selection(0, 0, 1, 1);

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', model.uri, selection).then(value => {
				assert.strictEqual(value.length, 1);
				const [first] = value;
				assert.ok(first.command);
				assert.ok(first.command!.arguments![1] instanceof types.Selection);
				assert.ok(first.command!.arguments![1].isEqual(selection));
			});
		});
	});

	test('vscode.executeCodeActionProvider results seem to be missing their `isPreferred` property #78098', function () {
		disposables.push(extHost.registerCodeActionProvider(nullExtensionDescription, defaultSelector, {
			provideCodeActions(document, rangeOrSelection): vscode.CodeAction[] {
				return [{
					command: {
						arguments: [document, rangeOrSelection],
						command: 'command',
						title: 'command_title',
					},
					kind: types.CodeActionKind.Empty.append('foo'),
					title: 'title',
					isPreferred: true
				}];
			}
		}));

		const selection = new types.Selection(0, 0, 1, 1);

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', model.uri, selection).then(value => {
				assert.strictEqual(value.length, 1);
				const [first] = value;
				assert.strictEqual(first.isPreferred, true);
			});
		});
	});

	test('resolving code action', async function () {

		let didCallResolve = 0;
		class MyAction extends types.CodeAction { }

		disposables.push(extHost.registerCodeActionProvider(nullExtensionDescription, defaultSelector, {
			provideCodeActions(document, rangeOrSelection): vscode.CodeAction[] {
				return [new MyAction('title', types.CodeActionKind.Empty.append('foo'))];
			},
			resolveCodeAction(action): vscode.CodeAction {
				assert.ok(action instanceof MyAction);

				didCallResolve += 1;
				action.title = 'resolved title';
				action.edit = new types.WorkspaceEdit();
				return action;
			}
		}));

		const selection = new types.Selection(0, 0, 1, 1);

		await rpcProtocol.sync();

		const value = await commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', model.uri, selection, undefined, 1000);
		assert.strictEqual(didCallResolve, 1);
		assert.strictEqual(value.length, 1);

		const [first] = value;
		assert.strictEqual(first.title, 'title'); // does NOT change
		assert.ok(first.edit); // is set
	});

	// --- code lens

	test('CodeLens, back and forth', function () {

		const complexArg = {
			foo() { },
			bar() { },
			big: extHost
		};

		disposables.push(extHost.registerCodeLensProvider(nullExtensionDescription, defaultSelector, <vscode.CodeLensProvider>{
			provideCodeLenses(): any {
				return [new types.CodeLens(new types.Range(0, 0, 1, 1), { title: 'Title', command: 'cmd', arguments: [1, true, complexArg] })];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', model.uri).then(value => {
				assert.strictEqual(value.length, 1);
				const [first] = value;

				assert.strictEqual(first.command!.title, 'Title');
				assert.strictEqual(first.command!.command, 'cmd');
				assert.strictEqual(first.command!.arguments![0], 1);
				assert.strictEqual(first.command!.arguments![1], true);
				assert.strictEqual(first.command!.arguments![2], complexArg);
			});
		});
	});

	test('CodeLens, resolve', async function () {

		let resolveCount = 0;

		disposables.push(extHost.registerCodeLensProvider(nullExtensionDescription, defaultSelector, <vscode.CodeLensProvider>{
			provideCodeLenses(): any {
				return [
					new types.CodeLens(new types.Range(0, 0, 1, 1)),
					new types.CodeLens(new types.Range(0, 0, 1, 1)),
					new types.CodeLens(new types.Range(0, 0, 1, 1)),
					new types.CodeLens(new types.Range(0, 0, 1, 1), { title: 'Already resolved', command: 'fff' })
				];
			},
			resolveCodeLens(codeLens: types.CodeLens) {
				codeLens.command = { title: resolveCount.toString(), command: 'resolved' };
				resolveCount += 1;
				return codeLens;
			}
		}));

		await rpcProtocol.sync();

		let value = await commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', model.uri, 2);

		assert.strictEqual(value.length, 3); // the resolve argument defines the number of results being returned
		assert.strictEqual(resolveCount, 2);

		resolveCount = 0;
		value = await commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', model.uri);

		assert.strictEqual(value.length, 4);
		assert.strictEqual(resolveCount, 0);
	});

	test('Links, back and forth', function () {

		disposables.push(extHost.registerDocumentLinkProvider(nullExtensionDescription, defaultSelector, <vscode.DocumentLinkProvider>{
			provideDocumentLinks(): any {
				return [new types.DocumentLink(new types.Range(0, 0, 0, 20), URI.parse('foo:bar'))];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', model.uri).then(value => {
				assert.strictEqual(value.length, 1);
				let [first] = value;

				assert.strictEqual(first.target + '', 'foo:bar');
				assert.strictEqual(first.range.start.line, 0);
				assert.strictEqual(first.range.start.character, 0);
				assert.strictEqual(first.range.end.line, 0);
				assert.strictEqual(first.range.end.character, 20);
			});
		});
	});

	test('What\'s the condition for DocumentLink target to be undefined? #106308', async function () {
		disposables.push(extHost.registerDocumentLinkProvider(nullExtensionDescription, defaultSelector, <vscode.DocumentLinkProvider>{
			provideDocumentLinks(): any {
				return [new types.DocumentLink(new types.Range(0, 0, 0, 20), undefined)];
			},
			resolveDocumentLink(link) {
				link.target = URI.parse('foo:bar');
				return link;
			}
		}));

		await rpcProtocol.sync();

		const links1 = await commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', model.uri);
		assert.strictEqual(links1.length, 1);
		assert.strictEqual(links1[0].target, undefined);

		const links2 = await commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', model.uri, 1000);
		assert.strictEqual(links2.length, 1);
		assert.strictEqual(links2[0].target!.toString(), URI.parse('foo:bar').toString());

	});


	test('Color provider', function () {

		disposables.push(extHost.registerColorProvider(nullExtensionDescription, defaultSelector, <vscode.DocumentColorProvider>{
			provideDocumentColors(): vscode.ColorInformation[] {
				return [new types.ColorInformation(new types.Range(0, 0, 0, 20), new types.Color(0.1, 0.2, 0.3, 0.4))];
			},
			provideColorPresentations(): vscode.ColorPresentation[] {
				const cp = new types.ColorPresentation('#ABC');
				cp.textEdit = types.TextEdit.replace(new types.Range(1, 0, 1, 20), '#ABC');
				cp.additionalTextEdits = [types.TextEdit.insert(new types.Position(2, 20), '*')];
				return [cp];
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.ColorInformation[]>('vscode.executeDocumentColorProvider', model.uri).then(value => {
				assert.strictEqual(value.length, 1);
				let [first] = value;

				assert.strictEqual(first.color.red, 0.1);
				assert.strictEqual(first.color.green, 0.2);
				assert.strictEqual(first.color.blue, 0.3);
				assert.strictEqual(first.color.alpha, 0.4);
				assert.strictEqual(first.range.start.line, 0);
				assert.strictEqual(first.range.start.character, 0);
				assert.strictEqual(first.range.end.line, 0);
				assert.strictEqual(first.range.end.character, 20);
			});
		}).then(() => {
			const color = new types.Color(0.5, 0.6, 0.7, 0.8);
			const range = new types.Range(0, 0, 0, 20);
			return commands.executeCommand<vscode.ColorPresentation[]>('vscode.executeColorPresentationProvider', color, { uri: model.uri, range }).then(value => {
				assert.strictEqual(value.length, 1);
				let [first] = value;

				assert.strictEqual(first.label, '#ABC');
				assert.strictEqual(first.textEdit!.newText, '#ABC');
				assert.strictEqual(first.textEdit!.range.start.line, 1);
				assert.strictEqual(first.textEdit!.range.start.character, 0);
				assert.strictEqual(first.textEdit!.range.end.line, 1);
				assert.strictEqual(first.textEdit!.range.end.character, 20);
				assert.strictEqual(first.additionalTextEdits!.length, 1);
				assert.strictEqual(first.additionalTextEdits![0].range.start.line, 2);
				assert.strictEqual(first.additionalTextEdits![0].range.start.character, 20);
				assert.strictEqual(first.additionalTextEdits![0].range.end.line, 2);
				assert.strictEqual(first.additionalTextEdits![0].range.end.character, 20);
			});
		});
	});

	test('"TypeError: e.onCancellationRequested is not a function" calling hover provider in Insiders #54174', function () {

		disposables.push(extHost.registerHoverProvider(nullExtensionDescription, defaultSelector, <vscode.HoverProvider>{
			provideHover(): any {
				return new types.Hover('fofofofo');
			}
		}));

		return rpcProtocol.sync().then(() => {
			return commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', model.uri, new types.Position(1, 1)).then(value => {
				assert.strictEqual(value.length, 1);
				assert.strictEqual(value[0].contents.length, 1);
			});
		});
	});

	// --- inline hints

	test('Inlay Hints, back and forth', async function () {
		disposables.push(extHost.registerInlayHintsProvider(nullExtensionDescription, defaultSelector, <vscode.InlayHintsProvider>{
			provideInlayHints() {
				return [new types.InlayHint('Foo', new types.Position(0, 1))];
			}
		}));

		await rpcProtocol.sync();

		const value = await commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', model.uri, new types.Range(0, 0, 20, 20));
		assert.strictEqual(value.length, 1);

		const [first] = value;
		assert.strictEqual(first.text, 'Foo');
		assert.strictEqual(first.position.line, 0);
		assert.strictEqual(first.position.character, 1);
	});

	test('Inline Hints, merge', async function () {
		disposables.push(extHost.registerInlayHintsProvider(nullExtensionDescription, defaultSelector, <vscode.InlayHintsProvider>{
			provideInlayHints() {
				return [new types.InlayHint('Bar', new types.Position(10, 11))];
			}
		}));

		disposables.push(extHost.registerInlayHintsProvider(nullExtensionDescription, defaultSelector, <vscode.InlayHintsProvider>{
			provideInlayHints() {
				const hint = new types.InlayHint('Foo', new types.Position(0, 1), types.InlayHintKind.Parameter);
				return [hint];
			}
		}));

		await rpcProtocol.sync();

		const value = await commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', model.uri, new types.Range(0, 0, 20, 20));
		assert.strictEqual(value.length, 2);

		const [first, second] = value;
		assert.strictEqual(first.text, 'Foo');
		assert.strictEqual(first.position.line, 0);
		assert.strictEqual(first.position.character, 1);

		assert.strictEqual(second.text, 'Bar');
		assert.strictEqual(second.position.line, 10);
		assert.strictEqual(second.position.character, 11);
	});

	test('Inline Hints, bad provider', async function () {
		disposables.push(extHost.registerInlayHintsProvider(nullExtensionDescription, defaultSelector, <vscode.InlayHintsProvider>{
			provideInlayHints() {
				return [new types.InlayHint('Foo', new types.Position(0, 1))];
			}
		}));
		disposables.push(extHost.registerInlayHintsProvider(nullExtensionDescription, defaultSelector, <vscode.InlayHintsProvider>{
			provideInlayHints() {
				throw new Error();
			}
		}));

		await rpcProtocol.sync();

		const value = await commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', model.uri, new types.Range(0, 0, 20, 20));
		assert.strictEqual(value.length, 1);

		const [first] = value;
		assert.strictEqual(first.text, 'Foo');
		assert.strictEqual(first.position.line, 0);
		assert.strictEqual(first.position.character, 1);
	});

	// --- selection ranges

	test('Selection Range, back and forth', async function () {

		disposables.push(extHost.registerSelectionRangeProvider(nullExtensionDescription, defaultSelector, <vscode.SelectionRangeProvider>{
			provideSelectionRanges() {
				return [
					new types.SelectionRange(new types.Range(0, 10, 0, 18), new types.SelectionRange(new types.Range(0, 2, 0, 20))),
				];
			}
		}));

		await rpcProtocol.sync();
		let value = await commands.executeCommand<vscode.SelectionRange[]>('vscode.executeSelectionRangeProvider', model.uri, [new types.Position(0, 10)]);
		assert.strictEqual(value.length, 1);
		assert.ok(value[0].parent);
	});

	// --- call hierarcht

	test('CallHierarchy, back and forth', async function () {

		disposables.push(extHost.registerCallHierarchyProvider(nullExtensionDescription, defaultSelector, new class implements vscode.CallHierarchyProvider {

			prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position,): vscode.ProviderResult<vscode.CallHierarchyItem> {
				return new types.CallHierarchyItem(types.SymbolKind.Constant, 'ROOT', 'ROOT', document.uri, new types.Range(0, 0, 0, 0), new types.Range(0, 0, 0, 0));
			}

			provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CallHierarchyIncomingCall[]> {

				return [new types.CallHierarchyIncomingCall(
					new types.CallHierarchyItem(types.SymbolKind.Constant, 'INCOMING', 'INCOMING', item.uri, new types.Range(0, 0, 0, 0), new types.Range(0, 0, 0, 0)),
					[new types.Range(0, 0, 0, 0)]
				)];
			}

			provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CallHierarchyOutgoingCall[]> {
				return [new types.CallHierarchyOutgoingCall(
					new types.CallHierarchyItem(types.SymbolKind.Constant, 'OUTGOING', 'OUTGOING', item.uri, new types.Range(0, 0, 0, 0), new types.Range(0, 0, 0, 0)),
					[new types.Range(0, 0, 0, 0)]
				)];
			}
		}));

		await rpcProtocol.sync();

		const root = await commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', model.uri, new types.Position(0, 0));

		assert.ok(Array.isArray(root));
		assert.strictEqual(root.length, 1);
		assert.strictEqual(root[0].name, 'ROOT');

		const incoming = await commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', root[0]);
		assert.strictEqual(incoming.length, 1);
		assert.strictEqual(incoming[0].from.name, 'INCOMING');

		const outgoing = await commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', root[0]);
		assert.strictEqual(outgoing.length, 1);
		assert.strictEqual(outgoing[0].to.name, 'OUTGOING');
	});

	test('selectionRangeProvider on inner array always returns outer array #91852', async function () {

		disposables.push(extHost.registerSelectionRangeProvider(nullExtensionDescription, defaultSelector, <vscode.SelectionRangeProvider>{
			provideSelectionRanges(_doc, positions) {
				const [first] = positions;
				return [
					new types.SelectionRange(new types.Range(first.line, first.character, first.line, first.character)),
				];
			}
		}));

		await rpcProtocol.sync();
		let value = await commands.executeCommand<vscode.SelectionRange[]>('vscode.executeSelectionRangeProvider', model.uri, [new types.Position(0, 10)]);
		assert.strictEqual(value.length, 1);
		assert.strictEqual(value[0].range.start.line, 0);
		assert.strictEqual(value[0].range.start.character, 10);
		assert.strictEqual(value[0].range.end.line, 0);
		assert.strictEqual(value[0].range.end.character, 10);
	});

	test('selectionRangeProvider on inner array always returns outer array #91852', async function () {

		disposables.push(extHost.registerSelectionRangeProvider(nullExtensionDescription, defaultSelector, <vscode.SelectionRangeProvider>{
			provideSelectionRanges(_doc, positions) {
				const [first, second] = positions;
				return [
					new types.SelectionRange(new types.Range(first.line, first.character, first.line, first.character)),
					new types.SelectionRange(new types.Range(second.line, second.character, second.line, second.character)),
				];
			}
		}));

		await rpcProtocol.sync();
		let value = await commands.executeCommand<vscode.SelectionRange[]>(
			'vscode.executeSelectionRangeProvider',
			model.uri,
			[new types.Position(0, 0), new types.Position(0, 10)]
		);
		assert.strictEqual(value.length, 2);
		assert.strictEqual(value[0].range.start.line, 0);
		assert.strictEqual(value[0].range.start.character, 0);
		assert.strictEqual(value[0].range.end.line, 0);
		assert.strictEqual(value[0].range.end.character, 0);
		assert.strictEqual(value[1].range.start.line, 0);
		assert.strictEqual(value[1].range.start.character, 10);
		assert.strictEqual(value[1].range.end.line, 0);
		assert.strictEqual(value[1].range.end.character, 10);
	});
});
