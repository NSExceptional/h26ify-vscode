//
//  cmd-decorators.ts
//  H26ify
//
//  Created by Tanner Bennett on 2024-04-11
//  Copyright © 2024 Tanner Bennett. All rights reserved.
//

import * as vscode from 'vscode';
import { window } from 'vscode';
import { Commands } from '../commands/commands-base';

function isPromise(thing: any): thing is Promise<any> {
    return !!thing.then;
}

type ProgressType = { notification?: string, view?: string };

/** A schema for commands as they are written in `commands.jsonc`, including our own additions */
export type PackageJSONCommandEntry = {
    command: string,
    title: string,
    icon?: string,
    enablement?: string,

    /** A label to display in a progress view for the command */
    progress?: ProgressType,
    /** Whether the command is cancellable--if so, it should accept an additional cancellation token arg */
    cancellable?: boolean,
    /** Whether the command operates on TreeItems and expects 1+ items */
    isMultiSelect?: boolean,
};

export type CommandRegistration = {
    name: string,
    type: new (...args: any[]) => any,
    methodName: string,
    method: (...args: any[]) => any,
    finalInvocation: (...args: any[]) => any,
};

type Ctor<T> = new (...args: any[]) => T;

/** A decorator to use on `Commands` subclass methods to register extension commands */
export function cmd(name: string) {
    const options = Commands.contributedCommands.find(c => c.command === name);
    const exts = vscode.extensions.getExtension('tanner.h26ify');
    return function<C extends Commands>(type: C, propertyKey: string, descriptor: PropertyDescriptor) {
        // Create the singleton instance as needed
        const typeName = type.constructor.name;
        if (!Commands.instanceMap[typeName]) {
            Commands.instanceMap[typeName] = new (type.constructor as Ctor<C>)();
        }
        
        // descriptor.value is the method we are decorating
        const multiSelect = options?.isMultiSelect ?? false;
        const invocation = async (...args: any[]): Promise<any> => {
            const singleton = Commands.instanceMap[typeName];
            await descriptor.value.call(singleton, ...args)
        };

        /** Necessary to allow sending multiple selections to a command */
        function pullArgsFromArgs(args: any[], isMultiSelect: boolean): any[] {
            if (isMultiSelect) {
                if (args[1] && Array.isArray(args[1])) {
                    // This will be an array of selections——we wrap it in an array
                    // so we can use the spread operator to pass it to the command
                    // as an array of selections as the argument
                    return [args[1]];
                }
                else {
                    // This will be a single selection, so we need to wrap it in
                    // an array to make it a list of selections, and then wrap
                    // it it in another array so we can use the spread operator
                    return [[args[0]]];
                }
            }
            else {
                // This will be a single argument
                return args;
            }
        }

        /** Invoke a command with a given progress indicator message */
        async function invokeWithProgress(impl: typeof invocation, args: any[], progress: ProgressType) {
            const location = progress.view ?
                { viewId: progress.view } :
                vscode.ProgressLocation.Notification;
                
            // Begin showing progress
            return await window.withProgress({
                location,
                title: progress.notification,
                cancellable: options?.cancellable ?? false,
            }, async (progress, token) => {
                return await impl(...args, token, progress);
            });
        }

        // The args passed here are passed in by VS Code; we capture them and
        // append them to the call _after_ we pass in `this` (see `invocation` above)
        const finalInvocation = async (...args: any[]) => {
            // Pull out multi selections if necessary
            args = pullArgsFromArgs(args, multiSelect);

            try {
                if (options?.progress) {
                    return await invokeWithProgress(invocation, args, options.progress);
                } else {
                    return await invocation(...args);
                }
            } catch (error: any) {
                if (error && error.message) {
                    if (error.message.length > 500) {
                        type.outputChannel.appendLine(`Error running command ${name}:`);
                        type.outputChannel.append(error.message);
                        type.outputChannel.appendLine('\n\n');
                        type.outputChannel.show();
                        window.showErrorMessage(
                            `An error occurred running command ${name}, see Output for details`
                        );
                    } else {
                        window.showErrorMessage(error.message);
                    }
                }
            }
        };

        const commandMetadata = Commands.contributedCommands.find(c => c.command === name);

        /** Add the command to the registry; Commands.init() will register them */
        Commands.commandMap[name] = {
            name,
            type: type.constructor as any,
            methodName: propertyKey,
            method: descriptor.value,
            finalInvocation,
        };
    };
}
