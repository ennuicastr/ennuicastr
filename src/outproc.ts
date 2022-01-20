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

/* NOTE: The functionality in this file relates to dynamic range compression,
 * NOT digital audio compression.
 *
 * Actually, this does all output processing, but for historical reasons, a lot
 * of it is called "compress". */

import * as capture from "./capture";
import * as net from "./net";
import * as ui from "./ui";
import * as waveform from "./waveform";

// Can we do compression?
export const supported = !capture.isSafari();

// A compressor for a particular user
interface Compressor {
    ac: AudioContext & {ecDestination?: MediaStreamAudioDestinationNode};
    inputStream: MediaStream;
    input: MediaStreamAudioSourceNode;
    waveview: AudioNode;
    compressor: AudioNode;
    cp: Promise<unknown>;
    pts: number;
    buffer: Float32Array;
    gain: GainNode;
}

export const rtcCompression = {
    // Should we be displaying waveforms?
    waveviewing: false,

    // Should we be compressing? (Global)
    compressing: supported,

    // Global gain value
    gain: 1,

    // For each user, what is their independent gain
    perUserGain: <{[key: number]: number}> {},

    // The compressor for each user
    compressors: <Compressor[]> []
};

// Create a compressor and gain node
export function createCompressor(
    idx: number,
    ac: AudioContext & {ecDestination?: MediaStreamAudioDestinationNode},
    inputStream: MediaStream, wrapper: HTMLElement): Promise<void|Compressor> {

    // Destroy any previous compressor
    if (rtcCompression.compressors[idx])
        destroyCompressor(idx);

    const com: Compressor = {
        ac: ac,
        inputStream: inputStream,
        input: null,
        waveview: null,
        compressor: null,
        cp: Promise.all([]),
        pts: 0,
        buffer: new Float32Array(0),
        gain: null
    };

    // Create the input
    const input = com.input = ac.createMediaStreamSource(inputStream);

    return Promise.all([]).then(() => {
        // Only build the waveview and compressor if supported
        if (supported) {
            let waveviewCap: capture.Capture;
            let wf: waveform.Waveform;
            let compressorCap: capture.Capture;

            return Promise.all([]).then(() => {
                // Create a waveform node
                return capture.createCapture(ac, {
                    bufferSize: 1024,
                    workerCommand: {c: "max"}
                });

            }).then(ret => {
                waveviewCap = ret;
                com.waveview = waveviewCap.node;
                wf = new waveform.Waveform("" + idx, ac.sampleRate / 1024, wrapper, null);
                waveviewCap.worker.onmessage = function(ev) {
                    const max = ev.data.m;
                    wf.push(max, (max < 0.0001) ? 1 : 3);
                    wf.updateWave(max, true);
                };

                // Create a compression node
                return capture.createCapture(ac, {
                    bufferSize: 1024,
                    workerCommand: {c: "dynaudnorm"}
                });

            }).then(ret => {
                compressorCap = ret;
                com.compressor = compressorCap.node;

            });
        }

    }).then(() => {
        // Create the final gain node
        const gain = com.gain = ac.createGain();
        gain.gain.value = rtcCompression.gain *
            ((idx in rtcCompression.perUserGain) ? rtcCompression.perUserGain[idx] : 1);

        // Link them together
        let cur: AudioNode = input;
        if (com.waveview && rtcCompression.waveviewing) {
            input.connect(com.waveview);
            cur = com.waveview;
        }
        if (com.compressor && rtcCompression.compressing) {
            cur.connect(com.compressor);
            cur = com.compressor;
        }
        cur.connect(gain);
        gain.connect(ac.ecDestination);

        // And add it to the list
        const cs = rtcCompression.compressors;
        while (cs.length <= idx)
            cs.push(null);
        cs[idx] = com;

        return com;

    }).catch(net.promiseFail());
}

// Destroy a compressor
export function destroyCompressor(idx: number): void {
    const com = rtcCompression.compressors[idx];
    if (!com)
        return;
    rtcCompression.compressors[idx] = null;

    let cur: AudioNode = com.input;
    if (com.waveview && rtcCompression.waveviewing) {
        cur.disconnect(com.waveview);
        cur = com.waveview;
    }
    if (com.compressor && rtcCompression.compressing) {
        cur.disconnect(com.compressor);
        cur = com.compressor;
    }
    cur.disconnect(com.gain);
    com.gain.disconnect(com.ac.ecDestination);
}

// Disconnect all audio nodes
function disconnectNodes() {
    rtcCompression.compressors.forEach(function(com) {
        if (!com) return;
        let cur: AudioNode = com.input;
        if (rtcCompression.waveviewing) {
            cur.disconnect(com.waveview);
            cur = com.waveview;
        }
        if (rtcCompression.compressing) {
            cur.disconnect(com.compressor);
            cur = com.compressor;
        }
        cur.disconnect(com.gain);
    });
}

// Reconnect nodes based on the current waveviewing/compressing mode
function reconnectNodes() {
    rtcCompression.compressors.forEach(function(com) {
        if (!com) return;
        let cur: AudioNode = com.input;
        if (rtcCompression.waveviewing) {
            cur.connect(com.waveview);
            cur = com.waveview;
        }
        if (rtcCompression.compressing) {
            cur.connect(com.compressor);
            cur = com.compressor;
        }
        cur.connect(com.gain);
    });
}

// En/disable waveviewing
export function setWaveviewing(to: boolean): void {
    if (rtcCompression.waveviewing === to || !supported)
        return;

    // Change it
    disconnectNodes();
    rtcCompression.waveviewing = to;

    // And reconnect all the nodes
    reconnectNodes();
}

// En/disable compression
export function setCompressing(to: boolean): void {
    if (rtcCompression.compressing === to || !supported)
        return;

    // Change it
    disconnectNodes();
    rtcCompression.compressing = to;

    // And reconnect all the nodes
    reconnectNodes();
}

// Change the global gain
export function setGlobalGain(to: number): void {
    rtcCompression.gain = to;

    // Update all the gain nodes
    for (let idx = 0; idx < rtcCompression.compressors.length; idx++) {
        const com = rtcCompression.compressors[idx];
        if (!com) continue;
        const target = to *
            ((idx in rtcCompression.perUserGain) ? rtcCompression.perUserGain[idx] : 1);
        com.gain.gain.setTargetAtTime(target, 0, 0.003);
    }
}

// Change the per-user gain
function setPerUserGain(idx: number, to: number) {
    rtcCompression.perUserGain[idx] = to;

    const com = rtcCompression.compressors[idx];
    if (!com) return;

    const target = rtcCompression.gain * to;
    com.gain.gain.setTargetAtTime(target, 0, 0.003);
}

ui.ui.outprocSetPerUserGain = setPerUserGain;
