/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventHelper, getDomNodePagePosition } from 'vs/base/browser/dom';
import { IAction, SubmenuAction } from 'vs/base/common/actions';
import { Delayer } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { Disposable, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { IModelDeltaDecoration, TrackedRangeStickiness } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import * as nls from 'vs/nls';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationPropertySchema, IConfigurationRegistry, IConfigurationNode, OVERRIDE_PROPERTY_PATTERN, overrideIdentifierFromKey } from 'vs/platform/configuration/common/configurationRegistry';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { RangeHighlightDecorations } from 'vs/workbench/browser/parts/editor/rangeDecorations';
import { DefaultSettingsHeaderWidget, EditPreferenceWidget, SettingsGroupTitleWidget, SettingsHeaderWidget, preferencesEditIcon } from 'vs/workbench/contrib/preferences/browser/preferencesWidgets';
import { IFilterResult, IPreferencesEditorModel, IPreferencesService, ISetting, ISettingsEditorModel, ISettingsGroup } from 'vs/workbench/services/preferences/common/preferences';
import { DefaultSettingsEditorModel, SettingsEditorModel, WorkspaceConfigurationEditorModel } from 'vs/workbench/services/preferences/common/preferencesModels';
import { IMarkerService, IMarkerData, MarkerSeverity, MarkerTag } from 'vs/platform/markers/common/markers';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { find } from 'vs/base/common/arrays';

export interface IPreferencesRenderer<T> extends IDisposable {
	readonly preferencesModel: IPreferencesEditorModel<T>;

	getAssociatedPreferencesModel(): IPreferencesEditorModel<T>;
	setAssociatedPreferencesModel(associatedPreferencesModel: IPreferencesEditorModel<T>): void;

	onFocusPreference: Event<T>;
	onClearFocusPreference: Event<T>;
	onUpdatePreference: Event<{ key: string, value: any, source: T }>;

	render(): void;
	updatePreference(key: string, value: any, source: T): void;
	focusPreference(setting: T): void;
	clearFocus(setting: T): void;
	filterPreferences(filterResult: IFilterResult | undefined): void;
	editPreference(setting: T): boolean;
}

export class UserSettingsRenderer extends Disposable implements IPreferencesRenderer<ISetting> {

	private settingHighlighter: SettingHighlighter;
	private editSettingActionRenderer: EditSettingRenderer;
	private highlightMatchesRenderer: HighlightMatchesRenderer;
	private modelChangeDelayer: Delayer<void> = new Delayer<void>(200);
	private associatedPreferencesModel!: IPreferencesEditorModel<ISetting>;

	private readonly _onFocusPreference = this._register(new Emitter<ISetting>());
	readonly onFocusPreference: Event<ISetting> = this._onFocusPreference.event;

	private readonly _onClearFocusPreference = this._register(new Emitter<ISetting>());
	readonly onClearFocusPreference: Event<ISetting> = this._onClearFocusPreference.event;

	private readonly _onUpdatePreference = this._register(new Emitter<{ key: string, value: any, source: IIndexedSetting }>());
	readonly onUpdatePreference: Event<{ key: string, value: any, source: IIndexedSetting }> = this._onUpdatePreference.event;

	private unsupportedSettingsRenderer: UnsupportedSettingsRenderer;

	private filterResult: IFilterResult | undefined;

	constructor(protected editor: ICodeEditor, readonly preferencesModel: SettingsEditorModel,
		@IPreferencesService protected preferencesService: IPreferencesService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService protected instantiationService: IInstantiationService
	) {
		super();
		this.settingHighlighter = this._register(instantiationService.createInstance(SettingHighlighter, editor, this._onFocusPreference, this._onClearFocusPreference));
		this.highlightMatchesRenderer = this._register(instantiationService.createInstance(HighlightMatchesRenderer, editor));
		this.editSettingActionRenderer = this._register(this.instantiationService.createInstance(EditSettingRenderer, this.editor, this.preferencesModel, this.settingHighlighter));
		this._register(this.editSettingActionRenderer.onUpdateSetting(({ key, value, source }) => this._updatePreference(key, value, source)));
		this._register(this.editor.getModel()!.onDidChangeContent(() => this.modelChangeDelayer.trigger(() => this.onModelChanged())));
		this.unsupportedSettingsRenderer = this._register(instantiationService.createInstance(UnsupportedSettingsRenderer, editor, preferencesModel));
	}

	getAssociatedPreferencesModel(): IPreferencesEditorModel<ISetting> {
		return this.associatedPreferencesModel;
	}

	setAssociatedPreferencesModel(associatedPreferencesModel: IPreferencesEditorModel<ISetting>): void {
		this.associatedPreferencesModel = associatedPreferencesModel;
		this.editSettingActionRenderer.associatedPreferencesModel = associatedPreferencesModel;

		// Create header only in Settings editor mode
		this.createHeader();
	}

	protected createHeader(): void {
		this._register(new SettingsHeaderWidget(this.editor, '')).setMessage(nls.localize('emptyUserSettingsHeader', "Place your settings here to override the Default Settings."));
	}

	render(): void {
		this.editSettingActionRenderer.render(this.preferencesModel.settingsGroups, this.associatedPreferencesModel);
		if (this.filterResult) {
			this.filterPreferences(this.filterResult);
		}
		this.unsupportedSettingsRenderer.render();
	}

	private _updatePreference(key: string, value: any, source: IIndexedSetting): void {
		this._onUpdatePreference.fire({ key, value, source });
		this.updatePreference(key, value, source);
	}

	updatePreference(key: string, value: any, source: IIndexedSetting): void {
		const overrideIdentifier = source.overrideOf ? overrideIdentifierFromKey(source.overrideOf.key) : null;
		const resource = this.preferencesModel.uri;
		this.configurationService.updateValue(key, value, { overrideIdentifier, resource }, this.preferencesModel.configurationTarget)
			.then(() => this.onSettingUpdated(source));
	}

