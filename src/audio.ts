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
declare var LibAV: any, MediaRecorder: any, webkitAudioContext: any;

/* We need an event target we can use. "usermediaready" fires when userMedia is
 * ready. "usermediastopped" fires when it stops. "usermediavideoready" fires
 * when video is ready. "spmediaready" fires when the media device that's
 * processed through the ScriptProcessor is ready. */
// FIXME: This is before all the imports because of some nasty dependencies
export var userMediaAvailableEvent: EventTarget;
try {
    userMediaAvailableEvent = new EventTarget();
} catch (ex) {
    // No EventTarget
    userMediaAvailableEvent = window;
}

import * as config from "./config";
import * as log from "./log";
import * as master from "./master";
import * as net from "./net";
import * as proc from "./proc";
import { prot } from "./protocol";
import * as ptt from "./ptt";
import * as safariWorkarounds from "./safari";
import * as ui from "./ui";
import * as util from "./util";
import { dce } from "./util";

// libav version to load
const libavVersion = "2.3.4.3.1";

// The audio device being read
export var userMedia: MediaStream = null;

// Input latency on said device, in ms
var inputLatency = 0;

// The pseudodevice as processed to reduce noise, for RTC
export var userMediaRTC: MediaStream = null;
export function setUserMediaRTC(to: MediaStream) { userMediaRTC = to; }

// Audio context
export var ac: AudioContext = null;

// Our libav instance if applicable
export var libav: any = null;

// Our libav encoder information
var libavEncoder: any = null;

// The Opus or FLAC packets to be handled. Format: [granulePos, data]
type Packet = [number, DataView];
var packets: Packet[] = [];

// Opus zero packet, will be replaced with FLAC's version if needed
var zeroPacket = new Uint8Array([0xF8, 0xFF, 0xFE]);

// Our start time is in local ticks, and our offset is updated every so often
var startTime = 0;
export var timeOffset: null|number = null;
export function setFirstTimeOffset(to: number) { if (timeOffset === null) timeOffset = to; }

// And this is the amount to adjust it per frame (1%)
const timeOffsetAdjPerFrame = 0.0002;

/* To help with editing by sending a clean silence sample, we send the
 * first few (arbitrarily, 8) seconds of VAD-off silence */
var sendSilence = 400;

// When we're not sending real data, we have to send a few (arbitrarily, 3) empty frames
var sentZeroes = 999;

/* We keep track of the last time we successfully encoded data for
 * transfer, to determine if anything's gone wrong */
export var lastSentTime = 0;
export function setLastSentTime(to: number) { lastSentTime = to; }

// Recording timer updater
var recordingTimerInterval: null|number = null;

// Current base of recording timer, in server time ms
var recordingTimerBaseST = 0;

// Current base of recording timer, in recording time ms
var recordingTimerBase = 0;

// Whether the recording timer should be ticking
var recordingTimerTicking = false;

// Features to use or not use
var useLibAV = false;

// Called when the network is disconnection
export function disconnect() {
    if (ac) {
        try {
            ac.dispatchEvent(new CustomEvent("disconnected", {}));
        } catch (ex) {}
        ac.close();
        ac = null;
    }

    if (userMedia) {
        userMedia.getTracks().forEach(function (track) {
            track.stop();
        });
        userMedia = null;
    }
}

// Get audio permission. First audio step of the process.
export function getAudioPerms() {
    return navigator.mediaDevices.getUserMedia({audio: true}).then(function(userMediaIn) {
        userMedia = userMediaIn; // So that it gets deleted by getMic
        return getMic(ui.mkAudioUI());
    }).catch(function(err) {
        net.disconnect();
        log.pushStatus("fail", "Cannot get microphone: " + err);
        log.popStatus("getmic");
    });
}

/* The starting point for enabling encoding. Get our microphone input. Returns
 * a promise that resolves when encoding is active. */
