/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');

const root = path.dirname(path.dirname(path.dirname(__dirname)));
const driverPath = path.join(root, 'src/vs/platform/driver/common/driver.ts');

let contents = fs.readFileSync(driverPath, 'utf8');
contents = /\/\/\*START([\s\S]*)\/\/\*END/mi.exec(contents)[1].trim();
contents = contents.replace(/\bTPromise\b/g, 'Promise');

contents = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Thenable is a common denominator between ES6 promises, Q, jquery.Deferred, WinJS.Promise,
 * and others. This API makes no assumption about what promise library is being used which
 * enables reusing existing code without migrating to a specific promise implementation. Still,
 * we recommend the use of native promises which are available in this editor.
 */
interface Thenable<T> {
	/**
	* Attaches callbacks for the resolution and/or rejection of the Promise.
	* @param onfulfilled The callback to execute when the Promise is resolved.
	* @param onrejected The callback to execute when the Promise is rejected.
	* @returns A Promise for the completion of which ever callback is executed.
	*/
	then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>;
	then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>;
}

${contents}

export interface IDisposable {
	dispose(): void;
}

export function connect(outPath: string, handle: string): Promise<{ client: IDisposable, driver: IDriver }>;
`;

const srcPath = path.join(path.dirname(__dirname), 'src');
const outPath = path.join(path.dirname(__dirname), 'out');

fs.writeFileSync(path.join(srcPath, 'driver.d.ts'), contents);
fs.writeFileSync(path.join(outPath, 'driver.d.ts'), contents);
