/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ts from 'typescript';
import * as lazy from 'lazy.js';
import { duplex, through } from 'event-stream';
import * as File from 'vinyl';
import * as sm from 'source-map';
import * as  path from 'path';

declare class FileSourceMap extends File {
	public sourceMap: sm.RawSourceMap;
}

enum CollectStepResult {
	Yes,
	YesAndRecurse,
	No,
	NoAndRecurse
}

function collect(node: ts.Node, fn: (node: ts.Node) => CollectStepResult): ts.Node[] {
	const result: ts.Node[] = [];

	function loop(node: ts.Node) {
		const stepResult = fn(node);

		if (stepResult === CollectStepResult.Yes || stepResult === CollectStepResult.YesAndRecurse) {
			result.push(node);
		}

		if (stepResult === CollectStepResult.YesAndRecurse || stepResult === CollectStepResult.NoAndRecurse) {
			ts.forEachChild(node, loop);
		}
	}

	loop(node);
	return result;
}

function clone<T>(object: T): T {
	const result = <T>{};
	for (const id in object) {
		result[id] = object[id];
	}
	return result;
}

function template(lines: string[]): string {
	let indent = '', wrap = '';

	if (lines.length > 1) {
		indent = '\t';
		wrap = '\n';
	}

	return `/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
define([], [${ wrap + lines.map(l => indent + l).join(',\n') + wrap}]);`;
}

/**
 * Returns a stream containing the patched JavaScript and source maps.
 */
function nls(): NodeJS.ReadWriteStream {
	const input = through();
	const output = input.pipe(through(function (f: FileSourceMap) {
		if (!f.sourceMap) {
			return this.emit('error', new Error(`File ${f.relative} does not have sourcemaps.`));
		}

		let source = f.sourceMap.sources[0];
		if (!source) {
			return this.emit('error', new Error(`File ${f.relative} does not have a source in the source map.`));
		}

		const root = f.sourceMap.sourceRoot;
		if (root) {
			source = path.join(root, source);
		}

		const typescript = f.sourceMap.sourcesContent![0];
		if (!typescript) {
			return this.emit('error', new Error(`File ${f.relative} does not have the original content in the source map.`));
		}

		nls.patchFiles(f, typescript).forEach(f => this.emit('data', f));
	}));

	return duplex(input, output);
}

function isImportNode(node: ts.Node): boolean {
	return node.kind === ts.SyntaxKind.ImportDeclaration || node.kind === ts.SyntaxKind.ImportEqualsDeclaration;
}

module nls {

	export interface INlsStringResult {
		javascript: string;
		sourcemap: sm.RawSourceMap;
		nls?: string;
		nlsKeys?: string;
	}

	export interface ISpan {
		start: ts.LineAndCharacter;
		end: ts.LineAndCharacter;
	}

	export interface ILocalizeCall {
		keySpan: ISpan;
		key: string;
		valueSpan: ISpan;
		value: string;
	}

	export interface ILocalizeAnalysisResult {
		localizeCalls: ILocalizeCall[];
		nlsExpressions: ISpan[];
	}

	export interface IPatch {
		span: ISpan;
		content: string;
	}

	export function fileFrom(file: File, contents: string, path: string = file.path) {
		return new File({
			contents: Buffer.from(contents),
			base: file.base,
			cwd: file.cwd,
			path: path
		});
	}

	export function mappedPositionFrom(source: string, lc: ts.LineAndCharacter): sm.MappedPosition {
		return { source, line: lc.line + 1, column: lc.character };
	}

	export function lcFrom(position: sm.Position): ts.LineAndCharacter {
		return { line: position.line - 1, character: position.column };
	}

	export class SingleFileServiceHost implements ts.LanguageServiceHost {

		private file: ts.IScriptSnapshot;
		private lib: ts.IScriptSnapshot;

		constructor(private options: ts.CompilerOptions, private filename: string, contents: string) {
			this.file = ts.ScriptSnapshot.fromString(contents);
			this.lib = ts.ScriptSnapshot.fromString('');
		}

