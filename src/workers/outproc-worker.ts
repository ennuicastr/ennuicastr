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

import * as inh from "./in-handler";
import * as ifLibav from "../iface/libav";
import * as ifOutproc from "../iface/outproc";
import * as outh from "./out-handler";

import * as rpcReceiver from "@ennuicastr/mprpc/receiver-worker";
import * as rpcTarget from "@ennuicastr/mprpc/target";

import type * as LibAVT from "libav.js";

declare let LibAV: LibAVT.LibAVWrapper;
declare let __filename: string;
(<any> globalThis).__filename = "";

// Load libraries
__filename = `../${ifLibav.libavPath}`;
(<any> globalThis).LibAV = {base: `../${ifLibav.libavDir}`};
importScripts(__filename);

// How many "max" messages to send just to calm down the data with silence
const bufferMax = 8;

class OutputProcessor
    implements
        rpcReceiver.RPCReceiver<ifOutproc.OutputProcessor>,
        rpcTarget.Async<ifOutproc.OutputProcessorRev>
{
    init(opts: ifOutproc.OutProcOpts): void {
        // Load libav in the background
        this._ser = this._ser.catch(console.error).then(async () => {
            const la = this._la = await LibAV.LibAV({noworker: true});
            this._frame = await la.av_frame_alloc();

            const ret =
                await la.ff_init_filter_graph("dynaudnorm=f=10:g=3", {
                    sample_rate: opts.sampleRate,
                    sample_fmt: la.AV_SAMPLE_FMT_FLT,
                    channel_layout: 4
                }, {
                    sample_rate: opts.sampleRate,
                    sample_fmt: la.AV_SAMPLE_FMT_FLT,
                    channel_layout: 4,
                    frame_size: 128
                });

            this._buffersrcCtx = ret[1];
            this._buffersinkCtx = ret[2];
        });

        this._sampleRate = opts.sampleRate;
        this._doMax = opts.max;
        this._doCompress = opts.compress;
        this._gain = opts.gain;

        this._reverse = new rpcTarget.RPCTarget(opts.reverse);
        this._outHandler = new outh.OutHandler(opts.output);
        this._inHandler = new inh.InHandler(opts.input, this.ondata.bind(this));

        // Prepare to send the max even if we don't have data
        setInterval(() => {
            if (this._sentMax >= 0) {
                this._sentMax--;
                return;
            } else if (this._sentMax === 0) {
                // Now send the maxes, but really, send the whole buffer we missed
                for (let i = 1; i < bufferMax; i++)
                    this.max(0);
                this._sentMax--;
            }
            this.max(0);
        }, 1024000 / opts.sampleRate);
    }

    ondata(ts: number, data: Float32Array[]) {
        this._ser = this._ser.catch(console.error).then(async () => {
            // Handle input
            const ib = data[0];
            let ob = [data];

            if (this._doMax) {
                // Find the max
                let max = this._max;
                for (let i = 0; i < ib.length; i++) {
                    let v = ib[i];
                    if (v < 0) v = -v;
                    if (v > max) max = v;
                    if (++this._maxCtr >= 1024) {
                        // Send a max count
                        this.max(max);
                        this._sentMax = bufferMax;
                        max = this._max = this._maxCtr = 0;
                    } else {
                        this._max = max;
                    }
                }
            }

            if (this._doCompress) {
                const la = this._la!;

                // Run it through the compressor
                const inFrames: LibAVT.Frame[] = [{
                    data: <any> ib,
                    channels: 1,
                    channel_layout: 4,
                    format: la.AV_SAMPLE_FMT_FLT,
                    pts: this._pts,
                    sample_rate: this._sampleRate
                }];
                this._pts += ib.length;

                const frames = await la.ff_filter_multi(
                    this._buffersrcCtx, this._buffersinkCtx, this._frame,
                    inFrames, false
                );

                ob = [];
                for (let fi = 0; fi < frames.length; fi++) {
                    const frame = [<any> frames[fi].data];
                    while (frame.length < data.length)
                        frame.push(frame[0]);
                    ob.push(frame);
                }
            }

            if (this._gain !== 1) {
                // Apply gain
                const gain = this._gain;
                for (const frame of ob) {
                    for (const channel of frame) {
                        for (let i = 0; i < channel.length; i++)
                            channel[i] *= gain;
                    }
                }
            }

            // Send it out
            for (const frame of ob)
                this._outHandler!.send(frame);
        });
    }

    setMax(to: boolean): void {
        this._doMax = to;
    }

    setCompress(to: boolean): void {
        this._doCompress = to;
    }

    setGain(to: number): void {
        this._gain = to;
    }

    async max(v: number): Promise<void> {
        this._reverse!.rpcv("max", [v]);
    }

    private _ser: Promise<unknown> = Promise.all([]);

    private _sampleRate = 48000;
    private _doMax = false;
    private _doCompress = false;
    private _gain = 1;

    private _max = 0;
    private _maxCtr = 0;
    private _sentMax = 0;

    private _la?: LibAVT.LibAV;
    private _frame = 0;
    private _pts = 0;
    private _buffersrcCtx = 0;
    private _buffersinkCtx = 0;

    private _reverse?: rpcTarget.RPCTarget;
    private _inHandler?: inh.InHandler;
    private _outHandler?: outh.OutHandler;
}

rpcReceiver.rpcWorkerMain(new OutputProcessor());
