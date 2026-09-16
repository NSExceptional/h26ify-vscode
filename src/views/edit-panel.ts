/*
 * edit-panel.ts
 * H26ify
 *
 * Created by Tanner Bennett on 2026-05-05
 * Copyright © 2026 Tanner Bennett. All rights reserved.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
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
    | { type: 'savePreset'; preset: EditPreset }
    | { type: 'deletePreset'; name: string }
    | { type: 'cancel' };

export class EditPanel {
    private static readonly viewType = 'h26ify.editPanel';

    private panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private videos: VideoMeta[];
    private readonly isBatch: boolean;

    static open(
        context: vscode.ExtensionContext,
        items: VideoItem | VideoItem[]
    ): EditPanel {        const itemsArr = Array.isArray(items) ? items : [items];
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        const title = itemsArr.length === 1 ? `Edit: ${itemsArr[0].label}` : `Edit ${itemsArr.length} Videos`;

        const panel = vscode.window.createWebviewPanel(
            EditPanel.viewType,
            title,
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
                retainContextWhenHidden: true,
            }
        );

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

        // Send init data asynchronously after the panel is shown
        this.sendInit();
    }

    private buildHtml(): string {
        const nonce = randomUUID().replace(/-/g, '');
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'edit-panel.html');
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
        html = html.replace(/\{\{NONCE\}\}/g, nonce);
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

        const first = this.videos[0];
        const resolutionsMatch = this.videos.every(v => v.width === first.width && v.height === first.height);

        this.panel.webview.postMessage({
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
                const dataUri = await ffmpeg.extractFrame(msg.path, msg.atSeconds);
                this.panel.webview.postMessage({ type: 'frame', reqId: msg.reqId, dataUri });
                break;
            }

            case 'apply':
                await this.applyEdits(msg.trim, msg.crops, msg.resize);
                break;
        }
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
