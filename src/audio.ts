/*
 * Copyright (c) 2018-2024 Yahweasel
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
 * Audio capture, encoding, and transmission.
 */

// extern
declare let MediaRecorder: any, webkitAudioContext: any;

import * as capture from "./capture";
import * as config from "./config";
import * as log from "./log";
import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import { dce } from "./util";
import * as vad from "./vad";

// We add our own output to the AudioContext
export type ECAudioContext = AudioContext & {
    /**
     * Destination for all Ennuicastr audio.
     */
    ecDestination?: AudioNode;

    /**
     * Destination delay before streaming, used to make sure data gets to echo
     * cancellation before getting to output.
     */
    ecDestinationDelay?: DelayNode;

    /**
     * Destination as a stream.
     */
    ecDestinationStream?: MediaStreamAudioDestinationNode;
};

/* Audio context. No matter how many audio devices we use, we only have one
 * audio context. */
export let ac: ECAudioContext = null;

// The Opus or FLAC packets to be handled.
type Packet = {
    ts: number,
    trackNo: number,
    data: DataView
};

// Our offset is updated every so often by the ping socket
export let timeOffset: null|number = null;

/* So that the time offset doesn't jump all over the place, we adjust it
 * *slowly*. This is the target time offset */
let targetTimeOffset: null|number = null;

// En/disable echo cancellation
export let useEC = false;
export function setUseEC(to: boolean): void { useEC = to; }

// En/disable recording both EC and non-EC
export let useDualEC = true;
export function setDualEC(to: boolean): void { useDualEC = to; }
const ecTrack = 0x80000000;

// And this is the amount to adjust it per frame (1%)
const timeOffsetAdjPerFrame = 0.0002;

// The delays on the pongs we've received back
const pongs: number[] = [];

// Recording timer updater
let recordingTimerInterval: null|number = null;

// Current base of recording timer, in server time ms
let recordingTimerBaseST = 0;

// Current base of recording timer, in recording time ms
let recordingTimerBase = 0;

// Whether the recording timer should be ticking
let recordingTimerTicking = false;

// Handle pongs for our time offset
util.netEvent("ping", "pong", function(ev) {
    const msg: DataView = ev.detail;

    const p = prot.parts.pong;
    const sent = msg.getFloat64(p.clientTime, true);
    const recvd = performance.now();
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
        const latency = pongs.reduce((a,b) => a+b)/10;
        const remoteTime = msg.getFloat64(p.serverTime, true) + latency;
        targetTimeOffset = remoteTime - recvd;
        if (timeOffset === null) {
            timeOffset = targetTimeOffset;
            util.dispatchEvent("audio.timeOffset");
        }
    }
});

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
    return Math.round(packet.ts + timeOffset*48);
}

// Play or stop a sound
function playStopSound(url: string, status: number, time: number) {
    let sound = ui.ui.sounds.soundboard[url];
    if (!sound) {
        // Create an element for it
        sound = ui.ui.sounds.soundboard[url] = {
            el: document.createElement("audio")
        };

        // Choose a format
        let format = "m4a";
        if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/webm; codecs=opus"))
            format = "webm"

        sound.el.src = url + "." + format;
        if (ui.ui.panels.outputConfig) {
            sound.el.volume = (+ui.ui.panels.outputConfig.sfxVolume.value) / 100;
            ui.ui.panels.outputConfig.sfxVolumeHider.style.display = "";
            try {
                let v = ui.ui.panels.outputConfig.device.value;
                if (v === "-default")
                    v = "";
                (<any> sound.el).setSinkId(v).catch(console.error);
            } catch (ex) {}
        }
    }
    const el = sound.el;

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
        const elCurTime = el.ecStartTime + el.currentTime * 1000;
        const realCurTime = performance.now() + timeOffset;
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
    const msg: DataView = ev.detail;
    const p = prot.parts.sound.sc;
    const time = msg.getFloat64(p.time, true);
    const status = msg.getUint8(p.status);
    const url = util.decodeText(msg.buffer.slice(p.url));
    playStopSound(url, status, time);
});

// Set the recording timer
export function setRecordingTimer(serverTime: number, recTime: number, ticking: boolean): void {
    recordingTimerBaseST = serverTime;
    recordingTimerBase = recTime;
    recordingTimerTicking = ticking;
    if (!recordingTimerInterval)
        recordingTimerInterval = setInterval(tickRecordingTimer, 500);
}

