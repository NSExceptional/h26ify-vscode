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

/** What the trim preview needs made playable; see `makePreviewMedia` */
export type PreviewKind = 'audio' | 'remux' | 'transcode';

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

    private encoders: string | undefined;

    /** Whether this ffmpeg build includes the given encoder (e.g. `libmp3lame`) */
    hasEncoder(name: string): boolean {
        if (this.encoders === undefined) {
            const result = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
            this.encoders = result.stdout ?? '';
        }
        return new RegExp(`\\s${name}\\s`).test(this.encoders);
    }

    /** The audio format preview tracks use: MP3, or FLAC if this ffmpeg build lacks libmp3lame */
    previewAudioExtension(): 'mp3' | 'flac' {
        return this.hasEncoder('libmp3lame') ? 'mp3' : 'flac';
    }

    /**
     * Create a file the edit panel's webview can play for the trim preview:
     * - `audio`: the first audio track as stereo MP3 (or FLAC). VS Code's webview can't
     *   decode AAC, the audio in most MP4/MOVs, so it plays this alongside the video.
     * - `remux`: the video stream copied into MP4, without audio (for containers the
     *   webview can't open, like MKV).
     * - `transcode`: a 720p H.264 copy, without audio (for video it can't decode).
     * Writes to a temp file first so a cancelled or failed run never leaves a partial output.
     */
    makePreviewMedia(
        input: string, output: string, kind: PreviewKind,
        options: {
            isHEVC?: boolean;
            /** Codec of the source's video stream */
            codec?: string;
            /** Source duration in seconds, used to report progress */
            duration?: number;
            onProgress?: (fraction: number) => void;
            cancellationToken?: vscode.CancellationToken;
        } = {}
    ): Promise<void> {
        const ext = path.extname(output);
        const tmp = `${output}.tmp${ext}`;
        const kindArgs = {
            audio: this.previewAudioExtension() === 'mp3'
                ? ['-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', '-compression_level', '9']
                : ['-map', '0:a:0', '-vn', '-c:a', 'flac', '-ac', '2'],
            remux: ['-map', '0:v:0', '-an', '-c:v', 'copy', ...(options.isHEVC ? ['-tag:v', 'hvc1'] : [])],
            // Constant frame rate fills gaps left by dropped (damaged) frames with the last good
            // frame, so the preview's timeline still lines up with the original and its audio
            transcode: ['-map', '0:v:0', '-an', '-vf', "scale=-2:'min(720,trunc(ih/2)*2)'", '-fps_mode', 'cfr', '-r', '30',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p'],
        }[kind];
        // Damaged AV1 (e.g. a recording that was cut off and repaired) otherwise decodes to frames
        // with garbage color metadata, which aborts the whole conversion; strict decoding drops them
        const inputArgs = kind === 'transcode' && options.codec === 'av1' ? ['-strict', 'strict'] : [];
        const args = ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', ...inputArgs, '-i', input, ...kindArgs, tmp];

        fs.mkdirSync(path.dirname(output), { recursive: true });
        return new Promise((resolve, reject) => {
            const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            proc.stderr?.on('data', d => { stderr += d.toString(); });

            // -progress reports lines like `out_time_us=12345678`
            proc.stdout?.on('data', d => {
                const matches = [...d.toString().matchAll(/out_time_us=(\d+)/g)];
                const last = matches.pop();
                if (last && options.onProgress && options.duration) {
                    options.onProgress(Math.min(1, Number(last[1]) / 1e6 / options.duration));
                }
            });

            const cancelSub = options.cancellationToken?.onCancellationRequested(() => proc.kill('SIGKILL'));
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
