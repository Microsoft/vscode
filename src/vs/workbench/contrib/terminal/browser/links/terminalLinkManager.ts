/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { DisposableStore, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { TerminalWidgetManager } from 'vs/workbench/contrib/terminal/browser/widgets/widgetManager';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITerminalProcessManager, ITerminalConfiguration, TERMINAL_CONFIG_SECTION } from 'vs/workbench/contrib/terminal/common/terminal';
import { ITextEditorSelection } from 'vs/platform/editor/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IFileService } from 'vs/platform/files/common/files';
import type { Terminal, IViewportRange, ILinkProvider } from 'xterm';
import { Schemas } from 'vs/base/common/network';
import { posix, win32 } from 'vs/base/common/path';
import { ITerminalExternalLinkProvider, ITerminalInstance } from 'vs/workbench/contrib/terminal/browser/terminal';
import { OperatingSystem, isMacintosh, OS, isWindows } from 'vs/base/common/platform';
import { IMarkdownString, MarkdownString } from 'vs/base/common/htmlContent';
import { TerminalProtocolLinkProvider } from 'vs/workbench/contrib/terminal/browser/links/terminalProtocolLinkProvider';
import { TerminalValidatedLocalLinkProvider, lineAndColumnClause, unixLocalLinkClause, winLocalLinkClause, winDrivePrefix, winLineAndColumnMatchIndex, unixLineAndColumnMatchIndex, lineAndColumnClauseGroupCount } from 'vs/workbench/contrib/terminal/browser/links/terminalValidatedLocalLinkProvider';
import { TerminalWordLinkProvider } from 'vs/workbench/contrib/terminal/browser/links/terminalWordLinkProvider';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { XTermCore } from 'vs/workbench/contrib/terminal/browser/xterm-private';
import { TerminalHover, ILinkHoverTargetOptions } from 'vs/workbench/contrib/terminal/browser/widgets/terminalHoverWidget';
import { TerminalLink } from 'vs/workbench/contrib/terminal/browser/links/terminalLink';
import { TerminalExternalLinkProviderAdapter } from 'vs/workbench/contrib/terminal/browser/links/terminalExternalLinkProviderAdapter';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';

export type XtermLinkMatcherHandler = (event: MouseEvent | undefined, link: string) => Promise<void>;
export type XtermLinkMatcherValidationCallback = (uri: string, callback: (isValid: boolean) => void) => void;

interface IPath {
	join(...paths: string[]): string;
	normalize(path: string): string;
	sep: '\\' | '/';
}

/**
 * An object responsible for managing registration of link matchers and link providers.
 */
export class TerminalLinkManager extends DisposableStore {
	private _widgetManager: TerminalWidgetManager | undefined;
	private _processCwd: string | undefined;
	private _standardLinkProviders: ILinkProvider[] = [];
	private _standardLinkProvidersDisposables: IDisposable[] = [];

	constructor(
		private _xterm: Terminal,
		private readonly _processManager: ITerminalProcessManager,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IEditorService private readonly _editorService: IEditorService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITunnelService private readonly _tunnelService: ITunnelService
	) {
		super();

		// Protocol links
		const wrappedActivateCallback = this._wrapLinkHandler((_, link) => this._handleProtocolLink(link));
		const protocolProvider = this._instantiationService.createInstance(TerminalProtocolLinkProvider, this._xterm, wrappedActivateCallback, this._tooltipCallback.bind(this));
		this._standardLinkProviders.push(protocolProvider);

		// Validated local links
		if (this._configurationService.getValue<ITerminalConfiguration>(TERMINAL_CONFIG_SECTION).enableFileLinks) {
			const wrappedTextLinkActivateCallback = this._wrapLinkHandler((_, link) => this._handleLocalLink(link));
			const validatedProvider = this._instantiationService.createInstance(TerminalValidatedLocalLinkProvider,
				this._xterm,
				this._processManager.os || OS,
				wrappedTextLinkActivateCallback,
				this._wrapLinkHandler.bind(this),
				this._tooltipCallback.bind(this),
				async (link, cb) => cb(await this._resolvePath(link)));
			this._standardLinkProviders.push(validatedProvider);
		}

		// Word links
		const wordProvider = this._instantiationService.createInstance(TerminalWordLinkProvider, this._xterm, this._wrapLinkHandler.bind(this), this._tooltipCallback.bind(this));
		this._standardLinkProviders.push(wordProvider);

		this._registerStandardLinkProviders();
	}

	private _tooltipCallback(link: TerminalLink, viewportRange: IViewportRange, modifierDownCallback?: () => void, modifierUpCallback?: () => void) {
		if (!this._widgetManager) {
			return;
		}

		const core = (this._xterm as any)._core as XTermCore;
		const cellDimensions = {
			width: core._renderService.dimensions.actualCellWidth,
			height: core._renderService.dimensions.actualCellHeight
		};
		const terminalDimensions = {
			width: this._xterm.cols,
			height: this._xterm.rows
		};

		// Don't pass the mouse event as this avoids the modifier check
		this._showHover({
			viewportRange,
			cellDimensions,
			terminalDimensions,
			modifierDownCallback,
			modifierUpCallback
		}, this._getLinkHoverString(link.text, link.label), (text) => link.activate(undefined, text), link);
	}

