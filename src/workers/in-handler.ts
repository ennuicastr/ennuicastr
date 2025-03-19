/*
 * Copyright (c) 2018-2025 Yahweasel
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


// Code for an atomic waiter, which simply informs us whenever the write head changes
const waitWorkerCode = `
onmessage = function(ev) {
    var buf = ev.data;
    var prevVal = Atomics.load(buf, 0);
    while (Atomics.wait(buf, 0, prevVal)) {
        var ts = Date.now();
        var newVal = Atomics.load(buf, 0);
        if (prevVal !== newVal) {
            postMessage([ts, prevVal, newVal]);
            prevVal = newVal;
        }
    }
};
`;

// Handler for data from the capture
export class InHandler {
    // If we're using shared buffers, these are set
    incoming: Float32Array[];
    incomingH: Int32Array;
    waitWorker: Worker;

    constructor(
        /**
         * Input port.
         */
        public port: MessagePort,

        /**
         * Function to call when data is received.
         */
        public ondata: (ts: number, data: Float32Array[]) => unknown
    ) {
        port.onmessage = this.onmessage.bind(this);
    }

    /**
     * Handler for captured data.
     */
    onmessage(ev: MessageEvent) {
        const msg = ev.data;

        if (msg.length) {
            // Raw data
            this.ondata(Date.now(), msg);

        } else if (msg.c === "buffers") {
            // Input buffers
            const incoming = this.incoming = msg.buffers;
            this.incomingH = msg.head;

            // Create a worker to inform us when we have incoming data
            const ww = this.waitWorker =
                new Worker("data:application/javascript," +
                    encodeURIComponent(waitWorkerCode));
            ww.onmessage = ev => {
                const [ts, start, end]: [number, number, number] = ev.data;

                // Make sure there's a memory fence in this thread
                Atomics.load(this.incomingH, 0);

                if (end < start) {
                    // We wrapped around. Make it one message.
                    const len = end - start + incoming[0].length;
                    const brk = incoming[0].length - start;
                    const buf: Float32Array[] = [];
                    for (let i = 0; i < incoming.length; i++) {
                        const sbuf = new Float32Array(len);
                        sbuf.set(incoming[i].subarray(start), 0);
                        sbuf.set(incoming[i].subarray(0, end), brk);
                        buf.push(sbuf);
                    }
                    this.ondata(ts, buf);

                } else {
                    // Simple case
                    this.ondata(ts, incoming.map(x => x.slice(start, end)));

                }
            };

            // Start it up
            ww.postMessage(this.incomingH);

            return;

        }
    }
}
