/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as platform from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { CodeEditorServiceImpl, GlobalStyleSheet } from 'vs/editor/browser/services/codeEditorServiceImpl';
import { IDecorationRenderOptions } from 'vs/editor/common/editorCommon';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { TestColorTheme, TestThemeService } from 'vs/platform/theme/test/common/testThemeService';

const themeServiceMock = new TestThemeService();

class TestCodeEditorServiceImpl extends CodeEditorServiceImpl {
	getActiveCodeEditor(): ICodeEditor | null {
		return null;
	}

	openCodeEditor(input: IResourceEditorInput, source: ICodeEditor | null, sideBySide?: boolean): Promise<ICodeEditor | null> {
		return Promise.resolve(null);
	}
}

class TestGlobalStyleSheet extends GlobalStyleSheet {

	public rules: string[] = [];

	constructor() {
		super(null!);
	}

	public insertRule(rule: string, index?: number): void {
		this.rules.unshift(rule);
	}

	public removeRulesContainingSelector(ruleName: string): void {
		for (let i = 0; i < this.rules.length; i++) {
			if (this.rules[i].indexOf(ruleName) >= 0) {
				this.rules.splice(i, 1);
				i--;
			}
		}
	}

	public read(): string {
		return this.rules.join('\n');
	}
}

suite('Decoration Render Options', () => {
	let options: IDecorationRenderOptions = {
		gutterIconPath: URI.parse('https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png'),
		gutterIconSize: 'contain',
		backgroundColor: 'red',
		borderColor: 'yellow'
	};
	test('register and resolve decoration type', () => {
		let s = new TestCodeEditorServiceImpl(themeServiceMock);
		s.registerDecorationType('example', options);
		assert.notEqual(s.resolveDecorationOptions('example', false), undefined);
	});
	test('remove decoration type', () => {
		let s = new TestCodeEditorServiceImpl(themeServiceMock);
		s.registerDecorationType('example', options);
		assert.notEqual(s.resolveDecorationOptions('example', false), undefined);
		s.removeDecorationType('example');
		assert.throws(() => s.resolveDecorationOptions('example', false));
	});

	function readStyleSheet(styleSheet: TestGlobalStyleSheet): string {
		return styleSheet.read();
	}

	test('css properties', () => {
		const styleSheet = new TestGlobalStyleSheet();
		const s = new TestCodeEditorServiceImpl(themeServiceMock, styleSheet);
		s.registerDecorationType('example', options);
		const sheet = readStyleSheet(styleSheet);
		assert(sheet.indexOf(`{background:url('https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png') center center no-repeat;background-size:contain;}`) >= 0);
		assert(sheet.indexOf(`{background-color:red;border-color:yellow;box-sizing: border-box;}`) >= 0);
	});

	test('theme color', () => {
		const options: IDecorationRenderOptions = {
			backgroundColor: { id: 'editorBackground' },
			borderColor: { id: 'editorBorder' },
		};

		const styleSheet = new TestGlobalStyleSheet();
		const themeService = new TestThemeService(new TestColorTheme({
			editorBackground: '#FF0000'
		}));
		const s = new TestCodeEditorServiceImpl(themeService, styleSheet);
		s.registerDecorationType('example', options);
		assert.equal(readStyleSheet(styleSheet), '.monaco-editor .ced-example-0 {background-color:#ff0000;border-color:transparent;box-sizing: border-box;}');

		themeService.setTheme(new TestColorTheme({
			editorBackground: '#EE0000',
			editorBorder: '#00FFFF'
		}));
		assert.equal(readStyleSheet(styleSheet), '.monaco-editor .ced-example-0 {background-color:#ee0000;border-color:#00ffff;box-sizing: border-box;}');

		s.removeDecorationType('example');
		assert.equal(readStyleSheet(styleSheet), '');
	});

	test('theme overrides', () => {
		const options: IDecorationRenderOptions = {
			color: { id: 'editorBackground' },
			light: {
				color: '#FF00FF'
			},
			dark: {
				color: '#000000',
				after: {
					color: { id: 'infoForeground' }
				}
			}
		};

		const styleSheet = new TestGlobalStyleSheet();
		const themeService = new TestThemeService(new TestColorTheme({
			editorBackground: '#FF0000',
			infoForeground: '#444444'
		}));
		const s = new TestCodeEditorServiceImpl(themeService, styleSheet);
		s.registerDecorationType('example', options);
		const expected = [
			'.vs-dark.monaco-editor .ced-example-4::after, .hc-black.monaco-editor .ced-example-4::after {color:#444444 !important;}',
			'.vs-dark.monaco-editor .ced-example-1, .hc-black.monaco-editor .ced-example-1 {color:#000000 !important;}',
			'.vs.monaco-editor .ced-example-1 {color:#FF00FF !important;}',
			'.monaco-editor .ced-example-1 {color:#ff0000 !important;}'
		].join('\n');
		assert.equal(readStyleSheet(styleSheet), expected);

		s.removeDecorationType('example');
		assert.equal(readStyleSheet(styleSheet), '');
	});

	test('css properties, gutterIconPaths', () => {
		const styleSheet = new TestGlobalStyleSheet();
		const s = new TestCodeEditorServiceImpl(themeServiceMock, styleSheet);

		// URI, only minimal encoding
		s.registerDecorationType('example', { gutterIconPath: URI.parse('data:image/svg+xml;base64,PHN2ZyB4b+') });
		assert(readStyleSheet(styleSheet).indexOf(`{background:url('data:image/svg+xml;base64,PHN2ZyB4b+') center center no-repeat;}`) > 0);
		s.removeDecorationType('example');

		if (platform.isWindows) {
			// windows file path (used as string)
			s.registerDecorationType('example', { gutterIconPath: URI.file('c:\\files\\miles\\more.png') });
			assert(readStyleSheet(styleSheet).indexOf(`{background:url('file:///c:/files/miles/more.png') center center no-repeat;}`) > 0);
			s.removeDecorationType('example');

			// single quote must always be escaped/encoded
			s.registerDecorationType('example', { gutterIconPath: URI.file('c:\\files\\foo\\b\'ar.png') });
			assert(readStyleSheet(styleSheet).indexOf(`{background:url('file:///c:/files/foo/b%27ar.png') center center no-repeat;}`) > 0);
			s.removeDecorationType('example');
		} else {
			// unix file path (used as string)
			s.registerDecorationType('example', { gutterIconPath: URI.file('/Users/foo/bar.png') });
			assert(readStyleSheet(styleSheet).indexOf(`{background:url('file:///Users/foo/bar.png') center center no-repeat;}`) > 0);
			s.removeDecorationType('example');

			// single quote must always be escaped/encoded
			s.registerDecorationType('example', { gutterIconPath: URI.file('/Users/foo/b\'ar.png') });
			assert(readStyleSheet(styleSheet).indexOf(`{background:url('file:///Users/foo/b%27ar.png') center center no-repeat;}`) > 0);
			s.removeDecorationType('example');
		}

		s.registerDecorationType('example', { gutterIconPath: URI.parse('http://test/pa\'th') });
		assert(readStyleSheet(styleSheet).indexOf(`{background:url('http://test/pa%27th') center center no-repeat;}`) > 0);
		s.removeDecorationType('example');
	});
});
