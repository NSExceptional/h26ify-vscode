//
//  Created by Tanner Bennett on 17/10/24.
//  Copyright © 2025 Tanner Bennett.
//

import * as fs from 'fs';
import * as vscode from 'vscode';
import { EnvironmentCmd } from './environment-cmd';
import path from 'path';

/** Such as `@Buildozer//:buildozer-darwin-arm64` */
type iOSToolingToolIdentifier = `@${string}//:${string}`;

/**
 * A class that assists in invoking bazelisk commands faster than bazel allows.
 * By invoking the tool with --script_path, we can generate a shell script that
 * will directly invoke the command without involving bazel. This can
 * dramatically speed up commands that are called frequently.
 */
export abstract class EphemeralCommand extends EnvironmentCmd {
    private static readonly binFolder = '.vscode/bin';

    private readonly toolID: iOSToolingToolIdentifier;
    /** The `buildozer-darwin-arm64` part of `@Buildozer//:buildozer-darwin-arm64` */
    private readonly toolName: string;

    expectedBinaryPath: { relativeToWorkspace: string };

    constructor(toolCmd: iOSToolingToolIdentifier) {
        super();

        this.toolID = toolCmd;
        this.toolName = toolCmd.split(':')[1];
        this.expectedBinaryPath = {
            relativeToWorkspace: `${EphemeralCommand.binFolder}/${this.toolName}`
        };
    }

    private async generateIfNotExists() {
        const shellPath = this.unsafeBinaryPath()!;

        if (!fs.existsSync(shellPath)) {
            // Create bin/ folder
            const folder = path.dirname(shellPath);
            fs.mkdirSync(folder, { recursive: true });

            // Generate the tool
            throw new Error(`Ephemeral commands are not configured for this workspace.`);
            
            if (!fs.existsSync(shellPath)) {
                throw new Error(`Failed to generate command shell wrapper for ${this.toolName}`);
            }
        }
    }

    override async runCommand(command: string, runAsTaskBehavior?: vscode.TaskRevealKind): Promise<string> {
        await this.generateIfNotExists();
        return super.runCommand(command, runAsTaskBehavior);
    }
}
