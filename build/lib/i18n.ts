/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';

import { through, readable, ThroughStream } from 'event-stream';
import * as File from 'vinyl';
import * as Is from 'is';
import * as xml2js from 'xml2js';
import * as glob from 'glob';
import * as https from 'https';
import * as gulp from 'gulp';
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';
import * as iconv from 'iconv-lite-umd';

const NUMBER_OF_CONCURRENT_DOWNLOADS = 4;

function log(message: any, ...rest: any[]): void {
	fancyLog(ansiColors.green('[i18n]'), message, ...rest);
}

export interface Language {
	id: string; // language id, e.g. zh-tw, de
	translationId?: string; // language id used in translation tools, e.g. zh-hant, de (optional, if not set, the id is used)
	folderName?: string; // language specific folder name, e.g. cht, deu  (optional, if not set, the id is used)
}

export interface InnoSetup {
	codePage: string; //code page for encoding (http://www.jrsoftware.org/ishelp/index.php?topic=langoptionssection)
	defaultInfo?: {
		name: string; // inno setup language name
		id: string; // locale identifier (https://msdn.microsoft.com/en-us/library/dd318693.aspx)
	};
}

export const defaultLanguages: Language[] = [
	{ id: 'zh-tw', folderName: 'cht', translationId: 'zh-hant' },
	{ id: 'zh-cn', folderName: 'chs', translationId: 'zh-hans' },
	{ id: 'ja', folderName: 'jpn' },
	{ id: 'ko', folderName: 'kor' },
	{ id: 'de', folderName: 'deu' },
	{ id: 'fr', folderName: 'fra' },
	{ id: 'es', folderName: 'esn' },
	{ id: 'ru', folderName: 'rus' },
	{ id: 'it', folderName: 'ita' }
];

// languages requested by the community to non-stable builds
export const extraLanguages: Language[] = [
	{ id: 'pt-br', folderName: 'ptb' },
	{ id: 'hu', folderName: 'hun' },
	{ id: 'tr', folderName: 'trk' }
];

// non built-in extensions also that are transifex and need to be part of the language packs
export const externalExtensionsWithTranslations = {
	'vscode-chrome-debug': 'msjsdiag.debugger-for-chrome',
	'vscode-node-debug': 'ms-vscode.node-debug',
	'vscode-node-debug2': 'ms-vscode.node-debug2'
};


interface Map<V> {
	[key: string]: V;
}

interface Item {
	id: string;
	message: string;
	comment?: string;
}

export interface Resource {
	name: string;
	project: string;
}

interface ParsedXLF {
	messages: Map<string>;
	originalFilePath: string;
	language: string;
}

interface LocalizeInfo {
	key: string;
	comment: string[];
}

module LocalizeInfo {
	export function is(value: any): value is LocalizeInfo {
		let candidate = value as LocalizeInfo;
		return Is.defined(candidate) && Is.string(candidate.key) && (Is.undef(candidate.comment) || (Is.array(candidate.comment) && candidate.comment.every(element => Is.string(element))));
	}
}

interface BundledFormat {
	keys: Map<(string | LocalizeInfo)[]>;
	messages: Map<string[]>;
	bundles: Map<string[]>;
}

module BundledFormat {
	export function is(value: any): value is BundledFormat {
		if (Is.undef(value)) {
			return false;
		}

		let candidate = value as BundledFormat;
		let length = Object.keys(value).length;

		return length === 3 && Is.defined(candidate.keys) && Is.defined(candidate.messages) && Is.defined(candidate.bundles);
	}
}

interface ValueFormat {
	message: string;
	comment: string[];
}

interface PackageJsonFormat {
	[key: string]: string | ValueFormat;
}

module PackageJsonFormat {
	export function is(value: any): value is PackageJsonFormat {
		if (Is.undef(value) || !Is.object(value)) {
			return false;
		}
		return Object.keys(value).every(key => {
			let element = value[key];
			return Is.string(element) || (Is.object(element) && Is.defined(element.message) && Is.defined(element.comment));
		});
	}
}

interface BundledExtensionFormat {
	[key: string]: {
		messages: string[];
		keys: (string | LocalizeInfo)[];
	};
}

interface I18nFormat {
	version: string;
	contents: {
		[module: string]: {
			[messageKey: string]: string;
		};
	};
}

export class Line {
	private buffer: string[] = [];

	constructor(indent: number = 0) {
		if (indent > 0) {
			this.buffer.push(new Array(indent + 1).join(' '));
		}
	}

	public append(value: string): Line {
		this.buffer.push(value);
		return this;
	}

	public toString(): string {
		return this.buffer.join('');
	}
}

class TextModel {
	private _lines: string[];

	constructor(contents: string) {
		this._lines = contents.split(/\r\n|\r|\n/);
	}

	public get lines(): string[] {
		return this._lines;
	}
}

export class XLF {
	private buffer: string[];
	private files: Map<Item[]>;
	public numberOfMessages: number;

	constructor(public project: string) {
		this.buffer = [];
		this.files = Object.create(null);
		this.numberOfMessages = 0;
	}

	public toString(): string {
		this.appendHeader();

		for (let file in this.files) {
			this.appendNewLine(`<file original="${file}" source-language="en" datatype="plaintext"><body>`, 2);
			for (let item of this.files[file]) {
				this.addStringItem(file, item);
			}
			this.appendNewLine('</body></file>', 2);
		}

		this.appendFooter();
		return this.buffer.join('\r\n');
	}

