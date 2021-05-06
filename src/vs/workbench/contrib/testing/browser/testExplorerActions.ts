/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { flatten } from 'vs/base/common/arrays';
import { Codicon } from 'vs/base/common/codicons';
import { Iterable } from 'vs/base/common/iterator';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { isDefined } from 'vs/base/common/types';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { Range } from 'vs/editor/common/core/range';
import { localize } from 'vs/nls';
import { Action2, MenuId } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ContextKeyAndExpr, ContextKeyEqualsExpr, ContextKeyFalseExpr, ContextKeyTrueExpr } from 'vs/platform/contextkey/common/contextkey';
import { IFileService } from 'vs/platform/files/common/files';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ExtHostTestingResource } from 'vs/workbench/api/common/extHost.protocol';
import { ViewAction } from 'vs/workbench/browser/parts/views/viewPane';
import { FocusedViewContext } from 'vs/workbench/common/views';
import { IExtensionsViewPaneContainer, VIEWLET_ID as EXTENSIONS_VIEWLET_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { REVEAL_IN_EXPLORER_COMMAND_ID } from 'vs/workbench/contrib/files/browser/fileCommands';
import { TestItemTreeElement } from 'vs/workbench/contrib/testing/browser/explorerProjections/index';
import * as icons from 'vs/workbench/contrib/testing/browser/icons';
import { ITestExplorerFilterState } from 'vs/workbench/contrib/testing/browser/testingExplorerFilter';
import { TestingExplorerView, TestingExplorerViewModel } from 'vs/workbench/contrib/testing/browser/testingExplorerView';
import { TestingOutputPeekController } from 'vs/workbench/contrib/testing/browser/testingOutputPeek';
import { ITestingOutputTerminalService } from 'vs/workbench/contrib/testing/browser/testingOutputTerminalService';
import { TestExplorerViewMode, TestExplorerViewSorting, Testing } from 'vs/workbench/contrib/testing/common/constants';
import { InternalTestItem, ITestItem, TestIdPath, TestIdWithSrc } from 'vs/workbench/contrib/testing/common/testCollection';
import { ITestingAutoRun } from 'vs/workbench/contrib/testing/common/testingAutoRun';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { isFailedState } from 'vs/workbench/contrib/testing/common/testingStates';
import { getPathForTestInResult, ITestResult } from 'vs/workbench/contrib/testing/common/testResult';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { getAllTestsInHierarchy, getTestByPath, ITestService, waitForAllRoots } from 'vs/workbench/contrib/testing/common/testService';
import { IWorkspaceTestCollectionService } from 'vs/workbench/contrib/testing/common/workspaceTestCollectionService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';

const category = localize('testing.category', 'Test');

const enum ActionOrder {
	// Navigation:
	Run = 10,
	Debug,
	AutoRun,
	Collapse,

	// Submenu:
	DisplayMode,
	Sort,
	Refresh,
}

export class HideOrShowTestAction extends Action {
	constructor(
		private readonly testId: string,
		@ITestService private readonly testService: ITestService,
	) {
		super(
			'testing.hideOrShowTest',
			testService.excludeTests.value.has(testId) ? localize('unhideTest', 'Unhide Test') : localize('hideTest', 'Hide Test'),
		);
	}

	/**
	 * @override
	 */
	public override run() {
		this.testService.setTestExcluded(this.testId);
		return Promise.resolve();
	}
}

export class DebugAction extends Action {
	constructor(
		private readonly tests: Iterable<TestIdWithSrc>,
		isRunning: boolean,
		@ITestService private readonly testService: ITestService
	) {
		super(
			'testing.run',
			localize('debug test', 'Debug Test'),
			'test-action ' + ThemeIcon.asClassName(icons.testingDebugIcon),
			/* enabled= */ !isRunning
		);
	}

	/**
	 * @override
	 */
	public override run(): Promise<any> {
		return this.testService.runTests({
			tests: [...this.tests],
			debug: true,
		});
	}
}

export class RunAction extends Action {
	constructor(
		private readonly tests: Iterable<TestIdWithSrc>,
		isRunning: boolean,
		@ITestService private readonly testService: ITestService
	) {
		super(
			'testing.run',
			localize('run test', 'Run Test'),
			'test-action ' + ThemeIcon.asClassName(icons.testingRunIcon),
			/* enabled= */ !isRunning,
		);
	}

	/**
	 * @override
	 */
	public override run(): Promise<any> {
		return this.testService.runTests({
			tests: [...this.tests],
			debug: false,
		});
	}
}

abstract class RunOrDebugSelectedAction extends ViewAction<TestingExplorerView> {
	constructor(id: string, title: string, icon: ThemeIcon, private readonly debug: boolean) {
		super({
			id,
			title,
			icon,
			viewId: Testing.ExplorerViewId,
			f1: true,
			category,
			precondition: FocusedViewContext.isEqualTo(Testing.ExplorerViewId),
		});
	}

	/**
	 * @override
	 */
	public runInView(accessor: ServicesAccessor, view: TestingExplorerView): Promise<ITestResult | undefined> {
		const tests = this.getActionableTests(accessor.get(IWorkspaceTestCollectionService), view.viewModel);
		if (!tests.length) {
			return Promise.resolve(undefined);
		}

		return accessor.get(ITestService).runTests({ tests, debug: this.debug });
	}

	private getActionableTests(testCollection: IWorkspaceTestCollectionService, viewModel: TestingExplorerViewModel) {
		const selected = viewModel.getSelectedTests();
		const tests: TestIdWithSrc[] = [];
		if (!selected.length) {
			for (const folder of testCollection.workspaceFolders()) {
				for (const child of folder.getChildren()) {
					if (this.filter(child)) {
						tests.push({ testId: child.item.extId, src: child.src });
					}
				}
			}
		} else {
			for (const treeElement of selected) {
				if (treeElement instanceof TestItemTreeElement && this.filter(treeElement.test)) {
					tests.push({ testId: treeElement.test.item.extId, src: treeElement.test.src });
				}
			}
		}

		return tests;
	}

	protected abstract filter(item: InternalTestItem): boolean;
}

export class RunSelectedAction extends RunOrDebugSelectedAction {
	constructor(
	) {
		super(
			'testing.runSelected',
			localize('runSelectedTests', 'Run Selected Tests'),
			icons.testingRunIcon,
			false,
		);
	}

	/**
	 * @override
	 */
	public filter({ item }: InternalTestItem) {
		return item.runnable;
	}
}

export class DebugSelectedAction extends RunOrDebugSelectedAction {
	constructor() {
		super(
			'testing.debugSelected',
			localize('debugSelectedTests', 'Debug Selected Tests'),
			icons.testingDebugIcon,
			true,
		);
	}

	/**
	 * @override
	 */
	public filter({ item }: InternalTestItem) {
		return item.debuggable;
	}
}

const showDiscoveringWhile = <R>(progress: IProgressService, task: Promise<R>): Promise<R> => {
	return progress.withProgress(
		{
			location: ProgressLocation.Window,
			title: localize('discoveringTests', 'Discovering Tests'),
		},
		() => task,
	);
};

abstract class RunOrDebugAllAllAction extends Action2 {
	constructor(id: string, title: string, icon: ThemeIcon, private readonly debug: boolean, private noTestsFoundError: string) {
		super({
			id,
			title,
			icon,
			f1: true,
			category,
			menu: {
				id: MenuId.ViewTitle,
				order: debug ? ActionOrder.Debug : ActionOrder.Run,
				group: 'navigation',
				when: ContextKeyAndExpr.create([
					ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId),
					TestingContextKeys.isRunning.isEqualTo(false),
					debug
						? TestingContextKeys.hasDebuggableTests.isEqualTo(true)
						: TestingContextKeys.hasRunnableTests.isEqualTo(true),
				])
			}
		});
	}

	public async run(accessor: ServicesAccessor) {
		const testService = accessor.get(ITestService);
		const workspace = accessor.get(IWorkspaceContextService);
		const notifications = accessor.get(INotificationService);
		const progress = accessor.get(IProgressService);

		const tests: TestIdWithSrc[] = [];
		const todo = workspace.getWorkspace().folders.map(async (folder) => {
			const ref = testService.subscribeToDiffs(ExtHostTestingResource.Workspace, folder.uri);
			try {
				await waitForAllRoots(ref.object);
				for (const root of ref.object.rootIds) {
					const node = ref.object.getNodeById(root);
					if (node && (this.debug ? node.item.debuggable : node.item.runnable)) {
						tests.push({ testId: node.item.extId, src: node.src });
					}
				}
			} finally {
				ref.dispose();
			}
		});

		await showDiscoveringWhile(progress, Promise.all(todo));

		if (tests.length === 0) {
			notifications.info(this.noTestsFoundError);
			return;
		}

		await testService.runTests({ tests, debug: this.debug });
	}
}

