/*
 * transcode-task.ts
 * H26ify
 *
 * Created by Tanner Bennett on 2025-09-01
 * Copyright © 2025 Tanner Bennett.
 */

import { CancellationToken } from 'vscode';
import VideoItem from './video-item';
import ffmpeg, { FFmpegOptions } from '../cli/ffmpeg';
import config from '../config';
import { VideoStorage } from './video-storage';

export interface Identifiable {
    id: string;
};

export class TranscodeTask implements Identifiable {
    id: string;
    name: string;
    operation: 'transcode' | 'recode';
    work: (cancelToken: CancellationToken) => Promise<void>;

    constructor(
        videoItem: VideoItem,
        public outputPath: string,
        operation: 'transcode' | 'recode',
        crf?: number,
        fps?: number,
    ) {
        this.id = videoItem.uri.fsPath,
        this.name = videoItem.label,
        this.operation = operation;
        this.work = async (cancelToken: CancellationToken) => {
            const options: FFmpegOptions = {
                input: videoItem.uri.fsPath,
                output: outputPath,
                crf, fps,
                overwrite: true,
                trash: config.originalFileHandling === 'trash',
                delete: config.originalFileHandling === 'delete',
            };

            await ffmpeg.transcode(options, cancelToken);

            // Record the parent-child relationship in workspace storage
            await VideoStorage.shared.recordProducedVideo(outputPath, videoItem.uri.fsPath);
        };
    }
}