	private onModelChanged(): void {
		if (!this.editor.hasModel()) {
			// model could have been disposed during the delay
			return;
		}
		this.render();
	}

	private onSettingUpdated(setting: ISetting) {
		this.editor.focus();
		setting = this.getSetting(setting)!;
		if (setting) {
			// TODO:@sandy Selection range should be template range
			this.editor.setSelection(setting.valueRange);
			this.settingHighlighter.highlight(setting, true);
		}
	}

	private getSetting(setting: ISetting): ISetting | undefined {
		const { key, overrideOf } = setting;
		if (overrideOf) {
			const setting = this.getSetting(overrideOf);
			for (const override of setting!.overrides!) {
				if (override.key === key) {
					return override;
				}
			}
			return undefined;
		}

		return this.preferencesModel.getPreference(key);
	}

	filterPreferences(filterResult: IFilterResult | undefined): void {
		this.filterResult = filterResult;
		this.settingHighlighter.clear(true);
		this.highlightMatchesRenderer.render(filterResult ? filterResult.matches : []);
	}

	focusPreference(setting: ISetting): void {
		const s = this.getSetting(setting);
		if (s) {
			this.settingHighlighter.highlight(s, true);
			this.editor.setPosition({ lineNumber: s.keyRange.startLineNumber, column: s.keyRange.startColumn });
		} else {
			this.settingHighlighter.clear(true);
		}
	}

	clearFocus(setting: ISetting): void {
		this.settingHighlighter.clear(true);
	}

	editPreference(setting: ISetting): boolean {
		const editableSetting = this.getSetting(setting);
		return !!(editableSetting && this.editSettingActionRenderer.activateOnSetting(editableSetting));
	}
}

export class WorkspaceSettingsRenderer extends UserSettingsRenderer implements IPreferencesRenderer<ISetting> {

	private workspaceConfigurationRenderer: WorkspaceConfigurationRenderer;

	constructor(editor: ICodeEditor, preferencesModel: SettingsEditorModel,
		@IPreferencesService preferencesService: IPreferencesService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(editor, preferencesModel, preferencesService, configurationService, instantiationService);
		this.workspaceConfigurationRenderer = this._register(instantiationService.createInstance(WorkspaceConfigurationRenderer, editor, preferencesModel));
	}

	protected createHeader(): void {
		this._register(new SettingsHeaderWidget(this.editor, '')).setMessage(nls.localize('emptyWorkspaceSettingsHeader', "Place your settings here to override the User Settings."));
	}

	setAssociatedPreferencesModel(associatedPreferencesModel: IPreferencesEditorModel<ISetting>): void {
		super.setAssociatedPreferencesModel(associatedPreferencesModel);
		this.workspaceConfigurationRenderer.render(this.getAssociatedPreferencesModel());
	}

	render(): void {
		super.render();
		this.workspaceConfigurationRenderer.render(this.getAssociatedPreferencesModel());
	}
}

export class FolderSettingsRenderer extends UserSettingsRenderer implements IPreferencesRenderer<ISetting> {

	constructor(editor: ICodeEditor, preferencesModel: SettingsEditorModel,
		@IPreferencesService preferencesService: IPreferencesService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(editor, preferencesModel, preferencesService, configurationService, instantiationService);
	}

	protected createHeader(): void {
		this._register(new SettingsHeaderWidget(this.editor, '')).setMessage(nls.localize('emptyFolderSettingsHeader', "Place your folder settings here to override those from the Workspace Settings."));
	}

}

export class DefaultSettingsRenderer extends Disposable implements IPreferencesRenderer<ISetting> {

	private _associatedPreferencesModel!: IPreferencesEditorModel<ISetting>;
	private settingHighlighter: SettingHighlighter;
	private settingsHeaderRenderer: DefaultSettingsHeaderRenderer;
	private settingsGroupTitleRenderer: SettingsGroupTitleRenderer;
	private filteredMatchesRenderer: FilteredMatchesRenderer;
	private hiddenAreasRenderer: HiddenAreasRenderer;
	private editSettingActionRenderer: EditSettingRenderer;
	private bracesHidingRenderer: BracesHidingRenderer;
	private filterResult: IFilterResult | undefined;

	private readonly _onUpdatePreference = this._register(new Emitter<{ key: string, value: any, source: IIndexedSetting }>());
	readonly onUpdatePreference: Event<{ key: string, value: any, source: IIndexedSetting }> = this._onUpdatePreference.event;

	private readonly _onFocusPreference = this._register(new Emitter<ISetting>());
	readonly onFocusPreference: Event<ISetting> = this._onFocusPreference.event;

	private readonly _onClearFocusPreference = this._register(new Emitter<ISetting>());
	readonly onClearFocusPreference: Event<ISetting> = this._onClearFocusPreference.event;

	constructor(protected editor: ICodeEditor, readonly preferencesModel: DefaultSettingsEditorModel,
		@IPreferencesService protected preferencesService: IPreferencesService,
		@IInstantiationService protected instantiationService: IInstantiationService,
	) {
		super();
		this.settingHighlighter = this._register(instantiationService.createInstance(SettingHighlighter, editor, this._onFocusPreference, this._onClearFocusPreference));
		this.settingsHeaderRenderer = this._register(instantiationService.createInstance(DefaultSettingsHeaderRenderer, editor));
		this.settingsGroupTitleRenderer = this._register(instantiationService.createInstance(SettingsGroupTitleRenderer, editor));
		this.filteredMatchesRenderer = this._register(instantiationService.createInstance(FilteredMatchesRenderer, editor));
		this.editSettingActionRenderer = this._register(instantiationService.createInstance(EditSettingRenderer, editor, preferencesModel, this.settingHighlighter));
		this.bracesHidingRenderer = this._register(instantiationService.createInstance(BracesHidingRenderer, editor));
		this.hiddenAreasRenderer = this._register(instantiationService.createInstance(HiddenAreasRenderer, editor, [this.settingsGroupTitleRenderer, this.filteredMatchesRenderer, this.bracesHidingRenderer]));

		this._register(this.editSettingActionRenderer.onUpdateSetting(e => this._onUpdatePreference.fire(e)));
		this._register(this.settingsGroupTitleRenderer.onHiddenAreasChanged(() => this.hiddenAreasRenderer.render()));
		this._register(preferencesModel.onDidChangeGroups(() => this.render()));
	}

