//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett. All rights reserved.
//

import * as vscode from 'vscode';
import { CancellationToken } from 'vscode';
import { cmd } from '../decorators/cmd-decorators';
import { Commands } from './commands-base';
import { VideoDataSource } from '../video/video-data-source';
import { Progress } from '../util';
import VideoItem from '../video/video-item';
import ffmpeg from '../cli/ffmpeg';
import TranscodeTaskManager, { TranscodeTask } from '../video/task-manager';

export class VideoCommands extends Commands {
    private dataSource: VideoDataSource = VideoDataSource.shared;
    private taskManager: TranscodeTaskManager = new TranscodeTaskManager();

    private async promptForQuality(): Promise<number> {
        const crfInput = await vscode.window.showInputBox({
            title: 'Enter CRF Value',
            prompt: 'Specify a CRF value (0-51, lower is better quality). Recommended: 18-28',
            placeHolder: '23',
            validateInput: (value: string) => {
                const num = parseInt(value, 10);
                if (isNaN(num)) {
                    return 'Please enter a valid number';
                }
                if (num < 0 || num > 51) {
                    return 'CRF value must be between 0 and 51';
                }
                return null; // Valid input
            }
        });

        if (!crfInput) {
            throw new Error('CRF value input was cancelled');
        }

        return parseInt(crfInput, 10);
    }
    
    private async promptForOutputFile(videoItem: VideoItem): Promise<string> {
        let name = await this.dataSource.chooseNewFilename(videoItem.uri.fsPath);
        if (!name) {
            throw new Error('User cancelled operation');
        }
        return name;
    }

    private makeTranscodeTask(videoItem: VideoItem, operation: 'transcode' | 'recode', crf?: number): TranscodeTask {
        return {
            id: videoItem.uri.fsPath,
            name: videoItem.label,
            operation,
            work: async (cancelToken: CancellationToken) => {
                await ffmpeg.transcode({
                    input: videoItem.uri.fsPath,
                    trash: true,
                    output: await this.promptForOutputFile(videoItem),
                    crf,
                }, cancelToken);
            },
        };
    }
    
    private async transcode(videoItem: VideoItem, operation: 'transcode' | 'recode') {
        switch (operation) {
            case 'transcode':
                if (!videoItem || videoItem.contextValue !== 'video') {
                    throw new Error('Invalid video item selected');
                }
                break;
            case 'recode':
                if (!videoItem || videoItem.contextValue !== 'video-hevc') {
                    throw new Error('Invalid video item selected. Only HEVC videos may be re-encoded.');
                }
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }
        
        const crf = operation === 'recode'
            ? await this.promptForQuality()
            : undefined;
        
        const task = this.makeTranscodeTask(videoItem, operation, crf);
        this.taskManager.enqueue(task);
        await this.taskManager.resumeWithProgress();
    }
    
    // Refresh videos command
    @cmd('h26ify.refreshVideos')
    async refreshVideos() {
        await this.dataSource.refresh();
    };

    @cmd('h26ify.convertToHEVC')
    async convertToHEVC(videoItem: VideoItem, cancellationToken: CancellationToken) {
        await this.transcode(videoItem, 'transcode');
    }

    @cmd('h26ify.convertAllToHEVC')
    async convertAllToHEVC(cancellationToken: CancellationToken, progress: Progress) {
        const tasks = this.dataSource.otherVideos.map(videoItem => this.makeTranscodeTask(videoItem, 'transcode'));
        this.taskManager.enqueue(tasks);
        await this.taskManager.resumeWithProgress();
    }

    @cmd('h26ify.recode')
    async recodeHEVC(videoItem: VideoItem, cancellationToken: CancellationToken) {
        await this.transcode(videoItem, 'recode');
    }

    @cmd('h26ify.recodeAll')
    async recodeAllHEVC() {
        const crf = await this.promptForQuality();
        const tasks = this.dataSource.hevcVideos.map(videoItem => this.makeTranscodeTask(videoItem, 'recode', crf));
        this.taskManager.enqueue(tasks);
        await this.taskManager.resumeWithProgress();
    }
}