	public addFile(original: string, keys: (string | LocalizeInfo)[], messages: string[]) {
		if (keys.length === 0) {
			console.log('No keys in ' + original);
			return;
		}
		if (keys.length !== messages.length) {
			throw new Error(`Unmatching keys(${keys.length}) and messages(${messages.length}).`);
		}
		this.numberOfMessages += keys.length;
		this.files[original] = [];
		let existingKeys = new Set<string>();
		for (let i = 0; i < keys.length; i++) {
			let key = keys[i];
			let realKey: string | undefined;
			let comment: string | undefined;
			if (Is.string(key)) {
				realKey = key;
				comment = undefined;
			} else if (LocalizeInfo.is(key)) {
				realKey = key.key;
				if (key.comment && key.comment.length > 0) {
					comment = key.comment.map(comment => encodeEntities(comment)).join('\r\n');
				}
			}
			if (!realKey || existingKeys.has(realKey)) {
				continue;
			}
			existingKeys.add(realKey);
			let message: string = encodeEntities(messages[i]);
			this.files[original].push({ id: realKey, message: message, comment: comment });
		}
	}

	private addStringItem(file: string, item: Item): void {
		if (!item.id || item.message === undefined || item.message === null) {
			throw new Error(`No item ID or value specified: ${JSON.stringify(item)}. File: ${file}`);
		}
		if (item.message.length === 0) {
			log(`Item with id ${item.id} in file ${file} has an empty message.`);
		}

		this.appendNewLine(`<trans-unit id="${item.id}">`, 4);
		this.appendNewLine(`<source xml:lang="en">${item.message}</source>`, 6);

		if (item.comment) {
			this.appendNewLine(`<note>${item.comment}</note>`, 6);
		}

		this.appendNewLine('</trans-unit>', 4);
	}

	private appendHeader(): void {
		this.appendNewLine('<?xml version="1.0" encoding="utf-8"?>', 0);
		this.appendNewLine('<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">', 0);
	}

	private appendFooter(): void {
		this.appendNewLine('</xliff>', 0);
	}

	private appendNewLine(content: string, indent?: number): void {
		let line = new Line(indent);
		line.append(content);
		this.buffer.push(line.toString());
	}

	static parsePseudo = function (xlfString: string): Promise<ParsedXLF[]> {
		return new Promise((resolve) => {
			let parser = new xml2js.Parser();
			let files: { messages: Map<string>, originalFilePath: string, language: string }[] = [];
			parser.parseString(xlfString, function (_err: any, result: any) {
				const fileNodes: any[] = result['xliff']['file'];
				fileNodes.forEach(file => {
					const originalFilePath = file.$.original;
					const messages: Map<string> = {};
					const transUnits = file.body[0]['trans-unit'];
					if (transUnits) {
						transUnits.forEach((unit: any) => {
							const key = unit.$.id;
							const val = pseudify(unit.source[0]['_'].toString());
							if (key && val) {
								messages[key] = decodeEntities(val);
							}
						});
						files.push({ messages: messages, originalFilePath: originalFilePath, language: 'ps' });
					}
				});
				resolve(files);
			});
		});
	};

	static parse = function (xlfString: string): Promise<ParsedXLF[]> {
		return new Promise((resolve, reject) => {
			let parser = new xml2js.Parser();

			let files: { messages: Map<string>, originalFilePath: string, language: string }[] = [];

			parser.parseString(xlfString, function (err: any, result: any) {
				if (err) {
					reject(new Error(`XLF parsing error: Failed to parse XLIFF string. ${err}`));
				}

				const fileNodes: any[] = result['xliff']['file'];
				if (!fileNodes) {
					reject(new Error(`XLF parsing error: XLIFF file does not contain "xliff" or "file" node(s) required for parsing.`));
				}

				fileNodes.forEach((file) => {
					const originalFilePath = file.$.original;
					if (!originalFilePath) {
						reject(new Error(`XLF parsing error: XLIFF file node does not contain original attribute to determine the original location of the resource file.`));
					}
					let language = file.$['target-language'];
					if (!language) {
						reject(new Error(`XLF parsing error: XLIFF file node does not contain target-language attribute to determine translated language.`));
					}
					const messages: Map<string> = {};

					const transUnits = file.body[0]['trans-unit'];
					if (transUnits) {
						transUnits.forEach((unit: any) => {
							const key = unit.$.id;
							if (!unit.target) {
								return; // No translation available
							}

							let val = unit.target[0];
							if (typeof val !== 'string') {
								val = val._;
							}
							if (key && val) {
								messages[key] = decodeEntities(val);
							} else {
								reject(new Error(`XLF parsing error: XLIFF file ${originalFilePath} does not contain full localization data. ID or target translation for one of the trans-unit nodes is not present.`));
							}
						});
						files.push({ messages: messages, originalFilePath: originalFilePath, language: language.toLowerCase() });
					}
				});

				resolve(files);
			});
		});
	};
}

export interface ITask<T> {
	(): T;
}

interface ILimitedTaskFactory<T> {
	factory: ITask<Promise<T>>;
	c: (value?: T | Promise<T>) => void;
	e: (error?: any) => void;
}

export class Limiter<T> {
	private runningPromises: number;
	private outstandingPromises: ILimitedTaskFactory<any>[];

	constructor(private maxDegreeOfParalellism: number) {
		this.outstandingPromises = [];
		this.runningPromises = 0;
	}

	queue(factory: ITask<Promise<T>>): Promise<T> {
		return new Promise<T>((c, e) => {
			this.outstandingPromises.push({ factory, c, e });
			this.consume();
		});
	}

