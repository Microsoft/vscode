/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as platform from 'vs/base/common/platform';
import { FileChangeType, FileChangesEvent } from 'vs/platform/files/common/files';
import { URI as uri } from 'vs/base/common/uri';
import { IDiskFileChange, normalizeFileChanges, toFileChanges } from 'vs/platform/files/node/watcher/watcher';
import { Event, Emitter } from 'vs/base/common/event';
import { ExtUri } from 'vs/base/common/resources';

function toFileChangesEvent(changes: IDiskFileChange[]): FileChangesEvent {
	return new FileChangesEvent(toFileChanges(changes), new ExtUri(() => !platform.isLinux));
}

class TestFileWatcher {
	private readonly _onDidFilesChange: Emitter<FileChangesEvent>;

	constructor() {
		this._onDidFilesChange = new Emitter<FileChangesEvent>();
	}

	get onDidFilesChange(): Event<FileChangesEvent> {
		return this._onDidFilesChange.event;
	}

	report(changes: IDiskFileChange[]): void {
		this.onRawFileEvents(changes);
	}

	private onRawFileEvents(events: IDiskFileChange[]): void {

		// Normalize
		let normalizedEvents = normalizeFileChanges(events);

		// Emit through event emitter
		if (normalizedEvents.length > 0) {
			this._onDidFilesChange.fire(toFileChangesEvent(normalizedEvents));
		}
	}
}

enum Path {
	UNIX,
	WINDOWS,
	UNC
}

