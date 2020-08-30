/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module '@emmetio/math-expression' {
	import { BufferStream } from 'EmmetNode';

	function index(stream: BufferStream, backward: boolean): number;

	export default index;
}

