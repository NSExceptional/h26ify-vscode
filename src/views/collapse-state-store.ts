/*
 * collapse-state-store.ts
 * H26ify
 *
 * Created by GitHub Copilot on 2026-05-12
 * Copyright © 2025 Tanner Bennett.
 */

import * as vscode from 'vscode';

const kKey = 'h26ify.collapseState';

/** Persists which tree-item IDs the user has explicitly collapsed, keyed by item ID. */
export class CollapseStateStore {
    public static readonly shared = new CollapseStateStore();

    private _context: vscode.ExtensionContext | undefined;

    initialize(context: vscode.ExtensionContext): void {
        this._context = context;
    }

    isCollapsed(id: string): boolean {
        return this._set().has(id);
    }

    setCollapsed(id: string, collapsed: boolean): void {
        const set = this._set();
        if (collapsed) { set.add(id); } else { set.delete(id); }
        this._context?.workspaceState.update(kKey, [...set]);
    }

    private _set(): Set<string> {
        const arr: string[] = this._context?.workspaceState.get(kKey) ?? [];
        return new Set(arr);
    }
}
