//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett.
//

import * as vscode from 'vscode';
import { cmd } from '../decorators/cmd-decorators';
import { Commands } from './commands-base';
import { VideoDataSource } from '../video/video-data-source';
import { Util } from '../util';
import * as path from 'path';
import * as fs from 'fs';
import config from '../config';
import VideoItem from '../video/video-item';
import TranscodeTaskManager from '../video/task-manager';
import { TranscodeTask } from '../video/transcode-task';
import { EditPanel } from '../views/edit-panel';
import { VideosViewProvider } from '../views/videos-provider';

export class VideoCommands extends Commands {
    private dataSource: VideoDataSource = VideoDataSource.shared;
    private taskManager: TranscodeTaskManager = new TranscodeTaskManager(
        () => this.dataSource.refresh()
    );

    private guardOperationIsValid(videoItem: VideoItem, operation: 'transcode' | 'recode') {
        if (operation === 'transcode' && videoItem.contextValue !== 'video') {
            throw new Error('Invalid video item selected');
        }
        if (operation === 'recode' && videoItem.contextValue !== 'video-hevc') {
            throw new Error('Invalid video item selected. Only HEVC videos may be re-encoded.');
        }
    }

    private async promptForQuality(): Promise<number>;
    private async promptForQuality(optional: false): Promise<number>;
    private async promptForQuality(optional: boolean): Promise<number | undefined>;
    private async promptForQuality(optional?: boolean): Promise<number | undefined> {
        const crfInput = await vscode.window.showInputBox({
            title: 'Enter CRF Value (Optional)',
            prompt: optional
                ? 'Specify a CRF value (0-51, lower is better quality). Leave blank to skip this step. Recommended: 18-28'
                : 'Specify a CRF value (0-51, lower is better quality). Recommended: 18-28',
            placeHolder: '23',
            validateInput: (value: string) => {
                if (optional && value.trim() === '') return null; // Allow blank when optional
                const num = parseInt(value, 10);
                if (isNaN(num)) {
                    return 'Enter a valid number';
                }
                if (num < 0 || num > 51) {
                    return 'CRF value must be between 0 and 51';
                }
                return null; // Valid input
            }
        });

        if (crfInput === undefined) {
            throw new Error('CRF input was cancelled');
        }

        return crfInput.trim() === '' ? undefined : parseInt(crfInput, 10);
    }

    private async promptForFPS(): Promise<number | undefined> {
        const fpsInput = await vscode.window.showInputBox({
            title: 'Enter desired FPS (Optional)',
            prompt: 'Set the output frame rate, or leave blank to skip this step.',
            validateInput: (value: string) => {
                if (value.trim() === '') return null; // Allow blank input
                const num = parseInt(value, 10);
                if (isNaN(num) || num <= 0) {
                    return 'Enter a valid, positive number';
                }
                return null; // Valid input
            }
        });

        if (fpsInput === undefined) {
            throw new Error('FPS input was cancelled');
        }

        return fpsInput ? parseInt(fpsInput, 10) : undefined;
    }

    private async promptForOutputFile(videoItem: VideoItem, exists?: boolean): Promise<string | undefined> {
        const defaultFilename = videoItem.uri.fsPath;
        const dir = path.dirname(defaultFilename);
        const filename = path.basename(defaultFilename, path.extname(defaultFilename));
        const extension = path.extname(defaultFilename);
        const suggestedFilename = path.join(dir, `${filename}${extension}`);

        const choice = await vscode.window.showInputBox({
            title: 'Choose Output Filename',
            prompt: exists
                ? `File already exists: ${path.basename(defaultFilename)}`
                : `Choose output filename for ${path.basename(defaultFilename)}`,
            value: suggestedFilename,
            placeHolder: 'video.mp4'
        });

        if (choice && fs.existsSync(choice) && choice !== defaultFilename) {
            return await this.promptForOutputFile(videoItem, true);
        }

        return choice;
    }

    private async outputFileForItem(videoItem: VideoItem): Promise<string> {
        switch (config.outputFileStrategy) {
            case 'useOriginalName':
                return videoItem.uri.fsPath;
            case 'askForName':
                const choice = await this.promptForOutputFile(videoItem);
                if (!choice) {
                    throw new Error(`Cancelled converting ${videoItem.label}`);
                }
                return choice;
            case 'useTemplate':
            default:
                return Util.filenameFromTemplate(
                    videoItem.uri.fsPath, 'hevc', config.outputNamePattern
                );
        }
    }

