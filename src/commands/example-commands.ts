//
//  Created by Tanner Bennett on 23/10/24.
//  Copyright © 2025 Tanner Bennett. All rights reserved.
//

import { CancellationToken } from 'vscode';
import { cmd } from '../decorators/cmd-decorators';
import { Commands } from './commands-base';

export class ExampleCommands extends Commands {

    @cmd('extension.helloWorld')
    async helloWorld(cancellationToken: CancellationToken) {
        console.log('Hello World command executed');
    }
}
