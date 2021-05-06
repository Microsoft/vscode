/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./standaloneQuickInput';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition, OverlayWidgetPositionPreference } from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IQuickInputService, IQuickInputButton, IQuickPickItem, IQuickPick, IInputBox, IQuickNavigateConfiguration, IPickOptions, QuickPickInput, IInputOptions } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { QuickInputController } from 'vs/base/parts/quickinput/browser/quickInput';
import { QuickInputService, IQuickInputControllerHost } from 'vs/platform/quickinput/browser/quickInput';
import { once } from 'vs/base/common/functional';
import { IQuickAccessController } from 'vs/platform/quickinput/common/quickAccess';

export class EditorScopedQuickInputServiceImpl extends QuickInputService {

	private host: IQuickInputControllerHost | undefined = undefined;

	constructor(
		editor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@ILayoutService layoutService: ILayoutService
	) {
		super(instantiationService, contextKeyService, themeService, accessibilityService, layoutService);

		// Use the passed in code editor as host for the quick input widget
		const contribution = QuickInputEditorContribution.get(editor);
		this.host = {
			_serviceBrand: undefined,
			get container() { return contribution.widget.getDomNode(); },
			get dimension() { return editor.getLayoutInfo(); },
			get onDidLayout() { return editor.onDidLayoutChange; },
			focus: () => editor.focus()
		};
	}

	protected override createController(): QuickInputController {
		return super.createController(this.host);
	}
}

export class StandaloneQuickInputServiceImpl implements IQuickInputService {

	declare readonly _serviceBrand: undefined;

	private mapEditorToService = new Map<ICodeEditor, EditorScopedQuickInputServiceImpl>();
	private get activeService(): IQuickInputService {
		const editor = this.codeEditorService.getFocusedCodeEditor();
		if (!editor) {
			throw new Error('Quick input service needs a focused editor to work.');
		}

		// Find the quick input implementation for the focused
		// editor or create it lazily if not yet created
		let quickInputService = this.mapEditorToService.get(editor);
		if (!quickInputService) {
			const newQuickInputService = quickInputService = this.instantiationService.createInstance(EditorScopedQuickInputServiceImpl, editor);
			this.mapEditorToService.set(editor, quickInputService);

			once(editor.onDidDispose)(() => {
				newQuickInputService.dispose();
				this.mapEditorToService.delete(editor);
			});
		}

		return quickInputService;
	}

	get quickAccess(): IQuickAccessController { return this.activeService.quickAccess; }

	get backButton(): IQuickInputButton { return this.activeService.backButton; }

	get onShow() { return this.activeService.onShow; }
	get onHide() { return this.activeService.onHide; }

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService
	) {
	}

	pick<T extends IQuickPickItem, O extends IPickOptions<T>>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options: O = <O>{}, token: CancellationToken = CancellationToken.None): Promise<(O extends { canPickMany: true } ? T[] : T) | undefined> {
		return (this.activeService as unknown as QuickInputController /* TS fail */).pick(picks, options, token);
	}

	input(options?: IInputOptions | undefined, token?: CancellationToken | undefined): Promise<string | undefined> {
		return this.activeService.input(options, token);
	}

	createQuickPick<T extends IQuickPickItem>(): IQuickPick<T> {
		return this.activeService.createQuickPick();
	}

	createInputBox(): IInputBox {
		return this.activeService.createInputBox();
	}

	focus(): void {
		return this.activeService.focus();
	}

	toggle(): void {
		return this.activeService.toggle();
	}

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration | undefined): void {
		return this.activeService.navigate(next, quickNavigate);
	}

	accept(): Promise<void> {
		return this.activeService.accept();
	}

	back(): Promise<void> {
		return this.activeService.back();
	}

	cancel(): Promise<void> {
		return this.activeService.cancel();
	}
}

export class QuickInputEditorContribution implements IEditorContribution {

	static readonly ID = 'editor.controller.quickInput';

	static get(editor: ICodeEditor): QuickInputEditorContribution {
		return editor.getContribution<QuickInputEditorContribution>(QuickInputEditorContribution.ID);
	}

	readonly widget = new QuickInputEditorWidget(this.editor);

	constructor(private editor: ICodeEditor) { }

	dispose(): void {
		this.widget.dispose();
	}
}

export class QuickInputEditorWidget implements IOverlayWidget {

	private static readonly ID = 'editor.contrib.quickInputWidget';

	private domNode: HTMLElement;

	constructor(private codeEditor: ICodeEditor) {
		this.domNode = document.createElement('div');

		this.codeEditor.addOverlayWidget(this);
	}

	getId(): string {
		return QuickInputEditorWidget.ID;
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		return { preference: OverlayWidgetPositionPreference.TOP_CENTER };
	}

	dispose(): void {
		this.codeEditor.removeOverlayWidget(this);
	}
}

registerEditorContribution(QuickInputEditorContribution.ID, QuickInputEditorContribution);