	private _showHover(
		targetOptions: ILinkHoverTargetOptions,
		text: IMarkdownString,
		linkHandler: (url: string) => void,
		link?: TerminalLink
	) {
		if (this._widgetManager) {
			const widget = this._instantiationService.createInstance(TerminalHover, targetOptions, text, linkHandler);
			const attached = this._widgetManager.attachWidget(widget);
			if (attached) {
				link?.onInvalidated(() => attached.dispose());
			}
		}
	}

	setWidgetManager(widgetManager: TerminalWidgetManager): void {
		this._widgetManager = widgetManager;
	}

	set processCwd(processCwd: string) {
		this._processCwd = processCwd;
	}

	private _registerStandardLinkProviders(): void {
		dispose(this._standardLinkProvidersDisposables);
		this._standardLinkProvidersDisposables = [];
		for (const p of this._standardLinkProviders) {
			this._standardLinkProvidersDisposables.push(this._xterm.registerLinkProvider(p));
		}
	}

	registerExternalLinkProvider(instance: ITerminalInstance, linkProvider: ITerminalExternalLinkProvider): IDisposable {
		const wrappedLinkProvider = this._instantiationService.createInstance(TerminalExternalLinkProviderAdapter, this._xterm, instance, linkProvider, this._wrapLinkHandler.bind(this), this._tooltipCallback.bind(this));
		const newLinkProvider = this._xterm.registerLinkProvider(wrappedLinkProvider);
		// Re-register the standard link providers so they are a lower priority that the new one
		this._registerStandardLinkProviders();
		return newLinkProvider;
	}

	protected _wrapLinkHandler(handler: (event: MouseEvent | undefined, link: string) => void): XtermLinkMatcherHandler {
		return async (event: MouseEvent | undefined, link: string) => {
			// Prevent default electron link handling so Alt+Click mode works normally
			event?.preventDefault();

			// Require correct modifier on click
			if (event && !this._isLinkActivationModifierDown(event)) {
				return;
			}

			// Just call the handler if there is no before listener
			handler(event, link);
		};
	}

	protected get _localLinkRegex(): RegExp {
		if (!this._processManager) {
			throw new Error('Process manager is required');
		}
		const baseLocalLinkClause = this._processManager.os === OperatingSystem.Windows ? winLocalLinkClause : unixLocalLinkClause;
		// Append line and column number regex
		return new RegExp(`${baseLocalLinkClause}(${lineAndColumnClause})`);
	}

	private async _handleLocalLink(link: string): Promise<void> {
		// TODO: This gets resolved again but doesn't need to as it's already validated
		const resolvedLink = await this._resolvePath(link);
		if (!resolvedLink) {
			return;
		}
		const lineColumnInfo: LineColumnInfo = this.extractLineColumnInfo(link);
		const selection: ITextEditorSelection = {
			startLineNumber: lineColumnInfo.lineNumber,
			startColumn: lineColumnInfo.columnNumber
		};
		await this._editorService.openEditor({ resource: resolvedLink.uri, options: { pinned: true, selection } });
	}

	private _handleHypertextLink(url: string): void {
		this._openerService.open(url, {
			allowTunneling: !!(this._processManager && this._processManager.remoteAuthority),
			allowContributedOpeners: true,
		});
	}

	private async _handleProtocolLink(link: string): Promise<void> {
		// Check if it's a file:/// link, hand off to local link handler so to open an editor and
		// respect line/col attachment
		const uri = URI.parse(link);
		if (uri.scheme === Schemas.file) {
			// Just using fsPath here is unsafe: https://github.com/microsoft/vscode/issues/109076
			const fsPath = uri.fsPath;
			this._handleLocalLink(((this._osPath.sep === posix.sep) && isWindows) ? fsPath.replace(/\\/g, posix.sep) : fsPath);
			return;
		}

		// Open as a web link if it's not a file
		this._handleHypertextLink(link);
	}

	protected _isLinkActivationModifierDown(event: MouseEvent): boolean {
		const editorConf = this._configurationService.getValue<{ multiCursorModifier: 'ctrlCmd' | 'alt' }>('editor');
		if (editorConf.multiCursorModifier === 'ctrlCmd') {
			return !!event.altKey;
		}
		return isMacintosh ? event.metaKey : event.ctrlKey;
	}

