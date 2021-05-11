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
declare var MediaRecorder: any, webkitAudioContext: any;

import * as config from "./config";
import * as log from "./log";
import * as net from "./net";
import { prot } from "./protocol";
import * as ptt from "./ptt";
import * as capture from "./capture";
import * as ui from "./ui";
import * as util from "./util";
import { dce } from "./util";
import * as vad from "./vad";

// The audio device being read
export var userMedia: MediaStream = null;

// Input latency on said device, in ms
var inputLatency = 0;

// The pseudodevice as processed to reduce noise, for RTC
export var userMediaRTC: MediaStream = null;
export function setUserMediaRTC(to: MediaStream) { userMediaRTC = to; }

// Audio context
export var ac: AudioContext = null;

// The Opus or FLAC packets to be handled. Format: [granulePos, data]
type Packet = [number, DataView];
var packets: Packet[] = [];

// Opus zero packet, will be replaced with FLAC's version if needed
var zeroPacket = new Uint8Array([0xF8, 0xFF, 0xFE]);

// Our start time is in local ticks, and our offset is updated every so often
var startTime = 0;
export var timeOffset: null|number = null;

/* So that the time offset doesn't jump all over the place, we adjust it
 * *slowly*. This is the target time offset */
var targetTimeOffset: null|number = null;

// And this is the amount to adjust it per frame (1%)
const timeOffsetAdjPerFrame = 0.0002;

// The delays on the pongs we've received back
var pongs: number[] = [];

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

