/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { codiconStartMarker } from 'vs/base/common/codicon';
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
		if (!this._icons.has(icon.id)) {
			this._icons.set(icon.id, icon);
			this._onDidRegister.fire(icon);
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

export function registerIcon(id: string, def: Codicon, description?: string) {
	return new Codicon(id, def);
}

export class Codicon {
	constructor(public readonly id: string, public readonly definition: Codicon | IconDefinition, public description?: string) {
		_registry.add(this);
	}
	public get classNames() { return 'codicon codicon-' + this.id; }
	// classNamesArray is useful for migrating to ES6 classlist
	public get classNamesArray() { return ['codicon', 'codicon-' + this.id]; }
	public get cssSelector() { return '.codicon.codicon-' + this.id; }
}

interface IconDefinition {
	character: string;
}

export namespace Codicon {

	// built-in icons, with image name
	export const add = new Codicon('add', { character: '\\ea60' });
	export const plus = new Codicon('plus', { character: '\\ea60' });
	export const gistNew = new Codicon('gist-new', { character: '\\ea60' });
	export const repoCreate = new Codicon('repo-create', { character: '\\ea60' });
	export const lightbulb = new Codicon('lightbulb', { character: '\\ea61' });
	export const lightBulb = new Codicon('light-bulb', { character: '\\ea61' });
	export const repo = new Codicon('repo', { character: '\\ea62' });
	export const repoDelete = new Codicon('repo-delete', { character: '\\ea62' });
	export const gistFork = new Codicon('gist-fork', { character: '\\ea63' });
	export const repoForked = new Codicon('repo-forked', { character: '\\ea63' });
	export const gitPullRequest = new Codicon('git-pull-request', { character: '\\ea64' });
	export const gitPullRequestAbandoned = new Codicon('git-pull-request-abandoned', { character: '\\ea64' });
	export const recordKeys = new Codicon('record-keys', { character: '\\ea65' });
	export const keyboard = new Codicon('keyboard', { character: '\\ea65' });
	export const tag = new Codicon('tag', { character: '\\ea66' });
	export const tagAdd = new Codicon('tag-add', { character: '\\ea66' });
	export const tagRemove = new Codicon('tag-remove', { character: '\\ea66' });
	export const person = new Codicon('person', { character: '\\ea67' });
	export const personAdd = new Codicon('person-add', { character: '\\ea67' });
	export const personFollow = new Codicon('person-follow', { character: '\\ea67' });
	export const personOutline = new Codicon('person-outline', { character: '\\ea67' });
	export const personFilled = new Codicon('person-filled', { character: '\\ea67' });
	export const gitBranch = new Codicon('git-branch', { character: '\\ea68' });
	export const gitBranchCreate = new Codicon('git-branch-create', { character: '\\ea68' });
	export const gitBranchDelete = new Codicon('git-branch-delete', { character: '\\ea68' });
	export const sourceControl = new Codicon('source-control', { character: '\\ea68' });
	export const mirror = new Codicon('mirror', { character: '\\ea69' });
	export const mirrorPublic = new Codicon('mirror-public', { character: '\\ea69' });
	export const star = new Codicon('star', { character: '\\ea6a' });
	export const starAdd = new Codicon('star-add', { character: '\\ea6a' });
	export const starDelete = new Codicon('star-delete', { character: '\\ea6a' });
	export const starEmpty = new Codicon('star-empty', { character: '\\ea6a' });
	export const comment = new Codicon('comment', { character: '\\ea6b' });
	export const commentAdd = new Codicon('comment-add', { character: '\\ea6b' });
	export const alert = new Codicon('alert', { character: '\\ea6c' });
	export const warning = new Codicon('warning', { character: '\\ea6c' });
	export const search = new Codicon('search', { character: '\\ea6d' });
	export const searchSave = new Codicon('search-save', { character: '\\ea6d' });
	export const logOut = new Codicon('log-out', { character: '\\ea6e' });
	export const signOut = new Codicon('sign-out', { character: '\\ea6e' });
	export const logIn = new Codicon('log-in', { character: '\\ea6f' });
	export const signIn = new Codicon('sign-in', { character: '\\ea6f' });
	export const eye = new Codicon('eye', { character: '\\ea70' });
	export const eyeUnwatch = new Codicon('eye-unwatch', { character: '\\ea70' });
	export const eyeWatch = new Codicon('eye-watch', { character: '\\ea70' });
	export const circleFilled = new Codicon('circle-filled', { character: '\\ea71' });
	export const primitiveDot = new Codicon('primitive-dot', { character: '\\ea71' });
	export const closeDirty = new Codicon('close-dirty', { character: '\\ea71' });
	export const debugBreakpoint = new Codicon('debug-breakpoint', { character: '\\ea71' });
	export const debugBreakpointDisabled = new Codicon('debug-breakpoint-disabled', { character: '\\ea71' });
	export const debugHint = new Codicon('debug-hint', { character: '\\ea71' });
	export const primitiveSquare = new Codicon('primitive-square', { character: '\\ea72' });
	export const edit = new Codicon('edit', { character: '\\ea73' });
	export const pencil = new Codicon('pencil', { character: '\\ea73' });
	export const info = new Codicon('info', { character: '\\ea74' });
	export const issueOpened = new Codicon('issue-opened', { character: '\\ea74' });
	export const gistPrivate = new Codicon('gist-private', { character: '\\ea75' });
	export const gitForkPrivate = new Codicon('git-fork-private', { character: '\\ea75' });
	export const lock = new Codicon('lock', { character: '\\ea75' });
	export const mirrorPrivate = new Codicon('mirror-private', { character: '\\ea75' });
	export const close = new Codicon('close', { character: '\\ea76' });
	export const removeClose = new Codicon('remove-close', { character: '\\ea76' });
	export const x = new Codicon('x', { character: '\\ea76' });
	export const repoSync = new Codicon('repo-sync', { character: '\\ea77' });
	export const sync = new Codicon('sync', { character: '\\ea77' });
	export const clone = new Codicon('clone', { character: '\\ea78' });
	export const desktopDownload = new Codicon('desktop-download', { character: '\\ea78' });
	export const beaker = new Codicon('beaker', { character: '\\ea79' });
	export const microscope = new Codicon('microscope', { character: '\\ea79' });
	export const vm = new Codicon('vm', { character: '\\ea7a' });
	export const deviceDesktop = new Codicon('device-desktop', { character: '\\ea7a' });
	export const file = new Codicon('file', { character: '\\ea7b' });
	export const fileText = new Codicon('file-text', { character: '\\ea7b' });
	export const more = new Codicon('more', { character: '\\ea7c' });
	export const ellipsis = new Codicon('ellipsis', { character: '\\ea7c' });
	export const kebabHorizontal = new Codicon('kebab-horizontal', { character: '\\ea7c' });
	export const mailReply = new Codicon('mail-reply', { character: '\\ea7d' });
	export const reply = new Codicon('reply', { character: '\\ea7d' });
	export const organization = new Codicon('organization', { character: '\\ea7e' });
	export const organizationFilled = new Codicon('organization-filled', { character: '\\ea7e' });
	export const organizationOutline = new Codicon('organization-outline', { character: '\\ea7e' });
	export const newFile = new Codicon('new-file', { character: '\\ea7f' });
	export const fileAdd = new Codicon('file-add', { character: '\\ea7f' });
	export const newFolder = new Codicon('new-folder', { character: '\\ea80' });
	export const fileDirectoryCreate = new Codicon('file-directory-create', { character: '\\ea80' });
	export const trash = new Codicon('trash', { character: '\\ea81' });
	export const trashcan = new Codicon('trashcan', { character: '\\ea81' });
	export const history = new Codicon('history', { character: '\\ea82' });
	export const clock = new Codicon('clock', { character: '\\ea82' });
	export const folder = new Codicon('folder', { character: '\\ea83' });
	export const fileDirectory = new Codicon('file-directory', { character: '\\ea83' });
	export const symbolFolder = new Codicon('symbol-folder', { character: '\\ea83' });
	export const logoGithub = new Codicon('logo-github', { character: '\\ea84' });
	export const markGithub = new Codicon('mark-github', { character: '\\ea84' });
	export const github = new Codicon('github', { character: '\\ea84' });
	export const terminal = new Codicon('terminal', { character: '\\ea85' });
	export const console = new Codicon('console', { character: '\\ea85' });
	export const repl = new Codicon('repl', { character: '\\ea85' });
	export const zap = new Codicon('zap', { character: '\\ea86' });
	export const symbolEvent = new Codicon('symbol-event', { character: '\\ea86' });
	export const error = new Codicon('error', { character: '\\ea87' });
	export const stop = new Codicon('stop', { character: '\\ea87' });
	export const variable = new Codicon('variable', { character: '\\ea88' });
	export const symbolVariable = new Codicon('symbol-variable', { character: '\\ea88' });
	export const array = new Codicon('array', { character: '\\ea8a' });
	export const symbolArray = new Codicon('symbol-array', { character: '\\ea8a' });
	export const symbolModule = new Codicon('symbol-module', { character: '\\ea8b' });
	export const symbolPackage = new Codicon('symbol-package', { character: '\\ea8b' });
	export const symbolNamespace = new Codicon('symbol-namespace', { character: '\\ea8b' });
	export const symbolObject = new Codicon('symbol-object', { character: '\\ea8b' });
	export const symbolMethod = new Codicon('symbol-method', { character: '\\ea8c' });
	export const symbolFunction = new Codicon('symbol-function', { character: '\\ea8c' });
	export const symbolConstructor = new Codicon('symbol-constructor', { character: '\\ea8c' });
	export const symbolBoolean = new Codicon('symbol-boolean', { character: '\\ea8f' });
	export const symbolNull = new Codicon('symbol-null', { character: '\\ea8f' });
	export const symbolNumeric = new Codicon('symbol-numeric', { character: '\\ea90' });
	export const symbolNumber = new Codicon('symbol-number', { character: '\\ea90' });
	export const symbolStructure = new Codicon('symbol-structure', { character: '\\ea91' });
	export const symbolStruct = new Codicon('symbol-struct', { character: '\\ea91' });
	export const symbolParameter = new Codicon('symbol-parameter', { character: '\\ea92' });
	export const symbolTypeParameter = new Codicon('symbol-type-parameter', { character: '\\ea92' });
	export const symbolKey = new Codicon('symbol-key', { character: '\\ea93' });
	export const symbolText = new Codicon('symbol-text', { character: '\\ea93' });
	export const symbolReference = new Codicon('symbol-reference', { character: '\\ea94' });
	export const goToFile = new Codicon('go-to-file', { character: '\\ea94' });
	export const symbolEnum = new Codicon('symbol-enum', { character: '\\ea95' });
	export const symbolValue = new Codicon('symbol-value', { character: '\\ea95' });
	export const symbolRuler = new Codicon('symbol-ruler', { character: '\\ea96' });
	export const symbolUnit = new Codicon('symbol-unit', { character: '\\ea96' });
	export const activateBreakpoints = new Codicon('activate-breakpoints', { character: '\\ea97' });
	export const archive = new Codicon('archive', { character: '\\ea98' });
	export const arrowBoth = new Codicon('arrow-both', { character: '\\ea99' });
	export const arrowDown = new Codicon('arrow-down', { character: '\\ea9a' });
	export const arrowLeft = new Codicon('arrow-left', { character: '\\ea9b' });
	export const arrowRight = new Codicon('arrow-right', { character: '\\ea9c' });
	export const arrowSmallDown = new Codicon('arrow-small-down', { character: '\\ea9d' });
	export const arrowSmallLeft = new Codicon('arrow-small-left', { character: '\\ea9e' });
	export const arrowSmallRight = new Codicon('arrow-small-right', { character: '\\ea9f' });
	export const arrowSmallUp = new Codicon('arrow-small-up', { character: '\\eaa0' });
	export const arrowUp = new Codicon('arrow-up', { character: '\\eaa1' });
	export const bell = new Codicon('bell', { character: '\\eaa2' });
	export const bold = new Codicon('bold', { character: '\\eaa3' });
	export const book = new Codicon('book', { character: '\\eaa4' });
	export const bookmark = new Codicon('bookmark', { character: '\\eaa5' });
	export const debugBreakpointConditionalUnverified = new Codicon('debug-breakpoint-conditional-unverified', { character: '\\eaa6' });
	export const debugBreakpointConditional = new Codicon('debug-breakpoint-conditional', { character: '\\eaa7' });
	export const debugBreakpointConditionalDisabled = new Codicon('debug-breakpoint-conditional-disabled', { character: '\\eaa7' });
	export const debugBreakpointDataUnverified = new Codicon('debug-breakpoint-data-unverified', { character: '\\eaa8' });
	export const debugBreakpointData = new Codicon('debug-breakpoint-data', { character: '\\eaa9' });
	export const debugBreakpointDataDisabled = new Codicon('debug-breakpoint-data-disabled', { character: '\\eaa9' });
	export const debugBreakpointLogUnverified = new Codicon('debug-breakpoint-log-unverified', { character: '\\eaaa' });
	export const debugBreakpointLog = new Codicon('debug-breakpoint-log', { character: '\\eaab' });
	export const debugBreakpointLogDisabled = new Codicon('debug-breakpoint-log-disabled', { character: '\\eaab' });
	export const briefcase = new Codicon('briefcase', { character: '\\eaac' });
	export const broadcast = new Codicon('broadcast', { character: '\\eaad' });
	export const browser = new Codicon('browser', { character: '\\eaae' });
	export const bug = new Codicon('bug', { character: '\\eaaf' });
	export const calendar = new Codicon('calendar', { character: '\\eab0' });
	export const caseSensitive = new Codicon('case-sensitive', { character: '\\eab1' });
	export const check = new Codicon('check', { character: '\\eab2' });
	export const checklist = new Codicon('checklist', { character: '\\eab3' });
	export const chevronDown = new Codicon('chevron-down', { character: '\\eab4' });
	export const chevronLeft = new Codicon('chevron-left', { character: '\\eab5' });
	export const chevronRight = new Codicon('chevron-right', { character: '\\eab6' });
	export const chevronUp = new Codicon('chevron-up', { character: '\\eab7' });
	export const chromeClose = new Codicon('chrome-close', { character: '\\eab8' });
	export const chromeMaximize = new Codicon('chrome-maximize', { character: '\\eab9' });
	export const chromeMinimize = new Codicon('chrome-minimize', { character: '\\eaba' });
	export const chromeRestore = new Codicon('chrome-restore', { character: '\\eabb' });
	export const circleOutline = new Codicon('circle-outline', { character: '\\eabc' });
	export const debugBreakpointUnverified = new Codicon('debug-breakpoint-unverified', { character: '\\eabc' });
	export const circleSlash = new Codicon('circle-slash', { character: '\\eabd' });
	export const circuitBoard = new Codicon('circuit-board', { character: '\\eabe' });
	export const clearAll = new Codicon('clear-all', { character: '\\eabf' });
	export const clippy = new Codicon('clippy', { character: '\\eac0' });
	export const closeAll = new Codicon('close-all', { character: '\\eac1' });
	export const cloudDownload = new Codicon('cloud-download', { character: '\\eac2' });
	export const cloudUpload = new Codicon('cloud-upload', { character: '\\eac3' });
	export const code = new Codicon('code', { character: '\\eac4' });
	export const collapseAll = new Codicon('collapse-all', { character: '\\eac5' });
	export const colorMode = new Codicon('color-mode', { character: '\\eac6' });
	export const commentDiscussion = new Codicon('comment-discussion', { character: '\\eac7' });
	export const compareChanges = new Codicon('compare-changes', { character: '\\eafd' });
	export const creditCard = new Codicon('credit-card', { character: '\\eac9' });
	export const dash = new Codicon('dash', { character: '\\eacc' });
	export const dashboard = new Codicon('dashboard', { character: '\\eacd' });
	export const database = new Codicon('database', { character: '\\eace' });
	export const debugContinue = new Codicon('debug-continue', { character: '\\eacf' });
	export const debugDisconnect = new Codicon('debug-disconnect', { character: '\\ead0' });
	export const debugPause = new Codicon('debug-pause', { character: '\\ead1' });
	export const debugRestart = new Codicon('debug-restart', { character: '\\ead2' });
	export const debugStart = new Codicon('debug-start', { character: '\\ead3' });
	export const debugStepInto = new Codicon('debug-step-into', { character: '\\ead4' });
	export const debugStepOut = new Codicon('debug-step-out', { character: '\\ead5' });
	export const debugStepOver = new Codicon('debug-step-over', { character: '\\ead6' });
	export const debugStop = new Codicon('debug-stop', { character: '\\ead7' });
	export const debug = new Codicon('debug', { character: '\\ead8' });
	export const deviceCameraVideo = new Codicon('device-camera-video', { character: '\\ead9' });
	export const deviceCamera = new Codicon('device-camera', { character: '\\eada' });
	export const deviceMobile = new Codicon('device-mobile', { character: '\\eadb' });
	export const diffAdded = new Codicon('diff-added', { character: '\\eadc' });
	export const diffIgnored = new Codicon('diff-ignored', { character: '\\eadd' });
	export const diffModified = new Codicon('diff-modified', { character: '\\eade' });
	export const diffRemoved = new Codicon('diff-removed', { character: '\\eadf' });
	export const diffRenamed = new Codicon('diff-renamed', { character: '\\eae0' });
	export const diff = new Codicon('diff', { character: '\\eae1' });
	export const discard = new Codicon('discard', { character: '\\eae2' });
	export const editorLayout = new Codicon('editor-layout', { character: '\\eae3' });
	export const emptyWindow = new Codicon('empty-window', { character: '\\eae4' });
	export const exclude = new Codicon('exclude', { character: '\\eae5' });
	export const extensions = new Codicon('extensions', { character: '\\eae6' });
	export const eyeClosed = new Codicon('eye-closed', { character: '\\eae7' });
	export const fileBinary = new Codicon('file-binary', { character: '\\eae8' });
	export const fileCode = new Codicon('file-code', { character: '\\eae9' });
	export const fileMedia = new Codicon('file-media', { character: '\\eaea' });
	export const filePdf = new Codicon('file-pdf', { character: '\\eaeb' });
	export const fileSubmodule = new Codicon('file-submodule', { character: '\\eaec' });
	export const fileSymlinkDirectory = new Codicon('file-symlink-directory', { character: '\\eaed' });
	export const fileSymlinkFile = new Codicon('file-symlink-file', { character: '\\eaee' });
	export const fileZip = new Codicon('file-zip', { character: '\\eaef' });
	export const files = new Codicon('files', { character: '\\eaf0' });
	export const filter = new Codicon('filter', { character: '\\eaf1' });
	export const flame = new Codicon('flame', { character: '\\eaf2' });
	export const foldDown = new Codicon('fold-down', { character: '\\eaf3' });
	export const foldUp = new Codicon('fold-up', { character: '\\eaf4' });
	export const fold = new Codicon('fold', { character: '\\eaf5' });
	export const folderActive = new Codicon('folder-active', { character: '\\eaf6' });
	export const folderOpened = new Codicon('folder-opened', { character: '\\eaf7' });
	export const gear = new Codicon('gear', { character: '\\eaf8' });
	export const gift = new Codicon('gift', { character: '\\eaf9' });
	export const gistSecret = new Codicon('gist-secret', { character: '\\eafa' });
	export const gist = new Codicon('gist', { character: '\\eafb' });
	export const gitCommit = new Codicon('git-commit', { character: '\\eafc' });
	export const gitCompare = new Codicon('git-compare', { character: '\\eafd' });
	export const gitMerge = new Codicon('git-merge', { character: '\\eafe' });
	export const githubAction = new Codicon('github-action', { character: '\\eaff' });
	export const githubAlt = new Codicon('github-alt', { character: '\\eb00' });
	export const globe = new Codicon('globe', { character: '\\eb01' });
	export const grabber = new Codicon('grabber', { character: '\\eb02' });
	export const graph = new Codicon('graph', { character: '\\eb03' });
	export const gripper = new Codicon('gripper', { character: '\\eb04' });
	export const heart = new Codicon('heart', { character: '\\eb05' });
	export const home = new Codicon('home', { character: '\\eb06' });
	export const horizontalRule = new Codicon('horizontal-rule', { character: '\\eb07' });
	export const hubot = new Codicon('hubot', { character: '\\eb08' });
	export const inbox = new Codicon('inbox', { character: '\\eb09' });
	export const issueClosed = new Codicon('issue-closed', { character: '\\eb0a' });
	export const issueReopened = new Codicon('issue-reopened', { character: '\\eb0b' });
	export const issues = new Codicon('issues', { character: '\\eb0c' });
	export const italic = new Codicon('italic', { character: '\\eb0d' });
	export const jersey = new Codicon('jersey', { character: '\\eb0e' });
	export const json = new Codicon('json', { character: '\\eb0f' });
	export const kebabVertical = new Codicon('kebab-vertical', { character: '\\eb10' });
	export const key = new Codicon('key', { character: '\\eb11' });
	export const law = new Codicon('law', { character: '\\eb12' });
	export const lightbulbAutofix = new Codicon('lightbulb-autofix', { character: '\\eb13' });
	export const linkExternal = new Codicon('link-external', { character: '\\eb14' });
	export const link = new Codicon('link', { character: '\\eb15' });
	export const listOrdered = new Codicon('list-ordered', { character: '\\eb16' });
	export const listUnordered = new Codicon('list-unordered', { character: '\\eb17' });
	export const liveShare = new Codicon('live-share', { character: '\\eb18' });
	export const loading = new Codicon('loading', { character: '\\eb19' });
	export const location = new Codicon('location', { character: '\\eb1a' });
	export const mailRead = new Codicon('mail-read', { character: '\\eb1b' });
	export const mail = new Codicon('mail', { character: '\\eb1c' });
	export const markdown = new Codicon('markdown', { character: '\\eb1d' });
	export const megaphone = new Codicon('megaphone', { character: '\\eb1e' });
	export const mention = new Codicon('mention', { character: '\\eb1f' });
	export const milestone = new Codicon('milestone', { character: '\\eb20' });
	export const mortarBoard = new Codicon('mortar-board', { character: '\\eb21' });
	export const move = new Codicon('move', { character: '\\eb22' });
	export const multipleWindows = new Codicon('multiple-windows', { character: '\\eb23' });
	export const mute = new Codicon('mute', { character: '\\eb24' });
	export const noNewline = new Codicon('no-newline', { character: '\\eb25' });
	export const note = new Codicon('note', { character: '\\eb26' });
	export const octoface = new Codicon('octoface', { character: '\\eb27' });
	export const openPreview = new Codicon('open-preview', { character: '\\eb28' });
	export const package_ = new Codicon('package', { character: '\\eb29' });
	export const paintcan = new Codicon('paintcan', { character: '\\eb2a' });
	export const pin = new Codicon('pin', { character: '\\eb2b' });
	export const play = new Codicon('play', { character: '\\eb2c' });
	export const run = new Codicon('run', { character: '\\eb2c' });
	export const plug = new Codicon('plug', { character: '\\eb2d' });
	export const preserveCase = new Codicon('preserve-case', { character: '\\eb2e' });
	export const preview = new Codicon('preview', { character: '\\eb2f' });
	export const project = new Codicon('project', { character: '\\eb30' });
	export const pulse = new Codicon('pulse', { character: '\\eb31' });
	export const question = new Codicon('question', { character: '\\eb32' });
	export const quote = new Codicon('quote', { character: '\\eb33' });
	export const radioTower = new Codicon('radio-tower', { character: '\\eb34' });
	export const reactions = new Codicon('reactions', { character: '\\eb35' });
	export const references = new Codicon('references', { character: '\\eb36' });
	export const refresh = new Codicon('refresh', { character: '\\eb37' });
	export const regex = new Codicon('regex', { character: '\\eb38' });
	export const remoteExplorer = new Codicon('remote-explorer', { character: '\\eb39' });
	export const remote = new Codicon('remote', { character: '\\eb3a' });
	export const remove = new Codicon('remove', { character: '\\eb3b' });
	export const replaceAll = new Codicon('replace-all', { character: '\\eb3c' });
	export const replace = new Codicon('replace', { character: '\\eb3d' });
	export const repoClone = new Codicon('repo-clone', { character: '\\eb3e' });
	export const repoForcePush = new Codicon('repo-force-push', { character: '\\eb3f' });
	export const repoPull = new Codicon('repo-pull', { character: '\\eb40' });
	export const repoPush = new Codicon('repo-push', { character: '\\eb41' });
	export const report = new Codicon('report', { character: '\\eb42' });
	export const requestChanges = new Codicon('request-changes', { character: '\\eb43' });
	export const rocket = new Codicon('rocket', { character: '\\eb44' });
	export const rootFolderOpened = new Codicon('root-folder-opened', { character: '\\eb45' });
	export const rootFolder = new Codicon('root-folder', { character: '\\eb46' });
	export const rss = new Codicon('rss', { character: '\\eb47' });
	export const ruby = new Codicon('ruby', { character: '\\eb48' });
	export const saveAll = new Codicon('save-all', { character: '\\eb49' });
	export const saveAs = new Codicon('save-as', { character: '\\eb4a' });
	export const save = new Codicon('save', { character: '\\eb4b' });
	export const screenFull = new Codicon('screen-full', { character: '\\eb4c' });
	export const screenNormal = new Codicon('screen-normal', { character: '\\eb4d' });
	export const searchStop = new Codicon('search-stop', { character: '\\eb4e' });
	export const server = new Codicon('server', { character: '\\eb50' });
	export const settingsGear = new Codicon('settings-gear', { character: '\\eb51' });
	export const settings = new Codicon('settings', { character: '\\eb52' });
	export const shield = new Codicon('shield', { character: '\\eb53' });
	export const smiley = new Codicon('smiley', { character: '\\eb54' });
	export const sortPrecedence = new Codicon('sort-precedence', { character: '\\eb55' });
	export const splitHorizontal = new Codicon('split-horizontal', { character: '\\eb56' });
	export const splitVertical = new Codicon('split-vertical', { character: '\\eb57' });
	export const squirrel = new Codicon('squirrel', { character: '\\eb58' });
	export const starFull = new Codicon('star-full', { character: '\\eb59' });
	export const starHalf = new Codicon('star-half', { character: '\\eb5a' });
	export const symbolClass = new Codicon('symbol-class', { character: '\\eb5b' });
	export const symbolColor = new Codicon('symbol-color', { character: '\\eb5c' });
	export const symbolConstant = new Codicon('symbol-constant', { character: '\\eb5d' });
	export const symbolEnumMember = new Codicon('symbol-enum-member', { character: '\\eb5e' });
	export const symbolField = new Codicon('symbol-field', { character: '\\eb5f' });
	export const symbolFile = new Codicon('symbol-file', { character: '\\eb60' });
	export const symbolInterface = new Codicon('symbol-interface', { character: '\\eb61' });
	export const symbolKeyword = new Codicon('symbol-keyword', { character: '\\eb62' });
	export const symbolMisc = new Codicon('symbol-misc', { character: '\\eb63' });
	export const symbolOperator = new Codicon('symbol-operator', { character: '\\eb64' });
	export const symbolProperty = new Codicon('symbol-property', { character: '\\eb65' });
	export const wrench = new Codicon('wrench', { character: '\\eb65' });
	export const wrenchSubaction = new Codicon('wrench-subaction', { character: '\\eb65' });
	export const symbolSnippet = new Codicon('symbol-snippet', { character: '\\eb66' });
	export const tasklist = new Codicon('tasklist', { character: '\\eb67' });
	export const telescope = new Codicon('telescope', { character: '\\eb68' });
	export const textSize = new Codicon('text-size', { character: '\\eb69' });
	export const threeBars = new Codicon('three-bars', { character: '\\eb6a' });
	export const thumbsdown = new Codicon('thumbsdown', { character: '\\eb6b' });
	export const thumbsup = new Codicon('thumbsup', { character: '\\eb6c' });
	export const tools = new Codicon('tools', { character: '\\eb6d' });
	export const triangleDown = new Codicon('triangle-down', { character: '\\eb6e' });
	export const triangleLeft = new Codicon('triangle-left', { character: '\\eb6f' });
	export const triangleRight = new Codicon('triangle-right', { character: '\\eb70' });
	export const triangleUp = new Codicon('triangle-up', { character: '\\eb71' });
	export const twitter = new Codicon('twitter', { character: '\\eb72' });
	export const unfold = new Codicon('unfold', { character: '\\eb73' });
	export const unlock = new Codicon('unlock', { character: '\\eb74' });
	export const unmute = new Codicon('unmute', { character: '\\eb75' });
	export const unverified = new Codicon('unverified', { character: '\\eb76' });
	export const verified = new Codicon('verified', { character: '\\eb77' });
	export const versions = new Codicon('versions', { character: '\\eb78' });
	export const vmActive = new Codicon('vm-active', { character: '\\eb79' });
	export const vmOutline = new Codicon('vm-outline', { character: '\\eb7a' });
	export const vmRunning = new Codicon('vm-running', { character: '\\eb7b' });
	export const watch = new Codicon('watch', { character: '\\eb7c' });
	export const whitespace = new Codicon('whitespace', { character: '\\eb7d' });
	export const wholeWord = new Codicon('whole-word', { character: '\\eb7e' });
	export const window = new Codicon('window', { character: '\\eb7f' });
	export const wordWrap = new Codicon('word-wrap', { character: '\\eb80' });
	export const zoomIn = new Codicon('zoom-in', { character: '\\eb81' });
	export const zoomOut = new Codicon('zoom-out', { character: '\\eb82' });
	export const listFilter = new Codicon('list-filter', { character: '\\eb83' });
	export const listFlat = new Codicon('list-flat', { character: '\\eb84' });
	export const listSelection = new Codicon('list-selection', { character: '\\eb85' });
	export const selection = new Codicon('selection', { character: '\\eb85' });
	export const listTree = new Codicon('list-tree', { character: '\\eb86' });
	export const debugBreakpointFunctionUnverified = new Codicon('debug-breakpoint-function-unverified', { character: '\\eb87' });
	export const debugBreakpointFunction = new Codicon('debug-breakpoint-function', { character: '\\eb88' });
	export const debugBreakpointFunctionDisabled = new Codicon('debug-breakpoint-function-disabled', { character: '\\eb88' });
	export const debugStackframeActive = new Codicon('debug-stackframe-active', { character: '\\eb89' });
	export const debugStackframeDot = new Codicon('debug-stackframe-dot', { character: '\\eb8a' });
	export const debugStackframe = new Codicon('debug-stackframe', { character: '\\eb8b' });
	export const debugStackframeFocused = new Codicon('debug-stackframe-focused', { character: '\\eb8b' });
	export const debugBreakpointUnsupported = new Codicon('debug-breakpoint-unsupported', { character: '\\eb8c' });
	export const symbolString = new Codicon('symbol-string', { character: '\\eb8d' });
	export const debugReverseContinue = new Codicon('debug-reverse-continue', { character: '\\eb8e' });
	export const debugStepBack = new Codicon('debug-step-back', { character: '\\eb8f' });
	export const debugRestartFrame = new Codicon('debug-restart-frame', { character: '\\eb90' });
	export const callIncoming = new Codicon('call-incoming', { character: '\\eb92' });
	export const callOutgoing = new Codicon('call-outgoing', { character: '\\eb93' });
	export const menu = new Codicon('menu', { character: '\\eb94' });
	export const expandAll = new Codicon('expand-all', { character: '\\eb95' });
	export const feedback = new Codicon('feedback', { character: '\\eb96' });
	export const groupByRefType = new Codicon('group-by-ref-type', { character: '\\eb97' });
	export const ungroupByRefType = new Codicon('ungroup-by-ref-type', { character: '\\eb98' });
	export const account = new Codicon('account', { character: '\\eb99' });
	export const bellDot = new Codicon('bell-dot', { character: '\\eb9a' });
	export const debugConsole = new Codicon('debug-console', { character: '\\eb9b' });
	export const library = new Codicon('library', { character: '\\eb9c' });
	export const output = new Codicon('output', { character: '\\eb9d' });
	export const runAll = new Codicon('run-all', { character: '\\eb9e' });
	export const syncIgnored = new Codicon('sync-ignored', { character: '\\eb9f' });
	export const pinned = new Codicon('pinned', { character: '\\eba0' });
	export const githubInverted = new Codicon('github-inverted', { character: '\\eba1' });
	export const debugAlt = new Codicon('debug-alt', { character: '\\eb91' });
	export const serverProcess = new Codicon('server-process', { character: '\\eba2' });
	export const serverEnvironment = new Codicon('server-environment', { character: '\\eba3' });
	export const pass = new Codicon('pass', { character: '\\eba4' });
	export const stopCircle = new Codicon('stop-circle', { character: '\\eba5' });
	export const playCircle = new Codicon('play-circle', { character: '\\eba6' });
	export const record = new Codicon('record', { character: '\\eba7' });
	export const debugAltSmall = new Codicon('debug-alt-small', { character: '\\eba8' });
	export const vmConnect = new Codicon('vm-connect', { character: '\\eba9' });
	export const cloud = new Codicon('cloud', { character: '\\ebaa' });
	export const merge = new Codicon('merge', { character: '\\ebab' });
}




const escapeCodiconsRegex = /(\\)?\$\([a-z0-9\-]+?(?:~[a-z0-9\-]*?)?\)/gi;
export function escapeCodicons(text: string): string {
	return text.replace(escapeCodiconsRegex, (match, escaped) => escaped ? match : `\\${match}`);
}

const markdownEscapedCodiconsRegex = /\\\$\([a-z0-9\-]+?(?:~[a-z0-9\-]*?)?\)/gi;
export function markdownEscapeEscapedCodicons(text: string): string {
	// Need to add an extra \ for escaping in markdown
	return text.replace(markdownEscapedCodiconsRegex, match => `\\${match}`);
}

const markdownUnescapeCodiconsRegex = /(\\)?\$\\\(([a-z0-9\-]+?(?:~[a-z0-9\-]*?)?)\\\)/gi;
export function markdownUnescapeCodicons(text: string): string {
	return text.replace(markdownUnescapeCodiconsRegex, (match, escaped, codicon) => escaped ? match : `$(${codicon})`);
}

const renderCodiconsRegex = /(\\)?\$\((([a-z0-9\-]+?)(?:~([a-z0-9\-]*?))?)\)/gi;
export function renderCodicons(text: string): string {
	return text.replace(renderCodiconsRegex, (_, escaped, codicon, name, animation) => {
		// If the class for codicons is changed, it should also be updated in src\vs\base\browser\markdownRenderer.ts
		return escaped
			? `$(${codicon})`
			: `<span class="codicon codicon-${name}${animation ? ` codicon-animation-${animation}` : ''}"></span>`;
	});
}

const stripCodiconsRegex = /(\s)?(\\)?\$\([a-z0-9\-]+?(?:~[a-z0-9\-]*?)?\)(\s)?/gi;
export function stripCodicons(text: string): string {
	if (text.indexOf(codiconStartMarker) === -1) {
		return text;
	}

	return text.replace(stripCodiconsRegex, (match, preWhitespace, escaped, postWhitespace) => escaped ? match : preWhitespace || postWhitespace || '');
}
