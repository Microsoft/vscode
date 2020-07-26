/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/editorstatus';
import * as nls from 'vs/nls';
import { runAtThisOrScheduleAtNextAnimationFrame } from 'vs/base/browser/dom';
import { format, compare } from 'vs/base/common/strings';
import { extname, basename, isEqual } from 'vs/base/common/resources';
import { areFunctions, withNullAsUndefined, withUndefinedAsNull } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { Action } from 'vs/base/common/actions';
import { Language } from 'vs/base/common/platform';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { IFileEditorInput, EncodingMode, IEncodingSupport, toResource, SideBySideEditorInput, IEditorPane, IEditorInput, SideBySideEditor, IModeSupport } from 'vs/workbench/common/editor';
import { Disposable, MutableDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IEditorAction } from 'vs/editor/common/editorCommon';
import { EndOfLineSequence } from 'vs/editor/common/model';
import { IModelLanguageChangedEvent, IModelOptionsChangedEvent } from 'vs/editor/common/model/textModelEvents';
import { TrimTrailingWhitespaceAction } from 'vs/editor/contrib/linesOperations/linesOperations';
import { IndentUsingSpaces, IndentUsingTabs, DetectIndentation, IndentationToSpacesAction, IndentationToTabsAction } from 'vs/editor/contrib/indentation/indentation';
import { BaseBinaryResourceEditor } from 'vs/workbench/browser/parts/editor/binaryEditor';
import { BinaryResourceDiffEditor } from 'vs/workbench/browser/parts/editor/binaryDiffEditor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IFileService, FILES_ASSOCIATIONS_CONFIG } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IModeService, ILanguageSelection } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { TabFocus } from 'vs/editor/common/config/commonEditorConfig';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { SUPPORTED_ENCODINGS } from 'vs/workbench/services/textfile/common/encoding';
import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { ConfigurationChangedEvent, IEditorOptions, EditorOption } from 'vs/editor/common/config/editorOptions';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { deepClone } from 'vs/base/common/objects';
import { ICodeEditor, getCodeEditor } from 'vs/editor/browser/editorBrowser';
import { Schemas } from 'vs/base/common/network';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { timeout } from 'vs/base/common/async';
import { INotificationHandle, INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { Event } from 'vs/base/common/event';
import { IAccessibilityService, AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment, IStatusbarEntry } from 'vs/workbench/services/statusbar/common/statusbar';
import { IMarker, IMarkerService, MarkerSeverity, IMarkerData } from 'vs/platform/markers/common/markers';
import { STATUS_BAR_PROMINENT_ITEM_BACKGROUND, STATUS_BAR_PROMINENT_ITEM_FOREGROUND } from 'vs/workbench/common/theme';
import { themeColorFromId } from 'vs/platform/theme/common/themeService';

class SideBySideEditorEncodingSupport implements IEncodingSupport {
	constructor(private primary: IEncodingSupport, private secondary: IEncodingSupport) { }

	getEncoding(): string | undefined {
		return this.primary.getEncoding(); // always report from modified (right hand) side
	}

	setEncoding(encoding: string, mode: EncodingMode): void {
		[this.primary, this.secondary].forEach(editor => editor.setEncoding(encoding, mode));
	}
}

class SideBySideEditorModeSupport implements IModeSupport {
	constructor(private primary: IModeSupport, private secondary: IModeSupport) { }

	setMode(mode: string): void {
		[this.primary, this.secondary].forEach(editor => editor.setMode(mode));
	}
}

function toEditorWithEncodingSupport(input: IEditorInput): IEncodingSupport | null {

	// Untitled Text Editor
	if (input instanceof UntitledTextEditorInput) {
		return input;
	}

	// Side by Side (diff) Editor
	if (input instanceof SideBySideEditorInput) {
		const primaryEncodingSupport = toEditorWithEncodingSupport(input.primary);
		const secondaryEncodingSupport = toEditorWithEncodingSupport(input.secondary);

		if (primaryEncodingSupport && secondaryEncodingSupport) {
			return new SideBySideEditorEncodingSupport(primaryEncodingSupport, secondaryEncodingSupport);
		}

		return primaryEncodingSupport;
	}

	// File or Resource Editor
	const encodingSupport = input as IFileEditorInput;
	if (areFunctions(encodingSupport.setEncoding, encodingSupport.getEncoding)) {
		return encodingSupport;
	}

	// Unsupported for any other editor
	return null;
}

function toEditorWithModeSupport(input: IEditorInput): IModeSupport | null {

	// Untitled Text Editor
	if (input instanceof UntitledTextEditorInput) {
		return input;
	}

	// Side by Side (diff) Editor
	if (input instanceof SideBySideEditorInput) {
		const primaryModeSupport = toEditorWithModeSupport(input.primary);
		const secondaryModeSupport = toEditorWithModeSupport(input.secondary);

		if (primaryModeSupport && secondaryModeSupport) {
			return new SideBySideEditorModeSupport(primaryModeSupport, secondaryModeSupport);
		}

		return primaryModeSupport;
	}

	// File or Resource Editor
	const modeSupport = input as IFileEditorInput;
	if (typeof modeSupport.setMode === 'function') {
		return modeSupport;
	}

	// Unsupported for any other editor
	return null;
}

interface IEditorSelectionStatus {
	selections?: Selection[];
	charactersSelected?: number;
}

class StateChange {
	indentation: boolean = false;
	selectionStatus: boolean = false;
	mode: boolean = false;
	encoding: boolean = false;
	EOL: boolean = false;
	tabFocusMode: boolean = false;
	columnSelectionMode: boolean = false;
	screenReaderMode: boolean = false;
	metadata: boolean = false;

	combine(other: StateChange) {
		this.indentation = this.indentation || other.indentation;
		this.selectionStatus = this.selectionStatus || other.selectionStatus;
		this.mode = this.mode || other.mode;
		this.encoding = this.encoding || other.encoding;
		this.EOL = this.EOL || other.EOL;
		this.tabFocusMode = this.tabFocusMode || other.tabFocusMode;
		this.columnSelectionMode = this.columnSelectionMode || other.columnSelectionMode;
		this.screenReaderMode = this.screenReaderMode || other.screenReaderMode;
		this.metadata = this.metadata || other.metadata;
	}

	hasChanges(): boolean {
		return this.indentation
			|| this.selectionStatus
			|| this.mode
			|| this.encoding
			|| this.EOL
			|| this.tabFocusMode
			|| this.columnSelectionMode
			|| this.screenReaderMode
			|| this.metadata;
	}
}

type StateDelta = (
	{ type: 'selectionStatus'; selectionStatus: string | undefined; }
	| { type: 'mode'; mode: string | undefined; }
	| { type: 'encoding'; encoding: string | undefined; }
	| { type: 'EOL'; EOL: string | undefined; }
	| { type: 'indentation'; indentation: string | undefined; }
	| { type: 'tabFocusMode'; tabFocusMode: boolean; }
	| { type: 'columnSelectionMode'; columnSelectionMode: boolean; }
	| { type: 'screenReaderMode'; screenReaderMode: boolean; }
	| { type: 'metadata'; metadata: string | undefined; }
);

class State {

	private _selectionStatus: string | undefined;
	get selectionStatus(): string | undefined { return this._selectionStatus; }

	private _mode: string | undefined;
	get mode(): string | undefined { return this._mode; }

	private _encoding: string | undefined;
	get encoding(): string | undefined { return this._encoding; }

	private _EOL: string | undefined;
	get EOL(): string | undefined { return this._EOL; }

	private _indentation: string | undefined;
	get indentation(): string | undefined { return this._indentation; }

	private _tabFocusMode: boolean | undefined;
	get tabFocusMode(): boolean | undefined { return this._tabFocusMode; }

	private _columnSelectionMode: boolean | undefined;
	get columnSelectionMode(): boolean | undefined { return this._columnSelectionMode; }

	private _screenReaderMode: boolean | undefined;
	get screenReaderMode(): boolean | undefined { return this._screenReaderMode; }

	private _metadata: string | undefined;
	get metadata(): string | undefined { return this._metadata; }

	update(update: StateDelta): StateChange {
		const change = new StateChange();

		if (update.type === 'selectionStatus') {
			if (this._selectionStatus !== update.selectionStatus) {
				this._selectionStatus = update.selectionStatus;
				change.selectionStatus = true;
			}
		}

		if (update.type === 'indentation') {
			if (this._indentation !== update.indentation) {
				this._indentation = update.indentation;
				change.indentation = true;
			}
		}

		if (update.type === 'mode') {
			if (this._mode !== update.mode) {
				this._mode = update.mode;
				change.mode = true;
			}
		}

		if (update.type === 'encoding') {
			if (this._encoding !== update.encoding) {
				this._encoding = update.encoding;
				change.encoding = true;
			}
		}

		if (update.type === 'EOL') {
			if (this._EOL !== update.EOL) {
				this._EOL = update.EOL;
				change.EOL = true;
			}
		}

		if (update.type === 'tabFocusMode') {
			if (this._tabFocusMode !== update.tabFocusMode) {
				this._tabFocusMode = update.tabFocusMode;
				change.tabFocusMode = true;
			}
		}

		if (update.type === 'columnSelectionMode') {
			if (this._columnSelectionMode !== update.columnSelectionMode) {
				this._columnSelectionMode = update.columnSelectionMode;
				change.columnSelectionMode = true;
			}
		}

		if (update.type === 'screenReaderMode') {
			if (this._screenReaderMode !== update.screenReaderMode) {
				this._screenReaderMode = update.screenReaderMode;
				change.screenReaderMode = true;
			}
		}

		if (update.type === 'metadata') {
			if (this._metadata !== update.metadata) {
				this._metadata = update.metadata;
				change.metadata = true;
			}
		}

		return change;
	}
}

const nlsSingleSelectionRange = nls.localize('singleSelectionRange', "Ln {0}, Col {1} ({2} selected)");
const nlsSingleSelection = nls.localize('singleSelection', "Ln {0}, Col {1}");
const nlsMultiSelectionRange = nls.localize('multiSelectionRange', "{0} selections ({1} characters selected)");
const nlsMultiSelection = nls.localize('multiSelection', "{0} selections");
const nlsEOLLF = nls.localize('endOfLineLineFeed', "LF");
const nlsEOLCRLF = nls.localize('endOfLineCarriageReturnLineFeed', "CRLF");

export class EditorStatus extends Disposable implements IWorkbenchContribution {
	private readonly tabFocusModeElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly columnSelectionModeElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly screenRedearModeElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly indentationElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly selectionElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly encodingElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly eolElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly modeElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly metadataElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly currentProblemStatus: ShowCurrentMarkerInStatusbarContribution = this._register(this.instantiationService.createInstance(ShowCurrentMarkerInStatusbarContribution));

	private readonly state = new State();
	private readonly activeEditorListeners = this._register(new DisposableStore());
	private readonly delayedRender = this._register(new MutableDisposable());
	private toRender: StateChange | null = null;
	private screenReaderNotification: INotificationHandle | null = null;
	private promptedScreenReader: boolean = false;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IModeService private readonly modeService: IModeService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this.registerCommands();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.editorService.onDidActiveEditorChange(() => this.updateStatusBar()));
		this._register(this.textFileService.untitled.onDidChangeEncoding(model => this.onResourceEncodingChange(model.resource)));
		this._register(this.textFileService.files.onDidChangeEncoding(model => this.onResourceEncodingChange((model.resource))));
		this._register(TabFocus.onDidChangeTabFocus(e => this.onTabFocusModeChange()));
	}

	private registerCommands(): void {
		CommandsRegistry.registerCommand({ id: 'showEditorScreenReaderNotification', handler: () => this.showScreenReaderNotification() });
		CommandsRegistry.registerCommand({ id: 'changeEditorIndentation', handler: () => this.showIndentationPicker() });
	}

	private showScreenReaderNotification(): void {
		if (!this.screenReaderNotification) {
			this.screenReaderNotification = this.notificationService.prompt(
				Severity.Info,
				nls.localize('screenReaderDetectedExplanation.question', "Are you using a screen reader to operate VS Code? (Certain features like word wrap are disabled when using a screen reader)"),
				[{
					label: nls.localize('screenReaderDetectedExplanation.answerYes', "Yes"),
					run: () => {
						this.configurationService.updateValue('editor.accessibilitySupport', 'on', ConfigurationTarget.USER);
					}
				}, {
					label: nls.localize('screenReaderDetectedExplanation.answerNo', "No"),
					run: () => {
						this.configurationService.updateValue('editor.accessibilitySupport', 'off', ConfigurationTarget.USER);
					}
				}],
				{ sticky: true }
			);

			Event.once(this.screenReaderNotification.onDidClose)(() => this.screenReaderNotification = null);
		}
	}

	private async showIndentationPicker(): Promise<unknown> {
		const activeTextEditorControl = getCodeEditor(this.editorService.activeTextEditorControl);
		if (!activeTextEditorControl) {
			return this.quickInputService.pick([{ label: nls.localize('noEditor', "No text editor active at this time") }]);
		}

		if (this.editorService.activeEditor?.isReadonly()) {
			return this.quickInputService.pick([{ label: nls.localize('noWritableCodeEditor', "The active code editor is read-only.") }]);
		}

		const picks: QuickPickInput<IQuickPickItem & { run(): void; }>[] = [
			activeTextEditorControl.getAction(IndentUsingSpaces.ID),
			activeTextEditorControl.getAction(IndentUsingTabs.ID),
			activeTextEditorControl.getAction(DetectIndentation.ID),
			activeTextEditorControl.getAction(IndentationToSpacesAction.ID),
			activeTextEditorControl.getAction(IndentationToTabsAction.ID),
			activeTextEditorControl.getAction(TrimTrailingWhitespaceAction.ID)
		].map((a: IEditorAction) => {
			return {
				id: a.id,
				label: a.label,
				detail: (Language.isDefaultVariant() || a.label === a.alias) ? undefined : a.alias,
				run: () => {
					activeTextEditorControl.focus();
					a.run();
				}
			};
		});

		picks.splice(3, 0, { type: 'separator', label: nls.localize('indentConvert', "convert file") });
		picks.unshift({ type: 'separator', label: nls.localize('indentView', "change view") });

		const action = await this.quickInputService.pick(picks, { placeHolder: nls.localize('pickAction', "Select Action"), matchOnDetail: true });
		return action?.run();
	}

	private updateTabFocusModeElement(visible: boolean): void {
		if (visible) {
			if (!this.tabFocusModeElement.value) {
				const text = nls.localize('tabFocusModeEnabled', "Tab Moves Focus");
				this.tabFocusModeElement.value = this.statusbarService.addEntry({
					text,
					ariaLabel: text,
					tooltip: nls.localize('disableTabMode', "Disable Accessibility Mode"),
					command: 'editor.action.toggleTabFocusMode',
					backgroundColor: themeColorFromId(STATUS_BAR_PROMINENT_ITEM_BACKGROUND),
					color: themeColorFromId(STATUS_BAR_PROMINENT_ITEM_FOREGROUND)
				}, 'status.editor.tabFocusMode', nls.localize('status.editor.tabFocusMode', "Accessibility Mode"), StatusbarAlignment.RIGHT, 100.7);
			}
		} else {
			this.tabFocusModeElement.clear();
		}
	}

	private updateColumnSelectionModeElement(visible: boolean): void {
		if (visible) {
			if (!this.columnSelectionModeElement.value) {
				const text = nls.localize('columnSelectionModeEnabled', "Column Selection");
				this.columnSelectionModeElement.value = this.statusbarService.addEntry({
					text,
					ariaLabel: text,
					tooltip: nls.localize('disableColumnSelectionMode', "Disable Column Selection Mode"),
					command: 'editor.action.toggleColumnSelection',
					backgroundColor: themeColorFromId(STATUS_BAR_PROMINENT_ITEM_BACKGROUND),
					color: themeColorFromId(STATUS_BAR_PROMINENT_ITEM_FOREGROUND)
				}, 'status.editor.columnSelectionMode', nls.localize('status.editor.columnSelectionMode', "Column Selection Mode"), StatusbarAlignment.RIGHT, 100.8);
			}
		} else {
			this.columnSelectionModeElement.clear();
		}
	}

	private updateScreenReaderModeElement(visible: boolean): void {
		if (visible) {
			if (!this.screenRedearModeElement.value) {
				const text = nls.localize('screenReaderDetected', "Screen Reader Optimized");
				this.screenRedearModeElement.value = this.statusbarService.addEntry({
					text,
					ariaLabel: text,
					command: 'showEditorScreenReaderNotification',
					backgroundColor: themeColorFromId(STATUS_BAR_PROMINENT_ITEM_BACKGROUND),
					color: themeColorFromId(STATUS_BAR_PROMINENT_ITEM_FOREGROUND)
				}, 'status.editor.screenReaderMode', nls.localize('status.editor.screenReaderMode', "Screen Reader Mode"), StatusbarAlignment.RIGHT, 100.6);
			}
		} else {
			this.screenRedearModeElement.clear();
		}
	}

	private updateSelectionElement(text: string | undefined): void {
		if (!text) {
			this.selectionElement.clear();
			return;
		}

		const props: IStatusbarEntry = {
			text,
			ariaLabel: text,
			tooltip: nls.localize('gotoLine', "Go to Line/Column"),
			command: 'workbench.action.gotoLine'
		};

		this.updateElement(this.selectionElement, props, 'status.editor.selection', nls.localize('status.editor.selection', "Editor Selection"), StatusbarAlignment.RIGHT, 100.5);
	}

	private updateIndentationElement(text: string | undefined): void {
		if (!text) {
			this.indentationElement.clear();
			return;
		}

		const props: IStatusbarEntry = {
			text,
			ariaLabel: text,
			tooltip: nls.localize('selectIndentation', "Select Indentation"),
			command: 'changeEditorIndentation'
		};

		this.updateElement(this.indentationElement, props, 'status.editor.indentation', nls.localize('status.editor.indentation', "Editor Indentation"), StatusbarAlignment.RIGHT, 100.4);
	}

	private updateEncodingElement(text: string | undefined): void {
		if (!text) {
			this.encodingElement.clear();
			return;
		}

		const props: IStatusbarEntry = {
			text,
			ariaLabel: text,
			tooltip: nls.localize('selectEncoding', "Select Encoding"),
			command: 'workbench.action.editor.changeEncoding'
		};

		this.updateElement(this.encodingElement, props, 'status.editor.encoding', nls.localize('status.editor.encoding', "Editor Encoding"), StatusbarAlignment.RIGHT, 100.3);
	}

	private updateEOLElement(text: string | undefined): void {
		if (!text) {
			this.eolElement.clear();
			return;
		}

		const props: IStatusbarEntry = {
			text,
			ariaLabel: text,
			tooltip: nls.localize('selectEOL', "Select End of Line Sequence"),
			command: 'workbench.action.editor.changeEOL'
		};

		this.updateElement(this.eolElement, props, 'status.editor.eol', nls.localize('status.editor.eol', "Editor End of Line"), StatusbarAlignment.RIGHT, 100.2);
	}

	private updateModeElement(text: string | undefined): void {
		if (!text) {
			this.modeElement.clear();
			return;
		}

		const props: IStatusbarEntry = {
			text,
			ariaLabel: text,
			tooltip: nls.localize('selectLanguageMode', "Select Language Mode"),
			command: 'workbench.action.editor.changeLanguageMode'
		};

		this.updateElement(this.modeElement, props, 'status.editor.mode', nls.localize('status.editor.mode', "Editor Language"), StatusbarAlignment.RIGHT, 100.1);
	}

	private updateMetadataElement(text: string | undefined): void {
		if (!text) {
			this.metadataElement.clear();
			return;
		}

		const props: IStatusbarEntry = {
			text,
			ariaLabel: text,
			tooltip: nls.localize('fileInfo', "File Information")
		};

		this.updateElement(this.metadataElement, props, 'status.editor.info', nls.localize('status.editor.info', "File Information"), StatusbarAlignment.RIGHT, 100);
	}

	private updateElement(element: MutableDisposable<IStatusbarEntryAccessor>, props: IStatusbarEntry, id: string, name: string, alignment: StatusbarAlignment, priority: number) {
		if (!element.value) {
			element.value = this.statusbarService.addEntry(props, id, name, alignment, priority);
		} else {
			element.value.update(props);
		}
	}

	private updateState(update: StateDelta): void {
		const changed = this.state.update(update);
		if (!changed.hasChanges()) {
			return; // Nothing really changed
		}

		if (!this.toRender) {
			this.toRender = changed;

			this.delayedRender.value = runAtThisOrScheduleAtNextAnimationFrame(() => {
				this.delayedRender.clear();

				const toRender = this.toRender;
				this.toRender = null;
				if (toRender) {
					this.doRenderNow(toRender);
				}
			});
		} else {
			this.toRender.combine(changed);
		}
	}

	private doRenderNow(changed: StateChange): void {
		this.updateTabFocusModeElement(!!this.state.tabFocusMode);
		this.updateColumnSelectionModeElement(!!this.state.columnSelectionMode);
		this.updateScreenReaderModeElement(!!this.state.screenReaderMode);
		this.updateIndentationElement(this.state.indentation);
		this.updateSelectionElement(this.state.selectionStatus);
		this.updateEncodingElement(this.state.encoding);
		this.updateEOLElement(this.state.EOL ? this.state.EOL === '\r\n' ? nlsEOLCRLF : nlsEOLLF : undefined);
		this.updateModeElement(this.state.mode);
		this.updateMetadataElement(this.state.metadata);
	}

	private getSelectionLabel(info: IEditorSelectionStatus): string | undefined {
		if (!info || !info.selections) {
			return undefined;
		}

		if (info.selections.length === 1) {
			if (info.charactersSelected) {
				return format(nlsSingleSelectionRange, info.selections[0].positionLineNumber, info.selections[0].positionColumn, info.charactersSelected);
			}

			return format(nlsSingleSelection, info.selections[0].positionLineNumber, info.selections[0].positionColumn);
		}

		if (info.charactersSelected) {
			return format(nlsMultiSelectionRange, info.selections.length, info.charactersSelected);
		}

		if (info.selections.length > 0) {
			return format(nlsMultiSelection, info.selections.length);
		}

		return undefined;
	}

	private updateStatusBar(): void {
		const activeInput = this.editorService.activeEditor;
		const activeEditorPane = this.editorService.activeEditorPane;
		const activeCodeEditor = activeEditorPane ? withNullAsUndefined(getCodeEditor(activeEditorPane.getControl())) : undefined;

		// Update all states
		this.onColumnSelectionModeChange(activeCodeEditor);
		this.onScreenReaderModeChange(activeCodeEditor);
		this.onSelectionChange(activeCodeEditor);
		this.onModeChange(activeCodeEditor, activeInput);
		this.onEOLChange(activeCodeEditor);
		this.onEncodingChange(activeEditorPane, activeCodeEditor);
		this.onIndentationChange(activeCodeEditor);
		this.onMetadataChange(activeEditorPane);
		this.currentProblemStatus.update(activeCodeEditor);

		// Dispose old active editor listeners
		this.activeEditorListeners.clear();

		// Attach new listeners to active editor
		if (activeCodeEditor) {

			// Hook Listener for Configuration changes
			this.activeEditorListeners.add(activeCodeEditor.onDidChangeConfiguration((event: ConfigurationChangedEvent) => {
				if (event.hasChanged(EditorOption.columnSelection)) {
					this.onColumnSelectionModeChange(activeCodeEditor);
				}
				if (event.hasChanged(EditorOption.accessibilitySupport)) {
					this.onScreenReaderModeChange(activeCodeEditor);
				}
			}));

			// Hook Listener for Selection changes
			this.activeEditorListeners.add(activeCodeEditor.onDidChangeCursorPosition((event: ICursorPositionChangedEvent) => {
				this.onSelectionChange(activeCodeEditor);
				this.currentProblemStatus.update(activeCodeEditor);
			}));

			// Hook Listener for mode changes
			this.activeEditorListeners.add(activeCodeEditor.onDidChangeModelLanguage((event: IModelLanguageChangedEvent) => {
				this.onModeChange(activeCodeEditor, activeInput);
			}));

			// Hook Listener for content changes
			this.activeEditorListeners.add(activeCodeEditor.onDidChangeModelContent((e) => {
				this.onEOLChange(activeCodeEditor);
				this.currentProblemStatus.update(activeCodeEditor);

				const selections = activeCodeEditor.getSelections();
				if (selections) {
					for (const change of e.changes) {
						if (selections.some(selection => Range.areIntersecting(selection, change.range))) {
							this.onSelectionChange(activeCodeEditor);
							break;
						}
					}
				}
			}));

			// Hook Listener for content options changes
			this.activeEditorListeners.add(activeCodeEditor.onDidChangeModelOptions((event: IModelOptionsChangedEvent) => {
				this.onIndentationChange(activeCodeEditor);
			}));
		}

		// Handle binary editors
		else if (activeEditorPane instanceof BaseBinaryResourceEditor || activeEditorPane instanceof BinaryResourceDiffEditor) {
			const binaryEditors: BaseBinaryResourceEditor[] = [];
			if (activeEditorPane instanceof BinaryResourceDiffEditor) {
				const primary = activeEditorPane.getPrimaryEditorPane();
				if (primary instanceof BaseBinaryResourceEditor) {
					binaryEditors.push(primary);
				}

				const secondary = activeEditorPane.getSecondaryEditorPane();
				if (secondary instanceof BaseBinaryResourceEditor) {
					binaryEditors.push(secondary);
				}
			} else {
				binaryEditors.push(activeEditorPane);
			}

			binaryEditors.forEach(editor => {
				this.activeEditorListeners.add(editor.onMetadataChanged(metadata => {
					this.onMetadataChange(activeEditorPane);
				}));

				this.activeEditorListeners.add(editor.onDidOpenInPlace(() => {
					this.updateStatusBar();
				}));
			});
		}
	}

	private onModeChange(editorWidget: ICodeEditor | undefined, editorInput: IEditorInput | undefined): void {
		let info: StateDelta = { type: 'mode', mode: undefined };

		// We only support text based editors
		if (editorWidget && editorInput && toEditorWithModeSupport(editorInput)) {
			const textModel = editorWidget.getModel();
			if (textModel) {
				const modeId = textModel.getLanguageIdentifier().language;
				info.mode = withNullAsUndefined(this.modeService.getLanguageName(modeId));
			}
		}

		this.updateState(info);
	}

	private onIndentationChange(editorWidget: ICodeEditor | undefined): void {
		const update: StateDelta = { type: 'indentation', indentation: undefined };

		if (editorWidget) {
			const model = editorWidget.getModel();
			if (model) {
				const modelOpts = model.getOptions();
				update.indentation = (
					modelOpts.insertSpaces
						? nls.localize('spacesSize', "Spaces: {0}", modelOpts.indentSize)
						: nls.localize({ key: 'tabSize', comment: ['Tab corresponds to the tab key'] }, "Tab Size: {0}", modelOpts.tabSize)
				);
			}
		}

		this.updateState(update);
	}

	private onMetadataChange(editor: IEditorPane | undefined): void {
		const update: StateDelta = { type: 'metadata', metadata: undefined };

		if (editor instanceof BaseBinaryResourceEditor || editor instanceof BinaryResourceDiffEditor) {
			update.metadata = editor.getMetadata();
		}

		this.updateState(update);
	}

	private onColumnSelectionModeChange(editorWidget: ICodeEditor | undefined): void {
		const info: StateDelta = { type: 'columnSelectionMode', columnSelectionMode: false };

		if (editorWidget && editorWidget.getOption(EditorOption.columnSelection)) {
			info.columnSelectionMode = true;
		}

		this.updateState(info);
	}

	private onScreenReaderModeChange(editorWidget: ICodeEditor | undefined): void {
		let screenReaderMode = false;

		// We only support text based editors
		if (editorWidget) {
			const screenReaderDetected = this.accessibilityService.isScreenReaderOptimized();
			if (screenReaderDetected) {
				const screenReaderConfiguration = this.configurationService.getValue<IEditorOptions>('editor').accessibilitySupport;
				if (screenReaderConfiguration === 'auto') {
					if (!this.promptedScreenReader) {
						this.promptedScreenReader = true;
						setTimeout(() => this.showScreenReaderNotification(), 100);
					}
				}
			}

			screenReaderMode = (editorWidget.getOption(EditorOption.accessibilitySupport) === AccessibilitySupport.Enabled);
		}

		if (screenReaderMode === false && this.screenReaderNotification) {
			this.screenReaderNotification.close();
		}

		this.updateState({ type: 'screenReaderMode', screenReaderMode: screenReaderMode });
	}

	private onSelectionChange(editorWidget: ICodeEditor | undefined): void {
		const info: IEditorSelectionStatus = Object.create(null);

		// We only support text based editors
		if (editorWidget) {

			// Compute selection(s)
			info.selections = editorWidget.getSelections() || [];

			// Compute selection length
			info.charactersSelected = 0;
			const textModel = editorWidget.getModel();
			if (textModel) {
				info.selections.forEach(selection => {
					if (typeof info.charactersSelected !== 'number') {
						info.charactersSelected = 0;
					}

					info.charactersSelected += textModel.getCharacterCountInRange(selection);
				});
			}

			// Compute the visible column for one selection. This will properly handle tabs and their configured widths
			if (info.selections.length === 1) {
				const editorPosition = editorWidget.getPosition();

				let selectionClone = new Selection(
					info.selections[0].selectionStartLineNumber,
					info.selections[0].selectionStartColumn,
					info.selections[0].positionLineNumber,
					editorPosition ? editorWidget.getStatusbarColumn(editorPosition) : info.selections[0].positionColumn
				);

				info.selections[0] = selectionClone;
			}
		}

		this.updateState({ type: 'selectionStatus', selectionStatus: this.getSelectionLabel(info) });
	}

	private onEOLChange(editorWidget: ICodeEditor | undefined): void {
		const info: StateDelta = { type: 'EOL', EOL: undefined };

		if (editorWidget && !editorWidget.getOption(EditorOption.readOnly)) {
			const codeEditorModel = editorWidget.getModel();
			if (codeEditorModel) {
				info.EOL = codeEditorModel.getEOL();
			}
		}

		this.updateState(info);
	}

	private onEncodingChange(editor: IEditorPane | undefined, editorWidget: ICodeEditor | undefined): void {
		if (editor && !this.isActiveEditor(editor)) {
			return;
		}

		const info: StateDelta = { type: 'encoding', encoding: undefined };

		// We only support text based editors that have a model associated
		// This ensures we do not show the encoding picker while an editor
		// is still loading.
		if (editor && editorWidget?.hasModel()) {
			const encodingSupport: IEncodingSupport | null = editor.input ? toEditorWithEncodingSupport(editor.input) : null;
			if (encodingSupport) {
				const rawEncoding = encodingSupport.getEncoding();
				const encodingInfo = typeof rawEncoding === 'string' ? SUPPORTED_ENCODINGS[rawEncoding] : undefined;
				if (encodingInfo) {
					info.encoding = encodingInfo.labelShort; // if we have a label, take it from there
				} else {
					info.encoding = rawEncoding; // otherwise use it raw
				}
			}
		}

		this.updateState(info);
	}

	private onResourceEncodingChange(resource: URI): void {
		const activeEditorPane = this.editorService.activeEditorPane;
		if (activeEditorPane) {
			const activeResource = toResource(activeEditorPane.input, { supportSideBySide: SideBySideEditor.PRIMARY });
			if (activeResource && isEqual(activeResource, resource)) {
				const activeCodeEditor = withNullAsUndefined(getCodeEditor(activeEditorPane.getControl()));

				return this.onEncodingChange(activeEditorPane, activeCodeEditor); // only update if the encoding changed for the active resource
			}
		}
	}

	private onTabFocusModeChange(): void {
		const info: StateDelta = { type: 'tabFocusMode', tabFocusMode: TabFocus.getTabFocusMode() };

		this.updateState(info);
	}

	private isActiveEditor(control: IEditorPane): boolean {
		const activeEditorPane = this.editorService.activeEditorPane;

		return !!activeEditorPane && activeEditorPane === control;
	}
}

