/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';

export interface IIconRegistry {
	readonly all: IterableIterator<Codicon>;
	readonly onDidRegister: Event<Codicon>;
	get(id: string): Codicon | undefined;
}

class Registry implements IIconRegistry {

	private readonly _icons = new Map<string, Codicon>();
	private readonly _onDidRegister = new Emitter<Codicon>();

	public add(icon: Codicon) {
		const existing = this._icons.get(icon.id);
		if (!existing) {
			this._icons.set(icon.id, icon);
			this._onDidRegister.fire(icon);
		} else if (icon.description) {
			existing.description = icon.description;
		} else {
			console.error(`Duplicate registration of codicon ${icon.id}`);
		}
	}

	public get(id: string): Codicon | undefined {
		return this._icons.get(id);
	}

	public get all(): IterableIterator<Codicon> {
		return this._icons.values();
	}

	public get onDidRegister(): Event<Codicon> {
		return this._onDidRegister.event;
	}
}

const _registry = new Registry();

export const iconRegistry: IIconRegistry = _registry;

export function registerCodicon(id: string, def: Codicon): Codicon {
	return new Codicon(id, def);
}

// Selects all codicon names encapsulated in the `$()` syntax and wraps the
// results with spaces so that screen readers can read the text better.
export function getCodiconAriaLabel(text: string | undefined) {
	if (!text) {
		return '';
	}

	return text.replace(/\$\((.*?)\)/g, (_match, codiconName) => ` ${codiconName} `).trim();
}

export class Codicon implements CSSIcon {
	constructor(public readonly id: string, public readonly definition: Codicon | IconDefinition, public description?: string) {
		_registry.add(this);
	}
	public get classNames() { return 'codicon codicon-' + this.id; }
	// classNamesArray is useful for migrating to ES6 classlist
	public get classNamesArray() { return ['codicon', 'codicon-' + this.id]; }
	public get cssSelector() { return '.codicon.codicon-' + this.id; }
}

export function getClassNamesArray(id: string, modifier?: string) {
	const classNames = ['codicon', 'codicon-' + id];
	if (modifier) {
		classNames.push('codicon-modifier-' + modifier);
	}
	return classNames;
}

export interface CSSIcon {
	readonly id: string;
}


export namespace CSSIcon {
	export const iconNameSegment = '[A-Za-z0-9]+';
	export const iconNameExpression = '[A-Za-z0-9\\-]+';
	export const iconModifierExpression = '~[A-Za-z]+';

	const cssIconIdRegex = new RegExp(`^(${iconNameExpression})(${iconModifierExpression})?$`);

	export function asClassNameArray(icon: CSSIcon): string[] {
		if (icon instanceof Codicon) {
			return ['codicon', 'codicon-' + icon.id];
		}
		const match = cssIconIdRegex.exec(icon.id);
		if (!match) {
			return asClassNameArray(Codicon.error);
		}
		let [, id, modifier] = match;
		const classNames = ['codicon', 'codicon-' + id];
		if (modifier) {
			classNames.push('codicon-modifier-' + modifier.substr(1));
		}
		return classNames;
	}

	export function asClassName(icon: CSSIcon): string {
		return asClassNameArray(icon).join(' ');
	}

	export function asCSSSelector(icon: CSSIcon): string {
		return '.' + asClassNameArray(icon).join('.');
	}
}



interface IconDefinition {
	fontCharacter: string;
}

export namespace Codicon {

