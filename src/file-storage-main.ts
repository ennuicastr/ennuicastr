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
 * Independent page for showing/downloading files saved in the browser.
 */

import * as barrierPromise from "./barrier-promise";
import * as fileStorage from "./file-storage";
import * as fsdhPerm from "./fsdh-perm";

import * as downloadStream from "@ennuicastr/dl-stream";
import type * as localforageT from "localforage";
import sha512 from "sha512-es";
import * as wsp from "web-streams-polyfill/ponyfill";

declare let localforage: typeof localforageT;


/**
 * Download this file.
 * @param id  ID of the file.
 */
async function downloadById(store: fileStorage.FileStorage, id: string) {
    const file = await store.streamFile(id);
    if (!file)
        return;

    // And download it
    await downloadStream.stream(file.name, file.stream, {
        "content-type": file.mimeType,
        "content-length": file.len + ""
    });
}

/**
 * Establish a connection with the surrounding page.
 */
async function connection(
    ctx: string, store: fileStorage.FileStorage,
    port: MessagePort
) {
    const globalSalt = await store.fileStorage.getItem("salt") || 0;
    const localSalt = ~~(Math.random() * 2000000000);

    // Tell the host the salt
    port.postMessage({c: "salt", ctx, global: globalSalt, local: localSalt});

    // And wait for messages
    port.addEventListener("message", async ev => {
        if (!ev.data || ev.data.ctx !== ctx)
            return;

        switch (ev.data.c) {
            case "list":
            {
                const key = ev.data.key;
                const files = await store.getFiles();

                // Only send the ones with the correct key
                for (let i = files.length - 1; i >= 0; i--) {
                    const file = files[i];
                    if (sha512.hash(file.key + ":" + localSalt) !== key)
                        files.splice(i, 1);
                }

                port.postMessage({c: "list", ctx, files});
                break;
            }

            case "download":
            case "stream":
            case "delete":
            {
                // Download or delete the ID'd file
                const id = ev.data.id;
                const key = ev.data.key;
                const file: fileStorage.FileInfo = await store.fileStorage.getItem("file-" + id);
                if (!file)
                    break;
                if (sha512.hash(file.key + ":" + localSalt) !== key)
                    break;
                switch (ev.data.c) {
                    case "download":
                        downloadById(store, id);
                        break;

                    case "stream":
                    {
                        const mp: MessagePort = ev.data.port;
                        const stream = await store.streamFile(id);
                        mp.postMessage({
                            c: "stream",
                            id,
                            stream
                        }, [stream.stream]);
                        break;
                    }

                    case "delete":
                        store.deleteFile(id);
                        break;
                }
                break;
            }
        }
    });
}

async function localUI(header: string, ctx: string, store: fileStorage.FileStorage) {
    const ui = document.createElement("div");
    ui.style.margin = "0.5em";
    document.body.appendChild(ui);
    const h1 = document.createElement("h1");
    h1.innerText = header;
    ui.appendChild(h1);

    // Simple button for each download
    const files = await store.getFiles();
    for (const file of files) {
        const div = document.createElement("div");
        const btn = document.createElement("button");
        const del = document.createElement("button");

        btn.innerText = file.name;
        btn.classList.add("pill-button");
        btn.onclick = function() {
            downloadById(store, file.id);
        };
        div.appendChild(btn);

        del.innerText = "Delete";
        del.classList.add("pill-button");
        del.onclick = async function() {
            del.innerText = "Confirm";
            await new Promise(res => del.onclick = res);
            btn.disabled = true;
            btn.classList.add("off");
            del.innerText = "...";
            del.disabled = true;
            del.classList.add("off");
            await store.deleteFile(file.id);
            div.style.display = "none";
        };
        div.appendChild(del);

        ui.appendChild(div);
    }

    if (files.length === 0) {
        const div = document.createElement("div");
        div.innerText = "No data found";
        ui.appendChild(div);
    }
}