    /** @returns `true` to overwrite, `false` to skip */
    private async promptToOverwriteVideoOrSkipItem(name: string): Promise<'overwrite' | 'skip' | 'cancel'> {
        const choice = await vscode.window.showWarningMessage(
            `File exists: ${name}`,
            { modal: true },
            'Overwrite',
            'Skip'
        );

        if (!choice) {
            return 'cancel';
        }

        return choice.toLowerCase() as 'overwrite' | 'skip';
    }

    private async videoItemsToTasks(videoItems: VideoItem[], operation: 'transcode' | 'recode'): Promise<TranscodeTask[]> {
        // Ask for quality if recoding - make it optional for single videos
        const crf = operation === 'recode'
            // Optional for single video, required for multiple videos
            ? await this.promptForQuality(videoItems.length === 1)
            : undefined;
        // Ask for FPS only when operating on a single video
        const fps = videoItems.length === 1 ? await this.promptForFPS() : undefined;

        return await Promise.all(videoItems.map(async videoItem => {
            this.guardOperationIsValid(videoItem, operation);
            const output = await this.outputFileForItem(videoItem);
            const task = new TranscodeTask(videoItem, output, operation, crf, fps);
            return task;
        }));
    }

    private async transcode(videoItems: VideoItem[], operation: 'transcode' | 'recode') {
        const tasks = await this.videoItemsToTasks(videoItems, operation);
        const alwaysOverwrite = config.overwriteExisting;

        if (!alwaysOverwrite) {
            // Check if any of the files exist already and ask the user what to do for each
            for (let i = tasks.length - 1; i >= 0; i--) {
                const task = tasks[i];
                const exists = fs.existsSync(task.outputPath);
                if (exists) {
                    const action = await this.promptToOverwriteVideoOrSkipItem(task.name);
                    if (action === 'skip') {
                        tasks.splice(i, 1);
                    } else if (action === 'cancel') {
                        throw new Error(`Operation(s) cancelled`);
                    }
                }
            }
        }

        this.taskManager.enqueue(tasks);
        await this.taskManager.resumeWithProgress();
    }

    @cmd('h26ify.refreshVideos')
    async refreshVideos() {
        await this.dataSource.refresh();
    };

    @cmd('h26ify.convertToHEVC')
    async convertToHEVC(videoItem: VideoItem) {
        await this.transcode([videoItem], 'transcode');
    }

    @cmd('h26ify.convertAllToHEVC')
    async convertAllToHEVC() {
        await this.transcode(this.dataSource.otherVideos, 'transcode');
    }

    @cmd('h26ify.recode')
    async recodeHEVC(videoItem: VideoItem) {
        await this.transcode([videoItem], 'recode');
    }

    @cmd('h26ify.editVideo')
    async editVideo(videoItem: VideoItem) {
        EditPanel.open(Commands.context, videoItem);
    }

    @cmd('h26ify.editSelectedVideos')
    async editSelectedVideos(videoItems: VideoItem[]) {
        if (!videoItems || videoItems.length === 0) { return; }
        EditPanel.open(Commands.context, videoItems);
    }

    /** Title-bar action: edit whatever videos are currently selected in the tree. */
    @cmd('h26ify.editSelectionFromView')
    async editSelectionFromView() {
        const selection = VideosViewProvider.treeView?.selection ?? [];
        const videos = selection.filter(
            (i): i is VideoItem => i instanceof VideoItem
                && (i.contextValue === 'video' || i.contextValue === 'video-hevc')
        );
        if (videos.length === 0) {
            vscode.window.showInformationMessage('Select one or more videos in the Videos view to edit.');
            return;
        }
        EditPanel.open(Commands.context, videos);
    }

    /** Inline action: reveal a video file in Finder/Explorer. */
    @cmd('h26ify.revealInFinder')
    async revealInFinder(videoItem: VideoItem) {
        if (!videoItem?.uri) { return; }
        await vscode.commands.executeCommand('revealFileInOS', videoItem.uri);
    }

    @cmd('h26ify.recodeAll')
    async recodeAllHEVC() {
        await this.transcode(this.dataSource.hevcVideos, 'recode');
    }
}
