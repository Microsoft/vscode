/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FileService } from 'vs/platform/files/common/fileService';
import { URI } from 'vs/base/common/uri';
import { IFileSystemProviderRegistrationEvent, FileSystemProviderCapabilities, IFileSystemProviderCapabilitiesChangeEvent } from 'vs/platform/files/common/files';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { NullLogService } from 'vs/platform/log/common/log';
import { timeout } from 'vs/base/common/async';
import { NullFileSystemProvider } from 'vs/platform/files/test/common/nullFileSystemProvider';

suite('File Service', () => {

	test('provider registration', async () => {
		const service = new FileService(new NullLogService());
		const resource = URI.parse('test://foo/bar');
		const provider = new NullFileSystemProvider();

		assert.equal(service.canHandleResource(resource), false);

		const registrations: IFileSystemProviderRegistrationEvent[] = [];
		service.onDidChangeFileSystemProviderRegistrations(e => {
			registrations.push(e);
		});

		const capabilityChanges: IFileSystemProviderCapabilitiesChangeEvent[] = [];
		service.onDidChangeFileSystemProviderCapabilities(e => {
			capabilityChanges.push(e);
		});

		let registrationDisposable: IDisposable | undefined = undefined;
		let callCount = 0;
		service.onWillActivateFileSystemProvider(e => {
			callCount++;

			if (e.scheme === 'test' && callCount === 1) {
				e.join(new Promise(resolve => {
					registrationDisposable = service.registerProvider('test', provider);

					resolve();
				}));
			}
		});

		await service.activateProvider('test');

		assert.equal(service.canHandleResource(resource), true);

		assert.equal(registrations.length, 1);
		assert.equal(registrations[0].scheme, 'test');
		assert.equal(registrations[0].added, true);
		assert.ok(registrationDisposable);

		assert.equal(capabilityChanges.length, 0);

		provider.setCapabilities(FileSystemProviderCapabilities.FileFolderCopy);
		assert.equal(capabilityChanges.length, 1);
		provider.setCapabilities(FileSystemProviderCapabilities.Readonly);
		assert.equal(capabilityChanges.length, 2);

		await service.activateProvider('test');
		assert.equal(callCount, 2); // activation is called again

		assert.equal(service.hasCapability(resource, FileSystemProviderCapabilities.Readonly), true);
		assert.equal(service.hasCapability(resource, FileSystemProviderCapabilities.FileOpenReadWriteClose), false);

		registrationDisposable!.dispose();

		assert.equal(service.canHandleResource(resource), false);

		assert.equal(registrations.length, 2);
		assert.equal(registrations[1].scheme, 'test');
		assert.equal(registrations[1].added, false);
	});

	test('watch', async () => {
		const service = new FileService(new NullLogService());

		let disposeCounter = 0;
		service.registerProvider('test', new NullFileSystemProvider(() => {
			return toDisposable(() => {
				disposeCounter++;
			});
		}));
		await service.activateProvider('test');

		const resource1 = URI.parse('test://foo/bar1');
		const watcher1Disposable = service.watch(resource1);

		await timeout(0); // service.watch() is async
		assert.equal(disposeCounter, 0);
		watcher1Disposable.dispose();
		assert.equal(disposeCounter, 1);

		disposeCounter = 0;
		const resource2 = URI.parse('test://foo/bar2');
		const watcher2Disposable1 = service.watch(resource2);
		const watcher2Disposable2 = service.watch(resource2);
		const watcher2Disposable3 = service.watch(resource2);

		await timeout(0); // service.watch() is async
		assert.equal(disposeCounter, 0);
		watcher2Disposable1.dispose();
		assert.equal(disposeCounter, 0);
		watcher2Disposable2.dispose();
		assert.equal(disposeCounter, 0);
		watcher2Disposable3.dispose();
		assert.equal(disposeCounter, 1);

		disposeCounter = 0;
		const resource3 = URI.parse('test://foo/bar3');
		const watcher3Disposable1 = service.watch(resource3);
		const watcher3Disposable2 = service.watch(resource3, { recursive: true, excludes: [] });

		await timeout(0); // service.watch() is async
		assert.equal(disposeCounter, 0);
		watcher3Disposable1.dispose();
		assert.equal(disposeCounter, 1);
		watcher3Disposable2.dispose();
		assert.equal(disposeCounter, 2);
	});
});
