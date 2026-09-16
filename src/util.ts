//
//  util.ts
//  Tweak Studio
//
//  Created by Tanner Bennett on 2021-06-27
//  Copyright © 2021 Tanner Bennett.
//

import * as vscode from 'vscode';
import path from 'path';
import { window, workspace } from 'vscode';
import { CancellationToken } from 'vscode';
import { QuickPick, QuickPickItem, QuickPickOptions, Uri } from 'vscode';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';

type QuickPickOptionsPro = QuickPickOptions & {
    mustPickSome?: boolean;
};

type QuickPickOneOptions = Omit<QuickPickOptionsPro, 'canPickMany'>;
type QuickPickManyOptions = QuickPickOptionsPro & { canPickMany: true };

export type Progress = vscode.Progress<{
    message?: string;
    increment?: number;
}>;

export type MessageItemT<T extends String> = vscode.MessageItem & {
    title: T;
}

/** `getAfter` is the default behavior when neither `getAt` or `getAfter` are supplied */
type SplitGetOptions<T> = {
    /** The index of the resulting split to return */
    getAt?: number;
    /** Whether to return everything after the first split component as one string */
    getAfter?: true;
    /** The value to use when getAt is out of bounds, or when `split()` returns a single-element array */
    defaultValue: T;
}

export class Util {

    public static testing = false;
    public static mockProgress: Progress | undefined = undefined;

    /** Mostly just for debugging */
    static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Combines two cancellation tokens into one.
     *
     * The resulting token will be cancelled if either of the input tokens is cancelled.
     * If either token is already cancelled, the result will be cancelled immediately.
     *
     * Note that you cannot manually cancel a token, you can only observe cancellation.
     * This makes it easy to observe cancellation of two tokens at once.
     */
    static combineCancellationTokens(child: CancellationToken, parent?: CancellationToken): CancellationToken {
        if (!parent) {
            return child;
        }

        // Create a new token that cancels when either input token cancels
        const combined = new vscode.CancellationTokenSource();
        // Cancelling the parent token will cancel all child operations
        parent.onCancellationRequested(() => combined.cancel());
        // Cancelling the child token will cancel the combined token,
        // but the parent token can't see it anyway; parent should be
        // using its own token still and not the combined token
        child.onCancellationRequested(() => combined.cancel());
        if (parent.isCancellationRequested || child.isCancellationRequested) {
            combined.cancel();
        }

        return combined.token;
    }