class ShowCurrentMarkerInStatusbarContribution extends Disposable {

	private readonly statusBarEntryAccessor: MutableDisposable<IStatusbarEntryAccessor>;
	private editor: ICodeEditor | undefined = undefined;
	private markers: IMarker[] = [];
	private currentMarker: IMarker | null = null;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.statusBarEntryAccessor = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
		this._register(markerService.onMarkerChanged(changedResources => this.onMarkerChanged(changedResources)));
		this._register(Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('problems.showCurrentInStatus'))(() => this.updateStatus()));
	}

	update(editor: ICodeEditor | undefined): void {
		this.editor = editor;
		this.updateMarkers();
		this.updateStatus();
	}

	private updateStatus(): void {
		const previousMarker = this.currentMarker;
		this.currentMarker = this.getMarker();
		if (this.hasToUpdateStatus(previousMarker, this.currentMarker)) {
			if (this.currentMarker) {
				const line = this.currentMarker.message.split(/\r\n|\r|\n/g)[0];
				const text = `${this.getType(this.currentMarker)} ${line}`;
				if (!this.statusBarEntryAccessor.value) {
					this.statusBarEntryAccessor.value = this.statusbarService.addEntry({ text: '', ariaLabel: '' }, 'statusbar.currentProblem', nls.localize('currentProblem', "Current Problem"), StatusbarAlignment.LEFT);
				}
				this.statusBarEntryAccessor.value.update({ text, ariaLabel: text });
			} else {
				this.statusBarEntryAccessor.clear();
			}
		}
	}

	private hasToUpdateStatus(previousMarker: IMarker | null, currentMarker: IMarker | null): boolean {
		if (!currentMarker) {
			return true;
		}
		if (!previousMarker) {
			return true;
		}
		return IMarkerData.makeKey(previousMarker) !== IMarkerData.makeKey(currentMarker);
	}

	private getType(marker: IMarker): string {
		switch (marker.severity) {
			case MarkerSeverity.Error: return '$(error)';
			case MarkerSeverity.Warning: return '$(warning)';
			case MarkerSeverity.Info: return '$(info)';
		}
		return '';
	}

	private getMarker(): IMarker | null {
		if (!this.configurationService.getValue<boolean>('problems.showCurrentInStatus')) {
			return null;
		}
		if (!this.editor) {
			return null;
		}
		const model = this.editor.getModel();
		if (!model) {
			return null;
		}
		const position = this.editor.getPosition();
		if (!position) {
			return null;
		}
		return this.markers.find(marker => Range.containsPosition(marker, position)) || null;
	}

	private onMarkerChanged(changedResources: ReadonlyArray<URI>): void {
		if (!this.editor) {
			return;
		}
		const model = this.editor.getModel();
		if (!model) {
			return;
		}
		if (model && !changedResources.some(r => isEqual(model.uri, r))) {
			return;
		}
		this.updateMarkers();
	}

	private updateMarkers(): void {
		if (!this.editor) {
			return;
		}
		const model = this.editor.getModel();
		if (!model) {
			return;
		}
		if (model) {
			this.markers = this.markerService.read({
				resource: model.uri,
				severities: MarkerSeverity.Error | MarkerSeverity.Warning | MarkerSeverity.Info
			});
			this.markers.sort(compareMarker);
		} else {
			this.markers = [];
		}
		this.updateStatus();
	}
}