	getAssociatedPreferencesModel(): IPreferencesEditorModel<ISetting> {
		return this._associatedPreferencesModel;
	}

	setAssociatedPreferencesModel(associatedPreferencesModel: IPreferencesEditorModel<ISetting>): void {
		this._associatedPreferencesModel = associatedPreferencesModel;
		this.editSettingActionRenderer.associatedPreferencesModel = associatedPreferencesModel;
	}

	render() {
		this.settingsGroupTitleRenderer.render(this.preferencesModel.settingsGroups);
		this.editSettingActionRenderer.render(this.preferencesModel.settingsGroups, this._associatedPreferencesModel);
		this.settingHighlighter.clear(true);
		this.bracesHidingRenderer.render(undefined, this.preferencesModel.settingsGroups);
		this.settingsGroupTitleRenderer.showGroup(0);
		this.hiddenAreasRenderer.render();
	}

	filterPreferences(filterResult: IFilterResult | undefined): void {
		this.filterResult = filterResult;

		if (filterResult) {
			this.filteredMatchesRenderer.render(filterResult, this.preferencesModel.settingsGroups);
			this.settingsGroupTitleRenderer.render(undefined);
			this.settingsHeaderRenderer.render(filterResult);
			this.settingHighlighter.clear(true);
			this.bracesHidingRenderer.render(filterResult, this.preferencesModel.settingsGroups);
			this.editSettingActionRenderer.render(filterResult.filteredGroups, this._associatedPreferencesModel);
		} else {
			this.settingHighlighter.clear(true);
			this.filteredMatchesRenderer.render(undefined, this.preferencesModel.settingsGroups);
			this.settingsHeaderRenderer.render(undefined);
			this.settingsGroupTitleRenderer.render(this.preferencesModel.settingsGroups);
			this.settingsGroupTitleRenderer.showGroup(0);
			this.bracesHidingRenderer.render(undefined, this.preferencesModel.settingsGroups);
			this.editSettingActionRenderer.render(this.preferencesModel.settingsGroups, this._associatedPreferencesModel);
		}

		this.hiddenAreasRenderer.render();
	}

	focusPreference(s: ISetting): void {
		const setting = this.getSetting(s);
		if (setting) {
			this.settingsGroupTitleRenderer.showSetting(setting);
			this.settingHighlighter.highlight(setting, true);
		} else {
			this.settingHighlighter.clear(true);
		}
	}

	private getSetting(setting: ISetting): ISetting | undefined {
		const { key, overrideOf } = setting;
		if (overrideOf) {
			const setting = this.getSetting(overrideOf);
			return find(setting!.overrides!, override => override.key === key);
		}
		const settingsGroups = this.filterResult ? this.filterResult.filteredGroups : this.preferencesModel.settingsGroups;
		return this.getPreference(key, settingsGroups);
	}

	private getPreference(key: string, settingsGroups: ISettingsGroup[]): ISetting | undefined {
		for (const group of settingsGroups) {
			for (const section of group.sections) {
				for (const setting of section.settings) {
					if (setting.key === key) {
						return setting;
					}
				}
			}
		}
		return undefined;
	}

	clearFocus(setting: ISetting): void {
		this.settingHighlighter.clear(true);
	}

	updatePreference(key: string, value: any, source: ISetting): void {
	}

	editPreference(setting: ISetting): boolean {
		return this.editSettingActionRenderer.activateOnSetting(setting);
	}
}

export interface HiddenAreasProvider {
	hiddenAreas: IRange[];
}

export class BracesHidingRenderer extends Disposable implements HiddenAreasProvider {
	private _result: IFilterResult | undefined;
	private _settingsGroups!: ISettingsGroup[];

	constructor(private editor: ICodeEditor) {
		super();
	}

	render(result: IFilterResult | undefined, settingsGroups: ISettingsGroup[]): void {
		this._result = result;
		this._settingsGroups = settingsGroups;
	}

	get hiddenAreas(): IRange[] {
		// Opening square brace
		const hiddenAreas = [
			{
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: 2,
				endColumn: 1
			}
		];

		const hideBraces = (group: ISettingsGroup, hideExtraLine?: boolean) => {
			// Opening curly brace
			hiddenAreas.push({
				startLineNumber: group.range.startLineNumber - 3,
				startColumn: 1,
				endLineNumber: group.range.startLineNumber - (hideExtraLine ? 1 : 3),
				endColumn: 1
			});

			// Closing curly brace
			hiddenAreas.push({
				startLineNumber: group.range.endLineNumber + 1,
				startColumn: 1,
				endLineNumber: group.range.endLineNumber + 4,
				endColumn: 1
			});
		};

		this._settingsGroups.forEach(g => hideBraces(g));
		if (this._result) {
			this._result.filteredGroups.forEach((g, i) => hideBraces(g, true));
		}

		// Closing square brace
		const lineCount = this.editor.getModel()!.getLineCount();
		hiddenAreas.push({
			startLineNumber: lineCount,
			startColumn: 1,
			endLineNumber: lineCount,
			endColumn: 1
		});


		return hiddenAreas;
	}

}

class DefaultSettingsHeaderRenderer extends Disposable {

	private settingsHeaderWidget: DefaultSettingsHeaderWidget;
	readonly onClick: Event<void>;