util.events.addEventListener("net.info." + prot.info.mode, function(ev: CustomEvent) {
    const val: number = ev.detail.val;
    const msg: DataView = ev.detail.msg;
    const p = prot.parts.info;

    if (msg.byteLength >= p.length + 16) {
        const sTime = msg.getFloat64(p.value + 4, true);
        const recTime = msg.getFloat64(p.value + 12, true);
        setRecordingTimer(sTime, recTime, (val === prot.mode.rec));
    }
});

// Tick the recording timer
function tickRecordingTimer() {
    let time = recordingTimerBase;
    if (recordingTimerTicking && timeOffset !== null)
        time += performance.now() + timeOffset - recordingTimerBaseST;

    time = ~~(time / 1000);
    let s = "" + ~~(time % 60);
    if (s.length < 2) s = "0" + s;
    time = ~~(time / 60);
    let m = "" + ~~(time % 60);
    time = ~~(time / 60);
    const h = ~~time;
    if (h && m.length < 2) m = "0" + m;
    const timer = ui.ui.log.timer;
    timer.style.color = recordingTimerTicking ? "#080" : "#800";
    timer.innerText = (h?(h+":"):"") + m + ":" + s;
}

/**
 * Initialize the AudioContext. Must be done once when first loading. Returns a
 * promise that may require transient activation.
 */
export function initAudioContext() {
    // Create our AudioContext if needed
    if (!ac) {
        try {
            ac = new AudioContext({latencyHint: "playback"});
        } catch (ex) {
            // Try Apple's, and if not that, nothing left to try, so crash
            ac = new webkitAudioContext();
        }

        // Make an output for it
        let msd: MediaStreamAudioDestinationNode | null = null;
        const ecDest = ac.ecDestination = ac.createGain();
        ecDest.gain.value = 1;
        const ecDelay = ac.ecDestinationDelay = ac.createDelay();
        ecDest.connect(ecDelay);
        if ((<any> ac).setSinkId) {
            ecDelay.connect(ac.destination);
        } else {
            msd = ac.ecDestinationStream =
                ac.createMediaStreamDestination();
            ecDelay.connect(msd);
        }

        // Keep the output from doing anything weird by giving it silence
        const msdSilence = ac.createConstantSource();
        msdSilence.offset.value = 0;
        msdSilence.connect(ecDest);
        msdSilence.start();


        // Start playing it when we're (relatively) sure we can
        util.events.addEventListener("usermediartcready", () => {
            let a = ui.ui.audioOutput;
            if (!a) {
                a = ui.ui.audioOutput = dce("audio");
                a.style.display = "none";
                document.body.appendChild(a);
            }

            if (msd)
                a.srcObject = msd.stream;
            try {
                let v = ui.ui.panels.outputConfig.device.value;
                if (v === "-default")
                    v = "";
                if (msd)
                    (<any> a).setSinkId(v).catch(console.error);
                else
                    (<any> ac).setSinkId(v).catch(console.error);
            } catch (ex) {}
            if (msd)
                a.play().catch(console.error);
        });
    }

    /* If AudioContext started paused, we need to unpause it with transient
     * activation */
    const needTransientActivation = (ac.state !== "running");
    return ui.maybeOnTransientActivation(needTransientActivation, async () => {
        if (needTransientActivation)
            await ac.resume();

        if (ac.state !== "running")
            log.pushStatus("audiocontext", "Cannot capture audio! State: " + util.escape(ac.state));

        // At this point, we want to start catching errors
        window.addEventListener("error", function(error) {
            try {
                let msg = "";
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
                let msg;
                try {
                    msg = JSON.stringify(error);
                } catch (ex) {
                    msg = error+"";
                }
                msg += "\n\n" + new Error().stack;
                net.errorHandler(msg);
            }
        });
    });
}


/**
 * Audio capture and recording.
 */
export class Audio {
    // The audio device being read
    userMedia: MediaStream = null;

    // The encoder for this device
    userMediaEncoder: capture.Capture = null;

    // The capture of this device, used for RTC
    userMediaCapture: capture.Capture = null;

    // Where to save the channel setting
    channelSettingName: string = null;

    // Which channel to read, or -1 for all
    channel: number = -1;

    // Channel layout for encoding?
    encodingChannelLayout: number = 4;

    // Outstanding packets
    packets: Packet[] = [];

    // Opus zero packet, will be replaced with FLAC's version if needed
    zeroPacket = new Uint8Array([0xF8, 0xFF, 0xFE]);

    /* To help with editing by sending a clean silence sample, we send the
     * first few (arbitrarily, 8) seconds of VAD-off silence */
    sendSilence = 400;

