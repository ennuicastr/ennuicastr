/*
 * Copyright (c) 2020, 2022 Yahweasel
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
 * Audio capture and playback based on RTEnnui's, with some Ennuicastr-specific
 * flavor.
 */

import * as log from "./log";
import * as util from "./util";

import * as rtennui from "rtennui";

// Worker path to use
const workerVer = "z";
export const workerPath = "awp/ennuicastr-worker.js?v=" + workerVer;

export interface Capture {
    /**
     * The audio context used for this capture.
     */
    ac: AudioContext,

    /**
     * RTEnnui's underlying capture.
     */
    capture: rtennui.AudioCapture,

    /**
     * The worker this capture is communicating with.
     */
    worker: Worker,

    /**
     * Pipe this capture to a playback.
     */
    pipe: (playback: rtennui.AudioPlayback)=>unknown;

    /**
     * Function to disconnect and close this capture.
     */
    disconnect: ()=>unknown
}

export interface CaptureOptions {
    /**
     * Command to send to the worker for this capture.
     */
    workerCommand: any;

    /**
     * Input, as either a MediaStream or an AudioNode.
     */
    input: MediaStream | AudioNode;

    /**
     * Whether to match the sample rate of the input, or use the AudioContext's
     * own sample rate. Because AudioNode is AudioContext-specific, this must
     * be false or unset if input is an AudioNode.
     */
    matchSampleRate?: boolean;

    /**
     * Whether to produce a MediaStream as the destination.
     */
    outStream?: boolean;
}

export const capturePlaybackShared = rtennui.audioCapturePlaybackShared;

// A bank of audio contexts for other sample rates
const sampleRateACs: Record<number, AudioContext> = {};

// Create a capture node
export async function createCapture(
    ac: AudioContext, options: CaptureOptions
): Promise<Capture> {
    // Possibly use a different AudioContext
    if (options.matchSampleRate && !capturePlaybackShared()) {
        const ms = <MediaStream> options.input;
        const msSampleRate = ms.getAudioTracks()[0].getSettings().sampleRate;
        if (msSampleRate !== ac.sampleRate) {
            ac = sampleRateACs[msSampleRate];
            if (!ac) {
                sampleRateACs[msSampleRate] = ac = new AudioContext({
                    latencyHint: "playback",
                    sampleRate: msSampleRate
                });
            }
        }
    }

    const input =
        <(MediaStream | AudioNode) & {
            ecCapture?: Record<number, Promise<rtennui.AudioCapture>>
        }>
        options.input;

    // Create RTEnnui's capture
    if (!input.ecCapture)
        input.ecCapture = {};
    let captureP = input.ecCapture[ac.sampleRate];
    if (!captureP) {
        captureP = input.ecCapture[ac.sampleRate] =
            rtennui.createAudioCapture(ac, input);
    }
    const capture = await captureP;

    // Create our worker
    const worker = new Worker(workerPath);

    // Need a channel for them to communicate
    const mc = new MessageChannel();

    // Set up the worker
    const cmd = Object.assign({
        inSampleRate: ac.sampleRate,
        port: mc.port2
    }, options.workerCommand);
    worker.postMessage(cmd, [mc.port2]);
    capture.pipe(mc.port1, true);

    // Pipe by making a message channel
    function pipe(to: rtennui.AudioPlayback) {
        const mc = new MessageChannel();
        to.pipeFrom(mc.port2);
        worker.postMessage({c: "out", p: mc.port1}, [mc.port1]);
    }

    // Prepare to terminate
    let dead = false;
    function disconnect() {
        if (dead)
            return;
        dead = true;
        capture.close();
        worker.terminate();
    }

    // Done!
    return {
        ac,
        capture,
        worker,
        pipe,
        disconnect: disconnect
    };
}
