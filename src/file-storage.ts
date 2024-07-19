/*
 * Copyright (c) 2021-2024 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/*
 * This file is part of Ennuicastr.
 *
 * Storage of files (video recordings) in the browser.
 */

import * as util from "./util";

import type * as localforageT from "localforage";
type LocalForage = typeof localforageT;
declare let localforage: LocalForage;

import * as nonlocalForage from "nonlocal-forage";
import sha512 from "sha512-es";

import dropboxKeys from "../api/dropbox.json";
import googleDriveKeys from "../api/google-drive.json";

/**
 * File metadata, as stored.
 */
export interface FileInfo {
    /**
     * A unique ID.
     */
    id: string;

    /**
     * File name.
     */
    name: string;

    /**
     * Key-exchange information. For authentication, we ask different-origin
     * hosts for a hash of the key with a random salt, and then only tell them
     * about files for which their hash is correct. The key itself is hashed
     * with a global salt.
     */
    key: string;

    /**
     * Date when the file was first created, as a JavaScript-style timestamp.
     */
    cdate: number;

    /**
     * Date when the file expires.
     */
    edate: number;

    /**
     * Length of each block. Sum is length of the file.
     */
    len: number[];

    /**
     * Set to true if this file completed transfer.
     */
    complete: boolean;

    /**
     * MIME type.
     */
    mimeType: string;
}

/**
 * A file storage driver backed by LocalForage. Create one FileStorage instance
 * per LocalForage backend used.
 */
export class FileStorage {
    // A global promise for behaviors that need to be transactional
    private _storePromise: Promise<unknown> = Promise.all([]);

    // Number of concurrent stores
    private _storeCt = 0;

    constructor(
        /**
         * The LocalForage instance used to store files
         */
        public fileStorage: LocalForage
    ) {}

    /**
     * Get an array of all stored files.
     */
    async getFiles(): Promise<FileInfo[]> {
        return await Promise.all(
            (<FileInfo[]> await this.fileStorage.getItem("files") || [])
            .map(async x => <FileInfo> await this.fileStorage.getItem(`file-${x}`))
        );
    }

    /**
     * Clear out any files that are expired.
     */
    async clearExpired(): Promise<void> {
        // Get the list of expired files
        const expiredP = this._storePromise.then(async () => {
            const now = Date.now();
            const files: string[] = await this.fileStorage.getItem("files") || [];
            const expired: string[] = [];
            for (let i = files.length - 1; i >= 0; i--) {
                const file = files[i];
                const info: FileInfo = await this.fileStorage.getItem(`file-${file}`);
                if (!info || info.edate < now)
                    expired.push(file);
            }
            return expired;
        });
        this._storePromise = expiredP;
        const expired = await expiredP;

        // And delete them
        for (const file of expired)
            await this.deleteFile(file);
    }

    /**
     * Delete the file with the given ID.
     * @param id  The file's ID.
     */
    async deleteFile(id: string): Promise<void> {
        const info: FileInfo = await this.fileStorage.getItem(`file-${id}`);
        if (info) {
            // Remove all the data, +1 in case of short write
            for (let i = 0; i <= info.len.length; i++)
                await this.fileStorage.removeItem(`data-${id}-${i}`);
        }

        // Remove the metadata
        await this.fileStorage.removeItem(`file-${id}`);

        // Remove it from the list
        this._storePromise = this._storePromise.then(async () => {
            const files: string[] = await this.fileStorage.getItem("files") || [];
            const idx = files.indexOf(id);
            if (idx >= 0)
                files.splice(idx, 1);
            await this.fileStorage.setItem("files", files);
        });
        await this._storePromise;
    }

    /**
     * Store a file, given by a stream of Uint8Array chunks.
     * @param name  The file's name.
     * @param key  Key-exchange information.
     * @param stream  The stream of information to store in the file.
     * @param opts  Other options.
     */
    async storeFile(
        name: string, key: number[], stream: ReadableStream<Uint8Array>, opts: {
            expTime?: number,
            mimeType?: string,
            report?: (ct: number, spaceUsed: number, spaceTotal: number) => unknown
        } = {}
    ): Promise<void> {
        const report = async () => {
            if (opts.report && navigator.storage && navigator.storage.estimate) {
                const e = await navigator.storage.estimate();
                opts.report(this._storeCt, e.usage, e.quota);
            }
        }

        this._storeCt++;
        report();

        const cdate = Date.now();
        const edate = cdate + (
            (typeof opts.expTime === "number") ? opts.expTime : 2678400000
        );

        // Get the salt
        const saltP = this._storePromise.then(async () => {
            let salt: number = await this.fileStorage.getItem("salt");
            if (salt === null) {
                salt = ~~(Math.random() * 2000000000);
                await this.fileStorage.setItem("salt", salt);
            }
            return salt;
        });
        this._storePromise = saltP;
        const salt = await saltP;

        // Hash the key
        const hashKey = sha512.hash(key.join(":") + ":" + salt);

        // Start setting up the file info
        const info: FileInfo = {
            id: "",
            name,
            key: hashKey,
            cdate,
            edate,
            len: [],
            complete: false,
            mimeType: opts.mimeType || "application/octet-stream"
        };

        // First, find an ID
        const idP = this._storePromise.then(async () => {
            const files: string[] = await this.fileStorage.getItem("files") || [];
            let id: string;
            do {
                id = "";
                while (id.length < 12)
                    id += Math.random().toString(36).slice(2);
                id = id.slice(0, 12);
            } while (files.indexOf(id) >= 0);
            files.push(id);
            await this.fileStorage.setItem("files", files);
            return id;
        });
        this._storePromise = idP;
        const id = info.id = await idP;
        await this.fileStorage.setItem(`file-${id}`, info);

        // Now, start accepting data
        const rdr = stream.getReader();
        const bufSz = 1024*1024;
        const buf = new Uint8Array(bufSz);
        let bufUsed = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const rd = await rdr.read();
            if (rd.done)
                break;
            let chunk = rd.value.slice(0);

            // Fill in the buffer
            while (chunk.length) {
                const take = Math.min(bufSz - bufUsed, chunk.length);
                buf.set(chunk.subarray(0, take), bufUsed);
                bufUsed += take;
                chunk = chunk.subarray(take);

                if (bufUsed >= bufSz) {
                    // Save this chunk
                    await this.fileStorage.setItem(`data-${id}-${info.len.length}`, buf);
                    info.len.push(bufSz);
                    await this.fileStorage.setItem(`file-${id}`, info);
                    bufUsed = 0;
                    report();
                }
            }
        }

