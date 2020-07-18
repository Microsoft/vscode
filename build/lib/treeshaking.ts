/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const TYPESCRIPT_LIB_FOLDER = path.dirname(require.resolve('typescript/lib/lib.d.ts'));

export const enum ShakeLevel {
	Files = 0,
	InnerFile = 1,
	ClassMembers = 2
}

export function toStringShakeLevel(shakeLevel: ShakeLevel): string {
	switch (shakeLevel) {
		case ShakeLevel.Files:
			return 'Files (0)';
		case ShakeLevel.InnerFile:
			return 'InnerFile (1)';
		case ShakeLevel.ClassMembers:
			return 'ClassMembers (2)';
	}
}

export interface ITreeShakingOptions {
	/**
	 * The full path to the root where sources are.
	 */
	sourcesRoot: string;
	/**
	 * Module ids.
	 * e.g. `vs/editor/editor.main` or `index`
	 */
	entryPoints: string[];
	/**
	 * Inline usages.
	 */
	inlineEntryPoints: string[];
	/**
	 * Other .d.ts files
	 */
	typings: string[];
	/**
	 * TypeScript compiler options.
	 */
	compilerOptions?: any;
	/**
	 * The shake level to perform.
	 */
	shakeLevel: ShakeLevel;
	/**
	 * regex pattern to ignore certain imports e.g. `vs/css!` imports
	 */
	importIgnorePattern: RegExp;

	redirects: { [module: string]: string; };
}

export interface ITreeShakingResult {
	[file: string]: string;
}

function printDiagnostics(options: ITreeShakingOptions, diagnostics: ReadonlyArray<ts.Diagnostic>): void {
	for (const diag of diagnostics) {
		let result = '';
		if (diag.file) {
			result += `${path.join(options.sourcesRoot, diag.file.fileName)}`;
		}
		if (diag.file && diag.start) {
			let location = diag.file.getLineAndCharacterOfPosition(diag.start);
			result += `:${location.line + 1}:${location.character}`;
		}
		result += ` - ` + JSON.stringify(diag.messageText);
		console.log(result);
	}
}

export function shake(options: ITreeShakingOptions): ITreeShakingResult {
	const languageService = createTypeScriptLanguageService(options);
	const program = languageService.getProgram()!;

	const globalDiagnostics = program.getGlobalDiagnostics();
	if (globalDiagnostics.length > 0) {
		printDiagnostics(options, globalDiagnostics);
		throw new Error(`Compilation Errors encountered.`);
	}

	const syntacticDiagnostics = program.getSyntacticDiagnostics();
	if (syntacticDiagnostics.length > 0) {
		printDiagnostics(options, syntacticDiagnostics);
		throw new Error(`Compilation Errors encountered.`);
	}

	const semanticDiagnostics = program.getSemanticDiagnostics();
	if (semanticDiagnostics.length > 0) {
		printDiagnostics(options, semanticDiagnostics);
		throw new Error(`Compilation Errors encountered.`);
	}

	markNodes(languageService, options);

	return generateResult(languageService, options.shakeLevel);
}

//#region Discovery, LanguageService & Setup
function createTypeScriptLanguageService(options: ITreeShakingOptions): ts.LanguageService {
	// Discover referenced files
	const FILES = discoverAndReadFiles(options);

	// Add fake usage files
	options.inlineEntryPoints.forEach((inlineEntryPoint, index) => {
		FILES[`inlineEntryPoint.${index}.ts`] = inlineEntryPoint;
	});

	// Add additional typings
	options.typings.forEach((typing) => {
		const filePath = path.join(options.sourcesRoot, typing);
		FILES[typing] = fs.readFileSync(filePath).toString();
	});

	// Resolve libs
	const RESOLVED_LIBS = processLibFiles(options);

	const compilerOptions = ts.convertCompilerOptionsFromJson(options.compilerOptions, options.sourcesRoot).options;

	const host = new TypeScriptLanguageServiceHost(RESOLVED_LIBS, FILES, compilerOptions);
	return ts.createLanguageService(host);
}

/**
 * Read imports and follow them until all files have been handled
 */
