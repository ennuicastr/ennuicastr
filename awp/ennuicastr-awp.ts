/*
 * Copyright (c) 2018-2022 Yahweasel
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

/* These declarations are from https://github.com/joanrieu at
 * https://github.com/microsoft/TypeScript/issues/28308#issuecomment-650802278 */
interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean;
}

declare const AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

declare function registerProcessor(
    name: string,
    processorCtor: (new (
        options?: AudioWorkletNodeOptions
    ) => AudioWorkletProcessor) & {
        parameterDescriptors?: any[];
    }
);

// Size of our shared buffer
const bufSz = 96000;

// General-purpose processor for doing work in a Worker
class WorkerProcessor extends AudioWorkletProcessor {
    workerPort: MessagePort;
    canShared: boolean;

    /* OUTGOING: a number of shared buffers equal to the number of channels,
     * and a shared read/write head */
    outgoing: Float32Array[];
    outgoingRW: Int32Array;

    // INCOMING
    incoming: Float32Array[];
    incomingRW: Int32Array;

    constructor(options?: AudioWorkletNodeOptions) {
        super(options);

        // Can we use shared memory?
        this.canShared =
            typeof SharedArrayBuffer !== "undefined";

        // The only message from the AWP port is the worker port
        this.port.onmessage = ev => {
            const msg = ev.data;
            switch (msg.c) {
                case "workerPort":
                    this.workerPort = msg.p;
                    this.workerPort.onmessage = ev => {
                        // Message-passing data receipt
                        let writeHead = this.incomingRW[1];
                        const buf = ev.data.d;
                        const len = buf[0].length;
                        if (writeHead + len > bufSz) {
                            // We loop around
                            const brk = bufSz - writeHead;
                            for (let i = 0; i < this.incoming.length; i++) {
                                this.incoming[i].set(buf[i%buf.length].subarray(0, brk), writeHead);
                                this.incoming[i].set(buf[i%buf.length].subarray(brk), 0);
                            }
                        } else {
                            // Simple case
                            for (let i = 0; i < this.incoming.length; i++)
                                this.incoming[i].set(buf[i%buf.length], writeHead);
                        }
                        writeHead = (writeHead + len) % bufSz;
                        this.incomingRW[1] = writeHead;
                    };
                    break;
            }
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        if (!this.workerPort || inputs.length === 0)
            return true;

        // Find an input to use
        let inputIndex = 0;
        for (; inputIndex < inputs.length &&
               inputs[inputIndex].length === 0;
               inputIndex++) {}
        if (inputIndex >= inputs.length)
            return true;
        const inp = inputs[inputIndex];

        // SETUP

        if (!this.incoming) {
            const chans = inp.length;
            this.incoming = [];
            for (let i = 0; i < chans; i++) {
                this.incoming.push(new Float32Array(
                    this.canShared ?
                        new SharedArrayBuffer(bufSz * 4)
                      : new ArrayBuffer(bufSz * 4)
                ));
            }
            this.incomingRW = new Int32Array(
                this.canShared ?
                    new SharedArrayBuffer(8)
                  : new ArrayBuffer(8)
            );

            if (this.canShared) {
                // Don't need outgoing at all if we can't use shared memory
                this.outgoing = [];
                for (let i = 0; i < chans; i++) {
                    this.outgoing.push(new Float32Array(new SharedArrayBuffer(bufSz * 4)));
                }
                this.outgoingRW = new Int32Array(new SharedArrayBuffer(8));

                // Tell the worker about our buffers
                console.log("[INFO] AWP: Using shared memory");
                this.workerPort.postMessage({
                    c: "buffers",
                    incoming: this.incoming,
                    incomingRW: this.incomingRW,
                    outgoing: this.outgoing,
                    outgoingRW: this.outgoingRW
                });
            } else {
                console.log("[INFO] AWP: Not using shared memory");
            }
        }

        // INPUT (outgoing)

        // Transmit our current data
        if (this.canShared) {
            // Write it into the buffer
            let writeHead = this.outgoingRW[1];
            const len = inp[0].length;
            if (writeHead + len > bufSz) {
                // We wrap around
                const brk = bufSz - writeHead;
                for (let i = 0; i < this.outgoing.length; i++) {
                    this.outgoing[i].set(inp[i%inp.length].subarray(0, brk), writeHead);
                    this.outgoing[i].set(inp[i%inp.length].subarray(brk), 0);
                }
            } else {
                // Simple case
                for (let i = 0; i < this.outgoing.length; i++)
                    this.outgoing[i].set(inp[i%inp.length], writeHead);
            }
            writeHead = (writeHead + len) % bufSz;
            Atomics.store(this.outgoingRW, 1, writeHead);

            // Notify the worker
            Atomics.notify(this.outgoingRW, 1);

        } else {
            /* Just send the data, along with a timestamp. Minimize allocation
             * by sending plain */
            this.workerPort.postMessage(Date.now());
            this.workerPort.postMessage(inp);

        }

        // OUTPUT (incoming)

        let readHead: number = this.incomingRW[0];
        let writeHead: number;
        if (this.canShared)
            writeHead = Atomics.load(this.incomingRW, 1);
        else
            writeHead = this.incomingRW[1];
        if (readHead === writeHead)
            return true;
        let len = writeHead - readHead;
        if (len < 0)
            len += bufSz;

        // Drain any excess buffer
        if (len > 4800) {
            readHead = writeHead - 4800;
            if (readHead < 0)
                readHead += bufSz;
        }

        // Don't use too little data
        if (len < outputs[0].length)
            return true;

        // Finally, send the buffered output
        const out = outputs[0];
        const readEnd = (readHead + out[0].length) % bufSz;
        if (readEnd < readHead) {
            // We wrap around
            const brk = bufSz - readHead;
            for (let i = 0; i < out.length; i++) {
                out[i].set(this.incoming[i%this.incoming.length].subarray(readHead), 0);
                out[i].set(this.incoming[i%this.incoming.length].subarray(0, readEnd), brk);
            }
        } else {
            // Simple case
            for (let i = 0; i < out.length; i++) {
                out[i].set(this.incoming[i%this.incoming.length].subarray(readHead, readEnd), 0);
            }
        }

        // And update the read head
        if (this.canShared) {
            Atomics.store(this.incomingRW, 0, readEnd);
            Atomics.notify(this.incomingRW, 0);
        } else {
            this.incomingRW[0] = readEnd;
        }

        return true;
    }
}

registerProcessor("worker-processor", WorkerProcessor);
