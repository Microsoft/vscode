/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PushErrorHandler, GitErrorCodes, Repository, Remote } from './typings/git';
import { window, ProgressLocation, commands, Uri } from 'vscode';
import * as nls from 'vscode-nls';
import { getOctokit } from './auth';

const localize = nls.loadMessageBundle();

async function handlePushError(repository: Repository, remote: Remote, refspec: string, owner: string, repo: string): Promise<void> {
	const yes = localize('create a fork', "Create Fork");
	const no = localize('no', "No");

	const answer = await window.showInformationMessage(localize('fork', "You don't have permissions to push to '{0}/{1}' on GitHub. Would you like to create a fork and push to it instead?", owner, repo), yes, no);

	if (answer === no) {
		return;
	}

	const match = /^([^:]*):([^:]*)$/.exec(refspec);
	const localName = match ? match[1] : refspec;
	const remoteName = match ? match[2] : refspec;

	const [octokit, ghRepository] = await window.withProgress({ location: ProgressLocation.Notification, cancellable: false, title: localize('create fork', 'Create GitHub fork') }, async progress => {
		progress.report({ message: localize('forking', "Forking '{0}/{1}'...", owner, repo), increment: 33 });

		const octokit = await getOctokit();

		// Issue: what if the repo already exists?
		const res = await octokit.repos.createFork({ owner, repo });
		const ghRepository = res.data;

		progress.report({ message: localize('pushing', "Pushing changes..."), increment: 33 });

		// Issue: what if there's already an `upstream` repo?
		await repository.renameRemote(remote.name, 'upstream');

		// Issue: what if there's already another `origin` repo?
		await repository.addRemote('origin', ghRepository.clone_url);

		try {
			await repository.fetch('origin', remoteName);
			await repository.setBranchUpstream(localName, `origin/${remoteName}`);
		} catch {
			// noop
		}

		await repository.push('origin', localName, true);

		return [octokit, ghRepository];
	});

	// yield
	(async () => {
		const openInGitHub = localize('openingithub', "Open In GitHub");
		const createPR = localize('createpr', "Create PR");
		const action = await window.showInformationMessage(localize('done', "The fork '{0}' was successfully created on GitHub.", ghRepository.full_name), openInGitHub, createPR);

		if (action === openInGitHub) {
			await commands.executeCommand('vscode.open', Uri.parse(ghRepository.html_url));
		} else if (action === createPR) {
			const pr = await window.withProgress({ location: ProgressLocation.Notification, cancellable: false, title: localize('createghpr', "Creating GitHub Pull Request...") }, async _ => {
				let title = `Update ${remoteName}`;
				const head = repository.state.HEAD?.name;

				if (head) {
					const commit = await repository.getCommit(head);
					title = commit.message.replace(/\n.*$/m, '');
				}

				const res = await octokit.pulls.create({
					owner,
					repo,
					title,
					head: `${ghRepository.owner.login}:${remoteName}`,
					base: remoteName
				});

				await repository.setConfig(`branch.${localName}.remote`, 'upstream');
				await repository.setConfig(`branch.${localName}.merge`, `refs/heads/${remoteName}`);
				await repository.setConfig(`branch.${localName}.github-pr-owner-number`, `${owner}#${repo}#${pr.number}`);

				return res.data;
			});

			const openPR = localize('openpr', "Open PR");
			const action = await window.showInformationMessage(localize('donepr', "The PR '{0}/{1}#{2}' was successfully created on GitHub.", owner, repo, pr.number), openPR);

			if (action === openPR) {
				await commands.executeCommand('vscode.open', Uri.parse(pr.html_url));
			}
		}
	})();
}

export class GithubPushErrorHandler implements PushErrorHandler {

	async handlePushError(repository: Repository, remote: Remote, refspec: string, error: Error & { gitErrorCode: GitErrorCodes }): Promise<boolean> {
		if (error.gitErrorCode !== GitErrorCodes.PermissionDenied) {
			return false;
		}

		if (!remote.pushUrl) {
			return false;
		}

		const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\.git/i.exec(remote.pushUrl)
			|| /^git@github\.com:([^/]+)\/([^/]+)\.git/i.exec(remote.pushUrl);

		if (!match) {
			return false;
		}

		if (/^:/.test(refspec)) {
			return false;
		}

		const [, owner, repo] = match;
		await handlePushError(repository, remote, refspec, owner, repo);

		return true;
	}
}
