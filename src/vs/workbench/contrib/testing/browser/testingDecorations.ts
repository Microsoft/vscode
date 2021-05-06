/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action, IAction, Separator } from 'vs/base/common/actions';
import { Event } from 'vs/base/common/event';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { Disposable, dispose, IDisposable, IReference, MutableDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IRange } from 'vs/editor/common/core/range';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { IModelDeltaDecoration, OverviewRulerLane, TrackedRangeStickiness } from 'vs/editor/common/model';
import { overviewRulerError, overviewRulerInfo, overviewRulerWarning } from 'vs/editor/common/view/editorColorRegistry';
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService, themeColorFromId, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ExtHostTestingResource } from 'vs/workbench/api/common/extHost.protocol';
import { TestMessageSeverity, TestResultState } from 'vs/workbench/api/common/extHostTypes';
import { BREAKPOINT_EDITOR_CONTRIBUTION_ID, IBreakpointEditorContribution } from 'vs/workbench/contrib/debug/common/debug';
import { testingRunAllIcon, testingRunIcon, testingStatesToIcons } from 'vs/workbench/contrib/testing/browser/icons';
import { TestingOutputPeekController } from 'vs/workbench/contrib/testing/browser/testingOutputPeek';
import { testMessageSeverityColors } from 'vs/workbench/contrib/testing/browser/theme';
import { IncrementalTestCollectionItem, IRichLocation, ITestMessage, TestDiffOpType, TestResultItem } from 'vs/workbench/contrib/testing/common/testCollection';
import { buildTestUri, TestUriType } from 'vs/workbench/contrib/testing/common/testingUri';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { IMainThreadTestCollection, ITestService } from 'vs/workbench/contrib/testing/common/testService';

function isInDiffEditor(codeEditorService: ICodeEditorService, codeEditor: ICodeEditor): boolean {
	const diffEditors = codeEditorService.listDiffEditors();

	for (const diffEditor of diffEditors) {
		if (diffEditor.getModifiedEditor() === codeEditor || diffEditor.getOriginalEditor() === codeEditor) {
			return true;
		}
	}

	return false;
}

const FONT_FAMILY_VAR = `--testMessageDecorationFontFamily`;

export class TestingDecorations extends Disposable implements IEditorContribution {
	private collection = this._register(new MutableDisposable<IReference<IMainThreadTestCollection>>());
	private currentUri?: URI;
	private lastDecorations: ITestDecoration[] = [];

	/**
	 * List of messages that should be hidden because an editor changed their
	 * underlying ranges. I think this is good enough, because:
	 *  - Message decorations are never shown across reloads; this does not
	 *    need to persist
	 *  - Message instances are stable for any completed test results for
	 *    the duration of the session.
	 */
	private invalidatedMessages = new WeakSet<ITestMessage>();

	constructor(
		private readonly editor: ICodeEditor,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@ITestService private readonly testService: ITestService,
		@ITestResultService private readonly results: ITestResultService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this.attachModel(editor.getModel()?.uri);
		this._register(this.editor.onDidChangeModel(e => this.attachModel(e.newModelUrl || undefined)));
		this._register(this.editor.onMouseDown(e => {
			for (const decoration of this.lastDecorations) {
				if (decoration.click(e)) {
					e.event.stopPropagation();
					return;
				}
			}
		}));
		this._register(this.editor.onDidChangeModelContent(e => {
			if (!this.currentUri) {
				return;
			}

			let update = false;
			for (const change of e.changes) {
				for (const deco of this.lastDecorations) {
					if (deco instanceof TestMessageDecoration
						&& deco.location.range.startLineNumber >= change.range.startLineNumber
						&& deco.location.range.endLineNumber <= change.range.endLineNumber
					) {
						this.invalidatedMessages.add(deco.testMessage);
						update = true;
					}
				}
			}

			if (update) {
				this.setDecorations(this.currentUri);
			}
		}));

		const updateFontFamilyVar = () => {
			this.editor.getContainerDomNode().style.setProperty(FONT_FAMILY_VAR, editor.getOption(EditorOption.fontFamily));
		};
		this._register(this.editor.onDidChangeConfiguration((e) => {
			if (e.hasChanged(EditorOption.fontFamily)) {
				updateFontFamilyVar();
			}
		}));
		updateFontFamilyVar();

		this._register(this.results.onTestChanged(({ item: result }) => {
			if (this.currentUri && result.item.uri.toString() === this.currentUri.toString()) {
				this.setDecorations(this.currentUri);
			}
		}));
		this._register(Event.any(this.results.onResultsChanged, this.testService.excludeTests.onDidChange)(() => {
			if (this.currentUri) {
				this.setDecorations(this.currentUri);
			}
		}));
	}

