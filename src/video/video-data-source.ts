//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett.
//

import * as vscode from 'vscode';
import * as path from 'path';
import { EventEmitter } from 'vscode';
import MP4 from '../mp4';
import VideoItem from './video-item';
import VideoInfo from '../cli/video-info';
import config from '../config';
import { Util } from '../util';
import { VideoStorage, VideoIdentity } from './video-storage';

export class VideoDataSource {
    public static readonly shared = new VideoDataSource();

    private _refreshPromise: Promise<void> | null = null;
    private _watcher: vscode.FileSystemWatcher | undefined;

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

    /** Root-level HEVC videos (no parent). Their children may also be HEVC. */
    public get hevcVideos(): VideoItem[] {
        return this.data.hevcVideos;
    }

    /** Root-level non-HEVC videos (no parent). Their children are typically HEVC. */
    public get otherVideos(): VideoItem[] {
        return this.data.otherVideos;
    }

    /** All HEVC videos across the entire hierarchy, sorted alphabetically */
    public get allHevcVideos(): VideoItem[] {
        return this.collectByCodec(this.data.videos, true);
    }

    /** All non-HEVC videos across the entire hierarchy, sorted alphabetically */
    public get allOtherVideos(): VideoItem[] {
        return this.collectByCodec(this.data.videos, false);
    }

    private collectByCodec(items: VideoItem[], isHEVC: boolean): VideoItem[] {
        const result: VideoItem[] = [];
        for (const item of items) {
            if (!!item.info?.isHEVC === isHEVC) { result.push(item); }
            if (item.children.length > 0) {
                result.push(...this.collectByCodec(item.children, isHEVC));
            }
        }
        return result.sort((a, b) => a.label.localeCompare(b.label));
    }

    public get isLoading(): boolean {
        return this.data.isLoading;
    }

    public isConverting(videoPath: string): boolean {
        return !!this.data.conversions.get(videoPath);
    }

    // -------------------------------------------------------------------------
    // MARK: - File watching

    /** Start watching workspace video files for creation/deletion so the tree updates instantly */
    private startWatcher(): void {
        this._watcher?.dispose();
        const extensionGlob = Util.toExtensionGlob(config.videoExtensions, false);
        this._watcher = vscode.workspace.createFileSystemWatcher(`**/*.${extensionGlob}`);
        const refresh = () => this.refresh();
        this._watcher.onDidCreate(refresh);
        this._watcher.onDidDelete(refresh);
        this._watcher.onDidChange(refresh);
    }

    // -------------------------------------------------------------------------
    // MARK: - Building VideoItems

    private makeVideoItem(uri: vscode.Uri): VideoItem {
        const filename = path.basename(uri.fsPath);
        const isConverting = this.data.conversions.get(uri.fsPath) || false;
        const isHEVC = MP4.isHEVC(uri.fsPath);
        const duration = MP4.getDuration(uri.fsPath);
        const info: VideoInfo = {
            codec: isHEVC ? 'hevc' : 'unknown',
            isHEVC,
            filename,
            duration,
        };
        return new VideoItem(uri, info, filename, isConverting);
    }

    // -------------------------------------------------------------------------
    // MARK: - Refresh

    private async _refresh() {
        this.data.isLoading = true;
        this.data.videos = [];
        this.data.hevcVideos = [];
        this.data.otherVideos = [];

        try {
            // 1. Scan workspace for all video files
            const excludeGlob = `{${this.excludedDirectories.join(',')}}/`;
            const videoExtensionGlob = Util.toExtensionGlob(config.videoExtensions, false);
            const videosGlob = `**/*.${videoExtensionGlob}`;
            const videoURIs = await vscode.workspace.findFiles(videosGlob, excludeGlob);

            // Build maps keyed by identity hash and by path for found files
            const foundByKey = new Map<string, VideoItem>();
            const foundByPath = new Map<string, VideoItem>();
            for (const uri of videoURIs) {
                const item = this.makeVideoItem(uri);
                foundByPath.set(uri.fsPath, item);
                const key = VideoIdentity.keyFor(uri.fsPath);
                if (key) { foundByKey.set(key, item); }
            }

            // 2. Use storage to attach children and build hierarchy
            const allRecords = VideoStorage.shared.getAllRecords();

            // Build a combined map of key → VideoItem (found + ghost items for missing files)
            const allItemsByKey = new Map<string, VideoItem>(foundByKey);

            // First pass: create ghost items for tracked-but-missing files
            for (const record of allRecords) {
                if (!allItemsByKey.has(record.key)) {
                    allItemsByKey.set(record.key, VideoItem.makeNotFound(record.path));
                }
            }

            // Second pass: attach children to parents using identity keys
            for (const record of allRecords) {
                if (record.parentKey === null) { continue; }
                const parent = allItemsByKey.get(record.parentKey);
                const child = allItemsByKey.get(record.key);
                if (parent && child) {
                    parent.children.push(child);
                }
            }

            // Third pass: update collapsible states now that children are set
            for (const item of allItemsByKey.values()) {
                item.updateCollapsibleState();
            }

            // 4. Determine root items
            const childKeys = new Set(
                allRecords
                    .filter(r => r.parentKey !== null)
                    .map(r => r.key)
            );

            const rootItems: VideoItem[] = [];
            for (const [key, item] of foundByKey) {
                if (!childKeys.has(key)) {
                    rootItems.push(item);
                }
            }
            // Include ghost roots that have children (so the subtree remains visible)
            for (const record of allRecords) {
                if (record.parentKey === null && !foundByKey.has(record.key)) {
                    const ghost = allItemsByKey.get(record.key);
                    if (ghost && ghost.children.length > 0) {
                        rootItems.push(ghost);
                    }
                }
            }

            // Sort alphabetically
            rootItems.sort((a, b) => a.label.localeCompare(b.label));

            this.data.videos = rootItems;
            this.data.hevcVideos = rootItems.filter(v => v.info?.isHEVC === true);
            this.data.otherVideos = rootItems.filter(v => !v.info?.isHEVC);

        } finally { }
    }

    public async refresh(): Promise<void> {
        if (this._refreshPromise) {
            return this._refreshPromise;
        }

        const start = Date.now();

        this._refreshPromise = this._refresh().then(async () => {
            const elapsed = Date.now() - start;
            if (elapsed < 100) {
                await new Promise(resolve => setTimeout(resolve, 100 - elapsed));
            }
        }).finally(() => {
            this._refreshPromise = null;
            this.data.isLoading = false;
            this.data.onDidChangeVideos.fire();
        });

        return this._refreshPromise;
    }

    /** Call once during extension activation to wire up the file watcher */
    public activate(): void {
        this.startWatcher();
    }

    public dispose(): void {
        this._watcher?.dispose();
    }
}