	private _getLinkHoverString(uri: string, label: string | undefined): IMarkdownString {
		const editorConf = this._configurationService.getValue<{ multiCursorModifier: 'ctrlCmd' | 'alt' }>('editor');

		let clickLabel = '';
		if (editorConf.multiCursorModifier === 'ctrlCmd') {
			if (isMacintosh) {
				clickLabel = nls.localize('terminalLinkHandler.followLinkAlt.mac', "option + click");
			} else {
				clickLabel = nls.localize('terminalLinkHandler.followLinkAlt', "alt + click");
			}
		} else {
			if (isMacintosh) {
				clickLabel = nls.localize('terminalLinkHandler.followLinkCmd', "cmd + click");
			} else {
				clickLabel = nls.localize('terminalLinkHandler.followLinkCtrl', "ctrl + click");
			}
		}

		let fallbackLabel: string;
		if (this._tunnelService.canTunnel(URI.parse(uri))) {
			fallbackLabel = nls.localize('followForwardedLink', "Follow link using forwarded port");
		} else {
			fallbackLabel = nls.localize('followLink', "Follow link");
		}

		const markdown = new MarkdownString('', true);
		// Escapes markdown in label & uri
		if (label) {
			label = markdown.appendText(label).value;
			markdown.value = '';
		}
		if (uri) {
			uri = markdown.appendText(uri).value;
			markdown.value = '';
		}

		label = label || fallbackLabel;
		// Use the label when uri is '' so the link displays correctly
		uri = uri || label;
		// Although if there is a space in the uri, just replace it completely
		if (/(\s|&nbsp;)/.test(uri)) {
			uri = nls.localize('followLinkUrl', 'Link');
		}

		return markdown.appendMarkdown(`[${label}](${uri}) (${clickLabel})`);
	}

	private get _osPath(): IPath {
		if (!this._processManager) {
			throw new Error('Process manager is required');
		}
		if (this._processManager.os === OperatingSystem.Windows) {
			return win32;
		}
		return posix;
	}

	protected _preprocessPath(link: string): string | null {
		if (!this._processManager) {
			throw new Error('Process manager is required');
		}
		if (link.charAt(0) === '~') {
			// Resolve ~ -> userHome
			if (!this._processManager.userHome) {
				return null;
			}
			link = this._osPath.join(this._processManager.userHome, link.substring(1));
		} else if (link.charAt(0) !== '/' && link.charAt(0) !== '~') {
			// Resolve workspace path . | .. | <relative_path> -> <path>/. | <path>/.. | <path>/<relative_path>
			if (this._processManager.os === OperatingSystem.Windows) {
				if (!link.match('^' + winDrivePrefix) && !link.startsWith('\\\\?\\')) {
					if (!this._processCwd) {
						// Abort if no workspace is open
						return null;
					}
					link = this._osPath.join(this._processCwd, link);
				} else {
					// Remove \\?\ from paths so that they share the same underlying
					// uri and don't open multiple tabs for the same file
					link = link.replace(/^\\\\\?\\/, '');
				}
			} else {
				if (!this._processCwd) {
					// Abort if no workspace is open
					return null;
				}
				link = this._osPath.join(this._processCwd, link);
			}
		}
		link = this._osPath.normalize(link);

		return link;
	}

	private async _resolvePath(link: string): Promise<{ uri: URI, isDirectory: boolean } | undefined> {
		if (!this._processManager) {
			throw new Error('Process manager is required');
		}

		const preprocessedLink = this._preprocessPath(link);
		if (!preprocessedLink) {
			return undefined;
		}

		const linkUrl = this.extractLinkUrl(preprocessedLink);
		if (!linkUrl) {
			return undefined;
		}

		try {
			let uri: URI;
			if (this._processManager.remoteAuthority) {
				uri = URI.from({
					scheme: Schemas.vscodeRemote,
					authority: this._processManager.remoteAuthority,
					path: linkUrl
				});
			} else {
				uri = URI.file(linkUrl);
			}

			try {
				const stat = await this._fileService.resolve(uri);
				return { uri, isDirectory: stat.isDirectory };
			}
			catch (e) {
				// Does not exist
				return undefined;
			}
		} catch {
			// Errors in parsing the path
			return undefined;
		}
	}

	/**
	 * Returns line and column number of URl if that is present.
	 *
	 * @param link Url link which may contain line and column number.
	 */
	extractLineColumnInfo(link: string): LineColumnInfo {
		const matches: string[] | null = this._localLinkRegex.exec(link);
		const lineColumnInfo: LineColumnInfo = {
			lineNumber: 1,
			columnNumber: 1
		};

		if (!matches || !this._processManager) {
			return lineColumnInfo;
		}

		const lineAndColumnMatchIndex = this._processManager.os === OperatingSystem.Windows ? winLineAndColumnMatchIndex : unixLineAndColumnMatchIndex;
		for (let i = 0; i < lineAndColumnClause.length; i++) {
			const lineMatchIndex = lineAndColumnMatchIndex + (lineAndColumnClauseGroupCount * i);
			const rowNumber = matches[lineMatchIndex];
			if (rowNumber) {
				lineColumnInfo['lineNumber'] = parseInt(rowNumber, 10);
				// Check if column number exists
				const columnNumber = matches[lineMatchIndex + 2];
				if (columnNumber) {
					lineColumnInfo['columnNumber'] = parseInt(columnNumber, 10);
				}
				break;
			}
		}

		return lineColumnInfo;
	}

	/**
	 * Returns url from link as link may contain line and column information.
	 *
	 * @param link url link which may contain line and column number.
	 */
	extractLinkUrl(link: string): string | null {
		const matches: string[] | null = this._localLinkRegex.exec(link);
		if (!matches) {
			return null;
		}
		return matches[1];
	}
}

export interface LineColumnInfo {
	lineNumber: number;
	columnNumber: number;
}
