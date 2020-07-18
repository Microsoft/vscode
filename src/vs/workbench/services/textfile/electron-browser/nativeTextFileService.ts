/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { AbstractTextFileService } from 'vs/workbench/services/textfile/browser/textFileService';
import { ITextFileService, ITextFileStreamContent, ITextFileContent, IReadTextFileOptions, IWriteTextFileOptions } from 'vs/workbench/services/textfile/common/textfiles';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { URI } from 'vs/base/common/uri';
import { IFileStatWithMetadata, FileOperationError, FileOperationResult, IFileService } from 'vs/platform/files/common/files';
import { Schemas } from 'vs/base/common/network';
import { stat, chmod, MAX_FILE_SIZE, MAX_HEAP_SIZE } from 'vs/base/node/pfs';
import { join, dirname } from 'vs/base/common/path';
import { isMacintosh } from 'vs/base/common/platform';
import { IProductService } from 'vs/platform/product/common/productService';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { UTF8, UTF8_with_bom } from 'vs/workbench/services/textfile/common/encoding';
import { ITextSnapshot } from 'vs/editor/common/model';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IDialogService, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { ILogService } from 'vs/platform/log/common/log';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { IModeService } from 'vs/editor/common/services/modeService';

export class NativeTextFileService extends AbstractTextFileService {

	constructor(
		@IFileService fileService: IFileService,
		@IUntitledTextEditorService untitledTextEditorService: IUntitledTextEditorService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IWorkbenchEnvironmentService protected environmentService: INativeWorkbenchEnvironmentService,
		@IDialogService dialogService: IDialogService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IProductService private readonly productService: IProductService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@ITextModelService textModelService: ITextModelService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IPathService pathService: IPathService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@ILogService private readonly logService: ILogService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IModeService modeService: IModeService
	) {
		super(fileService, untitledTextEditorService, lifecycleService, instantiationService, modelService, environmentService, dialogService, fileDialogService, textResourceConfigurationService, filesConfigurationService, textModelService, codeEditorService, pathService, workingCopyFileService, uriIdentityService, modeService);
	}

	async read(resource: URI, options?: IReadTextFileOptions): Promise<ITextFileContent> {

		// ensure size & memory limits
		options = this.ensureLimits(options);

		return super.read(resource, options);
	}

	async readStream(resource: URI, options?: IReadTextFileOptions): Promise<ITextFileStreamContent> {

		// ensure size & memory limits
		options = this.ensureLimits(options);

		return super.readStream(resource, options);
	}

	private ensureLimits(options?: IReadTextFileOptions): IReadTextFileOptions {
		let ensuredOptions: IReadTextFileOptions;
		if (!options) {
			ensuredOptions = Object.create(null);
		} else {
			ensuredOptions = options;
		}

		let ensuredLimits: { size?: number; memory?: number; };
		if (!ensuredOptions.limits) {
			ensuredLimits = Object.create(null);
			ensuredOptions.limits = ensuredLimits;
		} else {
			ensuredLimits = ensuredOptions.limits;
		}

		if (typeof ensuredLimits.size !== 'number') {
			ensuredLimits.size = MAX_FILE_SIZE;
		}

		if (typeof ensuredLimits.memory !== 'number') {
			const maxMemory = this.environmentService.args['max-memory'];
			ensuredLimits.memory = Math.max(
				typeof maxMemory === 'string'
					? parseInt(maxMemory) * 1024 * 1024 || 0
					: 0, MAX_HEAP_SIZE
			);
		}

		return ensuredOptions;
	}

	async write(resource: URI, value: string | ITextSnapshot, options?: IWriteTextFileOptions): Promise<IFileStatWithMetadata> {

		// check for overwriteReadonly property (only supported for local file://)
		try {
			if (options?.overwriteReadonly && resource.scheme === Schemas.file && await this.fileService.exists(resource)) {
				const fileStat = await stat(resource.fsPath);

				// try to change mode to writeable
				await chmod(resource.fsPath, fileStat.mode | 128);
			}
		} catch (error) {
			// ignore and simply retry the operation
		}

		// check for writeElevated property (only supported for local file://)
		if (options?.writeElevated && resource.scheme === Schemas.file) {
			return this.writeElevated(resource, value, options);
		}

		try {
			return super.write(resource, value, options);
		} catch (error) {

			// In case of permission denied, we need to check for readonly
			if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_PERMISSION_DENIED) {
				let isReadonly = false;
				try {
					const fileStat = await stat(resource.fsPath);
					if (!(fileStat.mode & 128)) {
						isReadonly = true;
					}
				} catch (error) {
					// ignore - rethrow original error
				}

				if (isReadonly) {
					throw new FileOperationError(localize('fileReadOnlyError', "File is Read Only"), FileOperationResult.FILE_READ_ONLY, options);
				}
			}

			throw error;
		}
	}

	private async writeElevated(resource: URI, value: string | ITextSnapshot, options?: IWriteTextFileOptions): Promise<IFileStatWithMetadata> {

		// write into a tmp file first
		const source = URI.file(join(this.environmentService.userDataPath, `code-elevated-${Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 6)}`));
		const { encoding, addBOM } = await this.encoding.getWriteEncoding(resource, options);
		try {
			await this.write(source, value, { encoding: encoding === UTF8 && addBOM ? UTF8_with_bom : encoding });

			// sudo prompt copy
			await this.sudoPromptCopy(source, resource, options);
		} finally {

			// clean up
			await this.fileService.del(source);
		}

		return this.fileService.resolve(resource, { resolveMetadata: true });
	}

	private async sudoPromptCopy(source: URI, target: URI, options?: IWriteTextFileOptions): Promise<void> {

		// load sudo-prompt module lazy
		const sudoPrompt = await import('sudo-prompt');

		return new Promise<void>((resolve, reject) => {
			const promptOptions = {
				name: this.productService.nameLong.replace('-', ''),
				icns: (isMacintosh && this.environmentService.isBuilt) ? join(dirname(this.environmentService.appRoot), `${this.productService.nameShort}.icns`) : undefined
			};

			const sudoCommand: string[] = [`"${this.environmentService.cliPath}"`];
			if (options?.overwriteReadonly) {
				sudoCommand.push('--file-chmod');
			}

			sudoCommand.push('--file-write', `"${source.fsPath}"`, `"${target.fsPath}"`);

			sudoPrompt.exec(sudoCommand.join(' '), promptOptions, (error: string, stdout: string, stderr: string) => {
				if (stdout) {
					this.logService.trace(`[sudo-prompt] received stdout: ${stdout}`);
				}

				if (stderr) {
					this.logService.trace(`[sudo-prompt] received stderr: ${stderr}`);
				}

				if (error) {
					reject(error);
				} else {
					resolve(undefined);
				}
			});
		});
	}
}

registerSingleton(ITextFileService, NativeTextFileService);
