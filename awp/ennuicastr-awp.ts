/*
 * Copyright (c) 2018-2021 Yahweasel
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

declare var AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

declare function registerProcessor(
    name: string,
    processorCtor: (new (
        options?: AudioWorkletNodeOptions
    ) => AudioWorkletProcessor) & {
        parameterDescriptors?: AudioParamDescriptor[];
    }
);

// General-purpose processor for doing work in a Worker
class WorkerProcessor extends AudioWorkletProcessor {
    workerPort: MessagePort;
    buffer: Float32Array[][];

    /*
    last: number;
    ct: number;
    */

    constructor(options?: AudioWorkletNodeOptions) {
        super(options);

        this.buffer = [];
        /*
        this.last = 0;
        this.ct = 0;
        */

        this.port.onmessage = ev => {
            var msg = ev.data;
            switch (msg.c) {
                case "workerPort":
                    this.workerPort = msg.p;
                    this.workerPort.onmessage = ev => {
                        this.buffer.push(ev.data.d);
                    };
                    break;
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        if (!this.workerPort)
            return true;

        /*
        var now = Date.now();
        if (now > this.last + 1000) {
            console.log(this.ct);
            this.last = now;
            this.ct = 0;
        }
        this.ct++;
        */

        // Send inputs to the worker
        this.workerPort.postMessage({c: "data", t: Date.now(), d: inputs[0]} /*, inputs[0].map(x => x.buffer)*/);

        // And buffered output out
        var out = outputs[0];
        var i = 0, len = out[0].length;
        while (i < len && this.buffer.length) {
            var remain = len - i;
            var first = this.buffer[0];

            if (first[0].length > remain) {
                // First has enough to fill out the remainder
                for (var c = 0; c < out.length; c++)
                    out[c].set(first[c%first.length].subarray(0, remain), i);
                for (var c = 0; c < first.length; c++)
                    first[c] = first[c].subarray(remain);
                i += remain;

            } else {
                // Use all of the data from first
                for (var c = 0; c < out.length; c++)
                    out[c].set(first[c%first.length], i);
                i += first[0].length;
                this.buffer.shift();

            }
        }

        return true;
    }
}

registerProcessor("worker-processor", WorkerProcessor);