	constructor(editor: ICodeEditor) {
		super();
		this.settingsHeaderWidget = this._register(new DefaultSettingsHeaderWidget(editor, ''));
		this.onClick = this.settingsHeaderWidget.onClick;
	}

	render(filterResult: IFilterResult | undefined) {
		const hasSettings = !filterResult || filterResult.filteredGroups.length > 0;
		this.settingsHeaderWidget.toggleMessage(hasSettings);
	}
}

export class SettingsGroupTitleRenderer extends Disposable implements HiddenAreasProvider {

	private readonly _onHiddenAreasChanged = this._register(new Emitter<void>());
	readonly onHiddenAreasChanged: Event<void> = this._onHiddenAreasChanged.event;

	private settingsGroups!: ISettingsGroup[];
	private hiddenGroups: ISettingsGroup[] = [];
	private settingsGroupTitleWidgets!: SettingsGroupTitleWidget[];
	private readonly renderDisposables = this._register(new DisposableStore());

	constructor(private editor: ICodeEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	get hiddenAreas(): IRange[] {
		const hiddenAreas: IRange[] = [];
		for (const group of this.hiddenGroups) {
			hiddenAreas.push(group.range);
		}
		return hiddenAreas;
	}

	render(settingsGroups: ISettingsGroup[] | undefined) {
		this.disposeWidgets();
		if (!settingsGroups) {
			return;
		}

		this.settingsGroups = settingsGroups.slice();
		this.settingsGroupTitleWidgets = [];
		for (const group of this.settingsGroups.slice().reverse()) {
			if (group.sections.every(sect => sect.settings.length === 0)) {
				continue;
			}

			const settingsGroupTitleWidget = this.instantiationService.createInstance(SettingsGroupTitleWidget, this.editor, group);
			settingsGroupTitleWidget.render();
			this.settingsGroupTitleWidgets.push(settingsGroupTitleWidget);
			this.renderDisposables.add(settingsGroupTitleWidget);
			this.renderDisposables.add(settingsGroupTitleWidget.onToggled(collapsed => this.onToggled(collapsed, settingsGroupTitleWidget.settingsGroup)));
		}
		this.settingsGroupTitleWidgets.reverse();
	}

	showGroup(groupIdx: number) {
		const shownGroup = this.settingsGroupTitleWidgets[groupIdx].settingsGroup;

		this.hiddenGroups = this.settingsGroups.filter(g => g !== shownGroup);
		for (const groupTitleWidget of this.settingsGroupTitleWidgets.filter(widget => widget.settingsGroup !== shownGroup)) {
			groupTitleWidget.toggleCollapse(true);
		}
		this._onHiddenAreasChanged.fire();
	}

	showSetting(setting: ISetting): void {
		const settingsGroupTitleWidget = this.settingsGroupTitleWidgets.filter(widget => Range.containsRange(widget.settingsGroup.range, setting.range))[0];
		if (settingsGroupTitleWidget && settingsGroupTitleWidget.isCollapsed()) {
			settingsGroupTitleWidget.toggleCollapse(false);
			this.hiddenGroups.splice(this.hiddenGroups.indexOf(settingsGroupTitleWidget.settingsGroup), 1);
			this._onHiddenAreasChanged.fire();
		}
	}

	private onToggled(collapsed: boolean, group: ISettingsGroup) {
		const index = this.hiddenGroups.indexOf(group);
		if (collapsed) {
			const currentPosition = this.editor.getPosition();
			if (group.range.startLineNumber <= currentPosition!.lineNumber && group.range.endLineNumber >= currentPosition!.lineNumber) {
				this.editor.setPosition({ lineNumber: group.range.startLineNumber - 1, column: 1 });
			}
			this.hiddenGroups.push(group);
		} else {
			this.hiddenGroups.splice(index, 1);
		}
		this._onHiddenAreasChanged.fire();
	}

	private disposeWidgets() {
		this.hiddenGroups = [];
		this.renderDisposables.clear();
	}

	dispose() {
		this.disposeWidgets();
		super.dispose();
	}
}

export class HiddenAreasRenderer extends Disposable {

	constructor(private editor: ICodeEditor, private hiddenAreasProviders: HiddenAreasProvider[]
	) {
		super();
	}

	render() {
		const ranges: IRange[] = [];
		for (const hiddenAreaProvider of this.hiddenAreasProviders) {
			ranges.push(...hiddenAreaProvider.hiddenAreas);
		}
		this.editor.setHiddenAreas(ranges);
	}

	dispose() {
		this.editor.setHiddenAreas([]);
		super.dispose();
	}
}

export class FilteredMatchesRenderer extends Disposable implements HiddenAreasProvider {

	private decorationIds: string[] = [];
	hiddenAreas: IRange[] = [];

	constructor(private editor: ICodeEditor
	) {
		super();
	}

	render(result: IFilterResult | undefined, allSettingsGroups: ISettingsGroup[]): void {
		this.hiddenAreas = [];
		if (result) {
			this.hiddenAreas = this.computeHiddenRanges(result.filteredGroups, result.allGroups);
			this.decorationIds = this.editor.deltaDecorations(this.decorationIds, result.matches.map(match => this.createDecoration(match)));
		} else {
			this.hiddenAreas = this.computeHiddenRanges(undefined, allSettingsGroups);
			this.decorationIds = this.editor.deltaDecorations(this.decorationIds, []);
		}
	}

	private createDecoration(range: IRange): IModelDeltaDecoration {
		return {
			range,
			options: FilteredMatchesRenderer._FIND_MATCH
		};
	}

