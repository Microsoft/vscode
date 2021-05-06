/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, registerEditorAction, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { DocumentRangeFormattingEditProviderRegistry, DocumentFormattingEditProvider, DocumentRangeFormattingEditProvider } from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { formatDocumentRangesWithProvider, formatDocumentWithProvider, getRealAndSyntheticDocumentFormattersOrdered, FormattingConflicts, FormattingMode } from 'vs/editor/contrib/format/format';
import { Range } from 'vs/editor/common/core/range';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IExtensionService, toExtension } from 'vs/workbench/services/extensions/common/extensions';
import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITextModel } from 'vs/editor/common/model';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ILabelService } from 'vs/platform/label/common/label';
import { IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { editorConfigurationBaseNode } from 'vs/editor/common/config/commonEditorConfig';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';

type FormattingEditProvider = DocumentFormattingEditProvider | DocumentRangeFormattingEditProvider;

class DefaultFormatter extends Disposable implements IWorkbenchContribution {

	static readonly configName = 'editor.defaultFormatter';

	static extensionIds: (string | null)[] = [];
	static extensionItemLabels: string[] = [];
	static extensionDescriptions: string[] = [];

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IWorkbenchExtensionEnablementService private readonly _extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IModeService private readonly _modeService: IModeService,
		@ILabelService private readonly _labelService: ILabelService,
	) {
		super();
		this._register(this._extensionService.onDidChangeExtensions(this._updateConfigValues, this));
		this._register(FormattingConflicts.setFormatterSelector((formatter, document, mode) => this._selectFormatter(formatter, document, mode)));
		this._updateConfigValues();
	}

	private async _updateConfigValues(): Promise<void> {
		let extensions = await this._extensionService.getExtensions();

		extensions = extensions.sort((a, b) => {
			let boostA = a.categories?.find(cat => cat === 'Formatters' || cat === 'Programming Languages');
			let boostB = b.categories?.find(cat => cat === 'Formatters' || cat === 'Programming Languages');

			if (boostA && !boostB) {
				return -1;
			} else if (!boostA && boostB) {
				return 1;
			} else {
				return a.name.localeCompare(b.name);
			}
		});

		DefaultFormatter.extensionIds.length = 0;
		DefaultFormatter.extensionItemLabels.length = 0;
		DefaultFormatter.extensionDescriptions.length = 0;

		DefaultFormatter.extensionIds.push(null);
		DefaultFormatter.extensionItemLabels.push(nls.localize('null', 'None'));
		DefaultFormatter.extensionDescriptions.push(nls.localize('nullFormatterDescription', "None"));

		for (const extension of extensions) {
			if (extension.main || extension.browser) {
				DefaultFormatter.extensionIds.push(extension.identifier.value);
				DefaultFormatter.extensionItemLabels.push(extension.displayName ?? '');
				DefaultFormatter.extensionDescriptions.push(extension.description ?? '');
			}
		}
	}

	static _maybeQuotes(s: string): string {
		return s.match(/\s/) ? `'${s}'` : s;
	}

	private async _selectFormatter<T extends FormattingEditProvider>(formatter: T[], document: ITextModel, mode: FormattingMode): Promise<T | undefined> {

		const defaultFormatterId = this._configService.getValue<string>(DefaultFormatter.configName, {
			resource: document.uri,
			overrideIdentifier: document.getModeId()
		});

		if (defaultFormatterId) {
			// good -> formatter configured
			const defaultFormatter = formatter.find(formatter => ExtensionIdentifier.equals(formatter.extensionId, defaultFormatterId));
			if (defaultFormatter) {
				// formatter available
				return defaultFormatter;
			}

			// bad -> formatter gone
			const extension = await this._extensionService.getExtension(defaultFormatterId);
			if (extension && this._extensionEnablementService.isEnabled(toExtension(extension))) {
				// formatter does not target this file
				const label = this._labelService.getUriLabel(document.uri, { relative: true });
				const message = nls.localize('miss', "Extension '{0}' cannot format '{1}'", extension.displayName || extension.name, label);
				this._notificationService.status(message, { hideAfter: 4000 });
				return undefined;
			}
		} else if (formatter.length === 1) {
			// ok -> nothing configured but only one formatter available
			return formatter[0];
		}

		const langName = this._modeService.getLanguageName(document.getModeId()) || document.getModeId();
		const message = !defaultFormatterId
			? nls.localize('config.needed', "There are multiple formatters for '{0}' files. Select a default formatter to continue.", DefaultFormatter._maybeQuotes(langName))
			: nls.localize('config.bad', "Extension '{0}' is configured as formatter but not available. Select a different default formatter to continue.", defaultFormatterId);

		if (mode !== FormattingMode.Silent) {
			// running from a user action -> show modal dialog so that users configure
			// a default formatter
			const result = await this._dialogService.confirm({
				message,
				primaryButton: nls.localize('do.config', "Configure..."),
				secondaryButton: nls.localize('cancel', "Cancel")
			});
			if (result.confirmed) {
				return this._pickAndPersistDefaultFormatter(formatter, document);
			}

		} else {
			// no user action -> show a silent notification and proceed
			this._notificationService.prompt(
				Severity.Info,
				message,
				[{ label: nls.localize('do.config', "Configure..."), run: () => this._pickAndPersistDefaultFormatter(formatter, document) }],
				{ silent: true }
			);
		}
		return undefined;
	}

	private async _pickAndPersistDefaultFormatter<T extends FormattingEditProvider>(formatter: T[], document: ITextModel): Promise<T | undefined> {
		const picks = formatter.map((formatter, index): IIndexedPick => {
			return {
				index,
				label: formatter.displayName || (formatter.extensionId ? formatter.extensionId.value : '?'),
				description: formatter.extensionId && formatter.extensionId.value
			};
		});
		const langName = this._modeService.getLanguageName(document.getModeId()) || document.getModeId();
		const pick = await this._quickInputService.pick(picks, { placeHolder: nls.localize('select', "Select a default formatter for '{0}' files", DefaultFormatter._maybeQuotes(langName)) });
		if (!pick || !formatter[pick.index].extensionId) {
			return undefined;
		}
		this._configService.updateValue(DefaultFormatter.configName, formatter[pick.index].extensionId!.value, {
			resource: document.uri,
			overrideIdentifier: document.getModeId()
		});
		return formatter[pick.index];
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	DefaultFormatter,
	LifecyclePhase.Restored
);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...editorConfigurationBaseNode,
	properties: {
		[DefaultFormatter.configName]: {
			description: nls.localize('formatter.default', "Defines a default formatter which takes precedence over all other formatter settings. Must be the identifier of an extension contributing a formatter."),
			type: ['string', 'null'],
			default: null,
			enum: DefaultFormatter.extensionIds,
			enumItemLabels: DefaultFormatter.extensionItemLabels,
			markdownEnumDescriptions: DefaultFormatter.extensionDescriptions
		}
	}
});

