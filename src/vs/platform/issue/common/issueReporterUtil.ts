/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { endsWith, rtrim } from 'vs/base/common/strings';

export function normalizeGitHubUrl(url: string): string {
	// If the url has a .git suffix, remove it
	if (endsWith(url, '.git')) {
		url = url.substr(0, url.length - 4);
	}

	// Remove trailing slash
	url = rtrim(url, '/');

	if (endsWith(url, '/new')) {
		url = rtrim(url, '/new');
	}

	if (endsWith(url, '/issues')) {
		url = rtrim(url, '/issues');
	}

	return url;
}
