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
import * as safariWorkarounds from "./safari";
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

// Similar, for RTC transmission
const rtcVadExtension = 250;

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

        if (audio.useAWP) {
            // Use the worklet-based processor
            return localProcessingAWP();
        } else {
            // Use the ScriptProcessor-based processor
            return localProcessingSP();
        }
    });
}

// ScriptProcessor-based processing
function localProcessingSP() {
    var m: any /* WebRtcVad */;

    return Promise.all([]).then(function() {
        // Load WebRtcVad
        if (typeof WebRtcVad === "undefined") {
            var wa = util.isWebAssemblySupported();
            return util.loadLibrary("vad/vad-m" + (wa?".wasm":"") + ".js");

        }

    }).then(function() {
        return WebRtcVad();

    }).then(function(ret) {
        m = ret;

        // Load NoiseRepellent
        if (typeof NoiseRepellent === "undefined") {
            (<any> window).NoiseRepellent = {base: "noise-repellent"};
            return util.loadLibrary("noise-repellent/noise-repellent-m.js");
        }

    }).then(function() {
        // This is the main audio processing function

        // Set our lastSentTime now so that we don't immediately report a problem
        audio.setLastSentTime(performance.now());


        // FIXME: These steps shouldn't be done if we're not using WebRTC VAD
        // First the WebRTC VAD steps
        var handle = m.Create();
        if (handle === 0) {
            log.pushStatus("failvad", "Failed to create VAD.");
            throw new Error();
        }
        if (m.Init(handle) < 0) {
            log.pushStatus("failvad", "Failed to initialize VAD.");
            throw new Error();
        }

        var bufSz = 640 /* 20ms at 32000Hz */;
        var dataPtr = m.malloc(bufSz * 2);
        var buf = new Int16Array(m.heap.buffer, dataPtr, bufSz * 2);
        var bi = 0;
        var timeout: null|number = null, rtcTimeout: null|number = null;

        /* WebRTC VAD is pretty finicky, so also keep track of volume as a
         * secondary gate */
        var triggerVadCeil = 0, triggerVadFloor = 0;
        var curVadVolume = 0;

        m.set_mode(3);


        // Now the noise repellent steps
        var nr: any = null;
        // This can happen whenever
        NoiseRepellent.NoiseRepellent(audio.ac.sampleRate).then(function(ret: any) {
            nr = ret;
            nr.set(NoiseRepellent.N_ADAPTIVE, 1);
            nr.set(NoiseRepellent.AMOUNT, 20);
            nr.set(NoiseRepellent.WHITENING, 50);
        });


        // Now the display steps

        // Create a display for it, either in the main waveform wrapper or the studio location
        var studio = (ui.ui.video.mode === ui.ViewMode.Studio);
        var wd: waveform.Waveform;
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

        // The VAD needs packets in odd intervals
        var step = audio.ac.sampleRate / 32000;

        // Create our script processor
        var spW = safariWorkarounds.createScriptProcessor(audio.ac, audio.userMedia, 1024);
        var destination: MediaStream = spW.destination;
        var sp = spW.scriptProcessor;

        rtcVad(destination, false);

        // Now anything that needs its output can get it
        audio.setUserMediaRTC(destination);
        audio.userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediartcready", {}));

        // The actual processing
        sp.onaudioprocess = function(ev: AudioProcessingEvent) {
            // Merge together the channels
            var ib = ev.inputBuffer.getChannelData(0);
            var cc = ev.inputBuffer.numberOfChannels;
            if (cc !== 1) {
                ib = ib.slice(0);

                // Mix it
                for (var i = 1; i < cc; i++) {
                    var ibc = ev.inputBuffer.getChannelData(i);
                    for (var j = 0; j < ib.length; j++)
                        ib[j] += ibc[j];
                }

                // Then temper it
                for (var i = 0; i < ib.length; i++)
                    ib[i] /= cc;
            }


            // Perform noise reduction and output
            var nrbuf = ib;
            if (nr) {
                let ob = ib;
                nrbuf = nr.run(ib);
                if (useNR)
                    ob = nrbuf;
                var cc = ev.outputBuffer.numberOfChannels;
                if (sentRecently) {
                    for (var oi = 0; oi < cc; oi++)
                        ev.outputBuffer.getChannelData(oi).set(ob);
                } else {
                    for (var oi = 0; oi < cc; oi++)
                        ev.outputBuffer.getChannelData(oi).fill(0);
                }
            }


            // Transfer data for the VAD
            var vadSet = rawVadOn;
            var curVolume = 0;
            for (var i = 0; i < ib.length; i += step) {
                var v = nrbuf[~~i];
                var a = Math.abs(v);
                curVolume += a;
                curVadVolume += a;

                buf[bi++] = v * 0x7FFF;

                if (bi == bufSz) {
                    // We have a complete packet
                    vadSet = !!m.Process(handle, 32000, dataPtr, bufSz);
                    bi = 0;

                    if (vadSet) {
                        // Adjust the trigger value quickly up or slowly down
                        let triggerTarget = curVadVolume/bufSz;
                        if (triggerTarget > triggerVadCeil) {
                            triggerVadCeil = triggerTarget;
                        } else {
                            triggerVadCeil = (
                                triggerVadCeil * 1023 +
                                triggerTarget
                            ) / 1024;
                        }
                    } else {
                        let triggerTarget = curVadVolume/bufSz*2;
                        triggerVadFloor = (
                            triggerVadFloor * 511 +
                            triggerTarget
                        ) / 512;
                    }
                    curVadVolume = 0;
                }
            }

            // Gate the VAD by volume
            if (vadSet) {
                let relVolume = curVolume/ib.length;
                vadSet = false;
                // We must be over the floor...
                if (relVolume >= triggerVadFloor) {
                    // And at least 1/32nd way to the ceiling
                    if (triggerVadCeil < triggerVadFloor*2 ||
                        relVolume - triggerVadFloor >= (triggerVadCeil - triggerVadFloor) / 32) {
                        vadSet = true;
                    }
                }
            }

            // Possibly swap the VAD mode
            if (vadSet) {
                // Switch on the transmission VAD
                if (!rtcVadOn) {
                    rtcVad(destination, true);
                } else if (rtcTimeout) {
                    clearTimeout(rtcTimeout);
                    rtcTimeout = null;
                }

                // And the recording VAD
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (!rawVadOn) {
                    // We flipped on
                    if (!vadOn) {
                        wd.updateWaveRetroactive(vadExtension);
                        updateSpeech(null, true);
                    }
                    rawVadOn = true;
                    curVadVolume = 0;
                }

            } else {
                if (rtcVadOn) {
                    // Flip off after a second
                    if (!rtcTimeout) {
                        rtcTimeout = setTimeout(function() {
                            rtcTimeout = null;
                            rtcVad(destination, false);
                        }, rtcVadExtension);
                    }
                }

                if (rawVadOn) {
                    // Flip off after a while
                    rawVadOn = false;
                    if (!timeout) {
                        timeout = setTimeout(function() {
                            timeout = null;
                            updateSpeech(null, false);
                        }, vadExtension);
                    }
                }
            }


            // Check studio mode
            var nowStudio = (ui.ui.video.mode === ui.ViewMode.Studio);
            if (studio !== nowStudio) {
                studio = nowStudio;
                studioSwapped();
            }

            // And display
            for (var part = 0; part < ib.length; part += 1024) {
                // Find the max for this range
                var max = 0;
                var end = part + 1024;
                for (var i = part; i < end; i++) {
                    var v = ib[i];
                    if (v < 0) v = -v;
                    if (v > max) max = v;
                }

                wd.push(max, net.transmitting?(rawVadOn?3:(vadOn?2:1)):0);
            }

            wd.updateWave(max, sentRecently);
        };

        // Restart if we change devices
        audio.userMediaAvailableEvent.addEventListener("usermediastopped", function() {
            m.Free(handle);
            if (nr) {
                nr.cleanup();
                nr = null;
            }
            localProcessing();
        }, {once: true});

    }).catch(console.error);
}

