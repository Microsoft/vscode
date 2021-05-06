/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import Severity from 'vs/base/common/severity';
import { ITerminalStatus, TerminalStatusList } from 'vs/workbench/contrib/terminal/browser/terminalStatusList';

function statusesEqual(list: TerminalStatusList, expected: [string, Severity][]) {
	deepStrictEqual(list.statuses.map(e => [e.id, e.severity]), expected);
}

suite('Workbench - TerminalStatusList', () => {
	let list: TerminalStatusList;

	setup(() => {
		list = new TerminalStatusList();
	});

	teardown(() => {
		list.dispose();
	});

	test('primary', () => {
		strictEqual(list.primary?.id, undefined);
		list.add({ id: 'info1', severity: Severity.Info });
		strictEqual(list.primary?.id, 'info1');
		list.add({ id: 'warning1', severity: Severity.Warning });
		strictEqual(list.primary?.id, 'warning1');
		list.add({ id: 'info2', severity: Severity.Info });
		strictEqual(list.primary?.id, 'warning1');
		list.add({ id: 'warning2', severity: Severity.Warning });
		strictEqual(list.primary?.id, 'warning2');
		list.add({ id: 'info3', severity: Severity.Info });
		strictEqual(list.primary?.id, 'warning2');
		list.add({ id: 'error1', severity: Severity.Error });
		strictEqual(list.primary?.id, 'error1');
		list.add({ id: 'warning3', severity: Severity.Warning });
		strictEqual(list.primary?.id, 'error1');
		list.add({ id: 'error2', severity: Severity.Error });
		strictEqual(list.primary?.id, 'error2');
		list.remove('error1');
		strictEqual(list.primary?.id, 'error2');
		list.remove('error2');
		strictEqual(list.primary?.id, 'warning3');
	});

	test('statuses', () => {
		strictEqual(list.statuses.length, 0);
		list.add({ id: 'info', severity: Severity.Info });
		list.add({ id: 'warning', severity: Severity.Warning });
		list.add({ id: 'error', severity: Severity.Error });
		strictEqual(list.statuses.length, 3);
		statusesEqual(list, [
			['info', Severity.Info],
			['warning', Severity.Warning],
			['error', Severity.Error],
		]);
		list.remove('info');
		list.remove('warning');
		list.remove('error');
		strictEqual(list.statuses.length, 0);
	});

	test('onDidAddStatus', async () => {
		const result = await new Promise<ITerminalStatus>(r => {
			list.onDidAddStatus(r);
			list.add({ id: 'test', severity: Severity.Info });
		});
		deepStrictEqual(result, { id: 'test', severity: Severity.Info });
	});

	test('onDidRemoveStatus', async () => {
		const result = await new Promise<ITerminalStatus>(r => {
			list.onDidRemoveStatus(r);
			list.add({ id: 'test', severity: Severity.Info });
			list.remove('test');
		});
		deepStrictEqual(result, { id: 'test', severity: Severity.Info });
	});

	test('onDidChangePrimaryStatus', async () => {
		const result = await new Promise<ITerminalStatus>(r => {
			list.onDidRemoveStatus(r);
			list.add({ id: 'test', severity: Severity.Info });
			list.remove('test');
		});
		deepStrictEqual(result, { id: 'test', severity: Severity.Info });
	});

	test('add', () => {
		statusesEqual(list, []);
		list.add({ id: 'info', severity: Severity.Info });
		statusesEqual(list, [
			['info', Severity.Info]
		]);
		list.add({ id: 'warning', severity: Severity.Warning });
		statusesEqual(list, [
			['info', Severity.Info],
			['warning', Severity.Warning]
		]);
		list.add({ id: 'error', severity: Severity.Error });
		statusesEqual(list, [
			['info', Severity.Info],
			['warning', Severity.Warning],
			['error', Severity.Error]
		]);
	});

	test('remove', () => {
		list.add({ id: 'info', severity: Severity.Info });
		list.add({ id: 'warning', severity: Severity.Warning });
		list.add({ id: 'error', severity: Severity.Error });
		statusesEqual(list, [
			['info', Severity.Info],
			['warning', Severity.Warning],
			['error', Severity.Error]
		]);
		list.remove('warning');
		statusesEqual(list, [
			['info', Severity.Info],
			['error', Severity.Error]
		]);
		list.remove('info');
		statusesEqual(list, [
			['error', Severity.Error]
		]);
		list.remove('error');
		statusesEqual(list, []);
	});

	test('toggle', () => {
		const status = { id: 'info', severity: Severity.Info };
		list.toggle(status, true);
		statusesEqual(list, [
			['info', Severity.Info]
		]);
		list.toggle(status, false);
		statusesEqual(list, []);
	});
});