export function getMic(deviceId?: string) {
    if (!net.connected)
        return;

    log.pushStatus("getmic", "Asking for microphone permission...");
    log.popStatus("conn");

    // First get rid of any active sources
    if (userMedia) {
        userMedia.getTracks().forEach(function(track) { track.stop(); });
        userMedia = null;
        if (userMediaRTC) {
            // FIXME: Really need to properly destroy the whole chain
            userMediaRTC.getTracks().forEach(function(track) { track.stop(); });
            userMediaRTC = null;
        }
        userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediastopped", {}));
    }

    // Then request the new ones
    return navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: deviceId,
            autoGainControl: {ideal: ui.ui.panels.inputConfig.agc.checked},
            echoCancellation: {ideal: ui.ui.panels.inputConfig.echo.checked},
            noiseSuppression: {ideal: false},
            sampleRate: {ideal: 48000},
            sampleSize: {ideal: 24}
        }
    }).then(function(userMediaIn) {
        userMedia = userMediaIn;
        var inl = userMedia.getAudioTracks()[0].getSettings().latency;
        if (inl)
            inputLatency = inl * 1000;
        else
            inputLatency = 0;

        return userMediaSet();
    }).catch(function(err) {
        net.disconnect();
        log.pushStatus("fail", "Cannot get microphone: " + err);
        log.popStatus("getmic");
    });
}

/* Called once we have mic access. Returns a promise that resolves once
 * encoding is active. */
function userMediaSet() {
    if (!net.connected)
        return;

    ui.updateMuteButton();
    ptt.loadPTT();

    log.pushStatus("initenc", "Initializing encoder...");
    log.popStatus("getmic");

    // Get the sample rate from the user media
    var sampleRate = userMedia.getAudioTracks()[0].getSettings().sampleRate;

    // Create our AudioContext if needed
    if (!ac) {
        try {
            ac = new AudioContext();
        } catch (ex) {
            // Try Apple's, and if not that, nothing left to try, so crash
            ac = new webkitAudioContext();
        }

        ui.setOutputAudioContext(ac);
    }

    // Now UserMedia and AudioContext are ready
    userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediaready", {}));

    return Promise.all([]).then(function() {
        /* On Safari on mobile devices, AudioContexts start paused, and sometimes
         * need to be unpaused directly in an event handler. Check if it's paused,
         * and unpause it either out of or in a button handler. */

        if (ac.state !== "running") {
            // Try to just activate it
            return ac.resume();
        }

    }).then(function() {
        if (ac.state !== "running") {
            return new Promise(function(res, rej) {
                // This browser won't let us resume an AudioContext outside of an event handler
                var btn = dce("button");
                btn.classList.add("plain");
                btn.style.position = "absolute";
                btn.style.left = "1%";
                btn.style.top = "1%";
                btn.style.width = "98%";
                btn.style.height = "98%";
                btn.innerText = "Begin recording audio";
                document.body.appendChild(btn);

                btn.onclick = function() {
                    ac.resume().then(res).catch(res);
                    document.body.removeChild(btn);
                };
            });
        }

    }).then(<any> function() {
        if (ac.state !== "running")
            log.pushStatus("audiocontext", "Cannot capture audio! State: " + ac.state);

        // Presently, only libav encoding is supported
        useLibAV = true;

        // At this point, we want to start catching errors
        window.addEventListener("error", function(error) {
            net.errorHandler(error.error + "\n\n" + error.error.stack);
        });

        window.addEventListener("unhandledrejection", function(error) {
            error = error.reason;
            if (error instanceof Error) {
                net.errorHandler(error + "\n\n" + error.stack);
            } else {
                var msg;
                try {
                    msg = JSON.stringify(error);
                } catch (ex) {
                    msg = error+"";
                }
                msg += "\n\n" + new Error().stack;
                net.errorHandler(msg);
            }
        });

        // Load anything we need
        return loadLibAV();
    }).then(encoderLoaded);
}

