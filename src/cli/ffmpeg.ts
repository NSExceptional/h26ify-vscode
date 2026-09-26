//
//  Created by GitHub Copilot on 2025-07-08.
//  Copyright © 2025 Tanner Bennett.
//

import { EnvironmentCmd } from './environment-cmd';
// import trash dynamically below where needed
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { spawnSync, spawn } from 'child_process';
import { Util } from '../util';

export type FFmpegOptions = {
    input: string;
    output: string;
    overwrite?: boolean;
    /** Quality factor (0-51, lower is better quality but larger file) */
    crf?: number;
    /** Adjust the resulting frame rate. */
    fps?: number;
    /** Whether to trash the old file. Takes precedence over delete */
    trash?: boolean;
    /** Whether to delete the old file. Ignored if trash is true */
    delete?: boolean;
    /** Trim the video to the given start/end times in seconds */
    trim?: { start: number; end: number };
    /** Crop the video to the given rectangle in pixels (at original resolution) */
    crop?: { x: number; y: number; width: number; height: number };
    /** Resize the output to the given dimensions; use -1 to preserve aspect ratio */
    resize?: { width: number; height: number };
}

class ffmpeg extends EnvironmentCmd {
    protected commandName = 'ffmpeg';
    protected expectedBinaryPath = { inPATH: 'ffmpeg' };

    static shared = new ffmpeg();

    private isAvailableCache: boolean | undefined = undefined;

    guardCanUseFFmpeg(): void {
        if (this.isAvailableCache === false) {
            throw new Error('ffmpeg is not available. Please install it and make sure it is in your PATH.');
        }
    }

