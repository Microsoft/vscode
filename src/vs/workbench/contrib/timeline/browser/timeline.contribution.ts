/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IViewsRegistry, IViewDescriptor, Extensions as ViewExtensions } from 'vs/workbench/common/views';
import { VIEW_CONTAINER } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { ITimelineService, TimelinePaneId } from 'vs/workbench/contrib/timeline/common/timeline';
import { TimelineHasProviderContext, TimelineService } from 'vs/workbench/contrib/timeline/common/timelineService';
import { TimelinePane } from './timelinePane';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { ICommandHandler, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ExplorerFolderContext } from 'vs/workbench/contrib/files/common/files';
import { ResourceContextKey } from 'vs/workbench/common/resources';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';


const timelineViewIcon = registerIcon('timeline-view-icon', Codicon.history, localize('timelineViewIcon', 'View icon of the timeline view.'));
const timelineOpenIcon = registerIcon('timeline-open', Codicon.history, localize('timelineOpenIcon', 'Icon for the open timeline action.'));

export class TimelinePaneDescriptor implements IViewDescriptor {
	readonly id = TimelinePaneId;
	readonly name = TimelinePane.TITLE;
	readonly containerIcon = timelineViewIcon;
	readonly ctorDescriptor = new SyncDescriptor(TimelinePane);
	readonly order = 2;
	readonly weight = 30;
	readonly collapsed = true;
	readonly canToggleVisibility = true;
	readonly hideByDefault = false;
	readonly canMoveView = true;
	readonly when = TimelineHasProviderContext;

	focusCommand = { id: 'timeline.focus' };
}

// Configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'timeline',
	order: 1001,
	title: localize('timelineConfigurationTitle', "Timeline"),
	type: 'object',
	properties: {
		'timeline.excludeSources': {
			type: [
				'array',
				'null'
			],
			default: null,
			description: localize('timeline.excludeSources', "An array of Timeline sources that should be excluded from the Timeline view."),
		},
		'timeline.pageSize': {
			type: ['number', 'null'],
			default: null,
			markdownDescription: localize('timeline.pageSize', "The number of items to show in the Timeline view by default and when loading more items. Setting to `null` (the default) will automatically choose a page size based on the visible area of the Timeline view."),
		},
		'timeline.pageOnScroll': {
			type: 'boolean',
			default: false,
			description: localize('timeline.pageOnScroll', "Experimental. Controls whether the Timeline view will load the next page of items when you scroll to the end of the list."),
		},
	}
});

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([new TimelinePaneDescriptor()], VIEW_CONTAINER);

namespace OpenTimelineAction {

	export const ID = 'files.openTimeline';
	export const LABEL = localize('files.openTimeline', "Open Timeline");

	export function handler(): ICommandHandler {
		return (accessor, arg) => {
			const service = accessor.get(ITimelineService);
			return service.setUri(arg);
		};
	}
}

CommandsRegistry.registerCommand(OpenTimelineAction.ID, OpenTimelineAction.handler());

MenuRegistry.appendMenuItem(MenuId.ExplorerContext, ({
	group: '4_timeline',
	order: 1,
	command: {
		id: OpenTimelineAction.ID,
		title: OpenTimelineAction.LABEL,
		icon: timelineOpenIcon
	},
	when: ContextKeyExpr.and(ExplorerFolderContext.toNegated(), ResourceContextKey.HasResource, TimelineHasProviderContext)
}));

registerSingleton(ITimelineService, TimelineService, true);