function discoverAndReadFiles(options: ITreeShakingOptions): IFileMap {
	const FILES: IFileMap = {};

	const in_queue: { [module: string]: boolean; } = Object.create(null);
	const queue: string[] = [];

	const enqueue = (moduleId: string) => {
		if (in_queue[moduleId]) {
			return;
		}
		in_queue[moduleId] = true;
		queue.push(moduleId);
	};

	options.entryPoints.forEach((entryPoint) => enqueue(entryPoint));

	while (queue.length > 0) {
		const moduleId = queue.shift()!;
		const dts_filename = path.join(options.sourcesRoot, moduleId + '.d.ts');
		if (fs.existsSync(dts_filename)) {
			const dts_filecontents = fs.readFileSync(dts_filename).toString();
			FILES[`${moduleId}.d.ts`] = dts_filecontents;
			continue;
		}

		const js_filename = path.join(options.sourcesRoot, moduleId + '.js');
		if (fs.existsSync(js_filename)) {
			// This is an import for a .js file, so ignore it...
			continue;
		}

		let ts_filename: string;
		if (options.redirects[moduleId]) {
			ts_filename = path.join(options.sourcesRoot, options.redirects[moduleId] + '.ts');
		} else {
			ts_filename = path.join(options.sourcesRoot, moduleId + '.ts');
		}
		const ts_filecontents = fs.readFileSync(ts_filename).toString();
		const info = ts.preProcessFile(ts_filecontents);
		for (let i = info.importedFiles.length - 1; i >= 0; i--) {
			const importedFileName = info.importedFiles[i].fileName;

			if (options.importIgnorePattern.test(importedFileName)) {
				// Ignore vs/css! imports
				continue;
			}

			let importedModuleId = importedFileName;
			if (/(^\.\/)|(^\.\.\/)/.test(importedModuleId)) {
				importedModuleId = path.join(path.dirname(moduleId), importedModuleId);
			}
			enqueue(importedModuleId);
		}

		FILES[`${moduleId}.ts`] = ts_filecontents;
	}

	return FILES;
}

/**
 * Read lib files and follow lib references
 */
function processLibFiles(options: ITreeShakingOptions): ILibMap {

	const stack: string[] = [...options.compilerOptions.lib];
	const result: ILibMap = {};

	while (stack.length > 0) {
		const filename = `lib.${stack.shift()!.toLowerCase()}.d.ts`;
		const key = `defaultLib:${filename}`;
		if (!result[key]) {
			// add this file
			const filepath = path.join(TYPESCRIPT_LIB_FOLDER, filename);
			const sourceText = fs.readFileSync(filepath).toString();
			result[key] = sourceText;

			// precess dependencies and "recurse"
			const info = ts.preProcessFile(sourceText);
			for (let ref of info.libReferenceDirectives) {
				stack.push(ref.fileName);
			}
		}
	}

	return result;
}

interface ILibMap { [libName: string]: string; }
interface IFileMap { [fileName: string]: string; }

/**
 * A TypeScript language service host
 */
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
		return 'defaultLib:lib.d.ts';
	}
	isDefaultLibFileName(fileName: string): boolean {
		return fileName === this.getDefaultLibFileName(this._compilerOptions);
	}
}
//#endregion

//#region Tree Shaking

const enum NodeColor {
	White = 0,
	Gray = 1,
	Black = 2
}

function getColor(node: ts.Node): NodeColor {
	return (<any>node).$$$color || NodeColor.White;
}
function setColor(node: ts.Node, color: NodeColor): void {
	(<any>node).$$$color = color;
}
function nodeOrParentIsBlack(node: ts.Node): boolean {
	while (node) {
		const color = getColor(node);
		if (color === NodeColor.Black) {
			return true;
		}
		node = node.parent;
	}
	return false;
}
function nodeOrChildIsBlack(node: ts.Node): boolean {
	if (getColor(node) === NodeColor.Black) {
		return true;
	}
	for (const child of node.getChildren()) {
		if (nodeOrChildIsBlack(child)) {
			return true;
		}
	}
	return false;
}

