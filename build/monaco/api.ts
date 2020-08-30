/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as ts from 'typescript';
import * as path from 'path';
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';

const dtsv = '3';

const tsfmt = require('../../tsfmt.json');

const SRC = path.join(__dirname, '../../src');
export const RECIPE_PATH = path.join(__dirname, './monaco.d.ts.recipe');
const DECLARATION_PATH = path.join(__dirname, '../../src/vs/monaco.d.ts');

function logErr(message: any, ...rest: any[]): void {
	fancyLog(ansiColors.yellow(`[monaco.d.ts]`), message, ...rest);
}

type SourceFileGetter = (moduleId: string) => ts.SourceFile | null;

type TSTopLevelDeclaration = ts.InterfaceDeclaration | ts.EnumDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration | ts.FunctionDeclaration | ts.ModuleDeclaration;
type TSTopLevelDeclare = TSTopLevelDeclaration | ts.VariableStatement;

function isDeclaration(a: TSTopLevelDeclare): a is TSTopLevelDeclaration {
	return (
		a.kind === ts.SyntaxKind.InterfaceDeclaration
		|| a.kind === ts.SyntaxKind.EnumDeclaration
		|| a.kind === ts.SyntaxKind.ClassDeclaration
		|| a.kind === ts.SyntaxKind.TypeAliasDeclaration
		|| a.kind === ts.SyntaxKind.FunctionDeclaration
		|| a.kind === ts.SyntaxKind.ModuleDeclaration
	);
}

