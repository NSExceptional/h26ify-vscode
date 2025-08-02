//
//  base-provider.ts
//  tinder-studio
//
//  Created by Tanner Bennett on 2022-10-16
//

import { Event, EventEmitter, ProviderResult, TreeDataProvider, TreeItem, TreeView, window } from 'vscode';

type EventType<E> = E | undefined | null | void;

/** A non-tree structured list of items (i.e. no nesting of children) */
export default abstract class BaseListProvider<T extends TreeItem> implements TreeDataProvider<T> {
    /** A string to use in status messages */
    protected abstract contentKind: string;

    private _onDidChangeTreeData: EventEmitter<EventType<T>> = new EventEmitter<EventType<T>>();
    readonly onDidChangeTreeData: Event<EventType<T>> = this._onDidChangeTreeData.event;

    private items: T[] | undefined = undefined;
    public get treeItems(): T[] | undefined { return this.items; }

    public treeView: TreeView<T> | undefined = undefined;

    /**
     * Consumers can call this method to trigger the associated
     * tree view to pull new data from this provider
     */
    refreshView(): void {
        this._onDidChangeTreeData.fire();
    }

    /** Same as `refreshView`, but first purges and reloads the data source */
    async reloadAndRefreshView(): Promise<void> {
        this.items = [];
        this.refreshView();

        // For some reason, if we set items to undefined here,
        // the view is never emptied before being refreshed,
        // so we do this instead
        this.items = await this.getItems();
        this.refreshView();
    }

    /** Subclasses should override to regenerate and populate their own data source */
    protected abstract reloadData(): T[] | Promise<T[]>;

    /**
     * Removes an item from the data source; does not refresh the view.
     *
     * Subclasses should override to remove the item from other data sources.
     */
    removeItem(item: T): void {
        if (!this.items?.find(i => i.id === item.id)) {
            throw new Error(`Item ${item.id} not found in data source`);
        }

        this.items = this.items?.filter(i => i.id !== item.id);
    }

    private async getItems(): Promise<T[]> {
        let resultsOrPromise = this.reloadData();
        // Turn it into a promise regardless
        resultsOrPromise = Promise.resolve(resultsOrPromise);
        return resultsOrPromise;
    }

    getTreeItem(element: T): TreeItem | Thenable<TreeItem> {
        return element;
    }

    getChildren(element?: T): ProviderResult<T[]> {
        if (element) return [];
        // Case: data source already populated
        if (this.items) return this.items;

        // Case: data source empty
        return this.getItems()
            .then(items => {
                // Store items in data source
                //
                // Note: subclasses do not need to override this method
                // to store the items in their own data source, as they
                // should be doing that in `reloadData` already.
                this.items = items;
                return items;
            })
            .catch(error => {
                // This is NOT caught by the machinery in the @cmd decorator.
                window.showErrorMessage(`Error loading ${this.contentKind}: ${error.message}`);
                return [];
            });
    }
}
