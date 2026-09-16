//
//  commands-base.ts
//  tinder-studio
//
//  Created by Tanner Bennett on 2022-09-14
//

import { CancellationToken, commands, ExtensionContext, Progress, QuickPickItem, Uri, window, workspace } from 'vscode';
import * as vscode from 'vscode';
import { cmd, CommandRegistration, PackageJSONCommandEntry } from '../decorators/cmd-decorators';

/**
 * Base class for all commands in the extension.
 *
 * To add commands to the extension:
 * 1. Subclass this class
 * 2. Add methods annotated with `@cmd`
 * 3. Add the class name to `kCommandTypes` in `extension.ts`
 *
 * Commands defined in the base class are callable by subclasses.
 */
export class Commands {
    /** `Commands` subclasses annoted with `@Command` are added here
     * so that the extension can .init them all as the extension activates.
     */
    static commandsRegistry: Commands[] = [];
    /** The output channel for this extension. See `cmd-decorators.ts`. */
    static outputChannel: vscode.OutputChannel = window.createOutputChannel('TinderStudio');
    /** A map of command IDs to their invocations, populated by `cmd-decorators.ts`. */
    static commandMap: { [command: string]: CommandRegistration } = {};
    /** A map of command class names to their singleton instances, populated in `cmd-decorators.ts`. */
    static instanceMap: { [typeName: string]: Commands } = {};
    /** `contributes.commands` pulled from the extension's package.json */
    static contributedCommands: PackageJSONCommandEntry[] =
        vscode.extensions.getExtension('tanner.h26ify')?.packageJSON.contributes.commands ?? [];
    /** The extension context, set by `init()` */
    static context: ExtensionContext;

    /** Errors and other output are written to this extension's output channel */
    public get outputChannel() {
        return Commands.outputChannel;
    }
    /** The source of all video files for commands to use */
    // protected get dataSource(): ? {
    //     return ?.shared;
    // }

    /** Called in extension.ts to register all commands; do not use */
    public static init(context: ExtensionContext) {
        Commands.context = context;
        for (const [cmd, reg] of Object.entries(this.commandMap)) {
            context.subscriptions.push(commands.registerCommand(cmd, reg.finalInvocation));
        }
    }

    /** Run a closure with a progress notification */
    protected withProgress<T>(
        label: string,
        callback: (
            progress: Progress<{ message?: string; increment?: number }>,
            token: CancellationToken
        ) => Promise<T>,
        cancellable?: boolean,
    ): Thenable<T> {
        return window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: label,
            cancellable,
        }, callback);
    }

    @cmd('h26ify.debugging')
    async debugging() {
        // Show an input box
        const name = await window.showInputBox({
            prompt: 'Foo',
            placeHolder: 'bar',
        });
    }
}