(async function() {
    const url = new URL(document.location.href);
    if (url.searchParams.has("fsdhRequest")) {
        const docURL = new URL(document.location.href);
        docURL.search = "";
        window.history.pushState({}, document.title, docURL.toString());
        await fsdhPerm.fsdhReqWindow(
            url,
            () => {
                const div = document.createElement("div");
                div.style.padding = "0.25em";
                div.innerText = "Ennuicastr needs permission to access your local storage directory.";
                document.body.appendChild(div);
                const btn = document.createElement("button");
                btn.innerHTML = '<i class="bx bx-folder-open"></i> Open directory';
                btn.classList.add("pill-button");
                btn.style.width = "100%";
                document.body.appendChild(btn);
                return new Promise(res => {
                    btn.onclick = () => {
                        document.body.removeChild(btn);
                        div.innerText = "Please keep this window open until you're finished downloading.";
                        res();
                    };
                });
            }
        );
        return;
    }

    const store = await fileStorage.getLocalFileStorage();
    await downloadStream.load({prefix: "../"});

    const transientReqs: barrierPromise.BarrierPromise[] = [];
    let needTransient = false;
    const transientConts: barrierPromise.BarrierPromise[] = [];
    const completions: barrierPromise.BarrierPromise[] = [];

    // Maybe look for cloud storage
    let remoteStore: fileStorage.FileStorage | null = null;
    let provider = localStorage.getItem("master-video-save-in-cloud-provider");
    if (provider) {
        let webDAVInfo: any = void 0;
        if (provider === "webDAV") {
            webDAVInfo = {
                username: localStorage.getItem("webdav-username"),
                password: localStorage.getItem("webdav-password"),
                server: localStorage.getItem("webdav-server")
            };
        }

        const cloudTR = new barrierPromise.BarrierPromise();
        transientReqs.push(cloudTR);
        const cloudTC = new barrierPromise.BarrierPromise();
        transientConts.push(cloudTC);
        const cloudComplete = new barrierPromise.BarrierPromise();
        completions.push(cloudComplete);
        
        (async function() {
            try {
                remoteStore = await fileStorage.getRemoteFileStorage({
                    provider: <any> provider,
                    webDAVInfo,
                    transientActivation: async () => {
                        needTransient = true;
                        cloudTR.res();
                        await cloudTC.promise;
                    }
                });
            } finally {
                cloudTR.res();
                cloudComplete.res();
            }
        })();
    }

    // Maybe look for FSDH storage
    let dir: FileSystemDirectoryHandle | null = null;
    try {
        const dirStorage = await localforage.createInstance({
            driver: localforage.INDEXEDDB,
            name: "ennuicastr-fsdh-memory"
        });
        dir = await dirStorage.getItem("fsdh-dir");
    } catch (ex) {}
    let fsdhStore: fileStorage.FileStorage | null = null;
    if (dir) {
        const fsdhTR = new barrierPromise.BarrierPromise();
        transientReqs.push(fsdhTR);
        const fsdhTC = new barrierPromise.BarrierPromise();
        transientConts.push(fsdhTC);
        const fsdhComplete = new barrierPromise.BarrierPromise();
        completions.push(fsdhComplete);

        const fsdhPermPromise = fsdhPerm.getFSDHPermission(
            dir,
            async () => {
                needTransient = true;
                fsdhTR.res();
                await fsdhTC.promise;
            }
        ).then(async perm => {
            if (perm)
                fsdhStore = await fileStorage.getFSDHFileStorage(dir);
            fsdhTR.res();
            fsdhComplete.res();

        });

        const fsdhNeedTransient = await Promise.race([fsdhPermPromise, fsdhTR]);
    }

    // Perform any needed transient activation
    for (const p of transientReqs)
        await p.promise;
    if (needTransient) {
        const btn = document.createElement("button");
        btn.innerHTML = '<i class="bx bx-log-in"></i> Log in';
        btn.classList.add("pill-button");
        Object.assign(btn.style, {
            position: "fixed",
            left: "0px",
            top: "0px"
        });
        btn.style.right = "0px";
        btn.onclick = () => {
            document.body.removeChild(btn);
            for (const p of transientConts)
                p.res();
        };
        document.body.appendChild(btn);
        const logInBtn = {
            w: btn.offsetWidth + 32 /* for the icon */,
            h: btn.offsetHeight
        };
        window.parent.postMessage(
            {c: "ennuicastr-file-storage-transient-activation", btn: logInBtn}, "*");
    }

    // Wait for everything to complete
    for (const p of completions)
        await p.promise;

    // Create a message port for our host
    if (window.parent) {
        const mc = new MessageChannel();
        const mp = mc.port1;
        mp.onmessage = ev => {
            if (ev.data && ev.data.c === "ennuicastr-file-storage") {
                connection("local", store, mp);
                if (remoteStore)
                    connection("remote", remoteStore, mp);
                if (fsdhStore)
                    connection("fsdh", fsdhStore, mp);
            }
        };
        window.parent.postMessage(
            {
                c: "ennuicastr-file-storage",
                port: mc.port2,
                backends: {
                    local: true,
                    remote: !!remoteStore,
                    fsdh: !!fsdhStore
                }
            }, "*", [mc.port2]
        );
    }

    // Local UI(s)
    if (remoteStore)
        localUI("Cloud", "remote", remoteStore);

    if (fsdhStore)
        localUI("Local directory", "fsdh", fsdhStore);

    localUI("Backup", "local", store);
})();
