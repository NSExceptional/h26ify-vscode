/*
 * task-manager.ts
 * H26ify
 *
 * Created by Tanner Bennett on 2025-07-15
 * Copyright © 2025 Tanner Bennett. All rights reserved.
 */

import * as vscode from 'vscode';
import { CancellationToken } from 'vscode';
import { Progress, Util } from '../util';

interface Identifiable {
    id: string;
};

export interface TranscodeTask extends Identifiable {
    name: string;
    operation: 'transcode' | 'recode';
    work: (cancelToken: CancellationToken) => Promise<void>;
};

type OperationProgress = {
    /** The sum of the reported progress */
    reported: number;
    /** The number of tasks involved in the reported progress */
    totalTasksSofar: number
    /** The underlying VS Code progress model */
    progress: Progress | undefined;
};

export class MutableIterableQueue<T extends Identifiable> implements Iterable<T> {
    private itemIDs: Set<string> = new Set();
    private items: T[] = [];

    private filterQueued(items: T | T[]): { remaining: T[], skipped: T[] } {
        if (Array.isArray(items)) {
            // Find any tasks that are already in the queue
            // and collect them into a separate list to return
            const inQueue = items.filter(e => this.itemIDs.has(e.id));
            // Filter the original list
            items = items.filter(e => !this.itemIDs.has(e.id));

            return { remaining: items, skipped: inQueue };
        }

        // If it's a single item, just check if it's in the queue
        if (this.itemIDs.has(items.id)) {
            return { remaining: [], skipped: [items] };
        } else {
            return { remaining: [items], skipped: [] };
        }
    }

    /** Removes the first element from the queue and returns it, or undefined if the queue is empty */
    shift(): T | undefined {
        if (this.items.length) {
            const item = this.items.shift()!;
            this.itemIDs.delete(item.id);
            return item;
        }

        return undefined;
    }

    /** @returns any elements that were already in the queue */
    enqueue(items: T | T[]): { added: T[], skipped: T[] } {
        const { remaining, skipped } = this.filterQueued(items);

        remaining.map(e => e.id).forEach(id => this.itemIDs.add(id));
        this.items.push(...remaining);
        return { added: remaining, skipped };
    }

    /** Iterating over the queue removes items from the queue until it is empty */
    [Symbol.iterator](): Iterator<T> {
        return {
            next: () => {
                const next = this.shift();
                if (next) {
                    return { value: next, done: false };
                }
                return { value: undefined, done: true };
            }
        };
    }

    get length() {
        return this.itemIDs.size;
    }
}

export default class TranscodeTaskManager {
    private tasks: MutableIterableQueue<TranscodeTask> = new MutableIterableQueue();
    /**
     * Represents the clearing of one entire task queue.
     * Once you start a task, that starts an operation, and any tasks added
     * to that operation before it completes become part of that operation.
     */
    private operation: Promise<void> | undefined = undefined;
    /** The total number of completed tasks during this run */
    private completedCount = 0;
    /** The current progress of the ongoing run */
    private activeProgress: OperationProgress = {
        reported: 0,
        totalTasksSofar: 0,
        progress: undefined
    };

    /** Total tasks so far, including incomplete */
    public get count(): number {
        return this.activeProgress.totalTasksSofar;
    }

    /** Number of incomplete tasks */
    public get remaining(): number {
        return this.tasks.length;
    }

    public get isRunning(): boolean {
        return this.operation !== undefined;
    }

    private get progressMessage(): string {
        return `${this.completedCount} of ${this.count}`;
    }

    /** Update the progress notification to account for completed or added tasks */
    private updateProgress(options: { dequeued: number } | { enqueued: number }) {
        if ('dequeued' in options) {
            this.completedCount += options.dequeued;

            // Increment progress by the number of tasks dequeued
            const increment = options.dequeued * (100 / this.count);
            this.activeProgress.reported += increment;
            this.activeProgress.progress?.report({
                increment,
                message: `(${this.progressMessage}) Transcoding…`
            });
        } else {
            // Reset the progress to 0%
            this.activeProgress.progress?.report({
                increment: -this.activeProgress.reported,
            });

            // Increase totalTasksSofar, recalculate the reported count, and update the progress
            this.activeProgress.totalTasksSofar += options.enqueued;
            this.activeProgress.reported = this.completedCount * (100 / this.count);
            this.activeProgress.progress?.report({
                increment: this.activeProgress.reported,
                message: `(${this.progressMessage}) Transcoding…`
            });
        }
    }

    /** @returns any tasks that were already in the queue */
    public enqueue(tasks: TranscodeTask | TranscodeTask[]): TranscodeTask[] {
        // Add the tasks to the queue
        const { added, skipped } = this.tasks.enqueue(tasks);
        // Update the progress % to account for the new tasks by sub
        this.updateProgress({ enqueued: added.length });

        // Return any that were already in the queue
        return skipped;
    }

    public async resumeWithProgress() {
        if (this.isRunning) {
            throw new Error('Call to `resume` while tasks are already in progress');
        }

        this.operation = Util.withProgressNotif('FFmpeg is running…', async (batchCancelToken, progress) => {
            this.activeProgress.progress = progress;

            // Run all tasks in the queue with progress reporting
            await this.runAll(batchCancelToken, progress);
        });

        await this.operation;

        // Reset the operation and progress after all tasks are completed
        this.operation = undefined;
        this.activeProgress = {
            reported: 0,
            totalTasksSofar: 0,
            progress: undefined
        };
    }

    private async runAll(batchCancelToken: CancellationToken, progress: Progress) {
        for (const task of this.tasks) {
            await this.runTaskWithProgress(task, batchCancelToken);
            // this.completedCount++;
            this.updateProgress({ dequeued: 1 });
        }
    }

    private async runOne() {
        await this.runTaskWithProgress(this.tasks.shift()!);
    }

    private async runTaskWithProgress(task: TranscodeTask, batchCancelToken?: CancellationToken) {
        const verb = task.operation === 'transcode' ? 'Transcoding' : 'Re-encoding';
        await Util.withProgressNotif(`${verb} ${task.name}…`, async (cancelToken) => {
            cancelToken = Util.combineCancellationTokens(cancelToken, batchCancelToken);
            await task.work(cancelToken);
        });
    }
}
