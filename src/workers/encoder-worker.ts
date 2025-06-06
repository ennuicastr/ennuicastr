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

import * as ifEnc from "../iface/encoder";
import * as ifLibav from "../iface/libav";
import * as inh from "./in-handler";

import * as rpcReceiver from "@ennuicastr/mprpc/receiver-worker";
import * as rpcTarget from "@ennuicastr/mprpc/target";

import type * as LibAVT from "libav.js";
declare let LibAV: LibAVT.LibAVWrapper;

declare let __filename: string;
(<any> globalThis).__filename = "";

__filename = `../${ifLibav.libavPath}`; // To "trick" wasm loading
(<any> globalThis).LibAV = {base: `../${ifLibav.libavDir}`};
importScripts(__filename);

class Encoder
    implements
        rpcReceiver.RPCReceiver<ifEnc.Encoder>,
        rpcTarget.Async<ifEnc.EncoderRev>
{
    init(opts: ifEnc.EncoderOpts): void {
        this.opts = opts;
        this._reverse = new rpcTarget.RPCTarget(opts.reverse);
    }

    encode(port: MessagePort, trackNo: number): void {
        this.encoderTrack(port, trackNo);
    }

    async encoderTrack(port: MessagePort, trackNo: number) {
        const self = this;

        const {
            channel,
            format,
            inSampleRate,
            outSampleRate
        } = this.opts!;

        const outputChannelLayout = this.opts!.outChannelLayout
            ? this.opts!.outChannelLayout
            : 4;

        let p: Promise<unknown> = Promise.all([]);
        let pts = 0;
        let seq = 0;

        let libav: LibAVT.LibAV;

        let c: number, frame: number, pkt: number;
        let channelCount = -1;
        let channelLayout = 0;
        let filterGraph = 0;
        let buffersrc_ctx = 0, buffersink_ctx = 0;

        // Load libav
        libav = await LibAV.LibAV({noworker: true});

        const encOptions: LibAVT.AVCodecContextProps = {
            sample_rate: outSampleRate,
            frame_size: outSampleRate * 20 / 1000,
            channel_layout: outputChannelLayout,
            sample_fmt: libav.AV_SAMPLE_FMT_FLT
        };

        if (format === "flac") {
            encOptions.sample_fmt = libav.AV_SAMPLE_FMT_S32;
        } else {
            encOptions.bit_rate = 128000;
        }

        // Create the encoder
        [, c, frame, pkt, encOptions.frame_size] = await libav.ff_init_encoder(
            (format==="flac")?"flac":"libopus", <any> {
                ctx: encOptions,
                time_base: [1, outSampleRate]
            });

        // Now we're prepared for input
        new inh.InHandler(port, ondata);

        function ondata(ts: number, data: Float32Array[]) {
            if (channelCount !== data.length) {
                // Reinitialize with the correct channel count
                if (filterGraph) {
                    libav.avfilter_graph_free_js(filterGraph);
                    filterGraph = 0;
                }

                channelCount = data.length;
                channelLayout = 4;
                if (channelCount > 1)
                    channelLayout = Math.pow(2, channelCount) - 1;

                // Create the filter in the background
                (async () => {
                    [filterGraph, buffersrc_ctx, buffersink_ctx] =
                        await libav.ff_init_filter_graph("anull", {
                            sample_rate: inSampleRate,
                            sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
                            channel_layout: channelLayout
                        }, {
                            sample_rate: encOptions.sample_rate,
                            sample_fmt: encOptions.sample_fmt,
                            channel_layout: outputChannelLayout,
                            frame_size: encOptions.frame_size
                        });
                })();
            }

            if (!filterGraph) {
                // Filter graph not yet initialized
                return;
            }

            // Put it in libav format
            if (channel >= 0 && data.length > channel)
                data = [data[channel]];
            while (data.length < channelCount)
                data = data.concat(data);
            const frames = [{
                data: data,
                channels: channelCount,
                channel_layout: channelLayout,
                format: libav.AV_SAMPLE_FMT_FLTP,
                pts: pts,
                sample_rate: inSampleRate
            }];
            pts += data[0].length;

            p = p.then(async () => {
                // Filter
                const filterFrames = await libav.ff_filter_multi(
                    buffersrc_ctx, buffersink_ctx, frame, frames
                );
                if (filterFrames.length === 0)
                    return;

                // Encode
                const encPackets = await libav.ff_encode_multi(
                    c, frame, pkt, filterFrames
                );
                if (encPackets.length === 0)
                    return;

                // They only need the raw data
                const packets: Uint8Array[] = [];
                for (let pi = 0; pi < encPackets.length; pi++)
                    packets.push(encPackets[pi].data);

                // Send the encoded packets to the *host*
                self.packets(
                    ts, trackNo, seq, packets
                );
                seq += packets.length;

            }).catch(console.error);
        }
    }

    async packets(
        ts: number, trackNo: number, seq: number,
        packets: Uint8Array[]
    ): Promise<void> {
        this._reverse!.rpcv(
            "packets",
            [ts, trackNo, seq, packets],
            packets.map(x => x.buffer)
        );
    }

    private _reverse?: rpcTarget.RPCTarget;
    opts?: ifEnc.EncoderOpts;
}

rpcReceiver.rpcWorkerMain(new Encoder());
