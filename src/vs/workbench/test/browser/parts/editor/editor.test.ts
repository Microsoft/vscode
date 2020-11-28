/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorResourceAccessor, SideBySideEditor, IEditorInputWithPreferredResource } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { URI } from 'vs/base/common/uri';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { workbenchInstantiationService, TestServiceAccessor, TestEditorInput } from 'vs/workbench/test/browser/workbenchTestServices';
import { Schemas } from 'vs/base/common/network';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';

export class TestEditorInputWithPreferredResource extends TestEditorInput implements IEditorInputWithPreferredResource {

	constructor(resource: URI, public preferredResource: URI, typeId: string) {
		super(resource, typeId);
	}
}

suite('Workbench editor', () => {

	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);
	});

	teardown(() => {
		accessor.untitledTextEditorService.dispose();
	});

	test('EditorResourceAccessor', () => {
		const service = accessor.untitledTextEditorService;

		assert.ok(!EditorResourceAccessor.getCanonicalUri(null!));
		assert.ok(!EditorResourceAccessor.getOriginalUri(null!));

		const untitled = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		assert.equal(EditorResourceAccessor.getCanonicalUri(untitled)!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(untitled, { supportSideBySide: SideBySideEditor.PRIMARY })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(untitled, { supportSideBySide: SideBySideEditor.SECONDARY })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(untitled, { supportSideBySide: SideBySideEditor.BOTH })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(untitled, { filterByScheme: Schemas.untitled })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(untitled, { filterByScheme: [Schemas.file, Schemas.untitled] })!.toString(), untitled.resource.toString());
		assert.ok(!EditorResourceAccessor.getCanonicalUri(untitled, { filterByScheme: Schemas.file }));

		assert.equal(EditorResourceAccessor.getOriginalUri(untitled)!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(untitled, { supportSideBySide: SideBySideEditor.PRIMARY })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(untitled, { supportSideBySide: SideBySideEditor.SECONDARY })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(untitled, { supportSideBySide: SideBySideEditor.BOTH })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(untitled, { filterByScheme: Schemas.untitled })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(untitled, { filterByScheme: [Schemas.file, Schemas.untitled] })!.toString(), untitled.resource.toString());
		assert.ok(!EditorResourceAccessor.getOriginalUri(untitled, { filterByScheme: Schemas.file }));

		const file = new TestEditorInput(URI.file('/some/path.txt'), 'editorResourceFileTest');

		assert.equal(EditorResourceAccessor.getCanonicalUri(file)!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(file, { supportSideBySide: SideBySideEditor.PRIMARY })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(file, { supportSideBySide: SideBySideEditor.SECONDARY })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(file, { supportSideBySide: SideBySideEditor.BOTH })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(file, { filterByScheme: Schemas.file })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(file, { filterByScheme: [Schemas.file, Schemas.untitled] })!.toString(), file.resource.toString());
		assert.ok(!EditorResourceAccessor.getCanonicalUri(file, { filterByScheme: Schemas.untitled }));

		assert.equal(EditorResourceAccessor.getOriginalUri(file)!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(file, { supportSideBySide: SideBySideEditor.PRIMARY })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(file, { supportSideBySide: SideBySideEditor.SECONDARY })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(file, { supportSideBySide: SideBySideEditor.BOTH })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(file, { filterByScheme: Schemas.file })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(file, { filterByScheme: [Schemas.file, Schemas.untitled] })!.toString(), file.resource.toString());
		assert.ok(!EditorResourceAccessor.getOriginalUri(file, { filterByScheme: Schemas.untitled }));

		const diffEditorInput = instantiationService.createInstance(DiffEditorInput, 'name', 'description', untitled, file, undefined);

		assert.ok(!EditorResourceAccessor.getCanonicalUri(diffEditorInput));
		assert.ok(!EditorResourceAccessor.getCanonicalUri(diffEditorInput, { filterByScheme: Schemas.file }));

		assert.equal(EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.PRIMARY })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.PRIMARY, filterByScheme: Schemas.file })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.PRIMARY, filterByScheme: [Schemas.file, Schemas.untitled] })!.toString(), file.resource.toString());

		assert.equal(EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.SECONDARY })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.SECONDARY, filterByScheme: Schemas.untitled })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.SECONDARY, filterByScheme: [Schemas.file, Schemas.untitled] })!.toString(), untitled.resource.toString());

		assert.equal((EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH }) as { primary: URI, secondary: URI }).primary.toString(), file.resource.toString());
		assert.equal((EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH, filterByScheme: Schemas.file }) as { primary: URI, secondary: URI }).primary.toString(), file.resource.toString());
		assert.equal((EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH, filterByScheme: [Schemas.file, Schemas.untitled] }) as { primary: URI, secondary: URI }).primary.toString(), file.resource.toString());

		assert.equal((EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH }) as { primary: URI, secondary: URI }).secondary.toString(), untitled.resource.toString());
		assert.equal((EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH, filterByScheme: Schemas.untitled }) as { primary: URI, secondary: URI }).secondary.toString(), untitled.resource.toString());
		assert.equal((EditorResourceAccessor.getCanonicalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH, filterByScheme: [Schemas.file, Schemas.untitled] }) as { primary: URI, secondary: URI }).secondary.toString(), untitled.resource.toString());

		assert.ok(!EditorResourceAccessor.getOriginalUri(diffEditorInput));
		assert.ok(!EditorResourceAccessor.getOriginalUri(diffEditorInput, { filterByScheme: Schemas.file }));

		assert.equal(EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.PRIMARY })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.PRIMARY, filterByScheme: Schemas.file })!.toString(), file.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.PRIMARY, filterByScheme: [Schemas.file, Schemas.untitled] })!.toString(), file.resource.toString());

		assert.equal(EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.SECONDARY })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.SECONDARY, filterByScheme: Schemas.untitled })!.toString(), untitled.resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.SECONDARY, filterByScheme: [Schemas.file, Schemas.untitled] })!.toString(), untitled.resource.toString());

		assert.equal((EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH }) as { primary: URI, secondary: URI }).primary.toString(), file.resource.toString());
		assert.equal((EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH, filterByScheme: Schemas.file }) as { primary: URI, secondary: URI }).primary.toString(), file.resource.toString());
		assert.equal((EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH, filterByScheme: [Schemas.file, Schemas.untitled] }) as { primary: URI, secondary: URI }).primary.toString(), file.resource.toString());

		assert.equal((EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH }) as { primary: URI, secondary: URI }).secondary.toString(), untitled.resource.toString());
		assert.equal((EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH, filterByScheme: Schemas.untitled }) as { primary: URI, secondary: URI }).secondary.toString(), untitled.resource.toString());
		assert.equal((EditorResourceAccessor.getOriginalUri(diffEditorInput, { supportSideBySide: SideBySideEditor.BOTH, filterByScheme: [Schemas.file, Schemas.untitled] }) as { primary: URI, secondary: URI }).secondary.toString(), untitled.resource.toString());


		const resource = URI.file('/some/path.txt');
		const preferredResource = URI.file('/some/PATH.txt');
		const fileWithPreferredResource = new TestEditorInputWithPreferredResource(URI.file('/some/path.txt'), URI.file('/some/PATH.txt'), 'editorResourceFileTest');

		assert.equal(EditorResourceAccessor.getCanonicalUri(fileWithPreferredResource)?.toString(), resource.toString());
		assert.equal(EditorResourceAccessor.getOriginalUri(fileWithPreferredResource)?.toString(), preferredResource.toString());
	});
});
