/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escape } from 'vs/base/common/strings';
import { localize } from 'vs/nls';

export default () => `
<div class="gettingStartedContainer">
	<div class="gettingStarted" role="document">
		<div id="gettingStartedSlideCategory" class="gettingStartedSlide categories">
			<div class="gap"></div>
			<div class="header">
				<h1 id="product-name" class="caption">${escape(localize('gettingStarted.vscode', "Visual Studio Code"))}</h1>
				<p class="subtitle description">${escape(localize({ key: 'gettingStarted.editingRedefined', comment: ['Shown as subtitle on the Welcome page.'] }, "Code editing. Redefined"))}</p>
			</div>
			<div id="getting-started-categories-container"></div>
			<div class="gap"></div>
		</div>
		<div id="gettingStartedSlideDetails" class="gettingStartedSlide detail">
			<a class="prev-button" x-dispatch="scrollPrev"><span
					class="scroll-button codicon codicon-chevron-left"></span>Back</a>
			<div id="getting-started-detail-columns">
				<div id="getting-started-detail-left">
					<div id="getting-started-detail-title"></div>
					<div id="getting-started-detail-container"></div>
				</div>
				<div id="getting-started-detail-right">
				</div>
			</div>
		</div>
		<div class="footer">
			<a class="skip" x-dispatch="skip">Skip</a>
		</div>
	</div>
</div>
`.replace(/\|/g, '`');