	private consume(): void {
		while (this.outstandingPromises.length && this.runningPromises < this.maxDegreeOfParalellism) {
			const iLimitedTask = this.outstandingPromises.shift()!;
			this.runningPromises++;

			const promise = iLimitedTask.factory();
			promise.then(iLimitedTask.c).catch(iLimitedTask.e);
			promise.then(() => this.consumed()).catch(() => this.consumed());
		}
	}

	private consumed(): void {
		this.runningPromises--;
		this.consume();
	}
}

function sortLanguages(languages: Language[]): Language[] {
	return languages.sort((a: Language, b: Language): number => {
		return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
	});
}

function stripComments(content: string): string {
	/**
	* First capturing group matches double quoted string
	* Second matches single quotes string
	* Third matches block comments
	* Fourth matches line comments
	*/
	const regexp = /("(?:[^\\\"]*(?:\\.)?)*")|('(?:[^\\\']*(?:\\.)?)*')|(\/\*(?:\r?\n|.)*?\*\/)|(\/{2,}.*?(?:(?:\r?\n)|$))/g;
	let result = content.replace(regexp, (match, _m1, _m2, m3, m4) => {
		// Only one of m1, m2, m3, m4 matches
		if (m3) {
			// A block comment. Replace with nothing
			return '';
		} else if (m4) {
			// A line comment. If it ends in \r?\n then keep it.
			let length = m4.length;
			if (length > 2 && m4[length - 1] === '\n') {
				return m4[length - 2] === '\r' ? '\r\n' : '\n';
			} else {
				return '';
			}
		} else {
			// We match a string
			return match;
		}
	});
	return result;
}

function escapeCharacters(value: string): string {
	const result: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const ch = value.charAt(i);
		switch (ch) {
			case '\'':
				result.push('\\\'');
				break;
			case '"':
				result.push('\\"');
				break;
			case '\\':
				result.push('\\\\');
				break;
			case '\n':
				result.push('\\n');
				break;
			case '\r':
				result.push('\\r');
				break;
			case '\t':
				result.push('\\t');
				break;
			case '\b':
				result.push('\\b');
				break;
			case '\f':
				result.push('\\f');
				break;
			default:
				result.push(ch);
		}
	}
	return result.join('');
}

function processCoreBundleFormat(fileHeader: string, languages: Language[], json: BundledFormat, emitter: ThroughStream) {
	let keysSection = json.keys;
	let messageSection = json.messages;
	let bundleSection = json.bundles;

	let statistics: Map<number> = Object.create(null);

	let defaultMessages: Map<Map<string>> = Object.create(null);
	let modules = Object.keys(keysSection);
	modules.forEach((module) => {
		let keys = keysSection[module];
		let messages = messageSection[module];
		if (!messages || keys.length !== messages.length) {
			emitter.emit('error', `Message for module ${module} corrupted. Mismatch in number of keys and messages.`);
			return;
		}
		let messageMap: Map<string> = Object.create(null);
		defaultMessages[module] = messageMap;
		keys.map((key, i) => {
			if (typeof key === 'string') {
				messageMap[key] = messages[i];
			} else {
				messageMap[key.key] = messages[i];
			}
		});
	});

	let languageDirectory = path.join(__dirname, '..', '..', '..', 'vscode-loc', 'i18n');
	if (!fs.existsSync(languageDirectory)) {
		log(`No VS Code localization repository found. Looking at ${languageDirectory}`);
		log(`To bundle translations please check out the vscode-loc repository as a sibling of the vscode repository.`);
	}
	let sortedLanguages = sortLanguages(languages);
	sortedLanguages.forEach((language) => {
		if (process.env['VSCODE_BUILD_VERBOSE']) {
			log(`Generating nls bundles for: ${language.id}`);
		}

		statistics[language.id] = 0;
		let localizedModules: Map<string[]> = Object.create(null);
		let languageFolderName = language.translationId || language.id;
		let i18nFile = path.join(languageDirectory, `vscode-language-pack-${languageFolderName}`, 'translations', 'main.i18n.json');
		let allMessages: I18nFormat | undefined;
		if (fs.existsSync(i18nFile)) {
			let content = stripComments(fs.readFileSync(i18nFile, 'utf8'));
			allMessages = JSON.parse(content);
		}
		modules.forEach((module) => {
			let order = keysSection[module];
			let moduleMessage: { [messageKey: string]: string } | undefined;
			if (allMessages) {
				moduleMessage = allMessages.contents[module];
			}
			if (!moduleMessage) {
				if (process.env['VSCODE_BUILD_VERBOSE']) {
					log(`No localized messages found for module ${module}. Using default messages.`);
				}
				moduleMessage = defaultMessages[module];
				statistics[language.id] = statistics[language.id] + Object.keys(moduleMessage).length;
			}
			let localizedMessages: string[] = [];
			order.forEach((keyInfo) => {
				let key: string | null = null;
				if (typeof keyInfo === 'string') {
					key = keyInfo;
				} else {
					key = keyInfo.key;
				}
				let message: string = moduleMessage![key];
				if (!message) {
					if (process.env['VSCODE_BUILD_VERBOSE']) {
						log(`No localized message found for key ${key} in module ${module}. Using default message.`);
					}
					message = defaultMessages[module][key];
					statistics[language.id] = statistics[language.id] + 1;
				}
				localizedMessages.push(message);
			});
			localizedModules[module] = localizedMessages;
		});
		Object.keys(bundleSection).forEach((bundle) => {
			let modules = bundleSection[bundle];
			let contents: string[] = [
				fileHeader,
				`define("${bundle}.nls.${language.id}", {`
			];
			modules.forEach((module, index) => {
				contents.push(`\t"${module}": [`);
				let messages = localizedModules[module];
				if (!messages) {
					emitter.emit('error', `Didn't find messages for module ${module}.`);
					return;
				}
				messages.forEach((message, index) => {
					contents.push(`\t\t"${escapeCharacters(message)}${index < messages.length ? '",' : '"'}`);
				});
				contents.push(index < modules.length - 1 ? '\t],' : '\t]');
			});
			contents.push('});');
			emitter.queue(new File({ path: bundle + '.nls.' + language.id + '.js', contents: Buffer.from(contents.join('\n'), 'utf-8') }));
		});
	});
	Object.keys(statistics).forEach(key => {
		let value = statistics[key];
		log(`${key} has ${value} untranslated strings.`);
	});
	sortedLanguages.forEach(language => {
		let stats = statistics[language.id];
		if (Is.undef(stats)) {
			log(`\tNo translations found for language ${language.id}. Using default language instead.`);
		}
	});
}

