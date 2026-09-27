/*
 * preview-cache.ts
 * H26ify
 *
 * Created by Tanner Bennett on 2026-09-27
 * Copyright © 2026 Tanner Bennett.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import config from '../config';

/** Files touched this recently may be in use by a panel in another window; don't evict them */
const kRecentlyUsedMs = 5 * 60 * 1000;
/** Partial files this old were abandoned by a crash, not being written by another window */
const kAbandonedTmpMs = 24 * 60 * 60 * 1000;

interface CacheEntry {
    file: string;
    size: number;
    mtimeMs: number;
}

/**
 * Browser-playable files for the edit panel's trim preview: extracted audio tracks and
 * copies of videos the webview can't play directly. Files are keyed by their source and
 * reused. The cache is capped at a configurable size (least-recently-used files go first),
 * files unused for a week are pruned, and files an open panel is using are never deleted.
 */
export class PreviewCache {
    static shared = new PreviewCache();

    readonly dir = path.join(os.tmpdir(), 'h26ify-preview');

    /** Reference counts of files open panels are using */
    private readonly inUse = new Map<string, number>();

    /** The cache path for a preview of `source`; changes whenever the source file does */
    fileFor(source: string, kind: string, ext: string): string {
        const stat = fs.statSync(source);
        const key = createHash('sha1').update(`v3|${source}|${stat.size}|${stat.mtimeMs}|${kind}`).digest('hex');
        return path.join(this.dir, `${key}.${ext}`);
    }

    /** Record a use, so least-recently-used eviction keeps it longer */
    touch(file: string) {
        const now = new Date();
        try { fs.utimesSync(file, now, now); } catch { /* ignore */ }
    }

    retain(file: string) {
        this.inUse.set(file, (this.inUse.get(file) ?? 0) + 1);
    }

    release(file: string) {
        const count = (this.inUse.get(file) ?? 1) - 1;
        if (count > 0) {
            this.inUse.set(file, count);
        } else {
            this.inUse.delete(file);
        }
    }

    /** Free space on the cache's volume, in bytes */
    freeBytes(): number {
        fs.mkdirSync(this.dir, { recursive: true });
        const stats = fs.statfsSync(this.dir);
        return stats.bavail * stats.bsize;
    }

    /** Deletes least-recently-used files until the cache fits within the configured limit */
    enforceLimit() {
        const limit = config.previewCacheLimitGB * 1024 ** 3;
        const entries = this.entries().filter(e => !isPartial(e.file)).sort((a, b) => a.mtimeMs - b.mtimeMs);
        let total = entries.reduce((sum, e) => sum + e.size, 0);

        for (const entry of entries) {
            if (total <= limit) {
                break;
            }
            if (this.isProtected(entry)) {
                continue;
            }
            if (remove(entry.file)) {
                total -= entry.size;
            }
        }
    }

    /** Run at startup: drop previews unused for `maxAgeDays` and partial files left by a crash */
    prune(maxAgeDays = 7) {
        const now = Date.now();
        for (const entry of this.entries()) {
            const age = now - entry.mtimeMs;
            if (isPartial(entry.file) ? age > kAbandonedTmpMs : age > maxAgeDays * 24 * 60 * 60 * 1000) {
                remove(entry.file);
            }
        }
        this.enforceLimit();
    }

    /** Deletes every finished preview that no open panel is using */
    clear(): { files: number; bytes: number } {
        let files = 0, bytes = 0;
        for (const entry of this.entries()) {
            if (isPartial(entry.file) || this.inUse.has(entry.file)) {
                continue;
            }
            if (remove(entry.file)) {
                files++;
                bytes += entry.size;
            }
        }
        return { files, bytes };
    }

    private isProtected(entry: CacheEntry): boolean {
        return this.inUse.has(entry.file) || Date.now() - entry.mtimeMs < kRecentlyUsedMs;
    }

    private entries(): CacheEntry[] {
        let names: string[];
        try {
            names = fs.readdirSync(this.dir);
        } catch {
            return [];
        }

        const entries: CacheEntry[] = [];
        for (const name of names) {
            const file = path.join(this.dir, name);
            try {
                const stat = fs.statSync(file);
                entries.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
            } catch { /* deleted meanwhile */ }
        }
        return entries;
    }
}

/** Files ffmpeg is still writing (or abandoned mid-write) */
function isPartial(file: string): boolean {
    return path.basename(file).includes('.tmp.');
}

function remove(file: string): boolean {
    try {
        fs.unlinkSync(file);
        return true;
    } catch {
        return false;
    }
}
