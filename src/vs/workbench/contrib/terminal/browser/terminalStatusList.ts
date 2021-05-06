/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import Severity from 'vs/base/common/severity';
import { listErrorForeground, listWarningForeground } from 'vs/platform/theme/common/colorRegistry';
import { IHoverAction } from 'vs/workbench/services/hover/browser/hover';

/**
 * The set of _internal_ terminal statuses, other components building on the terminal should put
 * their statuses within their component.
 */
export const enum TerminalStatus {
	Bell = 'bell',
	Disconnected = 'disconnected',
	RelaunchNeeded = 'relaunch-needed',
}

export interface ITerminalStatus {
	/** An internal string ID used to identify the status. */
	id: string;
	/**
	 * The severity of the status, this defines both the color and how likely the status is to be
	 * the "primary status".
	 */
	severity: Severity;
	/**
	 * An icon representing the status, if this is not specified it will not show up on the terminal
	 * tab and will use the generic `info` icon when hovering.
	 */
	icon?: Codicon;
	/**
	 * What to show for this status in the terminal's hover.
	 */
	tooltip?: string | undefined;
	/**
	 * Actions to expose on hover.
	 */
	hoverActions?: IHoverAction[];
}

export interface ITerminalStatusList {
	/** Gets the most recent, highest severity status. */
	readonly primary: ITerminalStatus | undefined;
	/** Gets all active statues. */
	readonly statuses: ITerminalStatus[];

	readonly onDidAddStatus: Event<ITerminalStatus>;
	readonly onDidRemoveStatus: Event<ITerminalStatus>;
	readonly onDidChangePrimaryStatus: Event<ITerminalStatus | undefined>;

	/**
	 * Adds a status to the list.
	 * @param duration An optional duration in milliseconds of the status, when specified the status
	 * will remove itself when the duration elapses unless the status gets re-added.
	 */
	add(status: ITerminalStatus, duration?: number): void;
	remove(status: ITerminalStatus): void;
	remove(statusId: string): void;
	toggle(status: ITerminalStatus, value: boolean): void;
}

export class TerminalStatusList extends Disposable implements ITerminalStatusList {
	private readonly _statuses: Map<string, ITerminalStatus> = new Map();
	private readonly _statusTimeouts: Map<string, number> = new Map();

	private readonly _onDidAddStatus = this._register(new Emitter<ITerminalStatus>());
	get onDidAddStatus(): Event<ITerminalStatus> { return this._onDidAddStatus.event; }
	private readonly _onDidRemoveStatus = this._register(new Emitter<ITerminalStatus>());
	get onDidRemoveStatus(): Event<ITerminalStatus> { return this._onDidRemoveStatus.event; }
	private readonly _onDidChangePrimaryStatus = this._register(new Emitter<ITerminalStatus | undefined>());
	get onDidChangePrimaryStatus(): Event<ITerminalStatus | undefined> { return this._onDidChangePrimaryStatus.event; }

	get primary(): ITerminalStatus | undefined {
		let result: ITerminalStatus | undefined;
		for (const s of this._statuses.values()) {
			if (!result || s.severity >= result.severity) {
				result = s;
			}
		}
		return result;
	}

	get statuses(): ITerminalStatus[] { return Array.from(this._statuses.values()); }

	add(status: ITerminalStatus, duration?: number) {
		const outTimeout = this._statusTimeouts.get(status.id);
		if (outTimeout) {
			window.clearTimeout(outTimeout);
			this._statusTimeouts.delete(status.id);
		}
		if (duration && duration > 0) {
			const timeout = window.setTimeout(() => this.remove(status), duration);
			this._statusTimeouts.set(status.id, timeout);
		}
		if (!this._statuses.has(status.id)) {
			const oldPrimary = this.primary;
			this._statuses.set(status.id, status);
			this._onDidAddStatus.fire(status);
			const newPrimary = this.primary;
			if (oldPrimary !== newPrimary) {
				this._onDidChangePrimaryStatus.fire(newPrimary);
			}
		}
	}

	remove(status: ITerminalStatus): void;
	remove(statusId: string): void;
	remove(statusOrId: ITerminalStatus | string): void {
		const status = typeof statusOrId === 'string' ? this._statuses.get(statusOrId) : statusOrId;
		// Verify the status is the same as the one passed in
		if (status && this._statuses.get(status.id)) {
			const wasPrimary = this.primary?.id === status.id;
			this._statuses.delete(status.id);
			this._onDidRemoveStatus.fire(status);
			if (wasPrimary) {
				this._onDidChangePrimaryStatus.fire(this.primary);
			}
		}
	}

	toggle(status: ITerminalStatus, value: boolean) {
		if (value) {
			this.add(status);
		} else {
			this.remove(status);
		}
	}
}

export function getColorForSeverity(severity: Severity): string {
	switch (severity) {
		case Severity.Error:
			return listErrorForeground;
		case Severity.Warning:
			return listWarningForeground;
		default:
			return '';
	}
}