suite('Normalizer', () => {

	test('simple add/update/delete', function (done: () => void) {
		const watch = new TestFileWatcher();

		const added = uri.file('/users/data/src/added.txt');
		const updated = uri.file('/users/data/src/updated.txt');
		const deleted = uri.file('/users/data/src/deleted.txt');

		const raw: IDiskFileChange[] = [
			{ path: added.fsPath, type: FileChangeType.ADDED },
			{ path: updated.fsPath, type: FileChangeType.UPDATED },
			{ path: deleted.fsPath, type: FileChangeType.DELETED },
		];

		watch.onDidFilesChange(e => {
			assert.ok(e);
			assert.equal(e.changes.length, 3);
			assert.ok(e.contains(added, FileChangeType.ADDED));
			assert.ok(e.contains(updated, FileChangeType.UPDATED));
			assert.ok(e.contains(deleted, FileChangeType.DELETED));

			done();
		});

		watch.report(raw);
	});

	let pathSpecs = platform.isWindows ? [Path.WINDOWS, Path.UNC] : [Path.UNIX];
	pathSpecs.forEach((p) => {
		test('delete only reported for top level folder (' + p + ')', function (done: () => void) {
			const watch = new TestFileWatcher();

			const deletedFolderA = uri.file(p === Path.UNIX ? '/users/data/src/todelete1' : p === Path.WINDOWS ? 'C:\\users\\data\\src\\todelete1' : '\\\\localhost\\users\\data\\src\\todelete1');
			const deletedFolderB = uri.file(p === Path.UNIX ? '/users/data/src/todelete2' : p === Path.WINDOWS ? 'C:\\users\\data\\src\\todelete2' : '\\\\localhost\\users\\data\\src\\todelete2');
			const deletedFolderBF1 = uri.file(p === Path.UNIX ? '/users/data/src/todelete2/file.txt' : p === Path.WINDOWS ? 'C:\\users\\data\\src\\todelete2\\file.txt' : '\\\\localhost\\users\\data\\src\\todelete2\\file.txt');
			const deletedFolderBF2 = uri.file(p === Path.UNIX ? '/users/data/src/todelete2/more/test.txt' : p === Path.WINDOWS ? 'C:\\users\\data\\src\\todelete2\\more\\test.txt' : '\\\\localhost\\users\\data\\src\\todelete2\\more\\test.txt');
			const deletedFolderBF3 = uri.file(p === Path.UNIX ? '/users/data/src/todelete2/super/bar/foo.txt' : p === Path.WINDOWS ? 'C:\\users\\data\\src\\todelete2\\super\\bar\\foo.txt' : '\\\\localhost\\users\\data\\src\\todelete2\\super\\bar\\foo.txt');
			const deletedFileA = uri.file(p === Path.UNIX ? '/users/data/src/deleteme.txt' : p === Path.WINDOWS ? 'C:\\users\\data\\src\\deleteme.txt' : '\\\\localhost\\users\\data\\src\\deleteme.txt');

			const addedFile = uri.file(p === Path.UNIX ? '/users/data/src/added.txt' : p === Path.WINDOWS ? 'C:\\users\\data\\src\\added.txt' : '\\\\localhost\\users\\data\\src\\added.txt');
			const updatedFile = uri.file(p === Path.UNIX ? '/users/data/src/updated.txt' : p === Path.WINDOWS ? 'C:\\users\\data\\src\\updated.txt' : '\\\\localhost\\users\\data\\src\\updated.txt');

			const raw: IDiskFileChange[] = [
				{ path: deletedFolderA.fsPath, type: FileChangeType.DELETED },
				{ path: deletedFolderB.fsPath, type: FileChangeType.DELETED },
				{ path: deletedFolderBF1.fsPath, type: FileChangeType.DELETED },
				{ path: deletedFolderBF2.fsPath, type: FileChangeType.DELETED },
				{ path: deletedFolderBF3.fsPath, type: FileChangeType.DELETED },
				{ path: deletedFileA.fsPath, type: FileChangeType.DELETED },
				{ path: addedFile.fsPath, type: FileChangeType.ADDED },
				{ path: updatedFile.fsPath, type: FileChangeType.UPDATED }
			];

			watch.onDidFilesChange(e => {
				assert.ok(e);
				assert.equal(e.changes.length, 5);

				assert.ok(e.contains(deletedFolderA, FileChangeType.DELETED));
				assert.ok(e.contains(deletedFolderB, FileChangeType.DELETED));
				assert.ok(e.contains(deletedFileA, FileChangeType.DELETED));
				assert.ok(e.contains(addedFile, FileChangeType.ADDED));
				assert.ok(e.contains(updatedFile, FileChangeType.UPDATED));

				done();
			});

			watch.report(raw);
		});
	});

	test('event normalization: ignore CREATE followed by DELETE', function (done: () => void) {
		const watch = new TestFileWatcher();

		const created = uri.file('/users/data/src/related');
		const deleted = uri.file('/users/data/src/related');
		const unrelated = uri.file('/users/data/src/unrelated');

		const raw: IDiskFileChange[] = [
			{ path: created.fsPath, type: FileChangeType.ADDED },
			{ path: deleted.fsPath, type: FileChangeType.DELETED },
			{ path: unrelated.fsPath, type: FileChangeType.UPDATED },
		];

		watch.onDidFilesChange(e => {
			assert.ok(e);
			assert.equal(e.changes.length, 1);

			assert.ok(e.contains(unrelated, FileChangeType.UPDATED));

			done();
		});

		watch.report(raw);
	});

	test('event normalization: flatten DELETE followed by CREATE into CHANGE', function (done: () => void) {
		const watch = new TestFileWatcher();

		const deleted = uri.file('/users/data/src/related');
		const created = uri.file('/users/data/src/related');
		const unrelated = uri.file('/users/data/src/unrelated');

		const raw: IDiskFileChange[] = [
			{ path: deleted.fsPath, type: FileChangeType.DELETED },
			{ path: created.fsPath, type: FileChangeType.ADDED },
			{ path: unrelated.fsPath, type: FileChangeType.UPDATED },
		];

		watch.onDidFilesChange(e => {
			assert.ok(e);
			assert.equal(e.changes.length, 2);

			assert.ok(e.contains(deleted, FileChangeType.UPDATED));
			assert.ok(e.contains(unrelated, FileChangeType.UPDATED));

			done();
		});

		watch.report(raw);
	});

	test('event normalization: ignore UPDATE when CREATE received', function (done: () => void) {
		const watch = new TestFileWatcher();

		const created = uri.file('/users/data/src/related');
		const updated = uri.file('/users/data/src/related');
		const unrelated = uri.file('/users/data/src/unrelated');

		const raw: IDiskFileChange[] = [
			{ path: created.fsPath, type: FileChangeType.ADDED },
			{ path: updated.fsPath, type: FileChangeType.UPDATED },
			{ path: unrelated.fsPath, type: FileChangeType.UPDATED },
		];

		watch.onDidFilesChange(e => {
			assert.ok(e);
			assert.equal(e.changes.length, 2);

			assert.ok(e.contains(created, FileChangeType.ADDED));
			assert.ok(!e.contains(created, FileChangeType.UPDATED));
			assert.ok(e.contains(unrelated, FileChangeType.UPDATED));

			done();
		});

		watch.report(raw);
	});

	test('event normalization: apply DELETE', function (done: () => void) {
		const watch = new TestFileWatcher();

		const updated = uri.file('/users/data/src/related');
		const updated2 = uri.file('/users/data/src/related');
		const deleted = uri.file('/users/data/src/related');
		const unrelated = uri.file('/users/data/src/unrelated');

		const raw: IDiskFileChange[] = [
			{ path: updated.fsPath, type: FileChangeType.UPDATED },
			{ path: updated2.fsPath, type: FileChangeType.UPDATED },
			{ path: unrelated.fsPath, type: FileChangeType.UPDATED },
			{ path: updated.fsPath, type: FileChangeType.DELETED }
		];

		watch.onDidFilesChange(e => {
			assert.ok(e);
			assert.equal(e.changes.length, 2);

			assert.ok(e.contains(deleted, FileChangeType.DELETED));
			assert.ok(!e.contains(updated, FileChangeType.UPDATED));
			assert.ok(e.contains(unrelated, FileChangeType.UPDATED));

			done();
		});

		watch.report(raw);
	});
});
