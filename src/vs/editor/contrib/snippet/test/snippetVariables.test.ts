/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { isWindows } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { Selection } from 'vs/editor/common/core/selection';
import { SelectionBasedVariableResolver, CompositeSnippetVariableResolver, ModelBasedVariableResolver, ClipboardBasedVariableResolver, TimeBasedVariableResolver, WorkspaceBasedVariableResolver } from 'vs/editor/contrib/snippet/snippetVariables';
import { SnippetParser, Variable, VariableResolver } from 'vs/editor/contrib/snippet/snippetParser';
import { TextModel } from 'vs/editor/common/model/textModel';
import { IWorkspace, IWorkspaceContextService, toWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { ILabelService } from 'vs/platform/label/common/label';
import { mock } from 'vs/base/test/common/mock';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { Workspace } from 'vs/platform/workspace/test/common/testWorkspace';
import { extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { sep } from 'vs/base/common/path';
import { toWorkspaceFolders } from 'vs/platform/workspaces/common/workspaces';

suite('Snippet Variables Resolver', function () {

	const labelService = new class extends mock<ILabelService>() {
		override getUriLabel(uri: URI) {
			return uri.fsPath;
		}
	};

	let model: TextModel;
	let resolver: VariableResolver;

	setup(function () {
		model = createTextModel([
			'this is line one',
			'this is line two',
			'    this is line three'
		].join('\n'), undefined, undefined, URI.parse('file:///foo/files/text.txt'));

		resolver = new CompositeSnippetVariableResolver([
			new ModelBasedVariableResolver(labelService, model),
			new SelectionBasedVariableResolver(model, new Selection(1, 1, 1, 1), 0, undefined),
		]);
	});

	teardown(function () {
		model.dispose();
	});

	function assertVariableResolve(resolver: VariableResolver, varName: string, expected?: string) {
		const snippet = new SnippetParser().parse(`$${varName}`);
		const variable = <Variable>snippet.children[0];
		variable.resolve(resolver);
		if (variable.children.length === 0) {
			assert.strictEqual(undefined, expected);
		} else {
			assert.strictEqual(variable.toString(), expected);
		}
	}

	test('editor variables, basics', function () {
		assertVariableResolve(resolver, 'TM_FILENAME', 'text.txt');
		assertVariableResolve(resolver, 'something', undefined);
	});

	test('editor variables, file/dir', function () {

		assertVariableResolve(resolver, 'TM_FILENAME', 'text.txt');
		if (!isWindows) {
			assertVariableResolve(resolver, 'TM_DIRECTORY', '/foo/files');
			assertVariableResolve(resolver, 'TM_FILEPATH', '/foo/files/text.txt');
		}

		resolver = new ModelBasedVariableResolver(
			labelService,
			createTextModel('', undefined, undefined, URI.parse('http://www.pb.o/abc/def/ghi'))
		);
		assertVariableResolve(resolver, 'TM_FILENAME', 'ghi');
		if (!isWindows) {
			assertVariableResolve(resolver, 'TM_DIRECTORY', '/abc/def');
			assertVariableResolve(resolver, 'TM_FILEPATH', '/abc/def/ghi');
		}

		resolver = new ModelBasedVariableResolver(
			labelService,
			createTextModel('', undefined, undefined, URI.parse('mem:fff.ts'))
		);
		assertVariableResolve(resolver, 'TM_DIRECTORY', '');
		assertVariableResolve(resolver, 'TM_FILEPATH', 'fff.ts');

	});

	test('Path delimiters in code snippet variables aren\'t specific to remote OS #76840', function () {

		const labelService = new class extends mock<ILabelService>() {
			override getUriLabel(uri: URI) {
				return uri.fsPath.replace(/\/|\\/g, '|');
			}
		};

		const model = createTextModel([].join('\n'), undefined, undefined, URI.parse('foo:///foo/files/text.txt'));

		const resolver = new CompositeSnippetVariableResolver([new ModelBasedVariableResolver(labelService, model)]);

		assertVariableResolve(resolver, 'TM_FILEPATH', '|foo|files|text.txt');
	});

	test('editor variables, selection', function () {

		resolver = new SelectionBasedVariableResolver(model, new Selection(1, 2, 2, 3), 0, undefined);
		assertVariableResolve(resolver, 'TM_SELECTED_TEXT', 'his is line one\nth');
		assertVariableResolve(resolver, 'TM_CURRENT_LINE', 'this is line two');
		assertVariableResolve(resolver, 'TM_LINE_INDEX', '1');
		assertVariableResolve(resolver, 'TM_LINE_NUMBER', '2');

		resolver = new SelectionBasedVariableResolver(model, new Selection(2, 3, 1, 2), 0, undefined);
		assertVariableResolve(resolver, 'TM_SELECTED_TEXT', 'his is line one\nth');
		assertVariableResolve(resolver, 'TM_CURRENT_LINE', 'this is line one');
		assertVariableResolve(resolver, 'TM_LINE_INDEX', '0');
		assertVariableResolve(resolver, 'TM_LINE_NUMBER', '1');

		resolver = new SelectionBasedVariableResolver(model, new Selection(1, 2, 1, 2), 0, undefined);
		assertVariableResolve(resolver, 'TM_SELECTED_TEXT', undefined);

		assertVariableResolve(resolver, 'TM_CURRENT_WORD', 'this');

		resolver = new SelectionBasedVariableResolver(model, new Selection(3, 1, 3, 1), 0, undefined);
		assertVariableResolve(resolver, 'TM_CURRENT_WORD', undefined);

	});

	test('TextmateSnippet, resolve variable', function () {
		const snippet = new SnippetParser().parse('"$TM_CURRENT_WORD"', true);
		assert.strictEqual(snippet.toString(), '""');
		snippet.resolveVariables(resolver);
		assert.strictEqual(snippet.toString(), '"this"');

	});

	test('TextmateSnippet, resolve variable with default', function () {
		const snippet = new SnippetParser().parse('"${TM_CURRENT_WORD:foo}"', true);
		assert.strictEqual(snippet.toString(), '"foo"');
		snippet.resolveVariables(resolver);
		assert.strictEqual(snippet.toString(), '"this"');
	});

	test('More useful environment variables for snippets, #32737', function () {

		assertVariableResolve(resolver, 'TM_FILENAME_BASE', 'text');

		resolver = new ModelBasedVariableResolver(
			labelService,
			createTextModel('', undefined, undefined, URI.parse('http://www.pb.o/abc/def/ghi'))
		);
		assertVariableResolve(resolver, 'TM_FILENAME_BASE', 'ghi');

		resolver = new ModelBasedVariableResolver(
			labelService,
			createTextModel('', undefined, undefined, URI.parse('mem:.git'))
		);
		assertVariableResolve(resolver, 'TM_FILENAME_BASE', '.git');

		resolver = new ModelBasedVariableResolver(
			labelService,
			createTextModel('', undefined, undefined, URI.parse('mem:foo.'))
		);
		assertVariableResolve(resolver, 'TM_FILENAME_BASE', 'foo');
	});


	function assertVariableResolve2(input: string, expected: string, varValue?: string) {
		const snippet = new SnippetParser().parse(input)
			.resolveVariables({ resolve(variable) { return varValue || variable.name; } });

		const actual = snippet.toString();
		assert.strictEqual(actual, expected);
	}

	test('Variable Snippet Transform', function () {

		const snippet = new SnippetParser().parse('name=${TM_FILENAME/(.*)\\..+$/$1/}', true);
		snippet.resolveVariables(resolver);
		assert.strictEqual(snippet.toString(), 'name=text');

		assertVariableResolve2('${ThisIsAVar/([A-Z]).*(Var)/$2/}', 'Var');
		assertVariableResolve2('${ThisIsAVar/([A-Z]).*(Var)/$2-${1:/downcase}/}', 'Var-t');
		assertVariableResolve2('${Foo/(.*)/${1:+Bar}/img}', 'Bar');

		//https://github.com/microsoft/vscode/issues/33162
		assertVariableResolve2('export default class ${TM_FILENAME/(\\w+)\\.js/$1/g}', 'export default class FooFile', 'FooFile.js');

		assertVariableResolve2('${foobarfoobar/(foo)/${1:+FAR}/g}', 'FARbarFARbar'); // global
		assertVariableResolve2('${foobarfoobar/(foo)/${1:+FAR}/}', 'FARbarfoobar'); // first match
		assertVariableResolve2('${foobarfoobar/(bazz)/${1:+FAR}/g}', 'foobarfoobar'); // no match, no else
		// assertVariableResolve2('${foobarfoobar/(bazz)/${1:+FAR}/g}', ''); // no match

		assertVariableResolve2('${foobarfoobar/(foo)/${2:+FAR}/g}', 'barbar'); // bad group reference
	});

	test('Snippet transforms do not handle regex with alternatives or optional matches, #36089', function () {

		assertVariableResolve2(
			'${TM_FILENAME/^(.)|(?:-(.))|(\\.js)/${1:/upcase}${2:/upcase}/g}',
			'MyClass',
			'my-class.js'
		);

		// no hyphens
		assertVariableResolve2(
			'${TM_FILENAME/^(.)|(?:-(.))|(\\.js)/${1:/upcase}${2:/upcase}/g}',
			'Myclass',
			'myclass.js'
		);

		// none matching suffix
		assertVariableResolve2(
			'${TM_FILENAME/^(.)|(?:-(.))|(\\.js)/${1:/upcase}${2:/upcase}/g}',
			'Myclass.foo',
			'myclass.foo'
		);

		// more than one hyphen
		assertVariableResolve2(
			'${TM_FILENAME/^(.)|(?:-(.))|(\\.js)/${1:/upcase}${2:/upcase}/g}',
			'ThisIsAFile',
			'this-is-a-file.js'
		);

		// KEBAB CASE
		assertVariableResolve2(
			'${TM_FILENAME_BASE/([A-Z][a-z]+)([A-Z][a-z]+$)?/${1:/downcase}-${2:/downcase}/g}',
			'capital-case',
			'CapitalCase'
		);

		assertVariableResolve2(
			'${TM_FILENAME_BASE/([A-Z][a-z]+)([A-Z][a-z]+$)?/${1:/downcase}-${2:/downcase}/g}',
			'capital-case-more',
			'CapitalCaseMore'
		);
	});

	test('Add variable to insert value from clipboard to a snippet #40153', function () {

		assertVariableResolve(new ClipboardBasedVariableResolver(() => undefined, 1, 0, true), 'CLIPBOARD', undefined);

		assertVariableResolve(new ClipboardBasedVariableResolver(() => null!, 1, 0, true), 'CLIPBOARD', undefined);

		assertVariableResolve(new ClipboardBasedVariableResolver(() => '', 1, 0, true), 'CLIPBOARD', undefined);

		assertVariableResolve(new ClipboardBasedVariableResolver(() => 'foo', 1, 0, true), 'CLIPBOARD', 'foo');

		assertVariableResolve(new ClipboardBasedVariableResolver(() => 'foo', 1, 0, true), 'foo', undefined);
		assertVariableResolve(new ClipboardBasedVariableResolver(() => 'foo', 1, 0, true), 'cLIPBOARD', undefined);
	});

	test('Add variable to insert value from clipboard to a snippet #40153', function () {

		assertVariableResolve(new ClipboardBasedVariableResolver(() => 'line1', 1, 2, true), 'CLIPBOARD', 'line1');
		assertVariableResolve(new ClipboardBasedVariableResolver(() => 'line1\nline2\nline3', 1, 2, true), 'CLIPBOARD', 'line1\nline2\nline3');

		assertVariableResolve(new ClipboardBasedVariableResolver(() => 'line1\nline2', 1, 2, true), 'CLIPBOARD', 'line2');
		resolver = new ClipboardBasedVariableResolver(() => 'line1\nline2', 0, 2, true);
		assertVariableResolve(new ClipboardBasedVariableResolver(() => 'line1\nline2', 0, 2, true), 'CLIPBOARD', 'line1');

		assertVariableResolve(new ClipboardBasedVariableResolver(() => 'line1\nline2', 0, 2, false), 'CLIPBOARD', 'line1\nline2');
	});


	function assertVariableResolve3(resolver: VariableResolver, varName: string) {
		const snippet = new SnippetParser().parse(`$${varName}`);
		const variable = <Variable>snippet.children[0];

		assert.strictEqual(variable.resolve(resolver), true, `${varName} failed to resolve`);
	}

	test('Add time variables for snippets #41631, #43140', function () {

		const resolver = new TimeBasedVariableResolver;

		assertVariableResolve3(resolver, 'CURRENT_YEAR');
		assertVariableResolve3(resolver, 'CURRENT_YEAR_SHORT');
		assertVariableResolve3(resolver, 'CURRENT_MONTH');
		assertVariableResolve3(resolver, 'CURRENT_DATE');
		assertVariableResolve3(resolver, 'CURRENT_HOUR');
		assertVariableResolve3(resolver, 'CURRENT_MINUTE');
		assertVariableResolve3(resolver, 'CURRENT_SECOND');
		assertVariableResolve3(resolver, 'CURRENT_DAY_NAME');
		assertVariableResolve3(resolver, 'CURRENT_DAY_NAME_SHORT');
		assertVariableResolve3(resolver, 'CURRENT_MONTH_NAME');
		assertVariableResolve3(resolver, 'CURRENT_MONTH_NAME_SHORT');
		assertVariableResolve3(resolver, 'CURRENT_SECONDS_UNIX');
	});

	test('creating snippet - format-condition doesn\'t work #53617', function () {

		const snippet = new SnippetParser().parse('${TM_LINE_NUMBER/(10)/${1:?It is:It is not}/} line 10', true);
		snippet.resolveVariables({ resolve() { return '10'; } });
		assert.strictEqual(snippet.toString(), 'It is line 10');

		snippet.resolveVariables({ resolve() { return '11'; } });
		assert.strictEqual(snippet.toString(), 'It is not line 10');
	});

	test('Add workspace name and folder variables for snippets #68261', function () {

		let workspace: IWorkspace;
		let resolver: VariableResolver;
		const workspaceService = new class implements IWorkspaceContextService {
			declare readonly _serviceBrand: undefined;
			_throw = () => { throw new Error(); };
			onDidChangeWorkbenchState = this._throw;
			onDidChangeWorkspaceName = this._throw;
			onWillChangeWorkspaceFolders = this._throw;
			onDidChangeWorkspaceFolders = this._throw;
			getCompleteWorkspace = this._throw;
			getWorkspace(): IWorkspace { return workspace; }
			getWorkbenchState = this._throw;
			getWorkspaceFolder = this._throw;
			isCurrentWorkspace = this._throw;
			isInsideWorkspace = this._throw;
		};

		resolver = new WorkspaceBasedVariableResolver(workspaceService);

		// empty workspace
		workspace = new Workspace('');
		assertVariableResolve(resolver, 'WORKSPACE_NAME', undefined);
		assertVariableResolve(resolver, 'WORKSPACE_FOLDER', undefined);

		// single folder workspace without config
		workspace = new Workspace('', [toWorkspaceFolder(URI.file('/folderName'))]);
		assertVariableResolve(resolver, 'WORKSPACE_NAME', 'folderName');
		if (!isWindows) {
			assertVariableResolve(resolver, 'WORKSPACE_FOLDER', '/folderName');
		}

		// workspace with config
		const workspaceConfigPath = URI.file('testWorkspace.code-workspace');
		workspace = new Workspace('', toWorkspaceFolders([{ path: 'folderName' }], workspaceConfigPath, extUriBiasedIgnorePathCase), workspaceConfigPath);
		assertVariableResolve(resolver, 'WORKSPACE_NAME', 'testWorkspace');
		if (!isWindows) {
			assertVariableResolve(resolver, 'WORKSPACE_FOLDER', '/');
		}
	});

	test('Add RELATIVE_FILEPATH snippet variable #114208', function () {

		let resolver: VariableResolver;

		// Mock a label service (only coded for file uris)
		const workspaceLabelService = ((rootPath: string): ILabelService => {
			const labelService = new class extends mock<ILabelService>() {
				override getUriLabel(uri: URI, options: { relative?: boolean } = {}) {
					const rootFsPath = URI.file(rootPath).fsPath + sep;
					const fsPath = uri.fsPath;
					if (options.relative && rootPath && fsPath.startsWith(rootFsPath)) {
						return fsPath.substring(rootFsPath.length);
					}
					return fsPath;
				}
			};
			return labelService;
		});

		const model = createTextModel('', undefined, undefined, URI.parse('file:///foo/files/text.txt'));

		// empty workspace
		resolver = new ModelBasedVariableResolver(
			workspaceLabelService(''),
			model
		);

		if (!isWindows) {
			assertVariableResolve(resolver, 'RELATIVE_FILEPATH', '/foo/files/text.txt');
		} else {
			assertVariableResolve(resolver, 'RELATIVE_FILEPATH', '\\foo\\files\\text.txt');
		}

		// single folder workspace
		resolver = new ModelBasedVariableResolver(
			workspaceLabelService('/foo'),
			model
		);
		if (!isWindows) {
			assertVariableResolve(resolver, 'RELATIVE_FILEPATH', 'files/text.txt');
		} else {
			assertVariableResolve(resolver, 'RELATIVE_FILEPATH', 'files\\text.txt');
		}
	});
});
