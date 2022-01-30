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
 * Independent page for showing/downloading files saved in the browser.
 */

import * as downloadStream from "./download-stream";
import * as fileStorage from "./file-storage";

import sha512 from "sha512-es";
import * as wsp from "web-streams-polyfill/ponyfill";

/**
 * Download this file.
 * @param id  ID of the file.
 */
async function downloadById(id: string) {
    const store = await fileStorage.getFileStorage();
    const file: fileStorage.FileInfo = await store.getItem("file-" + id);
    if (!file)
        return;
    const sz = file.len.reduce((x, y) => x + y, 0);

    // Create a stream for it
    let idx = 0;
    const stream = <ReadableStream<Uint8Array>> <unknown> new wsp.ReadableStream({
        async pull(controller) {
            const chunk = await store.getItem("data-" + id + "-" + (idx++));
            if (chunk)
                controller.enqueue(chunk);
            if (idx >= file.len.length)
                controller.close();
        }
    });

    // And download it
    await downloadStream.stream(file.name, stream, {
        "content-type": file.mimeType,
        "content-length": sz + ""
    });
}

/**
 * Establish a connection with the surrounding page.
 */
async function connection(port: MessagePort) {
    const store = await fileStorage.getFileStorage();
    const globalSalt = await store.getItem("salt") || 0;
    const localSalt = ~~(Math.random() * 2000000000);

    // Tell the host the salt
    port.postMessage({c: "salt", global: globalSalt, local: localSalt});

    // And wait for messages
    port.onmessage = async function(ev) {
        switch (ev.data.c) {
            case "list":
            {
                const key = ev.data.key;
                const files = await fileStorage.getFiles();

                // Only send the ones with the correct key
                for (let i = files.length - 1; i >= 0; i--) {
                    const file = files[i];
                    if (sha512.hash(file.key + ":" + localSalt) !== key)
                        files.splice(i, 1);
                }

                port.postMessage({c: "list", files});
                break;
            }

            case "download":
            case "delete":
            {
                // Download or delete the ID'd file
                const id = ev.data.id;
                const key = ev.data.key;
                const file: fileStorage.FileInfo = await store.getItem("file-" + id);
                if (!file)
                    break;
                if (sha512.hash(file.key + ":" + localSalt) !== key)
                    break;
                if (ev.data.c === "delete")
                    fileStorage.deleteFile(id);
                else
                    downloadById(id);
                break;
            }
        }
    };
}

(async function() {
    await downloadStream.load({prefix: "../"});

    // Create a message port for our host
    if (window.parent) {
        const mc = new MessageChannel();
        const mp = mc.port1;
        mp.onmessage = function(ev) {
            if (typeof ev.data === "object" && ev.data !== null &&
                ev.data.c === "ennuicastr-file-storage")
                connection(mp);
        };
        window.parent.postMessage(
            {c: "ennuicastr-file-storage", port: mc.port2}, "*", [mc.port2]);
    }


    // Simple button for each download
    for (const file of await fileStorage.getFiles()) {
        const div = document.createElement("div");
        const btn = document.createElement("button");
        const del = document.createElement("button");

        btn.innerText = file.name;
        btn.onclick = function() {
            downloadById(file.id);
        };
        div.appendChild(btn);

        del.innerText = "Delete";
        del.onclick = async function() {
            del.innerText = "Confirm";
            await new Promise(res => del.onclick = res);
            btn.disabled = true;
            btn.classList.add("off");
            del.innerText = "...";
            del.disabled = true;
            del.classList.add("off");
            await fileStorage.deleteFile(file.id);
            div.style.display = "none";
        };
        div.appendChild(del);

        document.body.appendChild(div);
    }
})();
