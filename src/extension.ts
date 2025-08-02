//
//  extension.ts
//  h26ify
//
//  Created by Tanner Bennett on 2022-09-14
//

'use strict';
import * as vscode from 'vscode';
import { window } from 'vscode';
import { Commands } from './commands/commands-base';
import { VideoCommands } from './commands/video-commands';
import { VideosViewProvider } from './views/videos-provider';
import { VideoDataSource } from './video/video-data-source';
import ffmpeg from './cli/ffmpeg';
import { VideoFileDecorationProvider } from './views/file-decorations';
import VideoItem from './video/video-item';

const kCommandTypes: (new (...args: any[]) => any)[] = [
    Commands,
    VideoCommands,
];

function registerViews(context: vscode.ExtensionContext) {
    // Create single tree view with hierarchical structure
    const videosProvider = new VideosViewProvider();
    const treeView = window.createTreeView('h26ify.videos', {
        treeDataProvider: videosProvider,
        canSelectMany: false,
        dragAndDropController: {
            dragMimeTypes: ['text/uri-list'],
            dropMimeTypes: [],
            handleDrag(sources, dataTransfer, _token) {
                // Filter out non-video items
                const videoItems = sources.filter(item => item instanceof VideoItem) as VideoItem[];
                if (videoItems.length === 0) {
                    return;
                }
                
                // Create a URI list for dragging to terminals or other applications
                const uriList = videoItems
                    .map(item => item.uri.toString())
                    .join('\r\n');
                
                dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uriList));
                
                // For plain text, just use the file paths (useful for terminals)
                const textPaths = videoItems
                    .map(item => `"${item.uri.fsPath}"`)
                    .join(' ');
                
                dataTransfer.set('text/plain', new vscode.DataTransferItem(textPaths));
            }
        }
    });

    context.subscriptions.push(treeView);
}

export async function activate(context: vscode.ExtensionContext) {
    // Register commands
    Commands.init(context);
    for (const ctor of kCommandTypes) {
        const cmd: Commands = new ctor();
        Commands.commandsRegistry.push(cmd);
    }
    
    // Register views
    registerViews(context);
    
    // Register file decoration provider
    // context.subscriptions.push(
    //     vscode.window.registerFileDecorationProvider(VideoFileDecorationProvider.instance)
    // );
    
    // Check if ffmpeg is available
    try {
        const isFFmpegAvailable = await ffmpeg.isAvailable;
        
        if (!isFFmpegAvailable) {
            vscode.window.showWarningMessage('ffmpeg is not available. You need to install it to convert videos to HEVC.');
        }
    } catch (error) {
        vscode.window.showErrorMessage('Error checking ffmpeg availability: ' + (error instanceof Error ? error.message : String(error)));
    }
    
    // Initialize video data source
    await VideoDataSource.shared.refresh();
}
