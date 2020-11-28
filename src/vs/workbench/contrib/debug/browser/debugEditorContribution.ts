/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { RunOnceScheduler } from 'vs/base/common/async';
import * as env from 'vs/base/common/platform';
import { visit } from 'vs/base/common/json';
import { setProperty } from 'vs/base/common/jsonEdit';
import { Constants } from 'vs/base/common/uint';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IKeyboardEvent, StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { StandardTokenType } from 'vs/editor/common/modes';
import { DEFAULT_WORD_REGEXP } from 'vs/editor/common/model/wordHelper';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType, IPartialEditorMouseEvent } from 'vs/editor/browser/editorBrowser';
import { IDecorationOptions } from 'vs/editor/common/editorCommon';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { Range } from 'vs/editor/common/core/range';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IDebugEditorContribution, IDebugService, State, IStackFrame, IDebugConfiguration, IExpression, IExceptionInfo, IDebugSession, CONTEXT_EXCEPTION_WIDGET_VISIBLE } from 'vs/workbench/contrib/debug/common/debug';
import { ExceptionWidget } from 'vs/workbench/contrib/debug/browser/exceptionWidget';
import { FloatingClickWidget } from 'vs/workbench/browser/parts/editor/editorWidgets';
import { Position } from 'vs/editor/common/core/position';
import { CoreEditingCommands } from 'vs/editor/browser/controller/coreCommands';
import { memoize, createMemoizer } from 'vs/base/common/decorators';
import { IEditorHoverOptions, EditorOption } from 'vs/editor/common/config/editorOptions';
import { DebugHoverWidget } from 'vs/workbench/contrib/debug/browser/debugHover';
import { ITextModel } from 'vs/editor/common/model';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { basename } from 'vs/base/common/path';
import { domEvent } from 'vs/base/browser/event';
import { ModesHoverController } from 'vs/editor/contrib/hover/hover';
import { HoverStartMode } from 'vs/editor/contrib/hover/hoverOperation';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { Event } from 'vs/base/common/event';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

const LAUNCH_JSON_REGEX = /\.vscode\/launch\.json$/;
const INLINE_VALUE_DECORATION_KEY = 'inlinevaluedecoration';
const MAX_NUM_INLINE_VALUES = 100; // JS Global scope can have 700+ entries. We want to limit ourselves for perf reasons
const MAX_INLINE_DECORATOR_LENGTH = 150; // Max string length of each inline decorator when debugging. If exceeded ... is added
const MAX_TOKENIZATION_LINE_LEN = 500; // If line is too long, then inline values for the line are skipped

function createInlineValueDecoration(lineNumber: number, contentText: string): IDecorationOptions {
	// If decoratorText is too long, trim and add ellipses. This could happen for minified files with everything on a single line
	if (contentText.length > MAX_INLINE_DECORATOR_LENGTH) {
		contentText = contentText.substr(0, MAX_INLINE_DECORATOR_LENGTH) + '...';
	}

	return {
		range: {
			startLineNumber: lineNumber,
			endLineNumber: lineNumber,
			startColumn: Constants.MAX_SAFE_SMALL_INTEGER,
			endColumn: Constants.MAX_SAFE_SMALL_INTEGER
		},
		renderOptions: {
			after: {
				contentText,
				backgroundColor: 'rgba(255, 200, 0, 0.2)',
				margin: '10px'
			},
			dark: {
				after: {
					color: 'rgba(255, 255, 255, 0.5)',
				}
			},
			light: {
				after: {
					color: 'rgba(0, 0, 0, 0.5)',
				}
			}
		}
	};
}

