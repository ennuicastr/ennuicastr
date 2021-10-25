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

import * as fileSaver from "file-saver";

// The scope for the service worker
const scope = "/download-stream-service-worker/";

// The registered service worker, if there is one
let serviceWorker: ServiceWorker = null;

// The port for communicating with the service worker
let serviceWorkerPort: MessagePort = null;

// The pinger iframe used to keep the service worker alive
export let serviceWorkerPinger: HTMLIFrameElement = null;

// Callbacks from the service worker
let callbacks: Record<number, (x:any) => void> = Object.create(null);

// Current callback number
let callbackNo = 0;

// Send a message to the service worker and expect a response
async function swPostMessage(msg: any): Promise<any> {
    const no = callbackNo++;
    msg.i = no;
    serviceWorkerPort.postMessage(msg);

    return await new Promise(res => {
        callbacks[no] = res;
    });
}

/**
 * Load support for streaming downloads.
 */
export async function load() {
    try {
        if (navigator.serviceWorker &&
            (navigator.userAgent.indexOf("Safari") < 0 ||
             navigator.userAgent.indexOf("Chrome") >= 0)) {
            let swr = await navigator.serviceWorker.getRegistration(scope);

            if (!swr || !swr.active) {
                // We need to register and activate it
                swr = await navigator.serviceWorker.register("sw.js?v=3", {scope});

                if (!swr.installing && !swr.waiting && !swr.active) {
                    // Wait for it to install
                    await new Promise(res => {
                        swr.onupdatefound = res;
                    });
                }

                serviceWorker = swr.installing || swr.waiting || swr.active;

                // Wait for it to activate
                while (serviceWorker.state !== "activated") {
                    await new Promise(res => {
                        serviceWorker.addEventListener("statechange", res, {once: true});
                    });
                }

                // We want it already active when the page loads
                location.reload();
                await new Promise(()=>{});
            }

            serviceWorker = swr.active;

            // Give it a channel
            const mc = new MessageChannel();
            serviceWorker.postMessage({c: "port", p: mc.port2}, [mc.port2]);
            serviceWorkerPort = mc.port1;

            // Wait for messages
            serviceWorkerPort.onmessage = ev => {
                const msg = ev.data;
                const callback = callbacks[msg.i];
                if (callback) {
                    delete callbacks[msg.i];
                    callback(msg);
                }
            };

            // Ack it and check its version
            const ack = await swPostMessage({c: "setup"});
            if (ack.v !== 3) {
                await swr.unregister();
                location.reload();
                await new Promise(()=>{});
            }

            // And keep it alive
            const pinger = serviceWorkerPinger =
                document.createElement("iframe");
            pinger.style.display = "none";
            pinger.src = scope + "download-stream-service-worker-pinger.html";
            document.body.appendChild(pinger);
        }

    } catch (ex) {
        // No service worker
        console.log("WARNING: Not using service workers! " + ex);
        serviceWorker = serviceWorkerPort = null;

    }
}

/**
 * Attempt to stream this.
 */
export async function stream(
    name: string, body: ReadableStream<Uint8Array>,
    headers: Record<string, string>
) {
    // Set up the most important headers
    let utf8Name = encodeURIComponent(name);
    let safeName = utf8Name.replace(/%/g, "_");
    headers = Object.assign({
        "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${utf8Name}`,
        "cross-origin-embedder-policy": "require-corp"
    }, headers);

    if (serviceWorker) {
        // Try to stream via the service worker
        const url = scope + Math.random() + Math.random() + Math.random() + "/" + safeName;

        // If the service worker has vanished, it won't work
        let worked = await Promise.race([
            swPostMessage({c: "stream", u: url, h: headers}).then(() => true),
            (new Promise(res => setTimeout(res, 5000))).then(() => false)
        ]);

        if (!worked)
            console.log("WARNING: Failed to communicate with service worker!");

        if (worked) {
            const iframe = document.createElement("iframe");
            iframe.src = url;
            iframe.style.display = "none";
            document.body.appendChild(iframe);

            // Make sure it actually starts downloading
            worked = await Promise.race([
                swPostMessage({c: "wait-start", u: url}).then(() => true),
                (new Promise(res => setTimeout(res, 5000))).then(() => false)
            ]);

            if (!worked)
                console.log("WARNING: Failed to start service worker download!");
        }

        if (worked) {
            // Send it via the worker
            return await streamViaWorker(url, body);
        }
    }

    return await streamViaBlob(name, body);
}

/**
 * Stream this data via the service worker.
 */
async function streamViaWorker(url: string, body: ReadableStream<Uint8Array>) {
    const rdr = body.getReader();
    while (true) {
        const d = await rdr.read();
        if (d.done) {
            await swPostMessage({c: "end", u: url});
            break;
        }
        await swPostMessage({c: "data", u: url, b: d.value});
    }
}

/**
 * Stream this data via a blob.
 */
async function streamViaBlob(name: string, body: ReadableStream<Uint8Array>) {
    console.log("WARNING: Saving data to a blob to download!");

    // Collect all the data
    const data: Uint8Array[] = [];
    const rdr = body.getReader();
    while (true) {
        const part = await rdr.read();
        if (part.done)
            break;
        data.push(part.value);
    }

    // Make a blob
    const blob = new Blob(data);

    // And download it
    fileSaver.saveAs(blob, name);
}
