/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Define Url global for both browser and node runtimes
//
// Copied from https://github.com/DefinitelyTyped/DefinitelyTyped/issues/34960

declare const URL: typeof import('url').URL;
