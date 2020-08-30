/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { BackupRestorer } from 'vs/workbench/contrib/backup/common/backupRestorer';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';

// Register Backup Restorer
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(BackupRestorer, LifecyclePhase.Starting);