// Load LibAV if it's not already loaded
var loadLibAVPromise: Promise<unknown> = null;
export function loadLibAV(): Promise<unknown> {
    if (loadLibAVPromise) {
        // Already loading or loaded
        return loadLibAVPromise;
    }

    if (typeof LibAV === "undefined")
        (<any> window).LibAV = {};
    LibAV.base = "libav";

    loadLibAVPromise = util.loadLibrary("libav/libav-" + libavVersion + "-ennuicastr.js").then(function() {
        return LibAV.LibAV();

    }).then(function(ret) {
        libav = ret;

    });
    return loadLibAVPromise;
}

/* Called once the specialized encoder is loaded, if it's needed. Returns a
 * promise that resolves once encoding is active. */
function encoderLoaded() {
    if (!net.connected)
        return;

    log.pushStatus("startenc", "Starting encoder...");
    log.popStatus("initenc");

    return libavStart();
}

// Start the libav encoder
function libavStart() {
    // We need to choose our target sample rate based on the input sample rate and format
    var sampleRate = 48000;
    if (config.useFlac && ac.sampleRate === 44100)
        sampleRate = 44100;

    // The server needs to be informed of FLAC's sample rate
    if (config.useFlac) {
        var p = prot.parts.info;
        var info = new DataView(new ArrayBuffer(p.length));
        info.setUint32(0, prot.ids.info, true);
        info.setUint32(p.key, prot.info.sampleRate, true);
        info.setUint32(p.value, sampleRate, true);
        net.dataSock.send(info.buffer);
    }

    // Set our zero packet as appropriate
    if (config.useFlac) {
        switch (sampleRate) {
            case 44100:
                zeroPacket = new Uint8Array([0xFF, 0xF8, 0x79, 0x0C, 0x00, 0x03, 0x71, 0x56, 0x00, 0x00, 0x00, 0x00, 0x63, 0xC5]);
                break;
            default:
                zeroPacket = new Uint8Array([0xFF, 0xF8, 0x7A, 0x0C, 0x00, 0x03, 0xBF, 0x94, 0x00, 0x00, 0x00, 0x00, 0xB1, 0xCA]);
        }
    }

    // Figure out our channel layout based on the number of channels
    var channelLayout = 4;
    var channelCount = ~~(userMedia.getAudioTracks()[0].getSettings().channelCount);
    switch (channelCount) {
        case 0:
        case 1:
            channelCount = 1;
            channelLayout = 4; // Mono
            break;
        case 2:
            channelLayout = 3; // Stereo
            break;
        default:
            // Just give a vaguely-sensible value
            channelLayout = Math.pow(2, channelCount) - 1;
    }

    // Determine our encoder options
    var encOptions: any = {
        sample_rate: sampleRate,
        frame_size: sampleRate * 20 / 1000,
        channel_layout: 4,
        channels: 1
    };
    if (config.useFlac) {
        encOptions.sample_fmt = libav.AV_SAMPLE_FMT_S32;
    } else {
        encOptions.sample_fmt = libav.AV_SAMPLE_FMT_FLT;
        encOptions.bit_rate = 128000;
    }

    // Begin initializing the encoder
    libavEncoder = {
        input_channels: channelCount,
        input_channel_layout: channelLayout
    };
    return libav.ff_init_encoder(config.useFlac?"flac":"libopus", encOptions, 1, sampleRate).then(function(ret: any) {

        libavEncoder.codec = ret[0];
        libavEncoder.c = ret[1];
        libavEncoder.frame = ret[2];
        libavEncoder.pkt = ret[3];
        libavEncoder.frame_size = ret[4];

        // Now make the filter
        return libav.ff_init_filter_graph("aresample", {
            sample_rate: ac.sampleRate,
            sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
            channels: channelCount,
            channel_layout: channelLayout
        }, {
            sample_rate: encOptions.sample_rate,
            sample_fmt: encOptions.sample_fmt,
            channel_layout: 4,
            frame_size: libavEncoder.frame_size
        });

    }).then(function(ret: any) {
        libavEncoder.filter_graph = ret[0];
        libavEncoder.buffersrc_ctx = ret[1];
        libavEncoder.buffersink_ctx = ret[2];

        // We're ready to go!
        if (!startTime)
            startTime = performance.now();
        libavEncoder.p = Promise.all([]);

        // Start processing in the background
        libavProcess();

    }).catch(function(ex: any) {
        log.pushStatus("libaverr", "Encoding error: " + ex);
        net.errorHandler(ex);

        // This is sufficiently catastrophic that we should disconnect if it happens
        net.disconnect();

    });
}

