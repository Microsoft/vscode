/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { pad } from './strings';
import { localize } from 'vs/nls';

const minute = 60;
const hour = minute * 60;
const day = hour * 24;
const week = day * 7;
const month = day * 30;
const year = day * 365;

export function fromNow(date: number | Date, appendAgoLabel?: boolean): string {
	if (typeof date !== 'number') {
		date = date.getTime();
	}

	const seconds = Math.round((new Date().getTime() - date) / 1000);
	if (seconds < -30) {
		return localize('date.fromNow.in', 'in {0}', fromNow(new Date().getTime() + seconds * 1000, false));
	}

	if (seconds < 30) {
		return localize('date.fromNow.now', 'now');
	}

	let value: number;
	if (seconds < minute) {
		value = seconds;

		if (appendAgoLabel) {
			return value === 1
				? localize('date.fromNow.seconds.singular.ago', '{0} sec ago', value)
				: localize('date.fromNow.seconds.plural.ago', '{0} secs ago', value);
		} else {
			return value === 1
				? localize('date.fromNow.seconds.singular', '{0} sec', value)
				: localize('date.fromNow.seconds.plural', '{0} secs', value);
		}
	}

	if (seconds < hour) {
		value = Math.floor(seconds / minute);
		if (appendAgoLabel) {
			return value === 1
				? localize('date.fromNow.minutes.singular.ago', '{0} min ago', value)
				: localize('date.fromNow.minutes.plural.ago', '{0} mins ago', value);
		} else {
			return value === 1
				? localize('date.fromNow.minutes.singular', '{0} min', value)
				: localize('date.fromNow.minutes.plural', '{0} mins', value);
		}
	}

	if (seconds < day) {
		value = Math.floor(seconds / hour);
		if (appendAgoLabel) {
			return value === 1
				? localize('date.fromNow.hours.singular.ago', '{0} hr ago', value)
				: localize('date.fromNow.hours.plural.ago', '{0} hrs ago', value);
		} else {
			return value === 1
				? localize('date.fromNow.hours.singular', '{0} hr', value)
				: localize('date.fromNow.hours.plural', '{0} hrs', value);
		}
	}

	if (seconds < week) {
		value = Math.floor(seconds / day);
		if (appendAgoLabel) {
			return value === 1
				? localize('date.fromNow.days.singular.ago', '{0} day ago', value)
				: localize('date.fromNow.days.plural.ago', '{0} days ago', value);
		} else {
			return value === 1
				? localize('date.fromNow.days.singular', '{0} day', value)
				: localize('date.fromNow.days.plural', '{0} days', value);
		}
	}

	if (seconds < month) {
		value = Math.floor(seconds / week);
		if (appendAgoLabel) {
			return value === 1
				? localize('date.fromNow.weeks.singular.ago', '{0} wk ago', value)
				: localize('date.fromNow.weeks.plural.ago', '{0} wks ago', value);
		} else {
			return value === 1
				? localize('date.fromNow.weeks.singular', '{0} wk', value)
				: localize('date.fromNow.weeks.plural', '{0} wks', value);
		}
	}

	if (seconds < year) {
		value = Math.floor(seconds / month);
		if (appendAgoLabel) {
			return value === 1
				? localize('date.fromNow.months.singular.ago', '{0} mo ago', value)
				: localize('date.fromNow.months.plural.ago', '{0} mos ago', value);
		} else {
			return value === 1
				? localize('date.fromNow.months.singular', '{0} mo', value)
				: localize('date.fromNow.months.plural', '{0} mos', value);
		}
	}

	value = Math.floor(seconds / year);
	if (appendAgoLabel) {
		return value === 1
			? localize('date.fromNow.years.singular.ago', '{0} yr ago', value)
			: localize('date.fromNow.years.plural.ago', '{0} yrs ago', value);
	} else {
		return value === 1
			? localize('date.fromNow.years.singular', '{0} yr', value)
			: localize('date.fromNow.years.plural', '{0} yrs', value);
	}
}

export function toLocalISOString(date: Date): string {
	return date.getFullYear() +
		'-' + pad(date.getMonth() + 1, 2) +
		'-' + pad(date.getDate(), 2) +
		'T' + pad(date.getHours(), 2) +
		':' + pad(date.getMinutes(), 2) +
		':' + pad(date.getSeconds(), 2) +
		'.' + (date.getMilliseconds() / 1000).toFixed(3).slice(2, 5) +
		'Z';
}
