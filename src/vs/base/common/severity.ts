/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';

enum Severity {
	Ignore = 0,
	Info = 1,
	Warning = 2,
	Error = 3
}

namespace Severity {

	const _error = 'error';
	const _warning = 'warning';
	const _warn = 'warn';
	const _info = 'info';

	/**
	 * Parses 'error', 'warning', 'warn', 'info' in call casings
	 * and falls back to ignore.
	 */
	export function fromValue(value: string): Severity {
		if (!value) {
			return Severity.Ignore;
		}

		if (strings.equalsIgnoreCase(_error, value)) {
			return Severity.Error;
		}

		if (strings.equalsIgnoreCase(_warning, value) || strings.equalsIgnoreCase(_warn, value)) {
			return Severity.Warning;
		}

		if (strings.equalsIgnoreCase(_info, value)) {
			return Severity.Info;
		}
		return Severity.Ignore;
	}
}

export default Severity;