// libav's actual per-chunk processing
function libavProcess() {
    var enc = libavEncoder;
    var pts = 0;
    var inSampleRate = ac.sampleRate;

    // Keep track of how much data we've received to see if it's too little
    var dataReceived = 0;
    var pktCounter: [number, number][] = [];
    var tooLittle = inSampleRate * 0.9;

    // And if our latency is too high
    enc.latency = 0;
    enc.latencyDump = false;

    // Start reading the input
    var sp = safariWorkarounds.createScriptProcessor(ac, userMedia, 16384 /* Max: Latency doesn't actually matter in this context */).scriptProcessor;

    // Don't try to process that last sip of data after termination
    var dead = false;

    sp.onaudioprocess = function(ev: AudioProcessingEvent) {
        if (dead)
            return;

        // Determine the data timing
        var now = performance.now();
        var channelCount = ev.inputBuffer.numberOfChannels;
        var ib = new Array(channelCount);
        for (var ci = 0; ci < channelCount; ci++)
            ib[ci] = ev.inputBuffer.getChannelData(ci).slice(0);
        var pktLen = (ib[0].length * 48000 / inSampleRate);
        var pktTime = Math.round(
            (now - inputLatency - startTime) * 48 -
            pktLen
        );

        // Count it
        var ctrStart = now - 1000;
        pktCounter.push([now, ib[0].length]);
        dataReceived += ib[0].length;
        if (pktCounter[0][0] < ctrStart) {
            while (pktCounter[0][0] < ctrStart) {
                dataReceived -= pktCounter[0][1];
                pktCounter.shift();
            }
            if (dataReceived < tooLittle) {
                log.pushStatus("toolittle", "Encoding is overloaded, incomplete audio data!");
            } else {
                log.popStatus("toolittle");
            }
        }

        // Check for latency
        if (enc.latency > 1000) {
            // Maybe report it
            if (enc.latency > 2000)
                log.pushStatus("latency", "Encoding is buffering. " + Math.ceil(enc.latency/1000) + " seconds of audio buffered.");

            // Choose whether to dump audio
            if (!enc.latencyDump)
                enc.latencyDump = (enc.latency > 1500);

            if (!proc.vadOn && enc.latencyDump) {
                // VAD is off, so lose some data to try to eliminate latency
                enc.latency -= (pktLen/48);

                // Don't let the display get independently concerned about this
                lastSentTime = now;
                return;
            }
        } else {
            if (enc.latencyDump)
                enc.latencyDump = false;
            log.popStatus("latency");
        }

        // Put it in libav's format
        while (libavEncoder.input_channels > ib.length) {
            // Channel count changed???
            ib = ib.concat(ib);
        }
        var frames = [{
            data: ib,
            channels: libavEncoder.input_channels,
            channel_layout: libavEncoder.input_channel_layout,
            format: libav.AV_SAMPLE_FMT_FLTP,
            pts: pts,
            sample_rate: inSampleRate
        }];
        pts += ib[0].length;

        // Wait for any previous filtering
        enc.p = enc.p.then(function() {

            // Filter
            return libav.ff_filter_multi(enc.buffersrc_ctx, enc.buffersink_ctx, enc.frame, frames);

        }).then(function(frames: any) {
            // Encode
            return libav.ff_encode_multi(enc.c, enc.frame, enc.pkt, frames);

        }).then(function(encPackets: any) {
            // Now write these packets out
            for (var pi = 0; pi < encPackets.length; pi++) {
                packets.push([pktTime, new DataView(encPackets[pi].data.buffer)])
                pktTime += 960; // 20ms
            }
            handlePackets();

            // Look for latency problems
            enc.latency = performance.now() - now;

        }).catch(function(ex: any) {
            log.pushStatus("libaverr", "Encoding error: " + ex);
            net.errorHandler(ex);

            // This is sufficiently catastrophic that we should disconnect if it happens
            net.disconnect();

        });
    }

    // Terminate the recording
    function terminate() {
        if (dead)
            return;
        dead = true;

        // Close the encoder
        enc.p = enc.p.then(function() {
            return libav.avfilter_graph_free_js(enc.filter_graph);

        }).then(function() {
            return libav.ff_free_encoder(enc.c, enc.frame, enc.pkt);

        });
    }

    // Catch when our UserMedia ends and stop (FIXME: race condition before reloading?)
    userMediaAvailableEvent.addEventListener("usermediastopped", terminate, {once: true});
    ac.addEventListener("disconnected", terminate);
}