	private attachModel(uri?: URI) {
		if (isInDiffEditor(this.codeEditorService, this.editor)) {
			uri = undefined;
		}

		this.currentUri = uri;

		if (!uri) {
			this.collection.value = undefined;
			this.clearDecorations();
			return;
		}

		this.collection.value = this.testService.subscribeToDiffs(ExtHostTestingResource.TextDocument, uri, diff => {
			this.setDecorations(uri!);

			for (const op of diff) {
				switch (op[0]) {
					case TestDiffOpType.Add:
						if (!op[1].parent) {
							this.collection.value?.object.expand(op[1].item.extId, Infinity);
						}
						break;
					case TestDiffOpType.Remove:
						TestingOutputPeekController.get(this.editor).removeIfPeekingForTest(op[1]);
						break;
				}
			}
		});

		for (const root of this.collection.value.object.rootIds) {
			this.collection.value.object.expand(root, Infinity);
		}

		this.setDecorations(uri);
	}

	private setDecorations(uri: URI): void {
		const ref = this.collection.value;
		if (!ref) {
			return;
		}

		this.editor.changeDecorations(accessor => {
			const newDecorations: ITestDecoration[] = [];
			for (const test of ref.object.all) {
				const stateLookup = this.results.getStateById(test.item.extId);
				if (test.item.range) {
					newDecorations.push(this.instantiationService.createInstance(
						RunTestDecoration, test, ref.object, test.item.range, this.editor, stateLookup?.[1]));
				}

				if (!stateLookup) {
					continue;
				}

				const [result, stateItem] = stateLookup;
				if (stateItem.retired) {
					continue; // do not show decorations for outdated tests
				}

				for (let taskId = 0; taskId < stateItem.tasks.length; taskId++) {
					const state = stateItem.tasks[taskId];
					for (let i = 0; i < state.messages.length; i++) {
						const m = state.messages[i];
						if (!this.invalidatedMessages.has(m) && hasValidLocation(uri, m)) {
							const uri = buildTestUri({
								type: TestUriType.ResultActualOutput,
								messageIndex: i,
								taskIndex: taskId,
								resultId: result.id,
								testExtId: stateItem.item.extId,
							});

							newDecorations.push(this.instantiationService.createInstance(TestMessageDecoration, m, uri, m.location, this.editor));
						}
					}
				}
			}

			accessor
				.deltaDecorations(this.lastDecorations.map(d => d.id), newDecorations.map(d => d.editorDecoration))
				.forEach((id, i) => newDecorations[i].id = id);

			this.lastDecorations = newDecorations;
		});
	}

	private clearDecorations(): void {
		this.editor.changeDecorations(accessor => {
			for (const decoration of this.lastDecorations) {
				accessor.removeDecoration(decoration.id);
			}

			this.lastDecorations = [];
		});
	}
}

interface ITestDecoration extends IDisposable {
	/**
	 * ID of the decoration after being added to the editor, set after the
	 * decoration is applied.
	 */
	id: string;

	readonly editorDecoration: IModelDeltaDecoration;

	/**
	 * Handles a click event, returns true if it was handled.
	 */
	click(e: IEditorMouseEvent): boolean;
}

const hasValidLocation = <T extends { location?: IRichLocation }>(editorUri: URI, t: T): t is T & { location: IRichLocation } =>
	t.location?.uri.toString() === editorUri.toString();

const firstLineRange = (originalRange: IRange) => ({
	startLineNumber: originalRange.startLineNumber,
	endLineNumber: originalRange.startLineNumber,
	startColumn: 0,
	endColumn: 1,
});

class RunTestDecoration extends Disposable implements ITestDecoration {
	/**
	 * @inheritdoc
	 */
	id = '';

	/**
	 * @inheritdoc
	 */
	public readonly editorDecoration: IModelDeltaDecoration;

	private line: number;

	constructor(
		private readonly test: IncrementalTestCollectionItem,
		private readonly collection: IMainThreadTestCollection,
		range: IRange,
		private readonly editor: ICodeEditor,
		stateItem: TestResultItem | undefined,
		@ITestService private readonly testService: ITestService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this.line = range.startLineNumber;

		const icon = stateItem?.computedState !== undefined && stateItem.computedState !== TestResultState.Unset
			? testingStatesToIcons.get(stateItem.computedState)!
			: test.children.size > 0 ? testingRunAllIcon : testingRunIcon;

		const hoverMessage = new MarkdownString('', true).appendText(localize('failedHoverMessage', '{0} has failed. ', test.item.label));
		if (stateItem?.tasks.some(s => s.messages.length > 0)) {
			const args = encodeURIComponent(JSON.stringify([test.item.extId]));
			hoverMessage.appendMarkdown(`[${localize('failedPeekAction', 'Peek Error')}](command:vscode.peekTestError?${args})`);
		}

		let glyphMarginClassName = ThemeIcon.asClassName(icon) + ' testing-run-glyph';
		if (stateItem?.retired) {
			glyphMarginClassName += ' retired';
		}

		this.editorDecoration = {
			range: firstLineRange(range),
			options: {
				isWholeLine: true,
				hoverMessage,
				glyphMarginClassName,
				stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
				glyphMarginHoverMessage: new MarkdownString().appendText(localize('testing.clickToRun', 'Click to run tests, right click for more options')),
			}
		};
	}