interface IIndexedPick extends IQuickPickItem {
	index: number;
}

function logFormatterTelemetry<T extends { extensionId?: ExtensionIdentifier }>(telemetryService: ITelemetryService, mode: 'document' | 'range', options: T[], pick?: T) {

	function extKey(obj: T): string {
		return obj.extensionId ? ExtensionIdentifier.toKey(obj.extensionId) : 'unknown';
	}
	/*
	 * __GDPR__
		"formatterpick" : {
			"mode" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
			"extensions" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
			"pick" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		}
	 */
	telemetryService.publicLog('formatterpick', {
		mode,
		extensions: options.map(extKey),
		pick: pick ? extKey(pick) : 'none'
	});
}

async function showFormatterPick(accessor: ServicesAccessor, model: ITextModel, formatters: FormattingEditProvider[]): Promise<number | undefined> {
	const quickPickService = accessor.get(IQuickInputService);
	const configService = accessor.get(IConfigurationService);
	const modeService = accessor.get(IModeService);

	const overrides = { resource: model.uri, overrideIdentifier: model.getModeId() };
	const defaultFormatter = configService.getValue<string>(DefaultFormatter.configName, overrides);

	let defaultFormatterPick: IIndexedPick | undefined;

	const picks = formatters.map((provider, index) => {
		const isDefault = ExtensionIdentifier.equals(provider.extensionId, defaultFormatter);
		const pick: IIndexedPick = {
			index,
			label: provider.displayName || '',
			description: isDefault ? nls.localize('def', "(default)") : undefined,
		};

		if (isDefault) {
			// autofocus default pick
			defaultFormatterPick = pick;
		}

		return pick;
	});

	const configurePick: IQuickPickItem = {
		label: nls.localize('config', "Configure Default Formatter...")
	};

	const pick = await quickPickService.pick([...picks, { type: 'separator' }, configurePick],
		{
			placeHolder: nls.localize('format.placeHolder', "Select a formatter"),
			activeItem: defaultFormatterPick
		}
	);
	if (!pick) {
		// dismissed
		return undefined;

	} else if (pick === configurePick) {
		// config default
		const langName = modeService.getLanguageName(model.getModeId()) || model.getModeId();
		const pick = await quickPickService.pick(picks, { placeHolder: nls.localize('select', "Select a default formatter for '{0}' files", DefaultFormatter._maybeQuotes(langName)) });
		if (pick && formatters[pick.index].extensionId) {
			configService.updateValue(DefaultFormatter.configName, formatters[pick.index].extensionId!.value, overrides);
		}
		return undefined;

	} else {
		// picked one
		return (<IIndexedPick>pick).index;
	}

}

