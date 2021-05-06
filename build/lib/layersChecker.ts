/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ts from 'typescript';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { match } from 'minimatch';

//
// #############################################################################################
//
// A custom typescript checker for the specific task of detecting the use of certain types in a
// layer that does not allow such use. For example:
// - using DOM globals in common/node/electron-main layer (e.g. HTMLElement)
// - using node.js globals in common/browser layer (e.g. process)
//
// Make changes to below RULES to lift certain files from these checks only if absolutely needed
//
// #############################################################################################
//

// Types we assume are present in all implementations of JS VMs (node.js, browsers)
// Feel free to add more core types as you see needed if present in node.js and browsers
const CORE_TYPES = [
	'require', // from our AMD loader
	'setTimeout',
	'clearTimeout',
	'setInterval',
	'clearInterval',
	'console',
	'log',
	'info',
	'warn',
	'error',
	'group',
	'groupEnd',
	'table',
	'assert',
	'Error',
	'String',
	'throws',
	'stack',
	'captureStackTrace',
	'stackTraceLimit',
	'TextDecoder',
	'TextEncoder',
	'encode',
	'decode',
	'self',
	'trimLeft',
	'trimRight'
];

// Types that are defined in a common layer but are known to be only
// available in native environments should not be allowed in browser
const NATIVE_TYPES = [
	'NativeParsedArgs',
	'INativeEnvironmentService',
	'AbstractNativeEnvironmentService',
	'INativeWindowConfiguration',
	'ICommonNativeHostService'
];

const RULES = [

	// Tests: skip
	{
		target: '**/vs/**/test/**',
		skip: true // -> skip all test files
	},

	// Common: vs/base/common/platform.ts
	{
		target: '**/vs/base/common/platform.ts',
		allowedTypes: [
			...CORE_TYPES,

			// Safe access to postMessage() and friends
			'MessageEvent',
			'data'
		],
		disallowedTypes: NATIVE_TYPES,
		disallowedDefinitions: [
			'lib.dom.d.ts', // no DOM
			'@types/node'	// no node.js
		]
	},

	// Common: vs/platform/environment/common/*
	{
		target: '**/vs/platform/environment/common/*.ts',
		disallowedTypes: [/* Ignore native types that are defined from here */],
		allowedTypes: CORE_TYPES,
		disallowedDefinitions: [
			'lib.dom.d.ts', // no DOM
			'@types/node'	// no node.js
		]
	},

	// Common: vs/platform/windows/common/windows.ts
	{
		target: '**/vs/platform/windows/common/windows.ts',
		disallowedTypes: [/* Ignore native types that are defined from here */],
		allowedTypes: CORE_TYPES,
		disallowedDefinitions: [
			'lib.dom.d.ts', // no DOM
			'@types/node'	// no node.js
		]
	},

	// Common: vs/platform/native/common/native.ts
	{
		target: '**/vs/platform/native/common/native.ts',
		disallowedTypes: [/* Ignore native types that are defined from here */],
		allowedTypes: CORE_TYPES,
		disallowedDefinitions: [
			'lib.dom.d.ts', // no DOM
			'@types/node'	// no node.js
		]
	},

	// Common: vs/workbench/api/common/extHostExtensionService.ts
	{
		target: '**/vs/workbench/api/common/extHostExtensionService.ts',
		allowedTypes: [
			...CORE_TYPES,

			// Safe access to global
			'global'
		],
		disallowedTypes: NATIVE_TYPES,
		disallowedDefinitions: [
			'lib.dom.d.ts', // no DOM
			'@types/node'	// no node.js
		]
	},

	// Common
	{
		target: '**/vs/**/common/**',
		allowedTypes: CORE_TYPES,
		disallowedTypes: NATIVE_TYPES,
		disallowedDefinitions: [
			'lib.dom.d.ts', // no DOM
			'@types/node'	// no node.js
		]
	},

	// Browser
	{
		target: '**/vs/**/browser/**',
		allowedTypes: CORE_TYPES,
		disallowedTypes: NATIVE_TYPES,
		disallowedDefinitions: [
			'@types/node'	// no node.js
		]
	},

	// Browser (editor contrib)
	{
		target: '**/src/vs/editor/contrib/**',
		allowedTypes: CORE_TYPES,
		disallowedTypes: NATIVE_TYPES,
		disallowedDefinitions: [
			'@types/node'	// no node.js
		]
	},

	// node.js
	{
		target: '**/vs/**/node/**',
		allowedTypes: [
			...CORE_TYPES,

			// --> types from node.d.ts that duplicate from lib.dom.d.ts
			'URL',
			'protocol',
			'hostname',
			'port',
			'pathname',
			'search',
			'username',
			'password'
		],
		disallowedDefinitions: [
			'lib.dom.d.ts'	// no DOM
		]
	},

	// Electron (sandbox)
	{
		target: '**/vs/**/electron-sandbox/**',
		allowedTypes: CORE_TYPES,
		disallowedDefinitions: [
			'@types/node'	// no node.js
		]
	},

	// Electron (renderer): skip
	{
		target: '**/vs/**/electron-browser/**',
		skip: true // -> supports all types
	},

	// Electron (main)
	{
		target: '**/vs/**/electron-main/**',
		allowedTypes: [
			...CORE_TYPES,

			// --> types from electron.d.ts that duplicate from lib.dom.d.ts
			'Event',
			'Request'
		],
		disallowedDefinitions: [
			'lib.dom.d.ts'	// no DOM
		]
	}
];