		getCompilationSettings = () => this.options;
		getScriptFileNames = () => [this.filename];
		getScriptVersion = () => '1';
		getScriptSnapshot = (name: string) => name === this.filename ? this.file : this.lib;
		getCurrentDirectory = () => '';
		getDefaultLibFileName = () => 'lib.d.ts';
	}

	function isCallExpressionWithinTextSpanCollectStep(textSpan: ts.TextSpan, node: ts.Node): CollectStepResult {
		if (!ts.textSpanContainsTextSpan({ start: node.pos, length: node.end - node.pos }, textSpan)) {
			return CollectStepResult.No;
		}

		return node.kind === ts.SyntaxKind.CallExpression ? CollectStepResult.YesAndRecurse : CollectStepResult.NoAndRecurse;
	}

	export function analyze(contents: string, options: ts.CompilerOptions = {}): ILocalizeAnalysisResult {
		const filename = 'file.ts';
		const serviceHost = new SingleFileServiceHost(Object.assign(clone(options), { noResolve: true }), filename, contents);
		const service = ts.createLanguageService(serviceHost);
		const sourceFile = ts.createSourceFile(filename, contents, ts.ScriptTarget.ES5, true);

		// all imports
		const imports = lazy(collect(sourceFile, n => isImportNode(n) ? CollectStepResult.YesAndRecurse : CollectStepResult.NoAndRecurse));

		// import nls = require('vs/nls');
		const importEqualsDeclarations = imports
			.filter(n => n.kind === ts.SyntaxKind.ImportEqualsDeclaration)
			.map(n => <ts.ImportEqualsDeclaration>n)
			.filter(d => d.moduleReference.kind === ts.SyntaxKind.ExternalModuleReference)
			.filter(d => (<ts.ExternalModuleReference>d.moduleReference).expression.getText() === '\'vs/nls\'');

		// import ... from 'vs/nls';
		const importDeclarations = imports
			.filter(n => n.kind === ts.SyntaxKind.ImportDeclaration)
			.map(n => <ts.ImportDeclaration>n)
			.filter(d => d.moduleSpecifier.kind === ts.SyntaxKind.StringLiteral)
			.filter(d => d.moduleSpecifier.getText() === '\'vs/nls\'')
			.filter(d => !!d.importClause && !!d.importClause.namedBindings);

		const nlsExpressions = importEqualsDeclarations
			.map(d => (<ts.ExternalModuleReference>d.moduleReference).expression)
			.concat(importDeclarations.map(d => d.moduleSpecifier))
			.map<ISpan>(d => ({
				start: ts.getLineAndCharacterOfPosition(sourceFile, d.getStart()),
				end: ts.getLineAndCharacterOfPosition(sourceFile, d.getEnd())
			}));

		// `nls.localize(...)` calls
		const nlsLocalizeCallExpressions = importDeclarations
			.filter(d => !!(d.importClause && d.importClause.namedBindings && d.importClause.namedBindings.kind === ts.SyntaxKind.NamespaceImport))
			.map(d => (<ts.NamespaceImport>d.importClause!.namedBindings).name)
			.concat(importEqualsDeclarations.map(d => d.name))

			// find read-only references to `nls`
			.map(n => service.getReferencesAtPosition(filename, n.pos + 1))
			.flatten()
			.filter(r => !r.isWriteAccess)

			// find the deepest call expressions AST nodes that contain those references
			.map(r => collect(sourceFile, n => isCallExpressionWithinTextSpanCollectStep(r.textSpan, n)))
			.map(a => lazy(a).last())
			.filter(n => !!n)
			.map(n => <ts.CallExpression>n)

			// only `localize` calls
			.filter(n => n.expression.kind === ts.SyntaxKind.PropertyAccessExpression && (<ts.PropertyAccessExpression>n.expression).name.getText() === 'localize');

		// `localize` named imports
		const allLocalizeImportDeclarations = importDeclarations
			.filter(d => !!(d.importClause && d.importClause.namedBindings && d.importClause.namedBindings.kind === ts.SyntaxKind.NamedImports))
			.map(d => ([] as any[]).concat((<ts.NamedImports>d.importClause!.namedBindings!).elements))
			.flatten();

		// `localize` read-only references
		const localizeReferences = allLocalizeImportDeclarations
			.filter(d => d.name.getText() === 'localize')
			.map(n => service.getReferencesAtPosition(filename, n.pos + 1))
			.flatten()
			.filter(r => !r.isWriteAccess);

		// custom named `localize` read-only references
		const namedLocalizeReferences = allLocalizeImportDeclarations
			.filter(d => d.propertyName && d.propertyName.getText() === 'localize')
			.map(n => service.getReferencesAtPosition(filename, n.name.pos + 1))
			.flatten()
			.filter(r => !r.isWriteAccess);

		// find the deepest call expressions AST nodes that contain those references
		const localizeCallExpressions = localizeReferences
			.concat(namedLocalizeReferences)
			.map(r => collect(sourceFile, n => isCallExpressionWithinTextSpanCollectStep(r.textSpan, n)))
			.map(a => lazy(a).last())
			.filter(n => !!n)
			.map(n => <ts.CallExpression>n);

		// collect everything
		const localizeCalls = nlsLocalizeCallExpressions
			.concat(localizeCallExpressions)
			.map(e => e.arguments)
			.filter(a => a.length > 1)
			.sort((a, b) => a[0].getStart() - b[0].getStart())
			.map<ILocalizeCall>(a => ({
				keySpan: { start: ts.getLineAndCharacterOfPosition(sourceFile, a[0].getStart()), end: ts.getLineAndCharacterOfPosition(sourceFile, a[0].getEnd()) },
				key: a[0].getText(),
				valueSpan: { start: ts.getLineAndCharacterOfPosition(sourceFile, a[1].getStart()), end: ts.getLineAndCharacterOfPosition(sourceFile, a[1].getEnd()) },
				value: a[1].getText()
			}));

		return {
			localizeCalls: localizeCalls.toArray(),
			nlsExpressions: nlsExpressions.toArray()
		};
	}