	/**
	 * @inheritdoc
	 */
	public click(e: IEditorMouseEvent): boolean {
		if (e.target.position?.lineNumber !== this.line || e.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN) {
			return false;
		}

		if (e.event.rightButton) {
			const actions = this.getContextMenu();
			this.contextMenuService.showContextMenu({
				getAnchor: () => ({ x: e.event.posx, y: e.event.posy }),
				getActions: () => actions,
				onHide: () => dispose(actions),
			});
		} else {
			// todo: customize click behavior
			this.testService.runTests({
				tests: [{ testId: this.test.item.extId, src: this.test.src }],
				debug: false,
			});
		}

		return true;
	}

	public override dispose() {
		// no-op
	}

	private getContextMenu() {
		const model = this.editor.getModel();
		if (!model) {
			return [];
		}

		const testActions: IAction[] = [];
		if (this.test.item.runnable) {
			testActions.push(new Action('testing.run', localize('run test', 'Run Test'), undefined, undefined, () => this.testService.runTests({
				debug: false,
				tests: [{ src: this.test.src, testId: this.test.item.extId }],
			})));
		}

		if (this.test.item.debuggable) {
			testActions.push(new Action('testing.debug', localize('debug test', 'Debug Test'), undefined, undefined, () => this.testService.runTests({
				debug: true,
				tests: [{ src: this.test.src, testId: this.test.item.extId }],
			})));
		}

		testActions.push(new Action('testing.reveal', localize('reveal test', 'Reveal in Test Explorer'), undefined, undefined, async () => {
			const path = [this.test];
			while (true) {
				const parentId = path[0].parent;
				const parent = parentId && this.collection.getNodeById(parentId);
				if (!parent) {
					break;
				}

				path.unshift(parent);
			}

			await this.commandService.executeCommand('vscode.revealTestInExplorer', path.map(t => t.item.extId));
		}));

		const breakpointActions = this.editor
			.getContribution<IBreakpointEditorContribution>(BREAKPOINT_EDITOR_CONTRIBUTION_ID)
			.getContextMenuActionsAtPosition(this.line, model);

		return breakpointActions.length ? [...testActions, new Separator(), ...breakpointActions] : testActions;
	}
}

class TestMessageDecoration implements ITestDecoration {
	public id = '';

	public readonly editorDecoration: IModelDeltaDecoration;
	private readonly decorationId = `testmessage-${generateUuid()}`;

	constructor(
		public readonly testMessage: ITestMessage,
		private readonly messageUri: URI,
		public readonly location: IRichLocation,
		private readonly editor: ICodeEditor,
		@ICodeEditorService private readonly editorService: ICodeEditorService,
		@IThemeService themeService: IThemeService,
	) {
		const { severity = TestMessageSeverity.Error, message } = testMessage;
		const colorTheme = themeService.getColorTheme();
		editorService.registerDecorationType(this.decorationId, {
			after: {
				contentText: message.toString(),
				color: `${colorTheme.getColor(testMessageSeverityColors[severity].decorationForeground)}`,
				fontSize: `${editor.getOption(EditorOption.fontSize)}px`,
				fontFamily: `var(${FONT_FAMILY_VAR})`,
				padding: `0px 12px 0px 24px`,
			},
		}, undefined, editor);

		const options = editorService.resolveDecorationOptions(this.decorationId, true);
		options.hoverMessage = typeof message === 'string' ? new MarkdownString().appendText(message) : message;
		options.afterContentClassName = `${options.afterContentClassName} testing-inline-message-content`;
		options.zIndex = 10; // todo: in spite of the z-index, this appears behind gitlens
		options.className = `testing-inline-message-margin testing-inline-message-severity-${severity}`;
		options.isWholeLine = true;
		options.stickiness = TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
		options.collapseOnReplaceEdit = true;

		const rulerColor = severity === TestMessageSeverity.Error
			? overviewRulerError
			: severity === TestMessageSeverity.Warning
				? overviewRulerWarning
				: severity === TestMessageSeverity.Information
					? overviewRulerInfo
					: undefined;

		if (rulerColor) {
			options.overviewRuler = { color: themeColorFromId(rulerColor), position: OverviewRulerLane.Right };
		}

		this.editorDecoration = { range: firstLineRange(location.range), options };
	}

	click(e: IEditorMouseEvent): boolean {
		if (e.event.rightButton) {
			return false;
		}

		if (e.target.element?.className.includes(this.decorationId)) {
			TestingOutputPeekController.get(this.editor).toggle(this.messageUri);
		}

		return false;
	}

	dispose(): void {
		this.editorService.removeDecorationType(this.decorationId);
	}
}
