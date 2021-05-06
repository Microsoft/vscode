/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event, Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { FileWorkingCopy, FileWorkingCopyState, IFileWorkingCopyModel, IFileWorkingCopyModelContentChangedEvent, IFileWorkingCopyModelFactory } from 'vs/workbench/services/workingCopy/common/fileWorkingCopy';
import { bufferToStream, newWriteableBufferStream, streamToBuffer, VSBuffer, VSBufferReadableStream } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { TestServiceAccessor, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { basename } from 'vs/base/common/resources';
import { FileChangesEvent, FileChangeType, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { SaveReason } from 'vs/workbench/common/editor';
import { Promises } from 'vs/base/common/async';
import { consumeReadable, consumeStream, isReadableStream } from 'vs/base/common/stream';

export class TestFileWorkingCopyModel extends Disposable implements IFileWorkingCopyModel {

	private readonly _onDidChangeContent = this._register(new Emitter<IFileWorkingCopyModelContentChangedEvent>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;

	constructor(readonly resource: URI, public contents: string) {
		super();
	}

	fireContentChangeEvent(event: IFileWorkingCopyModelContentChangedEvent): void {
		this._onDidChangeContent.fire(event);
	}

	updateContents(newContents: string): void {
		this.doUpdate(newContents);
	}

	async snapshot(token: CancellationToken): Promise<VSBufferReadableStream> {
		const stream = newWriteableBufferStream();
		stream.end(VSBuffer.fromString(this.contents));

		return stream;
	}

	async update(contents: VSBufferReadableStream, token: CancellationToken): Promise<void> {
		this.doUpdate((await streamToBuffer(contents)).toString());
	}

	private doUpdate(newContents: string): void {
		this.contents = newContents;

		this.versionId++;

		this._onDidChangeContent.fire({ isRedoing: false, isUndoing: false });
	}

	versionId = 0;

	pushedStackElement = false;

	pushStackElement(): void {
		this.pushedStackElement = true;
	}

	override dispose(): void {
		this._onWillDispose.fire();

		super.dispose();
	}
}

export class TestFileWorkingCopyModelFactory implements IFileWorkingCopyModelFactory<TestFileWorkingCopyModel> {

	async createModel(resource: URI, contents: VSBufferReadableStream, token: CancellationToken): Promise<TestFileWorkingCopyModel> {
		return new TestFileWorkingCopyModel(resource, (await streamToBuffer(contents)).toString());
	}
}

suite('FileWorkingCopy', function () {

	const factory = new TestFileWorkingCopyModelFactory();

	let resource = URI.file('test/resource');
	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;
	let workingCopy: FileWorkingCopy<TestFileWorkingCopyModel>;

	function createWorkingCopy(uri: URI = resource) {
		return new FileWorkingCopy<TestFileWorkingCopyModel>('testWorkingCopyType', uri, basename(uri), factory, accessor.fileService, accessor.logService, accessor.textFileService, accessor.filesConfigurationService, accessor.workingCopyBackupService, accessor.workingCopyService, accessor.notificationService, accessor.workingCopyEditorService, accessor.editorService, accessor.elevatedFileService);
	}

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);

		workingCopy = createWorkingCopy();
	});

	teardown(() => {
		workingCopy.dispose();
	});

	test('requires good file system URI', async () => {
		assert.throws(() => createWorkingCopy(URI.from({ scheme: 'unknown', path: 'somePath' })));
	});

	test('orphaned tracking', async () => {
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), false);

		let onDidChangeOrphanedPromise = Event.toPromise(workingCopy.onDidChangeOrphaned);
		accessor.fileService.notExistsSet.add(resource);
		accessor.fileService.fireFileChanges(new FileChangesEvent([{ resource, type: FileChangeType.DELETED }], false));

		await onDidChangeOrphanedPromise;
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), true);

		onDidChangeOrphanedPromise = Event.toPromise(workingCopy.onDidChangeOrphaned);
		accessor.fileService.notExistsSet.delete(resource);
		accessor.fileService.fireFileChanges(new FileChangesEvent([{ resource, type: FileChangeType.ADDED }], false));

		await onDidChangeOrphanedPromise;
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), false);
	});

	test('dirty', async () => {
		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), false);

		await workingCopy.resolve();
		assert.strictEqual(workingCopy.isResolved(), true);

		let changeDirtyCounter = 0;
		workingCopy.onDidChangeDirty(() => {
			changeDirtyCounter++;
		});

		let contentChangeCounter = 0;
		workingCopy.onDidChangeContent(() => {
			contentChangeCounter++;
		});

		// Dirty from: Model content change
		workingCopy.model?.updateContents('hello dirty');
		assert.strictEqual(contentChangeCounter, 1);

		assert.strictEqual(workingCopy.isDirty(), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), true);
		assert.strictEqual(changeDirtyCounter, 1);

		await workingCopy.save();

		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), false);
		assert.strictEqual(changeDirtyCounter, 2);

		// Dirty from: Initial contents
		await workingCopy.resolve({ contents: bufferToStream(VSBuffer.fromString('hello dirty stream')) });

		assert.strictEqual(contentChangeCounter, 2); // content of model did not change
		assert.strictEqual(workingCopy.isDirty(), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), true);
		assert.strictEqual(changeDirtyCounter, 3);

		await workingCopy.revert({ soft: true });

		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), false);
		assert.strictEqual(changeDirtyCounter, 4);

		// Dirty from: API
		workingCopy.markDirty();

		assert.strictEqual(workingCopy.isDirty(), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), true);
		assert.strictEqual(changeDirtyCounter, 5);

		await workingCopy.revert();

		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), false);
		assert.strictEqual(changeDirtyCounter, 6);
	});

	test('dirty - working copy marks non-dirty when undo reaches saved version ID', async () => {
		await workingCopy.resolve();

		workingCopy.model?.updateContents('hello saved state');
		await workingCopy.save();
		assert.strictEqual(workingCopy.isDirty(), false);

		workingCopy.model?.updateContents('changing content once');
		assert.strictEqual(workingCopy.isDirty(), true);

		// Simulate an undo that goes back to the last (saved) version ID
		workingCopy.model!.versionId--;

		workingCopy.model?.fireContentChangeEvent({ isRedoing: false, isUndoing: true });
		assert.strictEqual(workingCopy.isDirty(), false);
	});

	test('resolve (without backup)', async () => {
		let onDidResolveCounter = 0;
		workingCopy.onDidResolve(() => {
			onDidResolveCounter++;
		});

		// resolve from file
		await workingCopy.resolve();
		assert.strictEqual(workingCopy.isResolved(), true);
		assert.strictEqual(onDidResolveCounter, 1);
		assert.strictEqual(workingCopy.model?.contents, 'Hello Html');

		// dirty resolve returns early
		workingCopy.model?.updateContents('hello resolve');
		assert.strictEqual(workingCopy.isDirty(), true);
		await workingCopy.resolve();
		assert.strictEqual(onDidResolveCounter, 1);
		assert.strictEqual(workingCopy.model?.contents, 'hello resolve');

		// dirty resolve with contents updates contents
		await workingCopy.resolve({ contents: bufferToStream(VSBuffer.fromString('hello initial contents')) });
		assert.strictEqual(workingCopy.isDirty(), true);
		assert.strictEqual(workingCopy.model?.contents, 'hello initial contents');
		assert.strictEqual(onDidResolveCounter, 2);

		// resolve with pending save returns directly
		const pendingSave = workingCopy.save();
		await workingCopy.resolve();
		await pendingSave;
		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(workingCopy.model?.contents, 'hello initial contents');
		assert.strictEqual(onDidResolveCounter, 2);

		// disposed resolve is not throwing an error
		workingCopy.dispose();
		await workingCopy.resolve();
		assert.strictEqual(workingCopy.isDisposed(), true);
		assert.strictEqual(onDidResolveCounter, 2);
	});

	test('resolve (with backup)', async () => {
		await workingCopy.resolve({ contents: bufferToStream(VSBuffer.fromString('hello backup')) });

		const backup = await workingCopy.backup(CancellationToken.None);
		await accessor.workingCopyBackupService.backup(workingCopy, backup.content, undefined, backup.meta);

		assert.strictEqual(accessor.workingCopyBackupService.hasBackupSync(workingCopy), true);

		workingCopy.dispose();

		// first resolve loads from backup
		workingCopy = createWorkingCopy();
		await workingCopy.resolve();

		assert.strictEqual(workingCopy.isDirty(), true);
		assert.strictEqual(workingCopy.model?.contents, 'hello backup');

		workingCopy.model.updateContents('hello updated');
		await workingCopy.save();

		// subsequent resolve ignores any backups
		await workingCopy.resolve();

		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(workingCopy.model?.contents, 'Hello Html');
	});

	test('resolve (with backup, preserves metadata and orphaned state)', async () => {
		await workingCopy.resolve({ contents: bufferToStream(VSBuffer.fromString('hello backup')) });

		const orphanedPromise = Event.toPromise(workingCopy.onDidChangeOrphaned);

		accessor.fileService.notExistsSet.add(resource);
		accessor.fileService.fireFileChanges(new FileChangesEvent([{ resource, type: FileChangeType.DELETED }], false));

		await orphanedPromise;
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), true);

		const backup = await workingCopy.backup(CancellationToken.None);
		await accessor.workingCopyBackupService.backup(workingCopy, backup.content, undefined, backup.meta);

		assert.strictEqual(accessor.workingCopyBackupService.hasBackupSync(workingCopy), true);

		workingCopy.dispose();

		workingCopy = createWorkingCopy();
		await workingCopy.resolve();

		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), true);

		const backup2 = await workingCopy.backup(CancellationToken.None);
		assert.deepStrictEqual(backup.meta, backup2.meta);
	});

	test('resolve (updates orphaned state accordingly)', async () => {
		await workingCopy.resolve();

		const orphanedPromise = Event.toPromise(workingCopy.onDidChangeOrphaned);

		accessor.fileService.notExistsSet.add(resource);
		accessor.fileService.fireFileChanges(new FileChangesEvent([{ resource, type: FileChangeType.DELETED }], false));

		await orphanedPromise;
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), true);

		// resolving clears orphaned state when successful
		accessor.fileService.notExistsSet.delete(resource);
		await workingCopy.resolve({ forceReadFromFile: true });
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), false);

		// resolving adds orphaned state when fail to read
		try {
			accessor.fileService.readShouldThrowError = new FileOperationError('file not found', FileOperationResult.FILE_NOT_FOUND);
			await workingCopy.resolve();
			assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), true);
		} finally {
			accessor.fileService.readShouldThrowError = undefined;
		}
	});

	test('resolve (FILE_NOT_MODIFIED_SINCE can be handled for resolved working copies)', async () => {
		await workingCopy.resolve();

		try {
			accessor.fileService.readShouldThrowError = new FileOperationError('file not modified since', FileOperationResult.FILE_NOT_MODIFIED_SINCE);
			await workingCopy.resolve();
		} finally {
			accessor.fileService.readShouldThrowError = undefined;
		}

		assert.strictEqual(workingCopy.model?.contents, 'Hello Html');
	});

	test('resolve does not alter content when model content changed in parallel', async () => {
		await workingCopy.resolve();

		const resolvePromise = workingCopy.resolve();

		workingCopy.model?.updateContents('changed content');

		await resolvePromise;

		assert.strictEqual(workingCopy.isDirty(), true);
		assert.strictEqual(workingCopy.model?.contents, 'changed content');
	});

	test('backup', async () => {
		await workingCopy.resolve();
		workingCopy.model?.updateContents('hello backup');

		const backup = await workingCopy.backup(CancellationToken.None);

		assert.ok(backup.meta);

		let backupContents: string | undefined = undefined;
		if (backup.content instanceof VSBuffer) {
			backupContents = backup.content.toString();
		} else if (isReadableStream(backup.content)) {
			backupContents = (await consumeStream(backup.content, chunks => VSBuffer.concat(chunks))).toString();
		} else if (backup.content) {
			backupContents = consumeReadable(backup.content, chunks => VSBuffer.concat(chunks)).toString();
		}

		assert.strictEqual(backupContents, 'hello backup');
	});

	test('save (no errors)', async () => {
		let savedCounter = 0;
		let lastSavedReason: SaveReason | undefined = undefined;
		workingCopy.onDidSave(reason => {
			savedCounter++;
			lastSavedReason = reason;
		});

		let saveErrorCounter = 0;
		workingCopy.onDidSaveError(() => {
			saveErrorCounter++;
		});

		// unresolved
		await workingCopy.save();
		assert.strictEqual(savedCounter, 0);
		assert.strictEqual(saveErrorCounter, 0);

		// simple
		await workingCopy.resolve();
		workingCopy.model?.updateContents('hello save');
		await workingCopy.save();

		assert.strictEqual(savedCounter, 1);
		assert.strictEqual(saveErrorCounter, 0);
		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(lastSavedReason, SaveReason.EXPLICIT);
		assert.strictEqual(workingCopy.model?.pushedStackElement, true);

		// save reason
		workingCopy.model?.updateContents('hello save');
		await workingCopy.save({ reason: SaveReason.AUTO });

		assert.strictEqual(savedCounter, 2);
		assert.strictEqual(saveErrorCounter, 0);
		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(lastSavedReason, SaveReason.AUTO);

		// multiple saves in parallel are fine and result
		// in a single save when content does not change
		workingCopy.model?.updateContents('hello save');
		await Promises.settled([
			workingCopy.save({ reason: SaveReason.AUTO }),
			workingCopy.save({ reason: SaveReason.EXPLICIT }),
			workingCopy.save({ reason: SaveReason.WINDOW_CHANGE })
		]);

		assert.strictEqual(savedCounter, 3);
		assert.strictEqual(saveErrorCounter, 0);
		assert.strictEqual(workingCopy.isDirty(), false);

		// multiple saves in parallel are fine and result
		// in just one save operation (the second one
		// cancels the first)
		workingCopy.model?.updateContents('hello save');
		const firstSave = workingCopy.save();
		workingCopy.model?.updateContents('hello save more');
		const secondSave = workingCopy.save();

		await Promises.settled([firstSave, secondSave]);
		assert.strictEqual(savedCounter, 4);
		assert.strictEqual(saveErrorCounter, 0);
		assert.strictEqual(workingCopy.isDirty(), false);

		// no save when not forced and not dirty
		await workingCopy.save();
		assert.strictEqual(savedCounter, 4);
		assert.strictEqual(saveErrorCounter, 0);
		assert.strictEqual(workingCopy.isDirty(), false);

		// save when forced even when not dirty
		await workingCopy.save({ force: true });
		assert.strictEqual(savedCounter, 5);
		assert.strictEqual(saveErrorCounter, 0);
		assert.strictEqual(workingCopy.isDirty(), false);

		// save clears orphaned
		const orphanedPromise = Event.toPromise(workingCopy.onDidChangeOrphaned);

		accessor.fileService.notExistsSet.add(resource);
		accessor.fileService.fireFileChanges(new FileChangesEvent([{ resource, type: FileChangeType.DELETED }], false));

		await orphanedPromise;
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), true);

		await workingCopy.save({ force: true });
		assert.strictEqual(savedCounter, 6);
		assert.strictEqual(saveErrorCounter, 0);
		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ORPHAN), false);
	});

	test('save (errors)', async () => {
		let savedCounter = 0;
		workingCopy.onDidSave(reason => {
			savedCounter++;
		});

		let saveErrorCounter = 0;
		workingCopy.onDidSaveError(() => {
			saveErrorCounter++;
		});

		await workingCopy.resolve();

		// save error: any error marks working copy dirty
		try {
			accessor.fileService.writeShouldThrowError = new FileOperationError('write error', FileOperationResult.FILE_PERMISSION_DENIED);

			await workingCopy.save({ force: true });
		} catch (error) {
			// error is expected
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}

		assert.strictEqual(savedCounter, 0);
		assert.strictEqual(saveErrorCounter, 1);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ERROR), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.CONFLICT), false);
		assert.strictEqual(workingCopy.isDirty(), true);

		// save is a no-op unless forced when in error case
		await workingCopy.save({ reason: SaveReason.AUTO });
		assert.strictEqual(savedCounter, 0);
		assert.strictEqual(saveErrorCounter, 1);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ERROR), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.CONFLICT), false);
		assert.strictEqual(workingCopy.isDirty(), true);

		// save clears error flags when successful
		await workingCopy.save({ reason: SaveReason.EXPLICIT });
		assert.strictEqual(savedCounter, 1);
		assert.strictEqual(saveErrorCounter, 1);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ERROR), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.CONFLICT), false);
		assert.strictEqual(workingCopy.isDirty(), false);

		// save error: conflict
		try {
			accessor.fileService.writeShouldThrowError = new FileOperationError('write error conflict', FileOperationResult.FILE_MODIFIED_SINCE);

			await workingCopy.save({ force: true });
		} catch (error) {
			// error is expected
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}

		assert.strictEqual(savedCounter, 1);
		assert.strictEqual(saveErrorCounter, 2);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ERROR), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.CONFLICT), true);
		assert.strictEqual(workingCopy.isDirty(), true);

		// save clears error flags when successful
		await workingCopy.save({ reason: SaveReason.EXPLICIT });
		assert.strictEqual(savedCounter, 2);
		assert.strictEqual(saveErrorCounter, 2);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.ERROR), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.CONFLICT), false);
		assert.strictEqual(workingCopy.isDirty(), false);
	});

	test('revert', async () => {
		await workingCopy.resolve();
		workingCopy.model?.updateContents('hello revert');

		let revertedCounter = 0;
		workingCopy.onDidRevert(() => {
			revertedCounter++;
		});

		// revert: soft
		await workingCopy.revert({ soft: true });

		assert.strictEqual(revertedCounter, 1);
		assert.strictEqual(workingCopy.isDirty(), false);
		assert.strictEqual(workingCopy.model?.contents, 'hello revert');

		// revert: not forced
		await workingCopy.revert();
		assert.strictEqual(revertedCounter, 1);
		assert.strictEqual(workingCopy.model?.contents, 'hello revert');

		// revert: forced
		await workingCopy.revert({ force: true });
		assert.strictEqual(revertedCounter, 2);
		assert.strictEqual(workingCopy.model?.contents, 'Hello Html');

		// revert: forced, error
		try {
			workingCopy.model?.updateContents('hello revert');
			accessor.fileService.readShouldThrowError = new FileOperationError('error', FileOperationResult.FILE_PERMISSION_DENIED);

			await workingCopy.revert({ force: true });
		} catch (error) {
			// expected (our error)
		} finally {
			accessor.fileService.readShouldThrowError = undefined;
		}

		assert.strictEqual(revertedCounter, 2);
		assert.strictEqual(workingCopy.isDirty(), true);

		// revert: forced, file not found error is ignored
		try {
			workingCopy.model?.updateContents('hello revert');
			accessor.fileService.readShouldThrowError = new FileOperationError('error', FileOperationResult.FILE_NOT_FOUND);

			await workingCopy.revert({ force: true });
		} catch (error) {
			// expected (our error)
		} finally {
			accessor.fileService.readShouldThrowError = undefined;
		}

		assert.strictEqual(revertedCounter, 3);
		assert.strictEqual(workingCopy.isDirty(), false);
	});

	test('state', async () => {
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), true);

		await workingCopy.resolve({ contents: bufferToStream(VSBuffer.fromString('hello state')) });
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), true);

		const savePromise = workingCopy.save();
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), true);

		await savePromise;

		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), false);
	});

	test('joinState', async () => {
		await workingCopy.resolve({ contents: bufferToStream(VSBuffer.fromString('hello state')) });

		workingCopy.save();
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), true);

		await workingCopy.joinState(FileWorkingCopyState.PENDING_SAVE);

		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.DIRTY), false);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.SAVED), true);
		assert.strictEqual(workingCopy.hasState(FileWorkingCopyState.PENDING_SAVE), false);
	});

	test('isReadonly, isResolved, dispose, isDisposed', async () => {
		assert.strictEqual(workingCopy.isResolved(), false);
		assert.strictEqual(workingCopy.isReadonly(), false);
		assert.strictEqual(workingCopy.isDisposed(), false);

		await workingCopy.resolve();

		assert.ok(workingCopy.model);
		assert.strictEqual(workingCopy.isResolved(), true);
		assert.strictEqual(workingCopy.isReadonly(), false);
		assert.strictEqual(workingCopy.isDisposed(), false);

		let disposedEvent = false;
		workingCopy.onWillDispose(() => {
			disposedEvent = true;
		});

		let disposedModelEvent = false;
		workingCopy.model.onWillDispose(() => {
			disposedModelEvent = true;
		});

		workingCopy.dispose();

		assert.strictEqual(workingCopy.isDisposed(), true);
		assert.strictEqual(disposedEvent, true);
		assert.strictEqual(disposedModelEvent, true);
	});
});
