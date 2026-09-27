/*
 * edit-panel.ts
 * H26ify
 *
 * Created by Tanner Bennett on 2026-05-05
 * Copyright © 2026 Tanner Bennett.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import VideoItem from '../video/video-item';
import ffmpeg, { FFmpegOptions, PreviewKind } from '../cli/ffmpeg';
import ffprobe from '../cli/ffprobe';
import { EditPreset, EditPresetStorage } from '../video/edit-preset';
import { VideoStorage } from '../video/video-storage';
import { PreviewCache } from '../video/preview-cache';
import { MediaServer } from './media-server';
import config from '../config';
import { Util } from '../util';

interface VideoMeta {
    path: string;
    filename: string;
    width: number;
    height: number;
    duration: number;
    /** URL for playing the original file directly (served over localhost with range support) */
    src?: string;
    /** Fallback for `src` via VS Code's own resource loading, which is slow for large files */
    resourceSrc?: string;
    /** Codec of the first audio stream, if any; decides whether the webview can play it as-is */
    audioCodec?: string;
    isHEVC?: boolean;
}

interface VideoCrop {
    path: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

// Messages from the webview to the extension
type WebviewMessage =
    | { type: 'apply'; trim?: { start: number; end: number }; crops?: VideoCrop[]; resize?: { width: number; height: number } }
    | { type: 'requestFrame'; reqId: number; path: string; atSeconds: number }
    | { type: 'requestPreviewMedia'; reqId: number; path: string; kind: PreviewKind }
    | { type: 'savePreset'; preset: EditPreset }
    | { type: 'deletePreset'; name: string }
    | { type: 'cancel' };

export class EditPanel {
    private static readonly viewType = 'h26ify.editPanel';

    private panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private videos: VideoMeta[];
    private readonly isBatch: boolean;
    private disposed = false;
    /** Cancels in-flight preview encodes when the panel closes */
    private readonly work = new vscode.CancellationTokenSource();
    /** Preview files this panel is using, so the cache won't evict them */
    private readonly retained = new Set<string>();
    /** Media server tokens for the files this panel plays */
    private readonly servedTokens: string[] = [];

    static open(
        context: vscode.ExtensionContext,
        items: VideoItem | VideoItem[]
    ): EditPanel {
        const itemsArr = Array.isArray(items) ? items : [items];
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        const title = itemsArr.length === 1 ? `Edit: ${itemsArr[0].label}` : `Edit ${itemsArr.length} Videos`;

        const panel = vscode.window.createWebviewPanel(
            EditPanel.viewType,
            title,
            column,
            {
                enableScripts: true,
                // The trim preview plays the videos themselves, or a cached proxy copy
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    ...[...new Set(itemsArr.map(i => path.dirname(i.uri.fsPath)))].map(d => vscode.Uri.file(d)),
                    vscode.Uri.file(PreviewCache.shared.dir),
                ],
                retainContextWhenHidden: true,
            }
        );
        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');

        return new EditPanel(panel, context.extensionUri, itemsArr);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, items: VideoItem[]) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.isBatch = items.length > 1;
        this.videos = items.map(i => ({
            path: i.uri.fsPath,
            filename: i.label,
            width: i.info?.width ?? 1920,
            height: i.info?.height ?? 1080,
            duration: i.info?.duration ?? 0,
        }));

