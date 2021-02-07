/*
 * Copyright (c) 2018-2020 Yahweasel
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

// WebRTCVAD's raw output
export var rawVadOn = false;

// Recording VAD after warmup and cooldown
export var vadOn = false;

// RTC VAD after cooldown
export var rtcVadOn = false;

// Number of milliseconds to run the VAD for before/after talking
export const vadExtension = 2000;

// Similar, for RTC transmission
const rtcVadExtension = 250;

// The data used by both the level-based VAD and display
var waveData: number[] = [];
var waveVADs: number[] = [];

// En/disable noise reduction
export var useNR = false;
export function setUseNR(to: boolean) { useNR = to; }

// All local processing: The VAD, wave display, and noise reduction
export function localProcessing() {
    var m: any /* WebRtcVad */;

    Promise.all([]).then(function() {
        if (!audio.userMedia) {
            // Need our MediaSource first!
            return new Promise(function(res) {
                audio.userMediaAvailableEvent.addEventListener("usermediaready", res, {once: true});
            });
        }

    }).then(function() {
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
        if (config.useRTC && typeof NoiseRepellent === "undefined") {
            (<any> window).NoiseRepellent = {base: "noise-repellent"};
            return util.loadLibrary("noise-repellent/noise-repellent-m.js");
        }

    }).then(function() {
        // This is the main audio processing function

        // Set our lastSentTime now so that we don't immediately report a problem
        audio.setLastSentTime(performance.now());


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
        var rtcVadOnTime: null|number = null;

        /* WebRTC VAD is pretty finicky, so also keep track of volume as a
         * secondary gate */
        var triggerVadCeil = 0, triggerVadFloor = 0;
        var curVadVolume = 0;

        m.set_mode(3);


        // Now the noise repellent steps
        var nr: any = null;
        if (config.useRTC) {
            // This can happen whenever
            NoiseRepellent.NoiseRepellent(audio.ac.sampleRate).then(function(ret: any) {
                nr = ret;
                nr.set(NoiseRepellent.N_ADAPTIVE, 1);
                nr.set(NoiseRepellent.AMOUNT, 20);
                nr.set(NoiseRepellent.WHITENING, 50);
            });
        }


        // Now the display steps

        // Create a canvas for it
        var wc = ui.ui.wave.canvas;

        // The VAD needs packets in odd intervals
        var step = audio.ac.sampleRate / 32000;

        // Create our script processor
        var spW = safariWorkarounds.createScriptProcessor(audio.ac, audio.userMedia, 1024);
        var destination: MediaStream = spW.destination;
        var sp = spW.scriptProcessor;

        function rtcVad(to: boolean) {
            rtcVadOn = to;
            if (to)
                rtcVadOnTime = performance.now();
            else
                rtcVadOnTime = null;
            destination.getTracks().forEach(function(track) {
                track.enabled = to;
            });
        }
        rtcVad(false);

        // Now anything that needs its output can get it
        audio.setUserMediaRTC(destination);
        audio.userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediartcready", {}));

        // The actual processing
        sp.onaudioprocess = function(ev: AudioProcessingEvent) {
            // Display an issue if we haven't sent recently
            var now = performance.now();
            var sentRecently = (audio.lastSentTime > now-1500);
            if (sentRecently)
                log.popStatus("notencoding");
            else
                log.pushStatus("notencoding", "Audio encoding is not functioning!");

            if (typeof Ennuiboard !== "undefined" && Ennuiboard.enabled.gamepad)
                Ennuiboard.gamepad.poll();

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

            // Transfer data for the VAD
            var vadSet = rawVadOn;
            var curVolume = 0;
            for (var i = 0; i < ib.length; i += step) {
                var v = ib[~~i];
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
                    rtcVad(true);
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
                        updateWaveRetroactive();
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
                            rtcVad(false);
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


            /* Our actual script processing step: noise reduction, only for RTC
             * (live voice chat). Do not send audio if encoding isn't working,
             * so that your silence will be a hint that something is wrong. */
            if (nr) {
                var ob;
                if (useNR)
                    ob = nr.run(ib);
                else
                    ob = ib;
                var cc = ev.outputBuffer.numberOfChannels;
                if (sentRecently) {
                    for (var oi = 0; oi < cc; oi++)
                        ev.outputBuffer.getChannelData(oi).set(ob);
                } else {
                    for (var oi = 0; oi < cc; oi++)
                        ev.outputBuffer.getChannelData(oi).fill(0);
                }
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

                // Bump up surrounding ones to make the wave look nicer
                if (waveData.length > 0) {
                    var last = waveData.pop();
                    if (last < max)
                        last = (last+max)/2;
                    else
                        max = (last+max)/2;
                    waveData.push(last);
                }

                waveData.push(max);
                if (!net.transmitting)
                    waveVADs.push(0);
                else if (rawVadOn)
                    waveVADs.push(3);
                else if (vadOn)
                    waveVADs.push(2);
                else
                    waveVADs.push(1);
            }

            updateWave(max, sentRecently);
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

// Update the wave display when we retroactively promote VAD data
function updateWaveRetroactive() {
    var timeout = Math.ceil(audio.ac.sampleRate*vadExtension/1024000);
    var i = Math.max(waveVADs.length - timeout, 0);
    for (; i < waveVADs.length; i++)
        waveVADs[i] = (waveVADs[i] === 1) ? 2 : waveVADs[i];
}

// Constant used by updateWave
var e4 = Math.exp(4);

// Update the wave display
function updateWave(value: number, sentRecently: boolean) {
    var wc = ui.ui.wave.canvas;

    // Start from the element size
    var w = ui.ui.wave.wrapper.offsetWidth;
    var h = ui.ui.wave.wrapper.offsetHeight;

    // Rotate if our view is vertical
    if (w/h < 4/3) {
        if (!ui.ui.wave.rotate) {
            ui.ui.wave.watcher.style.visibility = "hidden";
            ui.ui.wave.rotate = true;
        }
    } else {
        if (ui.ui.wave.rotate) {
            ui.ui.wave.watcher.style.visibility = "";
            ui.ui.wave.rotate = false;
        }

    }

    // Make sure the canvases are correct
    if (+wc.width !== w)
        wc.width = w;
    if (+wc.height !== h)
        wc.height = h;

    if (ui.ui.wave.rotate) {
        var tmp = w;
        w = h;
        h = tmp;
    }

    // Half the wave height is a more useful value
    h = Math.floor(h/2);

    // Figure out the width of each sample
    var sw = Math.max(Math.floor(w/468), 1);
    var dw = Math.ceil(w/sw);

    // Make sure we have an appropriate amount of data
    while (waveData.length > dw) {
        waveData.shift();
        waveVADs.shift();
    }
    while (waveData.length < dw) {
        waveData.unshift(0);
        waveVADs.unshift(0);
    }

    // Figure out the height of the display
    var dh = Math.min(Math.max.apply(Math, waveData) * 1.5, 1);
    if (dh < 0.06) dh = 0.06; // Make sure the too-quiet bars are always visible

    // Figure out whether it should be colored at all
    var good = net.connected && net.transmitting && audio.timeOffset && sentRecently;

    // And draw it
    var ctx = wc.getContext("2d");
    var i, p;
    ctx.save();
    if (ui.ui.wave.rotate) {
        ctx.rotate(Math.PI/2);
        ctx.translate(0, -2*h);
    }

    // A function for drawing our level warning bars
    function levelBar(at: number, color: string) {
        if (dh <= at) return;
        var y = Math.log(at/dh * e4) / 4 * h;
        ctx.fillStyle = color;
        ctx.fillRect(0, h-y-1, w, 1);
        ctx.fillRect(0, h+y, w, 1);
    }

    // Background color
    ctx.fillStyle = ui.ui.colors["bg-wave"];
    ctx.fillRect(0, 0, w, h*2);

    // Level bar at 0.4% for "too soft"
    levelBar(0.004, ui.ui.colors["wave-too-soft"]);

    // Each column
    for (i = 0, p = 0; i < dw; i++, p += sw) {
        var d = Math.max(Math.log((waveData[i] / dh) * e4) / 4, 0) * h;
        if (d === 0) d = 1;
        ctx.fillStyle = good ? config.waveVADColors[waveVADs[i]] : "#000";
        ctx.fillRect(p, h-d, sw, 2*d);
    }

    // Level bar at 90% for "too loud"
    levelBar(0.9, ui.ui.colors["wave-too-loud"]);

    ctx.restore();
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
