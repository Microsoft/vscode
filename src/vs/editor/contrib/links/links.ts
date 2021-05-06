/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./links';
import * as nls from 'vs/nls';
import * as async from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedError } from 'vs/base/common/errors';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { DisposableStore } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import { ICodeEditor, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { Position } from 'vs/editor/common/core/position';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { IModelDecorationsChangeAccessor, IModelDeltaDecoration, TrackedRangeStickiness } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { LinkProviderRegistry } from 'vs/editor/common/modes';
import { ClickLinkGesture, ClickLinkKeyboardEvent, ClickLinkMouseEvent } from 'vs/editor/contrib/gotoSymbol/link/clickLinkGesture';
import { Link, getLinks, LinksList } from 'vs/editor/contrib/links/getLinks';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { editorActiveLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import * as resources from 'vs/base/common/resources';

function getHoverMessage(link: Link, useMetaKey: boolean): MarkdownString {
	const executeCmd = link.url && /^command:/i.test(link.url.toString());

	const label = link.tooltip
		? link.tooltip
		: executeCmd
			? nls.localize('links.navigate.executeCmd', 'Execute command')
			: nls.localize('links.navigate.follow', 'Follow link');

	const kb = useMetaKey
		? platform.isMacintosh
			? nls.localize('links.navigate.kb.meta.mac', "cmd + click")
			: nls.localize('links.navigate.kb.meta', "ctrl + click")
		: platform.isMacintosh
			? nls.localize('links.navigate.kb.alt.mac', "option + click")
			: nls.localize('links.navigate.kb.alt', "alt + click");

	if (link.url) {
		let nativeLabel = '';
		if (/^command:/i.test(link.url.toString())) {
			// Don't show complete command arguments in the native tooltip
			const match = link.url.toString().match(/^command:([^?#]+)/);
			if (match) {
				const commandId = match[1];
				const nativeLabelText = nls.localize('tooltip.explanation', "Execute command {0}", commandId);
				nativeLabel = ` "${nativeLabelText}"`;
			}
		}
		const hoverMessage = new MarkdownString('', true).appendMarkdown(`[${label}](${link.url.toString(true)}${nativeLabel}) (${kb})`);
		return hoverMessage;
	} else {
		return new MarkdownString().appendText(`${label} (${kb})`);
	}
}

const decoration = {
	general: ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		collapseOnReplaceEdit: true,
		inlineClassName: 'detected-link'
	}),
	active: ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		collapseOnReplaceEdit: true,
		inlineClassName: 'detected-link-active'
	})
};


class LinkOccurrence {

	public static decoration(link: Link, useMetaKey: boolean): IModelDeltaDecoration {
		return {
			range: link.range,
			options: LinkOccurrence._getOptions(link, useMetaKey, false)
		};
	}

	private static _getOptions(link: Link, useMetaKey: boolean, isActive: boolean): ModelDecorationOptions {
		const options = { ... (isActive ? decoration.active : decoration.general) };
		options.hoverMessage = getHoverMessage(link, useMetaKey);
		return options;
	}

	public decorationId: string;
	public link: Link;

	constructor(link: Link, decorationId: string) {
		this.link = link;
		this.decorationId = decorationId;
	}

	public activate(changeAccessor: IModelDecorationsChangeAccessor, useMetaKey: boolean): void {
		changeAccessor.changeDecorationOptions(this.decorationId, LinkOccurrence._getOptions(this.link, useMetaKey, true));
	}

	public deactivate(changeAccessor: IModelDecorationsChangeAccessor, useMetaKey: boolean): void {
		changeAccessor.changeDecorationOptions(this.decorationId, LinkOccurrence._getOptions(this.link, useMetaKey, false));
	}
}

export class LinkDetector implements IEditorContribution {

	public static readonly ID: string = 'editor.linkDetector';

	public static get(editor: ICodeEditor): LinkDetector {
		return editor.getContribution<LinkDetector>(LinkDetector.ID);
	}

	static readonly RECOMPUTE_TIME = 1000; // ms

	private readonly editor: ICodeEditor;
	private enabled: boolean;
	private readonly listenersToRemove = new DisposableStore();
	private readonly timeout: async.TimeoutTimer;
	private computePromise: async.CancelablePromise<LinksList> | null;
	private activeLinksList: LinksList | null;
	private activeLinkDecorationId: string | null;
	private readonly openerService: IOpenerService;
	private readonly notificationService: INotificationService;
	private currentOccurrences: { [decorationId: string]: LinkOccurrence; };

	constructor(
		editor: ICodeEditor,
		@IOpenerService openerService: IOpenerService,
		@INotificationService notificationService: INotificationService
	) {
		this.editor = editor;
		this.openerService = openerService;
		this.notificationService = notificationService;

		let clickLinkGesture = new ClickLinkGesture(editor);
		this.listenersToRemove.add(clickLinkGesture);
		this.listenersToRemove.add(clickLinkGesture.onMouseMoveOrRelevantKeyDown(([mouseEvent, keyboardEvent]) => {
			this._onEditorMouseMove(mouseEvent, keyboardEvent);
		}));
		this.listenersToRemove.add(clickLinkGesture.onExecute((e) => {
			this.onEditorMouseUp(e);
		}));
		this.listenersToRemove.add(clickLinkGesture.onCancel((e) => {
			this.cleanUpActiveLinkDecoration();
		}));

		this.enabled = editor.getOption(EditorOption.links);
		this.listenersToRemove.add(editor.onDidChangeConfiguration((e) => {
			const enabled = editor.getOption(EditorOption.links);
			if (this.enabled === enabled) {
				// No change in our configuration option
				return;
			}
			this.enabled = enabled;

			// Remove any links (for the getting disabled case)
			this.updateDecorations([]);

			// Stop any computation (for the getting disabled case)
			this.stop();

			// Start computing (for the getting enabled case)
			this.beginCompute();
		}));
		this.listenersToRemove.add(editor.onDidChangeModelContent((e) => this.onChange()));
		this.listenersToRemove.add(editor.onDidChangeModel((e) => this.onModelChanged()));
		this.listenersToRemove.add(editor.onDidChangeModelLanguage((e) => this.onModelModeChanged()));
		this.listenersToRemove.add(LinkProviderRegistry.onDidChange((e) => this.onModelModeChanged()));

		this.timeout = new async.TimeoutTimer();
		this.computePromise = null;
		this.activeLinksList = null;
		this.currentOccurrences = {};
		this.activeLinkDecorationId = null;
		this.beginCompute();
	}

	private onModelChanged(): void {
		this.currentOccurrences = {};
		this.activeLinkDecorationId = null;
		this.stop();
		this.beginCompute();
	}

	private onModelModeChanged(): void {
		this.stop();
		this.beginCompute();
	}

	private onChange(): void {
		this.timeout.setIfNotSet(() => this.beginCompute(), LinkDetector.RECOMPUTE_TIME);
	}

	private async beginCompute(): Promise<void> {
		if (!this.editor.hasModel() || !this.enabled) {
			return;
		}

		const model = this.editor.getModel();

		if (!LinkProviderRegistry.has(model)) {
			return;
		}

		if (this.activeLinksList) {
			this.activeLinksList.dispose();
			this.activeLinksList = null;
		}

		this.computePromise = async.createCancelablePromise(token => getLinks(model, token));
		try {
			this.activeLinksList = await this.computePromise;
			this.updateDecorations(this.activeLinksList.links);
		} catch (err) {
			onUnexpectedError(err);
		} finally {
			this.computePromise = null;
		}
	}

	private updateDecorations(links: Link[]): void {
		const useMetaKey = (this.editor.getOption(EditorOption.multiCursorModifier) === 'altKey');
		let oldDecorations: string[] = [];
		let keys = Object.keys(this.currentOccurrences);
		for (let i = 0, len = keys.length; i < len; i++) {
			let decorationId = keys[i];
			let occurance = this.currentOccurrences[decorationId];
			oldDecorations.push(occurance.decorationId);
		}

		let newDecorations: IModelDeltaDecoration[] = [];
		if (links) {
			// Not sure why this is sometimes null
			for (const link of links) {
				newDecorations.push(LinkOccurrence.decoration(link, useMetaKey));
			}
		}

		let decorations = this.editor.deltaDecorations(oldDecorations, newDecorations);

		this.currentOccurrences = {};
		this.activeLinkDecorationId = null;
		for (let i = 0, len = decorations.length; i < len; i++) {
			let occurance = new LinkOccurrence(links[i], decorations[i]);
			this.currentOccurrences[occurance.decorationId] = occurance;
		}
	}

	private _onEditorMouseMove(mouseEvent: ClickLinkMouseEvent, withKey: ClickLinkKeyboardEvent | null): void {
		const useMetaKey = (this.editor.getOption(EditorOption.multiCursorModifier) === 'altKey');
		if (this.isEnabled(mouseEvent, withKey)) {
			this.cleanUpActiveLinkDecoration(); // always remove previous link decoration as their can only be one
			const occurrence = this.getLinkOccurrence(mouseEvent.target.position);
			if (occurrence) {
				this.editor.changeDecorations((changeAccessor) => {
					occurrence.activate(changeAccessor, useMetaKey);
					this.activeLinkDecorationId = occurrence.decorationId;
				});
			}
		} else {
			this.cleanUpActiveLinkDecoration();
		}
	}

	private cleanUpActiveLinkDecoration(): void {
		const useMetaKey = (this.editor.getOption(EditorOption.multiCursorModifier) === 'altKey');
		if (this.activeLinkDecorationId) {
			const occurrence = this.currentOccurrences[this.activeLinkDecorationId];
			if (occurrence) {
				this.editor.changeDecorations((changeAccessor) => {
					occurrence.deactivate(changeAccessor, useMetaKey);
				});
			}

			this.activeLinkDecorationId = null;
		}
	}

	private onEditorMouseUp(mouseEvent: ClickLinkMouseEvent): void {
		if (!this.isEnabled(mouseEvent)) {
			return;
		}
		const occurrence = this.getLinkOccurrence(mouseEvent.target.position);
		if (!occurrence) {
			return;
		}
		this.openLinkOccurrence(occurrence, mouseEvent.hasSideBySideModifier, true /* from user gesture */);
	}

	public openLinkOccurrence(occurrence: LinkOccurrence, openToSide: boolean, fromUserGesture = false): void {

		if (!this.openerService) {
			return;
		}

		const { link } = occurrence;

		link.resolve(CancellationToken.None).then(uri => {

			// Support for relative file URIs of the shape file://./relativeFile.txt or file:///./relativeFile.txt
			if (typeof uri === 'string' && this.editor.hasModel()) {
				const modelUri = this.editor.getModel().uri;
				if (modelUri.scheme === Schemas.file && uri.startsWith(`${Schemas.file}:`)) {
					const parsedUri = URI.parse(uri);
					if (parsedUri.scheme === Schemas.file) {
						const fsPath = resources.originalFSPath(parsedUri);

						let relativePath: string | null = null;
						if (fsPath.startsWith('/./')) {
							relativePath = `.${fsPath.substr(1)}`;
						} else if (fsPath.startsWith('//./')) {
							relativePath = `.${fsPath.substr(2)}`;
						}

						if (relativePath) {
							uri = resources.joinPath(modelUri, relativePath);
						}
					}
				}
			}

			return this.openerService.open(uri, { openToSide, fromUserGesture, allowContributedOpeners: true, allowCommands: true });

		}, err => {
			const messageOrError =
				err instanceof Error ? (<Error>err).message : err;
			// different error cases
			if (messageOrError === 'invalid') {
				this.notificationService.warn(nls.localize('invalid.url', 'Failed to open this link because it is not well-formed: {0}', link.url!.toString()));
			} else if (messageOrError === 'missing') {
				this.notificationService.warn(nls.localize('missing.url', 'Failed to open this link because its target is missing.'));
			} else {
				onUnexpectedError(err);
			}
		});
	}

	public getLinkOccurrence(position: Position | null): LinkOccurrence | null {
		if (!this.editor.hasModel() || !position) {
			return null;
		}
		const decorations = this.editor.getModel().getDecorationsInRange({
			startLineNumber: position.lineNumber,
			startColumn: position.column,
			endLineNumber: position.lineNumber,
			endColumn: position.column
		}, 0, true);

		for (const decoration of decorations) {
			const currentOccurrence = this.currentOccurrences[decoration.id];
			if (currentOccurrence) {
				return currentOccurrence;
			}
		}

		return null;
	}

	private isEnabled(mouseEvent: ClickLinkMouseEvent, withKey?: ClickLinkKeyboardEvent | null): boolean {
		return Boolean(
			(mouseEvent.target.type === MouseTargetType.CONTENT_TEXT)
			&& (mouseEvent.hasTriggerModifier || (withKey && withKey.keyCodeIsTriggerKey))
		);
	}

	private stop(): void {
		this.timeout.cancel();
		if (this.activeLinksList) {
			this.activeLinksList?.dispose();
			this.activeLinksList = null;
		}
		if (this.computePromise) {
			this.computePromise.cancel();
			this.computePromise = null;
		}
	}

	public dispose(): void {
		this.listenersToRemove.dispose();
		this.stop();
		this.timeout.dispose();
	}
}

class OpenLinkAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.openLink',
			label: nls.localize('label', "Open Link"),
			alias: 'Open Link',
			precondition: undefined
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		let linkDetector = LinkDetector.get(editor);
		if (!linkDetector) {
			return;
		}
		if (!editor.hasModel()) {
			return;
		}

		let selections = editor.getSelections();

		for (let sel of selections) {
			let link = linkDetector.getLinkOccurrence(sel.getEndPosition());

			if (link) {
				linkDetector.openLinkOccurrence(link, false);
			}
		}
	}
}

registerEditorContribution(LinkDetector.ID, LinkDetector);
registerEditorAction(OpenLinkAction);

registerThemingParticipant((theme, collector) => {
	const activeLinkForeground = theme.getColor(editorActiveLinkForeground);
	if (activeLinkForeground) {
		collector.addRule(`.monaco-editor .detected-link-active { color: ${activeLinkForeground} !important; }`);
	}
});
