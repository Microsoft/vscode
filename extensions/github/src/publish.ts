/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { API as GitAPI, Repository } from './typings/git';
import { getOctokit } from './auth';
import { TextEncoder } from 'util';
import { basename } from 'path';
import { Octokit } from '@octokit/rest';

const localize = nls.loadMessageBundle();

function sanitizeRepositoryName(value: string): string {
	return value.trim().replace(/[^a-z0-9_.]/ig, '-');
}

function getPick<T extends vscode.QuickPickItem>(quickpick: vscode.QuickPick<T>): Promise<T | undefined> {
	return Promise.race<T | undefined>([
		new Promise<T>(c => quickpick.onDidAccept(() => quickpick.selectedItems.length > 0 && c(quickpick.selectedItems[0]))),
		new Promise<undefined>(c => quickpick.onDidHide(() => c(undefined)))
	]);
}

export async function publishRepository(gitAPI: GitAPI, repository?: Repository): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length) {
		return;
	}

	let folder: vscode.Uri;

	if (repository) {
		folder = repository.rootUri;
	} else if (gitAPI.repositories.length === 1) {
		repository = gitAPI.repositories[0];
		folder = repository.rootUri;
	} else if (vscode.workspace.workspaceFolders.length === 1) {
		folder = vscode.workspace.workspaceFolders[0].uri;
	} else {
		const picks = vscode.workspace.workspaceFolders.map(folder => ({ label: folder.name, folder }));
		const placeHolder = localize('pick folder', "Pick a folder to publish to GitHub");
		const pick = await vscode.window.showQuickPick(picks, { placeHolder });

		if (!pick) {
			return;
		}

		folder = pick.folder.uri;
	}

	let quickpick = vscode.window.createQuickPick<vscode.QuickPickItem & { repo?: string, auth?: 'https' | 'ssh', isPrivate?: boolean }>();
	quickpick.ignoreFocusOut = true;

	quickpick.placeholder = 'Repository Name';
	quickpick.value = basename(folder.fsPath);
	quickpick.show();
	quickpick.busy = true;

	let owner: string;
	let octokit: Octokit;
	try {
		octokit = await getOctokit();
		const user = await octokit.users.getAuthenticated({});
		owner = user.data.login;
	} catch (e) {
		// User has cancelled sign in
		quickpick.dispose();
		return;
	}

	quickpick.busy = false;

	let repo: string | undefined;
	let isPrivate: boolean;

	const onDidChangeValue = async () => {
		const sanitizedRepo = sanitizeRepositoryName(quickpick.value);

		if (!sanitizedRepo) {
			quickpick.items = [];
		} else {
			quickpick.items = [
				{ label: `$(repo) Publish to GitHub private repository`, description: `$(github) ${owner}/${sanitizedRepo}`, alwaysShow: true, repo: sanitizedRepo, isPrivate: true },
				{ label: `$(repo) Publish to GitHub public repository`, description: `$(github) ${owner}/${sanitizedRepo}`, alwaysShow: true, repo: sanitizedRepo, isPrivate: false },
			];
		}
	};

	onDidChangeValue();

	while (true) {
		const listener = quickpick.onDidChangeValue(onDidChangeValue);
		const pick = await getPick(quickpick);
		listener.dispose();

		repo = pick?.repo;
		isPrivate = pick?.isPrivate ?? true;

		if (repo) {
			try {
				quickpick.busy = true;
				await octokit.repos.get({ owner, repo: repo });
				quickpick.items = [{ label: `$(error) GitHub repository already exists`, description: `$(github) ${owner}/${repo}`, alwaysShow: true }];
			} catch {
				break;
			} finally {
				quickpick.busy = false;
			}
		}
	}

	quickpick.dispose();

	if (!repo) {
		return;
	}

	if (!repository) {
		const gitignore = vscode.Uri.joinPath(folder, '.gitignore');
		let shouldGenerateGitignore = false;

		try {
			await vscode.workspace.fs.stat(gitignore);
		} catch (err) {
			shouldGenerateGitignore = true;
		}

		if (shouldGenerateGitignore) {
			quickpick = vscode.window.createQuickPick();
			quickpick.placeholder = localize('ignore', "Select which files should be included in the repository.");
			quickpick.canSelectMany = true;
			quickpick.show();

			try {
				quickpick.busy = true;

				const children = (await vscode.workspace.fs.readDirectory(folder))
					.map(([name]) => name)
					.filter(name => name !== '.git');

				quickpick.items = children.map(name => ({ label: name }));
				quickpick.selectedItems = quickpick.items;
				quickpick.busy = false;

				const result = await Promise.race([
					new Promise<readonly vscode.QuickPickItem[]>(c => quickpick.onDidAccept(() => c(quickpick.selectedItems))),
					new Promise<undefined>(c => quickpick.onDidHide(() => c(undefined)))
				]);

				if (!result) {
					return;
				}

				const ignored = new Set(children);
				result.forEach(c => ignored.delete(c.label));

				if (ignored.size > 0) {
					const raw = [...ignored].map(i => `/${i}`).join('\n');
					const encoder = new TextEncoder();
					await vscode.workspace.fs.writeFile(gitignore, encoder.encode(raw));
				}
			} finally {
				quickpick.dispose();
			}
		}
	}

	const githubRepository = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, cancellable: false, title: 'Publish to GitHub' }, async progress => {
		progress.report({ message: `Publishing to GitHub ${isPrivate ? 'private' : 'public'} repository`, increment: 25 });

		const res = await octokit.repos.createForAuthenticatedUser({
			name: repo!,
			private: isPrivate
		});

		const createdGithubRepository = res.data;

		progress.report({ message: 'Creating first commit', increment: 25 });

		if (!repository) {
			repository = await gitAPI.init(folder) || undefined;

			if (!repository) {
				return;
			}

			await repository.commit('first commit', { all: true });
		}

		progress.report({ message: 'Uploading files', increment: 25 });
		const branch = await repository.getBranch('HEAD');
		await repository.addRemote('origin', createdGithubRepository.clone_url);
		await repository.push('origin', branch.name, true);

		return createdGithubRepository;
	});

	if (!githubRepository) {
		return;
	}

	const openInGitHub = 'Open In GitHub';
	vscode.window.showInformationMessage(`Successfully published the '${owner}/${repo}' repository on GitHub.`, openInGitHub).then(action => {
		if (action === openInGitHub) {
			vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(githubRepository.html_url));
		}
	});
}