function createInlineValueDecorationsInsideRange(expressions: ReadonlyArray<IExpression>, range: Range, model: ITextModel, wordToLineNumbersMap: Map<string, number[]>): IDecorationOptions[] {
	const nameValueMap = new Map<string, string>();
	for (let expr of expressions) {
		nameValueMap.set(expr.name, expr.value);
		// Limit the size of map. Too large can have a perf impact
		if (nameValueMap.size >= MAX_NUM_INLINE_VALUES) {
			break;
		}
	}

	const lineToNamesMap: Map<number, string[]> = new Map<number, string[]>();

	// Compute unique set of names on each line
	nameValueMap.forEach((_value, name) => {
		const lineNumbers = wordToLineNumbersMap.get(name);
		if (lineNumbers) {
			for (let lineNumber of lineNumbers) {
				if (range.containsPosition(new Position(lineNumber, 0))) {
					if (!lineToNamesMap.has(lineNumber)) {
						lineToNamesMap.set(lineNumber, []);
					}

					if (lineToNamesMap.get(lineNumber)!.indexOf(name) === -1) {
						lineToNamesMap.get(lineNumber)!.push(name);
					}
				}
			}
		}
	});

	const decorations: IDecorationOptions[] = [];
	// Compute decorators for each line
	lineToNamesMap.forEach((names, line) => {
		const contentText = names.sort((first, second) => {
			const content = model.getLineContent(line);
			return content.indexOf(first) - content.indexOf(second);
		}).map(name => `${name} = ${nameValueMap.get(name)}`).join(', ');
		decorations.push(createInlineValueDecoration(line, contentText));
	});

	return decorations;
}

function getWordToLineNumbersMap(model: ITextModel | null): Map<string, number[]> {
	const result = new Map<string, number[]>();
	if (!model) {
		return result;
	}

	// For every word in every line, map its ranges for fast lookup
	for (let lineNumber = 1, len = model.getLineCount(); lineNumber <= len; ++lineNumber) {
		const lineContent = model.getLineContent(lineNumber);

		// If line is too long then skip the line
		if (lineContent.length > MAX_TOKENIZATION_LINE_LEN) {
			continue;
		}

		model.forceTokenization(lineNumber);
		const lineTokens = model.getLineTokens(lineNumber);
		for (let tokenIndex = 0, tokenCount = lineTokens.getCount(); tokenIndex < tokenCount; tokenIndex++) {
			const tokenType = lineTokens.getStandardTokenType(tokenIndex);

			// Token is a word and not a comment
			if (tokenType === StandardTokenType.Other) {
				DEFAULT_WORD_REGEXP.lastIndex = 0; // We assume tokens will usually map 1:1 to words if they match

				const tokenStartOffset = lineTokens.getStartOffset(tokenIndex);
				const tokenEndOffset = lineTokens.getEndOffset(tokenIndex);
				const tokenStr = lineContent.substring(tokenStartOffset, tokenEndOffset);
				const wordMatch = DEFAULT_WORD_REGEXP.exec(tokenStr);

				if (wordMatch) {

					const word = wordMatch[0];
					if (!result.has(word)) {
						result.set(word, []);
					}

					result.get(word)!.push(lineNumber);
				}
			}
		}
	}

	return result;
}

export class DebugEditorContribution implements IDebugEditorContribution {

	private toDispose: IDisposable[];
	private hoverWidget: DebugHoverWidget;
	private hoverRange: Range | null = null;
	private mouseDown = false;
	private exceptionWidgetVisible: IContextKey<boolean>;
	private static readonly MEMOIZER = createMemoizer();

	private exceptionWidget: ExceptionWidget | undefined;
	private configurationWidget: FloatingClickWidget | undefined;
	private altListener: IDisposable | undefined;
	private altPressed = false;

	constructor(
		private editor: ICodeEditor,
		@IDebugService private readonly debugService: IDebugService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICommandService private readonly commandService: ICommandService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IHostService private readonly hostService: IHostService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		this.hoverWidget = this.instantiationService.createInstance(DebugHoverWidget, this.editor);
		this.toDispose = [];
		this.registerListeners();
		this.updateConfigurationWidgetVisibility();
		this.codeEditorService.registerDecorationType(INLINE_VALUE_DECORATION_KEY, {});
		this.exceptionWidgetVisible = CONTEXT_EXCEPTION_WIDGET_VISIBLE.bindTo(contextKeyService);
		this.toggleExceptionWidget();
	}

