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
 * Get FileSystemDirectoryHandle permissions, accounting for iframe problems.
 */

import type * as localforageT from "localforage";
declare let localforage: typeof localforageT;

/**
 * Try very hard to get permission for this FSDH.
 */
export async function getFSDHPermission(
    fsdh: any, getTransientActivation: ()=>Promise<void>
) {
    const mode = {mode: "readwrite"};
    const dirStorage = await localforage.createInstance({
        driver: localforage.INDEXEDDB,
        name: "ennuicastr-fsdh-memory"
    });

    // (1) Try to just query permission
    try {
        if (await fsdh.queryPermission(mode) === "granted")
            return true;
    } catch (ex) {
        return false;
    }

    // (2) Try to request permission. Will throw if we're in an iframe.
    await getTransientActivation();
    try {
        return await fsdh.requestPermission(mode) === "granted";
    } catch (ex) {}

    // (3) Make the request via a window
    const url = new URL(document.location.href);
    url.searchParams.set("fsdhRequest", "1");
    const key = "" +
        Math.random().toString(36).slice(2) +
        Math.random().toString(36).slice(2);
    url.searchParams.set("key", key);
    await dirStorage.setItem(`fsdh.fsdh.${key}`, fsdh);
    localStorage.setItem(`fsdh.result.${key}`, "incomplete");

    const ret = await new Promise<boolean>(res => {
        // Check for window being closed by a timeout
        const startTime = new Date().getTime();
        localStorage.setItem(`fsdh.ping.${key}`, "" + startTime);
        const interval = setInterval(() => {
            const updTime = +localStorage.getItem(`fsdh.ping.${key}`);
            const now = new Date().getTime();
            if (now > startTime + 2000 &&
                updTime < now - 1000) {
                res(false);
                clearInterval(interval);
                removeEventListener("storage", onStore);
            }
        }, 250);

        async function onStore(ev: StorageEvent) {
            if (ev.key === `fsdh.result.${key}`) {
                res(await fsdh.queryPermission(mode) === "granted");
                clearInterval(interval);
                removeEventListener("storage", onStore);
            }
        }

        addEventListener("storage", onStore);
        window.open(url.toString(), "", "popup,width=480,height=480");
    });

    await dirStorage.removeItem(`fsdh.fsdh.${key}`);
    localStorage.removeItem(`fsdh.result.${key}`);
    localStorage.removeItem(`fsdh.ping.${key}`);
    localStorage.setItem(`fsdh.done.${key}`, "" + performance.now());

    // Keep the window open until the host window closes
    const keepaliveInterval = setInterval(() => {
        localStorage.setItem(`fsdh.keepalive.${key}`, "" + performance.now());
    }, 5000);

    addEventListener("beforeunload", () => {
        localStorage.setItem(`fsdh.close.${key}`, "" + performance.now());
        clearInterval(keepaliveInterval);
    });

    return ret;
}

/**
 * Call from the window opened to make an FSDH request.
 */
export async function fsdhReqWindow(
    url: URL, getTransientActivation: ()=>Promise<void>
) {
    // Ping to keep alive
    const key = url.searchParams.get("key");
    const interval = setInterval(() => {
        localStorage.setItem(`fsdh.ping.${key}`, "" + new Date().getTime());
    }, 250);

    // Get permission
    const dirStorage = await localforage.createInstance({
        driver: localforage.INDEXEDDB,
        name: "ennuicastr-fsdh-memory"
    });
    const fsdh = <any> await dirStorage.getItem(`fsdh.fsdh.${key}`);
    await getTransientActivation();
    const result = await fsdh.requestPermission({mode: "readwrite"});

    // Wait until the host has received it
    await new Promise<void>(res => {
        function onStore(ev: StorageEvent) {
            if (ev.key === `fsdh.done.${key}`) {
                localStorage.removeItem(`fsdh.done.${key}`);
                localStorage.removeItem(`fsdh.ping.${key}`);
                clearInterval(interval);
                removeEventListener("storage", onStore);
                res();
            }
        }

        addEventListener("storage", onStore);
        localStorage.setItem(`fsdh.result.${key}`, result);
    });

    // Then keep alive until the host doesn't need us anymore
    await new Promise<void>(res => {
        const pingTimeout = 10000;

        let lastPing = performance.now();
        let interval = setInterval(() => {
            if (performance.now() > lastPing + pingTimeout)
                close();
        }, 250);

        function onStore(ev: StorageEvent) {
            if (ev.key === `fsdh.keepalive.${key}`) {
                lastPing = performance.now();

            } else if (ev.key === `fsdh.close.${key}`) {
                close();

            }
        }

        function onBeforeUnload(ev: BeforeUnloadEvent) {
            ev.preventDefault();
            return true;
        }

        function close() {
            localStorage.removeItem(`fsdh.keepalive.${key}`);
            localStorage.removeItem(`fsdh.close.${key}`);
            clearInterval(interval);
            removeEventListener("beforeunload", onBeforeUnload);
            removeEventListener("storage", onStore);
            window.close();
            res();
        }

        addEventListener("beforeunload", onBeforeUnload);
        addEventListener("storage", onStore);
    });
}
