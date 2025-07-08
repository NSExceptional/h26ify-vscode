//
//  environment-cmd.ts
//  H26ify
//
//  Created by Tanner Bennett on 2024-04-08
//  Copyright © 2024 Tanner Bennett. All rights reserved.
//

import { ChildProcess, exec, spawn, SpawnOptions, SpawnOptionsWithoutStdio } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as sudo from 'sudo-prompt';
import * as vscode from 'vscode';
import { ShellExecution, ShellQuotedString, Task, TaskScope, WorkspaceFolder } from 'vscode';
import TinderWorkspace from '../tinder-workspace';
import { SIGINT } from 'constants';
import { Commands } from '../commands/commands-base';
import config from '../config';

export type CommandLineArgs = Array<ShellQuotedString | string>;

type PromsieCallback<T> = {
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: any) => void,
};

export interface TaskCommandRunnerOptions {
    // taskName: string;
    workspaceFolder?: WorkspaceFolder;
    cwd?: string;
    alwaysRunNew?: boolean;
    isBackground?: boolean;
    rejectOnError?: boolean;
    focus?: boolean;
    reveal?: vscode.TaskRevealKind;
    /**
     * Environment is not needed and should not be used, because
     * VSCode adds it already (due to using `ExtensionContext.environmentVariableCollection`)
     */
    env?: never;
}

/** A class to help wrap CLI tools that we commonly use when working on Tinder */
export abstract class EnvironmentCmd {
    /** The display name of the program */
    protected abstract readonly commandName: string;
    /** A path to an executable */
    protected abstract readonly expectedBinaryPath: {
        relativeToHome?: string,
        relativeToWorkspace?: string,
        absolute?: string,
        inPATH?: string,
    };

    protected get taskRunnerOptions(): TaskCommandRunnerOptions {
        return {
            workspaceFolder: this.workspace,
            // taskName: this.commandName,
            alwaysRunNew: true,
            rejectOnError: true,
            focus: false,
            reveal: config.showTerminal.other,
        };
    }

    /** @returns the fully qualified expected binary path, even if it does not exist */
    protected unsafeBinaryPath(): string | undefined {
        if (this.expectedBinaryPath.absolute) {
            return this.expectedBinaryPath.absolute;
        }
        else if (this.expectedBinaryPath.inPATH) {
            return this.expectedBinaryPath.inPATH;
        }
        else if (this.expectedBinaryPath.relativeToHome) {
            return path.join(os.homedir(), this.expectedBinaryPath.relativeToHome);
        }
        else if (this.expectedBinaryPath.relativeToWorkspace) {
            this.guardHasWorkspaceRoot();
            return path.join(this.workspaceRoot!, this.expectedBinaryPath.relativeToWorkspace);
        }

        return undefined;
    }

    /** The path resolved from `expectedBinaryPath`; undefined if it does not exist */
    private binaryPath: string | undefined = undefined;
    private workspace: WorkspaceFolder | undefined = undefined;

    protected get workspaceRoot(): string | undefined {
        return this.workspace?.uri.fsPath;
    }

    /** Asserts that the binary exists in the specified location */
    private guardBinaryExists() {
        if (this.binaryPath) return;

        this.binaryPath = this.unsafeBinaryPath();
        if (!this.binaryPath) {
            throw new Error('No binary path specified');
        }

        if (!this.expectedBinaryPath.inPATH && !fs.existsSync(this.binaryPath)) {
            throw new Error(`${this.commandName} binary not found at ${this.binaryPath}`);
        }
    }

    /** Asserts that we have exactly 1 workspace folder open */
    private guardHasWorkspaceRoot() {
        if (this.workspaceRoot) return;
        this.workspace = TinderWorkspace.workspaceFolderOrThrows();
    }

    private _cancellationToken: vscode.CancellationToken | undefined = undefined;

    /** Add a single cancellation handler for the current execution, if cancellable */
    private onCancel(handler: () => void) {
        this._cancellationToken?.onCancellationRequested(handler);
        // Discard the token so it is not accidentally reused on a new invocation
        this._cancellationToken = undefined;
    }

    /**
     * A token used to cancel the current command. Set this property before
     * running a command to allow it to be cancelled.
     */
    set oneTimeCancellationToken(token: vscode.CancellationToken) {
        this._cancellationToken = token;
    }