    /* When we're not sending real data, we have to send a few (arbitrarily, 3)
     * empty frames */
    sentZeroes = 999;

    /* We keep track of the last time we successfully encoded data for
     * transfer, to determine if anything's gone wrong */
    lastSentTimeNoEC = 0;
    lastSentTimeYesEC = 0;
    lastSentTime = 0;

    constructor(
        /** Index of this audio input */
        public idx: number
    ) {}

    // Get audio permission. First audio step of the process.
    getAudioPerms(mkAudioUI: ()=>string): Promise<unknown> {
        return navigator.mediaDevices.getUserMedia({audio: true}).catch(() => null).then((userMediaIn) => {
            this.userMedia = userMediaIn; // So that it gets deleted by getMic
            return this.getMic(mkAudioUI());
        }).catch(net.catastrophicErrorFactory());
    }

    /* The starting point for enabling encoding. Get our microphone input. Returns
     * a promise that resolves when encoding is active. */
    getMic(deviceId?: string): Promise<unknown> {
        if (!net.connected)
            return;

        log.pushStatus("getmic", "Asking for microphone permission...", {
            timein: 1000
        });

        // Make sure the VAD state is available
        while (vad.vads.length <= this.idx)
            vad.vads.push(null);
        if (!vad.vads[this.idx])
            vad.vads[this.idx] = new vad.VAD();

        // First get rid of any active sources
        if (this.userMedia) {
            this.userMedia.getTracks().forEach(track => track.stop());
            this.userMedia = null;
            this.userMediaEncoder = null;
            if (this.userMediaCapture) {
                // The disconnection of the whole line happens in proc.ts
                this.userMediaCapture.disconnect();
            }
            util.dispatchEvent("usermediastopped", {idx: this.idx});
            util.dispatchEvent("usermediastopped" + this.idx, {idx: this.idx});
        }

        // Then request the new ones
        return navigator.mediaDevices.getUserMedia({
            audio: <any> {
                deviceId: deviceId,
                autoGainControl: {ideal: ui.ui.panels.inputConfig.agc.checked},
                echoCancellation: {ideal: this.getEchoCancel()},
                noiseSuppression: {ideal: false},
                sampleRate: {ideal: 48000},
                sampleSize: {ideal: 24}
            }
        }).catch(() => null).then(userMediaIn => {
            this.userMedia = userMediaIn;

            // Set up the channel selector
            const channelCt = userMediaIn ?
                userMediaIn.getAudioTracks()[0].getSettings().channelCount :
                1;
            if (channelCt > 1) {
                ui.ui.panels.inputConfig.channelHider.style.display = "";
            } else {
                ui.ui.panels.inputConfig.channelHider.style.display = "none";
            }

            const channel = ui.ui.panels.inputConfig.channel;
            channel.innerHTML = "";
            const all = dce("option");
            all.innerText = "All (mix)";
            all.value = "-1";
            channel.appendChild(all);
            /* FIXME: This doesn't work on the server right now, so not provided
            if (channelCt > 2) {
                const sep = dce("option");
                sep.innerText = "All (separate channels)";
                sep.value = "-3";
                channel.appendChild(sep);
            }
            */
            const stereo = dce("option");
            stereo.innerText = "Stereo";
            stereo.value = "-2";
            channel.appendChild(stereo);
            for (let i = 0; i < channelCt; i++) {
                const ch = dce("option");
                ch.innerText = "" + (i+1);
                ch.value = "" + i;
                channel.appendChild(ch);
            }
            channel.value = "-1";

            // Load the channel setting
            const csn = this.channelSettingName = "audio-" + deviceId + "-channel";
            const cs = localStorage.getItem(csn);
            if (cs)
                channel.value = cs;
            this.channel = +channel.value;

            // And stereo setting
            if (this.channel === -2 /* stereo */ && channelCt >= 2) {
                this.channel = -1;
                this.encodingChannelLayout = 3 /* left + right */;
            } else if (this.channel === -3 /* all separated */ && channelCt > 2) {
                this.channel = -1;
                this.encodingChannelLayout = Math.pow(2, channelCt) - 1;
            } else {
                this.encodingChannelLayout = 4 /* center */;
            }

            // And move on to the next step
            log.popStatus("getmic");
            return this.userMediaSet();
        }).catch(net.catastrophicErrorFactory());
    }

