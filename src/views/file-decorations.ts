//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett.
//

import * as vscode from 'vscode';
import { VideoDataSource } from '../video/video-data-source';
import VideoItem from '../video/video-item';

export class VideoFileDecorationProvider implements vscode.FileDecorationProvider {
    private static _instance: VideoFileDecorationProvider;
    
    private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    
    private constructor() {
        // Subscribe to data source changes to update decorations
        VideoDataSource.shared.onDidChangeVideos(() => {
            // Notify about all videos with non-undefined URIs
            const uris = VideoDataSource.shared.videos
                .map(v => v.resourceUri)
                .filter((uri): uri is vscode.Uri => uri !== undefined);
                
            this._onDidChangeFileDecorations.fire(uris);
        });
    }
    
    static get instance(): VideoFileDecorationProvider {
        if (!this._instance) {
            this._instance = new VideoFileDecorationProvider();
        }
        return this._instance;
    }
    
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        // Find the video item for this uri
        const videos = VideoDataSource.shared.videos;
        const video = videos.find((v: VideoItem) => v.resourceUri?.fsPath === uri.fsPath);
        
        if (!video) {
            return undefined;
        }
        
        if (VideoDataSource.shared.isConverting(uri.fsPath)) {
            // Show a progress indicator for converting videos
            return {
                badge: '↻',
                color: new vscode.ThemeColor('notificationsInfoIcon.foreground'),
                tooltip: 'Converting to HEVC...'
            };
        }
        
        // Check if video is HEVC
        if (video.info?.isHEVC) {
            return {
                badge: 'H',
                color: new vscode.ThemeColor('charts.green'),
                tooltip: 'HEVC Video'
            };
        } else {
            return {
                badge: '⚠',
                color: new vscode.ThemeColor('charts.yellow'),
                tooltip: 'Non-HEVC Video'
            };
        }
    }
}