    /**
     * Executes the given command (program with args) with `exec`
     *
     * @param rawCommand The command to execute, such as `tinder app open Tinder`
     * @param promise A promise that takes the output of the command upon completion
     */
    private execInWorkspace(rawCommand: string, promise: PromsieCallback<string>): ChildProcess {
        const options = { cwd: this.workspaceRoot };
        return exec(rawCommand, options, (error, stdout, stderr) => {
            if (error) {
                // Used to truncate; for now, we send long errors to the output channel
                // if (error.message.length > 1000) {
                //     // Truncate the error message, showing the first and last 500 characters,
                //     // since the notification window won't show much more than this anyway
                //     const msg = error.message;
                //     const first = msg.substring(0, 500);
                //     const last = msg.substring(msg.length - 500);
                //     error.message = `${first} ... [truncated] ... ${last}`;
                // }
                promise.reject(error);
            } else {
                promise.resolve(stdout);
            }
        });
    }

    /**
     * Executes the given command (program with args) with `spawn` in detached mode
     *
     * @param rawCommand The command to execute, such as `tinder app open Tinder`
     * @param promise A promise that takes the output of the command upon completion
     */
    private spawnDetachedInWorkspace(rawCommand: string, promise: PromsieCallback<string>): ChildProcess {
        const options: SpawnOptions = {
            // Self-explanatory
            cwd: this.workspaceRoot,
            // Spawn detached from the current process group so that
            // the new process's PID acts as the process group ID,
            // which can be used to terminate all new child processes
            detached: true,
            // Enables passing all args as a single string
            shell: true,
            // Inherit env
            env: process.env,
        };

        // Spawn new detachced shell process
        const spawnCmd = `bash -l -c "${rawCommand.replace(/"/g, '\\"')}"`;
        const subprocess = spawn(spawnCmd, options);
        subprocess.unref();

        let stdoutData = '';
        let stderrData = '';

        // Collect stdout data
        subprocess.stdout?.on('data', (data) => {
            stdoutData += data.toString();
        });

        // Collect stderr data
        subprocess.stderr?.on('data', (data) => {
            stderrData += data.toString();
        });

        // Handle errors
        subprocess.on('error', error => {
            promise.reject(error);
        });

        subprocess.on('spawn', () => {
            console.log(`Spawned process ${subprocess.pid}`);
        });

        // Resolve or reject upon completion
        subprocess.on('close', (code, signal) => {
            if (code === 0) { // Process exited successfully
                promise.resolve(stdoutData.trim());
            } else if (signal === 'SIGINT' || code === 255) { // Process was killed by a signal (usually user cancelled)
                console.log('Process killed by signal');
                promise.resolve('');
            } else { // Process exited with an unknown error code
                promise.reject(new Error(`Process exited with code: ${code}\n${stderrData}`));
            }
        });

        return subprocess;
    }

    /**
     * Runs the given command in a terminal or in the background.
     * Set `oneTimeCancellationToken` before running the command to make it cancellable.
     *
     * Always resolves to an empty string when run in a terminal.
     *
     * @param command The arguments to pass to the program (such as `app open Tinder`)
     * @param runAsTaskBehavior When passed, the command is run as a task with the given reveal behavior
     * @returns The output of the command if run in a terminal, or an empty string otherwise
     */
    async runCommand(command: string, runAsTaskBehavior?: vscode.TaskRevealKind): Promise<string> {
        this.guardBinaryExists();
        this.guardHasWorkspaceRoot();

        const fullCommand = `${this.binaryPath} ${command}`;

        if (runAsTaskBehavior) {
            const options = this.taskRunnerOptions;
            options.reveal = runAsTaskBehavior;
            return await this.executeAsTask(options, fullCommand);
        }

        return await new Promise(async (resolve, reject) => {
            // Start the command as a detached process
            const subprocess = this.spawnDetachedInWorkspace(
                fullCommand, { resolve, reject }
            );

            if (subprocess.pid && this._cancellationToken) {
                const pid = subprocess.pid;

                // Cancel the command when requested
                this.onCancel(async () => {
                    try {
                        // Attempt to end the process until either
                        // a) it has a signal code, or
                        // b) process.kill throws ESRCH (process already dead)
                        while (!subprocess.signalCode) {
                            console.log(`Attempting to kill process ${pid}…`);
                            // Send SIGINT to the process group
                            process.kill(-pid, SIGINT); // The process handler will handle resolving the promise
                            // Wait 3 seconds before trying again
                            await new Promise(r => setTimeout(r, 3000));
                        }
                        console.log(`Killed process ${pid}`);
                    } catch (e: any) {
                        if (e.code === 'ESRCH') {
                            console.log(`Finally killed process ${pid}`);
                            return;
                        }
                        console.log(`Failed to kill process ${pid}:\n    ${e}`);
                        Commands.outputChannel.appendLine(`Error: failed to kill process ${pid}:\n${e}`);
                    }
                });
            }
        });
    }