    /* Called once we have mic access. Returns a promise which *may* depend on
     * transient activation. */
    private userMediaSet(): Promise<unknown> {
        if (!net.connected)
            return;

        // If we don't *actually* have a userMedia, fake one
        let noUserMedia = false;
        if (!this.userMedia) {
            noUserMedia = true;
            const cs = ac.createConstantSource();
            const msd = ac.createMediaStreamDestination();
            cs.connect(msd);
            this.userMedia = msd.stream;

            // Warn them
            log.pushStatus("usermedia", "Failed to capture audio!", {
                timeout: 10000
            });
        }

        // Now UserMedia and AudioContext are ready
        util.dispatchEvent("audio.mute");

        log.pushStatus("initenc", "Initializing encoder...", {
            timein: 1000
        });

        util.dispatchEvent("usermediaready", {idx: this.idx});
        util.dispatchEvent("usermediaready" + this.idx, {idx: this.idx});

        return this.encoderLoaded();
    }

    /* Called once the specialized encoder is loaded, if it's needed. Returns a
     * promise that resolves once encoding is active. */
    private encoderLoaded(): Promise<unknown> {
        if (!net.connected)
            return;

        log.pushStatus("startenc", "Starting encoder...", {
            timein: 1000
        });
        log.popStatus("initenc");

        return this.encoderStart();
    }

    // Start our encoder
    private encoderStart(): Promise<unknown> {
        // We need to choose our target sample rate based on the input sample rate and format
        let sampleRate = 48000;
        if (config.useFlac && ac.sampleRate === 44100)
            sampleRate = 44100;

        // The server needs to be informed of FLAC's sample rate
        if (config.useFlac) {
            const p = prot.parts.info;
            const info = new DataView(new ArrayBuffer(p.length));
            info.setUint32(0, prot.ids.info, true);
            info.setUint32(p.key, prot.info.sampleRate, true);
            info.setUint32(p.value, sampleRate, true);
            net.flacInfo(info.buffer);
        }

        // Set our zero packet as appropriate
        if (config.useFlac) {
            switch (sampleRate) {
                case 44100:
                    this.zeroPacket = new Uint8Array([0xFF, 0xF8, 0x79, 0x0C, 0x00, 0x03, 0x71, 0x56, 0x00, 0x00, 0x00, 0x00, 0x63, 0xC5]);
                    break;
                default:
                    this.zeroPacket = new Uint8Array([0xFF, 0xF8, 0x7A, 0x0C, 0x00, 0x03, 0xBF, 0x94, 0x00, 0x00, 0x00, 0x00, 0xB1, 0xCA]);
            }
        }

        // Figure out our channel layout based on the number of channels
        let channelLayout = 4;
        const channelCount = ~~((<any> this.userMedia.getAudioTracks()[0].getSettings()).channelCount);
        if (channelCount > 1)
            channelLayout = Math.pow(2, channelCount) - 1;

        // Create the capture stream
        return capture.createCapture(ac, {
            input: this.userMedia,
            matchSampleRate: true,
            backChannels: 1, // for echo-cancelled data
            workerCommand: {
                c: "encoder",
                outSampleRate: sampleRate,
                format: config.useFlac ? "flac" : "opus",
                channelLayout: channelLayout,
                channelCount: channelCount,
                channel: this.channel,
                outputChannelLayout: this.encodingChannelLayout,
                backChannelTracks: [ecTrack]
            }

        }).then(capture => {
            // Accept encoded packets
            let last = 0;
            capture.worker.onmessage = (ev) => {
                const msg = ev.data;
                if (msg.c !== "packets") return;

                // Figure out the packet start time
                const p = msg.d;
                const now = msg.ts + performance.now() - Date.now(); // time adjusted from Date.now to performance.now
                let pktTime = Math.round(
                    now * 48 -
                    p.length * 960
                );

                // Add them to our own packet buffer
                for (let pi = 0; pi < p.length; pi++) {
                    this.packets.push({
                        ts: pktTime,
                        trackNo: msg.track,
                        data: new DataView(p[pi].buffer)
                    });
                    pktTime += 960;
                }

                // Check for sequence issues
                if (!msg.track) {
                    if (msg.s > last)
                        net.errorHandler("Sequence error! " + msg.s + " " + last);
                    last = msg.s + p.length;
                }

                this.handlePackets();
            };

            this.userMediaEncoder = capture;

            // Inform others that this is ready
            util.dispatchEvent("usermediaencoderready" + this.idx, {idx: this.idx});

            // Terminate when user media stops
            util.events.addEventListener("usermediastopped" + this.idx, capture.disconnect, {once: true});

        }).catch(net.promiseFail());

    }


