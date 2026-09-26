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
import { createHash, randomUUID } from 'crypto';
import VideoItem from '../video/video-item';
import ffmpeg, { FFmpegOptions } from '../cli/ffmpeg';
import ffprobe from '../cli/ffprobe';
import { EditPreset, EditPresetStorage } from '../video/edit-preset';
import { VideoStorage } from '../video/video-storage';
import config from '../config';
import { Util } from '../util';

interface VideoMeta {
    path: string;
    filename: string;
    width: number;
    height: number;
    duration: number;
    /** Webview URI for playing the original file directly */
    src?: string;
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
    | { type: 'requestPreviewProxy'; reqId: number; path: string; mode: 'remux' | 'transcode' }
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
    /** Cancels in-flight preview proxy encodes when the panel closes */
    private readonly work = new vscode.CancellationTokenSource();

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
                    vscode.Uri.file(ffmpeg.previewProxyDir),
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
                }
            } catch { /* keep existing values */ }
        }));

        for (const v of this.videos) {
            v.src = this.panel.webview.asWebviewUri(vscode.Uri.file(v.path)).toString();
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

            case 'requestPreviewProxy': {
                if (!this.ownsPath(msg.path)) { break; }
                let src: string | undefined, error: string | undefined;
                try {
                    const proxy = await this.previewProxy(msg.path, msg.mode);
                    src = this.panel.webview.asWebviewUri(vscode.Uri.file(proxy)).toString();
                } catch (e) {
                    error = e instanceof Error ? e.message : String(e);
                }
                this.post({ type: 'previewProxy', reqId: msg.reqId, src, error });
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

    /** Returns a cached browser-playable copy of a video, creating it if needed */
    private async previewProxy(filePath: string, mode: 'remux' | 'transcode'): Promise<string> {
        const stat = fs.statSync(filePath);
        const key = createHash('sha1').update(`${filePath}|${stat.size}|${stat.mtimeMs}|${mode}`).digest('hex');
        const output = path.join(ffmpeg.previewProxyDir, `${key}.mp4`);
        if (fs.existsSync(output)) {
            return output;
        }

        const info = await ffprobe.getVideoInfo(filePath).catch(() => null);
        await ffmpeg.makePreviewProxy(filePath, output, mode, !!info?.isHEVC, this.work.token);
        return output;
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
