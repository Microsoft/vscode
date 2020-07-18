/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { Extensions as Input, IEditorInputFactory, IEditorInputFactoryRegistry } from 'vs/workbench/common/editor';
import { PerfviewContrib, PerfviewInput } from 'vs/workbench/contrib/performance/browser/perfviewEditor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

// -- startup performance view

Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench).registerWorkbenchContribution(
	PerfviewContrib,
	LifecyclePhase.Ready
);

Registry.as<IEditorInputFactoryRegistry>(Input.EditorInputFactories).registerEditorInputFactory(
	PerfviewInput.Id,
	class implements IEditorInputFactory {
		canSerialize(): boolean {
			return true;
		}
		serialize(): string {
			return '';
		}
		deserialize(instantiationService: IInstantiationService): PerfviewInput {
			return instantiationService.createInstance(PerfviewInput);
		}
	}
);


registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'perfview.show',
			title: { value: localize('show.label', "Startup Performance"), original: 'Startup Performance' },
			category: { value: localize({ key: 'show.cat', comment: ['A developer on Code itself or someone diagnosing issues in Code'] }, "Developer"), original: 'Developer' },
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const instaService = accessor.get(IInstantiationService);
		return editorService.openEditor(instaService.createInstance(PerfviewInput));
	}
});
