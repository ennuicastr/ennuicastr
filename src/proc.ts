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

/*
 * This file is part of Ennuicastr.
 *
 * Input audio processing.
 */

// extern
declare let Ennuiboard: any;

import * as audio from "./audio";
import * as config from "./config";
import * as log from "./log";
import * as net from "./net";
import * as capture from "./capture";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as vad from "./vad";
import * as waveform from "./waveform";

// Set if we've sent data recently
let sentRecently = false;

// A timeout for periodic checks that are done regardless of processing backend
let periodic: null|number = null;

// En/disable noise reduction
export let useNR = false;
export function setUseNR(to: boolean): void { useNR = to; }

// VAD sensitivity (0 to 3, more is less)
export let vadSensitivity = 0;
export function setVadSensitivity(to: number): void { vadSensitivity = to; }

// VAD noise gate (-100 to 0, dB)
export let vadNoiseGate = -100;
export function setVadNoiseGate(to: number): void { vadNoiseGate = to; }

function rtcVad(to: boolean) {
    vad.setRTCVadOn(to);
    util.dispatchEvent("vad.rtc");
}

// All local processing: The VAD, wave display, and noise reduction
export function localProcessing(idx: number): void {
    Promise.all([]).then(function() {
        if (!audio.inputs[idx].userMedia) {
            // Need our MediaSource first!
            return new Promise(res => {
                util.events.addEventListener("usermediaready" + idx, res, {once: true});
            });
        }

    }).then(() => {
        /* Set sentRecently and lastSentTime to slightly in the future so we
         * don't get messages about failing to send while everything starts up
         * */
        sentRecently = true;
        const input = audio.inputs[idx];
        input.lastSentTime = performance.now() + 2500;

        // Some things done periodically other than audio per se
        if (!periodic) {
            periodic = setInterval(function() {
                // Display an issue if we haven't sent recently
                const now = performance.now();
                sentRecently = (input.lastSentTime > now-1500);
                if (sentRecently)
                    log.popStatus("notencoding");
                else
                    log.pushStatus("notencoding", "Audio encoding is not functioning!");

                if (typeof Ennuiboard !== "undefined" && Ennuiboard.enabled.gamepad)
                    Ennuiboard.gamepad.poll();
            }, 100);
        }

        return localProcessingWorker(idx);

    }).catch(net.promiseFail());
}

// Worker-based processing
function localProcessingWorker(idx: number) {
    const input = audio.inputs[idx];

    // Create a display for it, either in the main waveform wrapper or the studio location
    let studio = (ui.ui.video.mode === ui.ViewMode.Studio);
    let wd: waveform.Waveform;
    function studioSwapped() {
        if (studio) {
            const user = ui.ui.video.users[net.selfId];
            if (!user) {
                studio = false;
                studioSwapped();
            } else {
                wd = new waveform.Waveform("self", audio.ac.sampleRate / 1024, user.waveformWrapper, null);
            }
        } else {
            wd = new waveform.Waveform("self", audio.ac.sampleRate / 1024, ui.ui.wave.wrapper, ui.ui.wave.watcher);
        }
    }
    studioSwapped();

    // Start the capture
    return capture.createCapture(audio.ac, {
        ms: input.userMedia,
        bufferSize: 1024,
        outStream: true,
        sampleRate: "sampleRate",
        workerCommand: {
            c: "filter",
            useNR: useNR,
            sentRecently: sentRecently,
            vadSensitivity: vadSensitivity,
            vadNoiseGate: vadNoiseGate,
            useTranscription: config.useTranscription
        }

    }).then(capture => {
        // State to send back to the worker
        let lastUseNR = useNR;
        let lastSentRecently = sentRecently;
        let lastVadSensitivity = vadSensitivity;
        let lastVadNoiseGate = vadNoiseGate;

        // Accept state updates
        capture.worker.onmessage = function(ev) {
            const msg = ev.data;
            if (msg.c === "state") {
                // VAD state
                vad.setRawVadOn(msg.rawVadOn);
                if (msg.rtcVadOn !== vad.rtcVadOn)
                    rtcVad(msg.rtcVadOn);
                if (msg.vadOn !== vad.vadOn) {
                    if (msg.vadOn)
                        wd.updateWaveRetroactive(vad.vadExtension);
                    vad.setVadOn(msg.vadOn);
                    util.dispatchEvent("ui.speech", {user: null, status: msg.vadOn});
                }

            } else if (msg.c === "max") {
                // Waveform data

                // Check studio mode
                const nowStudio = (ui.ui.video.mode === ui.ViewMode.Studio);
                if (studio !== nowStudio) {
                    studio = nowStudio;
                    studioSwapped();
                }

                // Display
                wd.push(msg.m, net.transmitting?(vad.rawVadOn?3:(vad.vadOn?2:1)):0);
                wd.updateWave(msg.m, sentRecently);

            } else if (msg.c === "vosk") {
                // Show our own caption
                ui.caption(net.selfId, msg.result.text || msg.result.partial, false, msg.complete);

                // Send it to peers
                util.dispatchEvent("proc.caption", msg);

                // Send it to the server
                if (msg.complete && msg.result.result && audio.timeOffset &&
                    net.mode === prot.mode.rec) {
                    const result = msg.result.result;

                    // Adjustment from Date.now timestamps to server timestamps
                    const offset = performance.now() - Date.now() +
                        audio.timeOffset;

                    // Set the times
                    for (let i = 0; i < result.length; i++) {
                        const word = result[i];
                        word.start = Math.round(word.start * 1000 + offset);
                        word.end = Math.round(word.end * 1000 + offset);
                        if (word.conf === 1)
                            delete word.conf;
                    }

                    // Make the packet
                    const resBuf = util.encodeText(JSON.stringify(result));
                    const p = prot.parts.caption.cs;
                    const out = new DataView(new ArrayBuffer(p.length + resBuf.length));
                    out.setUint32(0, prot.ids.caption, true);
                    (new Uint8Array(out.buffer)).set(resBuf, p.data);
                    net.dataSock.send(out.buffer);
                }

            }

            // This is also an opportunity to update them on changed state
            if (useNR !== lastUseNR || sentRecently !== lastSentRecently ||
                vadSensitivity !== lastVadSensitivity ||
                vadNoiseGate !== lastVadNoiseGate) {
                capture.worker.postMessage({
                    c: "state",
                    useNR,
                    sentRecently,
                    vadSensitivity,
                    vadNoiseGate
                });
                lastUseNR = useNR;
                lastSentRecently = sentRecently;
                lastVadSensitivity = vadSensitivity;
                lastVadNoiseGate = vadNoiseGate;
            }
        };

        // The output from this is our RTC audio
        input.userMediaRTC = capture.destination;
        util.dispatchEvent("usermediartcready", {idx});
        util.dispatchEvent("usermediartcready" + idx, {idx});

        // Restart if we change devices
        // FIXME: This should probably be done elsewhere
        util.events.addEventListener("usermediastopped" + idx, function() {
            capture.disconnect();
            localProcessing(idx);
        }, {once: true});

    });
}