function compareMarker(a: IMarker, b: IMarker): number {
	let res = compare(a.resource.toString(), b.resource.toString());
	if (res === 0) {
		res = MarkerSeverity.compare(a.severity, b.severity);
	}
	if (res === 0) {
		res = Range.compareRangesUsingStarts(a, b);
	}
	return res;
}

export class ShowLanguageExtensionsAction extends Action {

	static readonly ID = 'workbench.action.showLanguageExtensions';

	constructor(
		private fileExtension: string,
		@ICommandService private readonly commandService: ICommandService,
		@IExtensionGalleryService galleryService: IExtensionGalleryService
	) {
		super(ShowLanguageExtensionsAction.ID, nls.localize('showLanguageExtensions', "Search Marketplace Extensions for '{0}'...", fileExtension));

		this.enabled = galleryService.isEnabled();
	}

	async run(): Promise<void> {
		await this.commandService.executeCommand('workbench.extensions.action.showExtensionsForLanguage', this.fileExtension);
	}
}

export class ChangeModeAction extends Action {

	static readonly ID = 'workbench.action.editor.changeLanguageMode';
	static readonly LABEL = nls.localize('changeMode', "Change Language Mode");

	constructor(
		actionId: string,
		actionLabel: string,
		@IModeService private readonly modeService: IModeService,
		@IModelService private readonly modelService: IModelService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextFileService private readonly textFileService: ITextFileService
	) {
		super(actionId, actionLabel);
	}

