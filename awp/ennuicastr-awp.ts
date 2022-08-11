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

// Shared audio buffer with a read-write head
interface SharedBuffer {
    // A number of buffers equal to the number of channels
    buffers: Float32Array[];

    // And our read and write heads
    heads: Int32Array;
}

// General-purpose processor for doing work in a Worker
class WorkerProcessor extends AudioWorkletProcessor {
    canShared: boolean;

    // The workers we're communicating with
    workerPorts: MessagePort[];

    // The shared memory buffers with them
    outgoing: SharedBuffer[];
    incoming: SharedBuffer[];

    constructor(options?: AudioWorkletNodeOptions) {
        super(options);

        // Can we use shared memory?
        this.canShared =
            typeof SharedArrayBuffer !== "undefined";

        this.workerPorts = [];
        this.outgoing = [];
        this.incoming = [];

        // The only message from the AWP port is the worker port
        this.port.onmessage = ev => {
            const msg = ev.data;
            switch (msg.c) {
                case "workerPort":
                {
                    // Find an index
                    let wi = 0;
                    for (; wi < this.workerPorts.length && this.workerPorts[wi]; wi++)
                    if (wi === this.workerPorts.length) {
                        this.workerPorts.push(null);
                        this.incoming.push(null);
                        this.outgoing.push(null);
                    }
                    this.workerPorts[wi] = msg.p;

                    // Prepare for data
                    msg.p.onmessage = ev => {
                        if (!this.incoming[wi])
                            return;

                        // Message-passing data receipt
                        const sbuf = this.incoming[wi];
                        let writeHead = sbuf.heads[1];
                        const buf = ev.data.d;
                        const len = buf[0].length;
                        if (writeHead + len > bufSz) {
                            // We loop around
                            const brk = bufSz - writeHead;
                            for (let i = 0; i < this.incoming.length; i++) {
                                sbuf.buffers[i].set(buf[i%buf.length].subarray(0, brk), writeHead);
                                sbuf.buffers[i].set(buf[i%buf.length].subarray(brk), 0);
                            }
                        } else {
                            // Simple case
                            for (let i = 0; i < this.incoming.length; i++)
                                sbuf.buffers[i].set(buf[i%buf.length], writeHead);
                        }
                        writeHead = (writeHead + len) % bufSz;
                        sbuf.heads[1] = writeHead;
                    };

                    break;
                }
            }
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        if (!this.workerPorts.length || inputs.length === 0)
            return true;

        // Find an input to use
        let inputIndex = 0;
        for (; inputIndex < inputs.length &&
               inputs[inputIndex].length === 0;
               inputIndex++) {}
        if (inputIndex >= inputs.length)
            return true;
        const inp = inputs[inputIndex];


        // For each worker we're connected to
        for (let wi = 0; wi < this.workerPorts.length; wi++) {
            const port = this.workerPorts[wi];
            if (!port) continue;
            let incoming = this.incoming[wi];
            let outgoing = this.outgoing[wi];

            // SETUP

            if (!incoming) {
                const chans = inp.length;
                this.incoming[wi] = incoming = {
                    buffers: [],
                    heads: new Int32Array(
                        this.canShared ?
                            new SharedArrayBuffer(8)
                          : new ArrayBuffer(8)
                        )
                };
                for (let i = 0; i < chans; i++) {
                    incoming.buffers.push(new Float32Array(
                        this.canShared ?
                            new SharedArrayBuffer(bufSz * 4)
                          : new ArrayBuffer(bufSz * 4)
                    ));
                }

                if (this.canShared) {
                    // Don't need outgoing at all if we can't use shared memory
                    this.outgoing[wi] = outgoing = {
                        buffers: [],
                        heads: new Int32Array(new SharedArrayBuffer(8))
                    };
                    for (let i = 0; i < chans; i++) {
                        outgoing.buffers.push(new Float32Array(new SharedArrayBuffer(bufSz * 4)));
                    }

                    // Tell the worker about our buffers
                    console.log("[INFO] AWP: Using shared memory");
                    port.postMessage({
                        c: "buffers",
                        incoming: incoming.buffers,
                        incomingRW: incoming.heads,
                        outgoing: outgoing.buffers,
                        outgoingRW: outgoing.heads
                    });
                } else {
                    console.log("[INFO] AWP: Not using shared memory");
                }
            }

            // INPUT (outgoing)

            // Transmit our current data
            if (this.canShared) {
                // Write it into the buffer
                let writeHead = outgoing.heads[1];
                const len = inp[0].length;
                if (writeHead + len > bufSz) {
                    // We wrap around
                    const brk = bufSz - writeHead;
                    for (let i = 0; i < outgoing.buffers.length; i++) {
                        outgoing.buffers[i].set(inp[i%inp.length].subarray(0, brk), writeHead);
                        outgoing.buffers[i].set(inp[i%inp.length].subarray(brk), 0);
                    }
                } else {
                    // Simple case
                    for (let i = 0; i < outgoing.buffers.length; i++)
                        outgoing.buffers[i].set(inp[i%inp.length], writeHead);
                }
                writeHead = (writeHead + len) % bufSz;
                Atomics.store(outgoing.heads, 1, writeHead);

                // Notify the worker
                Atomics.notify(outgoing.heads, 1);

            } else {
                /* Just send the data, along with a timestamp. Minimize allocation
                 * by sending plain */
                port.postMessage(Date.now());
                port.postMessage(inp);

            }

            // OUTPUT (incoming)

            let readHead: number = incoming.heads[0];
            let writeHead: number;
            if (this.canShared)
                writeHead = Atomics.load(incoming.heads, 1);
            else
                writeHead = incoming.heads[1];
            if (readHead === writeHead)
                continue;
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
                continue;

            // Finally, send the buffered output
            const out = outputs[0];
            const readEnd = (readHead + out[0].length) % bufSz;
            if (readEnd < readHead) {
                // We wrap around
                const brk = bufSz - readHead;
                for (let i = 0; i < out.length; i++) {
                    out[i].set(incoming.buffers[i%incoming.buffers.length].subarray(readHead), 0);
                    out[i].set(incoming.buffers[i%incoming.buffers.length].subarray(0, readEnd), brk);
                }
            } else {
                // Simple case
                for (let i = 0; i < out.length; i++) {
                    out[i].set(incoming.buffers[i%incoming.buffers.length].subarray(readHead, readEnd), 0);
                }
            }

            // And update the read head
            if (this.canShared) {
                Atomics.store(incoming.heads, 0, readEnd);
                Atomics.notify(incoming.heads, 0);
            } else {
                incoming.heads[0] = readEnd;
            }

        }

        return true;
    }
}

registerProcessor("worker-processor", WorkerProcessor);
