/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IAction, IActionViewItem } from 'vs/base/common/actions';
import { IEditorControl } from 'vs/workbench/common/editor';
import { CompositeScope, CompositeProgressIndicator } from 'vs/workbench/services/progress/browser/progressIndicator';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IViewlet } from 'vs/workbench/common/viewlet';
import { TestViewletService, TestPanelService, TestViewsService } from 'vs/workbench/test/browser/workbenchTestServices';
import { Event } from 'vs/base/common/event';
import { IView, IViewPaneContainer, IViewsService } from 'vs/workbench/common/views';

class TestViewlet implements IViewlet {

	constructor(private id: string) { }

	readonly onDidBlur = Event.None;
	readonly onDidFocus = Event.None;

	getId(): string { return this.id; }
	getTitle(): string { return this.id; }
	getActions(): IAction[] { return []; }
	getSecondaryActions(): IAction[] { return []; }
	getContextMenuActions(): IAction[] { return []; }
	getActionViewItem(action: IAction): IActionViewItem { return null!; }
	getControl(): IEditorControl { return null!; }
	focus(): void { }
	getOptimalWidth(): number { return 10; }
	openView<T extends IView>(id: string, focus?: boolean): T | undefined { return undefined; }
	getViewPaneContainer(): IViewPaneContainer { return null!; }
	saveState(): void { }
}

class TestCompositeScope extends CompositeScope {
	isActive: boolean = false;

	constructor(viewletService: IViewletService, panelService: IPanelService, viewsService: IViewsService, scopeId: string) {
		super(viewletService, panelService, viewsService, scopeId);
	}

	onScopeActivated() { this.isActive = true; }
	onScopeDeactivated() { this.isActive = false; }
}

class TestProgressBar {
	fTotal: number = 0;
	fWorked: number = 0;
	fInfinite: boolean = false;
	fDone: boolean = false;

	infinite() {
		this.fDone = null!;
		this.fInfinite = true;

		return this;
	}

	total(total: number) {
		this.fDone = null!;
		this.fTotal = total;

		return this;
	}

	hasTotal() {
		return !!this.fTotal;
	}

	worked(worked: number) {
		this.fDone = null!;

		if (this.fWorked) {
			this.fWorked += worked;
		} else {
			this.fWorked = worked;
		}

		return this;
	}

	done() {
		this.fDone = true;

		this.fInfinite = null!;
		this.fWorked = null!;
		this.fTotal = null!;

		return this;
	}

	stop() {
		return this.done();
	}

	show(): void { }

	hide(): void { }
}

suite('Progress Indicator', () => {

	test('CompositeScope', () => {
		let viewletService = new TestViewletService();
		let panelService = new TestPanelService();
		let viewsService = new TestViewsService();
		let service = new TestCompositeScope(viewletService, panelService, viewsService, 'test.scopeId');
		const testViewlet = new TestViewlet('test.scopeId');

		assert(!service.isActive);
		viewletService.onDidViewletOpenEmitter.fire(testViewlet);
		assert(service.isActive);

		viewletService.onDidViewletCloseEmitter.fire(testViewlet);
		assert(!service.isActive);

		viewsService.onDidChangeViewVisibilityEmitter.fire({ id: 'test.scopeId', visible: true });
		assert(service.isActive);

		viewsService.onDidChangeViewVisibilityEmitter.fire({ id: 'test.scopeId', visible: false });
		assert(!service.isActive);
	});

	test('CompositeProgressIndicator', async () => {
		let testProgressBar = new TestProgressBar();
		let viewletService = new TestViewletService();
		let panelService = new TestPanelService();
		let viewsService = new TestViewsService();
		let service = new CompositeProgressIndicator((<any>testProgressBar), 'test.scopeId', true, viewletService, panelService, viewsService);

		// Active: Show (Infinite)
		let fn = service.show(true);
		assert.strictEqual(true, testProgressBar.fInfinite);
		fn.done();
		assert.strictEqual(true, testProgressBar.fDone);

		// Active: Show (Total / Worked)
		fn = service.show(100);
		assert.strictEqual(false, !!testProgressBar.fInfinite);
		assert.strictEqual(100, testProgressBar.fTotal);
		fn.worked(20);
		assert.strictEqual(20, testProgressBar.fWorked);
		fn.total(80);
		assert.strictEqual(80, testProgressBar.fTotal);
		fn.done();
		assert.strictEqual(true, testProgressBar.fDone);

		// Inactive: Show (Infinite)
		const testViewlet = new TestViewlet('test.scopeId');
		viewletService.onDidViewletCloseEmitter.fire(testViewlet);
		service.show(true);
		assert.strictEqual(false, !!testProgressBar.fInfinite);
		viewletService.onDidViewletOpenEmitter.fire(testViewlet);
		assert.strictEqual(true, testProgressBar.fInfinite);

		// Inactive: Show (Total / Worked)
		viewletService.onDidViewletCloseEmitter.fire(testViewlet);
		fn = service.show(100);
		fn.total(80);
		fn.worked(20);
		assert.strictEqual(false, !!testProgressBar.fTotal);
		viewletService.onDidViewletOpenEmitter.fire(testViewlet);
		assert.strictEqual(20, testProgressBar.fWorked);
		assert.strictEqual(80, testProgressBar.fTotal);

		// Acive: Show While
		let p = Promise.resolve(null);
		await service.showWhile(p);
		assert.strictEqual(true, testProgressBar.fDone);
		viewletService.onDidViewletCloseEmitter.fire(testViewlet);
		p = Promise.resolve(null);
		await service.showWhile(p);
		assert.strictEqual(true, testProgressBar.fDone);
		viewletService.onDidViewletOpenEmitter.fire(testViewlet);
		assert.strictEqual(true, testProgressBar.fDone);

		// Visible view: Show (Infinite)
		viewsService.onDidChangeViewVisibilityEmitter.fire({ id: 'test.scopeId', visible: true });
		fn = service.show(true);
		assert.strictEqual(true, testProgressBar.fInfinite);
		fn.done();
		assert.strictEqual(true, testProgressBar.fDone);

		// Hidden view: Show (Infinite)
		viewsService.onDidChangeViewVisibilityEmitter.fire({ id: 'test.scopeId', visible: false });
		service.show(true);
		assert.strictEqual(false, !!testProgressBar.fInfinite);
		viewsService.onDidChangeViewVisibilityEmitter.fire({ id: 'test.scopeId', visible: true });
		assert.strictEqual(true, testProgressBar.fInfinite);
	});
});