	async run(): Promise<void> {
		const activeTextEditorControl = getCodeEditor(this.editorService.activeTextEditorControl);
		if (!activeTextEditorControl) {
			await this.quickInputService.pick([{ label: nls.localize('noEditor', "No text editor active at this time") }]);
			return;
		}

		const textModel = activeTextEditorControl.getModel();
		const resource = this.editorService.activeEditor ? toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY }) : null;

		let hasLanguageSupport = !!resource;
		if (resource?.scheme === Schemas.untitled && !this.textFileService.untitled.get(resource)?.hasAssociatedFilePath) {
			hasLanguageSupport = false; // no configuration for untitled resources (e.g. "Untitled-1")
		}

		// Compute mode
		let currentModeId: string | undefined;
		let modeId: string | undefined;
		if (textModel) {
			modeId = textModel.getLanguageIdentifier().language;
			currentModeId = withNullAsUndefined(this.modeService.getLanguageName(modeId));
		}

		// All languages are valid picks
		const languages = this.modeService.getRegisteredLanguageNames();
		const picks: QuickPickInput[] = languages.sort().map((lang, index) => {
			let description: string;
			if (currentModeId === lang) {
				description = nls.localize('languageDescription', "({0}) - Configured Language", this.modeService.getModeIdForLanguageName(lang.toLowerCase()));
			} else {
				description = nls.localize('languageDescriptionConfigured', "({0})", this.modeService.getModeIdForLanguageName(lang.toLowerCase()));
			}

			return {
				label: lang,
				iconClasses: getIconClasses(this.modelService, this.modeService, this.getFakeResource(lang)),
				description
			};
		});

		if (hasLanguageSupport) {
			picks.unshift({ type: 'separator', label: nls.localize('languagesPicks', "languages (identifier)") });
		}

		// Offer action to configure via settings
		let configureModeAssociations: IQuickPickItem | undefined;
		let configureModeSettings: IQuickPickItem | undefined;
		let galleryAction: Action | undefined;
		if (hasLanguageSupport && resource) {
			const ext = extname(resource) || basename(resource);

			galleryAction = this.instantiationService.createInstance(ShowLanguageExtensionsAction, ext);
			if (galleryAction.enabled) {
				picks.unshift(galleryAction);
			}

			configureModeSettings = { label: nls.localize('configureModeSettings', "Configure '{0}' language based settings...", currentModeId) };
			picks.unshift(configureModeSettings);
			configureModeAssociations = { label: nls.localize('configureAssociationsExt', "Configure File Association for '{0}'...", ext) };
			picks.unshift(configureModeAssociations);
		}

		// Offer to "Auto Detect"
		const autoDetectMode: IQuickPickItem = {
			label: nls.localize('autoDetect', "Auto Detect")
		};

		if (hasLanguageSupport) {
			picks.unshift(autoDetectMode);
		}

		const pick = await this.quickInputService.pick(picks, { placeHolder: nls.localize('pickLanguage', "Select Language Mode"), matchOnDescription: true });
		if (!pick) {
			return;
		}

		if (pick === galleryAction) {
			galleryAction.run();
			return;
		}

		// User decided to permanently configure associations, return right after
		if (pick === configureModeAssociations) {
			if (resource) {
				this.configureFileAssociation(resource);
			}
			return;
		}

		// User decided to configure settings for current language
		if (pick === configureModeSettings) {
			this.preferencesService.openGlobalSettings(true, { editSetting: `[${withUndefinedAsNull(modeId)}]` });
			return;
		}

		// Change mode for active editor
		const activeEditor = this.editorService.activeEditor;
		if (activeEditor) {
			const modeSupport = toEditorWithModeSupport(activeEditor);
			if (modeSupport) {

				// Find mode
				let languageSelection: ILanguageSelection | undefined;
				if (pick === autoDetectMode) {
					if (textModel) {
						const resource = toResource(activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
						if (resource) {
							languageSelection = this.modeService.createByFilepathOrFirstLine(resource, textModel.getLineContent(1));
						}
					}
				} else {
					languageSelection = this.modeService.createByLanguageName(pick.label);
				}

				// Change mode
				if (typeof languageSelection !== 'undefined') {
					modeSupport.setMode(languageSelection.languageIdentifier.language);
				}
			}
		}
	}

	private configureFileAssociation(resource: URI): void {
		const extension = extname(resource);
		const base = basename(resource);
		const currentAssociation = this.modeService.getModeIdByFilepathOrFirstLine(URI.file(base));

		const languages = this.modeService.getRegisteredLanguageNames();
		const picks: IQuickPickItem[] = languages.sort().map((lang, index) => {
			const id = withNullAsUndefined(this.modeService.getModeIdForLanguageName(lang.toLowerCase()));

			return {
				id,
				label: lang,
				iconClasses: getIconClasses(this.modelService, this.modeService, this.getFakeResource(lang)),
				description: (id === currentAssociation) ? nls.localize('currentAssociation', "Current Association") : undefined
			};
		});

		setTimeout(async () => {
			const language = await this.quickInputService.pick(picks, { placeHolder: nls.localize('pickLanguageToConfigure', "Select Language Mode to Associate with '{0}'", extension || base) });
			if (language) {
				const fileAssociationsConfig = this.configurationService.inspect<{}>(FILES_ASSOCIATIONS_CONFIG);

				let associationKey: string;
				if (extension && base[0] !== '.') {
					associationKey = `*${extension}`; // only use "*.ext" if the file path is in the form of <name>.<ext>
				} else {
					associationKey = base; // otherwise use the basename (e.g. .gitignore, Dockerfile)
				}

				// If the association is already being made in the workspace, make sure to target workspace settings
				let target = ConfigurationTarget.USER;
				if (fileAssociationsConfig.workspaceValue && !!(fileAssociationsConfig.workspaceValue as any)[associationKey]) {
					target = ConfigurationTarget.WORKSPACE;
				}

				// Make sure to write into the value of the target and not the merged value from USER and WORKSPACE config
				const currentAssociations = deepClone((target === ConfigurationTarget.WORKSPACE) ? fileAssociationsConfig.workspaceValue : fileAssociationsConfig.userValue) || Object.create(null);
				currentAssociations[associationKey] = language.id;

				this.configurationService.updateValue(FILES_ASSOCIATIONS_CONFIG, currentAssociations, target);
			}
		}, 50 /* quick input is sensitive to being opened so soon after another */);
	}

	private getFakeResource(lang: string): URI | undefined {
		let fakeResource: URI | undefined;

		const extensions = this.modeService.getExtensions(lang);
		if (extensions?.length) {
			fakeResource = URI.file(extensions[0]);
		} else {
			const filenames = this.modeService.getFilenames(lang);
			if (filenames?.length) {
				fakeResource = URI.file(filenames[0]);
			}
		}

		return fakeResource;
	}
}