        // Save whatever remains
        if (bufUsed) {
            await this.fileStorage.setItem(`data-${id}-${info.len.length}`, buf.slice(0, bufUsed));
            info.len.push(bufUsed);
        }
        info.complete = true;
        await this.fileStorage.setItem(`file-${id}`, info);

        this._storeCt--;
        report();
    }
}

// Local FileStorage instance
let localFileStoragePromise: Promise<FileStorage> | null = null;

/**
 * Get a local FileStorage instance.
 */
export async function getLocalFileStorage(): Promise<FileStorage> {
    if (!localFileStoragePromise) {
        localFileStoragePromise = (async () => {
            if (typeof localforage === "undefined")
                await util.loadLibrary({
                    file: "libs/localforage.min.js",
                    name: "storage library"
                });
            const fileStorage = await localforage.createInstance({
                name: "ennuicastr-file-storage"
            });
            return new FileStorage(fileStorage);
        })();
    }
    return localFileStoragePromise;
}

// Remote FileStorage instance
export let remoteFileStoragePromise: Promise<FileStorage> | null = null;

// Remote FileStorage driver promises
let remoteFileStorageDrivers: Record<string, Promise<unknown>> = {};

/**
 * Get a remote FileStorage.
 * @param opts  FileStorage options.
 */
export async function getRemoteFileStorage(opts: {
    /**
     * Cloud provider.
     */
    provider: "googleDrive" | "dropbox",

    /**
     * Function to call for transient activation.
     */
    transientActivation: () => Promise<void>,

    /**
     * Optional function to call if transient activation is needed later.
     */
    lateTransientActivation?: () => Promise<void>,

    /**
     * Function to call for cancellability.
     */
    cancellable?: () => Promise<void>,

    /**
     * Hide cancellable.
     */
    hideCancellable?: () => void,

    /**
     * Optional function for late cancellation.
     */
    lateCancel?: () => Promise<void>,

    /**
     * Optional function to open an iframe instead of a window.
     */
    openIframe?: (url: string) => Promise<{
        iframe: HTMLIFrameElement,
        setOnclose: (onclose: (()=>void)|null)=>void,
        close: ()=>void
    }>,

    /**
     * Force a user consent prompt.
     */
    forcePrompt?: boolean
}): Promise<FileStorage> {
    async function loadDriver(name: string, driver: any) {
        if (!remoteFileStorageDrivers[name])
            remoteFileStorageDrivers[name] = localforage.defineDriver(driver);
        await remoteFileStorageDrivers[name];
    }

    return remoteFileStoragePromise = (async () => {
        await getLocalFileStorage();

        const keyStorage = await localforage.createInstance({
            name: "ennuicastr-file-storage-keys"
        });
        const cache = await localforage.createInstance({
            name: `ennuicastr-file-storage-cache-${opts.provider}`
        });

        switch (opts.provider) {
            case "googleDrive":
                await loadDriver("googleDrive", nonlocalForage.googleDriveLocalForage);
                break;

            case "dropbox":
                await loadDriver("dropbox", nonlocalForage.dropboxLocalForage);
                break;

            default:
                throw new Error(`Unsupported provider ${opts.provider}`);
        }
        const remote = await localforage.createInstance(<any> {
            driver: opts.provider,
            localforage: keyStorage,
            nonlocalforage: {
                directory: "ennuicastr-file-storage",
                transientActivation: opts.transientActivation,
                lateTransientActivation: opts.lateTransientActivation || opts.transientActivation,
                cancellable: opts.cancellable,
                hideCancellable: opts.hideCancellable,
                openIframe: opts.openIframe,
                forcePrompt: !!opts.forcePrompt
            },
            name: "ennuicastr-file-storage",
            dropbox: dropboxKeys,
            googleDrive: googleDriveKeys
        });
        await remote.ready();

        await loadDriver("cache", nonlocalForage.cacheForage);
        const fileStorage = await localforage.createInstance(<any> {
            driver: "cacheForage",
            cacheForage: {
                local: cache,
                nonlocal: remote
            }
        });
        return new FileStorage(fileStorage);
    })();
}

/**
 * Clear (disable) remote storage.
 */
export function clearRemoteFileStorage() {
    remoteFileStoragePromise = null;
}
