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


// SAB is unreliable on Safari
const canShared = typeof SharedArrayBuffer !== "undefined" &&
    (navigator.userAgent.indexOf("Safari") === -1 ||
     navigator.userAgent.indexOf("Chrome") !== -1);
const bufSz = 96000;

/**
 * Output handler.
 */
export class OutHandler {
    constructor(
        /**
         * The message port targeting this receiver.
         */
        public port: MessagePort,

        /**
         * Wait for the other side to request whether to try shared.
         */
        public waitForInit: boolean = false
    ) {
        this.outgoing = null;
        this.outgoingH = null;
        this._initialized = !waitForInit;

        if (waitForInit) {
            port.addEventListener("message", this.onmessage.bind(this));
            port.start();
        }
    }

    /**
     * Send this data.
     * @param data  The data itself.
     */
    send(data: Float32Array[]) {
        if (!this._initialized)
            return;

        const len = data[0].length;

        if (canShared && this.tryShared && !this.outgoing) {
            // Set up our shared memory buffer
            this.outgoing = [];
            for (let ci = 0; ci < data.length; ci++) {
                this.outgoing.push(
                    new Float32Array(
                        new SharedArrayBuffer(bufSz * 4)
                    )
                );
            }
            this.outgoingH = new Int32Array(new SharedArrayBuffer(4));

            // Tell them about the buffers
            this.port.postMessage({
                c: "buffers",
                buffers: this.outgoing,
                head: this.outgoingH
            });
        }

        if (canShared && this.tryShared) {
            // Write it into the buffer
            let writeHead = this.outgoingH[0];
            if (writeHead + len > bufSz) {
                // We wrap around
                const brk = bufSz - writeHead;
                for (let i = 0; i < this.outgoing.length; i++) {
                    this.outgoing[i].set(data[i%data.length].subarray(0, brk), writeHead);
                    this.outgoing[i].set(data[i%data.length].subarray(brk), 0);
                }
            } else {
                // Simple case
                for (let i = 0; i < this.outgoing.length; i++)
                    this.outgoing[i].set(data[i%data.length], writeHead);
            }
            writeHead = (writeHead + len) % bufSz;
            Atomics.store(this.outgoingH, 0, writeHead);

            // Notify the worker
            Atomics.notify(this.outgoingH, 0);

        } else {
            // Just send the data. Minimize allocation by sending plain.
            this.port.postMessage(data);

        }
    }

    /**
     * Message handler for initialization.
     */
    onmessage(ev: MessageEvent) {
        const msg = ev.data;
        if (msg && msg.c === "out") {
            this.tryShared = !!msg.tryShared;
            this._initialized = true;
        }
    }

    /**
     * Should we try to use shared memory?
     */
    public tryShared = true;

    /**
     * The outgoing data, if shared.
     */
    private outgoing: Float32Array[];

    /**
     * The write head, if shared.
     */
    private outgoingH: Int32Array;

    /**
     * Has this output handler been initialized?
     */
    private _initialized = false;
}
