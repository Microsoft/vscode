/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IQuickPick, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { IQuickPickSeparator, IKeyMods, IQuickPickAcceptEvent } from 'vs/base/parts/quickinput/common/quickInput';
import { IQuickAccessProvider } from 'vs/platform/quickinput/common/quickAccess';
import { IDisposable, DisposableStore, Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { timeout } from 'vs/base/common/async';

export enum TriggerAction {

	/**
	 * Do nothing after the button was clicked.
	 */
	NO_ACTION,

	/**
	 * Close the picker.
	 */
	CLOSE_PICKER,

	/**
	 * Update the results of the picker.
	 */
	REFRESH_PICKER,

	/**
	 * Remove the item from the picker.
	 */
	REMOVE_ITEM
}

export interface IPickerQuickAccessItem extends IQuickPickItem {

	/**
	* A method that will be executed when the pick item is accepted from
	* the picker. The picker will close automatically before running this.
	*
	* @param keyMods the state of modifier keys when the item was accepted.
	* @param event the underlying event that caused the accept to trigger.
	*/
	accept?(keyMods: IKeyMods, event: IQuickPickAcceptEvent): void;

	/**
	 * A method that will be executed when a button of the pick item was
	 * clicked on.
	 *
	 * @param buttonIndex index of the button of the item that
	 * was clicked.
	 *
	 * @param the state of modifier keys when the button was triggered.
	 *
	 * @returns a value that indicates what should happen after the trigger
	 * which can be a `Promise` for long running operations.
	 */
	trigger?(buttonIndex: number, keyMods: IKeyMods): TriggerAction | Promise<TriggerAction>;
}

export interface IPickerQuickAccessProviderOptions<T extends IPickerQuickAccessItem> {

	/**
	 * Enables support for opening picks in the background via gesture.
	 */
	canAcceptInBackground?: boolean;

	/**
	 * Enables to show a pick entry when no results are returned from a search.
	 */
	noResultsPick?: T;
}

export type Pick<T> = T | IQuickPickSeparator;
export type PicksWithActive<T> = { items: ReadonlyArray<Pick<T>>, active?: T };
export type Picks<T> = ReadonlyArray<Pick<T>> | PicksWithActive<T>;
export type FastAndSlowPicks<T> = { picks: Picks<T>, additionalPicks: Promise<Picks<T>> };

function isPicksWithActive<T>(obj: unknown): obj is PicksWithActive<T> {
	const candidate = obj as PicksWithActive<T>;

	return Array.isArray(candidate.items);
}

function isFastAndSlowPicks<T>(obj: unknown): obj is FastAndSlowPicks<T> {
	const candidate = obj as FastAndSlowPicks<T>;

	return !!candidate.picks && candidate.additionalPicks instanceof Promise;
}

export abstract class PickerQuickAccessProvider<T extends IPickerQuickAccessItem> extends Disposable implements IQuickAccessProvider {

	private static FAST_PICKS_RACE_DELAY = 200; // timeout before we accept fast results before slow results are present

	constructor(private prefix: string, protected options?: IPickerQuickAccessProviderOptions<T>) {
		super();
	}

	provide(picker: IQuickPick<T>, token: CancellationToken): IDisposable {
		const disposables = new DisposableStore();

		// Apply options if any
		picker.canAcceptInBackground = !!this.options?.canAcceptInBackground;

		// Disable filtering & sorting, we control the results
		picker.matchOnLabel = picker.matchOnDescription = picker.matchOnDetail = picker.sortByLabel = false;

		// Set initial picks and update on type
		let picksCts: CancellationTokenSource | undefined = undefined;
		const picksDisposable = disposables.add(new MutableDisposable());
		const updatePickerItems = async () => {
			const picksDisposables = picksDisposable.value = new DisposableStore();

			// Cancel any previous ask for picks and busy
			picksCts?.dispose(true);
			picker.busy = false;

			// Create new cancellation source for this run
			picksCts = new CancellationTokenSource(token);

			// Collect picks and support both long running and short or combined
			const picksToken = picksCts.token;
			const picksFilter = picker.value.substr(this.prefix.length).trim();
			const providedPicks = this.getPicks(picksFilter, picksDisposables, picksToken);

			const applyPicks = (picks: Picks<T>, skipEmpty?: boolean): boolean => {
				let items: ReadonlyArray<Pick<T>>;
				let activeItem: T | undefined = undefined;

				if (isPicksWithActive(picks)) {
					items = picks.items;
					activeItem = picks.active;
				} else {
					items = picks;
				}

				if (items.length === 0) {
					if (skipEmpty) {
						return false;
					}

					if (picksFilter.length > 0 && this.options?.noResultsPick) {
						items = [this.options.noResultsPick];
					}
				}

				picker.items = items;
				if (activeItem) {
					picker.activeItems = [activeItem];
				}

				return true;
			};

			// No Picks
			if (providedPicks === null) {
				// Ignore
			}

			// Fast and Slow Picks
			else if (isFastAndSlowPicks(providedPicks)) {
				let fastPicksApplied = false;
				let slowPicksApplied = false;

				await Promise.all([

					// Fast Picks: to reduce amount of flicker, we race against
					// the slow picks over 500ms and then set the fast picks.
					// If the slow picks are faster, we reduce the flicker by
					// only setting the items once.
					(async () => {
						await timeout(PickerQuickAccessProvider.FAST_PICKS_RACE_DELAY);
						if (picksToken.isCancellationRequested) {
							return;
						}

						if (!slowPicksApplied) {
							fastPicksApplied = applyPicks(providedPicks.picks, true /* skip over empty to reduce flicker */);
						}
					})(),

					// Slow Picks: we await the slow picks and then set them at
					// once together with the fast picks, but only if we actually
					// have additional results.
					(async () => {
						picker.busy = true;
						try {
							const awaitedAdditionalPicks = await providedPicks.additionalPicks;
							if (picksToken.isCancellationRequested) {
								return;
							}

							let picks: ReadonlyArray<Pick<T>>;
							let activePick: Pick<T> | undefined = undefined;
							if (isPicksWithActive(providedPicks.picks)) {
								picks = providedPicks.picks.items;
								activePick = providedPicks.picks.active;
							} else {
								picks = providedPicks.picks;
							}

							let additionalPicks: ReadonlyArray<Pick<T>>;
							let additionalActivePick: Pick<T> | undefined = undefined;
							if (isPicksWithActive(awaitedAdditionalPicks)) {
								additionalPicks = awaitedAdditionalPicks.items;
								additionalActivePick = awaitedAdditionalPicks.active;
							} else {
								additionalPicks = awaitedAdditionalPicks;
							}

							if (additionalPicks.length > 0 || !fastPicksApplied) {
								// If we do not have any activePick or additionalActivePick
								// we try to preserve the currently active pick from the
								// fast results. This fixes an issue where the user might
								// have made a pick active before the additional results
								// kick in.
								// See https://github.com/microsoft/vscode/issues/102480
								let fallbackActivePick: Pick<T> | undefined = undefined;
								if (!activePick && !additionalActivePick) {
									const fallbackActivePickCandidate = picker.activeItems[0];
									if (fallbackActivePickCandidate && picks.indexOf(fallbackActivePickCandidate) !== -1) {
										fallbackActivePick = fallbackActivePickCandidate;
									}
								}

								applyPicks({
									items: [...picks, ...additionalPicks],
									active: activePick || additionalActivePick || fallbackActivePick
								});
							}
						} finally {
							if (!picksToken.isCancellationRequested) {
								picker.busy = false;
							}

							slowPicksApplied = true;
						}
					})()
				]);
			}

			// Fast Picks
			else if (!(providedPicks instanceof Promise)) {
				applyPicks(providedPicks);
			}

			// Slow Picks
			else {
				picker.busy = true;
				try {
					const awaitedPicks = await providedPicks;
					if (picksToken.isCancellationRequested) {
						return;
					}

					applyPicks(awaitedPicks);
				} finally {
					if (!picksToken.isCancellationRequested) {
						picker.busy = false;
					}
				}
			}
		};
		disposables.add(picker.onDidChangeValue(() => updatePickerItems()));
		updatePickerItems();

		// Accept the pick on accept and hide picker
		disposables.add(picker.onDidAccept(event => {
			const [item] = picker.selectedItems;
			if (typeof item?.accept === 'function') {
				if (!event.inBackground) {
					picker.hide(); // hide picker unless we accept in background
				}

				item.accept(picker.keyMods, event);
			}
		}));

		// Trigger the pick with button index if button triggered
		disposables.add(picker.onDidTriggerItemButton(async ({ button, item }) => {
			if (typeof item.trigger === 'function') {
				const buttonIndex = item.buttons?.indexOf(button) ?? -1;
				if (buttonIndex >= 0) {
					const result = item.trigger(buttonIndex, picker.keyMods);
					const action = (typeof result === 'number') ? result : await result;

					if (token.isCancellationRequested) {
						return;
					}

					switch (action) {
						case TriggerAction.NO_ACTION:
							break;
						case TriggerAction.CLOSE_PICKER:
							picker.hide();
							break;
						case TriggerAction.REFRESH_PICKER:
							updatePickerItems();
							break;
						case TriggerAction.REMOVE_ITEM:
							const index = picker.items.indexOf(item);
							if (index !== -1) {
								const items = picker.items.slice();
								items.splice(index, 1);
								picker.items = items;
							}
							break;
					}
				}
			}
		}));

		return disposables;
	}

	/**
	 * Returns an array of picks and separators as needed. If the picks are resolved
	 * long running, the provided cancellation token should be used to cancel the
	 * operation when the token signals this.
	 *
	 * The implementor is responsible for filtering and sorting the picks given the
	 * provided `filter`.
	 *
	 * @param filter a filter to apply to the picks.
	 * @param disposables can be used to register disposables that should be cleaned
	 * up when the picker closes.
	 * @param token for long running tasks, implementors need to check on cancellation
	 * through this token.
	 * @returns the picks either directly, as promise or combined fast and slow results.
	 * Pickers can return `null` to signal that no change in picks is needed.
	 */
	protected abstract getPicks(filter: string, disposables: DisposableStore, token: CancellationToken): Picks<T> | Promise<Picks<T>> | FastAndSlowPicks<T> | null;
}