// Once we've parsed new packets, we can do something with them
function handlePackets() {
    if (!packets.length || timeOffset === null) return;

    var curGranulePos = packets[packets.length-1][0];
    net.setTransmitting(true);

    // We have *something* to handle
    lastSentTime = performance.now();
    log.popStatus("startenc");

    // Don't actually *send* anything if we're not recording
    if (net.mode !== prot.mode.rec) {
        while (packets.length)
            packets.pop();
        return;
    }

    // Warn if we're buffering
    if (net.dataSock.bufferedAmount > 1024*1024)
        log.pushStatus("buffering", util.bytesToRepr(net.dataSock.bufferedAmount) + " audio data buffered");
    else
        log.popStatus("buffering");

    if (!proc.vadOn) {
        // Drop any sufficiently old packets, or send them marked as silence in continuous mode
        var old = curGranulePos - proc.vadExtension*48;
        while (packets[0][0] < old) {
            var packet = packets.shift();
            var granulePos = adjustTime(packet);
            if (granulePos < 0)
                continue;
            if (config.useContinuous || sendSilence > 0) {
                /* Send it in VAD-off mode */
                sendPacket(granulePos, packet[1], 0);
                sendSilence--;

            } else if (sentZeroes < 3) {
                /* Send an empty packet in its stead (FIXME: We should have
                 * these prepared in advance) */
                if (granulePos < 0) continue;
                sendPacket(granulePos, zeroPacket, 0);
                sentZeroes++;
            }
        }

    } else {
        var vadVal = (proc.rawVadOn?2:1);

        // VAD is on, so send packets
        packets.forEach(function (packet) {
            var data = packet[1];

            // Ignore header packets (start with "Opus")
            if (data.byteLength >= 4 && data.getUint32(0, true) === 0x7375704F)
                return;

            var granulePos = adjustTime(packet);
            if (granulePos < 0)
                return;

            sendPacket(granulePos, data, vadVal);
        });

        sentZeroes = 0;
        packets = [];

    }
}

// Send an audio packet
function sendPacket(granulePos: number, data: {buffer: ArrayBuffer}, vadVal: number) {
    var p = prot.parts.data;
    var msg = new DataView(new ArrayBuffer(p.length + (config.useContinuous?1:0) + data.buffer.byteLength));
    msg.setUint32(0, prot.ids.data, true);
    msg.setUint32(p.granulePos, granulePos & 0xFFFFFFFF, true);
    msg.setUint16(p.granulePos + 4, (granulePos / 0x100000000) & 0xFFFF, true);
    if (config.useContinuous)
        msg.setUint8(p.packet, vadVal);
    var data8 = new Uint8Array(data.buffer);
    (new Uint8Array(msg.buffer)).set(data8, p.packet + (config.useContinuous?1:0));
    net.dataSock.send(msg.buffer);
}