	private static readonly _FIND_MATCH = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'findMatch'
	});

	private computeHiddenRanges(filteredGroups: ISettingsGroup[] | undefined, allSettingsGroups: ISettingsGroup[]): IRange[] {
		// Hide the contents of hidden groups
		const notMatchesRanges: IRange[] = [];
		if (filteredGroups) {
			allSettingsGroups.forEach((group, i) => {
				notMatchesRanges.push({
					startLineNumber: group.range.startLineNumber - 1,
					startColumn: group.range.startColumn,
					endLineNumber: group.range.endLineNumber,
					endColumn: group.range.endColumn
				});
			});
		}

		return notMatchesRanges;
	}

	dispose() {
		this.decorationIds = this.editor.deltaDecorations(this.decorationIds, []);
		super.dispose();
	}
}

export class HighlightMatchesRenderer extends Disposable {

	private decorationIds: string[] = [];

	constructor(private editor: ICodeEditor
	) {
		super();
	}

	render(matches: IRange[]): void {
		this.decorationIds = this.editor.deltaDecorations(this.decorationIds, matches.map(match => this.createDecoration(match)));
	}

	private static readonly _FIND_MATCH = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'findMatch'
	});

	private createDecoration(range: IRange): IModelDeltaDecoration {
		return {
			range,
			options: HighlightMatchesRenderer._FIND_MATCH
		};
	}

	dispose() {
		this.decorationIds = this.editor.deltaDecorations(this.decorationIds, []);
		super.dispose();
	}
}

export interface IIndexedSetting extends ISetting {
	index: number;
	groupId: string;
}

class EditSettingRenderer extends Disposable {

	private editPreferenceWidgetForCursorPosition: EditPreferenceWidget<IIndexedSetting>;
	private editPreferenceWidgetForMouseMove: EditPreferenceWidget<IIndexedSetting>;

	private settingsGroups: ISettingsGroup[] = [];
	associatedPreferencesModel!: IPreferencesEditorModel<ISetting>;
	private toggleEditPreferencesForMouseMoveDelayer: Delayer<void>;

	private readonly _onUpdateSetting: Emitter<{ key: string, value: any, source: IIndexedSetting }> = new Emitter<{ key: string, value: any, source: IIndexedSetting }>();
	readonly onUpdateSetting: Event<{ key: string, value: any, source: IIndexedSetting }> = this._onUpdateSetting.event;

	constructor(private editor: ICodeEditor, private primarySettingsModel: ISettingsEditorModel,
		private settingHighlighter: SettingHighlighter,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService
	) {
		super();

		this.editPreferenceWidgetForCursorPosition = <EditPreferenceWidget<IIndexedSetting>>this._register(this.instantiationService.createInstance(EditPreferenceWidget, editor));
		this.editPreferenceWidgetForMouseMove = <EditPreferenceWidget<IIndexedSetting>>this._register(this.instantiationService.createInstance(EditPreferenceWidget, editor));
		this.toggleEditPreferencesForMouseMoveDelayer = new Delayer<void>(75);

		this._register(this.editPreferenceWidgetForCursorPosition.onClick(e => this.onEditSettingClicked(this.editPreferenceWidgetForCursorPosition, e)));
		this._register(this.editPreferenceWidgetForMouseMove.onClick(e => this.onEditSettingClicked(this.editPreferenceWidgetForMouseMove, e)));

		this._register(this.editor.onDidChangeCursorPosition(positionChangeEvent => this.onPositionChanged(positionChangeEvent)));
		this._register(this.editor.onMouseMove(mouseMoveEvent => this.onMouseMoved(mouseMoveEvent)));
		this._register(this.editor.onDidChangeConfiguration(() => this.onConfigurationChanged()));
	}

	render(settingsGroups: ISettingsGroup[], associatedPreferencesModel: IPreferencesEditorModel<ISetting>): void {
		this.editPreferenceWidgetForCursorPosition.hide();
		this.editPreferenceWidgetForMouseMove.hide();
		this.settingsGroups = settingsGroups;
		this.associatedPreferencesModel = associatedPreferencesModel;

		const settings = this.getSettings(this.editor.getPosition()!.lineNumber);
		if (settings.length) {
			this.showEditPreferencesWidget(this.editPreferenceWidgetForCursorPosition, settings);
		}
	}

	private isDefaultSettings(): boolean {
		return this.primarySettingsModel instanceof DefaultSettingsEditorModel;
	}

	private onConfigurationChanged(): void {
		if (!this.editor.getOption(EditorOption.glyphMargin)) {
			this.editPreferenceWidgetForCursorPosition.hide();
			this.editPreferenceWidgetForMouseMove.hide();
		}
	}

	private onPositionChanged(positionChangeEvent: ICursorPositionChangedEvent) {
		this.editPreferenceWidgetForMouseMove.hide();
		const settings = this.getSettings(positionChangeEvent.position.lineNumber);
		if (settings.length) {
			this.showEditPreferencesWidget(this.editPreferenceWidgetForCursorPosition, settings);
		} else {
			this.editPreferenceWidgetForCursorPosition.hide();
		}
	}

	private onMouseMoved(mouseMoveEvent: IEditorMouseEvent): void {
		const editPreferenceWidget = this.getEditPreferenceWidgetUnderMouse(mouseMoveEvent);
		if (editPreferenceWidget) {
			this.onMouseOver(editPreferenceWidget);
			return;
		}
		this.settingHighlighter.clear();
		this.toggleEditPreferencesForMouseMoveDelayer.trigger(() => this.toggleEditPreferenceWidgetForMouseMove(mouseMoveEvent));
	}

	private getEditPreferenceWidgetUnderMouse(mouseMoveEvent: IEditorMouseEvent): EditPreferenceWidget<ISetting> | undefined {
		if (mouseMoveEvent.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN) {
			const line = mouseMoveEvent.target.position!.lineNumber;
			if (this.editPreferenceWidgetForMouseMove.getLine() === line && this.editPreferenceWidgetForMouseMove.isVisible()) {
				return this.editPreferenceWidgetForMouseMove;
			}
			if (this.editPreferenceWidgetForCursorPosition.getLine() === line && this.editPreferenceWidgetForCursorPosition.isVisible()) {
				return this.editPreferenceWidgetForCursorPosition;
			}
		}
		return undefined;
	}

