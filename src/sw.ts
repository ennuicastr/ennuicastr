/*
 * Copyright (c) 2021-2023 Yahweasel
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
 * Service worker for streaming downloads.
 */

// A page to ping this service worker
const pinger = `
<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
    </head>
    <body>
        <script type="text/javascript">(function() {
            var interval = setInterval(function() {
                fetch("/download-stream-service-worker/" + Math.random() +
                    Math.random() + Math.random() +
                    "/download-stream-service-worker-ping").then(function(f) {

                    return f.text();

                }).then(function(t) {
                    if (t !== "pong") {
                        console.log(t);
                        clearInterval(interval);
                    }

                }).catch(console.error);
            }, 5000);
        })();
        </script>
    </body>
</html>
`;

interface Stream {
    // Currently buffered chunk
    buf: Uint8Array;

    // Set when the stream has started
    started: boolean;

    // Set when there's no more data
    ended: boolean;

    // Headers for this data
    headers: Record<string, string>;

    // Wait for start
    onstart: () => void;

    // Called when we're ready for more data
    readyForData: () => void;

    // Called when we have data
    dataAvailable: () => void;

    // A timeout in case the page is closed prematurely
    timeout: number;
}

// Current streams
const streams: Record<string, Stream> = Object.create(null);

// Wait for clients
self.addEventListener("message", async function(ev) {
    if (ev.data.c !== "port")
        return;
    const port = ev.data.p;
    port.onmessage = ev => {
        message(port, ev);
    };
});

// Messages from clients
async function message(port: MessagePort, ev: MessageEvent) {
    const msg = ev.data;
    switch (msg.c) {
        case "setup":
            // Ack with our version
            port.postMessage({c: "ack", i: msg.i, v: 5});
            return;

        case "ping":
            // Pong
            port.postMessage({c: "pong", i: msg.i});
            return;

        case "stream":
            stream(msg);
            break;

        case "wait-start":
            await waitStart(msg);
            break;

        case "data":
        case "end":
        case "keepalive":
            await data(msg);
            break;

        default:
            // Unrecognized message!
            port.postMessage({c: "nack", i: msg.i});
            return;
    }
    port.postMessage({c: "ack", i: msg.i});
}

/**
 * Set up a stream.
 */
function stream(msg: any) {
    streams[msg.u] = {
        buf: null,
        started: false,
        ended: false,
        headers: msg.h,
        onstart: null,
        readyForData: null,
        dataAvailable: null,
        timeout: null
    };
}

/**
 * Wait for this stream to start.
 */
async function waitStart(msg: any) {
    const stream = streams[msg.u];
    if (!stream)
        return; // FIXME
    if (stream.started)
        return;
    await new Promise<void>(res => stream.onstart = res);
}

/**
 * Send some data.
 */
async function data(msg: any) {
    const stream = streams[msg.u];

    // Set the timeout
    if (stream.timeout)
        clearTimeout(stream.timeout);
    stream.timeout = setTimeout(() => {
        stream.ended = true;
        if (stream.dataAvailable)
            stream.dataAvailable();
    }, 30000);
    if (msg.c === "keepalive") {
        // Nothing else to do
        return;
    }

    while (stream.buf) {
        // Need to wait to buffer this data!
        await new Promise<void>(res => stream.readyForData = res);
        stream.readyForData = null;
    }

    if (msg.c === "data") {
        stream.buf = msg.b;
    } else { // msg.c === "end"
        stream.ended = true;
    }

    if (stream.dataAvailable)
        stream.dataAvailable();
}

// Prepare to fetch
self.addEventListener("fetch", (ev: any) => {
    const urlF = new URL(ev.request.url);
    const url = urlF.pathname;

    if (url.indexOf("/download-stream-service-worker/") !== 0) {
        // Not even our stream?
        return fetch(url);
    }

    // Keep the service worker alive with pings
    if (url.endsWith("/download-stream-service-worker-ping")) {
        ev.respondWith(new Response("pong", {
            status: 200,
            headers: {
                "content-type": "text/plain",
                "cross-origin-embedder-policy": "require-corp"
            }
        }));
        return;
    }
    if (url.endsWith("/download-stream-service-worker-pinger.html")) {
        ev.respondWith(new Response(pinger, {
            status: 200,
            headers: {
                "content-type": "text/html",
                "cross-origin-embedder-policy": "require-corp"
            }
        }));
        return;
    }

    if (!(url in streams)) {
        // No stream!
        ev.respondWith(new Response("404", {status: 404}));
        return;
    }
    const stream = streams[url];
    stream.started = true;
    if (stream.onstart)
        stream.onstart();

    // Stream our response
    ev.respondWith(new Response(new ReadableStream({
        async pull(controller) {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                if (stream.buf) {
                    controller.enqueue(stream.buf);
                    stream.buf = null;
                    if (stream.readyForData)
                        stream.readyForData();
                    break;

                } else if (stream.ended) {
                    controller.close();
                    break;

                } else {
                    // Wait for data
                    await new Promise<void>(res => stream.dataAvailable = res);

                }
            }
        }
    }), {
        status: 200,
        headers: stream.headers
    }));
});
