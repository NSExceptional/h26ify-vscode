import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'out/test/**/*.test.js',
    version: '1.102.2', // Use the stable version of VS Code
    download: false,   // Skip downloading a new version
    // launchArgs: [
    // 	'--inspect-brk-extensions', '9229',
    // ],
});
