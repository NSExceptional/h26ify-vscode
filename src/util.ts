//
//  util.ts
//  Tweak Studio
//
//  Created by Tanner Bennett on 2021-06-27
//  Copyright © 2021 Tanner Bennett. All rights reserved.
//

import * as vscode from 'vscode';
import path from 'path';
import { QuickPick, QuickPickItem, QuickPickOptions, Uri, window, workspace } from 'vscode';
import TinderWorkspace from './tinder-workspace';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { BazelTarget } from './cli/bazelisk';

type QuickPickOptionsPro = QuickPickOptions & {
    mustPickSome?: boolean;
};

type QuickPickOneOptions = Omit<QuickPickOptionsPro, 'canPickMany'>;
type QuickPickManyOptions = QuickPickOptionsPro & { canPickMany: true };

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

    /** Mostly just for debugging */
    static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    /** @returns a URI for a file in the workspace; throws if no valid Tinder workspace */
    static workspaceFileURI(relativeFilename: string): Uri;
    /** @returns a URI for a file in the workspace, if there is a valid Tinder workspace */
    static workspaceFileURI(relativeFilename: string, throws: true): Uri | undefined;

    static workspaceFileURI(relativeFilename: string, throws?: boolean): Uri | undefined {
        if (throws) {
            return Uri.file(TinderWorkspace.workspaceRootOrThrows() + '/' + relativeFilename);
        }
        else {
            const root = TinderWorkspace.workspaceRoot;
            if (root) {
                return Uri.file(path.join(root, relativeFilename));
            }
            return undefined;
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

    /** Parse the .github/CODEOWNERS file and return all nonempty, non-comment lines */
    static async codeowners(): Promise<string[]> {
        const cwd = TinderWorkspace.workspaceRootOrThrows();
        const codeownersAbsolutePath = path.join(cwd, '.github/CODEOWNERS');

        // Get the lines of the CODEOWNERS file from the current working directory
        const codeownersFile = await workspace.fs.readFile(Uri.file(codeownersAbsolutePath));
        const lines = codeownersFile.toString().split('\n').map(s => s.trim());

        // Ignore comments and empty lines
        const validLines = lines.filter(line => {
            return !line.startsWith('#') && line.includes('/');
        });

        return validLines;
    }

    static displayNameFromCodeowner(codeownerHandle: string): string {
        codeownerHandle = codeownerHandle.replace('@TinderApp/', '');
        return {
            "ads-ios": "Ads",
            "appxp-and-frameworks-ios": "Frameworks/App Experience",
            "auth-ios": "Auth",
            "core-chat-ios": "Core Chat",
            "core-share-ios": "Core Share",
            "developer-experience-ios": "Developer Experience",
            "core-optimization-ios": "Core Optimization",
            "engagement-ios": "Engagement",
            "epic-ios": "Epic",
            "g-unit-ios": "G-Unit",
            "identity-ios": "Identity",
            "instrumentation-platform-ios": "Instrumentation",
            "international-growth-ios": "International Growth",
            "ios-performance-working-group": "Performance",
            "ios-code-style-group": "iOS Code Style Working Group",
            "ios-recs-foundation": "Recs",
            "ios-recs-intelligence": "Recs Intelligence",
            "ios-tooling-external-contributors": "ios-tooling External Contributors",
            "ios-tooling-external-maintainers": "ios-tooling External Maintainers",
            "moongang-ios": "Moongang",
            "matchlist-ios": "Matchlist",
            "nodes-adoption-ios": "Nodes Adoption",
            "onboarding-ios": "Onboarding",
            "platform-ios": "Platform",
            "profile-ios": "Profile",
            "release_ios_qa": "Release QA",
            "revenue-growth-ios": "Revenue",
            "social-responsibility-ios": "Social Responsibility",
            "swift-concurrency-ios": "Swift Concurrency",
            "swiftui-ios": "SwiftUI",
            "tappy-cloud-ios": "Tappy Cloud",
            "tinder-ios-monolith-decomposition": "Monolith Decomposition",
            "tinder_ios-tinder-session": "iOS Session",
            "trust-ios": "Trust",
            "ui-platform-ios": "UI Platform",
            "url-manager-removal-ios": "URL Manager Removal",
            "user-growth-ios": "User Growth",
            "z-team-ios": "Z-Team",
        }[codeownerHandle] ?? codeownerHandle;
    }

    /**
     * Given the lines of a CODEOWNERS file, return a list of codeowners for `relativePathOrError`.
     * `relativePathOrError` can even be a full error message from Xcode as long as it starts with a relative file path.
     * Throws an error if the path is not valid or if the file is not in a folder named `tinder_ios`.
     * */
    static codeownersForFile(codeownerLines: string[], relativePathOrError: string): string[] {
        if (!relativePathOrError.includes('/')) {
            throw new Error('Input does not contain a path');
        }

        // Add a leading / if it's missing
        if (!relativePathOrError.startsWith('/')) {
            relativePathOrError = '/' + relativePathOrError;
        }

        const tinder_ios_alreadyTrimmed = ['/Projects/', '/Teams/', '/external/']
            .some(prefix => relativePathOrError.startsWith(prefix));

        // Trim absolute portion of the path if it exists
        if (!tinder_ios_alreadyTrimmed) {
            const tinderIndex = relativePathOrError.indexOf('/tinder_ios/');
            if (tinderIndex === -1) {
                throw new Error('Input path is not under `tinder_ios` or another expected location');
            }

            // Remove everything before `/tinder_ios/`
            relativePathOrError = relativePathOrError.slice(tinderIndex);
            // Remove leading `/tinder_ios/`
            relativePathOrError = relativePathOrError.slice(11);
        }

        // Find the line(s) whose path this file is under
        const matches = codeownerLines.filter(line => {
            const components = line.split(' ');
            const path = components[0];
            return relativePathOrError.startsWith(path);
        });

        // Pull the list of codeowners out of each matching line and flatten them
        const codeowners = matches.map(line => line.split(' ').slice(1));
        return Array.from(new Set(codeowners.flat())).sort();
    }

    /** Given some text, parse out any substrings matching a `/path/to/file:line:column` like pattern */
    static filesFromLineOrSelection(lineOrSelection: string): string[] {
        let lines = [lineOrSelection];
        // Split into lines if needed
        if (lineOrSelection.includes('\n')) {
            lines = lineOrSelection.split('\n');
        }

        return lines
            // Remove non-file lines
            .filter(line => line.includes('/'))
            // Convert lines to files
            .map(line => {

                // Pull file out of line with regex
                const match = line.match(/(?:\/?[\w.\-\+]+)+(?:\.[\w.\-\+]+)?(?::\d+)?(?::\d+)?/);
                if (!match) { return null; }
                // Remove leading / if present, unless the path is absolute
                const file = match[0].startsWith('/') && !match[0].includes('tinder_ios')
                    ? match[0].slice(1)
                    : match[0];

                return file;
            })
            // Remove files that failed to parse
            .filter(file => file !== null) as string[];
    }

    /** Given some text, parse out the first substring matching a `//path/to/target:TargetName` like pattern */
    static targetIDFromLineOrSelection(lineOrSelection: string): string | undefined {
        // Split into lines if needed
        if (lineOrSelection.includes('\n')) {
            lineOrSelection = lineOrSelection.split('\n')[0];
        }

        const match = lineOrSelection.match(/\/\/([^:\s]+):([^:\s]+)/)?.[0];
        if (!match) {
            return undefined;
        }

        return match;
    }

    static tempFile(file: string): string {
        // Call mkdir -p /var/tmp/tinderstudio first
        execSync('mkdir -p /var/tmp/tinderstudio');
        const prefixUUID = randomUUID().split('-')[0];
        return path.join('/var/tmp/tinderstudio', `${prefixUUID}-${file}`);
    }
}
