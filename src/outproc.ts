/*
 * Copyright (c) 2020-2025 Yahweasel
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
 * Output processing (in particular, dynamic range compression).
 */

import * as audio from "./audio";
import * as capture from "./capture";
import * as config from "./config";
import * as ifOutproc from "./iface/outproc";
import * as net from "./net";
import * as ui from "./ui";
import * as util from "./util";
import * as waveform from "./waveform";

import * as rpcReceiver from "@ennuicastr/mprpc/receiver";
import * as rpcTarget from "@ennuicastr/mprpc/target";
import * as rtennui from "rtennui";

// Can we do compression?
export const supported = !rtennui.audioCapturePlaybackShared();

// A compressor for a particular user
export interface Compressor {
    ac: audio.ECAudioContext;
    capture?: capture.Capture;
    worker: OutProcWorker;
    output: rtennui.AudioPlayback;
}

/**
 * The worker for output processing.
 */
export class OutProcWorker
    extends rpcTarget.RPCWorker
    implements
        rpcTarget.Async<ifOutproc.OutputProcessor>,
        rpcReceiver.RPCReceiver<ifOutproc.OutputProcessorRev>
{
    constructor(optsBasic: ifOutproc.OutProcOptsBasic & {
        inputPort?: MessagePort
    }) {
        super("libs/ec-outproc-worker.js?v=1");

        const opts = <ifOutproc.OutProcOpts> optsBasic;
        if (optsBasic.inputPort) {
            opts.input = optsBasic.inputPort;
            this.inputPort = optsBasic.inputPort;
        } else {
            const inputMC = new MessageChannel();
            opts.input = inputMC.port1;
            this.inputPort = inputMC.port2;
        }
        const outputMC = new MessageChannel();
        opts.output = outputMC.port1;
        this.outputPort = outputMC.port2;
        const reverseMC = new MessageChannel();
        opts.reverse = reverseMC.port1;
        rpcReceiver.rpcReceiver(this, reverseMC.port2);

        this.init(opts);
    }

    init(opts: ifOutproc.OutProcOpts): Promise<void> {
        return this.rpc(
            "init", [opts],
            [opts.input, opts.output, opts.reverse]
        );
    }

    setMax(to: boolean): Promise<void> {
        return this.rpc("setMax", [to]);
    }

    setCompress(to: boolean): Promise<void> {
        return this.rpc("setCompress", [to]);
    }

    setGain(to: number): Promise<void> {
        return this.rpc("setGain", [to]);
    }

    max(v: number): void {
        if (this.onmax)
            this.onmax(v);
    }

    onmax?: (v: number)=>void;
    inputPort: MessagePort;
    outputPort: MessagePort;
}

export const rtcCompression = {
    // Global shared playback node, if it's shared
    sharedPlayback: <AudioNode> null,

    // Should we be displaying waveforms?
    waveviewing: false,

    // Should we be compressing? (Global)
    compressing: supported,

    // Global gain value
    gain: 1,

    // For each user, what is their independent gain
    perUserGain: <Record<number, number>> {},

    // The compressor for each user
    compressors: <Compressor[]> []
};

// Create an output processor
export async function createCompressor(
    idx: number,
    ac: audio.ECAudioContext,
    input: MediaStream | AudioNode | MessagePort, wrapper: HTMLElement
): Promise<void|Compressor> {

    // Destroy any previous compressor
    if (rtcCompression.compressors[idx])
        destroyCompressor(idx);

    // Make the capture
    let cap: capture.Capture | undefined;
    let inputPort: MessagePort | undefined;
    if ((<MessagePort> input).postMessage) {
        inputPort = <MessagePort> input;
    } else {
        cap = await capture.createCapture(ac, {
            input: <MediaStream | AudioNode> input
        });
    }

    // Make the worker
    let gain = rtcCompression.gain;
    if (idx in rtcCompression.perUserGain)
        gain *= rtcCompression.perUserGain[idx];
    const worker = new OutProcWorker({
        sampleRate: ac.sampleRate,
        max: rtcCompression.waveviewing,
        compress: rtcCompression.compressing,
        gain,
        inputPort
    });

    // Set up the waveview
    const wf =
        new waveform.Waveform("" + idx, ac.sampleRate / 1024, wrapper, null);
    worker.onmax = v => {
        wf.push(v, (v < 0.0001) ? 1 : 3);
        wf.updateWave(v, true);
    };

    // Create the player
    const player = await rtennui.createAudioPlayback(ac);
    player.pipeFrom(worker.outputPort);

    // Hook up the player
    let node = player.unsharedNode();
    if (node) {
        node.connect(ac.ecDestination);

    } else {
        node = player.sharedNode();
        if (node !== rtcCompression.sharedPlayback) {
            node.disconnect();
            node.connect(ac.ecDestination);
            rtcCompression.sharedPlayback = node;
        }

    }

    // Hook up the capture
    if (cap)
        cap.capture.pipe(worker.inputPort);

    // Make the compressor instance
    const com: Compressor = {
        ac,
        capture: cap,
        worker,
        output: player
    };

    // And add it to the list
    const cs = rtcCompression.compressors;
    while (cs.length <= idx)
        cs.push(null);
    cs[idx] = com;

    return com;
}

// Destroy a compressor
export function destroyCompressor(idx: number): void {
    const com = rtcCompression.compressors[idx];
    if (!com)
        return;
    rtcCompression.compressors[idx] = null;
    if (com.capture)
        com.capture.capture.close();
}

// En/disable waveviewing
export function setWaveviewing(to: boolean): void {
    if (rtcCompression.waveviewing === to)
        return;
    rtcCompression.waveviewing = to;
    for (const c of rtcCompression.compressors) {
        if (c)
            c.worker.setMax(to);
    }
}

// En/disable compression
export function setCompressing(to: boolean): void {
    if (rtcCompression.compressing === to)
        return;
    rtcCompression.compressing = to;
    for (const c of rtcCompression.compressors) {
        if (c)
            c.worker.setCompress(to);
    }
}

// Change the global gain
export function setGlobalGain(to: number): void {
    rtcCompression.gain = to;

    // Update all the gain nodes
    for (let idx = 0; idx < rtcCompression.compressors.length; idx++) {
        const com = rtcCompression.compressors[idx];
        if (!com) continue;
        let gain = to;
        if (idx in rtcCompression.perUserGain)
            gain *= rtcCompression.perUserGain[idx];
        com.worker.setGain(gain);
    }
}

// Change the per-user gain
function setPerUserGain(idx: number, to: number) {
    rtcCompression.perUserGain[idx] = to;

    const com = rtcCompression.compressors[idx];
    if (!com) return;

    const gain = rtcCompression.gain * to;
    com.worker.setGain(gain);
}

ui.ui.outprocSetPerUserGain = setPerUserGain;
