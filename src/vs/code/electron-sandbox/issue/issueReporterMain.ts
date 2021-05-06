/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/issueReporter';
import 'vs/base/browser/ui/codicons/codiconStyles'; // make sure codicon css is loaded
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { NativeHostService } from 'vs/platform/native/electron-sandbox/nativeHostService';
import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { applyZoom, zoomIn, zoomOut } from 'vs/platform/windows/electron-sandbox/window';
import { $, reset, safeInnerHtml, windowOpenNoOpener } from 'vs/base/browser/dom';
import { Button } from 'vs/base/browser/ui/button/button';
import { groupBy } from 'vs/base/common/collections';
import { debounce } from 'vs/base/common/decorators';
import { Disposable } from 'vs/base/common/lifecycle';
import { isWindows, isLinux, isLinuxSnap, isMacintosh } from 'vs/base/common/platform';
import { escape } from 'vs/base/common/strings';
import { normalizeGitHubUrl } from 'vs/platform/issue/common/issueReporterUtil';
import { IssueReporterData as IssueReporterModelData, IssueReporterModel } from 'vs/code/electron-sandbox/issue/issueReporterModel';
import BaseHtml from 'vs/code/electron-sandbox/issue/issueReporterPage';
import { localize } from 'vs/nls';
import { isRemoteDiagnosticError, SystemInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/services';
import { IssueReporterWindowConfiguration, IssueReporterData, IssueReporterExtensionData, IssueReporterStyles, IssueType } from 'vs/platform/issue/common/issue';
import { Codicon } from 'vs/base/common/codicons';
import { renderIcon } from 'vs/base/browser/ui/iconLabel/iconLabels';
import { ElectronIPCMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';

const MAX_URL_LENGTH = 2045;

interface SearchResult {
	html_url: string;
	title: string;
	state?: string;
}

enum IssueSource {
	VSCode = 'vscode',
	Extension = 'extension',
	Marketplace = 'marketplace'
}

export function startup(configuration: IssueReporterWindowConfiguration) {
	const platformClass = isWindows ? 'windows' : isLinux ? 'linux' : 'mac';
	document.body.classList.add(platformClass); // used by our fonts

	safeInnerHtml(document.body, BaseHtml());

	const issueReporter = new IssueReporter(configuration);
	issueReporter.render();
	document.body.style.display = 'block';
	issueReporter.setInitialFocus();
}

export class IssueReporter extends Disposable {
	private nativeHostService!: INativeHostService;
	private readonly issueReporterModel: IssueReporterModel;
	private numberOfSearchResultsDisplayed = 0;
	private receivedSystemInfo = false;
	private receivedPerformanceInfo = false;
	private shouldQueueSearch = false;
	private hasBeenSubmitted = false;

	private readonly previewButton!: Button;

	constructor(private readonly configuration: IssueReporterWindowConfiguration) {
		super();

		this.initServices(configuration);

		const targetExtension = configuration.data.extensionId ? configuration.data.enabledExtensions.find(extension => extension.id === configuration.data.extensionId) : undefined;
		this.issueReporterModel = new IssueReporterModel({
			issueType: configuration.data.issueType || IssueType.Bug,
			versionInfo: {
				vscodeVersion: `${configuration.product.nameShort} ${!!configuration.product.darwinUniversalAssetId ? `${configuration.product.version} (Universal)` : configuration.product.version} (${configuration.product.commit || 'Commit unknown'}, ${configuration.product.date || 'Date unknown'})`,
				os: `${this.configuration.os.type} ${this.configuration.os.arch} ${this.configuration.os.release}${isLinuxSnap ? ' snap' : ''}`
			},
			extensionsDisabled: !!configuration.disableExtensions,
			fileOnExtension: configuration.data.extensionId ? !targetExtension?.isBuiltin : undefined,
			selectedExtension: targetExtension,
		});

		const issueReporterElement = this.getElementById('issue-reporter');
		if (issueReporterElement) {
			this.previewButton = new Button(issueReporterElement);
		}

		const issueTitle = configuration.data.issueTitle;
		if (issueTitle) {
			const issueTitleElement = this.getElementById<HTMLInputElement>('issue-title');
			if (issueTitleElement) {
				issueTitleElement.value = issueTitle;
			}
		}

		const issueBody = configuration.data.issueBody;
		if (issueBody) {
			const description = this.getElementById<HTMLTextAreaElement>('description');
			if (description) {
				description.value = issueBody;
				this.issueReporterModel.update({ issueDescription: issueBody });
			}
		}

		ipcRenderer.on('vscode:issuePerformanceInfoResponse', (_: unknown, info: Partial<IssueReporterData>) => {
			this.issueReporterModel.update(info);
			this.receivedPerformanceInfo = true;

			const state = this.issueReporterModel.getData();
			this.updateProcessInfo(state);
			this.updateWorkspaceInfo(state);
			this.updatePreviewButtonState();
		});

		ipcRenderer.on('vscode:issueSystemInfoResponse', (_: unknown, info: SystemInfo) => {
			this.issueReporterModel.update({ systemInfo: info });
			this.receivedSystemInfo = true;

			this.updateSystemInfo(this.issueReporterModel.getData());
			this.updatePreviewButtonState();
		});

		ipcRenderer.send('vscode:issueSystemInfoRequest');
		if (configuration.data.issueType === IssueType.PerformanceIssue) {
			ipcRenderer.send('vscode:issuePerformanceInfoRequest');
		}

		if (window.document.documentElement.lang !== 'en') {
			show(this.getElementById('english'));
		}

		this.setUpTypes();
		this.setEventHandlers();
		applyZoom(configuration.data.zoomLevel);
		this.applyStyles(configuration.data.styles);
		this.handleExtensionData(configuration.data.enabledExtensions);
		this.updateExperimentsInfo(configuration.data.experiments);
	}

	render(): void {
		this.renderBlocks();
	}

	setInitialFocus() {
		const { fileOnExtension } = this.issueReporterModel.getData();
		if (fileOnExtension) {
			const issueTitle = document.getElementById('issue-title');
			if (issueTitle) {
				issueTitle.focus();
			}
		} else {
			const issueType = document.getElementById('issue-type');
			if (issueType) {
				issueType.focus();
			}
		}
	}

	private applyStyles(styles: IssueReporterStyles) {
		const styleTag = document.createElement('style');
		const content: string[] = [];

		if (styles.inputBackground) {
			content.push(`input[type="text"], textarea, select, .issues-container > .issue > .issue-state, .block-info { background-color: ${styles.inputBackground}; }`);
		}

		if (styles.inputBorder) {
			content.push(`input[type="text"], textarea, select { border: 1px solid ${styles.inputBorder}; }`);
		} else {
			content.push(`input[type="text"], textarea, select { border: 1px solid transparent; }`);
		}

		if (styles.inputForeground) {
			content.push(`input[type="text"], textarea, select, .issues-container > .issue > .issue-state, .block-info { color: ${styles.inputForeground}; }`);
		}

		if (styles.inputErrorBorder) {
			content.push(`.invalid-input, .invalid-input:focus, .validation-error { border: 1px solid ${styles.inputErrorBorder} !important; }`);
			content.push(`.required-input { color: ${styles.inputErrorBorder}; }`);
		}

		if (styles.inputErrorBackground) {
			content.push(`.validation-error { background: ${styles.inputErrorBackground}; }`);
		}

		if (styles.inputErrorForeground) {
			content.push(`.validation-error { color: ${styles.inputErrorForeground}; }`);
		}

		if (styles.inputActiveBorder) {
			content.push(`input[type='text']:focus, textarea:focus, select:focus, summary:focus, button:focus, a:focus, .workbenchCommand:focus  { border: 1px solid ${styles.inputActiveBorder}; outline-style: none; }`);
		}

		if (styles.textLinkColor) {
			content.push(`a, .workbenchCommand { color: ${styles.textLinkColor}; }`);
		}

		if (styles.textLinkColor) {
			content.push(`a { color: ${styles.textLinkColor}; }`);
		}

		if (styles.textLinkActiveForeground) {
			content.push(`a:hover, .workbenchCommand:hover { color: ${styles.textLinkActiveForeground}; }`);
		}

		if (styles.sliderBackgroundColor) {
			content.push(`::-webkit-scrollbar-thumb { background-color: ${styles.sliderBackgroundColor}; }`);
		}

		if (styles.sliderActiveColor) {
			content.push(`::-webkit-scrollbar-thumb:active { background-color: ${styles.sliderActiveColor}; }`);
		}

		if (styles.sliderHoverColor) {
			content.push(`::--webkit-scrollbar-thumb:hover { background-color: ${styles.sliderHoverColor}; }`);
		}

		if (styles.buttonBackground) {
			content.push(`.monaco-text-button { background-color: ${styles.buttonBackground} !important; }`);
		}

		if (styles.buttonForeground) {
			content.push(`.monaco-text-button { color: ${styles.buttonForeground} !important; }`);
		}

		if (styles.buttonHoverBackground) {
			content.push(`.monaco-text-button:not(.disabled):hover, .monaco-text-button:focus { background-color: ${styles.buttonHoverBackground} !important; }`);
		}

		styleTag.textContent = content.join('\n');
		document.head.appendChild(styleTag);
		document.body.style.color = styles.color || '';
	}

	private handleExtensionData(extensions: IssueReporterExtensionData[]) {
		const installedExtensions = extensions.filter(x => !x.isBuiltin);
		const { nonThemes, themes } = groupBy(installedExtensions, ext => {
			return ext.isTheme ? 'themes' : 'nonThemes';
		});

		const numberOfThemeExtesions = themes && themes.length;
		this.issueReporterModel.update({ numberOfThemeExtesions, enabledNonThemeExtesions: nonThemes, allExtensions: installedExtensions });
		this.updateExtensionTable(nonThemes, numberOfThemeExtesions);

		if (this.configuration.disableExtensions || installedExtensions.length === 0) {
			(<HTMLButtonElement>this.getElementById('disableExtensions')).disabled = true;
		}

		this.updateExtensionSelector(installedExtensions);
	}

	private initServices(configuration: IssueReporterWindowConfiguration): void {
		const serviceCollection = new ServiceCollection();
		const mainProcessService = new ElectronIPCMainProcessService(configuration.windowId);
		serviceCollection.set(IMainProcessService, mainProcessService);

		this.nativeHostService = new NativeHostService(configuration.windowId, mainProcessService) as INativeHostService;
		serviceCollection.set(INativeHostService, this.nativeHostService);
	}

	private setEventHandlers(): void {
		this.addEventListener('issue-type', 'change', (event: Event) => {
			const issueType = parseInt((<HTMLInputElement>event.target).value);
			this.issueReporterModel.update({ issueType: issueType });
			if (issueType === IssueType.PerformanceIssue && !this.receivedPerformanceInfo) {
				ipcRenderer.send('vscode:issuePerformanceInfoRequest');
			}
			this.updatePreviewButtonState();
			this.setSourceOptions();
			this.render();
		});

		(['includeSystemInfo', 'includeProcessInfo', 'includeWorkspaceInfo', 'includeExtensions', 'includeExperiments'] as const).forEach(elementId => {
			this.addEventListener(elementId, 'click', (event: Event) => {
				event.stopPropagation();
				this.issueReporterModel.update({ [elementId]: !this.issueReporterModel.getData()[elementId] });
			});
		});

		const showInfoElements = document.getElementsByClassName('showInfo');
		for (let i = 0; i < showInfoElements.length; i++) {
			const showInfo = showInfoElements.item(i)!;
			(showInfo as HTMLAnchorElement).addEventListener('click', (e: MouseEvent) => {
				e.preventDefault();
				const label = (<HTMLDivElement>e.target);
				if (label) {
					const containingElement = label.parentElement && label.parentElement.parentElement;
					const info = containingElement && containingElement.lastElementChild;
					if (info && info.classList.contains('hidden')) {
						show(info);
						label.textContent = localize('hide', "hide");
					} else {
						hide(info);
						label.textContent = localize('show', "show");
					}
				}
			});
		}

		this.addEventListener('issue-source', 'change', (e: Event) => {
			const value = (<HTMLInputElement>e.target).value;
			const problemSourceHelpText = this.getElementById('problem-source-help-text')!;
			if (value === '') {
				this.issueReporterModel.update({ fileOnExtension: undefined });
				show(problemSourceHelpText);
				this.clearSearchResults();
				this.render();
				return;
			} else {
				hide(problemSourceHelpText);
			}

			let fileOnExtension, fileOnMarketplace = false;
			if (value === IssueSource.Extension) {
				fileOnExtension = true;
			} else if (value === IssueSource.Marketplace) {
				fileOnMarketplace = true;
			}

			this.issueReporterModel.update({ fileOnExtension, fileOnMarketplace });
			this.render();

			const title = (<HTMLInputElement>this.getElementById('issue-title')).value;
			this.searchIssues(title, fileOnExtension, fileOnMarketplace);
		});

		this.addEventListener('description', 'input', (e: Event) => {
			const issueDescription = (<HTMLInputElement>e.target).value;
			this.issueReporterModel.update({ issueDescription });

			// Only search for extension issues on title change
			if (this.issueReporterModel.fileOnExtension() === false) {
				const title = (<HTMLInputElement>this.getElementById('issue-title')).value;
				this.searchVSCodeIssues(title, issueDescription);
			}
		});

		this.addEventListener('issue-title', 'input', (e: Event) => {
			const title = (<HTMLInputElement>e.target).value;
			const lengthValidationMessage = this.getElementById('issue-title-length-validation-error');
			const issueUrl = this.getIssueUrl();
			if (title && this.getIssueUrlWithTitle(title, issueUrl).length > MAX_URL_LENGTH) {
				show(lengthValidationMessage);
			} else {
				hide(lengthValidationMessage);
			}
			const issueSource = this.getElementById<HTMLSelectElement>('issue-source');
			if (!issueSource || issueSource.value === '') {
				return;
			}

			const { fileOnExtension, fileOnMarketplace } = this.issueReporterModel.getData();
			this.searchIssues(title, fileOnExtension, fileOnMarketplace);
		});

		this.previewButton.onDidClick(() => this.createIssue());

		function sendWorkbenchCommand(commandId: string) {
			ipcRenderer.send('vscode:workbenchCommand', { id: commandId, from: 'issueReporter' });
		}

		this.addEventListener('disableExtensions', 'click', () => {
			sendWorkbenchCommand('workbench.action.reloadWindowWithExtensionsDisabled');
		});

		this.addEventListener('extensionBugsLink', 'click', (e: Event) => {
			const url = (<HTMLElement>e.target).innerText;
			windowOpenNoOpener(url);
		});

		this.addEventListener('disableExtensions', 'keydown', (e: Event) => {
			e.stopPropagation();
			if ((e as KeyboardEvent).keyCode === 13 || (e as KeyboardEvent).keyCode === 32) {
				sendWorkbenchCommand('workbench.extensions.action.disableAll');
				sendWorkbenchCommand('workbench.action.reloadWindow');
			}
		});

		document.onkeydown = async (e: KeyboardEvent) => {
			const cmdOrCtrlKey = isMacintosh ? e.metaKey : e.ctrlKey;
			// Cmd/Ctrl+Enter previews issue and closes window
			if (cmdOrCtrlKey && e.keyCode === 13) {
				if (await this.createIssue()) {
					ipcRenderer.send('vscode:closeIssueReporter');
				}
			}

			// Cmd/Ctrl + w closes issue window
			if (cmdOrCtrlKey && e.keyCode === 87) {
				e.stopPropagation();
				e.preventDefault();

				const issueTitle = (<HTMLInputElement>this.getElementById('issue-title'))!.value;
				const { issueDescription } = this.issueReporterModel.getData();
				if (!this.hasBeenSubmitted && (issueTitle || issueDescription)) {
					ipcRenderer.send('vscode:issueReporterConfirmClose');
				} else {
					ipcRenderer.send('vscode:closeIssueReporter');
				}
			}

			// Cmd/Ctrl + zooms in
			if (cmdOrCtrlKey && e.keyCode === 187) {
				zoomIn();
			}

			// Cmd/Ctrl - zooms out
			if (cmdOrCtrlKey && e.keyCode === 189) {
				zoomOut();
			}

			// With latest electron upgrade, cmd+a is no longer propagating correctly for inputs in this window on mac
			// Manually perform the selection
			if (isMacintosh) {
				if (cmdOrCtrlKey && e.keyCode === 65 && e.target) {
					if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
						(<HTMLInputElement>e.target).select();
					}
				}
			}
		};
	}

	private updatePreviewButtonState() {
		if (this.isPreviewEnabled()) {
			if (this.configuration.data.githubAccessToken) {
				this.previewButton.label = localize('createOnGitHub', "Create on GitHub");
			} else {
				this.previewButton.label = localize('previewOnGitHub', "Preview on GitHub");
			}
			this.previewButton.enabled = true;
		} else {
			this.previewButton.enabled = false;
			this.previewButton.label = localize('loadingData', "Loading data...");
		}
	}

	private isPreviewEnabled() {
		const issueType = this.issueReporterModel.getData().issueType;
		if (issueType === IssueType.Bug && this.receivedSystemInfo) {
			return true;
		}

		if (issueType === IssueType.PerformanceIssue && this.receivedSystemInfo && this.receivedPerformanceInfo) {
			return true;
		}

		if (issueType === IssueType.FeatureRequest) {
			return true;
		}

		return false;
	}

	private getExtensionRepositoryUrl(): string | undefined {
		const selectedExtension = this.issueReporterModel.getData().selectedExtension;
		return selectedExtension && selectedExtension.repositoryUrl;
	}

	private getExtensionBugsUrl(): string | undefined {
		const selectedExtension = this.issueReporterModel.getData().selectedExtension;
		return selectedExtension && selectedExtension.bugsUrl;
	}

	private searchVSCodeIssues(title: string, issueDescription?: string): void {
		if (title) {
			this.searchDuplicates(title, issueDescription);
		} else {
			this.clearSearchResults();
		}
	}

	private searchIssues(title: string, fileOnExtension: boolean | undefined, fileOnMarketplace: boolean | undefined): void {
		if (fileOnExtension) {
			return this.searchExtensionIssues(title);
		}

		if (fileOnMarketplace) {
			return this.searchMarketplaceIssues(title);
		}

		const description = this.issueReporterModel.getData().issueDescription;
		this.searchVSCodeIssues(title, description);
	}

	private searchExtensionIssues(title: string): void {
		const url = this.getExtensionGitHubUrl();
		if (title) {
			const matches = /^https?:\/\/github\.com\/(.*)/.exec(url);
			if (matches && matches.length) {
				const repo = matches[1];
				return this.searchGitHub(repo, title);
			}

			// If the extension has no repository, display empty search results
			if (this.issueReporterModel.getData().selectedExtension) {
				this.clearSearchResults();
				return this.displaySearchResults([]);

			}
		}

		this.clearSearchResults();
	}

	private searchMarketplaceIssues(title: string): void {
		if (title) {
			const gitHubInfo = this.parseGitHubUrl(this.configuration.product.reportMarketplaceIssueUrl!);
			if (gitHubInfo) {
				return this.searchGitHub(`${gitHubInfo.owner}/${gitHubInfo.repositoryName}`, title);
			}
		}
	}

	private clearSearchResults(): void {
		const similarIssues = this.getElementById('similar-issues')!;
		similarIssues.innerText = '';
		this.numberOfSearchResultsDisplayed = 0;
	}

	@debounce(300)
	private searchGitHub(repo: string, title: string): void {
		const query = `is:issue+repo:${repo}+${title}`;
		const similarIssues = this.getElementById('similar-issues')!;

		window.fetch(`https://api.github.com/search/issues?q=${query}`).then((response) => {
			response.json().then(result => {
				similarIssues.innerText = '';
				if (result && result.items) {
					this.displaySearchResults(result.items);
				} else {
					// If the items property isn't present, the rate limit has been hit
					const message = $('div.list-title');
					message.textContent = localize('rateLimited', "GitHub query limit exceeded. Please wait.");
					similarIssues.appendChild(message);

					const resetTime = response.headers.get('X-RateLimit-Reset');
					const timeToWait = resetTime ? parseInt(resetTime) - Math.floor(Date.now() / 1000) : 1;
					if (this.shouldQueueSearch) {
						this.shouldQueueSearch = false;
						setTimeout(() => {
							this.searchGitHub(repo, title);
							this.shouldQueueSearch = true;
						}, timeToWait * 1000);
					}
				}
			}).catch(_ => {
				// Ignore
			});
		}).catch(_ => {
			// Ignore
		});
	}

	@debounce(300)
	private searchDuplicates(title: string, body?: string): void {
		const url = 'https://vscode-probot.westus.cloudapp.azure.com:7890/duplicate_candidates';
		const init = {
			method: 'POST',
			body: JSON.stringify({
				title,
				body
			}),
			headers: new Headers({
				'Content-Type': 'application/json'
			})
		};

		window.fetch(url, init).then((response) => {
			response.json().then(result => {
				this.clearSearchResults();

				if (result && result.candidates) {
					this.displaySearchResults(result.candidates);
				} else {
					throw new Error('Unexpected response, no candidates property');
				}
			}).catch(_ => {
				// Ignore
			});
		}).catch(_ => {
			// Ignore
		});
	}

	private displaySearchResults(results: SearchResult[]) {
		const similarIssues = this.getElementById('similar-issues')!;
		if (results.length) {
			const issues = $('div.issues-container');
			const issuesText = $('div.list-title');
			issuesText.textContent = localize('similarIssues', "Similar issues");

			this.numberOfSearchResultsDisplayed = results.length < 5 ? results.length : 5;
			for (let i = 0; i < this.numberOfSearchResultsDisplayed; i++) {
				const issue = results[i];
				const link = $('a.issue-link', { href: issue.html_url });
				link.textContent = issue.title;
				link.title = issue.title;
				link.addEventListener('click', (e) => this.openLink(e));
				link.addEventListener('auxclick', (e) => this.openLink(<MouseEvent>e));

				let issueState: HTMLElement;
				let item: HTMLElement;
				if (issue.state) {
					issueState = $('span.issue-state');

					const issueIcon = $('span.issue-icon');
					issueIcon.appendChild(renderIcon(issue.state === 'open' ? Codicon.issueOpened : Codicon.issueClosed));

					const issueStateLabel = $('span.issue-state.label');
					issueStateLabel.textContent = issue.state === 'open' ? localize('open', "Open") : localize('closed', "Closed");

					issueState.title = issue.state === 'open' ? localize('open', "Open") : localize('closed', "Closed");
					issueState.appendChild(issueIcon);
					issueState.appendChild(issueStateLabel);

					item = $('div.issue', undefined, issueState, link);
				} else {
					item = $('div.issue', undefined, link);
				}

				issues.appendChild(item);
			}

			similarIssues.appendChild(issuesText);
			similarIssues.appendChild(issues);
		} else {
			const message = $('div.list-title');
			message.textContent = localize('noSimilarIssues', "No similar issues found");
			similarIssues.appendChild(message);
		}
	}

	private setUpTypes(): void {
		const makeOption = (issueType: IssueType, description: string) => $('option', { 'value': issueType.valueOf() }, escape(description));

		const typeSelect = this.getElementById('issue-type')! as HTMLSelectElement;
		const { issueType } = this.issueReporterModel.getData();
		reset(typeSelect,
			makeOption(IssueType.Bug, localize('bugReporter', "Bug Report")),
			makeOption(IssueType.FeatureRequest, localize('featureRequest', "Feature Request")),
			makeOption(IssueType.PerformanceIssue, localize('performanceIssue', "Performance Issue")),
		);

		typeSelect.value = issueType.toString();

		this.setSourceOptions();
	}

	private makeOption(value: string, description: string, disabled: boolean): HTMLOptionElement {
		const option: HTMLOptionElement = document.createElement('option');
		option.disabled = disabled;
		option.value = value;
		option.textContent = description;

		return option;
	}

	private setSourceOptions(): void {
		const sourceSelect = this.getElementById('issue-source')! as HTMLSelectElement;
		const { issueType, fileOnExtension, selectedExtension } = this.issueReporterModel.getData();
		let selected = sourceSelect.selectedIndex;
		if (selected === -1) {
			if (fileOnExtension !== undefined) {
				selected = fileOnExtension ? 2 : 1;
			} else if (selectedExtension?.isBuiltin) {
				selected = 1;
			}
		}

		sourceSelect.innerText = '';
		sourceSelect.append(this.makeOption('', localize('selectSource', "Select source"), true));
		sourceSelect.append(this.makeOption('vscode', localize('vscode', "Visual Studio Code"), false));
		sourceSelect.append(this.makeOption('extension', localize('extension', "An extension"), false));
		if (this.configuration.product.reportMarketplaceIssueUrl) {
			sourceSelect.append(this.makeOption('marketplace', localize('marketplace', "Extensions marketplace"), false));
		}

		if (issueType !== IssueType.FeatureRequest) {
			sourceSelect.append(this.makeOption('', localize('unknown', "Don't know"), false));
		}

		if (selected !== -1 && selected < sourceSelect.options.length) {
			sourceSelect.selectedIndex = selected;
		} else {
			sourceSelect.selectedIndex = 0;
			hide(this.getElementById('problem-source-help-text'));
		}
	}

	private renderBlocks(): void {
		// Depending on Issue Type, we render different blocks and text
		const { issueType, fileOnExtension, fileOnMarketplace } = this.issueReporterModel.getData();
		const blockContainer = this.getElementById('block-container');
		const systemBlock = document.querySelector('.block-system');
		const processBlock = document.querySelector('.block-process');
		const workspaceBlock = document.querySelector('.block-workspace');
		const extensionsBlock = document.querySelector('.block-extensions');
		const experimentsBlock = document.querySelector('.block-experiments');

		const problemSource = this.getElementById('problem-source')!;
		const descriptionTitle = this.getElementById('issue-description-label')!;
		const descriptionSubtitle = this.getElementById('issue-description-subtitle')!;
		const extensionSelector = this.getElementById('extension-selection')!;

		// Hide all by default
		hide(blockContainer);
		hide(systemBlock);
		hide(processBlock);
		hide(workspaceBlock);
		hide(extensionsBlock);
		hide(experimentsBlock);
		hide(problemSource);
		hide(extensionSelector);

		if (issueType === IssueType.Bug) {
			show(problemSource);

			if (!fileOnMarketplace) {
				show(blockContainer);
				show(systemBlock);
				show(experimentsBlock);
			}

			if (fileOnExtension) {
				show(extensionSelector);
			} else if (!fileOnMarketplace) {
				show(extensionsBlock);
			}
			reset(descriptionTitle, localize('stepsToReproduce', "Steps to Reproduce"), $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('bugDescription', "Share the steps needed to reliably reproduce the problem. Please include actual and expected results. We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
		} else if (issueType === IssueType.PerformanceIssue) {
			show(problemSource);

			if (!fileOnMarketplace) {
				show(blockContainer);
				show(systemBlock);
				show(processBlock);
				show(workspaceBlock);
				show(experimentsBlock);
			}

			if (fileOnExtension) {
				show(extensionSelector);
			} else if (!fileOnMarketplace) {
				show(extensionsBlock);
			}

			reset(descriptionTitle, localize('stepsToReproduce', "Steps to Reproduce"), $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('performanceIssueDesciption', "When did this performance issue happen? Does it occur on startup or after a specific series of actions? We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
		} else if (issueType === IssueType.FeatureRequest) {
			reset(descriptionTitle, localize('description', "Description"), $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('featureRequestDescription', "Please describe the feature you would like to see. We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
			show(problemSource);

			if (fileOnExtension) {
				show(extensionSelector);
			}
		}
	}

	private validateInput(inputId: string): boolean {
		const inputElement = (<HTMLInputElement>this.getElementById(inputId));
		const inputValidationMessage = this.getElementById(`${inputId}-empty-error`);
		if (!inputElement.value) {
			inputElement.classList.add('invalid-input');
			inputValidationMessage?.classList.remove('hidden');
			return false;
		} else {
			inputElement.classList.remove('invalid-input');
			inputValidationMessage?.classList.add('hidden');
			return true;
		}
	}

	private validateInputs(): boolean {
		let isValid = true;
		['issue-title', 'description', 'issue-source'].forEach(elementId => {
			isValid = this.validateInput(elementId) && isValid;
		});

		if (this.issueReporterModel.fileOnExtension()) {
			isValid = this.validateInput('extension-selector') && isValid;
		}

		return isValid;
	}

	private async submitToGitHub(issueTitle: string, issueBody: string, gitHubDetails: { owner: string, repositoryName: string }): Promise<boolean> {
		const url = `https://api.github.com/repos/${gitHubDetails.owner}/${gitHubDetails.repositoryName}/issues`;
		const init = {
			method: 'POST',
			body: JSON.stringify({
				title: issueTitle,
				body: issueBody
			}),
			headers: new Headers({
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.configuration.data.githubAccessToken}`
			})
		};

		return new Promise((resolve, reject) => {
			window.fetch(url, init).then((response) => {
				if (response.ok) {
					response.json().then(result => {
						ipcRenderer.send('vscode:openExternal', result.html_url);
						ipcRenderer.send('vscode:closeIssueReporter');
						resolve(true);
					});
				} else {
					resolve(false);
				}
			});
		});
	}

	private async createIssue(): Promise<boolean> {
		if (!this.validateInputs()) {
			// If inputs are invalid, set focus to the first one and add listeners on them
			// to detect further changes
			const invalidInput = document.getElementsByClassName('invalid-input');
			if (invalidInput.length) {
				(<HTMLInputElement>invalidInput[0]).focus();
			}

			this.addEventListener('issue-title', 'input', _ => {
				this.validateInput('issue-title');
			});

			this.addEventListener('description', 'input', _ => {
				this.validateInput('description');
			});

			this.addEventListener('issue-source', 'change', _ => {
				this.validateInput('issue-source');
			});

			if (this.issueReporterModel.fileOnExtension()) {
				this.addEventListener('extension-selector', 'change', _ => {
					this.validateInput('extension-selector');
				});
			}

			return false;
		}

		this.hasBeenSubmitted = true;

		const issueTitle = (<HTMLInputElement>this.getElementById('issue-title')).value;
		const issueBody = this.issueReporterModel.serialize();

		const issueUrl = this.getIssueUrl();
		const gitHubDetails = this.parseGitHubUrl(issueUrl);
		if (this.configuration.data.githubAccessToken && gitHubDetails) {
			return this.submitToGitHub(issueTitle, issueBody, gitHubDetails);
		}

		const baseUrl = this.getIssueUrlWithTitle((<HTMLInputElement>this.getElementById('issue-title')).value, issueUrl);
		let url = baseUrl + `&body=${encodeURIComponent(issueBody)}`;

		if (url.length > MAX_URL_LENGTH) {
			try {
				url = await this.writeToClipboard(baseUrl, issueBody);
			} catch (_) {
				return false;
			}
		}

		ipcRenderer.send('vscode:openExternal', url);
		return true;
	}

	private async writeToClipboard(baseUrl: string, issueBody: string): Promise<string> {
		return new Promise((resolve, reject) => {
			ipcRenderer.once('vscode:issueReporterClipboardResponse', async (event: unknown, shouldWrite: boolean) => {
				if (shouldWrite) {
					await this.nativeHostService.writeClipboardText(issueBody);
					resolve(baseUrl + `&body=${encodeURIComponent(localize('pasteData', "We have written the needed data into your clipboard because it was too large to send. Please paste."))}`);
				} else {
					reject();
				}
			});

			ipcRenderer.send('vscode:issueReporterClipboard');
		});
	}

	private getIssueUrl(): string {
		return this.issueReporterModel.fileOnExtension()
			? this.getExtensionGitHubUrl()
			: this.issueReporterModel.getData().fileOnMarketplace
				? this.configuration.product.reportMarketplaceIssueUrl!
				: this.configuration.product.reportIssueUrl!;
	}

	private parseGitHubUrl(url: string): undefined | { repositoryName: string, owner: string } {
		// Assumes a GitHub url to a particular repo, https://github.com/repositoryName/owner.
		// Repository name and owner cannot contain '/'
		const match = /^https?:\/\/github\.com\/([^\/]*)\/([^\/]*).*/.exec(url);
		if (match && match.length) {
			return {
				owner: match[1],
				repositoryName: match[2]
			};
		}

		return undefined;
	}

	private getExtensionGitHubUrl(): string {
		let repositoryUrl = '';
		const bugsUrl = this.getExtensionBugsUrl();
		const extensionUrl = this.getExtensionRepositoryUrl();
		// If given, try to match the extension's bug url
		if (bugsUrl && bugsUrl.match(/^https?:\/\/github\.com\/(.*)/)) {
			repositoryUrl = normalizeGitHubUrl(bugsUrl);
		} else if (extensionUrl && extensionUrl.match(/^https?:\/\/github\.com\/(.*)/)) {
			repositoryUrl = normalizeGitHubUrl(extensionUrl);
		}

		return repositoryUrl;
	}

	private getIssueUrlWithTitle(issueTitle: string, repositoryUrl: string): string {
		if (this.issueReporterModel.fileOnExtension()) {
			repositoryUrl = repositoryUrl + '/issues/new';
		}

		const queryStringPrefix = repositoryUrl.indexOf('?') === -1 ? '?' : '&';
		return `${repositoryUrl}${queryStringPrefix}title=${encodeURIComponent(issueTitle)}`;
	}

	private updateSystemInfo(state: IssueReporterModelData) {
		const target = document.querySelector<HTMLElement>('.block-system .block-info');

		if (target) {
			const systemInfo = state.systemInfo!;
			const renderedDataTable = $('table', undefined,
				$('tr', undefined,
					$('td', undefined, 'CPUs'),
					$('td', undefined, systemInfo.cpus || ''),
				),
				$('tr', undefined,
					$('td', undefined, 'GPU Status' as string),
					$('td', undefined, Object.keys(systemInfo.gpuStatus).map(key => `${key}: ${systemInfo.gpuStatus[key]}`).join('\n')),
				),
				$('tr', undefined,
					$('td', undefined, 'Load (avg)' as string),
					$('td', undefined, systemInfo.load || ''),
				),
				$('tr', undefined,
					$('td', undefined, 'Memory (System)' as string),
					$('td', undefined, systemInfo.memory),
				),
				$('tr', undefined,
					$('td', undefined, 'Process Argv' as string),
					$('td', undefined, systemInfo.processArgs),
				),
				$('tr', undefined,
					$('td', undefined, 'Screen Reader' as string),
					$('td', undefined, systemInfo.screenReader),
				),
				$('tr', undefined,
					$('td', undefined, 'VM'),
					$('td', undefined, systemInfo.vmHint),
				),
			);
			reset(target, renderedDataTable);

			systemInfo.remoteData.forEach(remote => {
				target.appendChild($<HTMLHRElement>('hr'));
				if (isRemoteDiagnosticError(remote)) {
					const remoteDataTable = $('table', undefined,
						$('tr', undefined,
							$('td', undefined, 'Remote'),
							$('td', undefined, remote.hostName)
						),
						$('tr', undefined,
							$('td', undefined, ''),
							$('td', undefined, remote.errorMessage)
						)
					);
					target.appendChild(remoteDataTable);
				} else {
					const remoteDataTable = $('table', undefined,
						$('tr', undefined,
							$('td', undefined, 'Remote'),
							$('td', undefined, remote.hostName)
						),
						$('tr', undefined,
							$('td', undefined, 'OS'),
							$('td', undefined, remote.machineInfo.os)
						),
						$('tr', undefined,
							$('td', undefined, 'CPUs'),
							$('td', undefined, remote.machineInfo.cpus || '')
						),
						$('tr', undefined,
							$('td', undefined, 'Memory (System)' as string),
							$('td', undefined, remote.machineInfo.memory)
						),
						$('tr', undefined,
							$('td', undefined, 'VM'),
							$('td', undefined, remote.machineInfo.vmHint)
						),
					);
					target.appendChild(remoteDataTable);
				}
			});
		}
	}

	private updateExtensionSelector(extensions: IssueReporterExtensionData[]): void {
		interface IOption {
			name: string;
			id: string;
		}

		const extensionOptions: IOption[] = extensions.map(extension => {
			return {
				name: extension.displayName || extension.name || '',
				id: extension.id
			};
		});

		// Sort extensions by name
		extensionOptions.sort((a, b) => {
			const aName = a.name.toLowerCase();
			const bName = b.name.toLowerCase();
			if (aName > bName) {
				return 1;
			}

			if (aName < bName) {
				return -1;
			}

			return 0;
		});

		const makeOption = (extension: IOption, selectedExtension?: IssueReporterExtensionData): HTMLOptionElement => {
			const selected = selectedExtension && extension.id === selectedExtension.id;
			return $<HTMLOptionElement>('option', {
				'value': extension.id,
				'selected': selected || ''
			}, extension.name);
		};

		const extensionsSelector = this.getElementById('extension-selector');
		if (extensionsSelector) {
			const { selectedExtension } = this.issueReporterModel.getData();
			reset(extensionsSelector, $<HTMLOptionElement>('option'), ...extensionOptions.map(extension => makeOption(extension, selectedExtension)));

			this.addEventListener('extension-selector', 'change', (e: Event) => {
				const selectedExtensionId = (<HTMLInputElement>e.target).value;
				const extensions = this.issueReporterModel.getData().allExtensions;
				const matches = extensions.filter(extension => extension.id === selectedExtensionId);
				if (matches.length) {
					this.issueReporterModel.update({ selectedExtension: matches[0] });
					this.validateSelectedExtension();

					const title = (<HTMLInputElement>this.getElementById('issue-title')).value;
					this.searchExtensionIssues(title);
				} else {
					this.issueReporterModel.update({ selectedExtension: undefined });
					this.clearSearchResults();
					this.validateSelectedExtension();
				}
			});
		}

		this.addEventListener('problem-source', 'change', (_) => {
			this.validateSelectedExtension();
		});
	}

	private validateSelectedExtension(): void {
		const extensionValidationMessage = this.getElementById('extension-selection-validation-error')!;
		const extensionValidationNoUrlsMessage = this.getElementById('extension-selection-validation-error-no-url')!;
		hide(extensionValidationMessage);
		hide(extensionValidationNoUrlsMessage);

		if (!this.issueReporterModel.getData().selectedExtension) {
			this.previewButton.enabled = true;
			return;
		}

		const hasValidGitHubUrl = this.getExtensionGitHubUrl();
		if (hasValidGitHubUrl) {
			this.previewButton.enabled = true;
		} else {
			this.setExtensionValidationMessage();
			this.previewButton.enabled = false;
		}
	}

	private setExtensionValidationMessage(): void {
		const extensionValidationMessage = this.getElementById('extension-selection-validation-error')!;
		const extensionValidationNoUrlsMessage = this.getElementById('extension-selection-validation-error-no-url')!;
		const bugsUrl = this.getExtensionBugsUrl();
		if (bugsUrl) {
			show(extensionValidationMessage);
			const link = this.getElementById('extensionBugsLink')!;
			link.textContent = bugsUrl;
			return;
		}

		const extensionUrl = this.getExtensionRepositoryUrl();
		if (extensionUrl) {
			show(extensionValidationMessage);
			const link = this.getElementById('extensionBugsLink');
			link!.textContent = extensionUrl;
			return;
		}

		show(extensionValidationNoUrlsMessage);
	}

	private updateProcessInfo(state: IssueReporterModelData) {
		const target = document.querySelector('.block-process .block-info') as HTMLElement;
		if (target) {
			reset(target, $('code', undefined, state.processInfo));
		}
	}

	private updateWorkspaceInfo(state: IssueReporterModelData) {
		document.querySelector('.block-workspace .block-info code')!.textContent = '\n' + state.workspaceInfo;
	}

	private updateExtensionTable(extensions: IssueReporterExtensionData[], numThemeExtensions: number): void {
		const target = document.querySelector<HTMLElement>('.block-extensions .block-info');
		if (target) {
			if (this.configuration.disableExtensions) {
				reset(target, localize('disabledExtensions', "Extensions are disabled"));
				return;
			}

			const themeExclusionStr = numThemeExtensions ? `\n(${numThemeExtensions} theme extensions excluded)` : '';
			extensions = extensions || [];

			if (!extensions.length) {
				target.innerText = 'Extensions: none' + themeExclusionStr;
				return;
			}

			reset(target, this.getExtensionTableHtml(extensions), document.createTextNode(themeExclusionStr));
		}
	}

	private updateExperimentsInfo(experimentInfo: string | undefined) {
		this.issueReporterModel.update({ experimentInfo });
		const target = document.querySelector<HTMLElement>('.block-experiments .block-info');
		if (target) {
			target.textContent = experimentInfo ? experimentInfo : localize('noCurrentExperiments', "No current experiments.");
		}
	}

	private getExtensionTableHtml(extensions: IssueReporterExtensionData[]): HTMLTableElement {
		return $('table', undefined,
			$('tr', undefined,
				$('th', undefined, 'Extension'),
				$('th', undefined, 'Author (truncated)' as string),
				$('th', undefined, 'Version'),
			),
			...extensions.map(extension => $('tr', undefined,
				$('td', undefined, extension.name),
				$('td', undefined, extension.publisher?.substr(0, 3) ?? 'N/A'),
				$('td', undefined, extension.version),
			))
		);
	}

	private openLink(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		// Exclude right click
		if (event.which < 3) {
			windowOpenNoOpener((<HTMLAnchorElement>event.target).href);
		}
	}

	private getElementById<T extends HTMLElement = HTMLElement>(elementId: string): T | undefined {
		const element = document.getElementById(elementId) as T | undefined;
		if (element) {
			return element;
		} else {
			return undefined;
		}
	}

	private addEventListener(elementId: string, eventType: string, handler: (event: Event) => void): void {
		const element = this.getElementById(elementId);
		if (element) {
			element.addEventListener(eventType, handler);
		}
	}
}

// helper functions

function hide(el: Element | undefined | null) {
	if (el) {
		el.classList.add('hidden');
	}
}
function show(el: Element | undefined | null) {
	if (el) {
		el.classList.remove('hidden');
	}
}