function markNodes(languageService: ts.LanguageService, options: ITreeShakingOptions) {
	const program = languageService.getProgram();
	if (!program) {
		throw new Error('Could not get program from language service');
	}

	if (options.shakeLevel === ShakeLevel.Files) {
		// Mark all source files Black
		program.getSourceFiles().forEach((sourceFile) => {
			setColor(sourceFile, NodeColor.Black);
		});
		return;
	}

	const black_queue: ts.Node[] = [];
	const gray_queue: ts.Node[] = [];
	const export_import_queue: ts.Node[] = [];
	const sourceFilesLoaded: { [fileName: string]: boolean } = {};

	function enqueueTopLevelModuleStatements(sourceFile: ts.SourceFile): void {

		sourceFile.forEachChild((node: ts.Node) => {

			if (ts.isImportDeclaration(node)) {
				if (!node.importClause && ts.isStringLiteral(node.moduleSpecifier)) {
					setColor(node, NodeColor.Black);
					enqueueImport(node, node.moduleSpecifier.text);
				}
				return;
			}

			if (ts.isExportDeclaration(node)) {
				if (!node.exportClause && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
					// export * from "foo";
					setColor(node, NodeColor.Black);
					enqueueImport(node, node.moduleSpecifier.text);
				}
				if (node.exportClause && ts.isNamedExports(node.exportClause)) {
					for (const exportSpecifier of node.exportClause.elements) {
						export_import_queue.push(exportSpecifier);
					}
				}
				return;
			}

			if (
				ts.isExpressionStatement(node)
				|| ts.isIfStatement(node)
				|| ts.isIterationStatement(node, true)
				|| ts.isExportAssignment(node)
			) {
				enqueue_black(node);
			}

			if (ts.isImportEqualsDeclaration(node)) {
				if (/export/.test(node.getFullText(sourceFile))) {
					// e.g. "export import Severity = BaseSeverity;"
					enqueue_black(node);
				}
			}

		});
	}

	function enqueue_gray(node: ts.Node): void {
		if (nodeOrParentIsBlack(node) || getColor(node) === NodeColor.Gray) {
			return;
		}
		setColor(node, NodeColor.Gray);
		gray_queue.push(node);
	}

	function enqueue_black(node: ts.Node): void {
		const previousColor = getColor(node);

		if (previousColor === NodeColor.Black) {
			return;
		}

		if (previousColor === NodeColor.Gray) {
			// remove from gray queue
			gray_queue.splice(gray_queue.indexOf(node), 1);
			setColor(node, NodeColor.White);

			// add to black queue
			enqueue_black(node);

			// // move from one queue to the other
			// black_queue.push(node);
			// setColor(node, NodeColor.Black);
			return;
		}

		if (nodeOrParentIsBlack(node)) {
			return;
		}

		const fileName = node.getSourceFile().fileName;
		if (/^defaultLib:/.test(fileName) || /\.d\.ts$/.test(fileName)) {
			setColor(node, NodeColor.Black);
			return;
		}

		const sourceFile = node.getSourceFile();
		if (!sourceFilesLoaded[sourceFile.fileName]) {
			sourceFilesLoaded[sourceFile.fileName] = true;
			enqueueTopLevelModuleStatements(sourceFile);
		}

		if (ts.isSourceFile(node)) {
			return;
		}

		setColor(node, NodeColor.Black);
		black_queue.push(node);

		if (options.shakeLevel === ShakeLevel.ClassMembers && (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node))) {
			const references = languageService.getReferencesAtPosition(node.getSourceFile().fileName, node.name.pos + node.name.getLeadingTriviaWidth());
			if (references) {
				for (let i = 0, len = references.length; i < len; i++) {
					const reference = references[i];
					const referenceSourceFile = program!.getSourceFile(reference.fileName);
					if (!referenceSourceFile) {
						continue;
					}

					const referenceNode = getTokenAtPosition(referenceSourceFile, reference.textSpan.start, false, false);
					if (
						ts.isMethodDeclaration(referenceNode.parent)
						|| ts.isPropertyDeclaration(referenceNode.parent)
						|| ts.isGetAccessor(referenceNode.parent)
						|| ts.isSetAccessor(referenceNode.parent)
					) {
						enqueue_gray(referenceNode.parent);
					}
				}
			}
		}
	}

	function enqueueFile(filename: string): void {
		const sourceFile = program!.getSourceFile(filename);
		if (!sourceFile) {
			console.warn(`Cannot find source file ${filename}`);
			return;
		}
		enqueue_black(sourceFile);
	}

	function enqueueImport(node: ts.Node, importText: string): void {
		if (options.importIgnorePattern.test(importText)) {
			// this import should be ignored
			return;
		}

		const nodeSourceFile = node.getSourceFile();
		let fullPath: string;
		if (/(^\.\/)|(^\.\.\/)/.test(importText)) {
			fullPath = path.join(path.dirname(nodeSourceFile.fileName), importText) + '.ts';
		} else {
			fullPath = importText + '.ts';
		}
		enqueueFile(fullPath);
	}

	options.entryPoints.forEach(moduleId => enqueueFile(moduleId + '.ts'));
	// Add fake usage files
	options.inlineEntryPoints.forEach((_, index) => enqueueFile(`inlineEntryPoint.${index}.ts`));

	let step = 0;

	const checker = program.getTypeChecker();
	while (black_queue.length > 0 || gray_queue.length > 0) {
		++step;
		let node: ts.Node;

		if (step % 100 === 0) {
			console.log(`Treeshaking - ${Math.floor(100 * step / (step + black_queue.length + gray_queue.length))}% - ${step}/${step + black_queue.length + gray_queue.length} (${black_queue.length}, ${gray_queue.length})`);
		}

		if (black_queue.length === 0) {
			for (let i = 0; i < gray_queue.length; i++) {
				const node = gray_queue[i];
				const nodeParent = node.parent;
				if ((ts.isClassDeclaration(nodeParent) || ts.isInterfaceDeclaration(nodeParent)) && nodeOrChildIsBlack(nodeParent)) {
					gray_queue.splice(i, 1);
					black_queue.push(node);
					setColor(node, NodeColor.Black);
					i--;
				}
			}
		}

		if (black_queue.length > 0) {
			node = black_queue.shift()!;
		} else {
			// only gray nodes remaining...
			break;
		}
		const nodeSourceFile = node.getSourceFile();

		const loop = (node: ts.Node) => {
			const [symbol, symbolImportNode] = getRealNodeSymbol(checker, node);
			if (symbolImportNode) {
				setColor(symbolImportNode, NodeColor.Black);
			}

			if (symbol && !nodeIsInItsOwnDeclaration(nodeSourceFile, node, symbol)) {
				for (let i = 0, len = symbol.declarations.length; i < len; i++) {
					const declaration = symbol.declarations[i];
					if (ts.isSourceFile(declaration)) {
						// Do not enqueue full source files
						// (they can be the declaration of a module import)
						continue;
					}

					if (options.shakeLevel === ShakeLevel.ClassMembers && (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) && !isLocalCodeExtendingOrInheritingFromDefaultLibSymbol(program, checker, declaration)) {
						enqueue_black(declaration.name!);

						for (let j = 0; j < declaration.members.length; j++) {
							const member = declaration.members[j];
							const memberName = member.name ? member.name.getText() : null;
							if (
								ts.isConstructorDeclaration(member)
								|| ts.isConstructSignatureDeclaration(member)
								|| ts.isIndexSignatureDeclaration(member)
								|| ts.isCallSignatureDeclaration(member)
								|| memberName === '[Symbol.iterator]'
								|| memberName === '[Symbol.toStringTag]'
								|| memberName === 'toJSON'
								|| memberName === 'toString'
								|| memberName === 'dispose'// TODO: keeping all `dispose` methods
								|| /^_(.*)Brand$/.test(memberName || '') // TODO: keeping all members ending with `Brand`...
							) {
								enqueue_black(member);
							}
						}

						// queue the heritage clauses
						if (declaration.heritageClauses) {
							for (let heritageClause of declaration.heritageClauses) {
								enqueue_black(heritageClause);
							}
						}
					} else {
						enqueue_black(declaration);
					}
				}
			}
			node.forEachChild(loop);
		};
		node.forEachChild(loop);
	}

	while (export_import_queue.length > 0) {
		const node = export_import_queue.shift()!;
		if (nodeOrParentIsBlack(node)) {
			continue;
		}
		const symbol: ts.Symbol | undefined = (<any>node).symbol;
		if (!symbol) {
			continue;
		}
		const aliased = checker.getAliasedSymbol(symbol);
		if (aliased.declarations && aliased.declarations.length > 0) {
			if (nodeOrParentIsBlack(aliased.declarations[0]) || nodeOrChildIsBlack(aliased.declarations[0])) {
				setColor(node, NodeColor.Black);
			}
		}
	}
}