    // Once we've parsed new packets, we can do something with them
    private handlePackets() {
        if (!this.packets.length || timeOffset === null) return;

        const curGranulePos = this.packets[this.packets.length-1].ts;
        net.setTransmitting(true);

        // We have something to handle, so this is our last sent time.
        if (useDualEC) {
            // The last sent time is based on either
            let hadNoEC = false;
            let hadYesEC = false;
            for (const packet of this.packets) {
                if (packet.trackNo & ecTrack)
                    hadYesEC = true;
                else
                    hadNoEC = true;
                if (hadYesEC && hadNoEC)
                    break;
            }
            const now = performance.now();
            if (hadNoEC)
                this.lastSentTimeNoEC = now;
            if (hadYesEC)
                this.lastSentTimeYesEC = now;
            this.lastSentTime = Math.min(
                this.lastSentTimeNoEC, this.lastSentTimeYesEC
            );
        } else {
            this.lastSentTime = performance.now();
        }
        log.popStatus("startenc");

        // Don't actually *send* anything if we're not recording
        if (net.mode !== prot.mode.rec) {
            while (this.packets.length)
                this.packets.pop();
            return;
        }

        if (!vad.vads[this.idx].vadOn) {
            /* Drop any sufficiently old packets, or send them marked as
             * silence in continuous mode */
            const old = curGranulePos - vad.vadExtension*48;
            while (this.packets[0].ts < old) {
                const packet = this.packets.shift();

                // Ignore non-primary tracks
                if (packet.trackNo && !config.useContinuous)
                    continue;

                const granulePos = adjustTime(packet);
                if (granulePos < 0)
                    continue;
                if (config.useContinuous || this.sendSilence > 0) {
                    /* Send it in VAD-off mode */
                    this.sendPacket(
                        packet.trackNo, granulePos, packet.data, 0
                    );
                    this.sendSilence--;

                } else if (this.sentZeroes < 3) {
                    /* Send an empty packet in its stead */
                    if (granulePos < 0) continue;
                    this.sendPacket(0, granulePos, this.zeroPacket, 0);
                    this.sentZeroes++;
                }
            }

        } else {
            const vadVal = (vad.vads[this.idx].rawVadOn?2:1);

            // VAD is on, so send packets
            this.packets.forEach((packet) => {
                const data = packet.data;

                const granulePos = adjustTime(packet);
                if (granulePos < 0)
                    return;

                if (useDualEC) {
                    // Send all packets, regardless of track
                    this.sendPacket(packet.trackNo, granulePos, data, vadVal);
                } else {
                    // Echo-cancelled packets use a specific track
                    if ((useEC && (packet.trackNo & ecTrack)) ||
                        (!useEC && !(packet.trackNo & ecTrack)))
                    {
                        /* FIXME: When there are multiple input tracks, we need
                         * to preserve all non-EC bits of this track no. */
                        this.sendPacket(0, granulePos, data, vadVal);
                    }
                }
            });

            this.sentZeroes = 0;
            this.packets = [];

        }
    }

    // Send an audio packet
    private sendPacket(
        trackNo: number, granulePos: number, data: {buffer: ArrayBuffer},
        vadVal: number
    ) {
        let p = trackNo ? prot.parts.datax : prot.parts.data;
        const msg = new DataView(new ArrayBuffer(
            p.length + (config.useContinuous?1:0) + data.buffer.byteLength));
        msg.setUint32(0, trackNo ? prot.ids.datax : prot.ids.data, true);
        if (trackNo)
            msg.setUint32(p.track, trackNo, true);
        msg.setUint32(p.granulePos, granulePos & 0xFFFFFFFF, true);
        msg.setUint16(p.granulePos + 4, (granulePos / 0x100000000) & 0xFFFF, true);
        if (config.useContinuous)
            msg.setUint8(p.packet, vadVal);
        const data8 = new Uint8Array(data.buffer);
        (new Uint8Array(msg.buffer)).set(
            data8, p.packet + (config.useContinuous?1:0));
        net.dataSock.send(msg.buffer);
    }

    // Get the state of muting (true=MUTED)
    getMute() {
        const track = this.userMedia.getAudioTracks()[0];
        return !track.enabled;
    }

    // Get the echo cancellation state
    getEchoCancel(): boolean {
        return ui.ui.panels.inputConfig.echo.checked;
    }

