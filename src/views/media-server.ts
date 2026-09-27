/*
 * media-server.ts
 * H26ify
 *
 * Created by Tanner Bennett on 2026-09-27
 * Copyright © 2026 Tanner Bennett.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';

const kContentTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
};

/**
 * Serves videos to the edit panel's webview over localhost, with real HTTP range support.
 *
 * VS Code's own webview resource loading streams a file from its start, so showing the first
 * frame of a large recording (whose index is usually at the end) or seeking in it took seconds
 * to minutes. With range requests it takes milliseconds. Only files an open panel registered
 * are served, each under an unguessable token, and only on the loopback interface.
 */
export class MediaServer {
    static shared = new MediaServer();

    private server: http.Server | undefined;
    private port: Promise<number> | undefined;
    /** token → file path */
    private readonly files = new Map<string, string>();

    /** Registers a file and returns the URL to play it from, plus the token that revokes it */
    async serve(file: string): Promise<{ url: string; token: string }> {
        const port = await this.start();
        const token = randomUUID();
        this.files.set(token, file);
        return { url: `http://127.0.0.1:${port}/${token}/${encodeURIComponent(path.basename(file))}`, token };
    }

    revoke(token: string) {
        this.files.delete(token);
    }

    close() {
        this.server?.close();
        this.server = undefined;
        this.port = undefined;
    }

    private start(): Promise<number> {
        if (!this.port) {
            this.port = new Promise((resolve, reject) => {
                const server = http.createServer((req, res) => this.handle(req, res));
                server.on('error', err => {
                    this.port = undefined;
                    reject(err);
                });
                server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
                this.server = server;
            });
        }
        return this.port;
    }

    private handle(req: http.IncomingMessage, res: http.ServerResponse) {
        const token = (req.url ?? '').split('/')[1];
        const file = this.files.get(token);
        if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
            res.writeHead(404).end();
            return;
        }

        let size: number;
        try {
            size = fs.statSync(file).size;
        } catch {
            res.writeHead(404).end();
            return;
        }

        const headers: http.OutgoingHttpHeaders = {
            'Accept-Ranges': 'bytes',
            'Content-Type': kContentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
        };

        // Byte ranges: `bytes=start-`, `bytes=start-end`, or the last N bytes (`bytes=-N`)
        let start = 0, end = size - 1, status = 200;
        if (req.headers.range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (match && match[1]) {
                start = Number(match[1]);
                if (match[2]) {
                    end = Math.min(Number(match[2]), size - 1);
                }
            } else if (match && match[2]) {
                start = Math.max(0, size - Number(match[2]));
            }
            if (!match || (!match[1] && !match[2]) || start > end) {
                res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
                return;
            }
            status = 206;
            headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        }

        headers['Content-Length'] = String(Math.max(0, end - start + 1));
        res.writeHead(status, headers);
        if (req.method === 'HEAD' || size === 0) {
            res.end();
            return;
        }

        const stream = fs.createReadStream(file, { start, end });
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    }
}