function nodeIsInItsOwnDeclaration(nodeSourceFile: ts.SourceFile, node: ts.Node, symbol: ts.Symbol): boolean {
	for (let i = 0, len = symbol.declarations.length; i < len; i++) {
		const declaration = symbol.declarations[i];
		const declarationSourceFile = declaration.getSourceFile();

		if (nodeSourceFile === declarationSourceFile) {
			if (declaration.pos <= node.pos && node.end <= declaration.end) {
				return true;
			}
		}
	}

	return false;
}

function generateResult(languageService: ts.LanguageService, shakeLevel: ShakeLevel): ITreeShakingResult {
	const program = languageService.getProgram();
	if (!program) {
		throw new Error('Could not get program from language service');
	}

	let result: ITreeShakingResult = {};
	const writeFile = (filePath: string, contents: string): void => {
		result[filePath] = contents;
	};

	program.getSourceFiles().forEach((sourceFile) => {
		const fileName = sourceFile.fileName;
		if (/^defaultLib:/.test(fileName)) {
			return;
		}
		const destination = fileName;
		if (/\.d\.ts$/.test(fileName)) {
			if (nodeOrChildIsBlack(sourceFile)) {
				writeFile(destination, sourceFile.text);
			}
			return;
		}

		let text = sourceFile.text;
		let result = '';

		function keep(node: ts.Node): void {
			result += text.substring(node.pos, node.end);
		}
		function write(data: string): void {
			result += data;
		}

		function writeMarkedNodes(node: ts.Node): void {
			if (getColor(node) === NodeColor.Black) {
				return keep(node);
			}

			// Always keep certain top-level statements
			if (ts.isSourceFile(node.parent)) {
				if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'use strict') {
					return keep(node);
				}

				if (ts.isVariableStatement(node) && nodeOrChildIsBlack(node)) {
					return keep(node);
				}
			}

			// Keep the entire import in import * as X cases
			if (ts.isImportDeclaration(node)) {
				if (node.importClause && node.importClause.namedBindings) {
					if (ts.isNamespaceImport(node.importClause.namedBindings)) {
						if (getColor(node.importClause.namedBindings) === NodeColor.Black) {
							return keep(node);
						}
					} else {
						let survivingImports: string[] = [];
						for (const importNode of node.importClause.namedBindings.elements) {
							if (getColor(importNode) === NodeColor.Black) {
								survivingImports.push(importNode.getFullText(sourceFile));
							}
						}
						const leadingTriviaWidth = node.getLeadingTriviaWidth();
						const leadingTrivia = sourceFile.text.substr(node.pos, leadingTriviaWidth);
						if (survivingImports.length > 0) {
							if (node.importClause && node.importClause.name && getColor(node.importClause) === NodeColor.Black) {
								return write(`${leadingTrivia}import ${node.importClause.name.text}, {${survivingImports.join(',')} } from${node.moduleSpecifier.getFullText(sourceFile)};`);
							}
							return write(`${leadingTrivia}import {${survivingImports.join(',')} } from${node.moduleSpecifier.getFullText(sourceFile)};`);
						} else {
							if (node.importClause && node.importClause.name && getColor(node.importClause) === NodeColor.Black) {
								return write(`${leadingTrivia}import ${node.importClause.name.text} from${node.moduleSpecifier.getFullText(sourceFile)};`);
							}
						}
					}
				} else {
					if (node.importClause && getColor(node.importClause) === NodeColor.Black) {
						return keep(node);
					}
				}
			}

			if (ts.isExportDeclaration(node)) {
				if (node.exportClause && node.moduleSpecifier && ts.isNamedExports(node.exportClause)) {
					let survivingExports: string[] = [];
					for (const exportSpecifier of node.exportClause.elements) {
						if (getColor(exportSpecifier) === NodeColor.Black) {
							survivingExports.push(exportSpecifier.getFullText(sourceFile));
						}
					}
					const leadingTriviaWidth = node.getLeadingTriviaWidth();
					const leadingTrivia = sourceFile.text.substr(node.pos, leadingTriviaWidth);
					if (survivingExports.length > 0) {
						return write(`${leadingTrivia}export {${survivingExports.join(',')} } from${node.moduleSpecifier.getFullText(sourceFile)};`);
					}
				}
			}

			if (shakeLevel === ShakeLevel.ClassMembers && (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && nodeOrChildIsBlack(node)) {
				let toWrite = node.getFullText();
				for (let i = node.members.length - 1; i >= 0; i--) {
					const member = node.members[i];
					if (getColor(member) === NodeColor.Black || !member.name) {
						// keep method
						continue;
					}

					let pos = member.pos - node.pos;
					let end = member.end - node.pos;
					toWrite = toWrite.substring(0, pos) + toWrite.substring(end);
				}
				return write(toWrite);
			}

			if (ts.isFunctionDeclaration(node)) {
				// Do not go inside functions if they haven't been marked
				return;
			}

			node.forEachChild(writeMarkedNodes);
		}

		if (getColor(sourceFile) !== NodeColor.Black) {
			if (!nodeOrChildIsBlack(sourceFile)) {
				// none of the elements are reachable => don't write this file at all!
				return;
			}
			sourceFile.forEachChild(writeMarkedNodes);
			result += sourceFile.endOfFileToken.getFullText(sourceFile);
		} else {
			result = text;
		}

		writeFile(destination, result);
	});

	return result;
}