// AWP-based processing
function localProcessingAWP() {
    // Create a display for it, either in the main waveform wrapper or the studio location (FIXME: massive duplication)
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

    // Load the worklet processor into our audio context
    return audio.loadAWP(audio.ac).then(() => {

        /* Here's how the whole setup works:
         * input ->
         * AudioWorkletNode in awp.js ->
         * Worker in worker.js ->
         * data back to us */
        var awn = new AudioWorkletNode(audio.ac, "worker-processor");
        var worker = new Worker(audio.workerPath);

        // Hook everything up
        let mss = audio.ac.createMediaStreamSource(audio.userMedia);
        mss.connect(awn);
        let msd = audio.ac.createMediaStreamDestination();
        awn.connect(msd);
        let destination = msd.stream;

        // Need a channel for them to communicate
        var mc = new MessageChannel();
        awn.port.postMessage({c: "workerPort", p: mc.port1}, [mc.port1]);
        worker.postMessage({
            c: "filter",
            port: mc.port2,
            sampleRate: audio.ac.sampleRate,
            useNR: useNR,
            sentRecently: sentRecently
        }, [mc.port2]);

        // State to send back to the worker
        let lastUseNR = useNR;
        let lastSentRecently = sentRecently;

        // Accept state updates
        let dead = false;
        worker.onmessage = ev => {
            if (dead) return;
            var msg = ev.data;
            if (msg.c === "state") {
                // VAD state
                rawVadOn = msg.rawVadOn;
                if (msg.rtcVadOn !== rtcVadOn)
                    rtcVad(destination, msg.rtcVadOn);
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
                worker.postMessage({
                    c: "state",
                    useNR: useNR,
                    sentRecently: sentRecently
                });
                lastUseNR = useNR;
                lastSentRecently = sentRecently;
            }
        };

        // Now it's all ready
        audio.setUserMediaRTC(destination);
        audio.userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediartcready", {}));

        // Restart if we change devices
        audio.userMediaAvailableEvent.addEventListener("usermediastopped", function() {
            dead = true;
            mss.disconnect(awn);
            awn.disconnect(msd);
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