	private registerListeners(): void {
		this.toDispose.push(this.debugService.getViewModel().onDidFocusStackFrame(e => this.onFocusStackFrame(e.stackFrame)));

		// hover listeners & hover widget
		this.toDispose.push(this.editor.onMouseDown((e: IEditorMouseEvent) => this.onEditorMouseDown(e)));
		this.toDispose.push(this.editor.onMouseUp(() => this.mouseDown = false));
		this.toDispose.push(this.editor.onMouseMove((e: IEditorMouseEvent) => this.onEditorMouseMove(e)));
		this.toDispose.push(this.editor.onMouseLeave((e: IPartialEditorMouseEvent) => {
			const hoverDomNode = this.hoverWidget.getDomNode();
			if (!hoverDomNode) {
				return;
			}

			const rect = hoverDomNode.getBoundingClientRect();
			// Only hide the hover widget if the editor mouse leave event is outside the hover widget #3528
			if (e.event.posx < rect.left || e.event.posx > rect.right || e.event.posy < rect.top || e.event.posy > rect.bottom) {
				this.hideHoverWidget();
			}
		}));
		this.toDispose.push(this.editor.onKeyDown((e: IKeyboardEvent) => this.onKeyDown(e)));
		this.toDispose.push(this.editor.onDidChangeModelContent(() => {
			DebugEditorContribution.MEMOIZER.clear();
			this.updateInlineValuesScheduler.schedule();
		}));
		this.toDispose.push(this.editor.onDidChangeModel(async () => {
			const stackFrame = this.debugService.getViewModel().focusedStackFrame;
			const model = this.editor.getModel();
			if (model) {
				this.applyHoverConfiguration(model, stackFrame);
			}
			this.toggleExceptionWidget();
			this.hideHoverWidget();
			this.updateConfigurationWidgetVisibility();
			DebugEditorContribution.MEMOIZER.clear();
			await this.updateInlineValueDecorations(stackFrame);
		}));
		this.toDispose.push(this.editor.onDidScrollChange(() => this.hideHoverWidget));
		this.toDispose.push(this.debugService.onDidChangeState((state: State) => {
			if (state !== State.Stopped) {
				this.toggleExceptionWidget();
			}
		}));
	}

	@DebugEditorContribution.MEMOIZER
	private get wordToLineNumbersMap(): Map<string, number[]> {
		return getWordToLineNumbersMap(this.editor.getModel());
	}

	private applyHoverConfiguration(model: ITextModel, stackFrame: IStackFrame | undefined): void {
		if (stackFrame && this.uriIdentityService.extUri.isEqual(model.uri, stackFrame.source.uri)) {
			if (this.altListener) {
				this.altListener.dispose();
			}
			// When the alt key is pressed show regular editor hover and hide the debug hover #84561
			this.altListener = domEvent(document, 'keydown')(keydownEvent => {
				const standardKeyboardEvent = new StandardKeyboardEvent(keydownEvent);
				if (standardKeyboardEvent.keyCode === KeyCode.Alt) {
					this.altPressed = true;
					const debugHoverWasVisible = this.hoverWidget.isVisible();
					this.hoverWidget.hide();
					this.enableEditorHover();
					if (debugHoverWasVisible && this.hoverRange) {
						// If the debug hover was visible immediately show the editor hover for the alt transition to be smooth
						const hoverController = this.editor.getContribution<ModesHoverController>(ModesHoverController.ID);
						hoverController.showContentHover(this.hoverRange, HoverStartMode.Immediate, false);
					}

					const listener = Event.any<KeyboardEvent | boolean>(this.hostService.onDidChangeFocus, domEvent(document, 'keyup'))(keyupEvent => {
						let standardKeyboardEvent = undefined;
						if (keyupEvent instanceof KeyboardEvent) {
							standardKeyboardEvent = new StandardKeyboardEvent(keyupEvent);
						}
						if (!standardKeyboardEvent || standardKeyboardEvent.keyCode === KeyCode.Alt) {
							this.altPressed = false;
							this.editor.updateOptions({ hover: { enabled: false } });
							listener.dispose();
						}
					});
				}
			});

			this.editor.updateOptions({ hover: { enabled: false } });
		} else {
			this.altListener?.dispose();
			this.enableEditorHover();
		}
	}