const TS_CONFIG_PATH = join(__dirname, '../../', 'src', 'tsconfig.json');

interface IRule {
	target: string;
	skip?: boolean;
	allowedTypes?: string[];
	disallowedDefinitions?: string[];
	disallowedTypes?: string[];
}

let hasErrors = false;

function checkFile(program: ts.Program, sourceFile: ts.SourceFile, rule: IRule) {
	checkNode(sourceFile);

	function checkNode(node: ts.Node): void {
		if (node.kind !== ts.SyntaxKind.Identifier) {
			return ts.forEachChild(node, checkNode); // recurse down
		}

		const text = node.getText(sourceFile);

		if (rule.allowedTypes?.some(allowed => allowed === text)) {
			return; // override
		}

		if (rule.disallowedTypes?.some(disallowed => disallowed === text)) {
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
			console.log(`[build/lib/layersChecker.ts]: Reference to '${text}' violates layer '${rule.target}' (${sourceFile.fileName} (${line + 1},${character + 1})`);

			hasErrors = true;
			return;
		}

		const checker = program.getTypeChecker();
		const symbol = checker.getSymbolAtLocation(node);
		if (symbol) {
			const declarations = symbol.declarations;
			if (Array.isArray(declarations)) {
				for (const declaration of declarations) {
					if (declaration) {
						const parent = declaration.parent;
						if (parent) {
							const parentSourceFile = parent.getSourceFile();
							if (parentSourceFile) {
								const definitionFileName = parentSourceFile.fileName;
								if (rule.disallowedDefinitions) {
									for (const disallowedDefinition of rule.disallowedDefinitions) {
										if (definitionFileName.indexOf(disallowedDefinition) >= 0) {
											const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
											console.log(`[build/lib/layersChecker.ts]: Reference to '${text}' from '${disallowedDefinition}' violates layer '${rule.target}' (${sourceFile.fileName} (${line + 1},${character + 1})`);

											hasErrors = true;
											return;
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
}

function createProgram(tsconfigPath: string): ts.Program {
	const tsConfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

	const configHostParser: ts.ParseConfigHost = { fileExists: existsSync, readDirectory: ts.sys.readDirectory, readFile: file => readFileSync(file, 'utf8'), useCaseSensitiveFileNames: process.platform === 'linux' };
	const tsConfigParsed = ts.parseJsonConfigFileContent(tsConfig.config, configHostParser, resolve(dirname(tsconfigPath)), { noEmit: true });

	const compilerHost = ts.createCompilerHost(tsConfigParsed.options, true);

	return ts.createProgram(tsConfigParsed.fileNames, tsConfigParsed.options, compilerHost);
}

//
// Create program and start checking
//
const program = createProgram(TS_CONFIG_PATH);

for (const sourceFile of program.getSourceFiles()) {
	for (const rule of RULES) {
		if (match([sourceFile.fileName], rule.target).length > 0) {
			if (!rule.skip) {
				checkFile(program, sourceFile, rule);
			}

			break;
		}
	}
}

if (hasErrors) {
	process.exit(1);
}