//#endregion

//#region Utils

function isLocalCodeExtendingOrInheritingFromDefaultLibSymbol(program: ts.Program, checker: ts.TypeChecker, declaration: ts.ClassDeclaration | ts.InterfaceDeclaration): boolean {
	if (!program.isSourceFileDefaultLibrary(declaration.getSourceFile()) && declaration.heritageClauses) {
		for (const heritageClause of declaration.heritageClauses) {
			for (const type of heritageClause.types) {
				const symbol = findSymbolFromHeritageType(checker, type);
				if (symbol) {
					const decl = symbol.valueDeclaration || (symbol.declarations && symbol.declarations[0]);
					if (decl && program.isSourceFileDefaultLibrary(decl.getSourceFile())) {
						return true;
					}
				}
			}
		}
	}
	return false;
}

function findSymbolFromHeritageType(checker: ts.TypeChecker, type: ts.ExpressionWithTypeArguments | ts.Expression | ts.PrivateIdentifier): ts.Symbol | null {
	if (ts.isExpressionWithTypeArguments(type)) {
		return findSymbolFromHeritageType(checker, type.expression);
	}
	if (ts.isIdentifier(type)) {
		return getRealNodeSymbol(checker, type)[0];
	}
	if (ts.isPropertyAccessExpression(type)) {
		return findSymbolFromHeritageType(checker, type.name);
	}
	return null;
}