registerEditorAction(class FormatDocumentMultipleAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.formatDocument.multiple',
			label: nls.localize('formatDocument.label.multiple', "Format Document With..."),
			alias: 'Format Document...',
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasMultipleDocumentFormattingProvider),
			contextMenuOpts: {
				group: '1_modification',
				order: 1.3
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}
		const instaService = accessor.get(IInstantiationService);
		const telemetryService = accessor.get(ITelemetryService);
		const model = editor.getModel();
		const provider = getRealAndSyntheticDocumentFormattersOrdered(model);
		const pick = await instaService.invokeFunction(showFormatterPick, model, provider);
		if (typeof pick === 'number') {
			await instaService.invokeFunction(formatDocumentWithProvider, provider[pick], editor, FormattingMode.Explicit, CancellationToken.None);
		}
		logFormatterTelemetry(telemetryService, 'document', provider, typeof pick === 'number' && provider[pick] || undefined);
	}
});

registerEditorAction(class FormatSelectionMultipleAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.formatSelection.multiple',
			label: nls.localize('formatSelection.label.multiple', "Format Selection With..."),
			alias: 'Format Code...',
			precondition: ContextKeyExpr.and(ContextKeyExpr.and(EditorContextKeys.writable), EditorContextKeys.hasMultipleDocumentSelectionFormattingProvider),
			contextMenuOpts: {
				when: ContextKeyExpr.and(EditorContextKeys.hasNonEmptySelection),
				group: '1_modification',
				order: 1.31
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}
		const instaService = accessor.get(IInstantiationService);
		const telemetryService = accessor.get(ITelemetryService);

		const model = editor.getModel();
		let range: Range = editor.getSelection();
		if (range.isEmpty()) {
			range = new Range(range.startLineNumber, 1, range.startLineNumber, model.getLineMaxColumn(range.startLineNumber));
		}

		const provider = DocumentRangeFormattingEditProviderRegistry.ordered(model);
		const pick = await instaService.invokeFunction(showFormatterPick, model, provider);
		if (typeof pick === 'number') {
			await instaService.invokeFunction(formatDocumentRangesWithProvider, provider[pick], editor, range, CancellationToken.None);
		}

		logFormatterTelemetry(telemetryService, 'range', provider, typeof pick === 'number' && provider[pick] || undefined);
	}
});