export interface IChangeEOLEntry extends IQuickPickItem {
	eol: EndOfLineSequence;
}

export class ChangeEOLAction extends Action {

	static readonly ID = 'workbench.action.editor.changeEOL';
	static readonly LABEL = nls.localize('changeEndOfLine', "Change End of Line Sequence");

	constructor(
		actionId: string,
		actionLabel: string,
		@IEditorService private readonly editorService: IEditorService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(actionId, actionLabel);
	}

	async run(): Promise<void> {
		const activeTextEditorControl = getCodeEditor(this.editorService.activeTextEditorControl);
		if (!activeTextEditorControl) {
			await this.quickInputService.pick([{ label: nls.localize('noEditor', "No text editor active at this time") }]);
			return;
		}

		if (this.editorService.activeEditor?.isReadonly()) {
			await this.quickInputService.pick([{ label: nls.localize('noWritableCodeEditor', "The active code editor is read-only.") }]);
			return;
		}

		let textModel = activeTextEditorControl.getModel();

		const EOLOptions: IChangeEOLEntry[] = [
			{ label: nlsEOLLF, eol: EndOfLineSequence.LF },
			{ label: nlsEOLCRLF, eol: EndOfLineSequence.CRLF },
		];

		const selectedIndex = (textModel?.getEOL() === '\n') ? 0 : 1;

		const eol = await this.quickInputService.pick(EOLOptions, { placeHolder: nls.localize('pickEndOfLine', "Select End of Line Sequence"), activeItem: EOLOptions[selectedIndex] });
		if (eol) {
			const activeCodeEditor = getCodeEditor(this.editorService.activeTextEditorControl);
			if (activeCodeEditor?.hasModel() && !this.editorService.activeEditor?.isReadonly()) {
				textModel = activeCodeEditor.getModel();
				textModel.pushStackElement();
				textModel.pushEOL(eol.eol);
				textModel.pushStackElement();
			}
		}
	}
}

