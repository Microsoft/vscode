/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalInstanceService } from 'vs/workbench/contrib/terminal/electron-browser/terminalInstanceService';
import { getSystemShell } from 'vs/workbench/contrib/terminal/node/terminal';
import { TerminalNativeContribution } from 'vs/workbench/contrib/terminal/electron-browser/terminalNativeContribution';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { getTerminalShellConfiguration } from 'vs/workbench/contrib/terminal/common/terminalConfiguration';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';

// This file contains additional desktop-only contributions on top of those in browser/

// Register services
registerSingleton(ITerminalInstanceService, TerminalInstanceService, true);

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(TerminalNativeContribution, LifecyclePhase.Ready);

// Register configurations
const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration(getTerminalShellConfiguration(getSystemShell));