export function processNlsFiles(opts: { fileHeader: string; languages: Language[] }): ThroughStream {
	return through(function (this: ThroughStream, file: File) {
		let fileName = path.basename(file.path);
		if (fileName === 'nls.metadata.json') {
			let json = null;
			if (file.isBuffer()) {
				json = JSON.parse((<Buffer>file.contents).toString('utf8'));
			} else {
				this.emit('error', `Failed to read component file: ${file.relative}`);
				return;
			}
			if (BundledFormat.is(json)) {
				processCoreBundleFormat(opts.fileHeader, opts.languages, json, this);
			}
		}
		this.queue(file);
	});
}

const editorProject: string = 'vscode-editor',
	workbenchProject: string = 'vscode-workbench',
	extensionsProject: string = 'vscode-extensions',
	setupProject: string = 'vscode-setup';

export function getResource(sourceFile: string): Resource {
	let resource: string;

	if (/^vs\/platform/.test(sourceFile)) {
		return { name: 'vs/platform', project: editorProject };
	} else if (/^vs\/editor\/contrib/.test(sourceFile)) {
		return { name: 'vs/editor/contrib', project: editorProject };
	} else if (/^vs\/editor/.test(sourceFile)) {
		return { name: 'vs/editor', project: editorProject };
	} else if (/^vs\/base/.test(sourceFile)) {
		return { name: 'vs/base', project: editorProject };
	} else if (/^vs\/code/.test(sourceFile)) {
		return { name: 'vs/code', project: workbenchProject };
	} else if (/^vs\/workbench\/contrib/.test(sourceFile)) {
		resource = sourceFile.split('/', 4).join('/');
		return { name: resource, project: workbenchProject };
	} else if (/^vs\/workbench\/services/.test(sourceFile)) {
		resource = sourceFile.split('/', 4).join('/');
		return { name: resource, project: workbenchProject };
	} else if (/^vs\/workbench/.test(sourceFile)) {
		return { name: 'vs/workbench', project: workbenchProject };
	}

	throw new Error(`Could not identify the XLF bundle for ${sourceFile}`);
}


export function createXlfFilesForCoreBundle(): ThroughStream {
	return through(function (this: ThroughStream, file: File) {
		const basename = path.basename(file.path);
		if (basename === 'nls.metadata.json') {
			if (file.isBuffer()) {
				const xlfs: Map<XLF> = Object.create(null);
				const json: BundledFormat = JSON.parse((file.contents as Buffer).toString('utf8'));
				for (let coreModule in json.keys) {
					const projectResource = getResource(coreModule);
					const resource = projectResource.name;
					const project = projectResource.project;

					const keys = json.keys[coreModule];
					const messages = json.messages[coreModule];
					if (keys.length !== messages.length) {
						this.emit('error', `There is a mismatch between keys and messages in ${file.relative} for module ${coreModule}`);
						return;
					} else {
						let xlf = xlfs[resource];
						if (!xlf) {
							xlf = new XLF(project);
							xlfs[resource] = xlf;
						}
						xlf.addFile(`src/${coreModule}`, keys, messages);
					}
				}
				for (let resource in xlfs) {
					const xlf = xlfs[resource];
					const filePath = `${xlf.project}/${resource.replace(/\//g, '_')}.xlf`;
					const xlfFile = new File({
						path: filePath,
						contents: Buffer.from(xlf.toString(), 'utf8')
					});
					this.queue(xlfFile);
				}
			} else {
				this.emit('error', new Error(`File ${file.relative} is not using a buffer content`));
				return;
			}
		} else {
			this.emit('error', new Error(`File ${file.relative} is not a core meta data file.`));
			return;
		}
	});
}