function visitTopLevelDeclarations(sourceFile: ts.SourceFile, visitor: (node: TSTopLevelDeclare) => boolean): void {
	let stop = false;

	let visit = (node: ts.Node): void => {
		if (stop) {
			return;
		}

		switch (node.kind) {
			case ts.SyntaxKind.InterfaceDeclaration:
			case ts.SyntaxKind.EnumDeclaration:
			case ts.SyntaxKind.ClassDeclaration:
			case ts.SyntaxKind.VariableStatement:
			case ts.SyntaxKind.TypeAliasDeclaration:
			case ts.SyntaxKind.FunctionDeclaration:
			case ts.SyntaxKind.ModuleDeclaration:
				stop = visitor(<TSTopLevelDeclare>node);
		}

		if (stop) {
			return;
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
}


function getAllTopLevelDeclarations(sourceFile: ts.SourceFile): TSTopLevelDeclare[] {
	let all: TSTopLevelDeclare[] = [];
	visitTopLevelDeclarations(sourceFile, (node) => {
		if (node.kind === ts.SyntaxKind.InterfaceDeclaration || node.kind === ts.SyntaxKind.ClassDeclaration || node.kind === ts.SyntaxKind.ModuleDeclaration) {
			let interfaceDeclaration = <ts.InterfaceDeclaration>node;
			let triviaStart = interfaceDeclaration.pos;
			let triviaEnd = interfaceDeclaration.name.pos;
			let triviaText = getNodeText(sourceFile, { pos: triviaStart, end: triviaEnd });

			if (triviaText.indexOf('@internal') === -1) {
				all.push(node);
			}
		} else {
			let nodeText = getNodeText(sourceFile, node);
			if (nodeText.indexOf('@internal') === -1) {
				all.push(node);
			}
		}
		return false /*continue*/;
	});
	return all;
}


function getTopLevelDeclaration(sourceFile: ts.SourceFile, typeName: string): TSTopLevelDeclare | null {
	let result: TSTopLevelDeclare | null = null;
	visitTopLevelDeclarations(sourceFile, (node) => {
		if (isDeclaration(node) && node.name) {
			if (node.name.text === typeName) {
				result = node;
				return true /*stop*/;
			}
			return false /*continue*/;
		}
		// node is ts.VariableStatement
		if (getNodeText(sourceFile, node).indexOf(typeName) >= 0) {
			result = node;
			return true /*stop*/;
		}
		return false /*continue*/;
	});
	return result;
}


function getNodeText(sourceFile: ts.SourceFile, node: { pos: number; end: number; }): string {
	return sourceFile.getFullText().substring(node.pos, node.end);
}

function hasModifier(modifiers: ts.NodeArray<ts.Modifier> | undefined, kind: ts.SyntaxKind): boolean {
	if (modifiers) {
		for (let i = 0; i < modifiers.length; i++) {
			let mod = modifiers[i];
			if (mod.kind === kind) {
				return true;
			}
		}
	}
	return false;
}

function isStatic(member: ts.ClassElement | ts.TypeElement): boolean {
	return hasModifier(member.modifiers, ts.SyntaxKind.StaticKeyword);
}

function isDefaultExport(declaration: ts.InterfaceDeclaration | ts.ClassDeclaration): boolean {
	return (
		hasModifier(declaration.modifiers, ts.SyntaxKind.DefaultKeyword)
		&& hasModifier(declaration.modifiers, ts.SyntaxKind.ExportKeyword)
	);
}

function getMassagedTopLevelDeclarationText(sourceFile: ts.SourceFile, declaration: TSTopLevelDeclare, importName: string, usage: string[], enums: IEnumEntry[]): string {
	let result = getNodeText(sourceFile, declaration);
	if (declaration.kind === ts.SyntaxKind.InterfaceDeclaration || declaration.kind === ts.SyntaxKind.ClassDeclaration) {
		let interfaceDeclaration = <ts.InterfaceDeclaration | ts.ClassDeclaration>declaration;

		const staticTypeName = (
			isDefaultExport(interfaceDeclaration)
				? `${importName}.default`
				: `${importName}.${declaration.name!.text}`
		);

		let instanceTypeName = staticTypeName;
		const typeParametersCnt = (interfaceDeclaration.typeParameters ? interfaceDeclaration.typeParameters.length : 0);
		if (typeParametersCnt > 0) {
			let arr: string[] = [];
			for (let i = 0; i < typeParametersCnt; i++) {
				arr.push('any');
			}
			instanceTypeName = `${instanceTypeName}<${arr.join(',')}>`;
		}

		const members: ts.NodeArray<ts.ClassElement | ts.TypeElement> = interfaceDeclaration.members;
		members.forEach((member) => {
			try {
				let memberText = getNodeText(sourceFile, member);
				if (memberText.indexOf('@internal') >= 0 || memberText.indexOf('private') >= 0) {
					result = result.replace(memberText, '');
				} else {
					const memberName = (<ts.Identifier | ts.StringLiteral>member.name).text;
					const memberAccess = (memberName.indexOf('.') >= 0 ? `['${memberName}']` : `.${memberName}`);
					if (isStatic(member)) {
						usage.push(`a = ${staticTypeName}${memberAccess};`);
					} else {
						usage.push(`a = (<${instanceTypeName}>b)${memberAccess};`);
					}
				}
			} catch (err) {
				// life..
			}
		});
	} else if (declaration.kind === ts.SyntaxKind.VariableStatement) {
		const jsDoc = result.substr(0, declaration.getLeadingTriviaWidth(sourceFile));
		if (jsDoc.indexOf('@monacodtsreplace') >= 0) {
			const jsDocLines = jsDoc.split(/\r\n|\r|\n/);
			let directives: [RegExp, string][] = [];
			for (const jsDocLine of jsDocLines) {
				const m = jsDocLine.match(/^\s*\* \/([^/]+)\/([^/]+)\/$/);
				if (m) {
					directives.push([new RegExp(m[1], 'g'), m[2]]);
				}
			}
			// remove the jsdoc
			result = result.substr(jsDoc.length);
			if (directives.length > 0) {
				// apply replace directives
				const replacer = createReplacerFromDirectives(directives);
				result = replacer(result);
			}
		}
	}
	result = result.replace(/export default /g, 'export ');
	result = result.replace(/export declare /g, 'export ');
	result = result.replace(/declare /g, '');
	let lines = result.split(/\r\n|\r|\n/);
	for (let i = 0; i < lines.length; i++) {
		if (/\s*\*/.test(lines[i])) {
			// very likely a comment
			continue;
		}
		lines[i] = lines[i].replace(/"/g, '\'');
	}
	result = lines.join('\n');

	if (declaration.kind === ts.SyntaxKind.EnumDeclaration) {
		result = result.replace(/const enum/, 'enum');
		enums.push({
			enumName: declaration.name.getText(sourceFile),
			text: result
		});
	}

	return result;
}

function format(text: string, endl: string): string {
	const REALLY_FORMAT = false;

	text = preformat(text, endl);
	if (!REALLY_FORMAT) {
		return text;
	}

	// Parse the source text
	let sourceFile = ts.createSourceFile('file.ts', text, ts.ScriptTarget.Latest, /*setParentPointers*/ true);

	// Get the formatting edits on the input sources
	let edits = (<any>ts).formatting.formatDocument(sourceFile, getRuleProvider(tsfmt), tsfmt);

	// Apply the edits on the input code
	return applyEdits(text, edits);

	function countParensCurly(text: string): number {
		let cnt = 0;
		for (let i = 0; i < text.length; i++) {
			if (text.charAt(i) === '(' || text.charAt(i) === '{') {
				cnt++;
			}
			if (text.charAt(i) === ')' || text.charAt(i) === '}') {
				cnt--;
			}
		}
		return cnt;
	}

	function repeatStr(s: string, cnt: number): string {
		let r = '';
		for (let i = 0; i < cnt; i++) {
			r += s;
		}
		return r;
	}

	function preformat(text: string, endl: string): string {
		let lines = text.split(endl);
		let inComment = false;
		let inCommentDeltaIndent = 0;
		let indent = 0;
		for (let i = 0; i < lines.length; i++) {
			let line = lines[i].replace(/\s$/, '');
			let repeat = false;
			let lineIndent = 0;
			do {
				repeat = false;
				if (line.substring(0, 4) === '    ') {
					line = line.substring(4);
					lineIndent++;
					repeat = true;
				}
				if (line.charAt(0) === '\t') {
					line = line.substring(1);
					lineIndent++;
					repeat = true;
				}
			} while (repeat);

			if (line.length === 0) {
				continue;
			}

			if (inComment) {
				if (/\*\//.test(line)) {
					inComment = false;
				}
				lines[i] = repeatStr('\t', lineIndent + inCommentDeltaIndent) + line;
				continue;
			}

			if (/\/\*/.test(line)) {
				inComment = true;
				inCommentDeltaIndent = indent - lineIndent;
				lines[i] = repeatStr('\t', indent) + line;
				continue;
			}

			const cnt = countParensCurly(line);
			let shouldUnindentAfter = false;
			let shouldUnindentBefore = false;
			if (cnt < 0) {
				if (/[({]/.test(line)) {
					shouldUnindentAfter = true;
				} else {
					shouldUnindentBefore = true;
				}
			} else if (cnt === 0) {
				shouldUnindentBefore = /^\}/.test(line);
			}
			let shouldIndentAfter = false;
			if (cnt > 0) {
				shouldIndentAfter = true;
			} else if (cnt === 0) {
				shouldIndentAfter = /{$/.test(line);
			}

			if (shouldUnindentBefore) {
				indent--;
			}

			lines[i] = repeatStr('\t', indent) + line;

			if (shouldUnindentAfter) {
				indent--;
			}
			if (shouldIndentAfter) {
				indent++;
			}
		}
		return lines.join(endl);
	}

	function getRuleProvider(options: ts.FormatCodeSettings) {
		// Share this between multiple formatters using the same options.
		// This represents the bulk of the space the formatter uses.
		return (ts as any).formatting.getFormatContext(options);
	}

	function applyEdits(text: string, edits: ts.TextChange[]): string {
		// Apply edits in reverse on the existing text
		let result = text;
		for (let i = edits.length - 1; i >= 0; i--) {
			let change = edits[i];
			let head = result.slice(0, change.span.start);
			let tail = result.slice(change.span.start + change.span.length);
			result = head + change.newText + tail;
		}
		return result;
	}
}

function createReplacerFromDirectives(directives: [RegExp, string][]): (str: string) => string {
	return (str: string) => {
		for (let i = 0; i < directives.length; i++) {
			str = str.replace(directives[i][0], directives[i][1]);
		}
		return str;
	};
}

function createReplacer(data: string): (str: string) => string {
	data = data || '';
	let rawDirectives = data.split(';');
	let directives: [RegExp, string][] = [];
	rawDirectives.forEach((rawDirective) => {
		if (rawDirective.length === 0) {
			return;
		}
		let pieces = rawDirective.split('=>');
		let findStr = pieces[0];
		let replaceStr = pieces[1];

		findStr = findStr.replace(/[\-\\\{\}\*\+\?\|\^\$\.\,\[\]\(\)\#\s]/g, '\\$&');
		findStr = '\\b' + findStr + '\\b';
		directives.push([new RegExp(findStr, 'g'), replaceStr]);
	});

	return createReplacerFromDirectives(directives);
}

interface ITempResult {
	result: string;
	usageContent: string;
	enums: string;
}

interface IEnumEntry {
	enumName: string;
	text: string;
}

function generateDeclarationFile(recipe: string, sourceFileGetter: SourceFileGetter): ITempResult | null {
	const endl = /\r\n/.test(recipe) ? '\r\n' : '\n';

	let lines = recipe.split(endl);
	let result: string[] = [];

	let usageCounter = 0;
	let usageImports: string[] = [];
	let usage: string[] = [];

	let failed = false;

	usage.push(`var a: any;`);
	usage.push(`var b: any;`);

	const generateUsageImport = (moduleId: string) => {
		let importName = 'm' + (++usageCounter);
		usageImports.push(`import * as ${importName} from './${moduleId.replace(/\.d\.ts$/, '')}';`);
		return importName;
	};

	let enums: IEnumEntry[] = [];
	let version: string | null = null;

	lines.forEach(line => {

		if (failed) {
			return;
		}

		let m0 = line.match(/^\/\/dtsv=(\d+)$/);
		if (m0) {
			version = m0[1];
		}

		let m1 = line.match(/^\s*#include\(([^;)]*)(;[^)]*)?\)\:(.*)$/);
		if (m1) {
			let moduleId = m1[1];
			const sourceFile = sourceFileGetter(moduleId);
			if (!sourceFile) {
				logErr(`While handling ${line}`);
				logErr(`Cannot find ${moduleId}`);
				failed = true;
				return;
			}

			const importName = generateUsageImport(moduleId);

			let replacer = createReplacer(m1[2]);

			let typeNames = m1[3].split(/,/);
			typeNames.forEach((typeName) => {
				typeName = typeName.trim();
				if (typeName.length === 0) {
					return;
				}
				let declaration = getTopLevelDeclaration(sourceFile, typeName);
				if (!declaration) {
					logErr(`While handling ${line}`);
					logErr(`Cannot find ${typeName}`);
					failed = true;
					return;
				}
				result.push(replacer(getMassagedTopLevelDeclarationText(sourceFile, declaration, importName, usage, enums)));
			});
			return;
		}

		let m2 = line.match(/^\s*#includeAll\(([^;)]*)(;[^)]*)?\)\:(.*)$/);
		if (m2) {
			let moduleId = m2[1];
			const sourceFile = sourceFileGetter(moduleId);
			if (!sourceFile) {
				logErr(`While handling ${line}`);
				logErr(`Cannot find ${moduleId}`);
				failed = true;
				return;
			}

			const importName = generateUsageImport(moduleId);

			let replacer = createReplacer(m2[2]);

			let typeNames = m2[3].split(/,/);
			let typesToExcludeMap: { [typeName: string]: boolean; } = {};
			let typesToExcludeArr: string[] = [];
			typeNames.forEach((typeName) => {
				typeName = typeName.trim();
				if (typeName.length === 0) {
					return;
				}
				typesToExcludeMap[typeName] = true;
				typesToExcludeArr.push(typeName);
			});

			getAllTopLevelDeclarations(sourceFile).forEach((declaration) => {
				if (isDeclaration(declaration) && declaration.name) {
					if (typesToExcludeMap[declaration.name.text]) {
						return;
					}
				} else {
					// node is ts.VariableStatement
					let nodeText = getNodeText(sourceFile, declaration);
					for (let i = 0; i < typesToExcludeArr.length; i++) {
						if (nodeText.indexOf(typesToExcludeArr[i]) >= 0) {
							return;
						}
					}
				}
				result.push(replacer(getMassagedTopLevelDeclarationText(sourceFile, declaration, importName, usage, enums)));
			});
			return;
		}

		result.push(line);
	});

	if (failed) {
		return null;
	}

	if (version !== dtsv) {
		if (!version) {
			logErr(`gulp watch restart required. 'monaco.d.ts.recipe' is written before versioning was introduced.`);
		} else {
			logErr(`gulp watch restart required. 'monaco.d.ts.recipe' v${version} does not match runtime v${dtsv}.`);
		}
		return null;
	}

	let resultTxt = result.join(endl);
	resultTxt = resultTxt.replace(/\bURI\b/g, 'Uri');
	resultTxt = resultTxt.replace(/\bEvent</g, 'IEvent<');
	resultTxt = resultTxt.split(/\r\n|\n|\r/).join(endl);
	resultTxt = format(resultTxt, endl);
	resultTxt = resultTxt.split(/\r\n|\n|\r/).join(endl);

	enums.sort((e1, e2) => {
		if (e1.enumName < e2.enumName) {
			return -1;
		}
		if (e1.enumName > e2.enumName) {
			return 1;
		}
		return 0;
	});

	let resultEnums = [
		'/*---------------------------------------------------------------------------------------------',
		' *  Copyright (c) Microsoft Corporation.',
		' *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.',
		' *--------------------------------------------------------------------------------------------*/',
		'',
		'// THIS IS A GENERATED FILE. DO NOT EDIT DIRECTLY.',
		''
	].concat(enums.map(e => e.text)).join(endl);
	resultEnums = resultEnums.split(/\r\n|\n|\r/).join(endl);
	resultEnums = format(resultEnums, endl);
	resultEnums = resultEnums.split(/\r\n|\n|\r/).join(endl);

	return {
		result: resultTxt,
		usageContent: `${usageImports.join('\n')}\n\n${usage.join('\n')}`,
		enums: resultEnums
	};
}

export interface IMonacoDeclarationResult {
	content: string;
	usageContent: string;
	enums: string;
	filePath: string;
	isTheSame: boolean;
}

function _run(sourceFileGetter: SourceFileGetter): IMonacoDeclarationResult | null {
	const recipe = fs.readFileSync(RECIPE_PATH).toString();
	const t = generateDeclarationFile(recipe, sourceFileGetter);
	if (!t) {
		return null;
	}

	const result = t.result;
	const usageContent = t.usageContent;
	const enums = t.enums;

	const currentContent = fs.readFileSync(DECLARATION_PATH).toString();
	const one = currentContent.replace(/\r\n/gm, '\n');
	const other = result.replace(/\r\n/gm, '\n');
	const isTheSame = (one === other);

	return {
		content: result,
		usageContent: usageContent,
		enums: enums,
		filePath: DECLARATION_PATH,
		isTheSame
	};
}

export class FSProvider {
	public existsSync(filePath: string): boolean {
		return fs.existsSync(filePath);
	}
	public statSync(filePath: string): fs.Stats {
		return fs.statSync(filePath);
	}
	public readFileSync(_moduleId: string, filePath: string): Buffer {
		return fs.readFileSync(filePath);
	}
}

class CacheEntry {
	constructor(
		public readonly sourceFile: ts.SourceFile,
		public readonly mtime: number
	) {}
}

export class DeclarationResolver {

	private _sourceFileCache: { [moduleId: string]: CacheEntry | null; };

	constructor(private readonly _fsProvider: FSProvider) {
		this._sourceFileCache = Object.create(null);
	}

	public invalidateCache(moduleId: string): void {
		this._sourceFileCache[moduleId] = null;
	}

	public getDeclarationSourceFile(moduleId: string): ts.SourceFile | null {
		if (this._sourceFileCache[moduleId]) {
			// Since we cannot trust file watching to invalidate the cache, check also the mtime
			const fileName = this._getFileName(moduleId);
			const mtime = this._fsProvider.statSync(fileName).mtime.getTime();
			if (this._sourceFileCache[moduleId]!.mtime !== mtime) {
				this._sourceFileCache[moduleId] = null;
			}
		}
		if (!this._sourceFileCache[moduleId]) {
			this._sourceFileCache[moduleId] = this._getDeclarationSourceFile(moduleId);
		}
		return this._sourceFileCache[moduleId] ? this._sourceFileCache[moduleId]!.sourceFile : null;
	}

	private _getFileName(moduleId: string): string {
		if (/\.d\.ts$/.test(moduleId)) {
			return path.join(SRC, moduleId);
		}
		return path.join(SRC, `${moduleId}.ts`);
	}

	private _getDeclarationSourceFile(moduleId: string): CacheEntry | null {
		const fileName = this._getFileName(moduleId);
		if (!this._fsProvider.existsSync(fileName)) {
			return null;
		}
		const mtime = this._fsProvider.statSync(fileName).mtime.getTime();
		if (/\.d\.ts$/.test(moduleId)) {
			// const mtime = this._fsProvider.statFileSync()
			const fileContents = this._fsProvider.readFileSync(moduleId, fileName).toString();
			return new CacheEntry(
				ts.createSourceFile(fileName, fileContents, ts.ScriptTarget.ES5),
				mtime
			);
		}
		const fileContents = this._fsProvider.readFileSync(moduleId, fileName).toString();
		const fileMap: IFileMap = {
			'file.ts': fileContents
		};
		const service = ts.createLanguageService(new TypeScriptLanguageServiceHost({}, fileMap, {}));
		const text = service.getEmitOutput('file.ts', true, true).outputFiles[0].text;
		return new CacheEntry(
			ts.createSourceFile(fileName, text, ts.ScriptTarget.ES5),
			mtime
		);
	}
}

export function run3(resolver: DeclarationResolver): IMonacoDeclarationResult | null {
	const sourceFileGetter = (moduleId: string) => resolver.getDeclarationSourceFile(moduleId);
	return _run(sourceFileGetter);
}




interface ILibMap { [libName: string]: string; }
interface IFileMap { [fileName: string]: string; }

class TypeScriptLanguageServiceHost implements ts.LanguageServiceHost {

	private readonly _libs: ILibMap;
	private readonly _files: IFileMap;
	private readonly _compilerOptions: ts.CompilerOptions;

	constructor(libs: ILibMap, files: IFileMap, compilerOptions: ts.CompilerOptions) {
		this._libs = libs;
		this._files = files;
		this._compilerOptions = compilerOptions;
	}

	// --- language service host ---------------

	getCompilationSettings(): ts.CompilerOptions {
		return this._compilerOptions;
	}
	getScriptFileNames(): string[] {
		return (
			([] as string[])
				.concat(Object.keys(this._libs))
				.concat(Object.keys(this._files))
		);
	}
	getScriptVersion(_fileName: string): string {
		return '1';
	}
	getProjectVersion(): string {
		return '1';
	}
	getScriptSnapshot(fileName: string): ts.IScriptSnapshot {
		if (this._files.hasOwnProperty(fileName)) {
			return ts.ScriptSnapshot.fromString(this._files[fileName]);
		} else if (this._libs.hasOwnProperty(fileName)) {
			return ts.ScriptSnapshot.fromString(this._libs[fileName]);
		} else {
			return ts.ScriptSnapshot.fromString('');
		}
	}
	getScriptKind(_fileName: string): ts.ScriptKind {
		return ts.ScriptKind.TS;
	}
	getCurrentDirectory(): string {
		return '';
	}
	getDefaultLibFileName(_options: ts.CompilerOptions): string {
		return 'defaultLib:es5';
	}
	isDefaultLibFileName(fileName: string): boolean {
		return fileName === this.getDefaultLibFileName(this._compilerOptions);
	}
}

export function execute(): IMonacoDeclarationResult {
	let r = run3(new DeclarationResolver(new FSProvider()));
	if (!r) {
		throw new Error(`monaco.d.ts generation error - Cannot continue`);
	}
	return r;
}
