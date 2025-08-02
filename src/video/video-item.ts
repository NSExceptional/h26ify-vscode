/*
 * video-item.ts
 * H26ify
 * 
 * Created by Tanner Bennett on 2025-07-11
 * Copyright © 2025 Tanner Bennett. All rights reserved.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import VideoInfo from '../cli/video-info';

export default class VideoItem extends vscode.TreeItem {
    constructor(
        public readonly uri: vscode.Uri,
        public readonly info: VideoInfo | null,
        public readonly label: string,
        public readonly converting: boolean = false
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        
        this.id = `${info?.isHEVC ? 'hevc' : 'idk'}:${uri.fsPath}`;
        this.resourceUri = uri;
        this.tooltip = this.getTooltip();
        this.contextValue = converting ? 'video-converting' : (info?.isHEVC ? 'video-hevc' : 'video');
        
        // Add duration and file size as description
        try {
            const stats = fs.statSync(uri.fsPath);
            const fileSize = this.formatFileSize(stats.size);
            const durationText = info?.duration ? this.formatShortDuration(info.duration) : '';
            
            this.description = durationText ? `${durationText} • ${fileSize}` : fileSize;
        } catch (error) {
            this.description = 'Unknown size';
        }
        
        // Add icons for different types of videos
        let themeIconID: string, themeColor: vscode.ThemeColor;
        if (converting) {
            themeIconID = 'sync';
            themeColor = new vscode.ThemeColor('notificationsInfoIcon.foreground');
        } else if (info?.isHEVC) {
            themeIconID = 'dashboard';
            themeColor = new vscode.ThemeColor('charts.green');
        } else {
            themeIconID = 'unverified';
            themeColor = new vscode.ThemeColor('charts.yellow');
        }

        this.iconPath = new vscode.ThemeIcon(themeIconID, themeColor);
        
        this.command = {
            command: 'revealFileInOS',
            title: 'Reveal in Folder',
            arguments: [uri]
        };
    }

    private getTooltip(): string {
        let tooltip = this.uri.fsPath;
        
        // Add detailed duration if available
        if (this.info?.duration) {
            const formattedDuration = this.formatDetailedDuration(this.info.duration);
            tooltip += `\nDuration: ${formattedDuration}`;
        }
        
        return tooltip;
    }

    /** e.g., "5m", "1h", "15s" */
    private formatShortDuration(seconds: number): string {
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        } else if (seconds < 3600) {
            return `${Math.round(seconds / 60)}m`;
        } else {
            return `${Math.round(seconds / 3600)}h`;
        }
    }
    
    /** e.g., "1:15:47" */
    private formatDetailedDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return bytes + ' B';
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(0) + ' KB';
        } else if (bytes < 1024 * 1024 * 1024) {
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        } else {
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }
    }
}
