//
//  videos-provider.ts
//  H26ify
//
//  Created by Tanner Bennett on 2023-08-23
//  Copyright © 2023 Tanner Bennett. All rights reserved.
//

import { TreeItem, Uri, workspace } from 'vscode';
import BaseListProvider, { PickableTreeItem } from './base-provider';

/** The list of all video files in the workspace */
export class VideosViewProvider extends BaseListProvider<PickableTreeItem> {
    protected contentKind = 'Videos';

    private excludedDirectories = [
        'external',
        'bazel-*',
        'node_modules',
        '.git',
        '.build',
        'build',
    ];

    public files: Uri[] | undefined = undefined;

    public get selectedFiles(): readonly TreeItem[] | undefined {
        return this.treeView?.selection;
    }

    protected reloadData = async () => {
        const excludeGlob = `{${this.excludedDirectories.join(',')}}/`;
        const videoExtensions = ['mp4', 'mov', 'avi', 'mkv'];
        const videosGlob = `**/*.{"${videoExtensions.join('","')}"}`;

        const videoURIs = await workspace.findFiles(videosGlob, excludeGlob);
        this.files = videoURIs;
        
        const items = this.files.map(this.fileToTreeItem);
        const sorted = items.sort((a, b) => (a.label as string).localeCompare(b.label as string));
        return sorted;
    }

    removeItem(item: PickableTreeItem): void {
        super.removeItem(item);
        this.files = this.files?.filter(f => f.path !== item.id);
    }

    private fileToTreeItem(file: Uri): PickableTreeItem {
        return {
            id: file.path,
            label: file.path.split('/').pop()!, // 'video.mp4'
            resourceUri: file,
            contextValue: 'video',
        };
    }
}