export function createXlfFilesForExtensions(): ThroughStream {
	let counter: number = 0;
	let folderStreamEnded: boolean = false;
	let folderStreamEndEmitted: boolean = false;
	return through(function (this: ThroughStream, extensionFolder: File) {
		const folderStream = this;
		const stat = fs.statSync(extensionFolder.path);
		if (!stat.isDirectory()) {
			return;
		}
		let extensionName = path.basename(extensionFolder.path);
		if (extensionName === 'node_modules') {
			return;
		}
		counter++;
		let _xlf: XLF;
		function getXlf() {
			if (!_xlf) {
				_xlf = new XLF(extensionsProject);
			}
			return _xlf;
		}
		gulp.src([`.build/extensions/${extensionName}/package.nls.json`, `.build/extensions/${extensionName}/**/nls.metadata.json`], { allowEmpty: true }).pipe(through(function (file: File) {
			if (file.isBuffer()) {
				const buffer: Buffer = file.contents as Buffer;
				const basename = path.basename(file.path);
				if (basename === 'package.nls.json') {
					const json: PackageJsonFormat = JSON.parse(buffer.toString('utf8'));
					const keys = Object.keys(json);
					const messages = keys.map((key) => {
						const value = json[key];
						if (Is.string(value)) {
							return value;
						} else if (value) {
							return value.message;
						} else {
							return `Unknown message for key: ${key}`;
						}
					});
					getXlf().addFile(`extensions/${extensionName}/package`, keys, messages);
				} else if (basename === 'nls.metadata.json') {
					const json: BundledExtensionFormat = JSON.parse(buffer.toString('utf8'));
					const relPath = path.relative(`.build/extensions/${extensionName}`, path.dirname(file.path));
					for (let file in json) {
						const fileContent = json[file];
						getXlf().addFile(`extensions/${extensionName}/${relPath}/${file}`, fileContent.keys, fileContent.messages);
					}
				} else {
					this.emit('error', new Error(`${file.path} is not a valid extension nls file`));
					return;
				}
			}
		}, function () {
			if (_xlf) {
				let xlfFile = new File({
					path: path.join(extensionsProject, extensionName + '.xlf'),
					contents: Buffer.from(_xlf.toString(), 'utf8')
				});
				folderStream.queue(xlfFile);
			}
			this.queue(null);
			counter--;
			if (counter === 0 && folderStreamEnded && !folderStreamEndEmitted) {
				folderStreamEndEmitted = true;
				folderStream.queue(null);
			}
		}));
	}, function () {
		folderStreamEnded = true;
		if (counter === 0) {
			folderStreamEndEmitted = true;
			this.queue(null);
		}
	});
}

export function createXlfFilesForIsl(): ThroughStream {
	return through(function (this: ThroughStream, file: File) {
		let projectName: string,
			resourceFile: string;
		if (path.basename(file.path) === 'Default.isl') {
			projectName = setupProject;
			resourceFile = 'setup_default.xlf';
		} else {
			projectName = workbenchProject;
			resourceFile = 'setup_messages.xlf';
		}

		let xlf = new XLF(projectName),
			keys: string[] = [],
			messages: string[] = [];

		let model = new TextModel(file.contents.toString());
		let inMessageSection = false;
		model.lines.forEach(line => {
			if (line.length === 0) {
				return;
			}
			let firstChar = line.charAt(0);
			switch (firstChar) {
				case ';':
					// Comment line;
					return;
				case '[':
					inMessageSection = '[Messages]' === line || '[CustomMessages]' === line;
					return;
			}
			if (!inMessageSection) {
				return;
			}
			let sections: string[] = line.split('=');
			if (sections.length !== 2) {
				throw new Error(`Badly formatted message found: ${line}`);
			} else {
				let key = sections[0];
				let value = sections[1];
				if (key.length > 0 && value.length > 0) {
					keys.push(key);
					messages.push(value);
				}
			}
		});

		const originalPath = file.path.substring(file.cwd.length + 1, file.path.split('.')[0].length).replace(/\\/g, '/');
		xlf.addFile(originalPath, keys, messages);

		// Emit only upon all ISL files combined into single XLF instance
		const newFilePath = path.join(projectName, resourceFile);
		const xlfFile = new File({ path: newFilePath, contents: Buffer.from(xlf.toString(), 'utf-8') });
		this.queue(xlfFile);
	});
}

export function pushXlfFiles(apiHostname: string, username: string, password: string): ThroughStream {
	let tryGetPromises: Array<Promise<boolean>> = [];
	let updateCreatePromises: Array<Promise<boolean>> = [];

	return through(function (this: ThroughStream, file: File) {
		const project = path.dirname(file.relative);
		const fileName = path.basename(file.path);
		const slug = fileName.substr(0, fileName.length - '.xlf'.length);
		const credentials = `${username}:${password}`;

		// Check if resource already exists, if not, then create it.
		let promise = tryGetResource(project, slug, apiHostname, credentials);
		tryGetPromises.push(promise);
		promise.then(exists => {
			if (exists) {
				promise = updateResource(project, slug, file, apiHostname, credentials);
			} else {
				promise = createResource(project, slug, file, apiHostname, credentials);
			}
			updateCreatePromises.push(promise);
		});

	}, function () {
		// End the pipe only after all the communication with Transifex API happened
		Promise.all(tryGetPromises).then(() => {
			Promise.all(updateCreatePromises).then(() => {
				this.queue(null);
			}).catch((reason) => { throw new Error(reason); });
		}).catch((reason) => { throw new Error(reason); });
	});
}