/**
 * Returns the node's symbol and the `import` node (if the symbol resolved from a different module)
 */
function getRealNodeSymbol(checker: ts.TypeChecker, node: ts.Node): [ts.Symbol | null, ts.Declaration | null] {

	// Use some TypeScript internals to avoid code duplication
	type ObjectLiteralElementWithName = ts.ObjectLiteralElement & { name: ts.PropertyName; parent: ts.ObjectLiteralExpression | ts.JsxAttributes };
	const getPropertySymbolsFromContextualType: (node: ObjectLiteralElementWithName, checker: ts.TypeChecker, contextualType: ts.Type, unionSymbolOk: boolean) => ReadonlyArray<ts.Symbol> = (<any>ts).getPropertySymbolsFromContextualType;
	const getContainingObjectLiteralElement: (node: ts.Node) => ObjectLiteralElementWithName | undefined = (<any>ts).getContainingObjectLiteralElement;
	const getNameFromPropertyName: (name: ts.PropertyName) => string | undefined = (<any>ts).getNameFromPropertyName;

	// Go to the original declaration for cases:
	//
	//   (1) when the aliased symbol was declared in the location(parent).
	//   (2) when the aliased symbol is originating from an import.
	//
	function shouldSkipAlias(node: ts.Node, declaration: ts.Node): boolean {
		if (!ts.isShorthandPropertyAssignment(node) && node.kind !== ts.SyntaxKind.Identifier) {
			return false;
		}
		if (node.parent === declaration) {
			return true;
		}
		switch (declaration.kind) {
			case ts.SyntaxKind.ImportClause:
			case ts.SyntaxKind.ImportEqualsDeclaration:
				return true;
			case ts.SyntaxKind.ImportSpecifier:
				return declaration.parent.kind === ts.SyntaxKind.NamedImports;
			default:
				return false;
		}
	}

	if (!ts.isShorthandPropertyAssignment(node)) {
		if (node.getChildCount() !== 0) {
			return [null, null];
		}
	}

	const { parent } = node;

	let symbol = (
		ts.isShorthandPropertyAssignment(node)
			? checker.getShorthandAssignmentValueSymbol(node)
			: checker.getSymbolAtLocation(node)
	);

	let importNode: ts.Declaration | null = null;
	// If this is an alias, and the request came at the declaration location
	// get the aliased symbol instead. This allows for goto def on an import e.g.
	//   import {A, B} from "mod";
	// to jump to the implementation directly.
	if (symbol && symbol.flags & ts.SymbolFlags.Alias && shouldSkipAlias(node, symbol.declarations[0])) {
		const aliased = checker.getAliasedSymbol(symbol);
		if (aliased.declarations) {
			// We should mark the import as visited
			importNode = symbol.declarations[0];
			symbol = aliased;
		}
	}

	if (symbol) {
		// Because name in short-hand property assignment has two different meanings: property name and property value,
		// using go-to-definition at such position should go to the variable declaration of the property value rather than
		// go to the declaration of the property name (in this case stay at the same position). However, if go-to-definition
		// is performed at the location of property access, we would like to go to definition of the property in the short-hand
		// assignment. This case and others are handled by the following code.
		if (node.parent.kind === ts.SyntaxKind.ShorthandPropertyAssignment) {
			symbol = checker.getShorthandAssignmentValueSymbol(symbol.valueDeclaration);
		}

		// If the node is the name of a BindingElement within an ObjectBindingPattern instead of just returning the
		// declaration the symbol (which is itself), we should try to get to the original type of the ObjectBindingPattern
		// and return the property declaration for the referenced property.
		// For example:
		//      import('./foo').then(({ b/*goto*/ar }) => undefined); => should get use to the declaration in file "./foo"
		//
		//      function bar<T>(onfulfilled: (value: T) => void) { //....}
		//      interface Test {
		//          pr/*destination*/op1: number
		//      }
		//      bar<Test>(({pr/*goto*/op1})=>{});
		if (ts.isPropertyName(node) && ts.isBindingElement(parent) && ts.isObjectBindingPattern(parent.parent) &&
			(node === (parent.propertyName || parent.name))) {
			const name = getNameFromPropertyName(node);
			const type = checker.getTypeAtLocation(parent.parent);
			if (name && type) {
				if (type.isUnion()) {
					const prop = type.types[0].getProperty(name);
					if (prop) {
						symbol = prop;
					}
				} else {
					const prop = type.getProperty(name);
					if (prop) {
						symbol = prop;
					}
				}
			}
		}

		// If the current location we want to find its definition is in an object literal, try to get the contextual type for the
		// object literal, lookup the property symbol in the contextual type, and use this for goto-definition.
		// For example
		//      interface Props{
		//          /*first*/prop1: number
		//          prop2: boolean
		//      }
		//      function Foo(arg: Props) {}
		//      Foo( { pr/*1*/op1: 10, prop2: false })
		const element = getContainingObjectLiteralElement(node);
		if (element) {
			const contextualType = element && checker.getContextualType(element.parent);
			if (contextualType) {
				const propertySymbols = getPropertySymbolsFromContextualType(element, checker, contextualType, /*unionSymbolOk*/ false);
				if (propertySymbols) {
					symbol = propertySymbols[0];
				}
			}
		}
	}

	if (symbol && symbol.declarations) {
		return [symbol, importNode];
	}

	return [null, null];
}

/** Get the token whose text contains the position */
function getTokenAtPosition(sourceFile: ts.SourceFile, position: number, allowPositionInLeadingTrivia: boolean, includeEndPosition: boolean): ts.Node {
	let current: ts.Node = sourceFile;
	outer: while (true) {
		// find the child that contains 'position'
		for (const child of current.getChildren()) {
			const start = allowPositionInLeadingTrivia ? child.getFullStart() : child.getStart(sourceFile, /*includeJsDoc*/ true);
			if (start > position) {
				// If this child begins after position, then all subsequent children will as well.
				break;
			}

			const end = child.getEnd();
			if (position < end || (position === end && (child.kind === ts.SyntaxKind.EndOfFileToken || includeEndPosition))) {
				current = child;
				continue outer;
			}
		}

		return current;
	}
}

//#endregion
