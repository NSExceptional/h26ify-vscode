//
//  Created by Tanner Bennett on 26/08/24.
//  Copyright © 2025 Tanner Bennett. All rights reserved.
//

import { EnvironmentCmd } from './environment-cmd';

class XcodeSelect extends EnvironmentCmd {
    protected commandName = 'xcode-select';
    protected expectedBinaryPath = { absolute: '/usr/bin/xcode-select' };

    static shared = new XcodeSelect();

    async getSelectedVersion(): Promise<string> {
        return await this.runCommand('-p');
    }

    async setSelectedVersion(path: string) {
        await this.sudo(`-s ${path}`);
    }

    async resetSelectedVersion() {
        await this.runCommand('-r');
    }
}

export default XcodeSelect.shared;