export class ChangeEncodingAction extends Action {

	static readonly ID = 'workbench.action.editor.changeEncoding';
	static readonly LABEL = nls.localize('changeEncoding', "Change File Encoding");

	constructor(
		actionId: string,
		actionLabel: string,
		@IEditorService private readonly editorService: IEditorService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService
	) {
		super(actionId, actionLabel);
	}

	async run(): Promise<void> {
		if (!getCodeEditor(this.editorService.activeTextEditorControl)) {
			await this.quickInputService.pick([{ label: nls.localize('noEditor', "No text editor active at this time") }]);
			return;
		}

		const activeEditorPane = this.editorService.activeEditorPane;
		if (!activeEditorPane) {
			await this.quickInputService.pick([{ label: nls.localize('noEditor', "No text editor active at this time") }]);
			return;
		}

		const encodingSupport: IEncodingSupport | null = toEditorWithEncodingSupport(activeEditorPane.input);
		if (!encodingSupport) {
			await this.quickInputService.pick([{ label: nls.localize('noFileEditor', "No file active at this time") }]);
			return;
		}

		const saveWithEncodingPick: IQuickPickItem = { label: nls.localize('saveWithEncoding', "Save with Encoding") };
		const reopenWithEncodingPick: IQuickPickItem = { label: nls.localize('reopenWithEncoding', "Reopen with Encoding") };

		if (!Language.isDefaultVariant()) {
			const saveWithEncodingAlias = 'Save with Encoding';
			if (saveWithEncodingAlias !== saveWithEncodingPick.label) {
				saveWithEncodingPick.detail = saveWithEncodingAlias;
			}

			const reopenWithEncodingAlias = 'Reopen with Encoding';
			if (reopenWithEncodingAlias !== reopenWithEncodingPick.label) {
				reopenWithEncodingPick.detail = reopenWithEncodingAlias;
			}
		}

		let action: IQuickPickItem | undefined;
		if (encodingSupport instanceof UntitledTextEditorInput) {
			action = saveWithEncodingPick;
		} else if (activeEditorPane.input.isReadonly()) {
			action = reopenWithEncodingPick;
		} else {
			action = await this.quickInputService.pick([reopenWithEncodingPick, saveWithEncodingPick], { placeHolder: nls.localize('pickAction', "Select Action"), matchOnDetail: true });
		}

		if (!action) {
			return;
		}

		await timeout(50); // quick input is sensitive to being opened so soon after another

		const resource = toResource(activeEditorPane.input, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (!resource || (!this.fileService.canHandleResource(resource) && resource.scheme !== Schemas.untitled)) {
			return; // encoding detection only possible for resources the file service can handle or that are untitled
		}

		let guessedEncoding: string | undefined = undefined;
		if (this.fileService.canHandleResource(resource)) {
			const content = await this.textFileService.read(resource, { autoGuessEncoding: true });
			guessedEncoding = content.encoding;
		}

		const isReopenWithEncoding = (action === reopenWithEncodingPick);

		const configuredEncoding = this.textResourceConfigurationService.getValue(withNullAsUndefined(resource), 'files.encoding');

		let directMatchIndex: number | undefined;
		let aliasMatchIndex: number | undefined;

		// All encodings are valid picks
		const picks: QuickPickInput[] = Object.keys(SUPPORTED_ENCODINGS)
			.sort((k1, k2) => {
				if (k1 === configuredEncoding) {
					return -1;
				} else if (k2 === configuredEncoding) {
					return 1;
				}

				return SUPPORTED_ENCODINGS[k1].order - SUPPORTED_ENCODINGS[k2].order;
			})
			.filter(k => {
				if (k === guessedEncoding && guessedEncoding !== configuredEncoding) {
					return false; // do not show encoding if it is the guessed encoding that does not match the configured
				}

				return !isReopenWithEncoding || !SUPPORTED_ENCODINGS[k].encodeOnly; // hide those that can only be used for encoding if we are about to decode
			})
			.map((key, index) => {
				if (key === encodingSupport.getEncoding()) {
					directMatchIndex = index;
				} else if (SUPPORTED_ENCODINGS[key].alias === encodingSupport.getEncoding()) {
					aliasMatchIndex = index;
				}

				return { id: key, label: SUPPORTED_ENCODINGS[key].labelLong, description: key };
			});

		const items = picks.slice() as IQuickPickItem[];

		// If we have a guessed encoding, show it first unless it matches the configured encoding
		if (guessedEncoding && configuredEncoding !== guessedEncoding && SUPPORTED_ENCODINGS[guessedEncoding]) {
			picks.unshift({ type: 'separator' });
			picks.unshift({ id: guessedEncoding, label: SUPPORTED_ENCODINGS[guessedEncoding].labelLong, description: nls.localize('guessedEncoding', "Guessed from content") });
		}

		const encoding = await this.quickInputService.pick(picks, {
			placeHolder: isReopenWithEncoding ? nls.localize('pickEncodingForReopen', "Select File Encoding to Reopen File") : nls.localize('pickEncodingForSave', "Select File Encoding to Save with"),
			activeItem: items[typeof directMatchIndex === 'number' ? directMatchIndex : typeof aliasMatchIndex === 'number' ? aliasMatchIndex : -1]
		});

		if (!encoding) {
			return;
		}

		if (!this.editorService.activeEditorPane) {
			return;
		}

		const activeEncodingSupport = toEditorWithEncodingSupport(this.editorService.activeEditorPane.input);
		if (typeof encoding.id !== 'undefined' && activeEncodingSupport && activeEncodingSupport.getEncoding() !== encoding.id) {
			activeEncodingSupport.setEncoding(encoding.id, isReopenWithEncoding ? EncodingMode.Decode : EncodingMode.Encode); // Set new encoding
		}
	}
}