	private toggleEditPreferenceWidgetForMouseMove(mouseMoveEvent: IEditorMouseEvent): void {
		const settings = mouseMoveEvent.target.position ? this.getSettings(mouseMoveEvent.target.position.lineNumber) : null;
		if (settings && settings.length) {
			this.showEditPreferencesWidget(this.editPreferenceWidgetForMouseMove, settings);
		} else {
			this.editPreferenceWidgetForMouseMove.hide();
		}
	}

	private showEditPreferencesWidget(editPreferencesWidget: EditPreferenceWidget<ISetting>, settings: IIndexedSetting[]) {
		const line = settings[0].valueRange.startLineNumber;
		if (this.editor.getOption(EditorOption.glyphMargin) && this.marginFreeFromOtherDecorations(line)) {
			editPreferencesWidget.show(line, nls.localize('editTtile', "Edit"), settings);
			const editPreferenceWidgetToHide = editPreferencesWidget === this.editPreferenceWidgetForCursorPosition ? this.editPreferenceWidgetForMouseMove : this.editPreferenceWidgetForCursorPosition;
			editPreferenceWidgetToHide.hide();
		}
	}

	private marginFreeFromOtherDecorations(line: number): boolean {
		const decorations = this.editor.getLineDecorations(line);
		if (decorations) {
			for (const { options } of decorations) {
				if (options.glyphMarginClassName && options.glyphMarginClassName.indexOf(preferencesEditIcon.classNames) === -1) {
					return false;
				}
			}
		}
		return true;
	}

	private getSettings(lineNumber: number): IIndexedSetting[] {
		const configurationMap = this.getConfigurationsMap();
		return this.getSettingsAtLineNumber(lineNumber).filter(setting => {
			const configurationNode = configurationMap[setting.key];
			if (configurationNode) {
				if (this.isDefaultSettings()) {
					if (setting.key === 'launch') {
						// Do not show because of https://github.com/Microsoft/vscode/issues/32593
						return false;
					}
					return true;
				}
				if (configurationNode.type === 'boolean' || configurationNode.enum) {
					if ((<SettingsEditorModel>this.primarySettingsModel).configurationTarget !== ConfigurationTarget.WORKSPACE_FOLDER) {
						return true;
					}
					if (configurationNode.scope === ConfigurationScope.RESOURCE || configurationNode.scope === ConfigurationScope.LANGUAGE_OVERRIDABLE) {
						return true;
					}
				}
			}
			return false;
		});
	}

	private getSettingsAtLineNumber(lineNumber: number): IIndexedSetting[] {
		// index of setting, across all groups/sections
		let index = 0;

		const settings: IIndexedSetting[] = [];
		for (const group of this.settingsGroups) {
			if (group.range.startLineNumber > lineNumber) {
				break;
			}
			if (lineNumber >= group.range.startLineNumber && lineNumber <= group.range.endLineNumber) {
				for (const section of group.sections) {
					for (const setting of section.settings) {
						if (setting.range.startLineNumber > lineNumber) {
							break;
						}
						if (lineNumber >= setting.range.startLineNumber && lineNumber <= setting.range.endLineNumber) {
							if (!this.isDefaultSettings() && setting.overrides!.length) {
								// Only one level because override settings cannot have override settings
								for (const overrideSetting of setting.overrides!) {
									if (lineNumber >= overrideSetting.range.startLineNumber && lineNumber <= overrideSetting.range.endLineNumber) {
										settings.push({ ...overrideSetting, index, groupId: group.id });
									}
								}
							} else {
								settings.push({ ...setting, index, groupId: group.id });
							}
						}

						index++;
					}
				}
			}
		}
		return settings;
	}

	private onMouseOver(editPreferenceWidget: EditPreferenceWidget<ISetting>): void {
		this.settingHighlighter.highlight(editPreferenceWidget.preferences[0]);
	}

	private onEditSettingClicked(editPreferenceWidget: EditPreferenceWidget<IIndexedSetting>, e: IEditorMouseEvent): void {
		EventHelper.stop(e.event, true);

		const anchor = { x: e.event.posx, y: e.event.posy + 10 };
		const actions = this.getSettings(editPreferenceWidget.getLine()).length === 1 ? this.getActions(editPreferenceWidget.preferences[0], this.getConfigurationsMap()[editPreferenceWidget.preferences[0].key])
			: editPreferenceWidget.preferences.map(setting => new SubmenuAction(`preferences.submenu.${setting.key}`, setting.key, this.getActions(setting, this.getConfigurationsMap()[setting.key])));
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions
		});
	}

	activateOnSetting(setting: ISetting): boolean {
		const startLine = setting.keyRange.startLineNumber;
		const settings = this.getSettings(startLine);
		if (!settings.length) {
			return false;
		}

		this.editPreferenceWidgetForMouseMove.show(startLine, '', settings);
		const actions = this.getActions(this.editPreferenceWidgetForMouseMove.preferences[0], this.getConfigurationsMap()[this.editPreferenceWidgetForMouseMove.preferences[0].key]);
		this.contextMenuService.showContextMenu({
			getAnchor: () => this.toAbsoluteCoords(new Position(startLine, 1)),
			getActions: () => actions
		});

		return true;
	}

	private toAbsoluteCoords(position: Position): { x: number, y: number } {
		const positionCoords = this.editor.getScrolledVisiblePosition(position);
		const editorCoords = getDomNodePagePosition(this.editor.getDomNode()!);
		const x = editorCoords.left + positionCoords!.left;
		const y = editorCoords.top + positionCoords!.top + positionCoords!.height;

		return { x, y: y + 10 };
	}

	private getConfigurationsMap(): { [qualifiedKey: string]: IConfigurationPropertySchema } {
		return Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
	}

	private getActions(setting: IIndexedSetting, jsonSchema: IJSONSchema): IAction[] {
		if (jsonSchema.type === 'boolean') {
			return [<IAction>{
				id: 'truthyValue',
				label: 'true',
				enabled: true,
				run: () => this.updateSetting(setting.key, true, setting)
			}, <IAction>{
				id: 'falsyValue',
				label: 'false',
				enabled: true,
				run: () => this.updateSetting(setting.key, false, setting)
			}];
		}
		if (jsonSchema.enum) {
			return jsonSchema.enum.map(value => {
				return <IAction>{
					id: value,
					label: JSON.stringify(value),
					enabled: true,
					run: () => this.updateSetting(setting.key, value, setting)
				};
			});
		}
		return this.getDefaultActions(setting);
	}

	private getDefaultActions(setting: IIndexedSetting): IAction[] {
		if (this.isDefaultSettings()) {
			const settingInOtherModel = this.associatedPreferencesModel.getPreference(setting.key);
			return [<IAction>{
				id: 'setDefaultValue',
				label: settingInOtherModel ? nls.localize('replaceDefaultValue', "Replace in Settings") : nls.localize('copyDefaultValue', "Copy to Settings"),
				enabled: true,
				run: () => this.updateSetting(setting.key, setting.value, setting)
			}];
		}
		return [];
	}

	private updateSetting(key: string, value: any, source: IIndexedSetting): void {
		this._onUpdateSetting.fire({ key, value, source });
	}
}

