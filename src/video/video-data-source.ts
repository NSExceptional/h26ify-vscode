//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett. All rights reserved.
//

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'vscode';
import MP4 from '../mp4';
import VideoItem from './video-item';
import VideoInfo from '../cli/video-info';

export class VideoDataSource {
    public static readonly shared = new VideoDataSource();

    private _refreshPromise: Promise<void> | null = null;

    private data = {
        onDidChangeVideos: new EventEmitter<void>(),
        videos: [] as VideoItem[],
        hevcVideos: [] as VideoItem[],
        otherVideos: [] as VideoItem[],
        isLoading: false,
        conversions: new Map<string, boolean>(),
    };

    public readonly onDidChangeVideos = this.data.onDidChangeVideos.event;

    public readonly excludedDirectories = [
        'external',
        'bazel-*',
        'node_modules',
        '.git',
        '.build',
        'build',
    ];

    public get isRefreshing(): boolean {
        return this._refreshPromise !== null;
    }

    public get videos(): VideoItem[] {
        return this.data.videos;
    }

    public get hevcVideos(): VideoItem[] {
        return this.data.hevcVideos;
    }

    public get otherVideos(): VideoItem[] {
        return this.data.otherVideos;
    }

    public get isLoading(): boolean {
        return this.data.isLoading;
    }

    public isConverting(path: string): boolean {
        return !!this.data.conversions.get(path);
    }

    private async _refresh() {

        this.data.isLoading = true;
        this.data.videos = [];
        this.data.hevcVideos = [];
        this.data.otherVideos = [];

        try {
            // Find video files in workspace
            const excludeGlob = `{${this.excludedDirectories.join(',')}}/`;

            // Get video extensions from configuration
            const config = require('../config').default;
            const videoExtensions = config.videoExtensions || ['mp4', 'mov', 'mkv'];

            const videosGlob = `**/*.{${videoExtensions.join(',')}}`;

            const videoURIs = await vscode.workspace.findFiles(videosGlob, excludeGlob);

            // Process each video file
            for (const uri of videoURIs) {
                const filename = path.basename(uri.fsPath);
                const isConverting = this.data.conversions.get(uri.fsPath) || false;

                const isHEVC = MP4.isHEVC(uri.fsPath);

                // Try to get duration directly from MP4 file
                const duration = MP4.getDuration(uri.fsPath);

                // Create video info with the data we have
                const info: VideoInfo = {
                    codec: isHEVC ? 'hevc' : 'unknown',
                    isHEVC,
                    filename,
                    duration,
                };

                const videoItem = new VideoItem(uri, info, filename, isConverting);
                this.data.videos.push(videoItem);

                if (isHEVC) {
                    this.data.hevcVideos.push(videoItem);
                } else {
                    this.data.otherVideos.push(videoItem);
                }
            }

            // Sort videos alphabetically
            [this.data.videos, this.data.hevcVideos, this.data.otherVideos].forEach(arr => {
                arr.sort((a, b) => a.label.localeCompare(b.label));
            });
        } finally { }
    }

    public async refresh(): Promise<void> {
        // If a refresh is already in progress, return the existing promise
        if (this._refreshPromise) {
            return this._refreshPromise;
        }

        const start = Date.now();

        // Start the refresh and ensure it takes at least 1 second
        this._refreshPromise = this._refresh().then(async () => {
            const elapsed = Date.now() - start;
            if (elapsed < 1000) {
                // Wait the remaining time to reach 1 second
                await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
                console.log('Done');
            }
        }).finally(() => {
            // Clear the refresh promise when done
            this._refreshPromise = null;
            this.data.isLoading = false;
            this.data.onDidChangeVideos.fire();
        });

        return this._refreshPromise;
    }

    public async chooseNewFilename(defaultFilename: string, exists?: boolean): Promise<string | undefined> {
        const dir = path.dirname(defaultFilename);
        const filename = path.basename(defaultFilename, path.extname(defaultFilename));
        const mp4Filename = path.join(dir, `${filename}.mp4`);

        const choice = await vscode.window.showInputBox({
            title: 'Choose Output Filename',
            prompt: exists ? `Name would overwrite existing file` : `For file ${path.basename(defaultFilename)}`,
            value: mp4Filename,
            placeHolder: 'video.mp4'
        });

        if (choice && fs.existsSync(choice)) {
            return await this.chooseNewFilename(choice, true);
        }

        return choice;
    }
}