	private enableEditorHover(): void {
		if (this.editor.hasModel()) {
			const model = this.editor.getModel();
			let overrides = {
				resource: model.uri,
				overrideIdentifier: model.getLanguageIdentifier().language
			};
			const defaultConfiguration = this.configurationService.getValue<IEditorHoverOptions>('editor.hover', overrides);
			this.editor.updateOptions({
				hover: {
					enabled: defaultConfiguration.enabled,
					delay: defaultConfiguration.delay,
					sticky: defaultConfiguration.sticky
				}
			});
		}
	}

	async showHover(range: Range, focus: boolean): Promise<void> {
		const sf = this.debugService.getViewModel().focusedStackFrame;
		const model = this.editor.getModel();
		if (sf && model && this.uriIdentityService.extUri.isEqual(sf.source.uri, model.uri) && !this.altPressed) {
			return this.hoverWidget.showAt(range, focus);
		}
	}

	private async onFocusStackFrame(sf: IStackFrame | undefined): Promise<void> {
		const model = this.editor.getModel();
		if (model) {
			this.applyHoverConfiguration(model, sf);
			if (sf && this.uriIdentityService.extUri.isEqual(sf.source.uri, model.uri)) {
				await this.toggleExceptionWidget();
			} else {
				this.hideHoverWidget();
			}
		}

		await this.updateInlineValueDecorations(sf);
	}

	@memoize
	private get showHoverScheduler(): RunOnceScheduler {
		const hoverOption = this.editor.getOption(EditorOption.hover);
		const scheduler = new RunOnceScheduler(() => {
			if (this.hoverRange) {
				this.showHover(this.hoverRange, false);
			}
		}, hoverOption.delay);
		this.toDispose.push(scheduler);

		return scheduler;
	}

	@memoize
	private get hideHoverScheduler(): RunOnceScheduler {
		const hoverOption = this.editor.getOption(EditorOption.hover);
		const scheduler = new RunOnceScheduler(() => {
			if (!this.hoverWidget.isHovered()) {
				this.hoverWidget.hide();
			}
		}, hoverOption.delay);
		this.toDispose.push(scheduler);

		return scheduler;
	}

	private hideHoverWidget(): void {
		if (!this.hideHoverScheduler.isScheduled() && this.hoverWidget.willBeVisible()) {
			this.hideHoverScheduler.schedule();
		}
		this.showHoverScheduler.cancel();
	}

	// hover business

	private onEditorMouseDown(mouseEvent: IEditorMouseEvent): void {
		this.mouseDown = true;
		if (mouseEvent.target.type === MouseTargetType.CONTENT_WIDGET && mouseEvent.target.detail === DebugHoverWidget.ID) {
			return;
		}

		this.hideHoverWidget();
	}

	private onEditorMouseMove(mouseEvent: IEditorMouseEvent): void {
		if (this.debugService.state !== State.Stopped) {
			return;
		}

		const targetType = mouseEvent.target.type;
		const stopKey = env.isMacintosh ? 'metaKey' : 'ctrlKey';

		if (targetType === MouseTargetType.CONTENT_WIDGET && mouseEvent.target.detail === DebugHoverWidget.ID && !(<any>mouseEvent.event)[stopKey]) {
			// mouse moved on top of debug hover widget
			return;
		}
		if (targetType === MouseTargetType.CONTENT_TEXT) {
			if (mouseEvent.target.range && !mouseEvent.target.range.equalsRange(this.hoverRange)) {
				this.hoverRange = mouseEvent.target.range;
				this.hideHoverScheduler.cancel();
				this.showHoverScheduler.schedule();
			}
		} else if (!this.mouseDown) {
			// Do not hide debug hover when the mouse is pressed because it usually leads to accidental closing #64620
			this.hideHoverWidget();
		}
	}

