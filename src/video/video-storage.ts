/*
 * video-storage.ts
 * H26ify
 *
 * Created by Tanner Bennett on 2026-05-05
 * Copyright © 2026 Tanner Bennett.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const kStorageKey = 'h26ify.videoRegistry';

// ---------------------------------------------------------------------------
// MARK: - VideoIdentity

/**
 * Computes a stable identity key for a video file.
 *
 * The key is a SHA-256 hash of the workspace-relative path (normalised for
 * case-insensitivity on HFS+/NTFS/similar) combined with the file's byte
 * size and mtime (seconds). This means:
 *
 * - A deleted file that is later replaced by a different file with the same
 *   name gets a different key because its mtime and/or size will differ.
 * - Renaming a file changes its relative path, giving it a new key; renaming
 *   back restores the original key so the record is immediately re-linked.
 * - On case-insensitive filesystems, `video.MOV` and `video.mov` hash to the
 *   same key because the relative path is lowercased before hashing.
 */
export class VideoIdentity {
    private static _caseSensitive: boolean | undefined = undefined;

    /** Detect whether the workspace filesystem is case-sensitive (cached). */
    static get isCaseSensitive(): boolean {
        if (this._caseSensitive !== undefined) { return this._caseSensitive; }

        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { return (this._caseSensitive = true); }

        // Toggle the case of the first alphabetic character and try to stat.
        const toggled = root.replace(/[a-zA-Z]/, c =>
            c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()
        );

        if (toggled === root) { return (this._caseSensitive = true); }

        try {
            fs.statSync(toggled);
            return (this._caseSensitive = false); // both paths accessible → case-insensitive
        } catch {
            return (this._caseSensitive = true);  // only original accessible → case-sensitive
        }
    }

    /**
     * Returns the workspace-relative path, lowercased when on a
     * case-insensitive filesystem so paths that differ only in case
     * are treated as identical.
     */
    static normalizeRelPath(filePath: string): string {
        const folders = vscode.workspace.workspaceFolders;
        let relPath = filePath;
        if (folders && folders.length > 0) {
            const root = folders[0].uri.fsPath;
            if (filePath.startsWith(root)) {
                relPath = filePath.slice(root.length).replace(/^[\\/]/, '');
            }
        }
        return this.isCaseSensitive ? relPath : relPath.toLowerCase();
    }

    /**
     * Computes the stable identity key for the given file.
     * Returns `undefined` if the file cannot be stat'd (e.g. it no longer exists).
     */
    static keyFor(filePath: string): string | undefined {
        try {
            const stat = fs.statSync(filePath);
            const relPath = this.normalizeRelPath(filePath);
            const mtimeSec = Math.floor(stat.mtimeMs / 1000);
            return createHash('sha256')
                .update(`${relPath}\0${stat.size}\0${mtimeSec}`)
                .digest('hex');
        } catch {
            return undefined;
        }
    }
}

// ---------------------------------------------------------------------------
// MARK: - VideoRecord

/** A record stored in workspace state describing a video known to the extension */
export interface VideoRecord {
    /** The stable identity key for this record */
    key: string;
    /** Absolute path to the video file at the time it was last seen */
    path: string;
    /** Identity key of the source video that produced this one, or null for root videos */
    parentKey: string | null;
}

// ---------------------------------------------------------------------------
// MARK: - VideoStorage

/** Manages persistent workspace-scoped storage of video parent-child relationships */
export class VideoStorage {
    public static shared: VideoStorage = new VideoStorage();

    private context: vscode.ExtensionContext | undefined;

    /** Must be called once during extension activation before any other use */
    public initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        // Reset the case-sensitivity cache on each activation (workspace may change)
        VideoIdentity['_caseSensitive'] = undefined;
    }

    private get state(): vscode.Memento {
        if (!this.context) {
            throw new Error('VideoStorage has not been initialized with an ExtensionContext');
        }
        return this.context.workspaceState;
    }

    private getRegistry(): Map<string, VideoRecord> {
        const raw = this.state.get<[string, VideoRecord][]>(kStorageKey, []);
        return new Map(raw);
    }

    private async saveRegistry(registry: Map<string, VideoRecord>): Promise<void> {
        await this.state.update(kStorageKey, Array.from(registry.entries()));
    }

    /**
     * Record that `outputPath` was produced from `sourcePath`.
     * Both files must exist at the time of the call so their keys can be computed.
     */
    public async recordProducedVideo(outputPath: string, sourcePath: string): Promise<void> {
        const outputKey = VideoIdentity.keyFor(outputPath);
        const sourceKey = VideoIdentity.keyFor(sourcePath);
        if (!outputKey || !sourceKey) { return; }

        const registry = this.getRegistry();

        // Ensure the source has a root record if not already tracked
        if (!registry.has(sourceKey)) {
            registry.set(sourceKey, { key: sourceKey, path: sourcePath, parentKey: null });
        }

        registry.set(outputKey, { key: outputKey, path: outputPath, parentKey: sourceKey });
        await this.saveRegistry(registry);
    }

    /** Returns all stored records */
    public getAllRecords(): VideoRecord[] {
        return Array.from(this.getRegistry().values());
    }
}

