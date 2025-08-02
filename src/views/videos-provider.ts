//
//  videos-provider.ts
//  H26ify
//
//  Created by Tanner Bennett on 2023-08-23
//  Copyright © 2023 Tanner Bennett. All rights reserved.
//

import * as vscode from 'vscode';
import { VideoDataSource } from '../video/video-data-source';
import VideoItem from '../video/video-item';

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly items: VideoItem[],
        public readonly contextValue: string = 'category',
        public readonly iconPath: vscode.ThemeIcon = new vscode.ThemeIcon('folder')
    ) {
        super(label, items.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `category:${label}`;
    }
}

export class VideosViewProvider implements vscode.TreeDataProvider<CategoryItem | VideoItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CategoryItem | VideoItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private dataSource = VideoDataSource.shared;
    
    constructor() {
        this.dataSource.onDidChangeVideos(() => {
            this.refresh();
        });
    }
    
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    
    async reloadAndRefresh(): Promise<void> {
        await this.dataSource.refresh();
    }
    
    getTreeItem(element: CategoryItem | VideoItem): vscode.TreeItem {
        return element;
    }
    
    async getChildren(element?: CategoryItem | VideoItem): Promise<(CategoryItem | VideoItem)[]> {
        if (this.dataSource.isRefreshing) {
            return [];
        }
        
        if (!element) {
            // Root level - show categories //
            
            const hevcCategory = new CategoryItem(
                'HEVC', 
                this.dataSource.hevcVideos,
                'category-hevc',
                new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.green'))
            );
            
            const otherCategory = new CategoryItem(
                'Non-HEVC', 
                this.dataSource.otherVideos,
                'category-other',
                new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'))
            );
            
            return [hevcCategory, otherCategory];
        } else if (element instanceof CategoryItem) {
            // Return videos in this category
            return element.items.length > 0 ? element.items : [this.createInfoItem(`No ${element.label} videos found`)];
        }
        
        return [];
    }
    
    /** Placeholder for empty sections */
    private createInfoItem(message: string): VideoItem {
        const item = new VideoItem(
            vscode.Uri.parse('info:message'),
            null,
            message
        );
        item.contextValue = 'info';
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
    }
}