function getAllResources(project: string, apiHostname: string, username: string, password: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const credentials = `${username}:${password}`;
		const options = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resources`,
			auth: credentials,
			method: 'GET'
		};

		const request = https.request(options, (res) => {
			let buffer: Buffer[] = [];
			res.on('data', (chunk: Buffer) => buffer.push(chunk));
			res.on('end', () => {
				if (res.statusCode === 200) {
					let json = JSON.parse(Buffer.concat(buffer).toString());
					if (Array.isArray(json)) {
						resolve(json.map(o => o.slug));
						return;
					}
					reject(`Unexpected data format. Response code: ${res.statusCode}.`);
				} else {
					reject(`No resources in ${project} returned no data. Response code: ${res.statusCode}.`);
				}
			});
		});
		request.on('error', (err) => {
			reject(`Failed to query resources in ${project} with the following error: ${err}. ${options.path}`);
		});
		request.end();
	});
}

export function findObsoleteResources(apiHostname: string, username: string, password: string): ThroughStream {
	let resourcesByProject: Map<string[]> = Object.create(null);
	resourcesByProject[extensionsProject] = ([] as any[]).concat(externalExtensionsWithTranslations); // clone

	return through(function (this: ThroughStream, file: File) {
		const project = path.dirname(file.relative);
		const fileName = path.basename(file.path);
		const slug = fileName.substr(0, fileName.length - '.xlf'.length);

		let slugs = resourcesByProject[project];
		if (!slugs) {
			resourcesByProject[project] = slugs = [];
		}
		slugs.push(slug);
		this.push(file);
	}, function () {

		const json = JSON.parse(fs.readFileSync('./build/lib/i18n.resources.json', 'utf8'));
		let i18Resources = [...json.editor, ...json.workbench].map((r: Resource) => r.project + '/' + r.name.replace(/\//g, '_'));
		let extractedResources: string[] = [];
		for (let project of [workbenchProject, editorProject]) {
			for (let resource of resourcesByProject[project]) {
				if (resource !== 'setup_messages') {
					extractedResources.push(project + '/' + resource);
				}
			}
		}
		if (i18Resources.length !== extractedResources.length) {
			console.log(`[i18n] Obsolete resources in file 'build/lib/i18n.resources.json': JSON.stringify(${i18Resources.filter(p => extractedResources.indexOf(p) === -1)})`);
			console.log(`[i18n] Missing resources in file 'build/lib/i18n.resources.json': JSON.stringify(${extractedResources.filter(p => i18Resources.indexOf(p) === -1)})`);
		}

		let promises: Array<Promise<void>> = [];
		for (let project in resourcesByProject) {
			promises.push(
				getAllResources(project, apiHostname, username, password).then(resources => {
					let expectedResources = resourcesByProject[project];
					let unusedResources = resources.filter(resource => resource && expectedResources.indexOf(resource) === -1);
					if (unusedResources.length) {
						console.log(`[transifex] Obsolete resources in project '${project}': ${unusedResources.join(', ')}`);
					}
				})
			);
		}
		return Promise.all(promises).then(_ => {
			this.push(null);
		}).catch((reason) => { throw new Error(reason); });
	});
}

function tryGetResource(project: string, slug: string, apiHostname: string, credentials: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resource/${slug}/?details`,
			auth: credentials,
			method: 'GET'
		};

		const request = https.request(options, (response) => {
			if (response.statusCode === 404) {
				resolve(false);
			} else if (response.statusCode === 200) {
				resolve(true);
			} else {
				reject(`Failed to query resource ${project}/${slug}. Response: ${response.statusCode} ${response.statusMessage}`);
			}
		});
		request.on('error', (err) => {
			reject(`Failed to get ${project}/${slug} on Transifex: ${err}`);
		});

		request.end();
	});
}

function createResource(project: string, slug: string, xlfFile: File, apiHostname: string, credentials: any): Promise<any> {
	return new Promise((_resolve, reject) => {
		const data = JSON.stringify({
			'content': xlfFile.contents.toString(),
			'name': slug,
			'slug': slug,
			'i18n_type': 'XLIFF'
		});
		const options = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resources`,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(data)
			},
			auth: credentials,
			method: 'POST'
		};

		let request = https.request(options, (res) => {
			if (res.statusCode === 201) {
				log(`Resource ${project}/${slug} successfully created on Transifex.`);
			} else {
				reject(`Something went wrong in the request creating ${slug} in ${project}. ${res.statusCode}`);
			}
		});
		request.on('error', (err) => {
			reject(`Failed to create ${project}/${slug} on Transifex: ${err}`);
		});

		request.write(data);
		request.end();
	});
}

/**
 * The following link provides information about how Transifex handles updates of a resource file:
 * https://dev.befoolish.co/tx-docs/public/projects/updating-content#what-happens-when-you-update-files
 */
function updateResource(project: string, slug: string, xlfFile: File, apiHostname: string, credentials: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify({ content: xlfFile.contents.toString() });
		const options = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resource/${slug}/content`,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(data)
			},
			auth: credentials,
			method: 'PUT'
		};

		let request = https.request(options, (res) => {
			if (res.statusCode === 200) {
				res.setEncoding('utf8');

				let responseBuffer: string = '';
				res.on('data', function (chunk) {
					responseBuffer += chunk;
				});
				res.on('end', () => {
					const response = JSON.parse(responseBuffer);
					log(`Resource ${project}/${slug} successfully updated on Transifex. Strings added: ${response.strings_added}, updated: ${response.strings_added}, deleted: ${response.strings_added}`);
					resolve();
				});
			} else {
				reject(`Something went wrong in the request updating ${slug} in ${project}. ${res.statusCode}`);
			}
		});
		request.on('error', (err) => {
			reject(`Failed to update ${project}/${slug} on Transifex: ${err}`);
		});

		request.write(data);
		request.end();
	});
}

// cache resources
let _coreAndExtensionResources: Resource[];

export function pullCoreAndExtensionsXlfFiles(apiHostname: string, username: string, password: string, language: Language, externalExtensions?: Map<string>): NodeJS.ReadableStream {
	if (!_coreAndExtensionResources) {
		_coreAndExtensionResources = [];
		// editor and workbench
		const json = JSON.parse(fs.readFileSync('./build/lib/i18n.resources.json', 'utf8'));
		_coreAndExtensionResources.push(...json.editor);
		_coreAndExtensionResources.push(...json.workbench);

		// extensions
		let extensionsToLocalize = Object.create(null);
		glob.sync('.build/extensions/**/*.nls.json').forEach(extension => extensionsToLocalize[extension.split('/')[2]] = true);
		glob.sync('.build/extensions/*/node_modules/vscode-nls').forEach(extension => extensionsToLocalize[extension.split('/')[2]] = true);

		Object.keys(extensionsToLocalize).forEach(extension => {
			_coreAndExtensionResources.push({ name: extension, project: extensionsProject });
		});

		if (externalExtensions) {
			for (let resourceName in externalExtensions) {
				_coreAndExtensionResources.push({ name: resourceName, project: extensionsProject });
			}
		}
	}
	return pullXlfFiles(apiHostname, username, password, language, _coreAndExtensionResources);
}