	private onKeyDown(e: IKeyboardEvent): void {
		const stopKey = env.isMacintosh ? KeyCode.Meta : KeyCode.Ctrl;
		if (e.keyCode !== stopKey) {
			// do not hide hover when Ctrl/Meta is pressed
			this.hideHoverWidget();
		}
	}
	// end hover business

	// exception widget
	private async toggleExceptionWidget(): Promise<void> {
		// Toggles exception widget based on the state of the current editor model and debug stack frame
		const model = this.editor.getModel();
		const focusedSf = this.debugService.getViewModel().focusedStackFrame;
		const callStack = focusedSf ? focusedSf.thread.getCallStack() : null;
		if (!model || !focusedSf || !callStack || callStack.length === 0) {
			this.closeExceptionWidget();
			return;
		}

		// First call stack frame that is available is the frame where exception has been thrown
		const exceptionSf = callStack.find(sf => !!(sf && sf.source && sf.source.available && sf.source.presentationHint !== 'deemphasize'));
		if (!exceptionSf || exceptionSf !== focusedSf) {
			this.closeExceptionWidget();
			return;
		}

		const sameUri = this.uriIdentityService.extUri.isEqual(exceptionSf.source.uri, model.uri);
		if (this.exceptionWidget && !sameUri) {
			this.closeExceptionWidget();
		} else if (sameUri) {
			const exceptionInfo = await focusedSf.thread.exceptionInfo;
			if (exceptionInfo && exceptionSf.range.startLineNumber && exceptionSf.range.startColumn) {
				this.showExceptionWidget(exceptionInfo, this.debugService.getViewModel().focusedSession, exceptionSf.range.startLineNumber, exceptionSf.range.startColumn);
			}
		}
	}

	private showExceptionWidget(exceptionInfo: IExceptionInfo, debugSession: IDebugSession | undefined, lineNumber: number, column: number): void {
		if (this.exceptionWidget) {
			this.exceptionWidget.dispose();
		}

		this.exceptionWidget = this.instantiationService.createInstance(ExceptionWidget, this.editor, exceptionInfo, debugSession);
		this.exceptionWidget.show({ lineNumber, column }, 0);
		this.exceptionWidget.focus();
		this.editor.revealLine(lineNumber);
		this.exceptionWidgetVisible.set(true);
	}

	closeExceptionWidget(): void {
		if (this.exceptionWidget) {
			this.exceptionWidget.dispose();
			this.exceptionWidget = undefined;
			this.exceptionWidgetVisible.set(false);
		}
	}

	// configuration widget
	private updateConfigurationWidgetVisibility(): void {
		const model = this.editor.getModel();
		if (this.configurationWidget) {
			this.configurationWidget.dispose();
		}
		if (model && LAUNCH_JSON_REGEX.test(model.uri.toString()) && !this.editor.getOption(EditorOption.readOnly)) {
			this.configurationWidget = this.instantiationService.createInstance(FloatingClickWidget, this.editor, nls.localize('addConfiguration', "Add Configuration..."), null);
			this.configurationWidget.render();
			this.toDispose.push(this.configurationWidget.onClick(() => this.addLaunchConfiguration()));
		}
	}

