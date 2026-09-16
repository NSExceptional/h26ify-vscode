//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett. All rights reserved.
//

import * as vscode from 'vscode';

export type OutputFileStrategy = 'useOriginalName' | 'askForName' | 'useTemplate';
export type OriginalFileHandling = 'leaveInPlace' | 'trash' | 'delete';

interface H26ifyConfig {
    videoExtensions: string[];
    outputNamePattern: string;
    outputFileStrategy: OutputFileStrategy;
    originalFileHandling: OriginalFileHandling;
    overwriteExisting: boolean;
}

class Config implements H26ifyConfig {
    static shared: Config = new Config();

    public videoExtensions: string[] = ['mp4', 'mov', 'mkv'];
    public outputNamePattern: string = '';
    public outputFileStrategy: OutputFileStrategy = 'useTemplate';
    public originalFileHandling: OriginalFileHandling = 'trash';
    public overwriteExisting: boolean = false;

    constructor() {
        this.update();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('h26ify')) {
                this.update();
            }
        });
    }

    private update() {
        const config = vscode.workspace.getConfiguration('h26ify');

        // Video extensions setting
        const videoExtensions = config.get<string[]>('videoExtensions');
        if (videoExtensions && Array.isArray(videoExtensions)) {
            this.videoExtensions = videoExtensions;
        }

        // Output file name pattern
        const outputNamePattern = config.get<string>('outputNamePattern');
        if (outputNamePattern) {
            this.outputNamePattern = outputNamePattern;
        }

        // Output file strategy
        const outputFileStrategy = config.get<OutputFileStrategy>('outputFileStrategy');
        if (outputFileStrategy) {
            this.outputFileStrategy = outputFileStrategy;
        }

        // Original file handling
        const originalFileHandling = config.get<OriginalFileHandling>('originalFileHandling');
        if (originalFileHandling) {
            this.originalFileHandling = originalFileHandling;
        }

        // Overwrite existing files
        const overwriteExisting = config.get<boolean>('overwriteExisting');
        if (overwriteExisting !== undefined) {
            this.overwriteExisting = overwriteExisting;
        }
    }
}

// Export a singleton instance
export default Config.shared as Config;
