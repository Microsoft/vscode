/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';

export const TEST_DATA_SCHEME = 'vscode-test-data';

export const enum TestUriType {
	ResultMessage,
	ResultActualOutput,
	ResultExpectedOutput,
}

interface IResultTestUri {
	resultId: string;
	taskIndex: number;
	testExtId: string;
}

interface IResultTestMessageReference extends IResultTestUri {
	type: TestUriType.ResultMessage;
	messageIndex: number;
}

interface IResultTestOutputReference extends IResultTestUri {
	type: TestUriType.ResultActualOutput | TestUriType.ResultExpectedOutput;
	messageIndex: number;
}

export type ParsedTestUri =
	| IResultTestMessageReference
	| IResultTestOutputReference;

const enum TestUriParts {
	Results = 'results',

	Messages = 'message',
	Text = 'text',
	ActualOutput = 'actualOutput',
	ExpectedOutput = 'expectedOutput',
}

export const parseTestUri = (uri: URI): ParsedTestUri | undefined => {
	const type = uri.authority;
	const [locationId, ...request] = uri.path.slice(1).split('/');

	if (request[0] === TestUriParts.Messages) {
		const taskIndex = Number(request[1]);
		const index = Number(request[2]);
		const part = request[3];
		const testExtId = uri.query;
		if (type === TestUriParts.Results) {
			switch (part) {
				case TestUriParts.Text:
					return { resultId: locationId, taskIndex, testExtId, messageIndex: index, type: TestUriType.ResultMessage };
				case TestUriParts.ActualOutput:
					return { resultId: locationId, taskIndex, testExtId, messageIndex: index, type: TestUriType.ResultActualOutput };
				case TestUriParts.ExpectedOutput:
					return { resultId: locationId, taskIndex, testExtId, messageIndex: index, type: TestUriType.ResultExpectedOutput };
			}
		}
	}

	return undefined;
};

export const buildTestUri = (parsed: ParsedTestUri): URI => {
	const uriParts = {
		scheme: TEST_DATA_SCHEME,
		authority: TestUriParts.Results
	};
	const msgRef = (locationId: string, ...remaining: (string | number)[]) =>
		URI.from({
			...uriParts,
			query: parsed.testExtId,
			path: ['', locationId, TestUriParts.Messages, ...remaining].join('/'),
		});

	switch (parsed.type) {
		case TestUriType.ResultActualOutput:
			return msgRef(parsed.resultId, parsed.taskIndex, parsed.messageIndex, TestUriParts.ActualOutput);
		case TestUriType.ResultExpectedOutput:
			return msgRef(parsed.resultId, parsed.taskIndex, parsed.messageIndex, TestUriParts.ExpectedOutput);
		case TestUriType.ResultMessage:
			return msgRef(parsed.resultId, parsed.taskIndex, parsed.messageIndex, TestUriParts.Text);
		default:
			throw new Error('Invalid test uri');
	}
};
