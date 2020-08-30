/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module '@emmetio/css-parser' {
	import { BufferStream, Stylesheet } from 'EmmetNode';

	function parseStylesheet(stream: BufferStream): Stylesheet;

	export default parseStylesheet;
}

