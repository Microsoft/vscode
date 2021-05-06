/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { IColorRegistry, Extensions, ColorContribution } from 'vs/platform/theme/common/colorRegistry';
import { asText } from 'vs/platform/request/common/request';
import * as fs from 'fs';
import * as pfs from 'vs/base/node/pfs';
import * as path from 'vs/base/common/path';
import * as assert from 'assert';
import { getPathFromAmdModule } from 'vs/base/test/node/testUtils';
import { CancellationToken } from 'vs/base/common/cancellation';
import { RequestService } from 'vs/platform/request/node/requestService';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import 'vs/workbench/workbench.desktop.main';
import { NullLogService } from 'vs/platform/log/common/log';
import { TestEnvironmentService } from 'vs/workbench/test/electron-browser/workbenchTestServices';

interface ColorInfo {
	description: string;
	offset: number;
	length: number;
}

interface DescriptionDiff {
	docDescription: string;
	specDescription: string;
}

export const experimental: string[] = []; // 'settings.modifiedItemForeground', 'editorUnnecessary.foreground' ];

suite('Color Registry', function () {

	test('all colors documented in theme-color.md', async function () {
		const reqContext = await new RequestService(new TestConfigurationService(), TestEnvironmentService, new NullLogService()).request({ url: 'https://raw.githubusercontent.com/microsoft/vscode-docs/vnext/api/references/theme-color.md' }, CancellationToken.None);
		const content = (await asText(reqContext))!;

		const expression = /\-\s*\`([\w\.]+)\`: (.*)/g;

		let m: RegExpExecArray | null;
		let colorsInDoc: { [id: string]: ColorInfo } = Object.create(null);
		let nColorsInDoc = 0;
		while (m = expression.exec(content)) {
			colorsInDoc[m[1]] = { description: m[2], offset: m.index, length: m.length };
			nColorsInDoc++;
		}
		assert.ok(nColorsInDoc > 0, 'theme-color.md contains to color descriptions');

		let missing = Object.create(null);
		let descriptionDiffs: { [id: string]: DescriptionDiff } = Object.create(null);

		let themingRegistry = Registry.as<IColorRegistry>(Extensions.ColorContribution);
		for (let color of themingRegistry.getColors()) {
			if (!colorsInDoc[color.id]) {
				if (!color.deprecationMessage) {
					missing[color.id] = getDescription(color);
				}
			} else {
				let docDescription = colorsInDoc[color.id].description;
				let specDescription = getDescription(color);
				if (docDescription !== specDescription) {
					descriptionDiffs[color.id] = { docDescription, specDescription };
				}
				delete colorsInDoc[color.id];
			}
		}
		let colorsInExtensions = await getColorsFromExtension();
		for (let colorId in colorsInExtensions) {
			if (!colorsInDoc[colorId]) {
				missing[colorId] = colorsInExtensions[colorId];
			} else {
				delete colorsInDoc[colorId];
			}
		}
		for (let colorId of experimental) {
			if (missing[colorId]) {
				delete missing[colorId];
			}
			if (colorsInDoc[colorId]) {
				assert.fail(`Color ${colorId} found in doc but marked experimental. Please remove from experimental list.`);
			}
		}

		let undocumentedKeys = Object.keys(missing).map(k => `\`${k}\`: ${missing[k]}`);
		assert.deepStrictEqual(undocumentedKeys, [], 'Undocumented colors ids');

		let superfluousKeys = Object.keys(colorsInDoc);
		assert.deepStrictEqual(superfluousKeys, [], 'Colors ids in doc that do not exist');

	});
});

function getDescription(color: ColorContribution) {
	let specDescription = color.description;
	if (color.deprecationMessage) {
		specDescription = specDescription + ' ' + color.deprecationMessage;
	}
	return specDescription;
}

async function getColorsFromExtension(): Promise<{ [id: string]: string }> {
	let extPath = getPathFromAmdModule(require, '../../../../../extensions');
	let extFolders = await pfs.readDirsInDir(extPath);
	let result: { [id: string]: string } = Object.create(null);
	for (let folder of extFolders) {
		try {
			let packageJSON = JSON.parse((await fs.promises.readFile(path.join(extPath, folder, 'package.json'))).toString());
			let contributes = packageJSON['contributes'];
			if (contributes) {
				let colors = contributes['colors'];
				if (colors) {
					for (let color of colors) {
						let colorId = color['id'];
						if (colorId) {
							result[colorId] = colorId['description'];
						}
					}
				}
			}
		} catch (e) {
			// ignore
		}

	}
	return result;
}
