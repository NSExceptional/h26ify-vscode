/*
 * edit-preset.ts
 * H26ify
 *
 * Created by Tanner Bennett on 2026-05-05
 * Copyright © 2026 Tanner Bennett. All rights reserved.
 */

import * as vscode from 'vscode';

const kPresetsKey = 'h26ify.editPresets';

export interface TrimRange {
    start: number; // seconds
    end: number;   // seconds
}

export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** How a crop rect is reinterpreted for videos of differing resolution. */
export type CropMode = 'percent' | 'absolute' | 'aspect' | 'insets';

/**
 * A stored crop. `mode`/`params` are the canonical, resolution-independent form
 * owned by the edit-panel webview (which recomputes a pixel rect per video).
 * The legacy `x/y/width/height` fields are read for presets saved before crop modes.
 */
export interface CropPreset {
    mode?: CropMode;
    params?: Record<string, unknown>;
    refWidth?: number;
    refHeight?: number;
    // Legacy absolute rect (presets predating crop modes)
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}

export interface ResizeDimensions {
    width: number;  // -1 to preserve aspect ratio
    height: number; // -1 to preserve aspect ratio
}

export interface EditPreset {
    name: string;
    trim?: TrimRange;
    crop?: CropPreset;
    resize?: ResizeDimensions;
}

/** Manages named editing presets stored in workspace state */
export class EditPresetStorage {
    public static shared = new EditPresetStorage();

    private context: vscode.ExtensionContext | undefined;

    public initialize(context: vscode.ExtensionContext): void {
        this.context = context;
    }

    private get state(): vscode.Memento {
        if (!this.context) {
            throw new Error('EditPresetStorage has not been initialized');
        }
        return this.context.workspaceState;
    }

    public getAll(): Record<string, EditPreset> {
        return this.state.get<Record<string, EditPreset>>(kPresetsKey, {});
    }

    public get(name: string): EditPreset | undefined {
        return this.getAll()[name];
    }

    public async save(preset: EditPreset): Promise<void> {
        const all = this.getAll();
        all[preset.name] = preset;
        await this.state.update(kPresetsKey, all);
    }

    public async delete(name: string): Promise<void> {
        const all = this.getAll();
        delete all[name];
        await this.state.update(kPresetsKey, all);
    }
}