export class RunAllAction extends RunOrDebugAllAllAction {
	constructor() {
		super(
			'testing.runAll',
			localize('runAllTests', 'Run All Tests'),
			icons.testingRunAllIcon,
			false,
			localize('noTestProvider', 'No tests found in this workspace. You may need to install a test provider extension'),
		);
	}
}

export class DebugAllAction extends RunOrDebugAllAllAction {
	constructor() {
		super(
			'testing.debugAll',
			localize('debugAllTests', 'Debug All Tests'),
			icons.testingDebugIcon,
			true,
			localize('noDebugTestProvider', 'No debuggable tests found in this workspace. You may need to install a test provider extension'),
		);
	}
}

export class CancelTestRunAction extends Action2 {
	constructor() {
		super({
			id: 'testing.cancelRun',
			title: localize('testing.cancelRun', "Cancel Test Run"),
			icon: icons.testingCancelIcon,
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Run,
				group: 'navigation',
				when: ContextKeyAndExpr.create([
					ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId),
					ContextKeyEqualsExpr.create(TestingContextKeys.isRunning.serialize(), true),
				])
			}
		});
	}

	/**
	 * @override
	 */
	public async run(accessor: ServicesAccessor) {
		const testService = accessor.get(ITestService);
		for (const run of testService.testRuns) {
			testService.cancelTestRun(run);
		}
	}
}

