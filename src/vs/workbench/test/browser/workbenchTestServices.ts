/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileEditorInput } from 'vs/workbench/contrib/files/browser/editors/fileEditorInput';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { basename, isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { IEditorInputWithOptions, IEditorIdentifier, IUntitledTextResourceEditorInput, IResourceDiffEditorInput, IEditorInput, IEditorPane, IEditorCloseEvent, IEditorPartOptions, IRevertOptions, GroupIdentifier, EditorsOrder, IFileEditorInput, IEditorFactoryRegistry, IEditorSerializer, EditorExtensions, ISaveOptions, IMoveResult, ITextEditorPane, ITextDiffEditorPane, IVisibleEditorPane, IEditorOpenContext, IEditorMoveEvent, EditorExtensions as Extensions, EditorInputCapabilities, IEditorOpenEvent, IUntypedEditorInput } from 'vs/workbench/common/editor';
import { EditorServiceImpl, IEditorGroupView, IEditorGroupsAccessor, IEditorGroupTitleHeight } from 'vs/workbench/browser/parts/editor/editor';
import { Event, Emitter } from 'vs/base/common/event';
import { IResolvedWorkingCopyBackup, IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService, Parts, Position as PartPosition } from 'vs/workbench/services/layout/browser/layoutService';
import { TextModelResolverService } from 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IEditorOptions, IResourceEditorInput, IEditorModel, IResourceEditorInputIdentifier, ITextResourceEditorInput, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { IUntitledTextEditorService, UntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ILifecycleService, BeforeShutdownEvent, ShutdownReason, StartupKind, LifecyclePhase, WillShutdownEvent } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { FileOperationEvent, IFileService, IFileStat, IResolveFileResult, FileChangesEvent, IResolveFileOptions, ICreateFileOptions, IFileSystemProvider, FileSystemProviderCapabilities, IFileChange, IWatchOptions, IStat, FileType, FileDeleteOptions, FileOverwriteOptions, FileWriteOptions, FileOpenOptions, IFileStatWithMetadata, IResolveMetadataFileOptions, IWriteFileOptions, IReadFileOptions, IFileContent, IFileStreamContent, FileOperationError, IFileSystemProviderWithFileReadStreamCapability, FileReadStreamOptions, IReadFileStreamOptions, IFileSystemProviderCapabilitiesChangeEvent, IRawFileChangesEvent } from 'vs/platform/files/common/files';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ModeServiceImpl } from 'vs/editor/common/services/modeServiceImpl';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { IResourceEncoding, ITextFileService, IReadTextFileOptions, ITextFileStreamContent, IWriteTextFileOptions, ITextFileEditorModel } from 'vs/workbench/services/textfile/common/textfiles';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IInstantiationService, ServiceIdentifier } from 'vs/platform/instantiation/common/instantiation';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { MenuBarVisibility, IWindowOpenable, IOpenWindowOptions, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';
import { TestWorkspace } from 'vs/platform/workspace/test/common/testWorkspace';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { ITextResourceConfigurationService, ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IPosition, Position as EditorPosition } from 'vs/editor/common/core/position';
import { IMenuService, MenuId, IMenu } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { MockContextKeyService, MockKeybindingService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { ITextBufferFactory, DefaultEndOfLine, EndOfLinePreference, ITextSnapshot } from 'vs/editor/common/model';
import { IRange, Range } from 'vs/editor/common/core/range';
import { IDialogService, IPickAndOpenOptions, ISaveDialogOptions, IOpenDialogOptions, IFileDialogService, ConfirmResult } from 'vs/platform/dialogs/common/dialogs';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IDecorationsService, IResourceDecorationChangeEvent, IDecoration, IDecorationData, IDecorationsProvider } from 'vs/workbench/services/decorations/browser/decorations';
import { IDisposable, toDisposable, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IEditorGroupsService, IEditorGroup, GroupsOrder, GroupsArrangement, GroupDirection, IAddGroupOptions, IMergeGroupOptions, IEditorReplacement, IGroupChangeEvent, IFindGroupScope, EditorGroupLayout, ICloseEditorOptions, GroupOrientation, ICloseAllEditorsOptions, ICloseEditorsFilter } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService, ISaveEditorsOptions, IRevertAllEditorsOptions, PreferredGroup } from 'vs/workbench/services/editor/common/editorService';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IEditorPaneRegistry, EditorPaneDescriptor } from 'vs/workbench/browser/editor';
import { Dimension, IDimension } from 'vs/base/browser/dom';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { ILabelService } from 'vs/platform/label/common/label';
import { timeout } from 'vs/base/common/async';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { ViewletDescriptor, Viewlet } from 'vs/workbench/browser/viewlet';
import { IViewlet } from 'vs/workbench/common/viewlet';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IProcessEnvironment, isLinux, isWindows, OperatingSystem } from 'vs/base/common/platform';
import { LabelService } from 'vs/workbench/services/label/common/labelService';
import { Part } from 'vs/workbench/browser/part';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IPanel } from 'vs/workbench/common/panel';
import { IBadge } from 'vs/workbench/services/activity/common/activity';
import { bufferToStream, VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';
import { Schemas } from 'vs/base/common/network';
import { IProductService } from 'vs/platform/product/common/productService';
import product from 'vs/platform/product/common/product';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IWorkingCopyService, WorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkingCopyBackupMeta, IWorkingCopyIdentifier } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { IFilesConfigurationService, FilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IAccessibilityService, AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { BrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
import { BrowserTextFileService } from 'vs/workbench/services/textfile/browser/browserTextFileService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { createTextBufferFactoryFromStream } from 'vs/editor/common/model/textModel';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { Direction } from 'vs/base/browser/ui/grid/grid';
import { IProgressService, IProgressOptions, IProgressWindowOptions, IProgressNotificationOptions, IProgressCompositeOptions, IProgress, IProgressStep, Progress, IProgressDialogOptions } from 'vs/platform/progress/common/progress';
import { IWorkingCopyFileService, WorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { CancellationToken } from 'vs/base/common/cancellation';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { TestDialogService } from 'vs/platform/dialogs/test/common/testDialogService';
import { CodeEditorService } from 'vs/workbench/services/editor/browser/codeEditorService';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IChange, IDiffEditor, IEditor } from 'vs/editor/common/editorCommon';
import { IInputBox, IInputOptions, IPickOptions, IQuickInputButton, IQuickInputService, IQuickNavigateConfiguration, IQuickPick, IQuickPickItem, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { QuickInputService } from 'vs/workbench/services/quickinput/browser/quickInputService';
import { IListService } from 'vs/platform/list/browser/listService';
import { win32, posix } from 'vs/base/common/path';
import { TestContextService, TestStorageService, TestTextResourcePropertiesService, TestExtensionService } from 'vs/workbench/test/common/workbenchTestServices';
import { IViewsService, IView, ViewContainer, ViewContainerLocation } from 'vs/workbench/common/views';
import { IPaneComposite } from 'vs/workbench/common/panecomposite';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { newWriteableStream, ReadableStreamEvents } from 'vs/base/common/stream';
import { EncodingOracle, IEncodingOverride } from 'vs/workbench/services/textfile/browser/textFileService';
import { UTF16le, UTF16be, UTF8_with_bom } from 'vs/workbench/services/textfile/common/encoding';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { Iterable } from 'vs/base/common/iterator';
import { InMemoryWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackupService';
import { BrowserWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/browser/workingCopyBackupService';
import { FileService } from 'vs/platform/files/common/fileService';
import { TextResourceEditor } from 'vs/workbench/browser/parts/editor/textResourceEditor';
import { TestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { TextFileEditor } from 'vs/workbench/contrib/files/browser/editors/textFileEditor';
import { TextResourceEditorInput } from 'vs/workbench/common/editor/textResourceEditorInput';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { SideBySideEditor } from 'vs/workbench/browser/parts/editor/sideBySideEditor';
import { IEnterWorkspaceResult, IRecent, IRecentlyOpened, IWorkspaceFolderCreationData, IWorkspaceIdentifier, IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust';
import { TestWorkspaceTrustManagementService, TestWorkspaceTrustRequestService } from 'vs/workbench/services/workspaces/test/common/testWorkspaceTrustService';
import { ICreateTerminalOptions, IShellLaunchConfig, ITerminalChildProcess, ITerminalProfile, ITerminalsLayoutInfo, ITerminalsLayoutInfoById, TerminalLocation, TerminalShellType } from 'vs/platform/terminal/common/terminal';
import { IProcessDetails, ISetTerminalLayoutInfoArgs } from 'vs/platform/terminal/common/terminalProcess';
import { ITerminalInstance, ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { isArray } from 'vs/base/common/types';
import { ILocalTerminalService, IShellLaunchConfigResolveOptions, ITerminalProfileResolverService } from 'vs/workbench/contrib/terminal/common/terminal';
import { EditorResolverService } from 'vs/workbench/services/editor/browser/editorResolverService';
import { FILE_EDITOR_INPUT_ID } from 'vs/workbench/contrib/files/common/files';
import { IEditorResolverService } from 'vs/workbench/services/editor/common/editorResolverService';
import { IWorkingCopyEditorService, WorkingCopyEditorService } from 'vs/workbench/services/workingCopy/common/workingCopyEditorService';
import { IElevatedFileService } from 'vs/workbench/services/files/common/elevatedFileService';
import { BrowserElevatedFileService } from 'vs/workbench/services/files/browser/elevatedFileService';
import { IDiffComputationResult, IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { TextEdit, IInplaceReplaceSupportResult } from 'vs/editor/common/modes';
import { ResourceMap } from 'vs/base/common/map';
import { SideBySideEditorInput } from 'vs/workbench/common/editor/sideBySideEditorInput';

export function createFileEditorInput(instantiationService: IInstantiationService, resource: URI): FileEditorInput {
	return instantiationService.createInstance(FileEditorInput, resource, undefined, undefined, undefined, undefined, undefined, undefined);
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerFileEditorFactory({

	typeId: FILE_EDITOR_INPUT_ID,

	createFileEditor: (resource, preferredResource, preferredName, preferredDescription, preferredEncoding, preferredMode, preferredContents, instantiationService): IFileEditorInput => {
		return instantiationService.createInstance(FileEditorInput, resource, preferredResource, preferredName, preferredDescription, preferredEncoding, preferredMode, preferredContents);
	},

	isFileEditor: (obj): obj is IFileEditorInput => {
		return obj instanceof FileEditorInput;
	}
});

export class TestTextResourceEditor extends TextResourceEditor {

	protected override createEditorControl(parent: HTMLElement, configuration: any): IEditor {
		return this.instantiationService.createInstance(TestCodeEditor, parent, configuration, {});
	}
}

export class TestTextFileEditor extends TextFileEditor {

	lastSetOptions: ITextEditorOptions | undefined = undefined;

	override setOptions(options: ITextEditorOptions | undefined): void {
		this.lastSetOptions = options;

		super.setOptions(options);
	}

	protected override createEditorControl(parent: HTMLElement, configuration: any): IEditor {
		return this.instantiationService.createInstance(TestCodeEditor, parent, configuration, {});
	}
}

export interface ITestInstantiationService extends IInstantiationService {
	stub<T>(service: ServiceIdentifier<T>, ctor: any): T;
}

export function workbenchInstantiationService(
	overrides?: {
		textFileService?: (instantiationService: IInstantiationService) => ITextFileService;
		pathService?: (instantiationService: IInstantiationService) => IPathService,
		editorService?: (instantiationService: IInstantiationService) => IEditorService,
		contextKeyService?: (instantiationService: IInstantiationService) => IContextKeyService,
	},
	disposables: DisposableStore = new DisposableStore()
): ITestInstantiationService {
	const instantiationService = new TestInstantiationService(new ServiceCollection([ILifecycleService, new TestLifecycleService()]));

	instantiationService.stub(IEditorWorkerService, new TestEditorWorkerService());
	instantiationService.stub(IWorkingCopyService, disposables.add(new WorkingCopyService()));
	instantiationService.stub(IEnvironmentService, TestEnvironmentService);
	instantiationService.stub(IWorkbenchEnvironmentService, TestEnvironmentService);
	const contextKeyService = overrides?.contextKeyService ? overrides.contextKeyService(instantiationService) : instantiationService.createInstance(MockContextKeyService);
	instantiationService.stub(IContextKeyService, contextKeyService);
	instantiationService.stub(IProgressService, new TestProgressService());
	const workspaceContextService = new TestContextService(TestWorkspace);
	instantiationService.stub(IWorkspaceContextService, workspaceContextService);
	const configService = new TestConfigurationService({
		files: {
			participants: {
				timeout: 60000
			}
		}
	});
	instantiationService.stub(IConfigurationService, configService);
	instantiationService.stub(IFilesConfigurationService, disposables.add(new TestFilesConfigurationService(contextKeyService, configService)));
	instantiationService.stub(ITextResourceConfigurationService, new TestTextResourceConfigurationService(configService));
	instantiationService.stub(IUntitledTextEditorService, disposables.add(instantiationService.createInstance(UntitledTextEditorService)));
	instantiationService.stub(IStorageService, disposables.add(new TestStorageService()));
	instantiationService.stub(IPathService, overrides?.pathService ? overrides.pathService(instantiationService) : new TestPathService());
	const layoutService = new TestLayoutService();
	instantiationService.stub(IWorkbenchLayoutService, layoutService);
	instantiationService.stub(IDialogService, new TestDialogService());
	const accessibilityService = new TestAccessibilityService();
	instantiationService.stub(IAccessibilityService, accessibilityService);
	instantiationService.stub(IFileDialogService, instantiationService.createInstance(TestFileDialogService));
	instantiationService.stub(IModeService, disposables.add(instantiationService.createInstance(ModeServiceImpl)));
	instantiationService.stub(IHistoryService, new TestHistoryService());
	instantiationService.stub(ITextResourcePropertiesService, new TestTextResourcePropertiesService(configService));
	instantiationService.stub(IUndoRedoService, instantiationService.createInstance(UndoRedoService));
	const themeService = new TestThemeService();
	instantiationService.stub(IThemeService, themeService);
	instantiationService.stub(IModelService, disposables.add(instantiationService.createInstance(ModelServiceImpl)));
	const fileService = new TestFileService();
	instantiationService.stub(IFileService, fileService);
	instantiationService.stub(IUriIdentityService, new UriIdentityService(fileService));
	instantiationService.stub(IWorkingCopyBackupService, new TestWorkingCopyBackupService());
	instantiationService.stub(ITelemetryService, NullTelemetryService);
	instantiationService.stub(INotificationService, new TestNotificationService());
	instantiationService.stub(IUntitledTextEditorService, disposables.add(instantiationService.createInstance(UntitledTextEditorService)));
	instantiationService.stub(IMenuService, new TestMenuService());
	const keybindingService = new MockKeybindingService();
	instantiationService.stub(IKeybindingService, keybindingService);
	instantiationService.stub(IDecorationsService, new TestDecorationsService());
	instantiationService.stub(IExtensionService, new TestExtensionService());
	instantiationService.stub(IWorkingCopyFileService, disposables.add(instantiationService.createInstance(WorkingCopyFileService)));
	instantiationService.stub(ITextFileService, overrides?.textFileService ? overrides.textFileService(instantiationService) : disposables.add(<ITextFileService>instantiationService.createInstance(TestTextFileService)));
	instantiationService.stub(IHostService, <IHostService>instantiationService.createInstance(TestHostService));
	instantiationService.stub(ITextModelService, <ITextModelService>disposables.add(instantiationService.createInstance(TextModelResolverService)));
	instantiationService.stub(ILogService, new NullLogService());
	const editorGroupService = new TestEditorGroupsService([new TestEditorGroupView(0)]);
	instantiationService.stub(IEditorGroupsService, editorGroupService);
	instantiationService.stub(ILabelService, <ILabelService>disposables.add(instantiationService.createInstance(LabelService)));
	const editorService = overrides?.editorService ? overrides.editorService(instantiationService) : new TestEditorService(editorGroupService);
	instantiationService.stub(IEditorService, editorService);
	instantiationService.stub(IWorkingCopyEditorService, disposables.add(instantiationService.createInstance(WorkingCopyEditorService)));
	instantiationService.stub(IEditorResolverService, disposables.add(instantiationService.createInstance(EditorResolverService)));
	instantiationService.stub(ICodeEditorService, disposables.add(new CodeEditorService(editorService, themeService, configService)));
	instantiationService.stub(IViewletService, new TestViewletService());
	instantiationService.stub(IListService, new TestListService());
	instantiationService.stub(IQuickInputService, disposables.add(new QuickInputService(configService, instantiationService, keybindingService, contextKeyService, themeService, accessibilityService, layoutService)));
	instantiationService.stub(IWorkspacesService, new TestWorkspacesService());
	instantiationService.stub(IWorkspaceTrustManagementService, new TestWorkspaceTrustManagementService());
	instantiationService.stub(ITerminalInstanceService, new TestTerminalInstanceService());
	instantiationService.stub(ILocalTerminalService, new TestLocalTerminalService());
	instantiationService.stub(IElevatedFileService, new BrowserElevatedFileService());

	return instantiationService;
}

export class TestServiceAccessor {
	constructor(
		@ILifecycleService public lifecycleService: TestLifecycleService,
		@ITextFileService public textFileService: TestTextFileService,
		@IWorkingCopyFileService public workingCopyFileService: IWorkingCopyFileService,
		@IFilesConfigurationService public filesConfigurationService: TestFilesConfigurationService,
		@IWorkspaceContextService public contextService: TestContextService,
		@IModelService public modelService: ModelServiceImpl,
		@IFileService public fileService: TestFileService,
		@IFileDialogService public fileDialogService: TestFileDialogService,
		@IDialogService public dialogService: TestDialogService,
		@IWorkingCopyService public workingCopyService: IWorkingCopyService,
		@IEditorService public editorService: TestEditorService,
		@IWorkbenchEnvironmentService public environmentService: IWorkbenchEnvironmentService,
		@IPathService public pathService: IPathService,
		@IEditorGroupsService public editorGroupService: IEditorGroupsService,
		@IEditorResolverService public editorResolverService: IEditorResolverService,
		@IModeService public modeService: IModeService,
		@ITextModelService public textModelResolverService: ITextModelService,
		@IUntitledTextEditorService public untitledTextEditorService: UntitledTextEditorService,
		@IConfigurationService public testConfigurationService: TestConfigurationService,
		@IWorkingCopyBackupService public workingCopyBackupService: TestWorkingCopyBackupService,
		@IHostService public hostService: TestHostService,
		@IQuickInputService public quickInputService: IQuickInputService,
		@ILabelService public labelService: ILabelService,
		@ILogService public logService: ILogService,
		@IUriIdentityService public uriIdentityService: IUriIdentityService,
		@IInstantiationService public instantitionService: IInstantiationService,
		@INotificationService public notificationService: INotificationService,
		@IWorkingCopyEditorService public workingCopyEditorService: IWorkingCopyEditorService,
		@IInstantiationService public instantiationService: IInstantiationService,
		@IElevatedFileService public elevatedFileService: IElevatedFileService,
		@IWorkspaceTrustRequestService public workspaceTrustRequestService: TestWorkspaceTrustRequestService
	) { }
}

export class TestTextFileService extends BrowserTextFileService {
	private readStreamError: FileOperationError | undefined = undefined;
	private writeError: FileOperationError | undefined = undefined;

	constructor(
		@IFileService fileService: IFileService,
		@IUntitledTextEditorService untitledTextEditorService: IUntitledTextEditorService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IDialogService dialogService: IDialogService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IProductService productService: IProductService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@ITextModelService textModelService: ITextModelService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IPathService pathService: IPathService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IModeService modeService: IModeService,
		@ILogService logService: ILogService,
		@IElevatedFileService elevatedFileService: IElevatedFileService
	) {
		super(
			fileService,
			untitledTextEditorService,
			lifecycleService,
			instantiationService,
			modelService,
			environmentService,
			dialogService,
			fileDialogService,
			textResourceConfigurationService,
			filesConfigurationService,
			textModelService,
			codeEditorService,
			pathService,
			workingCopyFileService,
			uriIdentityService,
			modeService,
			elevatedFileService,
			logService
		);
	}

	setReadStreamErrorOnce(error: FileOperationError): void {
		this.readStreamError = error;
	}

	override async readStream(resource: URI, options?: IReadTextFileOptions): Promise<ITextFileStreamContent> {
		if (this.readStreamError) {
			const error = this.readStreamError;
			this.readStreamError = undefined;

			throw error;
		}

		const content = await this.fileService.readFileStream(resource, options);
		return {
			resource: content.resource,
			name: content.name,
			mtime: content.mtime,
			ctime: content.ctime,
			etag: content.etag,
			encoding: 'utf8',
			value: await createTextBufferFactoryFromStream(content.value),
			size: 10,
			readonly: false
		};
	}

	setWriteErrorOnce(error: FileOperationError): void {
		this.writeError = error;
	}

	override async write(resource: URI, value: string | ITextSnapshot, options?: IWriteTextFileOptions): Promise<IFileStatWithMetadata> {
		if (this.writeError) {
			const error = this.writeError;
			this.writeError = undefined;

			throw error;
		}

		return super.write(resource, value, options);
	}
}

export class TestBrowserTextFileServiceWithEncodingOverrides extends BrowserTextFileService {

	private _testEncoding: TestEncodingOracle | undefined;
	override get encoding(): TestEncodingOracle {
		if (!this._testEncoding) {
			this._testEncoding = this._register(this.instantiationService.createInstance(TestEncodingOracle));
		}

		return this._testEncoding;
	}
}

export class TestEncodingOracle extends EncodingOracle {

	protected override get encodingOverrides(): IEncodingOverride[] {
		return [
			{ extension: 'utf16le', encoding: UTF16le },
			{ extension: 'utf16be', encoding: UTF16be },
			{ extension: 'utf8bom', encoding: UTF8_with_bom }
		];
	}

	protected override set encodingOverrides(overrides: IEncodingOverride[]) { }
}

class TestEnvironmentServiceWithArgs extends BrowserWorkbenchEnvironmentService {
	args = [];
}

export const TestProductService = { _serviceBrand: undefined, ...product };

export const TestEnvironmentService = new TestEnvironmentServiceWithArgs(Object.create(null), TestProductService);

export class TestProgressService implements IProgressService {

	declare readonly _serviceBrand: undefined;

	withProgress(
		options: IProgressOptions | IProgressDialogOptions | IProgressWindowOptions | IProgressNotificationOptions | IProgressCompositeOptions,
		task: (progress: IProgress<IProgressStep>) => Promise<any>,
		onDidCancel?: ((choice?: number | undefined) => void) | undefined
	): Promise<any> {
		return task(Progress.None);
	}
}

export class TestAccessibilityService implements IAccessibilityService {

	declare readonly _serviceBrand: undefined;

	onDidChangeScreenReaderOptimized = Event.None;

	isScreenReaderOptimized(): boolean { return false; }
	alwaysUnderlineAccessKeys(): Promise<boolean> { return Promise.resolve(false); }
	setAccessibilitySupport(accessibilitySupport: AccessibilitySupport): void { }
	getAccessibilitySupport(): AccessibilitySupport { return AccessibilitySupport.Unknown; }
}

export class TestDecorationsService implements IDecorationsService {

	declare readonly _serviceBrand: undefined;

	onDidChangeDecorations: Event<IResourceDecorationChangeEvent> = Event.None;

	registerDecorationsProvider(_provider: IDecorationsProvider): IDisposable { return Disposable.None; }
	getDecoration(_uri: URI, _includeChildren: boolean, _overwrite?: IDecorationData): IDecoration | undefined { return undefined; }
}

export class TestMenuService implements IMenuService {

	declare readonly _serviceBrand: undefined;

	createMenu(_id: MenuId, _scopedKeybindingService: IContextKeyService): IMenu {
		return {
			onDidChange: Event.None,
			dispose: () => undefined,
			getActions: () => []
		};
	}
}

export class TestHistoryService implements IHistoryService {

	declare readonly _serviceBrand: undefined;

	constructor(private root?: URI) { }

	reopenLastClosedEditor(): void { }
	forward(): void { }
	back(): void { }
	last(): void { }
	removeFromHistory(_input: IEditorInput | IResourceEditorInput): void { }
	clear(): void { }
	clearRecentlyOpened(): void { }
	getHistory(): readonly (IEditorInput | IResourceEditorInput)[] { return []; }
	openNextRecentlyUsedEditor(group?: GroupIdentifier): void { }
	openPreviouslyUsedEditor(group?: GroupIdentifier): void { }
	getLastActiveWorkspaceRoot(_schemeFilter: string): URI | undefined { return this.root; }
	getLastActiveFile(_schemeFilter: string): URI | undefined { return undefined; }
	openLastEditLocation(): void { }
}

export class TestFileDialogService implements IFileDialogService {

	declare readonly _serviceBrand: undefined;

	private confirmResult!: ConfirmResult;

	constructor(
		@IPathService private readonly pathService: IPathService
	) { }
	async defaultFilePath(_schemeFilter?: string): Promise<URI> { return this.pathService.userHome(); }
	async defaultFolderPath(_schemeFilter?: string): Promise<URI> { return this.pathService.userHome(); }
	async defaultWorkspacePath(_schemeFilter?: string): Promise<URI> { return this.pathService.userHome(); }
	pickFileFolderAndOpen(_options: IPickAndOpenOptions): Promise<any> { return Promise.resolve(0); }
	pickFileAndOpen(_options: IPickAndOpenOptions): Promise<any> { return Promise.resolve(0); }
	pickFolderAndOpen(_options: IPickAndOpenOptions): Promise<any> { return Promise.resolve(0); }
	pickWorkspaceAndOpen(_options: IPickAndOpenOptions): Promise<any> { return Promise.resolve(0); }

	private fileToSave!: URI;
	setPickFileToSave(path: URI): void { this.fileToSave = path; }
	pickFileToSave(defaultUri: URI, availableFileSystems?: string[]): Promise<URI | undefined> { return Promise.resolve(this.fileToSave); }

	showSaveDialog(_options: ISaveDialogOptions): Promise<URI | undefined> { return Promise.resolve(undefined); }
	showOpenDialog(_options: IOpenDialogOptions): Promise<URI[] | undefined> { return Promise.resolve(undefined); }

	setConfirmResult(result: ConfirmResult): void { this.confirmResult = result; }
	showSaveConfirm(fileNamesOrResources: (string | URI)[]): Promise<ConfirmResult> { return Promise.resolve(this.confirmResult); }
}

export class TestLayoutService implements IWorkbenchLayoutService {

	declare readonly _serviceBrand: undefined;

	openedDefaultEditors = false;

	dimension: IDimension = { width: 800, height: 600 };

	container: HTMLElement = window.document.body;

	onDidChangeZenMode: Event<boolean> = Event.None;
	onDidChangeCenteredLayout: Event<boolean> = Event.None;
	onDidChangeFullscreen: Event<boolean> = Event.None;
	onDidChangeWindowMaximized: Event<boolean> = Event.None;
	onDidChangePanelPosition: Event<string> = Event.None;
	onDidChangePartVisibility: Event<void> = Event.None;
	onDidLayout = Event.None;
	onDidChangeNotificationsVisibility = Event.None;

	layout(): void { }
	isRestored(): boolean { return true; }
	whenReady: Promise<void> = Promise.resolve(undefined);
	whenRestored: Promise<void> = Promise.resolve(undefined);
	hasFocus(_part: Parts): boolean { return false; }
	focusPart(_part: Parts): void { }
	hasWindowBorder(): boolean { return false; }
	getWindowBorderWidth(): number { return 0; }
	getWindowBorderRadius(): string | undefined { return undefined; }
	isVisible(_part: Parts): boolean { return true; }
	getDimension(_part: Parts): Dimension { return new Dimension(0, 0); }
	getContainer(_part: Parts): HTMLElement { return null!; }
	isTitleBarHidden(): boolean { return false; }
	isStatusBarHidden(): boolean { return false; }
	isActivityBarHidden(): boolean { return false; }
	setActivityBarHidden(_hidden: boolean): void { }
	setBannerHidden(_hidden: boolean): void { }
	isSideBarHidden(): boolean { return false; }
	async setEditorHidden(_hidden: boolean): Promise<void> { }
	async setSideBarHidden(_hidden: boolean): Promise<void> { }
	isPanelHidden(): boolean { return false; }
	async setPanelHidden(_hidden: boolean): Promise<void> { }
	toggleMaximizedPanel(): void { }
	isPanelMaximized(): boolean { return false; }
	getMenubarVisibility(): MenuBarVisibility { throw new Error('not implemented'); }
	toggleMenuBar(): void { }
	getSideBarPosition() { return 0; }
	getPanelPosition() { return 0; }
	async setPanelPosition(_position: PartPosition): Promise<void> { }
	addClass(_clazz: string): void { }
	removeClass(_clazz: string): void { }
	getMaximumEditorDimensions(): Dimension { throw new Error('not implemented'); }
	toggleZenMode(): void { }
	isEditorLayoutCentered(): boolean { return false; }
	centerEditorLayout(_active: boolean): void { }
	resizePart(_part: Parts, _sizeChangeWidth: number, _sizeChangeHeight: number): void { }
	registerPart(part: Part): void { }
	isWindowMaximized() { return false; }
	updateWindowMaximizedState(maximized: boolean): void { }
	getVisibleNeighborPart(part: Parts, direction: Direction): Parts | undefined { return undefined; }
	focus() { }
}

let activeViewlet: Viewlet = {} as any;

export class TestViewletService implements IViewletService {
	declare readonly _serviceBrand: undefined;

	onDidViewletRegisterEmitter = new Emitter<ViewletDescriptor>();
	onDidViewletDeregisterEmitter = new Emitter<ViewletDescriptor>();
	onDidViewletOpenEmitter = new Emitter<IViewlet>();
	onDidViewletCloseEmitter = new Emitter<IViewlet>();

	onDidViewletRegister = this.onDidViewletRegisterEmitter.event;
	onDidViewletDeregister = this.onDidViewletDeregisterEmitter.event;
	onDidViewletOpen = this.onDidViewletOpenEmitter.event;
	onDidViewletClose = this.onDidViewletCloseEmitter.event;

	openViewlet(id: string, focus?: boolean): Promise<IViewlet | undefined> { return Promise.resolve(undefined); }
	getViewlets(): ViewletDescriptor[] { return []; }
	getAllViewlets(): ViewletDescriptor[] { return []; }
	getActiveViewlet(): IViewlet { return activeViewlet; }
	getDefaultViewletId(): string { return 'workbench.view.explorer'; }
	getViewlet(id: string): ViewletDescriptor | undefined { return undefined; }
	getProgressIndicator(id: string) { return undefined; }
	hideActiveViewlet(): void { }
	getLastActiveViewletId(): string { return undefined!; }
	dispose() { }
}

export class TestPanelService implements IPanelService {
	declare readonly _serviceBrand: undefined;

	onDidPanelOpen = new Emitter<{ panel: IPanel, focus: boolean; }>().event;
	onDidPanelClose = new Emitter<IPanel>().event;

	async openPanel(id?: string, focus?: boolean): Promise<undefined> { return undefined; }
	getPanel(id: string): any { return activeViewlet; }
	getPanels() { return []; }
	getPinnedPanels() { return []; }
	getActivePanel(): IPanel { return activeViewlet; }
	setPanelEnablement(id: string, enabled: boolean): void { }
	dispose() { }
	showActivity(panelId: string, badge: IBadge, clazz?: string): IDisposable { throw new Error('Method not implemented.'); }
	getProgressIndicator(id: string) { return null!; }
	hideActivePanel(): void { }
	getLastActivePanelId(): string { return undefined!; }
}

export class TestViewsService implements IViewsService {
	declare readonly _serviceBrand: undefined;


	onDidChangeViewContainerVisibility = new Emitter<{ id: string; visible: boolean; location: ViewContainerLocation; }>().event;
	isViewContainerVisible(id: string): boolean { return true; }
	getVisibleViewContainer(): ViewContainer | null { return null; }
	openViewContainer(id: string, focus?: boolean): Promise<IPaneComposite | null> { return Promise.resolve(null); }
	closeViewContainer(id: string): void { }

	onDidChangeViewVisibilityEmitter = new Emitter<{ id: string; visible: boolean; }>();
	onDidChangeViewVisibility = this.onDidChangeViewVisibilityEmitter.event;
	isViewVisible(id: string): boolean { return true; }
	getActiveViewWithId<T extends IView>(id: string): T | null { return null; }
	getViewWithId<T extends IView>(id: string): T | null { return null; }
	openView<T extends IView>(id: string, focus?: boolean | undefined): Promise<T | null> { return Promise.resolve(null); }
	closeView(id: string): void { }
	getViewProgressIndicator(id: string) { return null!; }
	getActiveViewPaneContainerWithId(id: string) { return null; }
}

export class TestEditorGroupsService implements IEditorGroupsService {

	declare readonly _serviceBrand: undefined;

	constructor(public groups: TestEditorGroupView[] = []) { }

	onDidChangeActiveGroup: Event<IEditorGroup> = Event.None;
	onDidActivateGroup: Event<IEditorGroup> = Event.None;
	onDidAddGroup: Event<IEditorGroup> = Event.None;
	onDidRemoveGroup: Event<IEditorGroup> = Event.None;
	onDidMoveGroup: Event<IEditorGroup> = Event.None;
	onDidChangeGroupIndex: Event<IEditorGroup> = Event.None;
	onDidLayout: Event<IDimension> = Event.None;
	onDidChangeEditorPartOptions = Event.None;

	orientation = GroupOrientation.HORIZONTAL;
	whenReady: Promise<void> = Promise.resolve(undefined);
	whenRestored: Promise<void> = Promise.resolve(undefined);
	hasRestorableState = false;

	contentDimension = { width: 800, height: 600 };

	get activeGroup(): IEditorGroup { return this.groups[0]; }
	get count(): number { return this.groups.length; }

	getGroups(_order?: GroupsOrder): readonly IEditorGroup[] { return this.groups; }
	getGroup(identifier: number): IEditorGroup | undefined { return this.groups.find(group => group.id === identifier); }
	getLabel(_identifier: number): string { return 'Group 1'; }
	findGroup(_scope: IFindGroupScope, _source?: number | IEditorGroup, _wrap?: boolean): IEditorGroup { throw new Error('not implemented'); }
	activateGroup(_group: number | IEditorGroup): IEditorGroup { throw new Error('not implemented'); }
	restoreGroup(_group: number | IEditorGroup): IEditorGroup { throw new Error('not implemented'); }
	getSize(_group: number | IEditorGroup): { width: number, height: number; } { return { width: 100, height: 100 }; }
	setSize(_group: number | IEditorGroup, _size: { width: number, height: number; }): void { }
	arrangeGroups(_arrangement: GroupsArrangement): void { }
	applyLayout(_layout: EditorGroupLayout): void { }
	setGroupOrientation(_orientation: GroupOrientation): void { }
	addGroup(_location: number | IEditorGroup, _direction: GroupDirection, _options?: IAddGroupOptions): IEditorGroup { throw new Error('not implemented'); }
	removeGroup(_group: number | IEditorGroup): void { }
	moveGroup(_group: number | IEditorGroup, _location: number | IEditorGroup, _direction: GroupDirection): IEditorGroup { throw new Error('not implemented'); }
	mergeGroup(_group: number | IEditorGroup, _target: number | IEditorGroup, _options?: IMergeGroupOptions): IEditorGroup { throw new Error('not implemented'); }
	mergeAllGroups(): IEditorGroup { throw new Error('not implemented'); }
	copyGroup(_group: number | IEditorGroup, _location: number | IEditorGroup, _direction: GroupDirection): IEditorGroup { throw new Error('not implemented'); }
	centerLayout(active: boolean): void { }
	isLayoutCentered(): boolean { return false; }

	partOptions!: IEditorPartOptions;
	enforcePartOptions(options: IEditorPartOptions): IDisposable { return Disposable.None; }
}

export class TestEditorGroupView implements IEditorGroupView {

	constructor(public id: number) { }

	activeEditorPane!: IVisibleEditorPane;
	activeEditor!: IEditorInput;
	previewEditor!: IEditorInput;
	count!: number;
	stickyCount!: number;
	disposed!: boolean;
	editors: readonly IEditorInput[] = [];
	label!: string;
	ariaLabel!: string;
	index!: number;
	whenRestored: Promise<void> = Promise.resolve(undefined);
	element!: HTMLElement;
	minimumWidth!: number;
	maximumWidth!: number;
	minimumHeight!: number;
	maximumHeight!: number;

	titleHeight!: IEditorGroupTitleHeight;

	isEmpty = true;
	isMinimized = false;

	onWillDispose: Event<void> = Event.None;
	onDidGroupChange: Event<IGroupChangeEvent> = Event.None;
	onWillCloseEditor: Event<IEditorCloseEvent> = Event.None;
	onDidCloseEditor: Event<IEditorCloseEvent> = Event.None;
	onDidOpenEditorFail: Event<IEditorInput> = Event.None;
	onDidFocus: Event<void> = Event.None;
	onDidChange: Event<{ width: number; height: number; }> = Event.None;
	onWillMoveEditor: Event<IEditorMoveEvent> = Event.None;
	onWillOpenEditor: Event<IEditorOpenEvent> = Event.None;

	getEditors(_order?: EditorsOrder): readonly IEditorInput[] { return []; }
	findEditors(_resource: URI): readonly IEditorInput[] { return []; }
	getEditorByIndex(_index: number): IEditorInput { throw new Error('not implemented'); }
	getIndexOfEditor(_editor: IEditorInput): number { return -1; }
	openEditor(_editor: IEditorInput, _options?: IEditorOptions): Promise<IEditorPane> { throw new Error('not implemented'); }
	openEditors(_editors: IEditorInputWithOptions[]): Promise<IEditorPane> { throw new Error('not implemented'); }
	isPinned(_editor: IEditorInput): boolean { return false; }
	isSticky(_editor: IEditorInput): boolean { return false; }
	isActive(_editor: IEditorInput | IUntypedEditorInput): boolean { return false; }
	contains(candidate: IEditorInput | IUntypedEditorInput): boolean { return false; }
	moveEditor(_editor: IEditorInput, _target: IEditorGroup, _options?: IEditorOptions): void { }
	copyEditor(_editor: IEditorInput, _target: IEditorGroup, _options?: IEditorOptions): void { }
	async closeEditor(_editor?: IEditorInput, options?: ICloseEditorOptions): Promise<void> { }
	async closeEditors(_editors: IEditorInput[] | ICloseEditorsFilter, options?: ICloseEditorOptions): Promise<void> { }
	async closeAllEditors(options?: ICloseAllEditorsOptions): Promise<void> { }
	async replaceEditors(_editors: IEditorReplacement[]): Promise<void> { }
	pinEditor(_editor?: IEditorInput): void { }
	stickEditor(editor?: IEditorInput | undefined): void { }
	unstickEditor(editor?: IEditorInput | undefined): void { }
	focus(): void { }
	get scopedContextKeyService(): IContextKeyService { throw new Error('not implemented'); }
	setActive(_isActive: boolean): void { }
	notifyIndexChanged(_index: number): void { }
	dispose(): void { }
	toJSON(): object { return Object.create(null); }
	layout(_width: number, _height: number): void { }
	relayout() { }
}

export class TestEditorGroupAccessor implements IEditorGroupsAccessor {

	groups: IEditorGroupView[] = [];
	activeGroup!: IEditorGroupView;

	partOptions: IEditorPartOptions = {};

	onDidChangeEditorPartOptions = Event.None;
	onDidVisibilityChange = Event.None;

	getGroup(identifier: number): IEditorGroupView | undefined { throw new Error('Method not implemented.'); }
	getGroups(order: GroupsOrder): IEditorGroupView[] { throw new Error('Method not implemented.'); }
	activateGroup(identifier: number | IEditorGroupView): IEditorGroupView { throw new Error('Method not implemented.'); }
	restoreGroup(identifier: number | IEditorGroupView): IEditorGroupView { throw new Error('Method not implemented.'); }
	addGroup(location: number | IEditorGroupView, direction: GroupDirection, options?: IAddGroupOptions | undefined): IEditorGroupView { throw new Error('Method not implemented.'); }
	mergeGroup(group: number | IEditorGroupView, target: number | IEditorGroupView, options?: IMergeGroupOptions | undefined): IEditorGroupView { throw new Error('Method not implemented.'); }
	moveGroup(group: number | IEditorGroupView, location: number | IEditorGroupView, direction: GroupDirection): IEditorGroupView { throw new Error('Method not implemented.'); }
	copyGroup(group: number | IEditorGroupView, location: number | IEditorGroupView, direction: GroupDirection): IEditorGroupView { throw new Error('Method not implemented.'); }
	removeGroup(group: number | IEditorGroupView): void { throw new Error('Method not implemented.'); }
	arrangeGroups(arrangement: GroupsArrangement, target?: number | IEditorGroupView | undefined): void { throw new Error('Method not implemented.'); }
}

export class TestEditorService implements EditorServiceImpl {

	declare readonly _serviceBrand: undefined;

	onDidActiveEditorChange: Event<void> = Event.None;
	onDidVisibleEditorsChange: Event<void> = Event.None;
	onDidCloseEditor: Event<IEditorCloseEvent> = Event.None;
	onDidOpenEditorFail: Event<IEditorIdentifier> = Event.None;
	onDidMostRecentlyActiveEditorsChange: Event<void> = Event.None;

	private _activeTextEditorControl: ICodeEditor | IDiffEditor | undefined;
	public get activeTextEditorControl(): ICodeEditor | IDiffEditor | undefined { return this._activeTextEditorControl; }
	public set activeTextEditorControl(value: ICodeEditor | IDiffEditor | undefined) { this._activeTextEditorControl = value; }

	activeEditorPane: IVisibleEditorPane | undefined;
	activeTextEditorMode: string | undefined;

	private _activeEditor: IEditorInput | undefined;
	public get activeEditor(): IEditorInput | undefined { return this._activeEditor; }
	public set activeEditor(value: IEditorInput | undefined) { this._activeEditor = value; }

	editors: readonly IEditorInput[] = [];
	mostRecentlyActiveEditors: readonly IEditorIdentifier[] = [];
	visibleEditorPanes: readonly IVisibleEditorPane[] = [];
	visibleTextEditorControls = [];
	visibleEditors: readonly IEditorInput[] = [];
	count = this.editors.length;

	constructor(private editorGroupService?: IEditorGroupsService) { }
	getEditors() { return []; }
	findEditors() { return [] as any; }
	openEditor(editor: IEditorInput, options?: IEditorOptions, group?: PreferredGroup): Promise<IEditorPane | undefined>;
	openEditor(editor: IResourceEditorInput | IUntitledTextResourceEditorInput, group?: PreferredGroup): Promise<ITextEditorPane | undefined>;
	openEditor(editor: IResourceDiffEditorInput, group?: PreferredGroup): Promise<ITextDiffEditorPane | undefined>;
	async openEditor(editor: IEditorInput | IUntypedEditorInput, optionsOrGroup?: IEditorOptions | PreferredGroup, group?: PreferredGroup): Promise<IEditorPane | undefined> {
		throw new Error('not implemented');
	}
	doResolveEditorOpenRequest(editor: IEditorInput | IUntypedEditorInput): [IEditorGroup, EditorInput, IEditorOptions | undefined] | undefined {
		if (!this.editorGroupService) {
			return undefined;
		}

		return [this.editorGroupService.activeGroup, editor as EditorInput, undefined];
	}
	openEditors(_editors: any, _group?: any): Promise<IEditorPane[]> { throw new Error('not implemented'); }
	isOpened(_editor: IResourceEditorInputIdentifier): boolean { return false; }
	isVisible(_editor: IEditorInput): boolean { return false; }
	replaceEditors(_editors: any, _group: any) { return Promise.resolve(undefined); }
	createEditorInput(_input: IResourceEditorInput | IUntitledTextResourceEditorInput | IResourceDiffEditorInput): EditorInput { throw new Error('not implemented'); }
	save(editors: IEditorIdentifier[], options?: ISaveEditorsOptions): Promise<boolean> { throw new Error('Method not implemented.'); }
	saveAll(options?: ISaveEditorsOptions): Promise<boolean> { throw new Error('Method not implemented.'); }
	revert(editors: IEditorIdentifier[], options?: IRevertOptions): Promise<boolean> { throw new Error('Method not implemented.'); }
	revertAll(options?: IRevertAllEditorsOptions): Promise<boolean> { throw new Error('Method not implemented.'); }
}

export class TestFileService implements IFileService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidFilesChange = new Emitter<FileChangesEvent>();
	get onDidFilesChange(): Event<FileChangesEvent> { return this._onDidFilesChange.event; }
	fireFileChanges(event: FileChangesEvent): void { this._onDidFilesChange.fire(event); }

	private readonly _onDidChangeFilesRaw = new Emitter<IRawFileChangesEvent>();
	get onDidChangeFilesRaw(): Event<IRawFileChangesEvent> { return this._onDidChangeFilesRaw.event; }

	private readonly _onDidRunOperation = new Emitter<FileOperationEvent>();
	get onDidRunOperation(): Event<FileOperationEvent> { return this._onDidRunOperation.event; }
	fireAfterOperation(event: FileOperationEvent): void { this._onDidRunOperation.fire(event); }

	private readonly _onDidChangeFileSystemProviderCapabilities = new Emitter<IFileSystemProviderCapabilitiesChangeEvent>();
	get onDidChangeFileSystemProviderCapabilities(): Event<IFileSystemProviderCapabilitiesChangeEvent> { return this._onDidChangeFileSystemProviderCapabilities.event; }
	fireFileSystemProviderCapabilitiesChangeEvent(event: IFileSystemProviderCapabilitiesChangeEvent): void { this._onDidChangeFileSystemProviderCapabilities.fire(event); }

	readonly onWillActivateFileSystemProvider = Event.None;
	readonly onError: Event<Error> = Event.None;

	private content = 'Hello Html';
	private lastReadFileUri!: URI;

	readonly = false;

	setContent(content: string): void { this.content = content; }
	getContent(): string { return this.content; }
	getLastReadFileUri(): URI { return this.lastReadFileUri; }

	resolve(resource: URI, _options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	resolve(resource: URI, _options?: IResolveFileOptions): Promise<IFileStat>;
	resolve(resource: URI, _options?: IResolveFileOptions): Promise<IFileStat> {
		return Promise.resolve({
			resource,
			etag: Date.now().toString(),
			encoding: 'utf8',
			mtime: Date.now(),
			size: 42,
			isFile: true,
			isDirectory: false,
			isSymbolicLink: false,
			readonly: this.readonly,
			name: basename(resource)
		});
	}

	async resolveAll(toResolve: { resource: URI, options?: IResolveFileOptions; }[]): Promise<IResolveFileResult[]> {
		const stats = await Promise.all(toResolve.map(resourceAndOption => this.resolve(resourceAndOption.resource, resourceAndOption.options)));

		return stats.map(stat => ({ stat, success: true }));
	}

	readonly notExistsSet = new ResourceMap<boolean>();

	async exists(_resource: URI): Promise<boolean> { return !this.notExistsSet.has(_resource); }

	readShouldThrowError: Error | undefined = undefined;

	readFile(resource: URI, options?: IReadFileOptions | undefined): Promise<IFileContent> {
		if (this.readShouldThrowError) {
			throw this.readShouldThrowError;
		}

		this.lastReadFileUri = resource;

		return Promise.resolve({
			resource: resource,
			value: VSBuffer.fromString(this.content),
			etag: 'index.txt',
			encoding: 'utf8',
			mtime: Date.now(),
			ctime: Date.now(),
			name: basename(resource),
			readonly: this.readonly,
			size: 1
		});
	}

	readFileStream(resource: URI, options?: IReadFileStreamOptions | undefined): Promise<IFileStreamContent> {
		if (this.readShouldThrowError) {
			throw this.readShouldThrowError;
		}

		this.lastReadFileUri = resource;

		return Promise.resolve({
			resource,
			value: bufferToStream(VSBuffer.fromString(this.content)),
			etag: 'index.txt',
			encoding: 'utf8',
			mtime: Date.now(),
			ctime: Date.now(),
			size: 1,
			readonly: this.readonly,
			name: basename(resource)
		});
	}

	writeShouldThrowError: Error | undefined = undefined;

	async writeFile(resource: URI, bufferOrReadable: VSBuffer | VSBufferReadable, options?: IWriteFileOptions): Promise<IFileStatWithMetadata> {
		await timeout(0);

		if (this.writeShouldThrowError) {
			throw this.writeShouldThrowError;
		}

		return ({
			resource,
			etag: 'index.txt',
			mtime: Date.now(),
			ctime: Date.now(),
			size: 42,
			isFile: true,
			isDirectory: false,
			isSymbolicLink: false,
			readonly: this.readonly,
			name: basename(resource)
		});
	}

	move(_source: URI, _target: URI, _overwrite?: boolean): Promise<IFileStatWithMetadata> { return Promise.resolve(null!); }
	copy(_source: URI, _target: URI, _overwrite?: boolean): Promise<IFileStatWithMetadata> { return Promise.resolve(null!); }
	createFile(_resource: URI, _content?: VSBuffer | VSBufferReadable, _options?: ICreateFileOptions): Promise<IFileStatWithMetadata> { return Promise.resolve(null!); }
	createFolder(_resource: URI): Promise<IFileStatWithMetadata> { return Promise.resolve(null!); }

	onDidChangeFileSystemProviderRegistrations = Event.None;

	private providers = new Map<string, IFileSystemProvider>();

	registerProvider(scheme: string, provider: IFileSystemProvider) {
		this.providers.set(scheme, provider);

		return toDisposable(() => this.providers.delete(scheme));
	}

	getProvider(scheme: string) {
		return this.providers.get(scheme);
	}

	activateProvider(_scheme: string): Promise<void> { throw new Error('not implemented'); }
	canHandleResource(resource: URI): boolean { return resource.scheme === Schemas.file || this.providers.has(resource.scheme); }
	listCapabilities() {
		return [
			{ scheme: Schemas.file, capabilities: FileSystemProviderCapabilities.FileOpenReadWriteClose },
			...Iterable.map(this.providers, ([scheme, p]) => { return { scheme, capabilities: p.capabilities }; })
		];
	}
	hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean {
		if (capability === FileSystemProviderCapabilities.PathCaseSensitive && isLinux) {
			return true;
		}

		const provider = this.getProvider(resource.scheme);

		return !!(provider && (provider.capabilities & capability));
	}

	async del(_resource: URI, _options?: { useTrash?: boolean, recursive?: boolean; }): Promise<void> { }

	readonly watches: URI[] = [];
	watch(_resource: URI): IDisposable {
		this.watches.push(_resource);

		return toDisposable(() => this.watches.splice(this.watches.indexOf(_resource), 1));
	}

	getWriteEncoding(_resource: URI): IResourceEncoding { return { encoding: 'utf8', hasBOM: false }; }
	dispose(): void { }

	async canCreateFile(source: URI, options?: ICreateFileOptions): Promise<Error | true> { return true; }
	async canMove(source: URI, target: URI, overwrite?: boolean | undefined): Promise<Error | true> { return true; }
	async canCopy(source: URI, target: URI, overwrite?: boolean | undefined): Promise<Error | true> { return true; }
	async canDelete(resource: URI, options?: { useTrash?: boolean | undefined; recursive?: boolean | undefined; } | undefined): Promise<Error | true> { return true; }
}

export class TestWorkingCopyBackupService extends InMemoryWorkingCopyBackupService {

	readonly resolved: Set<IWorkingCopyIdentifier> = new Set();

	constructor() {
		super();
	}

	parseBackupContent(textBufferFactory: ITextBufferFactory): string {
		const textBuffer = textBufferFactory.create(DefaultEndOfLine.LF).textBuffer;
		const lineCount = textBuffer.getLineCount();
		const range = new Range(1, 1, lineCount, textBuffer.getLineLength(lineCount) + 1);

		return textBuffer.getValueInRange(range, EndOfLinePreference.TextDefined);
	}

	override async resolve<T extends IWorkingCopyBackupMeta>(identifier: IWorkingCopyIdentifier): Promise<IResolvedWorkingCopyBackup<T> | undefined> {
		this.resolved.add(identifier);

		return super.resolve(identifier);
	}
}

export function toUntypedWorkingCopyId(resource: URI): IWorkingCopyIdentifier {
	return toTypedWorkingCopyId(resource, '');
}

export function toTypedWorkingCopyId(resource: URI, typeId = 'testBackupTypeId'): IWorkingCopyIdentifier {
	return { typeId, resource };
}

export class InMemoryTestWorkingCopyBackupService extends BrowserWorkingCopyBackupService {

	override readonly fileService: IFileService;

	private backupResourceJoiners: Function[];
	private discardBackupJoiners: Function[];

	discardedBackups: IWorkingCopyIdentifier[];

	constructor() {
		const environmentService = TestEnvironmentService;
		const logService = new NullLogService();
		const fileService = new FileService(logService);
		fileService.registerProvider(Schemas.file, new InMemoryFileSystemProvider());
		fileService.registerProvider(Schemas.userData, new InMemoryFileSystemProvider());

		super(new TestContextService(TestWorkspace), environmentService, fileService, logService);

		this.fileService = fileService;
		this.backupResourceJoiners = [];
		this.discardBackupJoiners = [];
		this.discardedBackups = [];
	}

	joinBackupResource(): Promise<void> {
		return new Promise(resolve => this.backupResourceJoiners.push(resolve));
	}

	joinDiscardBackup(): Promise<void> {
		return new Promise(resolve => this.discardBackupJoiners.push(resolve));
	}

	override async backup(identifier: IWorkingCopyIdentifier, content?: VSBufferReadableStream | VSBufferReadable, versionId?: number, meta?: any, token?: CancellationToken): Promise<void> {
		await super.backup(identifier, content, versionId, meta, token);

		while (this.backupResourceJoiners.length) {
			this.backupResourceJoiners.pop()!();
		}
	}

	override async discardBackup(identifier: IWorkingCopyIdentifier): Promise<void> {
		await super.discardBackup(identifier);
		this.discardedBackups.push(identifier);

		while (this.discardBackupJoiners.length) {
			this.discardBackupJoiners.pop()!();
		}
	}

	async getBackupContents(identifier: IWorkingCopyIdentifier): Promise<string> {
		const backupResource = this.toBackupResource(identifier);

		const fileContents = await this.fileService.readFile(backupResource);

		return fileContents.value.toString();
	}
}

export class TestLifecycleService implements ILifecycleService {

	declare readonly _serviceBrand: undefined;

	phase!: LifecyclePhase;
	startupKind!: StartupKind;

	private readonly _onBeforeShutdown = new Emitter<BeforeShutdownEvent>();
	get onBeforeShutdown(): Event<BeforeShutdownEvent> { return this._onBeforeShutdown.event; }

	private readonly _onWillShutdown = new Emitter<WillShutdownEvent>();
	get onWillShutdown(): Event<WillShutdownEvent> { return this._onWillShutdown.event; }

	private readonly _onShutdown = new Emitter<void>();
	get onDidShutdown(): Event<void> { return this._onShutdown.event; }

	async when(): Promise<void> { }

	shutdownJoiners: Promise<void>[] = [];

	fireShutdown(reason = ShutdownReason.QUIT): void {
		this.shutdownJoiners = [];

		this._onWillShutdown.fire({
			join: p => {
				this.shutdownJoiners.push(p);
			},
			reason
		});
	}

	fireBeforeShutdown(event: BeforeShutdownEvent): void { this._onBeforeShutdown.fire(event); }

	fireWillShutdown(event: WillShutdownEvent): void { this._onWillShutdown.fire(event); }

	shutdown(): void {
		this.fireShutdown();
	}
}

export class TestBeforeShutdownEvent implements BeforeShutdownEvent {

	value: boolean | Promise<boolean> | undefined;
	reason = ShutdownReason.CLOSE;

	veto(value: boolean | Promise<boolean>): void {
		this.value = value;
	}
}

export class TestWillShutdownEvent implements WillShutdownEvent {

	value: Promise<void>[] = [];
	reason = ShutdownReason.CLOSE;

	join(promise: Promise<void>, id: string): void {
		this.value.push(promise);
	}
}

export class TestTextResourceConfigurationService implements ITextResourceConfigurationService {

	declare readonly _serviceBrand: undefined;

	constructor(private configurationService = new TestConfigurationService()) { }

	onDidChangeConfiguration() {
		return { dispose() { } };
	}

	getValue<T>(resource: URI, arg2?: any, arg3?: any): T {
		const position: IPosition | null = EditorPosition.isIPosition(arg2) ? arg2 : null;
		const section: string | undefined = position ? (typeof arg3 === 'string' ? arg3 : undefined) : (typeof arg2 === 'string' ? arg2 : undefined);
		return this.configurationService.getValue(section, { resource });
	}

	updateValue(resource: URI, key: string, value: any, configurationTarget?: ConfigurationTarget): Promise<void> {
		return this.configurationService.updateValue(key, value);
	}
}

export class RemoteFileSystemProvider implements IFileSystemProvider {

	constructor(private readonly diskFileSystemProvider: IFileSystemProvider, private readonly remoteAuthority: string) { }

	readonly capabilities: FileSystemProviderCapabilities = this.diskFileSystemProvider.capabilities;
	readonly onDidChangeCapabilities: Event<void> = this.diskFileSystemProvider.onDidChangeCapabilities;

	readonly onDidChangeFile: Event<readonly IFileChange[]> = Event.map(this.diskFileSystemProvider.onDidChangeFile, changes => changes.map((c): IFileChange => {
		return {
			type: c.type,
			resource: c.resource.with({ scheme: Schemas.vscodeRemote, authority: this.remoteAuthority }),
		};
	}));
	watch(resource: URI, opts: IWatchOptions): IDisposable { return this.diskFileSystemProvider.watch(this.toFileResource(resource), opts); }

	stat(resource: URI): Promise<IStat> { return this.diskFileSystemProvider.stat(this.toFileResource(resource)); }
	mkdir(resource: URI): Promise<void> { return this.diskFileSystemProvider.mkdir(this.toFileResource(resource)); }
	readdir(resource: URI): Promise<[string, FileType][]> { return this.diskFileSystemProvider.readdir(this.toFileResource(resource)); }
	delete(resource: URI, opts: FileDeleteOptions): Promise<void> { return this.diskFileSystemProvider.delete(this.toFileResource(resource), opts); }

	rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> { return this.diskFileSystemProvider.rename(this.toFileResource(from), this.toFileResource(to), opts); }
	copy(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> { return this.diskFileSystemProvider.copy!(this.toFileResource(from), this.toFileResource(to), opts); }

	readFile(resource: URI): Promise<Uint8Array> { return this.diskFileSystemProvider.readFile!(this.toFileResource(resource)); }
	writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> { return this.diskFileSystemProvider.writeFile!(this.toFileResource(resource), content, opts); }

	open(resource: URI, opts: FileOpenOptions): Promise<number> { return this.diskFileSystemProvider.open!(this.toFileResource(resource), opts); }
	close(fd: number): Promise<void> { return this.diskFileSystemProvider.close!(fd); }
	read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> { return this.diskFileSystemProvider.read!(fd, pos, data, offset, length); }
	write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> { return this.diskFileSystemProvider.write!(fd, pos, data, offset, length); }

	readFileStream(resource: URI, opts: FileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array> { return this.diskFileSystemProvider.readFileStream!(this.toFileResource(resource), opts, token); }

	private toFileResource(resource: URI): URI { return resource.with({ scheme: Schemas.file, authority: '' }); }
}

export class TestInMemoryFileSystemProvider extends InMemoryFileSystemProvider implements IFileSystemProviderWithFileReadStreamCapability {
	override readonly capabilities: FileSystemProviderCapabilities =
		FileSystemProviderCapabilities.FileReadWrite
		| FileSystemProviderCapabilities.PathCaseSensitive
		| FileSystemProviderCapabilities.FileReadStream;

	readFileStream(resource: URI): ReadableStreamEvents<Uint8Array> {
		const BUFFER_SIZE = 64 * 1024;
		const stream = newWriteableStream<Uint8Array>(data => VSBuffer.concat(data.map(data => VSBuffer.wrap(data))).buffer);

		(async () => {
			try {
				const data = await this.readFile(resource);

				let offset = 0;
				while (offset < data.length) {
					await timeout(0);
					await stream.write(data.subarray(offset, offset + BUFFER_SIZE));
					offset += BUFFER_SIZE;
				}

				await timeout(0);
				stream.end();
			} catch (error) {
				stream.end(error);
			}
		})();

		return stream;
	}
}

export const productService: IProductService = { _serviceBrand: undefined, ...product };

export class TestHostService implements IHostService {

	declare readonly _serviceBrand: undefined;

	private _hasFocus = true;
	get hasFocus() { return this._hasFocus; }
	async hadLastFocus(): Promise<boolean> { return this._hasFocus; }

	private _onDidChangeFocus = new Emitter<boolean>();
	readonly onDidChangeFocus = this._onDidChangeFocus.event;

	setFocus(focus: boolean) {
		this._hasFocus = focus;
		this._onDidChangeFocus.fire(this._hasFocus);
	}

	async restart(): Promise<void> { }
	async reload(): Promise<void> { }
	async close(): Promise<void> { }

	async focus(options?: { force: boolean; }): Promise<void> { }

	async openWindow(arg1?: IOpenEmptyWindowOptions | IWindowOpenable[], arg2?: IOpenWindowOptions): Promise<void> { }

	async toggleFullScreen(): Promise<void> { }

	readonly colorScheme = ColorScheme.DARK;
	onDidChangeColorScheme = Event.None;
}

export class TestFilesConfigurationService extends FilesConfigurationService {

	override onFilesConfigurationChange(configuration: any): void {
		super.onFilesConfigurationChange(configuration);
	}
}

export class TestReadonlyTextFileEditorModel extends TextFileEditorModel {

	override isReadonly(): boolean {
		return true;
	}
}

export class TestEditorInput extends EditorInput {

	constructor(public resource: URI, private readonly _typeId: string) {
		super();
	}

	override get typeId(): string {
		return this._typeId;
	}

	override get editorId(): string {
		return this._typeId;
	}

	override resolve(): Promise<IEditorModel | null> {
		return Promise.resolve(null);
	}
}

export abstract class TestEditorWithOptions extends EditorPane {

	lastSetOptions: ITextEditorOptions | undefined = undefined;

	override setOptions(options: ITextEditorOptions | undefined): void {
		this.lastSetOptions = options;

		super.setOptions(options);
	}
}

export function registerTestEditor(id: string, inputs: SyncDescriptor<EditorInput>[], serializerInputId?: string): IDisposable {
	class TestEditor extends TestEditorWithOptions {

		private _scopedContextKeyService: IContextKeyService;

		constructor() {
			super(id, NullTelemetryService, new TestThemeService(), new TestStorageService());
			this._scopedContextKeyService = new MockContextKeyService();
		}

		override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
			super.setInput(input, options, context, token);

			await input.resolve();
		}

		override getId(): string { return id; }
		layout(): void { }
		createEditor(): void { }

		override get scopedContextKeyService() {
			return this._scopedContextKeyService;
		}
	}

	const disposables = new DisposableStore();

	disposables.add(Registry.as<IEditorPaneRegistry>(Extensions.EditorPane).registerEditorPane(EditorPaneDescriptor.create(TestEditor, id, 'Test Editor Control'), inputs));

	if (serializerInputId) {

		interface ISerializedTestInput {
			resource: string;
		}

		class EditorsObserverTestEditorInputSerializer implements IEditorSerializer {

			canSerialize(editorInput: EditorInput): boolean {
				return true;
			}

			serialize(editorInput: EditorInput): string {
				let testEditorInput = <TestFileEditorInput>editorInput;
				let testInput: ISerializedTestInput = {
					resource: testEditorInput.resource.toString()
				};

				return JSON.stringify(testInput);
			}

			deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput {
				let testInput: ISerializedTestInput = JSON.parse(serializedEditorInput);

				return new TestFileEditorInput(URI.parse(testInput.resource), serializerInputId!);
			}
		}

		disposables.add(Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(serializerInputId, EditorsObserverTestEditorInputSerializer));
	}

	return disposables;
}

export function registerTestFileEditor(): IDisposable {
	const disposables = new DisposableStore();

	disposables.add(Registry.as<IEditorPaneRegistry>(Extensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(
			TestTextFileEditor,
			TestTextFileEditor.ID,
			'Text File Editor'
		),
		[new SyncDescriptor(FileEditorInput)]
	));

	return disposables;
}

export function registerTestResourceEditor(): IDisposable {
	const disposables = new DisposableStore();

	disposables.add(Registry.as<IEditorPaneRegistry>(Extensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(
			TestTextResourceEditor,
			TestTextResourceEditor.ID,
			'Text Editor'
		),
		[
			new SyncDescriptor(UntitledTextEditorInput),
			new SyncDescriptor(TextResourceEditorInput)
		]
	));

	return disposables;
}

export function registerTestSideBySideEditor(): IDisposable {
	const disposables = new DisposableStore();

	disposables.add(Registry.as<IEditorPaneRegistry>(Extensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(
			SideBySideEditor,
			SideBySideEditor.ID,
			'Text Editor'
		),
		[
			new SyncDescriptor(SideBySideEditorInput)
		]
	));

	return disposables;
}

export class TestFileEditorInput extends EditorInput implements IFileEditorInput {

	readonly preferredResource = this.resource;

	gotDisposed = false;
	gotSaved = false;
	gotSavedAs = false;
	gotReverted = false;
	dirty = false;
	private fails = false;

	disableToUntyped = false;

	constructor(
		public resource: URI,
		private _typeId: string
	) {
		super();
	}

	override get typeId() { return this._typeId; }
	override get editorId() { return this._typeId; }

	private _capabilities: EditorInputCapabilities = EditorInputCapabilities.None;
	override get capabilities(): EditorInputCapabilities { return this._capabilities; }
	override set capabilities(capabilities: EditorInputCapabilities) {
		if (this._capabilities !== capabilities) {
			this._capabilities = capabilities;
			this._onDidChangeCapabilities.fire();
		}
	}

	override resolve(): Promise<IEditorModel | null> { return !this.fails ? Promise.resolve(null) : Promise.reject(new Error('fails')); }
	override matches(other: EditorInput | IResourceEditorInput | ITextResourceEditorInput | IUntitledTextResourceEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		if (other instanceof EditorInput) {
			return !!(other?.resource && this.resource.toString() === other.resource.toString() && other instanceof TestFileEditorInput && other.typeId === this.typeId);
		}
		return isEqual(this.resource, other.resource) && this.editorId === other.options?.override;
	}
	setPreferredResource(resource: URI): void { }
	async setEncoding(encoding: string) { }
	getEncoding() { return undefined; }
	setPreferredName(name: string): void { }
	setPreferredDescription(description: string): void { }
	setPreferredEncoding(encoding: string) { }
	setPreferredContents(contents: string): void { }
	setMode(mode: string) { }
	setPreferredMode(mode: string) { }
	setForceOpenAsBinary(): void { }
	setFailToOpen(): void {
		this.fails = true;
	}
	override async save(groupId: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		this.gotSaved = true;
		this.dirty = false;
		return this;
	}
	override async saveAs(groupId: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		this.gotSavedAs = true;
		return this;
	}
	override async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		this.gotReverted = true;
		this.gotSaved = false;
		this.gotSavedAs = false;
		this.dirty = false;
	}
	override toUntyped(): IUntypedEditorInput | undefined {
		if (this.disableToUntyped) {
			return undefined;
		}
		return { resource: this.resource };
	}
	setDirty(): void { this.dirty = true; }
	override isDirty(): boolean {
		return this.dirty;
	}
	isResolved(): boolean { return false; }
	override dispose(): void {
		super.dispose();
		this.gotDisposed = true;
	}
	movedEditor: IMoveResult | undefined = undefined;
	override rename(): IMoveResult | undefined { return this.movedEditor; }
}

export class TestEditorPart extends EditorPart {

	override saveState(): void {
		return super.saveState();
	}

	clearState(): void {
		const workspaceMemento = this.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		for (const key of Object.keys(workspaceMemento)) {
			delete workspaceMemento[key];
		}

		const globalMemento = this.getMemento(StorageScope.GLOBAL, StorageTarget.MACHINE);
		for (const key of Object.keys(globalMemento)) {
			delete globalMemento[key];
		}
	}
}

export async function createEditorPart(instantiationService: IInstantiationService, disposables: DisposableStore): Promise<TestEditorPart> {
	const part = disposables.add(instantiationService.createInstance(TestEditorPart));
	part.create(document.createElement('div'));
	part.layout(1080, 800);

	await part.whenReady;

	return part;
}

export class TestListService implements IListService {
	declare readonly _serviceBrand: undefined;

	lastFocusedList: any | undefined = undefined;

	register(): IDisposable {
		return Disposable.None;
	}
}

export class TestPathService implements IPathService {

	declare readonly _serviceBrand: undefined;

	constructor(private readonly fallbackUserHome: URI = URI.from({ scheme: Schemas.vscodeRemote, path: '/' })) { }

	get path() { return Promise.resolve(isWindows ? win32 : posix); }

	async userHome() { return this.fallbackUserHome; }
	get resolvedUserHome() { return this.fallbackUserHome; }

	async fileURI(path: string): Promise<URI> {
		return URI.file(path);
	}

	readonly defaultUriScheme = Schemas.vscodeRemote;
}

export class TestTextFileEditorModelManager extends TextFileEditorModelManager {

	override add(resource: URI, model: TextFileEditorModel): void {
		return super.add(resource, model);
	}

	override remove(resource: URI): void {
		return super.remove(resource);
	}
}

interface ITestTextFileEditorModel extends ITextFileEditorModel {
	readonly lastResolvedFileStat: IFileStatWithMetadata | undefined;
}

export function getLastResolvedFileStat(model: unknown): IFileStatWithMetadata | undefined {
	const candidate = model as ITestTextFileEditorModel | undefined;

	return candidate?.lastResolvedFileStat;
}

export class TestWorkspacesService implements IWorkspacesService {
	_serviceBrand: undefined;

	onDidChangeRecentlyOpened = Event.None;

	async createUntitledWorkspace(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): Promise<IWorkspaceIdentifier> { throw new Error('Method not implemented.'); }
	async deleteUntitledWorkspace(workspace: IWorkspaceIdentifier): Promise<void> { }
	async addRecentlyOpened(recents: IRecent[]): Promise<void> { }
	async removeRecentlyOpened(workspaces: URI[]): Promise<void> { }
	async clearRecentlyOpened(): Promise<void> { }
	async getRecentlyOpened(): Promise<IRecentlyOpened> { return { files: [], workspaces: [] }; }
	async getDirtyWorkspaces(): Promise<(URI | IWorkspaceIdentifier)[]> { return []; }
	async enterWorkspace(path: URI): Promise<IEnterWorkspaceResult | undefined> { throw new Error('Method not implemented.'); }
	async getWorkspaceIdentifier(workspacePath: URI): Promise<IWorkspaceIdentifier> { throw new Error('Method not implemented.'); }
}

export class TestTerminalInstanceService implements ITerminalInstanceService {
	onDidCreateInstance = Event.None;
	declare readonly _serviceBrand: undefined;

	async getXtermConstructor(): Promise<any> { throw new Error('Method not implemented.'); }
	async getXtermSearchConstructor(): Promise<any> { throw new Error('Method not implemented.'); }
	async getXtermUnicode11Constructor(): Promise<any> { throw new Error('Method not implemented.'); }
	async getXtermWebglConstructor(): Promise<any> { throw new Error('Method not implemented.'); }
	preparePathForTerminalAsync(path: string, executable: string | undefined, title: string, shellType: TerminalShellType, isRemote: boolean): Promise<string> { throw new Error('Method not implemented.'); }
	createInstance(options: ICreateTerminalOptions, target?: TerminalLocation): ITerminalInstance { throw new Error('Method not implemented.'); }
}

export class TestTerminalProfileResolverService implements ITerminalProfileResolverService {
	_serviceBrand: undefined;
	defaultProfileName = '';
	resolveIcon(shellLaunchConfig: IShellLaunchConfig): void { }
	async resolveShellLaunchConfig(shellLaunchConfig: IShellLaunchConfig, options: IShellLaunchConfigResolveOptions): Promise<void> { }
	async getDefaultProfile(options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> { return { path: '/default', profileName: 'Default', isDefault: true }; }
	async getDefaultShell(options: IShellLaunchConfigResolveOptions): Promise<string> { return '/default'; }
	async getDefaultShellArgs(options: IShellLaunchConfigResolveOptions): Promise<string | string[]> { return []; }
	async getEnvironment(): Promise<IProcessEnvironment> { return process.env; }
	getSafeConfigValue(key: string, os: OperatingSystem): unknown | undefined { return undefined; }
	getSafeConfigValueFullKey(key: string): unknown | undefined { return undefined; }
	createProfileFromShellAndShellArgs(shell?: unknown, shellArgs?: unknown): Promise<string | ITerminalProfile> { throw new Error('Method not implemented.'); }
}

export class TestLocalTerminalService implements ILocalTerminalService {
	declare readonly _serviceBrand: undefined;

	onPtyHostExit = Event.None;
	onPtyHostUnresponsive = Event.None;
	onPtyHostResponsive = Event.None;
	onPtyHostRestart = Event.None;
	onDidMoveWindowInstance = Event.None;
	onDidRequestDetach = Event.None;

	async createProcess(shellLaunchConfig: IShellLaunchConfig, cwd: string, cols: number, rows: number, env: IProcessEnvironment, windowsEnableConpty: boolean, shouldPersist: boolean): Promise<ITerminalChildProcess> {
		return new TestTerminalChildProcess(shouldPersist);
	}
	async attachToProcess(id: number): Promise<ITerminalChildProcess | undefined> { throw new Error('Method not implemented.'); }
	async listProcesses(getDetachedInstance?: boolean): Promise<IProcessDetails[]> { throw new Error('Method not implemented.'); }
	getDefaultSystemShell(osOverride?: OperatingSystem): Promise<string> { throw new Error('Method not implemented.'); }
	getProfiles(isWorkspaceTrusted: boolean, includeDetectedProfiles?: boolean): Promise<ITerminalProfile[]> { throw new Error('Method not implemented.'); }
	getEnvironment(): Promise<IProcessEnvironment> { throw new Error('Method not implemented.'); }
	getShellEnvironment(): Promise<IProcessEnvironment | undefined> { throw new Error('Method not implemented.'); }
	getWslPath(original: string): Promise<string> { throw new Error('Method not implemented.'); }
	async setTerminalLayoutInfo(argsOrLayout?: ISetTerminalLayoutInfoArgs | ITerminalsLayoutInfoById) { throw new Error('Method not implemented.'); }
	async getTerminalLayoutInfo(): Promise<ITerminalsLayoutInfo | undefined> { throw new Error('Method not implemented.'); }
	async reduceConnectionGraceTime(): Promise<void> { throw new Error('Method not implemented.'); }
	processBinary(id: number, data: string): Promise<void> { throw new Error('Method not implemented.'); }
	updateTitle(id: number, title: string): Promise<void> { throw new Error('Method not implemented.'); }
	updateIcon(id: number, icon: URI | { light: URI; dark: URI } | { id: string, color?: { id: string } }, color?: string): Promise<void> { throw new Error('Method not implemented.'); }
	requestDetachInstance(workspaceId: string, instanceId: number): Promise<void> { throw new Error('Method not implemented.'); }
	acceptInstanceForAttachment(persistentProcessId: number): Promise<void> { throw new Error('Method not implemented.'); }
}

class TestTerminalChildProcess implements ITerminalChildProcess {
	id: number = 0;

	constructor(
		readonly shouldPersist: boolean
	) {
	}

	onProcessData = Event.None;
	onProcessExit = Event.None;
	onProcessReady = Event.None;
	onProcessTitleChanged = Event.None;
	onProcessShellTypeChanged = Event.None;
	async start(): Promise<undefined> { return undefined; }
	shutdown(immediate: boolean): void { }
	input(data: string): void { }
	resize(cols: number, rows: number): void { }
	acknowledgeDataEvent(charCount: number): void { }
	async getInitialCwd(): Promise<string> { return ''; }
	async getCwd(): Promise<string> { return ''; }
	async getLatency(): Promise<number> { return 0; }
	async processBinary(data: string): Promise<void> { }
}

export class TestQuickInputService implements IQuickInputService {

	declare readonly _serviceBrand: undefined;

	readonly onShow = Event.None;
	readonly onHide = Event.None;

	readonly quickAccess = undefined!;
	backButton!: IQuickInputButton;

	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: true }, token?: CancellationToken): Promise<T[]>;
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: false }, token?: CancellationToken): Promise<T>;
	async pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: Omit<IPickOptions<T>, 'canPickMany'>, token?: CancellationToken): Promise<T | undefined> {
		if (isArray(picks)) {
			return <any>{ label: 'selectedPick', description: 'pick description', value: 'selectedPick' };
		} else {
			return undefined;
		}
	}

	async input(options?: IInputOptions, token?: CancellationToken): Promise<string> { return options ? 'resolved' + options.prompt : 'resolved'; }

	createQuickPick<T extends IQuickPickItem>(): IQuickPick<T> { throw new Error('not implemented.'); }
	createInputBox(): IInputBox { throw new Error('not implemented.'); }
	focus(): void { throw new Error('not implemented.'); }
	toggle(): void { throw new Error('not implemented.'); }
	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration): void { throw new Error('not implemented.'); }
	accept(): Promise<void> { throw new Error('not implemented.'); }
	back(): Promise<void> { throw new Error('not implemented.'); }
	cancel(): Promise<void> { throw new Error('not implemented.'); }
}

export class TestEditorWorkerService implements IEditorWorkerService {

	declare readonly _serviceBrand: undefined;

	canComputeDiff(original: URI, modified: URI): boolean { return false; }
	async computeDiff(original: URI, modified: URI, ignoreTrimWhitespace: boolean, maxComputationTime: number): Promise<IDiffComputationResult | null> { return null; }
	canComputeDirtyDiff(original: URI, modified: URI): boolean { return false; }
	async computeDirtyDiff(original: URI, modified: URI, ignoreTrimWhitespace: boolean): Promise<IChange[] | null> { return null; }
	async computeMoreMinimalEdits(resource: URI, edits: TextEdit[] | null | undefined): Promise<TextEdit[] | undefined> { return undefined; }
	canComputeWordRanges(resource: URI): boolean { return false; }
	async computeWordRanges(resource: URI, range: IRange): Promise<{ [word: string]: IRange[]; } | null> { return null; }
	canNavigateValueSet(resource: URI): boolean { return false; }
	async navigateValueSet(resource: URI, range: IRange, up: boolean): Promise<IInplaceReplaceSupportResult | null> { return null; }
}