	// built-in icons, with image name
	export const add = new Codicon('add', { fontCharacter: '\\ea60' });
	export const plus = new Codicon('plus', { fontCharacter: '\\ea60' });
	export const gistNew = new Codicon('gist-new', { fontCharacter: '\\ea60' });
	export const repoCreate = new Codicon('repo-create', { fontCharacter: '\\ea60' });
	export const lightbulb = new Codicon('lightbulb', { fontCharacter: '\\ea61' });
	export const lightBulb = new Codicon('light-bulb', { fontCharacter: '\\ea61' });
	export const repo = new Codicon('repo', { fontCharacter: '\\ea62' });
	export const repoDelete = new Codicon('repo-delete', { fontCharacter: '\\ea62' });
	export const gistFork = new Codicon('gist-fork', { fontCharacter: '\\ea63' });
	export const repoForked = new Codicon('repo-forked', { fontCharacter: '\\ea63' });
	export const gitPullRequest = new Codicon('git-pull-request', { fontCharacter: '\\ea64' });
	export const gitPullRequestAbandoned = new Codicon('git-pull-request-abandoned', { fontCharacter: '\\ea64' });
	export const recordKeys = new Codicon('record-keys', { fontCharacter: '\\ea65' });
	export const keyboard = new Codicon('keyboard', { fontCharacter: '\\ea65' });
	export const tag = new Codicon('tag', { fontCharacter: '\\ea66' });
	export const tagAdd = new Codicon('tag-add', { fontCharacter: '\\ea66' });
	export const tagRemove = new Codicon('tag-remove', { fontCharacter: '\\ea66' });
	export const person = new Codicon('person', { fontCharacter: '\\ea67' });
	export const personFollow = new Codicon('person-follow', { fontCharacter: '\\ea67' });
	export const personOutline = new Codicon('person-outline', { fontCharacter: '\\ea67' });
	export const personFilled = new Codicon('person-filled', { fontCharacter: '\\ea67' });
	export const gitBranch = new Codicon('git-branch', { fontCharacter: '\\ea68' });
	export const gitBranchCreate = new Codicon('git-branch-create', { fontCharacter: '\\ea68' });
	export const gitBranchDelete = new Codicon('git-branch-delete', { fontCharacter: '\\ea68' });
	export const sourceControl = new Codicon('source-control', { fontCharacter: '\\ea68' });
	export const mirror = new Codicon('mirror', { fontCharacter: '\\ea69' });
	export const mirrorPublic = new Codicon('mirror-public', { fontCharacter: '\\ea69' });
	export const star = new Codicon('star', { fontCharacter: '\\ea6a' });
	export const starAdd = new Codicon('star-add', { fontCharacter: '\\ea6a' });
	export const starDelete = new Codicon('star-delete', { fontCharacter: '\\ea6a' });
	export const starEmpty = new Codicon('star-empty', { fontCharacter: '\\ea6a' });
	export const comment = new Codicon('comment', { fontCharacter: '\\ea6b' });
	export const commentAdd = new Codicon('comment-add', { fontCharacter: '\\ea6b' });
	export const alert = new Codicon('alert', { fontCharacter: '\\ea6c' });
	export const warning = new Codicon('warning', { fontCharacter: '\\ea6c' });
	export const search = new Codicon('search', { fontCharacter: '\\ea6d' });
	export const searchSave = new Codicon('search-save', { fontCharacter: '\\ea6d' });
	export const logOut = new Codicon('log-out', { fontCharacter: '\\ea6e' });
	export const signOut = new Codicon('sign-out', { fontCharacter: '\\ea6e' });
	export const logIn = new Codicon('log-in', { fontCharacter: '\\ea6f' });
	export const signIn = new Codicon('sign-in', { fontCharacter: '\\ea6f' });
	export const eye = new Codicon('eye', { fontCharacter: '\\ea70' });
	export const eyeUnwatch = new Codicon('eye-unwatch', { fontCharacter: '\\ea70' });
	export const eyeWatch = new Codicon('eye-watch', { fontCharacter: '\\ea70' });
	export const circleFilled = new Codicon('circle-filled', { fontCharacter: '\\ea71' });
	export const primitiveDot = new Codicon('primitive-dot', { fontCharacter: '\\ea71' });
	export const closeDirty = new Codicon('close-dirty', { fontCharacter: '\\ea71' });
	export const debugBreakpoint = new Codicon('debug-breakpoint', { fontCharacter: '\\ea71' });
	export const debugBreakpointDisabled = new Codicon('debug-breakpoint-disabled', { fontCharacter: '\\ea71' });
	export const debugHint = new Codicon('debug-hint', { fontCharacter: '\\ea71' });
	export const primitiveSquare = new Codicon('primitive-square', { fontCharacter: '\\ea72' });
	export const edit = new Codicon('edit', { fontCharacter: '\\ea73' });
	export const pencil = new Codicon('pencil', { fontCharacter: '\\ea73' });
	export const info = new Codicon('info', { fontCharacter: '\\ea74' });
	export const issueOpened = new Codicon('issue-opened', { fontCharacter: '\\ea74' });
	export const gistPrivate = new Codicon('gist-private', { fontCharacter: '\\ea75' });
	export const gitForkPrivate = new Codicon('git-fork-private', { fontCharacter: '\\ea75' });
	export const lock = new Codicon('lock', { fontCharacter: '\\ea75' });
	export const mirrorPrivate = new Codicon('mirror-private', { fontCharacter: '\\ea75' });
	export const close = new Codicon('close', { fontCharacter: '\\ea76' });
	export const removeClose = new Codicon('remove-close', { fontCharacter: '\\ea76' });
	export const x = new Codicon('x', { fontCharacter: '\\ea76' });
	export const repoSync = new Codicon('repo-sync', { fontCharacter: '\\ea77' });
	export const sync = new Codicon('sync', { fontCharacter: '\\ea77' });
	export const clone = new Codicon('clone', { fontCharacter: '\\ea78' });
	export const desktopDownload = new Codicon('desktop-download', { fontCharacter: '\\ea78' });
	export const beaker = new Codicon('beaker', { fontCharacter: '\\ea79' });
	export const microscope = new Codicon('microscope', { fontCharacter: '\\ea79' });
	export const vm = new Codicon('vm', { fontCharacter: '\\ea7a' });
	export const deviceDesktop = new Codicon('device-desktop', { fontCharacter: '\\ea7a' });
	export const file = new Codicon('file', { fontCharacter: '\\ea7b' });
	export const fileText = new Codicon('file-text', { fontCharacter: '\\ea7b' });
	export const more = new Codicon('more', { fontCharacter: '\\ea7c' });
	export const ellipsis = new Codicon('ellipsis', { fontCharacter: '\\ea7c' });
	export const kebabHorizontal = new Codicon('kebab-horizontal', { fontCharacter: '\\ea7c' });
	export const mailReply = new Codicon('mail-reply', { fontCharacter: '\\ea7d' });
	export const reply = new Codicon('reply', { fontCharacter: '\\ea7d' });
	export const organization = new Codicon('organization', { fontCharacter: '\\ea7e' });
	export const organizationFilled = new Codicon('organization-filled', { fontCharacter: '\\ea7e' });
	export const organizationOutline = new Codicon('organization-outline', { fontCharacter: '\\ea7e' });
	export const newFile = new Codicon('new-file', { fontCharacter: '\\ea7f' });
	export const fileAdd = new Codicon('file-add', { fontCharacter: '\\ea7f' });
	export const newFolder = new Codicon('new-folder', { fontCharacter: '\\ea80' });
	export const fileDirectoryCreate = new Codicon('file-directory-create', { fontCharacter: '\\ea80' });
	export const trash = new Codicon('trash', { fontCharacter: '\\ea81' });
	export const trashcan = new Codicon('trashcan', { fontCharacter: '\\ea81' });
	export const history = new Codicon('history', { fontCharacter: '\\ea82' });
	export const clock = new Codicon('clock', { fontCharacter: '\\ea82' });
	export const folder = new Codicon('folder', { fontCharacter: '\\ea83' });
	export const fileDirectory = new Codicon('file-directory', { fontCharacter: '\\ea83' });
	export const symbolFolder = new Codicon('symbol-folder', { fontCharacter: '\\ea83' });
	export const logoGithub = new Codicon('logo-github', { fontCharacter: '\\ea84' });
	export const markGithub = new Codicon('mark-github', { fontCharacter: '\\ea84' });
	export const github = new Codicon('github', { fontCharacter: '\\ea84' });
	export const terminal = new Codicon('terminal', { fontCharacter: '\\ea85' });
	export const console = new Codicon('console', { fontCharacter: '\\ea85' });
	export const repl = new Codicon('repl', { fontCharacter: '\\ea85' });
	export const zap = new Codicon('zap', { fontCharacter: '\\ea86' });
	export const symbolEvent = new Codicon('symbol-event', { fontCharacter: '\\ea86' });
	export const error = new Codicon('error', { fontCharacter: '\\ea87' });
	export const stop = new Codicon('stop', { fontCharacter: '\\ea87' });
	export const variable = new Codicon('variable', { fontCharacter: '\\ea88' });
	export const symbolVariable = new Codicon('symbol-variable', { fontCharacter: '\\ea88' });
	export const array = new Codicon('array', { fontCharacter: '\\ea8a' });
	export const symbolArray = new Codicon('symbol-array', { fontCharacter: '\\ea8a' });
	export const symbolModule = new Codicon('symbol-module', { fontCharacter: '\\ea8b' });
	export const symbolPackage = new Codicon('symbol-package', { fontCharacter: '\\ea8b' });
	export const symbolNamespace = new Codicon('symbol-namespace', { fontCharacter: '\\ea8b' });
	export const symbolObject = new Codicon('symbol-object', { fontCharacter: '\\ea8b' });
	export const symbolMethod = new Codicon('symbol-method', { fontCharacter: '\\ea8c' });
	export const symbolFunction = new Codicon('symbol-function', { fontCharacter: '\\ea8c' });
	export const symbolConstructor = new Codicon('symbol-constructor', { fontCharacter: '\\ea8c' });
	export const symbolBoolean = new Codicon('symbol-boolean', { fontCharacter: '\\ea8f' });
	export const symbolNull = new Codicon('symbol-null', { fontCharacter: '\\ea8f' });
	export const symbolNumeric = new Codicon('symbol-numeric', { fontCharacter: '\\ea90' });
	export const symbolNumber = new Codicon('symbol-number', { fontCharacter: '\\ea90' });
	export const symbolStructure = new Codicon('symbol-structure', { fontCharacter: '\\ea91' });
	export const symbolStruct = new Codicon('symbol-struct', { fontCharacter: '\\ea91' });
	export const symbolParameter = new Codicon('symbol-parameter', { fontCharacter: '\\ea92' });
	export const symbolTypeParameter = new Codicon('symbol-type-parameter', { fontCharacter: '\\ea92' });
	export const symbolKey = new Codicon('symbol-key', { fontCharacter: '\\ea93' });
	export const symbolText = new Codicon('symbol-text', { fontCharacter: '\\ea93' });
	export const symbolReference = new Codicon('symbol-reference', { fontCharacter: '\\ea94' });
	export const goToFile = new Codicon('go-to-file', { fontCharacter: '\\ea94' });
	export const symbolEnum = new Codicon('symbol-enum', { fontCharacter: '\\ea95' });
	export const symbolValue = new Codicon('symbol-value', { fontCharacter: '\\ea95' });
	export const symbolRuler = new Codicon('symbol-ruler', { fontCharacter: '\\ea96' });
	export const symbolUnit = new Codicon('symbol-unit', { fontCharacter: '\\ea96' });
	export const activateBreakpoints = new Codicon('activate-breakpoints', { fontCharacter: '\\ea97' });
	export const archive = new Codicon('archive', { fontCharacter: '\\ea98' });
	export const arrowBoth = new Codicon('arrow-both', { fontCharacter: '\\ea99' });
	export const arrowDown = new Codicon('arrow-down', { fontCharacter: '\\ea9a' });
	export const arrowLeft = new Codicon('arrow-left', { fontCharacter: '\\ea9b' });
	export const arrowRight = new Codicon('arrow-right', { fontCharacter: '\\ea9c' });
	export const arrowSmallDown = new Codicon('arrow-small-down', { fontCharacter: '\\ea9d' });
	export const arrowSmallLeft = new Codicon('arrow-small-left', { fontCharacter: '\\ea9e' });
	export const arrowSmallRight = new Codicon('arrow-small-right', { fontCharacter: '\\ea9f' });
	export const arrowSmallUp = new Codicon('arrow-small-up', { fontCharacter: '\\eaa0' });
	export const arrowUp = new Codicon('arrow-up', { fontCharacter: '\\eaa1' });
	export const bell = new Codicon('bell', { fontCharacter: '\\eaa2' });
	export const bold = new Codicon('bold', { fontCharacter: '\\eaa3' });
	export const book = new Codicon('book', { fontCharacter: '\\eaa4' });
	export const bookmark = new Codicon('bookmark', { fontCharacter: '\\eaa5' });
	export const debugBreakpointConditionalUnverified = new Codicon('debug-breakpoint-conditional-unverified', { fontCharacter: '\\eaa6' });
	export const debugBreakpointConditional = new Codicon('debug-breakpoint-conditional', { fontCharacter: '\\eaa7' });
	export const debugBreakpointConditionalDisabled = new Codicon('debug-breakpoint-conditional-disabled', { fontCharacter: '\\eaa7' });
	export const debugBreakpointDataUnverified = new Codicon('debug-breakpoint-data-unverified', { fontCharacter: '\\eaa8' });
	export const debugBreakpointData = new Codicon('debug-breakpoint-data', { fontCharacter: '\\eaa9' });
	export const debugBreakpointDataDisabled = new Codicon('debug-breakpoint-data-disabled', { fontCharacter: '\\eaa9' });
	export const debugBreakpointLogUnverified = new Codicon('debug-breakpoint-log-unverified', { fontCharacter: '\\eaaa' });
	export const debugBreakpointLog = new Codicon('debug-breakpoint-log', { fontCharacter: '\\eaab' });
	export const debugBreakpointLogDisabled = new Codicon('debug-breakpoint-log-disabled', { fontCharacter: '\\eaab' });
	export const briefcase = new Codicon('briefcase', { fontCharacter: '\\eaac' });
	export const broadcast = new Codicon('broadcast', { fontCharacter: '\\eaad' });
	export const browser = new Codicon('browser', { fontCharacter: '\\eaae' });
	export const bug = new Codicon('bug', { fontCharacter: '\\eaaf' });
	export const calendar = new Codicon('calendar', { fontCharacter: '\\eab0' });
	export const caseSensitive = new Codicon('case-sensitive', { fontCharacter: '\\eab1' });
	export const check = new Codicon('check', { fontCharacter: '\\eab2' });
	export const checklist = new Codicon('checklist', { fontCharacter: '\\eab3' });
	export const chevronDown = new Codicon('chevron-down', { fontCharacter: '\\eab4' });
	export const chevronLeft = new Codicon('chevron-left', { fontCharacter: '\\eab5' });
	export const chevronRight = new Codicon('chevron-right', { fontCharacter: '\\eab6' });
	export const chevronUp = new Codicon('chevron-up', { fontCharacter: '\\eab7' });
	export const chromeClose = new Codicon('chrome-close', { fontCharacter: '\\eab8' });
	export const chromeMaximize = new Codicon('chrome-maximize', { fontCharacter: '\\eab9' });
	export const chromeMinimize = new Codicon('chrome-minimize', { fontCharacter: '\\eaba' });
	export const chromeRestore = new Codicon('chrome-restore', { fontCharacter: '\\eabb' });
	export const circleOutline = new Codicon('circle-outline', { fontCharacter: '\\eabc' });
	export const debugBreakpointUnverified = new Codicon('debug-breakpoint-unverified', { fontCharacter: '\\eabc' });
	export const circleSlash = new Codicon('circle-slash', { fontCharacter: '\\eabd' });
	export const circuitBoard = new Codicon('circuit-board', { fontCharacter: '\\eabe' });
	export const clearAll = new Codicon('clear-all', { fontCharacter: '\\eabf' });
	export const clippy = new Codicon('clippy', { fontCharacter: '\\eac0' });
	export const closeAll = new Codicon('close-all', { fontCharacter: '\\eac1' });
	export const cloudDownload = new Codicon('cloud-download', { fontCharacter: '\\eac2' });
	export const cloudUpload = new Codicon('cloud-upload', { fontCharacter: '\\eac3' });
	export const code = new Codicon('code', { fontCharacter: '\\eac4' });
	export const collapseAll = new Codicon('collapse-all', { fontCharacter: '\\eac5' });
	export const colorMode = new Codicon('color-mode', { fontCharacter: '\\eac6' });
	export const commentDiscussion = new Codicon('comment-discussion', { fontCharacter: '\\eac7' });
	export const compareChanges = new Codicon('compare-changes', { fontCharacter: '\\eafd' });
	export const creditCard = new Codicon('credit-card', { fontCharacter: '\\eac9' });
	export const dash = new Codicon('dash', { fontCharacter: '\\eacc' });
	export const dashboard = new Codicon('dashboard', { fontCharacter: '\\eacd' });
	export const database = new Codicon('database', { fontCharacter: '\\eace' });
	export const debugContinue = new Codicon('debug-continue', { fontCharacter: '\\eacf' });
	export const debugDisconnect = new Codicon('debug-disconnect', { fontCharacter: '\\ead0' });
	export const debugPause = new Codicon('debug-pause', { fontCharacter: '\\ead1' });
	export const debugRestart = new Codicon('debug-restart', { fontCharacter: '\\ead2' });
	export const debugStart = new Codicon('debug-start', { fontCharacter: '\\ead3' });
	export const debugStepInto = new Codicon('debug-step-into', { fontCharacter: '\\ead4' });
	export const debugStepOut = new Codicon('debug-step-out', { fontCharacter: '\\ead5' });
	export const debugStepOver = new Codicon('debug-step-over', { fontCharacter: '\\ead6' });
	export const debugStop = new Codicon('debug-stop', { fontCharacter: '\\ead7' });
	export const debug = new Codicon('debug', { fontCharacter: '\\ead8' });
	export const deviceCameraVideo = new Codicon('device-camera-video', { fontCharacter: '\\ead9' });
	export const deviceCamera = new Codicon('device-camera', { fontCharacter: '\\eada' });
	export const deviceMobile = new Codicon('device-mobile', { fontCharacter: '\\eadb' });
	export const diffAdded = new Codicon('diff-added', { fontCharacter: '\\eadc' });
	export const diffIgnored = new Codicon('diff-ignored', { fontCharacter: '\\eadd' });
	export const diffModified = new Codicon('diff-modified', { fontCharacter: '\\eade' });
	export const diffRemoved = new Codicon('diff-removed', { fontCharacter: '\\eadf' });
	export const diffRenamed = new Codicon('diff-renamed', { fontCharacter: '\\eae0' });
	export const diff = new Codicon('diff', { fontCharacter: '\\eae1' });
	export const discard = new Codicon('discard', { fontCharacter: '\\eae2' });
	export const editorLayout = new Codicon('editor-layout', { fontCharacter: '\\eae3' });
	export const emptyWindow = new Codicon('empty-window', { fontCharacter: '\\eae4' });
	export const exclude = new Codicon('exclude', { fontCharacter: '\\eae5' });
	export const extensions = new Codicon('extensions', { fontCharacter: '\\eae6' });
	export const eyeClosed = new Codicon('eye-closed', { fontCharacter: '\\eae7' });
	export const fileBinary = new Codicon('file-binary', { fontCharacter: '\\eae8' });
	export const fileCode = new Codicon('file-code', { fontCharacter: '\\eae9' });
	export const fileMedia = new Codicon('file-media', { fontCharacter: '\\eaea' });
	export const filePdf = new Codicon('file-pdf', { fontCharacter: '\\eaeb' });
	export const fileSubmodule = new Codicon('file-submodule', { fontCharacter: '\\eaec' });
	export const fileSymlinkDirectory = new Codicon('file-symlink-directory', { fontCharacter: '\\eaed' });
	export const fileSymlinkFile = new Codicon('file-symlink-file', { fontCharacter: '\\eaee' });
	export const fileZip = new Codicon('file-zip', { fontCharacter: '\\eaef' });
	export const files = new Codicon('files', { fontCharacter: '\\eaf0' });
	export const filter = new Codicon('filter', { fontCharacter: '\\eaf1' });
	export const flame = new Codicon('flame', { fontCharacter: '\\eaf2' });
	export const foldDown = new Codicon('fold-down', { fontCharacter: '\\eaf3' });
	export const foldUp = new Codicon('fold-up', { fontCharacter: '\\eaf4' });
	export const fold = new Codicon('fold', { fontCharacter: '\\eaf5' });
	export const folderActive = new Codicon('folder-active', { fontCharacter: '\\eaf6' });
	export const folderOpened = new Codicon('folder-opened', { fontCharacter: '\\eaf7' });
	export const gear = new Codicon('gear', { fontCharacter: '\\eaf8' });
	export const gift = new Codicon('gift', { fontCharacter: '\\eaf9' });
	export const gistSecret = new Codicon('gist-secret', { fontCharacter: '\\eafa' });
	export const gist = new Codicon('gist', { fontCharacter: '\\eafb' });
	export const gitCommit = new Codicon('git-commit', { fontCharacter: '\\eafc' });
	export const gitCompare = new Codicon('git-compare', { fontCharacter: '\\eafd' });
	export const gitMerge = new Codicon('git-merge', { fontCharacter: '\\eafe' });
	export const githubAction = new Codicon('github-action', { fontCharacter: '\\eaff' });
	export const githubAlt = new Codicon('github-alt', { fontCharacter: '\\eb00' });
	export const globe = new Codicon('globe', { fontCharacter: '\\eb01' });
	export const grabber = new Codicon('grabber', { fontCharacter: '\\eb02' });
	export const graph = new Codicon('graph', { fontCharacter: '\\eb03' });
	export const gripper = new Codicon('gripper', { fontCharacter: '\\eb04' });
	export const heart = new Codicon('heart', { fontCharacter: '\\eb05' });
	export const home = new Codicon('home', { fontCharacter: '\\eb06' });
	export const horizontalRule = new Codicon('horizontal-rule', { fontCharacter: '\\eb07' });
	export const hubot = new Codicon('hubot', { fontCharacter: '\\eb08' });
	export const inbox = new Codicon('inbox', { fontCharacter: '\\eb09' });
	export const issueClosed = new Codicon('issue-closed', { fontCharacter: '\\eb0a' });
	export const issueReopened = new Codicon('issue-reopened', { fontCharacter: '\\eb0b' });
	export const issues = new Codicon('issues', { fontCharacter: '\\eb0c' });
	export const italic = new Codicon('italic', { fontCharacter: '\\eb0d' });
	export const jersey = new Codicon('jersey', { fontCharacter: '\\eb0e' });
	export const json = new Codicon('json', { fontCharacter: '\\eb0f' });
	export const kebabVertical = new Codicon('kebab-vertical', { fontCharacter: '\\eb10' });
	export const key = new Codicon('key', { fontCharacter: '\\eb11' });
	export const law = new Codicon('law', { fontCharacter: '\\eb12' });
	export const lightbulbAutofix = new Codicon('lightbulb-autofix', { fontCharacter: '\\eb13' });
	export const linkExternal = new Codicon('link-external', { fontCharacter: '\\eb14' });
	export const link = new Codicon('link', { fontCharacter: '\\eb15' });
	export const listOrdered = new Codicon('list-ordered', { fontCharacter: '\\eb16' });
	export const listUnordered = new Codicon('list-unordered', { fontCharacter: '\\eb17' });
	export const liveShare = new Codicon('live-share', { fontCharacter: '\\eb18' });
	export const loading = new Codicon('loading', { fontCharacter: '\\eb19' });
	export const location = new Codicon('location', { fontCharacter: '\\eb1a' });
	export const mailRead = new Codicon('mail-read', { fontCharacter: '\\eb1b' });
	export const mail = new Codicon('mail', { fontCharacter: '\\eb1c' });
	export const markdown = new Codicon('markdown', { fontCharacter: '\\eb1d' });
	export const megaphone = new Codicon('megaphone', { fontCharacter: '\\eb1e' });
	export const mention = new Codicon('mention', { fontCharacter: '\\eb1f' });
	export const milestone = new Codicon('milestone', { fontCharacter: '\\eb20' });
	export const mortarBoard = new Codicon('mortar-board', { fontCharacter: '\\eb21' });
	export const move = new Codicon('move', { fontCharacter: '\\eb22' });
	export const multipleWindows = new Codicon('multiple-windows', { fontCharacter: '\\eb23' });
	export const mute = new Codicon('mute', { fontCharacter: '\\eb24' });
	export const noNewline = new Codicon('no-newline', { fontCharacter: '\\eb25' });
	export const note = new Codicon('note', { fontCharacter: '\\eb26' });
	export const octoface = new Codicon('octoface', { fontCharacter: '\\eb27' });
	export const openPreview = new Codicon('open-preview', { fontCharacter: '\\eb28' });
	export const package_ = new Codicon('package', { fontCharacter: '\\eb29' });
	export const paintcan = new Codicon('paintcan', { fontCharacter: '\\eb2a' });
	export const pin = new Codicon('pin', { fontCharacter: '\\eb2b' });
	export const play = new Codicon('play', { fontCharacter: '\\eb2c' });
	export const run = new Codicon('run', { fontCharacter: '\\eb2c' });
	export const plug = new Codicon('plug', { fontCharacter: '\\eb2d' });
	export const preserveCase = new Codicon('preserve-case', { fontCharacter: '\\eb2e' });
	export const preview = new Codicon('preview', { fontCharacter: '\\eb2f' });
	export const project = new Codicon('project', { fontCharacter: '\\eb30' });
	export const pulse = new Codicon('pulse', { fontCharacter: '\\eb31' });
	export const question = new Codicon('question', { fontCharacter: '\\eb32' });
	export const quote = new Codicon('quote', { fontCharacter: '\\eb33' });
	export const radioTower = new Codicon('radio-tower', { fontCharacter: '\\eb34' });
	export const reactions = new Codicon('reactions', { fontCharacter: '\\eb35' });
	export const references = new Codicon('references', { fontCharacter: '\\eb36' });
	export const refresh = new Codicon('refresh', { fontCharacter: '\\eb37' });
	export const regex = new Codicon('regex', { fontCharacter: '\\eb38' });
	export const remoteExplorer = new Codicon('remote-explorer', { fontCharacter: '\\eb39' });
	export const remote = new Codicon('remote', { fontCharacter: '\\eb3a' });
	export const remove = new Codicon('remove', { fontCharacter: '\\eb3b' });
	export const replaceAll = new Codicon('replace-all', { fontCharacter: '\\eb3c' });
	export const replace = new Codicon('replace', { fontCharacter: '\\eb3d' });
	export const repoClone = new Codicon('repo-clone', { fontCharacter: '\\eb3e' });
	export const repoForcePush = new Codicon('repo-force-push', { fontCharacter: '\\eb3f' });
	export const repoPull = new Codicon('repo-pull', { fontCharacter: '\\eb40' });
	export const repoPush = new Codicon('repo-push', { fontCharacter: '\\eb41' });
	export const report = new Codicon('report', { fontCharacter: '\\eb42' });
	export const requestChanges = new Codicon('request-changes', { fontCharacter: '\\eb43' });
	export const rocket = new Codicon('rocket', { fontCharacter: '\\eb44' });
	export const rootFolderOpened = new Codicon('root-folder-opened', { fontCharacter: '\\eb45' });
	export const rootFolder = new Codicon('root-folder', { fontCharacter: '\\eb46' });
	export const rss = new Codicon('rss', { fontCharacter: '\\eb47' });
	export const ruby = new Codicon('ruby', { fontCharacter: '\\eb48' });
	export const saveAll = new Codicon('save-all', { fontCharacter: '\\eb49' });
	export const saveAs = new Codicon('save-as', { fontCharacter: '\\eb4a' });
	export const save = new Codicon('save', { fontCharacter: '\\eb4b' });
	export const screenFull = new Codicon('screen-full', { fontCharacter: '\\eb4c' });
	export const screenNormal = new Codicon('screen-normal', { fontCharacter: '\\eb4d' });
	export const searchStop = new Codicon('search-stop', { fontCharacter: '\\eb4e' });
	export const server = new Codicon('server', { fontCharacter: '\\eb50' });
	export const settingsGear = new Codicon('settings-gear', { fontCharacter: '\\eb51' });
	export const settings = new Codicon('settings', { fontCharacter: '\\eb52' });
	export const shield = new Codicon('shield', { fontCharacter: '\\eb53' });
	export const smiley = new Codicon('smiley', { fontCharacter: '\\eb54' });
	export const sortPrecedence = new Codicon('sort-precedence', { fontCharacter: '\\eb55' });
	export const splitHorizontal = new Codicon('split-horizontal', { fontCharacter: '\\eb56' });
	export const splitVertical = new Codicon('split-vertical', { fontCharacter: '\\eb57' });
	export const squirrel = new Codicon('squirrel', { fontCharacter: '\\eb58' });
	export const starFull = new Codicon('star-full', { fontCharacter: '\\eb59' });
	export const starHalf = new Codicon('star-half', { fontCharacter: '\\eb5a' });
	export const symbolClass = new Codicon('symbol-class', { fontCharacter: '\\eb5b' });
	export const symbolColor = new Codicon('symbol-color', { fontCharacter: '\\eb5c' });
	export const symbolConstant = new Codicon('symbol-constant', { fontCharacter: '\\eb5d' });
	export const symbolEnumMember = new Codicon('symbol-enum-member', { fontCharacter: '\\eb5e' });
	export const symbolField = new Codicon('symbol-field', { fontCharacter: '\\eb5f' });
	export const symbolFile = new Codicon('symbol-file', { fontCharacter: '\\eb60' });
	export const symbolInterface = new Codicon('symbol-interface', { fontCharacter: '\\eb61' });
	export const symbolKeyword = new Codicon('symbol-keyword', { fontCharacter: '\\eb62' });
	export const symbolMisc = new Codicon('symbol-misc', { fontCharacter: '\\eb63' });
	export const symbolOperator = new Codicon('symbol-operator', { fontCharacter: '\\eb64' });
	export const symbolProperty = new Codicon('symbol-property', { fontCharacter: '\\eb65' });
	export const wrench = new Codicon('wrench', { fontCharacter: '\\eb65' });
	export const wrenchSubaction = new Codicon('wrench-subaction', { fontCharacter: '\\eb65' });
	export const symbolSnippet = new Codicon('symbol-snippet', { fontCharacter: '\\eb66' });
	export const tasklist = new Codicon('tasklist', { fontCharacter: '\\eb67' });
	export const telescope = new Codicon('telescope', { fontCharacter: '\\eb68' });
	export const textSize = new Codicon('text-size', { fontCharacter: '\\eb69' });
	export const threeBars = new Codicon('three-bars', { fontCharacter: '\\eb6a' });
	export const thumbsdown = new Codicon('thumbsdown', { fontCharacter: '\\eb6b' });
	export const thumbsup = new Codicon('thumbsup', { fontCharacter: '\\eb6c' });
	export const tools = new Codicon('tools', { fontCharacter: '\\eb6d' });
	export const triangleDown = new Codicon('triangle-down', { fontCharacter: '\\eb6e' });
	export const triangleLeft = new Codicon('triangle-left', { fontCharacter: '\\eb6f' });
	export const triangleRight = new Codicon('triangle-right', { fontCharacter: '\\eb70' });
	export const triangleUp = new Codicon('triangle-up', { fontCharacter: '\\eb71' });
	export const twitter = new Codicon('twitter', { fontCharacter: '\\eb72' });
	export const unfold = new Codicon('unfold', { fontCharacter: '\\eb73' });
	export const unlock = new Codicon('unlock', { fontCharacter: '\\eb74' });
	export const unmute = new Codicon('unmute', { fontCharacter: '\\eb75' });
	export const unverified = new Codicon('unverified', { fontCharacter: '\\eb76' });
	export const verified = new Codicon('verified', { fontCharacter: '\\eb77' });
	export const versions = new Codicon('versions', { fontCharacter: '\\eb78' });
	export const vmActive = new Codicon('vm-active', { fontCharacter: '\\eb79' });
	export const vmOutline = new Codicon('vm-outline', { fontCharacter: '\\eb7a' });
	export const vmRunning = new Codicon('vm-running', { fontCharacter: '\\eb7b' });
	export const watch = new Codicon('watch', { fontCharacter: '\\eb7c' });
	export const whitespace = new Codicon('whitespace', { fontCharacter: '\\eb7d' });
	export const wholeWord = new Codicon('whole-word', { fontCharacter: '\\eb7e' });
	export const window = new Codicon('window', { fontCharacter: '\\eb7f' });
	export const wordWrap = new Codicon('word-wrap', { fontCharacter: '\\eb80' });
	export const zoomIn = new Codicon('zoom-in', { fontCharacter: '\\eb81' });
	export const zoomOut = new Codicon('zoom-out', { fontCharacter: '\\eb82' });
	export const listFilter = new Codicon('list-filter', { fontCharacter: '\\eb83' });
	export const listFlat = new Codicon('list-flat', { fontCharacter: '\\eb84' });
	export const listSelection = new Codicon('list-selection', { fontCharacter: '\\eb85' });
	export const selection = new Codicon('selection', { fontCharacter: '\\eb85' });
	export const listTree = new Codicon('list-tree', { fontCharacter: '\\eb86' });
	export const debugBreakpointFunctionUnverified = new Codicon('debug-breakpoint-function-unverified', { fontCharacter: '\\eb87' });
	export const debugBreakpointFunction = new Codicon('debug-breakpoint-function', { fontCharacter: '\\eb88' });
	export const debugBreakpointFunctionDisabled = new Codicon('debug-breakpoint-function-disabled', { fontCharacter: '\\eb88' });
	export const debugStackframeActive = new Codicon('debug-stackframe-active', { fontCharacter: '\\eb89' });
	export const debugStackframeDot = new Codicon('debug-stackframe-dot', { fontCharacter: '\\eb8a' });
	export const debugStackframe = new Codicon('debug-stackframe', { fontCharacter: '\\eb8b' });
	export const debugStackframeFocused = new Codicon('debug-stackframe-focused', { fontCharacter: '\\eb8b' });
	export const debugBreakpointUnsupported = new Codicon('debug-breakpoint-unsupported', { fontCharacter: '\\eb8c' });
	export const symbolString = new Codicon('symbol-string', { fontCharacter: '\\eb8d' });
	export const debugReverseContinue = new Codicon('debug-reverse-continue', { fontCharacter: '\\eb8e' });
	export const debugStepBack = new Codicon('debug-step-back', { fontCharacter: '\\eb8f' });
	export const debugRestartFrame = new Codicon('debug-restart-frame', { fontCharacter: '\\eb90' });
	export const callIncoming = new Codicon('call-incoming', { fontCharacter: '\\eb92' });
	export const callOutgoing = new Codicon('call-outgoing', { fontCharacter: '\\eb93' });
	export const menu = new Codicon('menu', { fontCharacter: '\\eb94' });
	export const expandAll = new Codicon('expand-all', { fontCharacter: '\\eb95' });
	export const feedback = new Codicon('feedback', { fontCharacter: '\\eb96' });
	export const groupByRefType = new Codicon('group-by-ref-type', { fontCharacter: '\\eb97' });
	export const ungroupByRefType = new Codicon('ungroup-by-ref-type', { fontCharacter: '\\eb98' });
	export const account = new Codicon('account', { fontCharacter: '\\eb99' });
	export const bellDot = new Codicon('bell-dot', { fontCharacter: '\\eb9a' });
	export const debugConsole = new Codicon('debug-console', { fontCharacter: '\\eb9b' });
	export const library = new Codicon('library', { fontCharacter: '\\eb9c' });
	export const output = new Codicon('output', { fontCharacter: '\\eb9d' });
	export const runAll = new Codicon('run-all', { fontCharacter: '\\eb9e' });
	export const syncIgnored = new Codicon('sync-ignored', { fontCharacter: '\\eb9f' });
	export const pinned = new Codicon('pinned', { fontCharacter: '\\eba0' });
	export const githubInverted = new Codicon('github-inverted', { fontCharacter: '\\eba1' });
	export const debugAlt = new Codicon('debug-alt', { fontCharacter: '\\eb91' });
	export const serverProcess = new Codicon('server-process', { fontCharacter: '\\eba2' });
	export const serverEnvironment = new Codicon('server-environment', { fontCharacter: '\\eba3' });
	export const pass = new Codicon('pass', { fontCharacter: '\\eba4' });
	export const stopCircle = new Codicon('stop-circle', { fontCharacter: '\\eba5' });
	export const playCircle = new Codicon('play-circle', { fontCharacter: '\\eba6' });
	export const record = new Codicon('record', { fontCharacter: '\\eba7' });
	export const debugAltSmall = new Codicon('debug-alt-small', { fontCharacter: '\\eba8' });
	export const vmConnect = new Codicon('vm-connect', { fontCharacter: '\\eba9' });
	export const cloud = new Codicon('cloud', { fontCharacter: '\\ebaa' });
	export const merge = new Codicon('merge', { fontCharacter: '\\ebab' });
	export const exportIcon = new Codicon('export', { fontCharacter: '\\ebac' });
	export const graphLeft = new Codicon('graph-left', { fontCharacter: '\\ebad' });
	export const magnet = new Codicon('magnet', { fontCharacter: '\\ebae' });
	export const notebook = new Codicon('notebook', { fontCharacter: '\\ebaf' });
	export const redo = new Codicon('redo', { fontCharacter: '\\ebb0' });
	export const checkAll = new Codicon('check-all', { fontCharacter: '\\ebb1' });
	export const pinnedDirty = new Codicon('pinned-dirty', { fontCharacter: '\\ebb2' });
	export const passFilled = new Codicon('pass-filled', { fontCharacter: '\\ebb3' });
	export const circleLargeFilled = new Codicon('circle-large-filled', { fontCharacter: '\\ebb4' });
	export const circleLargeOutline = new Codicon('circle-large-outline', { fontCharacter: '\\ebb5' });
	export const combine = new Codicon('combine', { fontCharacter: '\\ebb6' });
	export const gather = new Codicon('gather', { fontCharacter: '\\ebb6' });
	export const table = new Codicon('table', { fontCharacter: '\\ebb7' });
	export const variableGroup = new Codicon('variable-group', { fontCharacter: '\\ebb8' });
	export const typeHierarchy = new Codicon('type-hierarchy', { fontCharacter: '\\ebb9' });
	export const typeHierarchySub = new Codicon('type-hierarchy-sub', { fontCharacter: '\\ebba' });
	export const typeHierarchySuper = new Codicon('type-hierarchy-super', { fontCharacter: '\\ebbb' });
	export const gitPullRequestCreate = new Codicon('git-pull-request-create', { fontCharacter: '\\ebbc' });
	export const runAbove = new Codicon('run-above', { fontCharacter: '\\ebbd' });
	export const runBelow = new Codicon('run-below', { fontCharacter: '\\ebbe' });
	export const notebookTemplate = new Codicon('notebook-template', { fontCharacter: '\\ebbf' });
	export const debugRerun = new Codicon('debug-rerun', { fontCharacter: '\\ebc0' });
	export const workspaceTrusted = new Codicon('workspace-trusted', { fontCharacter: '\\ebc1' });
	export const workspaceUntrusted = new Codicon('workspace-untrusted', { fontCharacter: '\\ebc2' });
	export const workspaceUnspecified = new Codicon('workspace-unspecified', { fontCharacter: '\\ebc3' });
	export const terminalCmd = new Codicon('terminal-cmd', { fontCharacter: '\\ebc4' });
	export const terminalDebian = new Codicon('terminal-debian', { fontCharacter: '\\ebc5' });
	export const terminalLinux = new Codicon('terminal-linux', { fontCharacter: '\\ebc6' });
	export const terminalPowershell = new Codicon('terminal-powershell', { fontCharacter: '\\ebc7' });
	export const terminalTmux = new Codicon('terminal-tmux', { fontCharacter: '\\ebc8' });
	export const terminalUbuntu = new Codicon('terminal-ubuntu', { fontCharacter: '\\ebc9' });
	export const terminalBash = new Codicon('terminal-bash', { fontCharacter: '\\ebca' });
	export const arrowSwap = new Codicon('arrow-swap', { fontCharacter: '\\ebcb' });
	export const copy = new Codicon('copy', { fontCharacter: '\\ebcc' });
	export const personAdd = new Codicon('person-add', { fontCharacter: '\\ebcd' });
	export const filterFilled = new Codicon('filter-filled', { fontCharacter: '\\ebce' });
	export const wand = new Codicon('wand', { fontCharacter: '\\ebcf' });
	export const debugLineByLine = new Codicon('debug-line-by-line', { fontCharacter: '\\ebd0' });

	export const dropDownButton = new Codicon('drop-down-button', Codicon.chevronDown.definition);
}