class SettingHighlighter extends Disposable {

	private fixedHighlighter: RangeHighlightDecorations;
	private volatileHighlighter: RangeHighlightDecorations;
	private highlightedSetting!: ISetting;

	constructor(private editor: ICodeEditor, private readonly focusEventEmitter: Emitter<ISetting>, private readonly clearFocusEventEmitter: Emitter<ISetting>,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.fixedHighlighter = this._register(instantiationService.createInstance(RangeHighlightDecorations));
		this.volatileHighlighter = this._register(instantiationService.createInstance(RangeHighlightDecorations));
		this.fixedHighlighter.onHighlightRemoved(() => this.clearFocusEventEmitter.fire(this.highlightedSetting));
		this.volatileHighlighter.onHighlightRemoved(() => this.clearFocusEventEmitter.fire(this.highlightedSetting));
	}

	highlight(setting: ISetting, fix: boolean = false) {
		this.highlightedSetting = setting;
		this.volatileHighlighter.removeHighlightRange();
		this.fixedHighlighter.removeHighlightRange();

		const highlighter = fix ? this.fixedHighlighter : this.volatileHighlighter;
		highlighter.highlightRange({
			range: setting.valueRange,
			resource: this.editor.getModel()!.uri
		}, this.editor);

		this.editor.revealLineInCenterIfOutsideViewport(setting.valueRange.startLineNumber, editorCommon.ScrollType.Smooth);
		this.focusEventEmitter.fire(setting);
	}

	clear(fix: boolean = false): void {
		this.volatileHighlighter.removeHighlightRange();
		if (fix) {
			this.fixedHighlighter.removeHighlightRange();
		}
		this.clearFocusEventEmitter.fire(this.highlightedSetting);
	}
}

class UnsupportedSettingsRenderer extends Disposable {

	private renderingDelayer: Delayer<void> = new Delayer<void>(200);