	export class TextModel {

		private lines: string[];
		private lineEndings: string[];

		constructor(contents: string) {
			const regex = /\r\n|\r|\n/g;
			let index = 0;
			let match: RegExpExecArray | null;

			this.lines = [];
			this.lineEndings = [];

			while (match = regex.exec(contents)) {
				this.lines.push(contents.substring(index, match.index));
				this.lineEndings.push(match[0]);
				index = regex.lastIndex;
			}

			if (contents.length > 0) {
				this.lines.push(contents.substring(index, contents.length));
				this.lineEndings.push('');
			}
		}

		public get(index: number): string {
			return this.lines[index];
		}

		public set(index: number, line: string): void {
			this.lines[index] = line;
		}

		public get lineCount(): number {
			return this.lines.length;
		}

		/**
		 * Applies patch(es) to the model.
		 * Multiple patches must be ordered.
		 * Does not support patches spanning multiple lines.
		 */
		public apply(patch: IPatch): void {
			const startLineNumber = patch.span.start.line;
			const endLineNumber = patch.span.end.line;

			const startLine = this.lines[startLineNumber] || '';
			const endLine = this.lines[endLineNumber] || '';

			this.lines[startLineNumber] = [
				startLine.substring(0, patch.span.start.character),
				patch.content,
				endLine.substring(patch.span.end.character)
			].join('');

			for (let i = startLineNumber + 1; i <= endLineNumber; i++) {
				this.lines[i] = '';
			}
		}

		public toString(): string {
			return lazy(this.lines).zip(this.lineEndings)
				.flatten().toArray().join('');
		}
	}

