//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett. All rights reserved.
//

import { EnvironmentCmd } from './environment-cmd';
// import trash dynamically below where needed
import * as vscode from 'vscode';
import * as path from 'path';

export type FFmpegOptions = {
    input: string;
    output?: string | ((input: string) => Promise<string | undefined>);
    overwrite?: boolean;
    /** Quality factor (0-51, lower is better quality but larger file) */
    crf?: number;
    /** Whether to trash the old file. Ignored if `overwrite` is `true` */
    trash?: boolean;
}

class ffmpeg extends EnvironmentCmd {
    protected commandName = 'ffmpeg';
    protected expectedBinaryPath = { inPATH: 'ffmpeg' };

    static shared = new ffmpeg();
    
    private isAvailableCache: boolean | undefined = undefined;

    guardCanUseFFmpeg(): void {
        if (this.isAvailableCache === false) {
            throw new Error('ffmpeg is not available. Please install it and make sure it is in your PATH.');
        }
    }

    async transcode(options: FFmpegOptions, cancellationToken?: vscode.CancellationToken): Promise<string> {
        this.guardCanUseFFmpeg();
        
        this.oneTimeCancellationToken = cancellationToken;
        
        const inputFile = options.input;
        let outputFile = typeof options.output === 'string' ? options.output : undefined;
        
        if (!outputFile) {
            // Create output filename based on configuration pattern
            const dir = path.dirname(inputFile);
            const filename = path.basename(inputFile, path.extname(inputFile));
            
            // Get pattern from config
            const config = require('../config').default;
            const pattern = config.outputNamePattern;
            
            // Replace placeholders in pattern
            const outputFilename = pattern
                .replace('{filename}', filename)
                .replace('{extension}', 'mp4');
                
            outputFile = path.join(dir, outputFilename);
        }
        
        if (typeof options.output === 'function') {
            // If outputFile exists, prompt for new filename
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(outputFile));
                // File exists, prompt for new filename
                outputFile = await options.output(outputFile);
                if (!outputFile) {
                    throw new Error('Conversion cancelled');
                }
            } catch {
                // File does not exist, continue
            }
        }
        
        // Build conversion command with progress output
        const command = [
            options.overwrite ? '-y' : '',
            '-i', `'${inputFile}'`,
            '-c:v', 'libx265',
            '-tag:v', 'hvc1',
            // Use CRF if specified, otherwise use bitrate 0 (auto)
            options.crf !== undefined ? `-crf ${options.crf}` : '-b:v 0',
            '-c:a', 'copy',
            '-progress', '-',
            `'${outputFile!}'`
        ].join(' ');
        
        // Run conversion using runCommand with terminal always revealed
        await this.runCommand(command, vscode.TaskRevealKind.Always);
        
        if (options.trash) {
            // Move original file to trash using macOS/Windows/Linux trash APIs
            const trash = (await import('trash')).default;
            await trash([inputFile]);
        }
        
        return outputFile!;
    }
}

export default ffmpeg.shared as ffmpeg;
