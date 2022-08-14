/*
 * Copyright (c) 2021, 2022 Yahweasel
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

import sha512 from "sha512-es";

// A global promise for behaviors that need to be transactional
let storePromise: Promise<unknown> = Promise.all([]);

// The LocalForage instance used to store files
let fileStorage: LocalForage = null;

// Number of concurrent stores
let storeCt = 0;

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
 * Get our file storage instance.
 */
export async function getFileStorage(): Promise<LocalForage> {
    if (fileStorage)
        return fileStorage;
    if (typeof localforage === "undefined")
        await util.loadLibrary({
            file: "libs/localforage.min.js",
            name: "storage library"
        });
    fileStorage = localforage.createInstance({name: "ennuicastr-file-storage"});
    return fileStorage;
}

/**
 * Get an array of all stored files.
 */
export async function getFiles(): Promise<FileInfo[]> {
    await getFileStorage();
    return await Promise.all(
        (<FileInfo[]> await fileStorage.getItem("files") || [])
        .map(async function(x) { return <FileInfo> await fileStorage.getItem("file-" + x); })
    );
}

/**
 * Clear out any files that are expired.
 */
export async function clearExpired(): Promise<void> {
    await getFileStorage();

    // Get the list of expired files
    const expiredP = storePromise.then(async function() {
        const now = Date.now();
        const files: string[] = await fileStorage.getItem("files") || [];
        const expired: string[] = [];
        for (let i = files.length - 1; i >= 0; i--) {
            const file = files[i];
            const info: FileInfo = await fileStorage.getItem("file-" + file);
            if (!info || info.edate < now)
                expired.push(file);
        }
        return expired;
    });
    storePromise = expiredP;
    const expired = await expiredP;

    // And delete them
    for (const file of expired)
        await deleteFile(file);
}

/**
 * Delete the file with the given ID.
 * @param id  The file's ID.
 */
export async function deleteFile(id: string): Promise<void> {
    await getFileStorage();

    const info: FileInfo = await fileStorage.getItem("file-" + id);
    if (info) {
        // Remove all the data, +1 in case of short write
        for (let i = 0; i <= info.len.length; i++)
            await fileStorage.removeItem("data-" + id + "-" + i);
    }

    // Remove the metadata
    await fileStorage.removeItem("file-" + id);

    // Remove it from the list
    storePromise = storePromise.then(async function() {
        const files: string[] = await fileStorage.getItem("files") || [];
        const idx = files.indexOf(id);
        if (idx >= 0)
            files.splice(idx, 1);
        await fileStorage.setItem("files", files);
    });
    await storePromise;
}

/**
 * Store a file, given by a stream of Uint8Array chunks.
 * @param name  The file's name.
 * @param key  Key-exchange information.
 * @param stream  The stream of information to store in the file.
 * @param opts  Other options.
 */
export async function storeFile(
    name: string, key: number[], stream: ReadableStream<Uint8Array>, opts: {
        expTime?: number,
        mimeType?: string,
        report?: (ct: number, spaceUsed: number, spaceTotal: number) => unknown
    } = {}
): Promise<void> {
    await getFileStorage();

    async function report() {
        if (opts.report && navigator.storage && navigator.storage.estimate) {
            const e = await navigator.storage.estimate();
            opts.report(storeCt, e.usage, e.quota);
        }
    }

    storeCt++;
    report();

    const cdate = Date.now();
    const edate = cdate + (
        (typeof opts.expTime === "number") ? opts.expTime : 2678400000
    );

    // Get the salt
    const saltP = storePromise.then(async function() {
        let salt: number = await fileStorage.getItem("salt");
        if (salt === null) {
            salt = ~~(Math.random() * 2000000000);
            await fileStorage.setItem("salt", salt);
        }
        return salt;
    });
    storePromise = saltP;
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
    const idP = storePromise.then(async function() {
        const files: string[] = await fileStorage.getItem("files") || [];
        let id: string;
        do {
            id = "";
            while (id.length < 12)
                id += Math.random().toString(36).slice(2);
            id = id.slice(0, 12);
        } while (files.indexOf(id) >= 0);
        files.push(id);
        await fileStorage.setItem("files", files);
        return id;
    });
    storePromise = idP;
    const id = info.id = await idP;
    await fileStorage.setItem("file-" + id, info);

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
                await fileStorage.setItem("data-" + id + "-" + info.len.length, buf);
                info.len.push(bufSz);
                await fileStorage.setItem("file-" + id, info);
                bufUsed = 0;
                report();
            }
        }
    }

    // Save whatever remains
    if (bufUsed) {
        await fileStorage.setItem("data-" + id + "-" + info.len.length, buf.slice(0, bufUsed));
        info.len.push(bufUsed);
    }
    info.complete = true;
    await fileStorage.setItem("file-" + id, info);

    storeCt--;
    report();
}
