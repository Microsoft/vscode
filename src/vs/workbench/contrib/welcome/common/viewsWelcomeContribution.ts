/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IExtensionPoint } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { ViewsWelcomeExtensionPoint, ViewWelcome, ViewIdentifierMap } from './viewsWelcomeExtensionPoint';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ViewContainerExtensions, IViewsRegistry, ViewContentPriority } from 'vs/workbench/common/views';

const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

export class ViewsWelcomeContribution extends Disposable implements IWorkbenchContribution {

	private viewWelcomeContents = new Map<ViewWelcome, IDisposable>();

	constructor(extensionPoint: IExtensionPoint<ViewsWelcomeExtensionPoint>) {
		super();

		extensionPoint.setHandler((_, { added, removed }) => {
			for (const contribution of removed) {
				for (const welcome of contribution.value) {
					const disposable = this.viewWelcomeContents.get(welcome);

					if (disposable) {
						disposable.dispose();
					}
				}
			}

			for (const contribution of added) {
				for (const welcome of contribution.value) {
					const id = ViewIdentifierMap[welcome.view] ?? welcome.view;
					const disposable = viewsRegistry.registerViewWelcomeContent(id, {
						content: welcome.contents,
						when: ContextKeyExpr.deserialize(welcome.when),
						priority: contribution.description.isBuiltin ? ViewContentPriority.Low : ViewContentPriority.Lowest
					});

					this.viewWelcomeContents.set(welcome, disposable);
				}
			}
		});
	}
}
