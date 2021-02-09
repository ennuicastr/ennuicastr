/*
 * Copyright (c) 2020 Yahweasel
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

// extern
declare var LibAV: any, webkitAudioContext: any;

import * as audio from "./audio";
import * as waveform from "./waveform";

// Can we do compression?
export const supported = (typeof webkitAudioContext === "undefined");

// A compressor for a particular user
interface Compressor {
    ac: AudioContext & {ecDestination?: MediaStreamAudioDestinationNode};
    inputStream: MediaStream;
    input: MediaStreamAudioSourceNode;
    waveview: ScriptProcessorNode;
    compressor: ScriptProcessorNode;
    cp: Promise<unknown>;
    pts: number;
    buffer: Float32Array;
    gain: GainNode;
}

export var rtcCompression = {
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
export function createCompressor(idx: number, ac: AudioContext & {ecDestination?: MediaStreamAudioDestinationNode}, inputStream: MediaStream, wrapper: HTMLElement, canvas: HTMLCanvasElement) {
    // Destroy any previous compressor
    if (rtcCompression.compressors[idx])
        destroyCompressor(idx);

    var com: Compressor = {
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
    var input = com.input = ac.createMediaStreamSource(inputStream);

    if (supported) {
        // Create a waveform node
        var waveview = com.waveview = ac.createScriptProcessor(1024);
        var wf = new waveform.Waveform(wrapper, canvas, null);
        waveview.onaudioprocess = function(ev: AudioProcessingEvent) {
            // Transfer input to output
            var ib = ev.inputBuffer.getChannelData(0);
            for (var ci = 0; ci < ev.outputBuffer.numberOfChannels; ci++)
                ev.outputBuffer.getChannelData(ci).set(ib);

            // Get the max
            var max = 0;
            for (var i = 0; i < ib.length; i++) {
                let v = ib[i];
                if (v < 0) v = -v;
                if (v > max) max = v;
            }
            wf.push(max, (max < 0.0001) ? 1 : 3);
            wf.updateWave(max, true);
        }

        // Create a compression node
        var compressor = com.compressor = ac.createScriptProcessor(1024);
        var la: any, frame: any;
        audio.loadLibAV().then(function() {
            return LibAV.LibAV();
        }).then(function(ret: any) {
            la = ret;
            return la.av_frame_alloc();
        }).then(function(ret: any) {
            frame = ret;
            return la.ff_init_filter_graph("dynaudnorm=f=10:g=3", {
                sample_rate: ac.sampleRate,
                sample_fmt: la.AV_SAMPLE_FMT_FLT,
                channels: 1,
                channel_layout: 4
            }, {
                sample_rate: ac.sampleRate,
                sample_fmt: la.AV_SAMPLE_FMT_FLT,
                channels: 1,
                channel_layout: 4,
                frame_size: 1024
            });

        }).then(function(ret: any) {
            var filter_graph = ret[0];
            var buffersrc_ctx = ret[1];
            var buffersink_ctx = ret[2];

            compressor.onaudioprocess = function(ev: AudioProcessingEvent) {
                // Handle input
                var ib = ev.inputBuffer.getChannelData(0).slice(0);
                com.cp = com.cp.then(function() {
                    return la.av_frame_alloc();
                }).then(function(ret) {
                    var frames = [{
                        data: ib,
                        channels: 1,
                        channel_layout: 4,
                        format: la.AV_SAMPLE_FMT_FLT,
                        pts: com.pts,
                        sample_rate: ac.sampleRate
                    }];
                    com.pts += ib.length;
                    return la.ff_filter_multi(buffersrc_ctx, buffersink_ctx, frame, frames, false);
                }).then(function(frames) {
                    for (var fi = 0; fi < frames.length; fi++) {
                        var frame = frames[fi].data;
                        var buffer = new Float32Array(com.buffer.length + frame.length);
                        buffer.set(com.buffer);
                        buffer.set(frame, com.buffer.length);
                        com.buffer = buffer;
                    }
                }).catch(console.error);

                // Handle output
                var ob = ev.outputBuffer.getChannelData(0);
                if (com.buffer.length >= ob.length) {
                    ob.set(com.buffer.subarray(0, ob.length));
                    com.buffer = com.buffer.slice(ob.length);

                    // Copy to other channels
                    for (var ci = 1; ci < ev.outputBuffer.numberOfChannels; ci++)
                        ev.outputBuffer.getChannelData(ci).set(ob);
                }
                if (com.buffer.length > 2048)
                    com.buffer = com.buffer.slice(com.buffer.length - 2048);
            };

        }).catch(console.error);
    }

    // Create the final gain node
    var gain = com.gain = ac.createGain();
    gain.gain.value = rtcCompression.gain *
        ((idx in rtcCompression.perUserGain) ? rtcCompression.perUserGain[idx] : 1);

    // Link them together
    var cur: AudioNode = input;
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
    var cs = rtcCompression.compressors;
    while (cs.length <= idx)
        cs.push(null);
    cs[idx] = com;

    return com;
}

// Destroy a compressor
export function destroyCompressor(idx: number) {
    var com = rtcCompression.compressors[idx];
    if (!com)
        return;
    rtcCompression.compressors[idx] = null;

    var cur: AudioNode = com.input;
    if (com.waveview) {
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
        var cur: AudioNode = com.input;
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
        var cur: AudioNode = com.input;
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
export function setWaveviewing(to: boolean) {
    if (rtcCompression.waveviewing === to || !supported)
        return;

    // Change it
    disconnectNodes();
    rtcCompression.waveviewing = to;

    // And reconnect all the nodes
    reconnectNodes();
}

// En/disable compression
export function setCompressing(to: boolean) {
    if (rtcCompression.compressing === to || !supported)
        return;

    // Change it
    disconnectNodes();
    rtcCompression.compressing = to;

    // And reconnect all the nodes
    reconnectNodes();
}

// Change the global gain
export function setGlobalGain(to: number) {
    rtcCompression.gain = to;

    // Update all the gain nodes
    for (var idx = 0; idx < rtcCompression.compressors.length; idx++) {
        var com = rtcCompression.compressors[idx];
        if (!com) continue;
        var target = to *
            ((idx in rtcCompression.perUserGain) ? rtcCompression.perUserGain[idx] : 1);
        com.gain.gain.setTargetAtTime(target, 0, 0.003);
    }
}

// Change the per-user gain
export function setPerUserGain(idx: number, to: number) {
    rtcCompression.perUserGain[idx] = to;

    var com = rtcCompression.compressors[idx];
    if (!com) return;

    var target = rtcCompression.gain * to;
    com.gain.gain.setTargetAtTime(target, 0, 0.003);
}