export function pullSetupXlfFiles(apiHostname: string, username: string, password: string, language: Language, includeDefault: boolean): NodeJS.ReadableStream {
	let setupResources = [{ name: 'setup_messages', project: workbenchProject }];
	if (includeDefault) {
		setupResources.push({ name: 'setup_default', project: setupProject });
	}
	return pullXlfFiles(apiHostname, username, password, language, setupResources);
}

function pullXlfFiles(apiHostname: string, username: string, password: string, language: Language, resources: Resource[]): NodeJS.ReadableStream {
	const credentials = `${username}:${password}`;
	let expectedTranslationsCount = resources.length;
	let translationsRetrieved = 0, called = false;

	return readable(function (_count: any, callback: any) {
		// Mark end of stream when all resources were retrieved
		if (translationsRetrieved === expectedTranslationsCount) {
			return this.emit('end');
		}

		if (!called) {
			called = true;
			const stream = this;
			resources.map(function (resource) {
				retrieveResource(language, resource, apiHostname, credentials).then((file: File | null) => {
					if (file) {
						stream.emit('data', file);
					}
					translationsRetrieved++;
				}).catch(error => { throw new Error(error); });
			});
		}

		callback();
	});
}
const limiter = new Limiter<File | null>(NUMBER_OF_CONCURRENT_DOWNLOADS);

