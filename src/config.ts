//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett. All rights reserved.
//

import * as vscode from 'vscode';

interface H26ifyConfig {
    videoExtensions: string[];
    outputNamePattern: string;
}

class Config implements H26ifyConfig {
    static shared: Config = new Config();

    public videoExtensions: string[] = [];
    public outputNamePattern: string = '';

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
    }
}

// Export a singleton instance
export default Config.shared as Config;