// Called when the network is disconnection
function disconnect() {
    if (ac) {
        try {
            util.dispatchEvent("disconnected", {});
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
util.events.addEventListener("net.disconnect", disconnect);

// Handle pongs for our time offset
util.netEvent("ping", "pong", function(ev) {
    let msg: DataView = ev.detail;

    let p = prot.parts.pong;
    let sent = msg.getFloat64(p.clientTime, true);
    let recvd = performance.now();
    pongs.push(recvd - sent);
    while (pongs.length > 5)
        pongs.shift();
    if (pongs.length < 5) {
        // Get more pongs now!
        setTimeout(net.ping, 150);
    } else {
        // Get more pongs... eventually
        setTimeout(net.ping, 10000);

        // And figure out our offset
        let latency = pongs.reduce(function(a,b){return a+b;})/10;
        let remoteTime = msg.getFloat64(p.serverTime, true) + latency;
        targetTimeOffset = remoteTime - recvd;
        if (timeOffset === null) timeOffset = targetTimeOffset;
    }
});

// Get audio permission. First audio step of the process.
export function getAudioPerms(mkAudioUI: ()=>string) {
    return navigator.mediaDevices.getUserMedia({audio: true}).then(function(userMediaIn) {
        userMedia = userMediaIn; // So that it gets deleted by getMic
        return getMic(mkAudioUI());
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
        util.dispatchEvent("usermediastopped", {});
    }

    // Then request the new ones
    return navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: deviceId,
            autoGainControl: {ideal: ui.ui.panels.inputConfig.agc.checked},
            echoCancellation: {ideal: getEchoCancel()},
            noiseSuppression: {ideal: false},
            sampleRate: {ideal: 48000},
            sampleSize: {ideal: 24}
        }
    }).then(function(userMediaIn) {
        // Figure out our latency
        userMedia = userMediaIn;
        var inl = userMedia.getAudioTracks()[0].getSettings().latency;
        if (inl)
            inputLatency = inl * 1000;
        else
            inputLatency = 0;

        // And move on to the next step
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

    util.dispatchEvent("audio.mute");
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

        // Make an output context for it
        let msd = (<any> ac).ecDestination = ac.createMediaStreamDestination();

        // Start playing it when we're (relatively) sure we can
        util.events.addEventListener("usermediartcready", function() {
            if (!ui.ui.audioOutput) {
                let a = ui.ui.audioOutput = dce("audio");
                a.style.display = "none";
                document.body.appendChild(a);
            }

            ui.ui.audioOutput.srcObject = msd.stream;
            ui.ui.audioOutput.play().catch(console.error);
        });
    }

    // Now UserMedia and AudioContext are ready
    util.dispatchEvent("usermediaready", {});

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

        // At this point, we want to start catching errors
        window.addEventListener("error", function(error) {
            try {
                let msg: string = "";
                if (error.error)
                    msg = error.error + "\n\n" + error.error.stack;
                else
                    msg = error.message + "\n\n" + error.filename + ":" + error.lineno;
                net.errorHandler(msg);
            } catch (ex) {}
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
    }).catch(net.promiseFail()).then(encoderLoaded);
}

/* Called once the specialized encoder is loaded, if it's needed. Returns a
 * promise that resolves once encoding is active. */
function encoderLoaded() {
    if (!net.connected)
        return;

    log.pushStatus("startenc", "Starting encoder...");
    log.popStatus("initenc");

    return encoderStart();
}

// Start our encoder
function encoderStart() {
    // We need to choose our target sample rate based on the input sample rate and format
    let sampleRate = 48000;
    if (config.useFlac && ac.sampleRate === 44100)
        sampleRate = 44100;

    // The server needs to be informed of FLAC's sample rate
    if (config.useFlac) {
        let p = prot.parts.info;
        let info = new DataView(new ArrayBuffer(p.length));
        info.setUint32(0, prot.ids.info, true);
        info.setUint32(p.key, prot.info.sampleRate, true);
        info.setUint32(p.value, sampleRate, true);
        net.flacInfo(info.buffer);
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
    let channelLayout = 4;
    let channelCount = ~~(userMedia.getAudioTracks()[0].getSettings().channelCount);
    if (channelCount > 1)
        channelLayout = Math.pow(2, channelCount) - 1;

    // Create the capture stream
    return capture.createCapture(ac, {
        ms: userMedia,
        matchSampleRate: true,
        bufferSize: 16384 /* Max: Latency doesn't actually matter in this context */,
        outStream: true,
        sampleRate: "inSampleRate",
        workerCommand: {
            c: "encoder",
            outSampleRate: sampleRate,
            format: config.useFlac ? "flac" : "opus",
            channelLayout: channelLayout,
            channelCount: channelCount
        }

    }).then(capture => {
        // Accept encoded packets
        let last = 0;
        capture.worker.onmessage = function(ev) {
            let msg = ev.data;
            if (msg.c !== "packets") return;

            // Figure out the packet start time
            let p = msg.d;
            let now = msg.ts + performance.now() - Date.now(); // time adjusted from Date.now to performance.now
            let pktTime = Math.round(
                (now - startTime) * 48 -
                p.length * 960
            );

            // Add them to our own packet buffer
            for (let pi = 0; pi < p.length; pi++) {
                packets.push([pktTime, new DataView(p[pi].buffer)]);
                pktTime += 960;
            }

            // Check for sequence issues
            if (msg.s > last)
                net.errorHandler("Sequence error! " + msg.s + " " + last);
            last = msg.s + p.length;

            handlePackets();
        };

        // Terminate when user media stops
        util.events.addEventListener("usermediastopped", capture.disconnect, {once: true});

    }).catch(net.promiseFail());

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
    let ba = net.bufferedAmount();
    if (ba > 1024*1024)
        log.pushStatus("buffering", util.bytesToRepr(ba) + " audio data buffered");
    else
        log.popStatus("buffering");

    if (!vad.vadOn) {
        // Drop any sufficiently old packets, or send them marked as silence in continuous mode
        var old = curGranulePos - vad.vadExtension*48;
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
                /* Send an empty packet in its stead */
                if (granulePos < 0) continue;
                sendPacket(granulePos, zeroPacket, 0);
                sentZeroes++;
            }
        }

    } else {
        var vadVal = (vad.rawVadOn?2:1);

        // VAD is on, so send packets
        packets.forEach(function (packet) {
            var data = packet[1];

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
    if (targetTimeOffset > timeOffset) {
        if (targetTimeOffset > timeOffset + timeOffsetAdjPerFrame)
            timeOffset += timeOffsetAdjPerFrame;
        else
            timeOffset = targetTimeOffset;
    } else if (targetTimeOffset < timeOffset) {
        if (targetTimeOffset < timeOffset - timeOffsetAdjPerFrame)
            timeOffset -= timeOffsetAdjPerFrame;
        else
            timeOffset = targetTimeOffset;
    }

    // And adjust the time
    return Math.round(packet[0] + timeOffset*48 + startTime*48);
}

// Get the state of muting (true=MUTED)
function getMute() {
    let track = userMedia.getAudioTracks()[0];
    return !track.enabled;
}

// Get the echo cancellation state
export function getEchoCancel() {
    return ui.ui.panels.inputConfig.echo.checked;
}

// Toggle the mute state of the input audio (true=UNMUTED)
export function toggleMute(to?: boolean) {
    if (!userMedia) return;
    var track = userMedia.getAudioTracks()[0];
    if (typeof to === "undefined")
        to = !track.enabled;
    track.enabled = to;
    util.dispatchEvent("audio.mute");
    net.updateAdminPerm({mute: !to});
}

// Set the echo cancellation state of the input audio
export function setEchoCancel(to: boolean) {
    // Update the UI
    ui.ui.panels.inputConfig.echo.checked = to;

    // Update any admins
    net.updateAdminPerm({echo: to});

    // And make it so
    return getMic(ui.ui.panels.inputConfig.device.value);
}

// Play or stop a sound
function playStopSound(url: string, status: number, time: number) {
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
            el.ended ||
            el.ecStartTime !== time) {
            return;
        }

        // If we don't yet know how to catch up, try in a moment
        if (!timeOffset) {
            setTimeout(catchup, 1000);
            return;
        }

        // OK, it might be worth catching up. Figure out our time.
        var elCurTime = el.ecStartTime + el.currentTime * 1000;
        var realCurTime = performance.now() + timeOffset;
        if (elCurTime < realCurTime - 100 || elCurTime > realCurTime + 100) {
            // Adjust our time so that we catch up in exactly one second
            let rate;
            if (elCurTime < realCurTime)
                rate = Math.min(1 + (realCurTime - elCurTime) / 1000, 16);
            else
                rate = Math.max(1 / (1 + (elCurTime - realCurTime) / 1000), 0.75);
            if (rate < 0.75 || rate > 4)
                el.muted = true;
            el.playbackRate = rate;
            setTimeout(function() {
                if (el.ecStartTime !== time) return;
                el.playbackRate = 1;
                catchup();
            }, 1000);
        } else {
            el.muted = false;
        }
    }

    util.dispatchEvent("audio.sound", {url: url, status: status, el: el});
}

util.netEvent("data", "sound", function(ev) {
    let msg: DataView = ev.detail;
    let p = prot.parts.sound.sc;
    let time = msg.getFloat64(p.time, true);
    let status = msg.getUint8(p.status);
    let url = util.decodeText(msg.buffer.slice(p.url));
    playStopSound(url, status, time);
});


// Set the recording timer
export function setRecordingTimer(serverTime: number, recTime: number, ticking: boolean) {
    recordingTimerBaseST = serverTime;
    recordingTimerBase = recTime;
    recordingTimerTicking = ticking;
    if (!recordingTimerInterval)
        recordingTimerInterval = setInterval(tickRecordingTimer, 500);
}

util.events.addEventListener("net.info." + prot.info.mode, function(ev: CustomEvent) {
    let val: number = ev.detail.val;
    let msg: DataView = ev.detail.msg;
    let p = prot.parts.info;

    if (msg.byteLength >= p.length + 16) {
        let sTime = msg.getFloat64(p.value + 4, true);
        let recTime = msg.getFloat64(p.value + 12, true);
        setRecordingTimer(sTime, recTime, (val === prot.mode.rec));
    }
});

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

// Get the available device info, for admin users
export function deviceInfo(allowVideo: boolean) {
    return navigator.mediaDevices.enumerateDevices().then((devices) => {
        let audio = [];
        let video = allowVideo ? [] : null;
        let ctr = 1, ctrv = 1;
        devices.forEach((dev) => {
            if (dev.kind === "audioinput") {
                audio.push({id: dev.deviceId, label: dev.label || ("Mic " + ctr++)});

            } else if (dev.kind === "videoinput" && allowVideo) {
                video.push({id: dev.deviceId, label: dev.label || ("Camera " + ctrv++)});

            }
        });

        return {
            audioDevices: audio,
            audioDevice: ui.ui.panels.inputConfig.device.value,
            videoDevices: video,
            videoDevice: allowVideo ? ui.ui.panels.videoConfig.device.value : null,
            videoRes: allowVideo ? +ui.ui.panels.videoConfig.res.value : null,
            videoRec: (typeof MediaRecorder !== "undefined"),
            mute: getMute(),
            echo: getEchoCancel()
        };

    });
}

// Administration of our various settings
util.netEvent("data", "admin", function(ev) {
    let msg: DataView = ev.detail;
    let p = prot.parts.admin;
    let acts = prot.flags.admin.actions;
    let action = msg.getUint32(p.action, true);

    // Some commands apply to all users
    if (action === acts.mute) {
        toggleMute(false);

    } else if (action === acts.echoCancel) {
        setEchoCancel(true);

    } else if (action === acts.request) {
        // Request for admin access
        let reqNick = util.decodeText(msg.buffer.slice(p.argument));
        let target = msg.getUint32(p.target, true);
        ui.ui.panels.userAdminReq.user = target;
        ui.ui.panels.userAdminReq.name.innerText = reqNick;
        ui.showPanel("userAdminReq", "audio");

    } else {
        // All other actions require permission
        let src = msg.getUint32(p.target, true);
        let acc = net.adminAccess[src];
        if (!acc || !acc.audio) return;

        // Beyond videoInput also require video permission
        if (action >= acts.videoInput && !acc.video) return;

        let arg = util.decodeText(msg.buffer.slice(p.argument));

        switch (action) {
            case acts.unmute:
                toggleMute(true);
                break;

            case acts.unechoCancel:
                setEchoCancel(false);
                break;

            case acts.audioInput:
                // FIXME: Better way to do this setting
                ui.ui.panels.inputConfig.device.value = arg;
                net.updateAdminPerm({audioDevice: arg});
                getMic(arg);
                break;

            default:
                // The rest are video-admin-related, so pass them off
                util.dispatchEvent("net.admin.video", {action: action, arg: arg});
        }
    }
});

