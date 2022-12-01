/*
 * Copyright (c) 2020-2022 Yahweasel
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

import * as capture from "./capture";
import * as config from "./config";
import * as net from "./net";
import * as ui from "./ui";
import * as waveform from "./waveform";

import * as rtennui from "rtennui";

// Can we do compression?
export const supported = !rtennui.audioCapturePlaybackShared();

// A compressor for a particular user
interface Compressor {
    ac: AudioContext & {ecDestination?: MediaStreamAudioDestinationNode};
    capture: capture.Capture,
    worker: Worker,
    output: rtennui.AudioPlayback
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

// Create a compressor and gain node
export async function createCompressor(
    idx: number,
    ac: AudioContext & {ecDestination?: MediaStreamAudioDestinationNode},
    input: MediaStream | AudioNode | Worker, wrapper: HTMLElement
): Promise<void|Compressor> {

    // Destroy any previous compressor
    if (rtcCompression.compressors[idx])
        destroyCompressor(idx);

    let cap: capture.Capture = null;
    let worker: Worker = null;

    // Make our capture if we weren't just handed a worker
    if (!(<Worker> input).terminate) {
        try {
            // Create it
            cap = await capture.createCapture(ac, {
                input: <MediaStream | AudioNode> input,
                workerCommand: {
                    c: "outproc"
                }
            });
        } catch (ex) {
            net.errorHandler(ex);
            config.disconnect();
            throw ex;
        }
        worker = cap.worker;

    } else {
        worker = <Worker> input;

    }

    // Prepare to enable features
    worker.addEventListener("message", ev => {
        const msg = ev.data;
        if (msg.c === "outproc-ready") {
            if (rtcCompression.waveviewing)
                worker.postMessage({c: "max", a: true});
            if (rtcCompression.compressing)
                worker.postMessage({c: "dynaudnorm", a: true});
            let gain = rtcCompression.gain;
            if (idx in rtcCompression.perUserGain)
                gain *= rtcCompression.perUserGain[idx];
            if (gain !== 1)
                worker.postMessage({c: "gain", g: gain});
        }
    });

    // Set up the waveview
    const wf =
        new waveform.Waveform("" + idx, ac.sampleRate / 1024, wrapper, null);
    worker.addEventListener("message", ev => {
        const msg = ev.data;
        if (msg.c !== "max") return;
        const max = msg.m;
        wf.push(max, (max < 0.0001) ? 1 : 3);
        wf.updateWave(max, true);
    });

    // Create the player
    const player = await rtennui.createAudioPlayback(ac);

    const mc = new MessageChannel();
    player.pipeFrom(mc.port2);
    worker.postMessage({
        c: "out",
        p: mc.port1
    }, [mc.port1]);

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
    com.capture.disconnect();
}

// En/disable waveviewing
export function setWaveviewing(to: boolean): void {
    if (rtcCompression.waveviewing === to)
        return;
    rtcCompression.waveviewing = to;
    for (const c of rtcCompression.compressors) {
        if (c)
            c.worker.postMessage({c: "max", a: to});
    }
}

// En/disable compression
export function setCompressing(to: boolean): void {
    if (rtcCompression.compressing === to)
        return;
    rtcCompression.compressing = to;
    for (const c of rtcCompression.compressors) {
        if (c)
            c.worker.postMessage({c: "dynaudnorm", a: to});
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
        com.worker.postMessage({c: "gain", g: gain});
    }
}

// Change the per-user gain
function setPerUserGain(idx: number, to: number) {
    rtcCompression.perUserGain[idx] = to;

    const com = rtcCompression.compressors[idx];
    if (!com) return;

    const gain = rtcCompression.gain * to;
    com.worker.postMessage({c: "gain", g: gain});
}

ui.ui.outprocSetPerUserGain = setPerUserGain;