    /** Run a non-graphical command as sudo, such as xcode-select. Cannot run in terminal. Not cancellable. */
    async sudo(command: string): Promise<string> {
        this.guardBinaryExists();
        this.guardHasWorkspaceRoot();

        const fullCommand = `${this.binaryPath} ${command}`;
        // The sudo package we use doesn't allow certain characters
        // in this string for now for some reason; leaving this here
        // in case that changes in the future
        //
        // const alertTitle = this.binaryPath?.split('/').pop() + ' via TinderStudio'

        return new Promise((resolve, reject) => {
            sudo.exec(fullCommand, { name: 'TinderStudio' }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    if (stdout) {
                        // If stdout is a Buffer, convert it to a string
                        if (Buffer.isBuffer(stdout)) {
                            stdout = stdout.toString();
                        }

                        resolve(stdout);
                    } else {
                        resolve('');
                    }
                }
            });
        });
    }

    /**
     * Always resolves to an empty string.
     *
     * Taken from microsoft/vscode-docker
     * https://github.com/microsoft/vscode-docker/blob/74bc9a562ed5f8a4ce87622a0bf63e8df1b7f933/src/runtimes/runners/TaskCommandRunnerFactory.ts#L38-L83
     */
    async executeAsTask(options: TaskCommandRunnerOptions, command: string, args?: CommandLineArgs): Promise<string> {
        const shellExecutionOptions: vscode.ShellExecutionOptions = {
            cwd: options.cwd || options.workspaceFolder?.uri?.fsPath || os.homedir(),
            // Inherit env
            env: process.env as vscode.ShellExecutionOptions['env'],
        };

        const shellExecution = args ?
            // Command is the process, and args contains arguments
            new ShellExecution(command, args, shellExecutionOptions) :
            // Command is the full command line
            new ShellExecution(command, shellExecutionOptions);

        const task = new Task(
            { type: 'shell' },
            options.workspaceFolder ?? TaskScope.Workspace,
            // options.taskName,
            this.commandName,
            // `TinderStudio: ${this.commandName}`,
            'TinderStudio',
            shellExecution,
            // problemMatchers
            [
                // Both just pick up 'ERROR: Build did NOT complete successfully'
                // '$bazel-file',
                // '$bazel-generic',
                '$tinderstudio-git',
                // must go before $compiler-generic or it'll break
                '$swift-lint',
                '$compiler-generic'
            ]
        );

        task.isBackground = options.isBackground ?? false;

        if (options.alwaysRunNew) {
            // If the command should always run in a new task (even if an identical command is still running),
            // add a random value to the definition. This will cause a new task to be run even if one with an
            // identical command line is already running.
            task.definition.idRandomizer = Math.random();
        }

        task.presentationOptions = {
            focus: options.focus ?? false,
            reveal: options.reveal ?? vscode.TaskRevealKind.Silent,
        };

        // Start the task
        const taskExecution = await vscode.tasks.executeTask(task);

        // Cancel the task when requested
        this.onCancel(() => {
            taskExecution.terminate();
        });

        // Wrap the task completion in a promise
        const taskEndPromise = new Promise<string>((resolve, reject) => {
            const disposable = vscode.tasks.onDidEndTaskProcess(e => {
                if (e.execution === taskExecution) {
                    disposable.dispose();

                    if (e.exitCode && options.rejectOnError) {
                        reject(e.exitCode);
                    }

                    resolve('');
                }
            });
        });

        return await taskEndPromise;
    }
}