    static async withProgressNotif<T>(message: string, work: (cancelToken: CancellationToken, progress: Progress) => Promise<T>): Promise<T> {
        if (this.testing && Util.mockProgress) {
            return await work(new vscode.CancellationTokenSource().token, Util.mockProgress);
        }

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: message,
            cancellable: true
        }, async (progress, token) => {
            return await work(token, progress);
        });
    }

    static isString(value: unknown): value is string {
        return typeof value === 'string';
    }

    /** Converts a string to an array split by the given string */
    static arrayOrSplitBy(value: string | string[], splitBy: string): string[] {
        if (Array.isArray(value)) {
            return value;
        }

        return value.split(splitBy).map(s => s.trim());
    }

    /** Remove the last component of a string split by splitby */
    static popLast(str: string, splitby: string): string {
        if (!str.includes(splitby)) { return str; }

        const components = str.split(splitby);
        components.pop();
        return components.join(splitby);
    }

    /**
     * Safely split a string and get the value at the desired index,
     * or return a default value when the desired index is out-of-bounds.
     */
    static splitAndGet<T>(str: string, splitBy: string, options: SplitGetOptions<T>): string | T {
        const parts = str.split(splitBy);

        // We want a specific index
        if (options.getAt) {
            const at = options.getAt;
            return parts.length > at ? parts[at] : options.defaultValue;
        }

        // There is 0 or 1 components, use default value
        if (parts.length < 2) {
            return options.defaultValue;
        }

        // We want everything after the first split component
        return parts.slice(1).join(splitBy);
    }

    /**
     * @param onlyFirst whether to return the first element of value
     * @return The value or a rejected promise
     */
    static valueOrReject<T>(value: T | undefined): T | Promise<T> {
        if (value) {
            return value;
        }

        return Promise.reject();
    }

    /**
     * @param onlyFirst whether to return the first element of value
     * @return The value or a rejected promise
     */
    static firstOrReject<T>(value: T[] | undefined): T | Promise<T> {
        if (value && value.length) {
            return value[0]!;
        }

        return Promise.reject();
    }

    /** @return e.g. `"2021-06-27"` or `"2021-06-27-1624821234567"` */
    static dateString(withTimestamp?: boolean): string {
        const date = new Date();
        const dateString = date.toISOString().split('T')[0];
        return withTimestamp ? `${dateString}-${date.getTime()}` : dateString;
    }

    static workspaceFolder(): vscode.WorkspaceFolder | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }

        return workspaceFolders[0];
    }

    /** @returns a URI for a file in the workspace */
    static workspaceFileURI(relativeFilename: string): Uri | undefined {
        const workspaceFolder = Util.workspaceFolder();
        if (!workspaceFolder) {
            return undefined;
        }

        const root = workspaceFolder.uri.fsPath;
        return Uri.file(path.join(root, relativeFilename));
    }

    static async fileExists(filePath: string): Promise<boolean> {
        try {
            let absolute = path.resolve(filePath);
            await fs.promises.stat(absolute);
            return true;
        } catch {
            return false;
        }
    }

    static async createOrReplaceFile(uri: Uri, content: string, openAfter?: boolean): Promise<void> {
        await workspace.fs.writeFile(uri, Buffer.from(content));
        if (openAfter) {
            await window.showTextDocument(uri);
        }
    }

    /** Prompt the user with the file picker dialog and read the file contents */
    static async chooseAndReadFile(prompt?: string): Promise<string> {
        // Ask user if they want to choose a file or use the current editor
        const choice = await window.showInformationMessage(
            'Choose a file or use the currently open file?',
            { modal: true },
            'Open New File', 'Use Current File'
        );

        // Case: use current editor
        if (choice === 'Use Current File') {
            const editor = window.activeTextEditor;
            if (!editor) {
                throw new Error('No active editor');
            }

            return editor.document.getText();
        }

        // Case: cancelled
        if (choice !== 'Open New File') {
            throw new Error('User cancelled file picker');
        }

        // Case: open a new file

        // Show file picker
        const selection = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: prompt,
        });

        if (!selection || selection.length === 0) {
            throw new Error('No file selected');
        }

        // Read file
        const text = await Util.readFile(selection[0]);
        return text;
    }

    static async readFile(uri: string | Uri): Promise<string> {
        if (typeof uri === 'string') {
            uri = Uri.file(uri);
        }

        const buffer = await workspace.fs.readFile(uri);
        return buffer.toString();
    }

    static isSameFile(a: string, b: string): boolean {
        // Resolve a directory's real path (following symlinks) when it exists,
        // falling back to a plain absolute path when it doesn't — the output
        // file/dir may not exist yet, and a missing dir must not throw.
        const resolveDir = (dir: string): string => {
            try {
                return fs.realpathSync(dir);
            } catch {
                return path.resolve(dir);
            }
        };

        // Compare directory-by-directory so a non-existent file doesn't throw
        const fullA = path.join(resolveDir(path.dirname(a)), path.basename(a));
        const fullB = path.join(resolveDir(path.dirname(b)), path.basename(b));
        return fullA === fullB;
    }

    static filenameFromTemplate(inputFile: string, toFormat: string, pattern: string): string {
        inputFile = fs.realpathSync(inputFile);
        const dir = path.dirname(inputFile);
        const oldExt = path.extname(inputFile);
        const filename = path.basename(inputFile, oldExt);

        // i.e. {filename}.{format}.{ext} -> foo.hevc.mp4
        const outputFilename = pattern
            .replace('{filename}', filename)
            .replace('{format}', toFormat)
            .replace('{old-ext}', oldExt)
            .replace('{ext}', 'mp4');

        if (outputFilename.includes('{') || outputFilename.includes('}')) {
            throw new Error('Output pattern contains invalid or incomplete placeholders');
        }

        const outputFile = path.join(dir, outputFilename);
        return outputFile;
    }

    /**
     * Converts an array of file extensions to a glob pattern. For example, this:
     * ```
     * ['mp4', 'mov', 'avi']
     * ```
     * becomes this:
     * ```
     * '{mp4,mov,avi}'
     * ```
     * or this, when marked case-insensitive:
     * ```
     * '{mp4,mov,avi,MP4,MOV,AVI}'
     * ```
     * @param extensions The file extensions to include (without leading dot)
     * @param caseSensitive Whether the glob pattern should be case-sensitive
     * @returns A string like `'{mp4,mov,avi}'`
     */
    static toExtensionGlob(extensions: string[], caseSensitive = true): string {
        if (!caseSensitive) {
            extensions = extensions.map(e => e.toLowerCase());
            extensions.push(...extensions.map(e => e.toUpperCase()));
        }

        return `{${extensions.join(',')}}`;
    }

    static lineOrSelectionInActiveEditor(): [string, vscode.Range] | undefined;
    static lineOrSelectionInActiveEditor(throwOnError: true): [string, vscode.Range];
    static lineOrSelectionInActiveEditor(throwOnError?: boolean): [string, vscode.Range] | undefined {
        const editor = window.activeTextEditor;
        const document = editor?.document;
        if (!document) {
            if (throwOnError) {
                throw new Error('No active editor');
            }
            return undefined;
        }

        // Get selected text
        const selection = editor.selection;
        const range = new vscode.Range(selection.start, selection.end);
        let lineOrSelection: string;
        if (range.isEmpty) {
            // Use text of current line if no selection
            const line = document.lineAt(selection.start.line);
            lineOrSelection = line.text;
        }
        else {
            // Use full selection
            lineOrSelection = document.getText(range);
        }

        return [lineOrSelection, range];
    }

    static messageItemsWithCloseAffordance<T extends string>(items: T[]): MessageItemT<T>[] {
        return [...items.map(label => ({ title: label }))];
    }

    private static createQuickPick<T extends QuickPickItem>(items: T[], options?: QuickPickOptions): QuickPick<T> {
        const quickPick = window.createQuickPick<T>();
        this.initQuickPick(quickPick, options);
        quickPick.items = items;
        return quickPick;
    }

    /** Boilerplate helper to configure the result of `createQuickPick()` given some `QuickPickOptions` */
    private static initQuickPick<T extends QuickPickItem>(picker: QuickPick<T>, options?: QuickPickOptions) {
        if (!options) { return; }

        // Enumerate all keys of options and set them on picker, only if the picker defines the property
        for (const key in options) {
            if (picker.hasOwnProperty(key)) {
                // @ts-ignore
                picker[key] = options[key];
            }
        }

        // Special case for canPickMany / canSelectMany which is not named the same on the picker
        if (options.canPickMany !== undefined) {
            picker.canSelectMany = options.canPickMany;
        }
    }

    /** Returns one or more choices, rejects if nothing selected and `mustSelectSome` */
    static pickMany<T extends QuickPickItem>(choices: T[], options?: QuickPickManyOptions): Promise<readonly T[]> {
        return new Promise((resolve, reject) => {
            const quickPick = this.createQuickPick(choices, { ...options, canPickMany: true });

            quickPick.onDidAccept(() => {
                const selection = quickPick.selectedItems;
                if (options?.mustPickSome && !selection.length) {
                    reject();
                } else {
                    resolve(selection as T[]);
                }

                quickPick.hide();
            });

            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        });
    }

    /** Returns one choice, rejects if nothing selected */
    static pickFrom<T extends QuickPickItem>(choices: T[], options?: QuickPickOneOptions): Promise<T> {
        return new Promise((resolve, reject) => {
            const quickPick = this.createQuickPick(choices, options);
            quickPick.title = options?.title;

            quickPick.onDidChangeSelection((selection: readonly QuickPickItem[]) => {
                if (selection.length) {
                    // @ts-ignore
                    resolve(selection[0]);
                } else {
                    reject();
                }

                quickPick.hide();
            });

            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        });
    }

    /** Returns one choice, rejects if nothing selected */
    static async pickString(choices: string[], options?: QuickPickOneOptions): Promise<string> {
        const choice = await window.showQuickPick(choices, options);
        return this.valueOrReject(choice);
    }

    /** Returns one or more choices, rejects if nothing selected */
    static async pickStrings(choices: string[], options?: QuickPickManyOptions): Promise<string[]> {
        const chosen = await window.showQuickPick(choices, { ...options, canPickMany: true });
        return this.valueOrReject(chosen);
    }

    /** Returns one folder selection, rejects if nothing selected */
    static async selectSingleFolder(): Promise<Uri> {
        const selection = await window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
        });

        return this.firstOrReject(selection);
    }

    /** Select a single file to open, rejects if nothing selected */
    static async selectSingleFile(startIn?: Uri | string): Promise<Uri> {
        const selection = await window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false, // .app counts as file
            defaultUri: this.isString(startIn) ? Uri.file(startIn) : startIn,
        });

        let path = await this.firstOrReject(selection);
        // Try again if a .app folder was selected to allow selecting inside app
        if (path.fsPath.endsWith('.app')) {
            return this.selectSingleFile(path);
        }

        return path;
    }

    /**
     * Returns the folder path for the given setting or rejects and prompts
     * the user to populate the setting with an info message. If the user presses
     * the button, the open dialog will allow them to select a folder.
     */
    static async getOrPromptForPathSetting(setting: string, prompt: string, action: string): Promise<string> {
        // Workspace API breaks the preference key into two parts, see below
        const components = setting.split('.');
        const key = components.pop();
        setting = components.join('.');

        if (!key) {
            return Promise.reject();
        }

        let value: string | undefined = workspace.getConfiguration(setting).get(key);
        if (value && value !== '') {
            return value;
        }

        const choice = await window.showWarningMessage(prompt, action);
        if (choice) {
            value = (await this.selectSingleFolder()).fsPath;
            workspace.getConfiguration(setting).update(key, value);
            return value;
        }

        return Promise.reject();
    }

    static tempFile(file: string): string {
        // Call mkdir -p /var/tmp/h26ify first
        execSync('mkdir -p /var/tmp/h26ify');
        const prefixUUID = randomUUID().split('-')[0];
        return path.join('/var/tmp/h26ify', `${prefixUUID}-${file}`);
    }
}
