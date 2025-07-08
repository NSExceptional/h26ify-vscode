//
//  extension.ts
//  tinder-studio
//
//  Created by Tanner Bennett on 2022-09-14
//

'use strict';
import * as vscode from 'vscode';
import { window } from 'vscode';
import { Commands } from './commands/commands-base';
import BaseListProvider from './views/base-provider';
import { ExampleCommands } from './commands/example-commands';

const kCommandTypes: (new (...args: any[]) => any)[] = [
    Commands,
    ExampleCommands,
];

function registerViews(context: vscode.ExtensionContext) {
    const treeViews: [viewID: string, treeDataProvider: BaseListProvider<any>][] = [
        // TODO
    ];

    // Create tree views with multi-selection enabled
    for (const [viewID, treeDataProvider] of treeViews) {
        const treeView = window.createTreeView(viewID, {
            treeDataProvider,
            canSelectMany: true,
        });

        treeDataProvider.treeView = treeView;
        context.subscriptions.push(treeView);
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Register commands
    Commands.init(context);
    for (const ctor of kCommandTypes) {
        const cmd: Commands = new ctor();
        Commands.commandsRegistry.push(cmd);
    }

    // Initialize stuff
    // ...
    registerViews(context);
}

export function deactivate(context: vscode.ExtensionContext) {
}
