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
import { CollapseStateStore } from './collapse-state-store';

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly items: VideoItem[],
        public readonly contextValue: string = 'category',
        public readonly iconPath: vscode.ThemeIcon = new vscode.ThemeIcon('folder')
    ) {
        super(label, items.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `category:${contextValue}`; // stable id — does not include the changing count
    }
}

export class VideosViewProvider implements vscode.TreeDataProvider<CategoryItem | VideoItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CategoryItem | VideoItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** The active tree view, exposed so title-bar commands can read the current selection. */
    static treeView: vscode.TreeView<CategoryItem | VideoItem> | undefined;

    private dataSource = VideoDataSource.shared;
    private _firstLoad = true;
    private _knownCollapsibleIds = new Set<string>();

    constructor() {
        this.dataSource.onDidChangeVideos(() => {
            this._handleVideosChanged();
            this.refresh();
        });
    }

    /** Call after createTreeView to wire up collapse/expand persistence. */
    setTreeView(treeView: vscode.TreeView<CategoryItem | VideoItem>): void {
        VideosViewProvider.treeView = treeView;
        treeView.onDidCollapseElement(e => {
            if (e.element.id) { CollapseStateStore.shared.setCollapsed(e.element.id, true); }
        });
        treeView.onDidExpandElement(e => {
            if (e.element.id) { CollapseStateStore.shared.setCollapsed(e.element.id, false); }
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async reloadAndRefresh(): Promise<void> {
        await this.dataSource.refresh();
    }

    getTreeItem(element: CategoryItem | VideoItem): vscode.TreeItem {
        // Apply persisted collapsed/expanded state for any collapsible item
        if (element.id && element.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
            element.collapsibleState = CollapseStateStore.shared.isCollapsed(element.id)
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded;
        }
        return element;
    }

    async getChildren(element?: CategoryItem | VideoItem): Promise<(CategoryItem | VideoItem)[]> {
        if (this.dataSource.isRefreshing) {
            return [];
        }

        if (!element) {
            // Root level - show categories //

            const allCategory = new CategoryItem(
                `All Videos (${this.dataSource.videos.length})`,
                this.dataSource.videos,
                'category-all',
                new vscode.ThemeIcon('folder-library')
            );

            const hevcFlat = this.dataSource.allHevcVideos.map(v => v.asFlatItem());
            const hevcCategory = new CategoryItem(
                `HEVC (${hevcFlat.length})`,
                hevcFlat,
                'category-hevc',
                new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.green'))
            );

            const otherFlat = this.dataSource.allOtherVideos.map(v => v.asFlatItem());
            const otherCategory = new CategoryItem(
                `Non-HEVC (${otherFlat.length})`,
                otherFlat,
                'category-other',
                new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'))
            );

            return [allCategory, hevcCategory, otherCategory];
        } else if (element instanceof CategoryItem) {
            // Return videos in this category
            return element.items.length > 0 ? element.items : [this.createInfoItem(`No ${element.label} videos found`)];
        } else if (element instanceof VideoItem) {
            // Return the children of this video item (produced videos)
            return element.children;
        }

        return [];
    }

    // -------------------------------------------------------------------------
    // MARK: - Collapse state tracking

    /**
     * Called on every data refresh. On subsequent loads (not the first), any
     * item that just became collapsible for the first time this session is
     * removed from the collapsed store so it defaults to expanded (todo 2).
     */
    private _handleVideosChanged(): void {
        const newIds = this._collectCollapsibleIds(this.dataSource.videos);
        if (!this._firstLoad) {
            for (const id of newIds) {
                if (!this._knownCollapsibleIds.has(id)) {
                    CollapseStateStore.shared.setCollapsed(id, false);
                }
            }
        }
        this._firstLoad = false;
        this._knownCollapsibleIds = newIds;
    }

    private _collectCollapsibleIds(items: VideoItem[]): Set<string> {
        const ids = new Set<string>();
        const traverse = (list: VideoItem[]) => {
            for (const item of list) {
                if (item.id && item.children.length > 0) { ids.add(item.id); }
                traverse(item.children);
            }
        };
        traverse(items);
        return ids;
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