	export function patchJavascript(patches: IPatch[], contents: string, moduleId: string): string {
		const model = new nls.TextModel(contents);

		// patch the localize calls
		lazy(patches).reverse().each(p => model.apply(p));

		// patch the 'vs/nls' imports
		const firstLine = model.get(0);
		const patchedFirstLine = firstLine.replace(/(['"])vs\/nls\1/g, `$1vs/nls!${moduleId}$1`);
		model.set(0, patchedFirstLine);

		return model.toString();
	}

	export function patchSourcemap(patches: IPatch[], rsm: sm.RawSourceMap, smc: sm.SourceMapConsumer): sm.RawSourceMap {
		const smg = new sm.SourceMapGenerator({
			file: rsm.file,
			sourceRoot: rsm.sourceRoot
		});

		patches = patches.reverse();
		let currentLine = -1;
		let currentLineDiff = 0;
		let source: string | null = null;

		smc.eachMapping(m => {
			const patch = patches[patches.length - 1];
			const original = { line: m.originalLine, column: m.originalColumn };
			const generated = { line: m.generatedLine, column: m.generatedColumn };

			if (currentLine !== generated.line) {
				currentLineDiff = 0;
			}

			currentLine = generated.line;
			generated.column += currentLineDiff;

			if (patch && m.generatedLine - 1 === patch.span.end.line && m.generatedColumn === patch.span.end.character) {
				const originalLength = patch.span.end.character - patch.span.start.character;
				const modifiedLength = patch.content.length;
				const lengthDiff = modifiedLength - originalLength;
				currentLineDiff += lengthDiff;
				generated.column += lengthDiff;

				patches.pop();
			}

			source = rsm.sourceRoot ? path.relative(rsm.sourceRoot, m.source) : m.source;
			source = source.replace(/\\/g, '/');
			smg.addMapping({ source, name: m.name, original, generated });
		}, null, sm.SourceMapConsumer.GENERATED_ORDER);

		if (source) {
			smg.setSourceContent(source, smc.sourceContentFor(source));
		}

		return JSON.parse(smg.toString());
	}

	export function patch(moduleId: string, typescript: string, javascript: string, sourcemap: sm.RawSourceMap): INlsStringResult {
		const { localizeCalls, nlsExpressions } = analyze(typescript);

		if (localizeCalls.length === 0) {
			return { javascript, sourcemap };
		}

		const nlsKeys = template(localizeCalls.map(lc => lc.key));
		const nls = template(localizeCalls.map(lc => lc.value));
		const smc = new sm.SourceMapConsumer(sourcemap);
		const positionFrom = mappedPositionFrom.bind(null, sourcemap.sources[0]);
		let i = 0;

		// build patches
		const patches = lazy(localizeCalls)
			.map(lc => ([
				{ range: lc.keySpan, content: '' + (i++) },
				{ range: lc.valueSpan, content: 'null' }
			]))
			.flatten()
			.map<IPatch>(c => {
				const start = lcFrom(smc.generatedPositionFor(positionFrom(c.range.start)));
				const end = lcFrom(smc.generatedPositionFor(positionFrom(c.range.end)));
				return { span: { start, end }, content: c.content };
			})
			.toArray();

		javascript = patchJavascript(patches, javascript, moduleId);

		// since imports are not within the sourcemap information,
		// we must do this MacGyver style
		if (nlsExpressions.length) {
			javascript = javascript.replace(/^define\(.*$/m, line => {
				return line.replace(/(['"])vs\/nls\1/g, `$1vs/nls!${moduleId}$1`);
			});
		}

		sourcemap = patchSourcemap(patches, sourcemap, smc);

		return { javascript, sourcemap, nlsKeys, nls };
	}

	export function patchFiles(javascriptFile: File, typescript: string): File[] {
		// hack?
		const moduleId = javascriptFile.relative
			.replace(/\.js$/, '')
			.replace(/\\/g, '/');

		const { javascript, sourcemap, nlsKeys, nls } = patch(
			moduleId,
			typescript,
			javascriptFile.contents.toString(),
			(<any>javascriptFile).sourceMap
		);

		const result: File[] = [fileFrom(javascriptFile, javascript)];
		(<any>result[0]).sourceMap = sourcemap;

		if (nlsKeys) {
			result.push(fileFrom(javascriptFile, nlsKeys, javascriptFile.path.replace(/\.js$/, '.nls.keys.js')));
		}

		if (nls) {
			result.push(fileFrom(javascriptFile, nls, javascriptFile.path.replace(/\.js$/, '.nls.js')));
		}

		return result;
	}
}

export = nls;