export class TestingViewAsListAction extends ViewAction<TestingExplorerView> {
	constructor() {
		super({
			id: 'testing.viewAsList',
			viewId: Testing.ExplorerViewId,
			title: localize('testing.viewAsList', "View as List"),
			f1: false,
			toggled: TestingContextKeys.viewMode.isEqualTo(TestExplorerViewMode.List),
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.DisplayMode,
				group: 'viewAs',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.viewMode = TestExplorerViewMode.List;
	}
}

export class TestingViewAsTreeAction extends ViewAction<TestingExplorerView> {
	constructor() {
		super({
			id: 'testing.viewAsTree',
			viewId: Testing.ExplorerViewId,
			title: localize('testing.viewAsTree', "View as Tree"),
			f1: false,
			toggled: TestingContextKeys.viewMode.isEqualTo(TestExplorerViewMode.Tree),
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.DisplayMode,
				group: 'viewAs',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.viewMode = TestExplorerViewMode.Tree;
	}
}


export class TestingSortByNameAction extends ViewAction<TestingExplorerView> {
	constructor() {
		super({
			id: 'testing.sortByName',
			viewId: Testing.ExplorerViewId,
			title: localize('testing.sortByName', "Sort by Name"),
			f1: false,
			toggled: TestingContextKeys.viewSorting.isEqualTo(TestExplorerViewSorting.ByName),
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Sort,
				group: 'sortBy',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.viewSorting = TestExplorerViewSorting.ByName;
	}
}

export class TestingSortByLocationAction extends ViewAction<TestingExplorerView> {
	constructor() {
		super({
			id: 'testing.sortByLocation',
			viewId: Testing.ExplorerViewId,
			title: localize('testing.sortByLocation', "Sort by Location"),
			f1: false,
			toggled: TestingContextKeys.viewSorting.isEqualTo(TestExplorerViewSorting.ByLocation),
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Sort,
				group: 'sortBy',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.viewSorting = TestExplorerViewSorting.ByLocation;
	}
}

export class ShowMostRecentOutputAction extends Action2 {
	constructor() {
		super({
			id: 'testing.showMostRecentOutput',
			title: localize('testing.showMostRecentOutput', "Show Output"),
			f1: true,
			category,
			icon: Codicon.terminal,
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Collapse,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	public run(accessor: ServicesAccessor) {
		const result = accessor.get(ITestResultService).results[0];
		accessor.get(ITestingOutputTerminalService).open(result);
	}
}


export class CollapseAllAction extends ViewAction<TestingExplorerView> {
	constructor() {
		super({
			id: 'testing.collapseAll',
			viewId: Testing.ExplorerViewId,
			title: localize('testing.collapseAll', "Collapse All Tests"),
			f1: false,
			icon: Codicon.collapseAll,
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Collapse,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.collapseAll();
	}
}

export class RefreshTestsAction extends Action2 {
	constructor() {
		super({
			id: 'testing.refreshTests',
			title: localize('testing.refresh', "Refresh Tests"),
			category,
			f1: true,
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Refresh,
				group: 'refresh',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public run(accessor: ServicesAccessor) {
		accessor.get(ITestService).resubscribeToAllTests();
	}
}

export class ClearTestResultsAction extends Action2 {
	constructor() {
		super({
			id: 'testing.clearTestResults',
			title: localize('testing.clearResults', "Clear All Results"),
			category,
			f1: true
		});
	}

	/**
	 * @override
	 */
	public run(accessor: ServicesAccessor) {
		accessor.get(ITestResultService).clear();
	}
}

export class EditFocusedTest extends ViewAction<TestingExplorerView> {
	constructor() {
		super({
			id: 'testing.editFocusedTest',
			viewId: Testing.ExplorerViewId,
			title: localize('testing.editFocusedTest', "Go to Test"),
			f1: false,
			menu: {
				id: MenuId.TestItem,
			},
			keybinding: {
				weight: KeybindingWeight.EditorContrib - 10,
				when: FocusedViewContext.isEqualTo(Testing.ExplorerViewId),
				primary: KeyCode.Enter | KeyMod.Alt,
			},
		});
	}

	public override async run(accessor: ServicesAccessor, test?: ITestItem, preserveFocus?: boolean) {
		if (test) {
			await this.runForTest(accessor, test, preserveFocus);
		} else {
			await super.run(accessor);
		}
	}

	/**
	 * @override
	 */
	public runInView(accessor: ServicesAccessor, view: TestingExplorerView) {
		const selected = view.viewModel.tree.getFocus().find(isDefined);
		if (selected instanceof TestItemTreeElement) {
			this.runForTest(accessor, selected.test.item, false);
		}
	}

	/**
	 * @override
	 */
	private async runForTest(accessor: ServicesAccessor, test: ITestItem, preserveFocus = true) {
		const commandService = accessor.get(ICommandService);
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);

		accessor.get(ITestExplorerFilterState).reveal.value = [test.extId];

		let isFile = true;
		try {
			if (!(await fileService.resolve(test.uri)).isFile) {
				isFile = false;
			}
		} catch {
			// ignored
		}

		if (!isFile) {
			await commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, test.uri);
			return;
		}

		const pane = await editorService.openEditor({
			resource: test.uri,
			options: {
				selection: test.range
					? { startColumn: test.range.startColumn, startLineNumber: test.range.startLineNumber }
					: undefined,
				preserveFocus,
			},
		});

		// if the user selected a failed test and now they didn't, hide the peek
		const control = pane?.getControl();
		if (isCodeEditor(control)) {
			TestingOutputPeekController.get(control).removePeek();
		}
	}
}

abstract class ToggleAutoRun extends Action2 {
	constructor(title: string, whenToggleIs: boolean) {
		super({
			id: 'testing.toggleautoRun',
			title,
			f1: true,
			icon: icons.testingAutorunIcon,
			toggled: whenToggleIs === true ? ContextKeyTrueExpr.INSTANCE : ContextKeyFalseExpr.INSTANCE,
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.AutoRun,
				group: 'navigation',
				when: ContextKeyAndExpr.create([
					ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId),
					TestingContextKeys.autoRun.isEqualTo(whenToggleIs)
				])
			}
		});
	}

	/**
	 * @override
	 */
	public run(accessor: ServicesAccessor) {
		accessor.get(ITestingAutoRun).toggle();
	}
}

export class AutoRunOnAction extends ToggleAutoRun {
	constructor() {
		super(localize('testing.turnOnAutoRun', "Turn On Auto Run"), false);
	}
}

export class AutoRunOffAction extends ToggleAutoRun {
	constructor() {
		super(localize('testing.turnOffAutoRun', "Turn Off Auto Run"), true);
	}
}


abstract class RunOrDebugAtCursor extends Action2 {
	/**
	 * @override
	 */
	public async run(accessor: ServicesAccessor) {
		const control = accessor.get(IEditorService).activeTextEditorControl;
		const position = control?.getPosition();
		const model = control?.getModel();
		if (!position || !model || !('uri' in model)) {
			return;
		}

		const testService = accessor.get(ITestService);
		const collection = testService.subscribeToDiffs(ExtHostTestingResource.TextDocument, model.uri);

		let bestDepth = -1;
		let bestNode: InternalTestItem | undefined;

		try {
			await showDiscoveringWhile(accessor.get(IProgressService), getAllTestsInHierarchy(collection.object));

			const queue: [depth: number, nodes: Iterable<string>][] = [[0, collection.object.rootIds]];
			while (queue.length > 0) {
				const [depth, candidates] = queue.pop()!;
				for (const id of candidates) {
					const candidate = collection.object.getNodeById(id);
					if (candidate) {
						if (depth > bestDepth && this.filter(candidate) && candidate.item.range && Range.containsPosition(candidate.item.range, position)) {
							bestDepth = depth;
							bestNode = candidate;
						}

						queue.push([depth + 1, candidate.children]);
					}
				}
			}

			if (bestNode) {
				await this.runTest(testService, bestNode);
			}
		} finally {
			collection.dispose();
		}
	}

	protected abstract filter(node: InternalTestItem): boolean;

	protected abstract runTest(service: ITestService, node: InternalTestItem): Promise<ITestResult>;
}

export class RunAtCursor extends RunOrDebugAtCursor {
	constructor() {
		super({
			id: 'testing.runAtCursor',
			title: localize('testing.runAtCursor', "Run Test at Cursor"),
			f1: true,
			category,
		});
	}

	protected filter(node: InternalTestItem): boolean {
		return node.item.runnable;
	}

	protected runTest(service: ITestService, internalTest: InternalTestItem): Promise<ITestResult> {
		return service.runTests({
			debug: false,
			tests: [{ testId: internalTest.item.extId, src: internalTest.src }],
		});
	}
}

export class DebugAtCursor extends RunOrDebugAtCursor {
	constructor() {
		super({
			id: 'testing.debugAtCursor',
			title: localize('testing.debugAtCursor', "Debug Test at Cursor"),
			f1: true,
			category,
		});
	}

	protected filter(node: InternalTestItem): boolean {
		return node.item.debuggable;
	}

	protected runTest(service: ITestService, internalTest: InternalTestItem): Promise<ITestResult> {
		return service.runTests({
			debug: true,
			tests: [{ testId: internalTest.item.extId, src: internalTest.src }],
		});
	}
}

abstract class RunOrDebugCurrentFile extends Action2 {
	/**
	 * @override
	 */
	public async run(accessor: ServicesAccessor) {
		const control = accessor.get(IEditorService).activeTextEditorControl;
		const position = control?.getPosition();
		const model = control?.getModel();
		if (!position || !model || !('uri' in model)) {
			return;
		}

		const testService = accessor.get(ITestService);
		const collection = testService.subscribeToDiffs(ExtHostTestingResource.TextDocument, model.uri);

		try {
			await waitForAllRoots(collection.object);

			const roots = [...collection.object.rootIds]
				.map(r => collection.object.getNodeById(r))
				.filter(isDefined)
				.filter(n => this.filter(n));

			if (roots.length) {
				await this.runTest(testService, roots);
			}
		} finally {
			collection.dispose();
		}
	}

	protected abstract filter(node: InternalTestItem): boolean;

	protected abstract runTest(service: ITestService, node: InternalTestItem[]): Promise<ITestResult>;
}

export class RunCurrentFile extends RunOrDebugCurrentFile {
	constructor() {
		super({
			id: 'testing.runCurrentFile',
			title: localize('testing.runCurrentFile', "Run Tests in Current File"),
			f1: true,
			category,
		});
	}

	protected filter(node: InternalTestItem): boolean {
		return node.item.runnable;
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			debug: false,
			tests: internalTests.map(t => ({ testId: t.item.extId, src: t.src })),
		});
	}
}

export class DebugCurrentFile extends RunOrDebugCurrentFile {
	constructor() {
		super({
			id: 'testing.debugCurrentFile',
			title: localize('testing.debugCurrentFile', "Debug Tests in Current File"),
			f1: true,
			category,
		});
	}

	protected filter(node: InternalTestItem): boolean {
		return node.item.debuggable;
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			debug: true,
			tests: internalTests.map(t => ({ testId: t.item.extId, src: t.src }))
		});
	}
}

abstract class RunOrDebugExtsById extends Action2 {
	/**
	 * @override
	 */
	public async run(accessor: ServicesAccessor) {
		const testService = accessor.get(ITestService);
		const paths = [...this.getTestExtIdsToRun(accessor)];
		if (paths.length === 0) {
			return;
		}

		const workspaceTests = accessor.get(IWorkspaceTestCollectionService).subscribeToWorkspaceTests();

		try {
			const todo = Promise.all(workspaceTests.workspaceFolderCollections.map(
				([, c]) => Promise.all(paths.map(p => getTestByPath(c, p))),
			));

			const tests = flatten(await showDiscoveringWhile(accessor.get(IProgressService), todo)).filter(isDefined);
			if (tests.length) {
				await this.runTest(testService, tests);
			}
		} finally {
			workspaceTests.dispose();
		}
	}

	protected abstract getTestExtIdsToRun(accessor: ServicesAccessor): Iterable<TestIdPath>;

	protected abstract filter(node: InternalTestItem): boolean;

	protected abstract runTest(service: ITestService, node: InternalTestItem[]): Promise<ITestResult>;
}

abstract class RunOrDebugFailedTests extends RunOrDebugExtsById {
	/**
	 * @inheritdoc
	 */
	protected getTestExtIdsToRun(accessor: ServicesAccessor): Iterable<TestIdPath> {
		const { results } = accessor.get(ITestResultService);
		const paths = new Set<string>();
		const sep = '$$TEST SEP$$';
		for (let i = results.length - 1; i >= 0; i--) {
			const resultSet = results[i];
			for (const test of resultSet.tests) {
				const path = getPathForTestInResult(test, resultSet).join(sep);
				if (isFailedState(test.ownComputedState)) {
					paths.add(path);
				} else {
					paths.delete(path);
				}
			}
		}

		return Iterable.map(paths, p => p.split(sep));
	}
}

abstract class RunOrDebugLastRun extends RunOrDebugExtsById {
	/**
	 * @inheritdoc
	 */
	protected *getTestExtIdsToRun(accessor: ServicesAccessor): Iterable<TestIdPath> {
		const lastResult = accessor.get(ITestResultService).results[0];
		if (!lastResult) {
			return;
		}

		for (const test of lastResult.tests) {
			if (test.direct) {
				yield getPathForTestInResult(test, lastResult);
			}
		}
	}
}

export class ReRunFailedTests extends RunOrDebugFailedTests {
	constructor() {
		super({
			id: 'testing.reRunFailTests',
			title: localize('testing.reRunFailTests', "Rerun Failed Tests"),
			f1: true,
			category,
		});
	}

	protected filter(node: InternalTestItem): boolean {
		return node.item.runnable;
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			debug: false,
			tests: internalTests.map(t => ({ testId: t.item.extId, src: t.src })),
		});
	}
}

export class DebugFailedTests extends RunOrDebugFailedTests {
	constructor() {
		super({
			id: 'testing.debugFailTests',
			title: localize('testing.debugFailTests', "Debug Failed Tests"),
			f1: true,
			category,
		});
	}

	protected filter(node: InternalTestItem): boolean {
		return node.item.debuggable;
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			debug: true,
			tests: internalTests.map(t => ({ testId: t.item.extId, src: t.src })),
		});
	}
}

export class ReRunLastRun extends RunOrDebugLastRun {
	constructor() {
		super({
			id: 'testing.reRunLastRun',
			title: localize('testing.reRunLastRun', "Rerun Last Run"),
			f1: true,
			category,
		});
	}

	protected filter(node: InternalTestItem): boolean {
		return node.item.runnable;
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			debug: false,
			tests: internalTests.map(t => ({ testId: t.item.extId, src: t.src })),
		});
	}
}

export class DebugLastRun extends RunOrDebugLastRun {
	constructor() {
		super({
			id: 'testing.debugLastRun',
			title: localize('testing.debugLastRun', "Debug Last Run"),
			f1: true,
			category,
		});
	}

	protected filter(node: InternalTestItem): boolean {
		return node.item.debuggable;
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			debug: true,
			tests: internalTests.map(t => ({ testId: t.item.extId, src: t.src })),
		});
	}
}

export class SearchForTestExtension extends Action2 {
	constructor() {
		super({
			id: 'testing.searchForTestExtension',
			title: localize('testing.searchForTestExtension', "Search for Test Extension"),
			f1: false,
		});
	}

	public async run(accessor: ServicesAccessor) {
		const viewletService = accessor.get(IViewletService);
		const viewlet = (await viewletService.openViewlet(EXTENSIONS_VIEWLET_ID, true))?.getViewPaneContainer() as IExtensionsViewPaneContainer;
		viewlet.search('tag:testing @sort:installs');
		viewlet.focus();
	}
}