    // Toggle the mute state of the input audio (true=UNMUTED)
    toggleMute(to?: boolean): boolean {
        if (!this.userMedia) return;
        const track = this.userMedia.getAudioTracks()[0];
        if (typeof to === "undefined")
            to = !track.enabled;
        track.enabled = to;
        if (this.idx === 0) {
            util.dispatchEvent("audio.mute");
            net.updateAdminPerm({mute: !to});
        }
        return to;
    }

    // Set the echo cancellation state of the input audio
    setEchoCancel(to: boolean): Promise<unknown> {
        // Update the UI
        ui.ui.panels.inputConfig.echo.checked = to;

        // Update any admins
        net.updateAdminPerm({echo: to});

        // And make it so
        return this.getMic(ui.ui.panels.inputConfig.device.value);
    }

    // Set the input device
    setInputDevice(to: string): Promise<unknown> {
        // Update the UI
        ui.ui.panels.inputConfig.device.value = to;
        ui.ui.panels.inputConfig.channelHider.style.display = "none";

        // Update any admins
        net.updateAdminPerm({audioDevice: to});

        // And make it so
        return this.getMic(to);
    }

    // Set the input channel
    setInputChannel(to: number): Promise<unknown> {
        // Update the UI
        ui.ui.panels.inputConfig.channel.value = "" + to;

        // Save it
        localStorage.setItem(this.channelSettingName, "" + to);

        // And make it so
        return this.getMic(ui.ui.panels.inputConfig.device.value);
    }
}


// The current audio input
export const inputs = [new Audio(0)];


// Get the available device info, for admin users
export function deviceInfo(allowVideo: boolean): any {
    return navigator.mediaDevices.enumerateDevices().then((devices) => {
        const audio: {id: string, label: string}[] = [];
        const video: {id: string, label: string}[] = allowVideo ? [] : null;
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
            mute: inputs[0].getMute(),
            echo: inputs[0].getEchoCancel(),
            vadSensitivity: +ui.ui.panels.inputConfig.vadSensitivity.value,
            vadNoiseGate: +ui.ui.panels.inputConfig.vadNoiseGate.value
        };

    });
}

// Administration of our various settings
util.netEvent("data", "admin", function(ev) {
    const msg: DataView = ev.detail;
    const p = prot.parts.admin;
    const acts = prot.flags.admin.actions;
    const action = msg.getUint32(p.action, true);

    // Some commands apply to all users
    if (action === acts.mute) {
        for (const input of inputs) {
            if (input)
                input.toggleMute(false);
        }

    } else if (action === acts.echoCancel) {
        for (const input of inputs) {
            if (input)
                input.setEchoCancel(true);
        }

    } else if (action === acts.request) {
        // Request for admin access
        const reqNick = util.decodeText(msg.buffer.slice(p.argument));
        const target = msg.getUint32(p.target, true);
        const panel = ui.ui.panels.userAdminReq;
        panel.user = target;
        panel.name.innerText = reqNick;
        ui.showPanel(panel, panel.audio);

    } else {
        // All other actions require permission
        const src = msg.getUint32(p.target, true);
        const acc = net.adminAccess[src];
        if (!acc || !acc.audio) return;

        // Beyond videoInput also require video permission
        if (action >= acts.videoInput && !acc.video) return;


        switch (action) {
            case acts.unmute:
                for (const input of inputs) {
                    if (input)
                        input.toggleMute(true);
                }
                break;

            case acts.unechoCancel:
                for (const input of inputs) {
                    if (input)
                        input.setEchoCancel(false);
                }
                break;

            case acts.audioInput:
            {
                const arg =
                    util.decodeText(msg.buffer.slice(p.argument));
                for (const input of inputs) {
                    if (input) {
                        input.setInputDevice(arg);
                        break;
                    }
                }
                break;
            }

            case acts.vadSensitivity:
            {
                const arg = msg.getInt32(p.argument, true);
                const inp = ui.ui.panels.inputConfig.vadSensitivity;
                inp.value = "" + arg;
                inp.oninput(null);
                inp.onchange(null);
                break;
            }

            case acts.vadNoiseGate:
            {
                const arg = msg.getInt32(p.argument, true);
                const inp = ui.ui.panels.inputConfig.vadNoiseGate;
                inp.value = "" + arg;
                inp.oninput(null);
                inp.onchange(null);
                break;
            }

            default:
                // The rest are video-admin-related, so pass them off
                util.dispatchEvent("net.admin.video", {
                    action: action,
                    arg: util.decodeText(msg.buffer.slice(p.argument))
                });
        }
    }
});