    /**
     * Extract a representative thumbnail from the video and return it as a base64 data URL.
     * Returns undefined if ffmpeg is unavailable or the extraction fails.
     */
    extractThumbnail(inputPath: string, atSeconds = 3): string | undefined {
        const tmpFile = path.join(os.tmpdir(), `h26ify-thumb-${randomUUID()}.jpg`);
        try {
            const result = spawnSync(
                'ffmpeg',
                ['-y', '-i', inputPath, '-ss', String(atSeconds), '-frames:v', '1', '-vf', 'scale=800:-1', tmpFile],
                { stdio: ['ignore', 'ignore', 'ignore'] }
            );
            if (result.status !== 0 || !fs.existsSync(tmpFile)) {
                return undefined;
            }
            const data = fs.readFileSync(tmpFile);
            return `data:image/jpeg;base64,${data.toString('base64')}`;
        } catch {
            return undefined;
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    }

    /**
     * Extract a single frame at the given timestamp as a base64 data URL, asynchronously.
     * Uses input seeking (-ss before -i) for fast, non-blocking extraction. Resolves to
     * undefined if ffmpeg is unavailable or the extraction fails. Suitable for scrubbing.
     */
    extractFrame(inputPath: string, atSeconds = 0): Promise<string | undefined> {
        const tmpFile = path.join(os.tmpdir(), `h26ify-frame-${randomUUID()}.jpg`);
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value: string | undefined) => {
                if (settled) { return; }
                settled = true;
                try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
                resolve(value);
            };
            try {
                const proc = spawn(
                    'ffmpeg',
                    ['-y', '-ss', String(Math.max(0, atSeconds)), '-i', inputPath, '-frames:v', '1', '-vf', 'scale=800:-1', tmpFile],
                    { stdio: ['ignore', 'ignore', 'ignore'] }
                );
                proc.on('error', () => finish(undefined));
                proc.on('close', (code) => {
                    if (code === 0 && fs.existsSync(tmpFile)) {
                        try {
                            const data = fs.readFileSync(tmpFile);
                            finish(`data:image/jpeg;base64,${data.toString('base64')}`);
                        } catch {
                            finish(undefined);
                        }
                    } else {
                        finish(undefined);
                    }
                });
            } catch {
                finish(undefined);
            }
        });
    }

    /** Where browser-playable preview copies of videos are cached */
    readonly previewProxyDir = path.join(os.tmpdir(), 'h26ify-preview');

    /**
     * Create a browser-playable copy of a video for previewing in a webview.
     * `remux` copies the video stream into an MP4 container (near-instant, for
     * containers the webview can't open, like MKV); `transcode` re-encodes to a
     * 720p H.264 proxy (for codecs the webview can't decode).
     * Writes to a temp file first so a cancelled run never leaves a partial output.
     */
    makePreviewProxy(
        input: string, output: string, mode: 'remux' | 'transcode', isHEVC: boolean,
        cancellationToken?: vscode.CancellationToken
    ): Promise<void> {
        const tmp = `${output}.tmp.mp4`;
        const videoArgs = mode === 'remux'
            ? ['-c:v', 'copy', ...(isHEVC ? ['-tag:v', 'hvc1'] : [])]
            : ['-vf', "scale=-2:'min(720,trunc(ih/2)*2)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p'];
        const args = [
            '-y', '-v', 'error', '-i', input,
            '-map', '0:v:0', '-map', '0:a:0?',
            ...videoArgs,
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            tmp,
        ];

        fs.mkdirSync(path.dirname(output), { recursive: true });
        return new Promise((resolve, reject) => {
            const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = '';
            proc.stderr?.on('data', d => { stderr += d.toString(); });
            const cancelSub = cancellationToken?.onCancellationRequested(() => proc.kill('SIGKILL'));
            const fail = (message: string) => {
                try { fs.unlinkSync(tmp); } catch { /* ignore */ }
                reject(new Error(message));
            };
            proc.on('error', err => { cancelSub?.dispose(); fail(err.message); });
            proc.on('close', code => {
                cancelSub?.dispose();
                if (code === 0 && fs.existsSync(tmp)) {
                    fs.renameSync(tmp, output);
                    resolve();
                } else {
                    fail(stderr.trim().split('\n').pop() || `ffmpeg exited with code ${code}`);
                }
            });
        });
    }

    async transcode(options: FFmpegOptions, cancellationToken?: vscode.CancellationToken): Promise<string> {
        this.guardCanUseFFmpeg();

        this.oneTimeCancellationToken = cancellationToken;

        const isSameFile = Util.isSameFile(options.input, options.output);
        if (isSameFile) {
            throw new Error(`Input and output files cannot be the same: ${options.input}`);
        }

        // Build video filter chain (crop + resize)
        const vfFilters: string[] = [];
        if (options.crop) {
            const { width, height, x, y } = options.crop;
            vfFilters.push(`crop=${width}:${height}:${x}:${y}`);
        }
        if (options.resize) {
            const { width, height } = options.resize;
            vfFilters.push(`scale=${width}:${height}`);
        }
        const vfArg = vfFilters.length > 0 ? `-vf "${vfFilters.join(',')}"` : '';

        // Trim args go after -i for frame-accurate cutting
        const trimArgs = options.trim
            ? `-ss ${options.trim.start} -to ${options.trim.end}`
            : '';

        // Build conversion command with progress output
        const command = [
            options.overwrite ? '-y' : '',
            '-i', `'${options.input}'`,
            trimArgs,
            '-c:v', 'libx265',
            '-tag:v', 'hvc1',
            // Use CRF if specified, otherwise use bitrate 0 (auto)
            options.crf !== undefined ? `-crf ${options.crf}` : '-b:v 0',
            // Adjust frame rate if specified
            options.fps !== undefined ? `-r ${options.fps}` : '',
            vfArg,
            '-c:a', 'copy',
            '-progress', '-',
            `'${options.output}'`
        ].filter(Boolean).join(' ');

        // Run conversion using runCommand with terminal always revealed
        await this.runCommand(command, vscode.TaskRevealKind.Always);

        // Handle original file based on options (trash takes precedence over delete)
        if (options.trash) {
            // Move original file to trash using macOS/Windows/Linux trash APIs
            const trash = (await import('trash')).default;
            await trash([options.input]);
        } else if (options.delete) {
            // Delete file permanently
            await vscode.workspace.fs.delete(vscode.Uri.file(options.input));
        }
        // If neither trash nor delete, leave the file in place

        return options.output;
    }
}

export default ffmpeg.shared as ffmpeg;