function retrieveResource(language: Language, resource: Resource, apiHostname: string, credentials: string): Promise<File | null> {
	return limiter.queue(() => new Promise<File | null>((resolve, reject) => {
		const slug = resource.name.replace(/\//g, '_');
		const project = resource.project;
		let transifexLanguageId = language.id === 'ps' ? 'en' : language.translationId || language.id;
		const options = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resource/${slug}/translation/${transifexLanguageId}?file&mode=onlyreviewed`,
			auth: credentials,
			port: 443,
			method: 'GET'
		};
		console.log('[transifex] Fetching ' + options.path);

		let request = https.request(options, (res) => {
			let xlfBuffer: Buffer[] = [];
			res.on('data', (chunk: Buffer) => xlfBuffer.push(chunk));
			res.on('end', () => {
				if (res.statusCode === 200) {
					resolve(new File({ contents: Buffer.concat(xlfBuffer), path: `${project}/${slug}.xlf` }));
				} else if (res.statusCode === 404) {
					console.log(`[transifex] ${slug} in ${project} returned no data.`);
					resolve(null);
				} else {
					reject(`${slug} in ${project} returned no data. Response code: ${res.statusCode}.`);
				}
			});
		});
		request.on('error', (err) => {
			reject(`Failed to query resource ${slug} with the following error: ${err}. ${options.path}`);
		});
		request.end();
	}));
}

export function prepareI18nFiles(): ThroughStream {
	let parsePromises: Promise<ParsedXLF[]>[] = [];

	return through(function (this: ThroughStream, xlf: File) {
		let stream = this;
		let parsePromise = XLF.parse(xlf.contents.toString());
		parsePromises.push(parsePromise);
		parsePromise.then(
			resolvedFiles => {
				resolvedFiles.forEach(file => {
					let translatedFile = createI18nFile(file.originalFilePath, file.messages);
					stream.queue(translatedFile);
				});
			}
		);
	}, function () {
		Promise.all(parsePromises)
			.then(() => { this.queue(null); })
			.catch(reason => { throw new Error(reason); });
	});
}

function createI18nFile(originalFilePath: string, messages: any): File {
	let result = Object.create(null);
	result[''] = [
		'--------------------------------------------------------------------------------------------',
		'Copyright (c) Microsoft Corporation. All rights reserved.',
		'Licensed under the MIT License. See License.txt in the project root for license information.',
		'--------------------------------------------------------------------------------------------',
		'Do not edit this file. It is machine generated.'
	];
	for (let key of Object.keys(messages)) {
		result[key] = messages[key];
	}

	let content = JSON.stringify(result, null, '\t');
	if (process.platform === 'win32') {
		content = content.replace(/\n/g, '\r\n');
	}
	return new File({
		path: path.join(originalFilePath + '.i18n.json'),
		contents: Buffer.from(content, 'utf8')
	});
}

interface I18nPack {
	version: string;
	contents: {
		[path: string]: Map<string>;
	};
}

const i18nPackVersion = "1.0.0";

export interface TranslationPath {
	id: string;
	resourceName: string;
}

export function pullI18nPackFiles(apiHostname: string, username: string, password: string, language: Language, resultingTranslationPaths: TranslationPath[]): NodeJS.ReadableStream {
	return pullCoreAndExtensionsXlfFiles(apiHostname, username, password, language, externalExtensionsWithTranslations)
		.pipe(prepareI18nPackFiles(externalExtensionsWithTranslations, resultingTranslationPaths, language.id === 'ps'));
}

export function prepareI18nPackFiles(externalExtensions: Map<string>, resultingTranslationPaths: TranslationPath[], pseudo = false): NodeJS.ReadWriteStream {
	let parsePromises: Promise<ParsedXLF[]>[] = [];
	let mainPack: I18nPack = { version: i18nPackVersion, contents: {} };
	let extensionsPacks: Map<I18nPack> = {};
	let errors: any[] = [];
	return through(function (this: ThroughStream, xlf: File) {
		let project = path.basename(path.dirname(xlf.relative));
		let resource = path.basename(xlf.relative, '.xlf');
		let contents = xlf.contents.toString();
		let parsePromise = pseudo ? XLF.parsePseudo(contents) : XLF.parse(contents);
		parsePromises.push(parsePromise);
		parsePromise.then(
			resolvedFiles => {
				resolvedFiles.forEach(file => {
					const path = file.originalFilePath;
					const firstSlash = path.indexOf('/');

					if (project === extensionsProject) {
						let extPack = extensionsPacks[resource];
						if (!extPack) {
							extPack = extensionsPacks[resource] = { version: i18nPackVersion, contents: {} };
						}
						const externalId = externalExtensions[resource];
						if (!externalId) { // internal extension: remove 'extensions/extensionId/' segnent
							const secondSlash = path.indexOf('/', firstSlash + 1);
							extPack.contents[path.substr(secondSlash + 1)] = file.messages;
						} else {
							extPack.contents[path] = file.messages;
						}
					} else {
						mainPack.contents[path.substr(firstSlash + 1)] = file.messages;
					}
				});
			}
		).catch(reason => {
			errors.push(reason);
		});
	}, function () {
		Promise.all(parsePromises)
			.then(() => {
				if (errors.length > 0) {
					throw errors;
				}
				const translatedMainFile = createI18nFile('./main', mainPack);
				resultingTranslationPaths.push({ id: 'vscode', resourceName: 'main.i18n.json' });

				this.queue(translatedMainFile);
				for (let extension in extensionsPacks) {
					const translatedExtFile = createI18nFile(`extensions/${extension}`, extensionsPacks[extension]);
					this.queue(translatedExtFile);

					const externalExtensionId = externalExtensions[extension];
					if (externalExtensionId) {
						resultingTranslationPaths.push({ id: externalExtensionId, resourceName: `extensions/${extension}.i18n.json` });
					} else {
						resultingTranslationPaths.push({ id: `vscode.${extension}`, resourceName: `extensions/${extension}.i18n.json` });
					}

				}
				this.queue(null);
			})
			.catch((reason) => {
				this.emit('error', reason);
			});
	});
}

export function prepareIslFiles(language: Language, innoSetupConfig: InnoSetup): ThroughStream {
	let parsePromises: Promise<ParsedXLF[]>[] = [];

	return through(function (this: ThroughStream, xlf: File) {
		let stream = this;
		let parsePromise = XLF.parse(xlf.contents.toString());
		parsePromises.push(parsePromise);
		parsePromise.then(
			resolvedFiles => {
				resolvedFiles.forEach(file => {
					if (path.basename(file.originalFilePath) === 'Default' && !innoSetupConfig.defaultInfo) {
						return;
					}
					let translatedFile = createIslFile(file.originalFilePath, file.messages, language, innoSetupConfig);
					stream.queue(translatedFile);
				});
			}
		).catch(reason => {
			this.emit('error', reason);
		});
	}, function () {
		Promise.all(parsePromises)
			.then(() => { this.queue(null); })
			.catch(reason => {
				this.emit('error', reason);
			});
	});
}

function createIslFile(originalFilePath: string, messages: Map<string>, language: Language, innoSetup: InnoSetup): File {
	let content: string[] = [];
	let originalContent: TextModel;
	if (path.basename(originalFilePath) === 'Default') {
		originalContent = new TextModel(fs.readFileSync(originalFilePath + '.isl', 'utf8'));
	} else {
		originalContent = new TextModel(fs.readFileSync(originalFilePath + '.en.isl', 'utf8'));
	}
	originalContent.lines.forEach(line => {
		if (line.length > 0) {
			let firstChar = line.charAt(0);
			if (firstChar === '[' || firstChar === ';') {
				content.push(line);
			} else {
				let sections: string[] = line.split('=');
				let key = sections[0];
				let translated = line;
				if (key) {
					if (key === 'LanguageName') {
						translated = `${key}=${innoSetup.defaultInfo!.name}`;
					} else if (key === 'LanguageID') {
						translated = `${key}=${innoSetup.defaultInfo!.id}`;
					} else if (key === 'LanguageCodePage') {
						translated = `${key}=${innoSetup.codePage.substr(2)}`;
					} else {
						let translatedMessage = messages[key];
						if (translatedMessage) {
							translated = `${key}=${translatedMessage}`;
						}
					}
				}

				content.push(translated);
			}
		}
	});

	const basename = path.basename(originalFilePath);
	const filePath = `${basename}.${language.id}.isl`;
	const encoded = iconv.encode(Buffer.from(content.join('\r\n'), 'utf8').toString(), innoSetup.codePage);

	return new File({
		path: filePath,
		contents: Buffer.from(encoded),
	});
}

function encodeEntities(value: string): string {
	let result: string[] = [];
	for (let i = 0; i < value.length; i++) {
		let ch = value[i];
		switch (ch) {
			case '<':
				result.push('&lt;');
				break;
			case '>':
				result.push('&gt;');
				break;
			case '&':
				result.push('&amp;');
				break;
			default:
				result.push(ch);
		}
	}
	return result.join('');
}

function decodeEntities(value: string): string {
	return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function pseudify(message: string) {
	return '\uFF3B' + message.replace(/[aouei]/g, '$&$&') + '\uFF3D';
}
