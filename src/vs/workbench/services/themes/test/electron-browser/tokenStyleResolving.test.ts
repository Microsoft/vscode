/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeData } from 'vs/workbench/services/themes/common/colorThemeData';
import * as assert from 'assert';
import { ITokenColorCustomizations } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { TokenStyle, getTokenClassificationRegistry } from 'vs/platform/theme/common/tokenClassificationRegistry';
import { Color } from 'vs/base/common/color';
import { isString } from 'vs/base/common/types';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { ExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/electron-sandbox/extensionResourceLoaderService';
import { ITokenStyle } from 'vs/platform/theme/common/themeService';

const undefinedStyle = { bold: undefined, underline: undefined, italic: undefined };
const unsetStyle = { bold: false, underline: false, italic: false };

function ts(foreground: string | undefined, styleFlags: { bold?: boolean; underline?: boolean; italic?: boolean } | undefined): TokenStyle {
	const foregroundColor = isString(foreground) ? Color.fromHex(foreground) : undefined;
	return new TokenStyle(foregroundColor, styleFlags && styleFlags.bold, styleFlags && styleFlags.underline, styleFlags && styleFlags.italic);
}

function tokenStyleAsString(ts: TokenStyle | undefined | null) {
	if (!ts) {
		return 'tokenstyle-undefined';
	}
	let str = ts.foreground ? ts.foreground.toString() : 'no-foreground';
	if (ts.bold !== undefined) {
		str += ts.bold ? '+B' : '-B';
	}
	if (ts.underline !== undefined) {
		str += ts.underline ? '+U' : '-U';
	}
	if (ts.italic !== undefined) {
		str += ts.italic ? '+I' : '-I';
	}
	return str;
}

function assertTokenStyle(actual: TokenStyle | undefined | null, expected: TokenStyle | undefined | null, message?: string) {
	assert.equal(tokenStyleAsString(actual), tokenStyleAsString(expected), message);
}

function assertTokenStyleMetaData(colorIndex: string[], actual: ITokenStyle | undefined, expected: TokenStyle | undefined | null, message = '') {
	if (expected === undefined || expected === null || actual === undefined) {
		assert.equal(actual, expected, message);
		return;
	}
	assert.strictEqual(actual.bold, expected.bold, 'bold ' + message);
	assert.strictEqual(actual.italic, expected.italic, 'italic ' + message);
	assert.strictEqual(actual.underline, expected.underline, 'underline ' + message);

	const actualForegroundIndex = actual.foreground;
	if (actualForegroundIndex && expected.foreground) {
		assert.equal(colorIndex[actualForegroundIndex], Color.Format.CSS.formatHexA(expected.foreground, true).toUpperCase(), 'foreground ' + message);
	} else {
		assert.equal(actualForegroundIndex, expected.foreground || 0, 'foreground ' + message);
	}
}


function assertTokenStyles(themeData: ColorThemeData, expected: { [qualifiedClassifier: string]: TokenStyle }, language = 'typescript') {
	const colorIndex = themeData.tokenColorMap;

	for (let qualifiedClassifier in expected) {
		const [type, ...modifiers] = qualifiedClassifier.split('.');

		const expectedTokenStyle = expected[qualifiedClassifier];

		const tokenStyleMetaData = themeData.getTokenStyleMetadata(type, modifiers, language);
		assertTokenStyleMetaData(colorIndex, tokenStyleMetaData, expectedTokenStyle, qualifiedClassifier);
	}
}

suite('Themes - TokenStyleResolving', () => {


	const fileService = new FileService(new NullLogService());
	const extensionResourceLoaderService = new ExtensionResourceLoaderService(fileService);

	const diskFileSystemProvider = new DiskFileSystemProvider(new NullLogService());
	fileService.registerProvider(Schemas.file, diskFileSystemProvider);


	test('color defaults - monokai', async () => {
		const themeData = ColorThemeData.createUnloadedTheme('foo');
		const themeLocation = getPathFromAmdModule(require, '../../../../../../../extensions/theme-monokai/themes/monokai-color-theme.json');
		themeData.location = URI.file(themeLocation);
		await themeData.ensureLoaded(extensionResourceLoaderService);

		assert.equal(themeData.isLoaded, true);

		assertTokenStyles(themeData, {
			'comment': ts('#88846f', undefinedStyle),
			'variable': ts('#F8F8F2', unsetStyle),
			'type': ts('#A6E22E', { bold: false, underline: true, italic: false }),
			'function': ts('#A6E22E', unsetStyle),
			'string': ts('#E6DB74', undefinedStyle),
			'number': ts('#AE81FF', undefinedStyle),
			'keyword': ts('#F92672', undefinedStyle)
		});

	});

	test('color defaults - dark+', async () => {
		const themeData = ColorThemeData.createUnloadedTheme('foo');
		const themeLocation = getPathFromAmdModule(require, '../../../../../../../extensions/theme-defaults/themes/dark_plus.json');
		themeData.location = URI.file(themeLocation);
		await themeData.ensureLoaded(extensionResourceLoaderService);

		assert.equal(themeData.isLoaded, true);

		assertTokenStyles(themeData, {
			'comment': ts('#6A9955', undefinedStyle),
			'variable': ts('#9CDCFE', undefinedStyle),
			'type': ts('#4EC9B0', undefinedStyle),
			'function': ts('#DCDCAA', undefinedStyle),
			'string': ts('#CE9178', undefinedStyle),
			'number': ts('#B5CEA8', undefinedStyle),
			'keyword': ts('#C586C0', undefinedStyle)
		});

	});

	test('color defaults - light vs', async () => {
		const themeData = ColorThemeData.createUnloadedTheme('foo');
		const themeLocation = getPathFromAmdModule(require, '../../../../../../../extensions/theme-defaults/themes/light_vs.json');
		themeData.location = URI.file(themeLocation);
		await themeData.ensureLoaded(extensionResourceLoaderService);

		assert.equal(themeData.isLoaded, true);

		assertTokenStyles(themeData, {
			'comment': ts('#008000', undefinedStyle),
			'variable': ts(undefined, undefinedStyle),
			'type': ts(undefined, undefinedStyle),
			'function': ts(undefined, undefinedStyle),
			'string': ts('#a31515', undefinedStyle),
			'number': ts('#098658', undefinedStyle),
			'keyword': ts('#0000ff', undefinedStyle)
		});

	});

	test('color defaults - hc', async () => {
		const themeData = ColorThemeData.createUnloadedTheme('foo');
		const themeLocation = getPathFromAmdModule(require, '../../../../../../../extensions/theme-defaults/themes/hc_black.json');
		themeData.location = URI.file(themeLocation);
		await themeData.ensureLoaded(extensionResourceLoaderService);

		assert.equal(themeData.isLoaded, true);

		assertTokenStyles(themeData, {
			'comment': ts('#7ca668', undefinedStyle),
			'variable': ts('#9CDCFE', undefinedStyle),
			'type': ts('#4EC9B0', undefinedStyle),
			'function': ts('#DCDCAA', undefinedStyle),
			'string': ts('#ce9178', undefinedStyle),
			'number': ts('#b5cea8', undefinedStyle),
			'keyword': ts('#C586C0', undefinedStyle)
		});

	});

	test('color defaults - kimbie dark', async () => {
		const themeData = ColorThemeData.createUnloadedTheme('foo');
		const themeLocation = getPathFromAmdModule(require, '../../../../../../../extensions/theme-kimbie-dark/themes/kimbie-dark-color-theme.json');
		themeData.location = URI.file(themeLocation);
		await themeData.ensureLoaded(extensionResourceLoaderService);

		assert.equal(themeData.isLoaded, true);

		assertTokenStyles(themeData, {
			'comment': ts('#a57a4c', undefinedStyle),
			'variable': ts('#dc3958', undefinedStyle),
			'type': ts('#f06431', undefinedStyle),
			'function': ts('#8ab1b0', undefinedStyle),
			'string': ts('#889b4a', undefinedStyle),
			'number': ts('#f79a32', undefinedStyle),
			'keyword': ts('#98676a', undefinedStyle)
		});

	});

	test('color defaults - abyss', async () => {
		const themeData = ColorThemeData.createUnloadedTheme('foo');
		const themeLocation = getPathFromAmdModule(require, '../../../../../../../extensions/theme-abyss/themes/abyss-color-theme.json');
		themeData.location = URI.file(themeLocation);
		await themeData.ensureLoaded(extensionResourceLoaderService);

		assert.equal(themeData.isLoaded, true);

		assertTokenStyles(themeData, {
			'comment': ts('#384887', undefinedStyle),
			'variable': ts(undefined, unsetStyle),
			'type': ts('#ffeebb', { underline: true, bold: false, italic: false }),
			'function': ts('#ddbb88', unsetStyle),
			'string': ts('#22aa44', undefinedStyle),
			'number': ts('#f280d0', undefinedStyle),
			'keyword': ts('#225588', undefinedStyle)
		});

	});

	test('resolveScopes', async () => {
		const themeData = ColorThemeData.createLoadedEmptyTheme('test', 'test');

		const customTokenColors: ITokenColorCustomizations = {
			textMateRules: [
				{
					scope: 'variable',
					settings: {
						fontStyle: '',
						foreground: '#F8F8F2'
					}
				},
				{
					scope: 'keyword.operator',
					settings: {
						fontStyle: 'italic bold underline',
						foreground: '#F92672'
					}
				},
				{
					scope: 'storage',
					settings: {
						fontStyle: 'italic',
						foreground: '#F92672'
					}
				},
				{
					scope: ['storage.type', 'meta.structure.dictionary.json string.quoted.double.json'],
					settings: {
						foreground: '#66D9EF'
					}
				},
				{
					scope: 'entity.name.type, entity.name.class, entity.name.namespace, entity.name.scope-resolution',
					settings: {
						fontStyle: 'underline',
						foreground: '#A6E22E'
					}
				},
			]
		};

		themeData.setCustomTokenColors(customTokenColors);

		let tokenStyle;
		let defaultTokenStyle = undefined;

		tokenStyle = themeData.resolveScopes([['variable']]);
		assertTokenStyle(tokenStyle, ts('#F8F8F2', unsetStyle), 'variable');

		tokenStyle = themeData.resolveScopes([['keyword.operator']]);
		assertTokenStyle(tokenStyle, ts('#F92672', { italic: true, bold: true, underline: true }), 'keyword');

		tokenStyle = themeData.resolveScopes([['keyword']]);
		assertTokenStyle(tokenStyle, defaultTokenStyle, 'keyword');

		tokenStyle = themeData.resolveScopes([['keyword.operator']]);
		assertTokenStyle(tokenStyle, ts('#F92672', { italic: true, bold: true, underline: true }), 'keyword.operator');

		tokenStyle = themeData.resolveScopes([['keyword.operators']]);
		assertTokenStyle(tokenStyle, defaultTokenStyle, 'keyword.operators');

		tokenStyle = themeData.resolveScopes([['storage']]);
		assertTokenStyle(tokenStyle, ts('#F92672', { italic: true, bold: false, underline: false }), 'storage');

		tokenStyle = themeData.resolveScopes([['storage.type']]);
		assertTokenStyle(tokenStyle, ts('#66D9EF', { italic: true, bold: false, underline: false }), 'storage.type');

		tokenStyle = themeData.resolveScopes([['entity.name.class']]);
		assertTokenStyle(tokenStyle, ts('#A6E22E', { italic: false, bold: false, underline: true }), 'entity.name.class');

		tokenStyle = themeData.resolveScopes([['meta.structure.dictionary.json', 'string.quoted.double.json']]);
		assertTokenStyle(tokenStyle, ts('#66D9EF', undefined), 'json property');

		tokenStyle = themeData.resolveScopes([['keyword'], ['storage.type'], ['entity.name.class']]);
		assertTokenStyle(tokenStyle, ts('#66D9EF', { italic: true, bold: false, underline: false }), 'storage.type');

	});


	test('resolveScopes - match most specific', async () => {
		const themeData = ColorThemeData.createLoadedEmptyTheme('test', 'test');

		const customTokenColors: ITokenColorCustomizations = {
			textMateRules: [
				{
					scope: 'entity.name.type',
					settings: {
						fontStyle: 'underline',
						foreground: '#A6E22E'
					}
				},
				{
					scope: 'entity.name.type.class',
					settings: {
						foreground: '#FF00FF'
					}
				},
				{
					scope: 'entity.name',
					settings: {
						foreground: '#FFFFFF'
					}
				},
			]
		};

		themeData.setCustomTokenColors(customTokenColors);

		const tokenStyle = themeData.resolveScopes([['entity.name.type.class']]);
		assertTokenStyle(tokenStyle, ts('#FF00FF', { italic: false, bold: false, underline: true }), 'entity.name.type.class');

	});


	test('rule matching', async () => {
		const themeData = ColorThemeData.createLoadedEmptyTheme('test', 'test');
		themeData.setCustomColors({ 'editor.foreground': '#000000' });
		themeData.setCustomSemanticTokenColors({
			enabled: true,
			rules: {
				'type': '#ff0000',
				'class': { foreground: '#0000ff', italic: true },
				'*.static': { bold: true },
				'*.declaration': { italic: true },
				'*.async.static': { italic: true, underline: true },
				'*.async': { foreground: '#000fff', underline: true }
			}
		});

		assertTokenStyles(themeData, {
			'type': ts('#ff0000', undefinedStyle),
			'type.static': ts('#ff0000', { bold: true }),
			'type.static.declaration': ts('#ff0000', { bold: true, italic: true }),
			'class': ts('#0000ff', { italic: true }),
			'class.static.declaration': ts('#0000ff', { bold: true, italic: true, }),
			'class.declaration': ts('#0000ff', { italic: true }),
			'class.declaration.async': ts('#000fff', { underline: true, italic: true }),
			'class.declaration.async.static': ts('#000fff', { italic: true, underline: true, bold: true }),
		});

	});

	test('super type', async () => {
		const registry = getTokenClassificationRegistry();

		registry.registerTokenType('myTestInterface', 'A type just for testing', 'interface');
		registry.registerTokenType('myTestSubInterface', 'A type just for testing', 'myTestInterface');

		try {
			const themeData = ColorThemeData.createLoadedEmptyTheme('test', 'test');
			themeData.setCustomColors({ 'editor.foreground': '#000000' });
			themeData.setCustomSemanticTokenColors({
				enabled: true,
				rules: {
					'interface': '#ff0000',
					'myTestInterface': { italic: true },
					'interface.static': { bold: true }
				}
			});

			assertTokenStyles(themeData, { 'myTestSubInterface': ts('#ff0000', { italic: true }) });
			assertTokenStyles(themeData, { 'myTestSubInterface.static': ts('#ff0000', { italic: true, bold: true }) });

			themeData.setCustomSemanticTokenColors({
				enabled: true,
				rules: {
					'interface': '#ff0000',
					'myTestInterface': { foreground: '#ff00ff', italic: true }
				}
			});
			assertTokenStyles(themeData, { 'myTestSubInterface': ts('#ff00ff', { italic: true }) });
		} finally {
			registry.deregisterTokenType('myTestInterface');
			registry.deregisterTokenType('myTestSubInterface');
		}
	});

	test('language', async () => {
		try {
			const themeData = ColorThemeData.createLoadedEmptyTheme('test', 'test');
			themeData.setCustomColors({ 'editor.foreground': '#000000' });
			themeData.setCustomSemanticTokenColors({
				enabled: true,
				rules: {
					'interface': '#fff000',
					'interface:java': '#ff0000',
					'interface.static': { bold: true },
					'interface.static:typescript': { italic: true }
				}
			});

			assertTokenStyles(themeData, { 'interface': ts('#ff0000', undefined) }, 'java');
			assertTokenStyles(themeData, { 'interface': ts('#fff000', undefined) }, 'typescript');
			assertTokenStyles(themeData, { 'interface.static': ts('#ff0000', { bold: true }) }, 'java');
			assertTokenStyles(themeData, { 'interface.static': ts('#fff000', { bold: true, italic: true }) }, 'typescript');
		} finally {
		}
	});

	test('language - scope resolving', async () => {
		const registry = getTokenClassificationRegistry();

		const numberOfDefaultRules = registry.getTokenStylingDefaultRules().length;

		registry.registerTokenStyleDefault(registry.parseTokenSelector('type', 'typescript1'), { scopesToProbe: [['entity.name.type.ts1']] });
		registry.registerTokenStyleDefault(registry.parseTokenSelector('type:javascript1'), { scopesToProbe: [['entity.name.type.js1']] });

		try {
			const themeData = ColorThemeData.createLoadedEmptyTheme('test', 'test');
			themeData.setCustomColors({ 'editor.foreground': '#000000' });
			themeData.setCustomTokenColors({
				textMateRules: [
					{
						scope: 'entity.name.type',
						settings: { foreground: '#aa0000' }
					},
					{
						scope: 'entity.name.type.ts1',
						settings: { foreground: '#bb0000' }
					}
				]
			});

			assertTokenStyles(themeData, { 'type': ts('#aa0000', undefined) }, 'javascript1');
			assertTokenStyles(themeData, { 'type': ts('#bb0000', undefined) }, 'typescript1');

		} finally {
			registry.deregisterTokenStyleDefault(registry.parseTokenSelector('type', 'typescript1'));
			registry.deregisterTokenStyleDefault(registry.parseTokenSelector('type:javascript1'));

			assert.equal(registry.getTokenStylingDefaultRules().length, numberOfDefaultRules);
		}
	});
});
