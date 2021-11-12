/*
 * Copyright (c) 2021 Yahweasel
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

import * as downloadStream from "./download-stream";
import * as fileStorage from "./file-storage";

import * as sha1 from "./sha1";
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
async function connection(msg: {p: MessagePort}) {
    const port = msg.p;
    const store = await fileStorage.getFileStorage();
    const globalSalt = await store.getItem("salt");
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
                    if (sha1(file.key + ":" + localSalt) !== key)
                        files.splice(i, 1);
                }

                port.postMessage({c: "list", files});
                break;
            }

            case "download":
            {
                // Download the ID'd file
                const id = ev.data.id;
                const key = ev.data.key;
                const file: fileStorage.FileInfo = await store.getItem("file-" + id);
                if (!file)
                    break;
                if (sha1(file.key + ":" + localSalt) !== key)
                    break;
                downloadById(id);
                break;
            }
        }
    };
}

(async function() {
    await downloadStream.load({prefix: "../"});

    onmessage = function(ev) {
        if (typeof ev.data === "object" && ev.data !== null &&
            ev.data.c === "ennuicastr-file-storage") {
            connection(ev.data);
        }
    };

    // Simple button for each download
    for (const file of await fileStorage.getFiles()) {
        const div = document.createElement("div");
        const btn = document.createElement("button");
        btn.innerText = file.name;
        btn.onclick = function() {
            downloadById(file.id);
        };
        div.appendChild(btn);
        document.body.appendChild(div);
    }
})();