// Adjust the time for a packet, and adjust the time-adjustment parameters
function adjustTime(packet: Packet) {
    // Adjust our offsets
    if (net.targetTimeOffset > timeOffset) {
        if (net.targetTimeOffset > timeOffset + timeOffsetAdjPerFrame)
            timeOffset += timeOffsetAdjPerFrame;
        else
            timeOffset = net.targetTimeOffset;
    } else if (net.targetTimeOffset < timeOffset) {
        if (net.targetTimeOffset < timeOffset - timeOffsetAdjPerFrame)
            timeOffset -= timeOffsetAdjPerFrame;
        else
            timeOffset = net.targetTimeOffset;
    }

    // And adjust the time
    return Math.round(packet[0] + timeOffset*48 + startTime*48);
}

// Toggle the mute state of the input audio
export function toggleMute(to?: boolean) {
    if (!userMedia) return;
    var track = userMedia.getAudioTracks()[0];
    if (typeof to === "undefined")
        to = !track.enabled;
    track.enabled = to;
    ui.updateMuteButton();
}

// Play or stop a sound
export function playStopSound(url: string, status: number, time: number) {
    var sound = ui.ui.sounds.soundboard[url];
    if (!sound) {
        // Create an element for it
        sound = ui.ui.sounds.soundboard[url] = {
            el: document.createElement("audio")
        };

        // Choose a format
        var format = "m4a";
        if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/webm; codecs=opus"))
            format = "webm"

        sound.el.src = url + "." + format;
        if (ui.ui.panels.outputConfig) {
            sound.el.volume = (+ui.ui.panels.outputConfig.sfxVolume.value) / 100;
            ui.ui.panels.outputConfig.sfxVolumeHider.style.display = "";
        }
    }
    var el = sound.el;

    // Play or stop playing
    el.pause();
    el.playbackRate = 1;
    el.ecStartTime = time;
    if (status) {
        el.currentTime = 0;
        el.play().then(catchup);
    }

    function catchup() {
        // Try to catch up if it's long enough to be worthwhile
        if (el.duration < 10 ||
            !timeOffset) return;

        // OK, it might be worth catching up. Figure out our time.
        var elCurTime = el.ecStartTime + el.currentTime * 1000;
        var realCurTime = performance.now() + timeOffset;
        if (elCurTime < realCurTime) {
            // Adjust our time so that we catch up in exactly one second
            el.playbackRate = 1 + (realCurTime - elCurTime) / 1000;
            setTimeout(function() {
                if (el.ecStartTime !== time) return;
                el.playbackRate = 1;
            }, 1000);
        }
    }

    if ("master" in config.config)
        master.soundButtonUpdate(url, status, el);
}


// Set the recording timer
export function setRecordingTimer(serverTime, recTime, ticking) {
    recordingTimerBaseST = serverTime;
    recordingTimerBase = recTime;
    recordingTimerTicking = ticking;
    if (!recordingTimerInterval)
        recordingTimerInterval = setInterval(tickRecordingTimer, 500);
}

// Tick the recording timer
function tickRecordingTimer() {
    var time = recordingTimerBase;
    if (recordingTimerTicking && timeOffset !== null)
        time += performance.now() + timeOffset - recordingTimerBaseST;

    time = ~~(time / 1000);
    var s = "" + ~~(time % 60);
    if (s.length < 2) s = "0" + s;
    time = ~~(time / 60);
    var m = "" + ~~(time % 60);
    time = ~~(time / 60);
    var h = ~~time;
    if (h && m.length < 2) m = "0" + m;
    var timer = ui.ui.log.timer;
    timer.style.color = recordingTimerTicking ? "#080" : "#800";
    timer.innerText = (h?(h+":"):"") + m + ":" + s;
}
