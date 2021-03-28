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

// extern
declare var Ennuiboard: any, NoiseRepellent: any, WebRtcVad: any;

import * as audio from "./audio";
import * as config from "./config";
import * as log from "./log";
import * as net from "./net";
import * as rtc from "./rtc";
import * as capture from "./capture";
import * as ui from "./ui";
import * as util from "./util";
import * as waveform from "./waveform";

// WebRTCVAD's raw output
export var rawVadOn = false;

// Recording VAD after warmup and cooldown
export var vadOn = false;

// RTC VAD after cooldown
export var rtcVadOn = false;
var rtcVadOnTime: null|number = null;

// Number of milliseconds to run the VAD for before/after talking
export const vadExtension = 2000;

// Set if we've sent data recently
let sentRecently = false;

// A timeout for periodic checks that are done regardless of processing backend
let periodic: null|number = null;

// En/disable noise reduction
export var useNR = false;
export function setUseNR(to: boolean) { useNR = to; }

function rtcVad(destination: MediaStream, to: boolean) {
    rtcVadOn = to;
    if (to)
        rtcVadOnTime = performance.now();
    else
        rtcVadOnTime = null;
    destination.getTracks().forEach(function(track) {
        track.enabled = to;
    });
}

// All local processing: The VAD, wave display, and noise reduction
export function localProcessing() {
    Promise.all([]).then(function() {
        if (!audio.userMedia) {
            // Need our MediaSource first!
            return new Promise(function(res) {
                audio.userMediaAvailableEvent.addEventListener("usermediaready", res, {once: true});
            });
        }

    }).then(function() {
        // Always set sentRecently to true at this point so we don't immediately complaine
        sentRecently = true;

        // Some things done periodically other than audio per se
        if (!periodic) {
            periodic = setInterval(function() {
                // Display an issue if we haven't sent recently
                var now = performance.now();
                sentRecently = (audio.lastSentTime > now-1500);
                if (sentRecently)
                    log.popStatus("notencoding");
                else
                    log.pushStatus("notencoding", "Audio encoding is not functioning!");

                if (typeof Ennuiboard !== "undefined" && Ennuiboard.enabled.gamepad)
                    Ennuiboard.gamepad.poll();
            }, 100);
        }

        return localProcessingWorker();
    });
}

// Worker-based processing
function localProcessingWorker() {
    // Create a display for it, either in the main waveform wrapper or the studio location
    let studio = (ui.ui.video.mode === ui.ViewMode.Studio);
    let wd: waveform.Waveform;
    function studioSwapped() {
        if (studio) {
            var user = ui.ui.video.users[net.selfId];
            if (!user) {
                studio = false;
                studioSwapped();
            } else {
                wd = new waveform.Waveform(audio.ac.sampleRate / 1024, user.waveformWrapper, null);
            }
        } else {
            wd = new waveform.Waveform(audio.ac.sampleRate / 1024, ui.ui.wave.wrapper, ui.ui.wave.watcher);
        }
    }
    studioSwapped();

    // Start the capture
    return capture.createCapture(audio.ac, {
        ms: audio.userMedia,
        bufferSize: 1024,
        outStream: true,
        sampleRate: "sampleRate",
        workerCommand: {
            c: "filter",
            useNR: useNR,
            sentRecently: sentRecently
        }

    }).then(capture => {
        // State to send back to the worker
        let lastUseNR = useNR;
        let lastSentRecently = sentRecently;

        // Accept state updates
        capture.worker.onmessage = function(ev) {
            let msg = ev.data;
            if (msg.c === "state") {
                // VAD state
                rawVadOn = msg.rawVadOn;
                if (msg.rtcVadOn !== rtcVadOn)
                    rtcVad(capture.destination, msg.rtcVadOn);
                if (msg.vadOn !== vadOn) {
                    if (msg.vadOn)
                        wd.updateWaveRetroactive(vadExtension);
                    updateSpeech(null, msg.vadOn);
                }

            } else if (msg.c === "max") {
                // Waveform data

                // Check studio mode
                let nowStudio = (ui.ui.video.mode === ui.ViewMode.Studio);
                if (studio !== nowStudio) {
                    studio = nowStudio;
                    studioSwapped();
                }

                // Display
                wd.push(msg.m, net.transmitting?(rawVadOn?3:(vadOn?2:1)):0);
                wd.updateWave(msg.m, sentRecently);

            }

            // This is also an opportunity to update them on changed state
            if (useNR !== lastUseNR || sentRecently !== lastSentRecently) {
                capture.worker.postMessage({
                    c: "state",
                    useNR: useNR,
                    sentRecently: sentRecently
                });
                lastUseNR = useNR;
                lastSentRecently = sentRecently;
            }
        };

        // The output from this is our RTC audio
        audio.setUserMediaRTC(capture.destination);
        audio.userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediartcready", {}));

        // Restart if we change devices
        audio.userMediaAvailableEvent.addEventListener("usermediastopped", function() {
            capture.disconnect();
            localProcessing();
        }, {once: true});

    });
}

// Update speech info everywhere that needs it. peer===null is self
export function updateSpeech(peer: number, status: boolean) {
    // In video, to avoid races, peer 0 is us, not selfId
    var vpeer = peer;

    if (peer === null) {
        // Set the VAD
        vadOn = status;

        // Send the update to all RTC peers
        rtc.rtcSpeech(status);
        peer = net.selfId;
        vpeer = 0;
    }

    // Update the user list
    ui.userListUpdate(peer, status, false);
}