	async addLaunchConfiguration(): Promise<any> {
		/* __GDPR__
			"debug/addLaunchConfiguration" : {}
		*/
		this.telemetryService.publicLog('debug/addLaunchConfiguration');
		const model = this.editor.getModel();
		if (!model) {
			return;
		}

		let configurationsArrayPosition: Position | undefined;
		let lastProperty: string;

		const getConfigurationPosition = () => {
			let depthInArray = 0;
			visit(model.getValue(), {
				onObjectProperty: (property: string) => {
					lastProperty = property;
				},
				onArrayBegin: (offset: number) => {
					if (lastProperty === 'configurations' && depthInArray === 0) {
						configurationsArrayPosition = model.getPositionAt(offset + 1);
					}
					depthInArray++;
				},
				onArrayEnd: () => {
					depthInArray--;
				}
			});
		};

		getConfigurationPosition();

		if (!configurationsArrayPosition) {
			// "configurations" array doesn't exist. Add it here.
			const { tabSize, insertSpaces } = model.getOptions();
			const eol = model.getEOL();
			const edit = (basename(model.uri.fsPath) === 'launch.json') ?
				setProperty(model.getValue(), ['configurations'], [], { tabSize, insertSpaces, eol })[0] :
				setProperty(model.getValue(), ['launch'], { 'configurations': [] }, { tabSize, insertSpaces, eol })[0];
			const startPosition = model.getPositionAt(edit.offset);
			const lineNumber = startPosition.lineNumber;
			const range = new Range(lineNumber, startPosition.column, lineNumber, model.getLineMaxColumn(lineNumber));
			model.pushEditOperations(null, [EditOperation.replace(range, edit.content)], () => null);
			// Go through the file again since we've edited it
			getConfigurationPosition();
		}
		if (!configurationsArrayPosition) {
			return;
		}

		this.editor.focus();

		const insertLine = (position: Position): Promise<any> => {
			// Check if there are more characters on a line after a "configurations": [, if yes enter a newline
			if (model.getLineLastNonWhitespaceColumn(position.lineNumber) > position.column) {
				this.editor.setPosition(position);
				CoreEditingCommands.LineBreakInsert.runEditorCommand(null, this.editor, null);
			}
			this.editor.setPosition(position);
			return this.commandService.executeCommand('editor.action.insertLineAfter');
		};

		await insertLine(configurationsArrayPosition);
		await this.commandService.executeCommand('editor.action.triggerSuggest');
	}

	// Inline Decorations

	@memoize
	private get removeInlineValuesScheduler(): RunOnceScheduler {
		return new RunOnceScheduler(
			() => this.editor.removeDecorations(INLINE_VALUE_DECORATION_KEY),
			100
		);
	}

	@memoize
	private get updateInlineValuesScheduler(): RunOnceScheduler {
		return new RunOnceScheduler(
			async () => await this.updateInlineValueDecorations(this.debugService.getViewModel().focusedStackFrame),
			200
		);
	}

	private async updateInlineValueDecorations(stackFrame: IStackFrame | undefined): Promise<void> {
		const model = this.editor.getModel();
		if (!this.configurationService.getValue<IDebugConfiguration>('debug').inlineValues ||
			!model || !stackFrame || model.uri.toString() !== stackFrame.source.uri.toString()) {
			if (!this.removeInlineValuesScheduler.isScheduled()) {
				this.removeInlineValuesScheduler.schedule();
			}
			return;
		}

		this.removeInlineValuesScheduler.cancel();

		const scopes = await stackFrame.getMostSpecificScopes(stackFrame.range);
		// Get all top level children in the scope chain
		const decorationsPerScope = await Promise.all(scopes.map(async scope => {
			const children = await scope.getChildren();
			let range = new Range(0, 0, stackFrame.range.startLineNumber, stackFrame.range.startColumn);
			if (scope.range) {
				range = range.setStartPosition(scope.range.startLineNumber, scope.range.startColumn);
			}

			return createInlineValueDecorationsInsideRange(children, range, model, this.wordToLineNumbersMap);
		}));


		const allDecorations = decorationsPerScope.reduce((previous, current) => previous.concat(current), []);
		this.editor.setDecorations(INLINE_VALUE_DECORATION_KEY, allDecorations);
	}

	dispose(): void {
		if (this.hoverWidget) {
			this.hoverWidget.dispose();
		}
		if (this.configurationWidget) {
			this.configurationWidget.dispose();
		}
		this.toDispose = dispose(this.toDispose);
	}
}