        this.panel.webview.html = this.buildHtml();
        this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg as WebviewMessage));
        this.panel.onDidDispose(() => {
            this.disposed = true;
            this.work.cancel();
            this.work.dispose();
            this.retained.forEach(f => PreviewCache.shared.release(f));
            this.servedTokens.forEach(t => MediaServer.shared.revoke(t));
            PreviewCache.shared.enforceLimit();
        });

        // Send init data asynchronously after the panel is shown
        this.sendInit();
    }

    private buildHtml(): string {
        const nonce = randomUUID().replace(/-/g, '');
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'edit-panel.html');
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
        html = html.replace(/\{\{NONCE\}\}/g, nonce);
        html = html.replace(/\{\{CSP_SOURCE\}\}/g, this.panel.webview.cspSource);
        return html;
    }

    private async sendInit() {
        const presets = EditPresetStorage.shared.getAll();

        // Refine each video's dimensions/duration via ffprobe (best effort, in parallel).
        // These feed the per-video crop geometry, so accuracy matters across mixed resolutions.
        await Promise.all(this.videos.map(async (v) => {
            try {
                const info = await ffprobe.getVideoInfo(v.path);
                if (info) {
                    v.width = info.width ?? v.width;
                    v.height = info.height ?? v.height;
                    v.duration = info.duration ?? v.duration;
                    v.audioCodec = info.audioCodec;
                    v.isHEVC = info.isHEVC;
                }
            } catch { /* keep existing values */ }
        }));

        for (const v of this.videos) {
            Object.assign(v, await this.playableSources(v.path));
        }

        const first = this.videos[0];
        const resolutionsMatch = this.videos.every(v => v.width === first.width && v.height === first.height);

        this.post({
            type: 'init',
            isBatch: this.isBatch,
            videos: this.videos,
            resolutionsMatch,
            presets,
        });
    }

    private async handleMessage(msg: WebviewMessage) {
        switch (msg.type) {
            case 'cancel':
                this.panel.dispose();
                break;

            case 'savePreset':
                await EditPresetStorage.shared.save(msg.preset);
                break;

            case 'deletePreset':
                await EditPresetStorage.shared.delete(msg.name);
                break;

            case 'requestFrame': {
                if (!this.ownsPath(msg.path)) { break; }
                const dataUri = await ffmpeg.extractFrame(msg.path, msg.atSeconds);
                this.post({ type: 'frame', reqId: msg.reqId, dataUri });
                break;
            }

            case 'requestPreviewMedia': {
                const meta = this.videos.find(v => v.path === msg.path);
                if (!meta) { break; }
                let sources: { src?: string; resourceSrc?: string } = {}, error: string | undefined;
                try {
                    const file = await this.previewMedia(meta, msg.kind, fraction => {
                        this.post({ type: 'previewProgress', reqId: msg.reqId, fraction });
                    });
                    sources = await this.playableSources(file);
                } catch (e) {
                    error = e instanceof Error ? e.message : String(e);
                }
                this.post({ type: 'previewMedia', reqId: msg.reqId, ...sources, error });
                break;
            }

            case 'apply':
                await this.applyEdits(msg.trim, msg.crops, msg.resize);
                break;
        }
    }

    /** Only act on files this panel was opened for; the webview shouldn't reach arbitrary paths */
    private ownsPath(filePath: string): boolean {
        return this.videos.some(v => v.path === filePath);
    }

    private post(message: unknown) {
        if (!this.disposed) {
            this.panel.webview.postMessage(message);
        }
    }

    /**
     * URLs the webview can play a file from: the local media server first (fast, with range
     * requests), then VS Code's resource loading in case localhost is unreachable (e.g. remote).
     */
    private async playableSources(file: string): Promise<{ src?: string; resourceSrc: string }> {
        const resourceSrc = this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
        try {
            const { url, token } = await MediaServer.shared.serve(file);
            this.servedTokens.push(token);
            return { src: url, resourceSrc };
        } catch {
            return { resourceSrc };
        }
    }

    /** Returns a cached file the webview can play for the trim preview, creating it if needed */
    private async previewMedia(meta: VideoMeta, kind: PreviewKind, onProgress: (fraction: number) => void): Promise<string> {
        const cache = PreviewCache.shared;
        const file = cache.fileFor(meta.path, kind, kind === 'audio' ? ffmpeg.previewAudioExtension() : 'mp4');

        if (fs.existsSync(file)) {
            cache.touch(file);
        } else {
            // A video copy is about as large as the original, so make sure it fits with room to spare
            if (kind !== 'audio' && cache.freeBytes() < fs.statSync(meta.path).size + 2 * 1024 ** 3) {
                throw new Error('not enough free disk space to make a preview copy of this video');
            }
            await ffmpeg.makePreviewMedia(meta.path, file, kind, {
                isHEVC: meta.isHEVC,
                duration: meta.duration,
                onProgress,
                cancellationToken: this.work.token,
            });
        }

        if (!this.retained.has(file)) {
            this.retained.add(file);
            cache.retain(file);
        }
        cache.enforceLimit();
        return file;
    }

    private async applyEdits(
        trim?: { start: number; end: number },
        crops?: VideoCrop[],
        resize?: { width: number; height: number }
    ) {
        const hasCrop = !!crops && crops.length > 0;
        if (!trim && !hasCrop && !resize) {
            vscode.window.showInformationMessage('No operations selected.');
            return;
        }

        // In batch mode, skip trim if video durations differ by more than 1s
        const effectiveTrim = this.isBatch ? this.batchTrimIfAllowed(trim) : trim;

        const targetVideos = this.videos;
        this.panel.dispose();

        await Util.withProgressNotif(`Editing ${targetVideos.length === 1 ? targetVideos[0].filename : `${targetVideos.length} videos`}…`, async (cancelToken) => {
            for (const meta of targetVideos) {
                if (cancelToken.isCancellationRequested) { break; }

                const output = Util.filenameFromTemplate(meta.path, 'edited', config.outputNamePattern);

                // The webview computed a per-video crop rect (already mapped through the
                // chosen crop mode and clamped to this video's dimensions).
                const crop = crops?.find(c => c.path === meta.path);

                const options: FFmpegOptions = {
                    input: meta.path,
                    output,
                    overwrite: true,
                    trim: effectiveTrim,
                    crop: crop ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : undefined,
                    resize: resize ? { width: resize.width, height: resize.height } : undefined,
                };

                await ffmpeg.transcode(options, cancelToken);
                await VideoStorage.shared.recordProducedVideo(output, meta.path);
            }
        });
    }

    /** Returns the trim range only if all batch videos have matching durations (within 1s), else undefined */
    private batchTrimIfAllowed(trim?: { start: number; end: number }): { start: number; end: number } | undefined {
        if (!trim) { return undefined; }
        const durations = this.videos.map(v => v.duration);
        const allMatch = Math.max(...durations) - Math.min(...durations) <= 1;
        return allMatch ? trim : undefined;
    }
}