	constructor(
		private editor: ICodeEditor,
		private settingsEditorModel: SettingsEditorModel,
		@IMarkerService private markerService: IMarkerService,
		@IWorkbenchEnvironmentService private workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IConfigurationService private configurationService: IConfigurationService,
	) {
		super();
		this._register(this.editor.getModel()!.onDidChangeContent(() => this.delayedRender()));
		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.source === ConfigurationTarget.DEFAULT)(() => this.delayedRender()));
	}

	private delayedRender(): void {
		this.renderingDelayer.trigger(() => this.render());
	}

	public render(): void {
		const markerData: IMarkerData[] = this.generateMarkerData();
		if (markerData.length) {
			this.markerService.changeOne('UnsupportedSettingsRenderer', this.settingsEditorModel.uri, markerData);
		} else {
			this.markerService.remove('UnsupportedSettingsRenderer', [this.settingsEditorModel.uri]);
		}
	}

	private generateMarkerData(): IMarkerData[] {
		const markerData: IMarkerData[] = [];
		const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		for (const settingsGroup of this.settingsEditorModel.settingsGroups) {
			for (const section of settingsGroup.sections) {
				for (const setting of section.settings) {
					const configuration = configurationRegistry[setting.key];
					if (configuration) {
						switch (this.settingsEditorModel.configurationTarget) {
							case ConfigurationTarget.USER_LOCAL:
								this.handleLocalUserConfiguration(setting, configuration, markerData);
								break;
							case ConfigurationTarget.USER_REMOTE:
								this.handleRemoteUserConfiguration(setting, configuration, markerData);
								break;
							case ConfigurationTarget.WORKSPACE:
								this.handleWorkspaceConfiguration(setting, configuration, markerData);
								break;
							case ConfigurationTarget.WORKSPACE_FOLDER:
								this.handleWorkspaceFolderConfiguration(setting, configuration, markerData);
								break;
						}
					} else if (!OVERRIDE_PROPERTY_PATTERN.test(setting.key)) { // Ignore override settings (language specific settings)
						markerData.push({
							severity: MarkerSeverity.Hint,
							tags: [MarkerTag.Unnecessary],
							...setting.range,
							message: nls.localize('unknown configuration setting', "Unknown Configuration Setting")
						});
					}
				}
			}
		}
		return markerData;
	}

	private handleLocalUserConfiguration(setting: ISetting, configuration: IConfigurationNode, markerData: IMarkerData[]): void {
		if (this.workbenchEnvironmentService.configuration.remoteAuthority && (configuration.scope === ConfigurationScope.MACHINE || configuration.scope === ConfigurationScope.MACHINE_OVERRIDABLE)) {
			markerData.push({
				severity: MarkerSeverity.Hint,
				tags: [MarkerTag.Unnecessary],
				...setting.range,
				message: nls.localize('unsupportedRemoteMachineSetting', "This setting cannot be applied in this window. It will be applied when you open local window.")
			});
		}
	}

	private handleRemoteUserConfiguration(setting: ISetting, configuration: IConfigurationNode, markerData: IMarkerData[]): void {
		if (configuration.scope === ConfigurationScope.APPLICATION) {
			markerData.push(this.generateUnsupportedApplicationSettingMarker(setting));
		}
	}

	private handleWorkspaceConfiguration(setting: ISetting, configuration: IConfigurationNode, markerData: IMarkerData[]): void {
		if (configuration.scope === ConfigurationScope.APPLICATION) {
			markerData.push(this.generateUnsupportedApplicationSettingMarker(setting));
		}

		if (configuration.scope === ConfigurationScope.MACHINE) {
			markerData.push(this.generateUnsupportedMachineSettingMarker(setting));
		}
	}

	private handleWorkspaceFolderConfiguration(setting: ISetting, configuration: IConfigurationNode, markerData: IMarkerData[]): void {
		if (configuration.scope === ConfigurationScope.APPLICATION) {
			markerData.push(this.generateUnsupportedApplicationSettingMarker(setting));
		}

		if (configuration.scope === ConfigurationScope.MACHINE) {
			markerData.push(this.generateUnsupportedMachineSettingMarker(setting));
		}

		if (configuration.scope === ConfigurationScope.WINDOW) {
			markerData.push({
				severity: MarkerSeverity.Hint,
				tags: [MarkerTag.Unnecessary],
				...setting.range,
				message: nls.localize('unsupportedWindowSetting', "This setting cannot be applied in this workspace. It will be applied when you open the containing workspace folder directly.")
			});
		}
	}

	private generateUnsupportedApplicationSettingMarker(setting: ISetting): IMarkerData {
		return {
			severity: MarkerSeverity.Hint,
			tags: [MarkerTag.Unnecessary],
			...setting.range,
			message: nls.localize('unsupportedApplicationSetting', "This setting can be applied only in application user settings")
		};
	}

	private generateUnsupportedMachineSettingMarker(setting: ISetting): IMarkerData {
		return {
			severity: MarkerSeverity.Hint,
			tags: [MarkerTag.Unnecessary],
			...setting.range,
			message: nls.localize('unsupportedMachineSetting', "This setting can only be applied in user settings in local window or in remote settings in remote window.")
		};
	}

	public dispose(): void {
		this.markerService.remove('UnsupportedSettingsRenderer', [this.settingsEditorModel.uri]);
		super.dispose();
	}

}

class WorkspaceConfigurationRenderer extends Disposable {

	private decorationIds: string[] = [];
	private associatedSettingsEditorModel!: IPreferencesEditorModel<ISetting>;
	private renderingDelayer: Delayer<void> = new Delayer<void>(200);

	constructor(private editor: ICodeEditor, private workspaceSettingsEditorModel: SettingsEditorModel,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IMarkerService private readonly markerService: IMarkerService
	) {
		super();
		this._register(this.editor.getModel()!.onDidChangeContent(() => this.renderingDelayer.trigger(() => this.render(this.associatedSettingsEditorModel))));
	}

	render(associatedSettingsEditorModel: IPreferencesEditorModel<ISetting>): void {
		this.associatedSettingsEditorModel = associatedSettingsEditorModel;
		const markerData: IMarkerData[] = [];
		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE && this.workspaceSettingsEditorModel instanceof WorkspaceConfigurationEditorModel) {
			const ranges: IRange[] = [];
			for (const settingsGroup of this.workspaceSettingsEditorModel.configurationGroups) {
				for (const section of settingsGroup.sections) {
					for (const setting of section.settings) {
						if (setting.key === 'folders' || setting.key === 'tasks' || setting.key === 'launch' || setting.key === 'extensions') {
							if (this.associatedSettingsEditorModel) {
								// Dim other configurations in workspace configuration file only in the context of Settings Editor
								ranges.push({
									startLineNumber: setting.keyRange.startLineNumber,
									startColumn: setting.keyRange.startColumn - 1,
									endLineNumber: setting.valueRange.endLineNumber,
									endColumn: setting.valueRange.endColumn
								});
							}
						} else if (setting.key !== 'settings') {
							markerData.push({
								severity: MarkerSeverity.Hint,
								tags: [MarkerTag.Unnecessary],
								...setting.range,
								message: nls.localize('unsupportedProperty', "Unsupported Property")
							});
						}
					}
				}
			}
			this.decorationIds = this.editor.deltaDecorations(this.decorationIds, ranges.map(range => this.createDecoration(range)));
		}
		if (markerData.length) {
			this.markerService.changeOne('WorkspaceConfigurationRenderer', this.workspaceSettingsEditorModel.uri, markerData);
		} else {
			this.markerService.remove('WorkspaceConfigurationRenderer', [this.workspaceSettingsEditorModel.uri]);
		}
	}

	private static readonly _DIM_CONFIGURATION_ = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		inlineClassName: 'dim-configuration'
	});

	private createDecoration(range: IRange): IModelDeltaDecoration {
		return {
			range,
			options: WorkspaceConfigurationRenderer._DIM_CONFIGURATION_
		};
	}

	dispose(): void {
		this.markerService.remove('WorkspaceConfigurationRenderer', [this.workspaceSettingsEditorModel.uri]);
		this.decorationIds = this.editor.deltaDecorations(this.decorationIds, []);
		super.dispose();
	}
}
