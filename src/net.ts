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

import * as audio from "./audio";
import * as chat from "./chat";
import * as config from "./config";
import * as log from "./log";
import * as master from "./master";
import { prot } from "./protocol";
import * as rtc from "./rtc";
import * as util from "./util";
import * as ui from "./ui";
import { dce } from "./util";
import * as video from "./video";

/* We have multiple connections to the server:
 * One for pings,
 * one to send data, and
 * if we're the master, one for master communication */
export var pingSock: WebSocket = null;
export var dataSock: WebSocket = null;
export var masterSock: WebSocket = null;

// Global connection state
export var connected = false;
export var transmitting = false;
export function setTransmitting(to: boolean) { transmitting = to; }

// Our own ID
export var selfId = 0;

// The name of this recording, which may never be set
export var recName: null|string = null;

// We connect assuming our mode is not-yet-recording
export var mode = prot.mode.init;

// ICE servers for RTC
export var iceServers = [
    {
        urls: "stun:stun.l.google.com:19302"
    }
];

// The delays on the pongs we've received back
var pongs: number[] = [];

/* So that the time offset doesn't jump all over the place, we adjust it
 * *slowly*. This is the target time offset */
export var targetTimeOffset: null|number = null;

// The remote start time, i.e., when recording began
export var remoteBeginTime: null|number = null;

// If we're flushing our buffers, this will be a timeout to re-check
var flushTimeout: null|number = null;

// Connect to the server (our first step)
export function connect() {
    // Our connection message, which is largely the same for all three
    var p: any, f: any, out: DataView, flags: number;

    return Promise.all([]).then(function() {
        // (1) The ping socket
        connected = true;
        log.pushStatus("conn", "Connecting...");

        return new Promise(function(res, rej) {
            pingSock = new WebSocket(config.wsUrl);
            pingSock.binaryType = "arraybuffer";

            pingSock.addEventListener("open", function() {
                var nickBuf = util.encodeText(config.username);

                p = prot.parts.login;
                out = new DataView(new ArrayBuffer(p.length + nickBuf.length));
                out.setUint32(0, prot.ids.login, true);
                f = prot.flags;
                flags = (config.useFlac?f.dataType.flac:0) | (config.useContinuous?f.features.continuous:0);
                out.setUint32(p.id, config.config.id, true);
                out.setUint32(p.key, config.config.key, true);
                out.setUint32(p.flags, f.connectionType.ping | flags, true);
                new Uint8Array(out.buffer).set(nickBuf, 16);
                pingSock.send(out.buffer);

                res(void 0);
            });

            pingSock.addEventListener("message", pingSockMsg);
            pingSock.addEventListener("error", disconnect);
            pingSock.addEventListener("close", disconnect);
        });

    }).then(function() {
        // (2) The data socket
        return new Promise(function(res, rej) {
            dataSock = new WebSocket(config.wsUrl);
            dataSock.binaryType = "arraybuffer";

            dataSock.addEventListener("open", function() {
                out.setUint32(p.flags, f.connectionType.data | flags, true);
                dataSock.send(out.buffer);

                res(void 0);
            });

            dataSock.addEventListener("message", dataSockMsg);
            dataSock.addEventListener("error", disconnect);
            dataSock.addEventListener("close", disconnect);
        });

    }).then(function() {
        // (3) The master socket
        if ("master" in config.config) return new Promise(function(res, rej) {
            masterSock = new WebSocket(config.wsUrl);
            masterSock.binaryType = "arraybuffer";

            masterSock.addEventListener("open", function() {
                out.setUint32(p.key, config.config.master, true);
                out.setUint32(p.flags, f.connectionType.master | flags, true);
                masterSock.send(out.buffer);

                res(void 0);
            });

            masterSock.addEventListener("message", masterSockMsg);
            masterSock.addEventListener("error", disconnect);
            masterSock.addEventListener("close", disconnect);
        });

    });
}

// Called to disconnect explicitly, or implicitly on error
export function disconnect(ev?: Event) {
    if (!connected)
        return;
    connected = false;

    log.log.innerHTML = "";
    var sp = dce("span");
    sp.innerText = "Disconnected! ";
    log.log.appendChild(sp);
    var a = dce("a");
    var href = "?";
    for (var key in config.config)
        href += key[0] + "=" + (<any> config.config)[key].toString(36) + "&";
    href += "nm=" + encodeURIComponent(config.username);
    a.href = href;
    a.innerText = "Attempt reconnection";
    log.log.appendChild(a);

    var target: Object = null;
    if (ev && ev.target)
        target = ev.target;

    function close(sock: WebSocket): WebSocket {
        if (sock && sock !== target)
            sock.close();
        return null;
    }
    pingSock = close(pingSock);
    dataSock = close(dataSock);
    masterSock = close(masterSock);

    audio.disconnect();
    video.disconnect();
    rtc.disconnect();
}

// Ping the ping socket
function ping() {
    var p = prot.parts.ping;
    var msg = new DataView(new ArrayBuffer(p.length));
    msg.setUint32(0, prot.ids.ping, true);
    msg.setFloat64(p.clientTime, performance.now(), true);
    pingSock.send(msg);
}

// Message from the ping socket
function pingSockMsg(ev: MessageEvent) {
    var msg = new DataView(ev.data);
    var cmd = msg.getUint32(0, true);

    switch (cmd) {
        case prot.ids.ack:
            var ackd = msg.getUint32(prot.parts.ack.ackd, true);
            if (ackd === prot.ids.login) {
                // We're logged in, so start pinging
                ping();
            }
            break;

        // All we really care about
        case prot.ids.pong:
            var p = prot.parts.pong;
            var sent = msg.getFloat64(p.clientTime, true);
            var recvd = performance.now();
            pongs.push(recvd - sent);
            while (pongs.length > 5)
                pongs.shift();
            if (pongs.length < 5) {
                // Get more pongs now!
                setTimeout(ping, 150);
            } else {
                // Get more pongs... eventually
                setTimeout(ping, 10000);

                // And figure out our offset
                var latency = pongs.reduce(function(a,b){return a+b;})/10;
                var remoteTime = msg.getFloat64(p.serverTime, true) + latency;
                targetTimeOffset = remoteTime - recvd;
                if (audio.timeOffset === null) audio.setFirstTimeOffset(targetTimeOffset);
            }
            break;
    }
}

// Message from the data socket
function dataSockMsg(ev: MessageEvent) {
    var msg = new DataView(ev.data);
    var cmd = msg.getUint32(0, true);

    switch (cmd) {
        case prot.ids.nack:
            // Just tell the user
            var p = prot.parts.nack;
            var text = util.decodeText(msg.buffer.slice(p.msg));
            alert(text);
            log.pushStatus("nack", text);
            break;

        case prot.ids.info:
            var p = prot.parts.info;
            var key = msg.getUint32(p.key, true);
            var val = 0;
            if (msg.byteLength >= p.length)
                val = msg.getUint32(p.value, true);
            switch (key) {
                case prot.info.id:
                    // Our own ID
                    selfId = val;
                    break;

                case prot.info.peerInitial:
                case prot.info.peerContinuing:
                    // We may need to start an RTC connection
                    if (config.useRTC)
                        rtc.initRTC(val);
                    break;

                case prot.info.peerLost:
                    if (config.useRTC)
                        rtc.closeRTC(val);
                    break;

                case prot.info.mode:
                    // Set the mode
                    mode = val;

                    // Make it visible in the waveform
                    var wvms = ((val === prot.mode.rec) ? "r" : "s") +
                               (config.useContinuous ? "c" : "v");
                    config.setWaveVADColors(wvms);

                    // Update the status
                    log.popStatus("mode");
                    if (mode < prot.mode.rec)
                        log.pushStatus("mode", "Not yet recording");
                    else if (mode === prot.mode.paused)
                        log.pushStatus("mode", "Recording paused");
                    else if (mode > prot.mode.rec)
                        log.pushStatus("mode", "Not recording");

                    // Mention flushing buffers if we are
                    if (mode === prot.mode.buffering) {
                        flushBuffers();
                    } else if (flushTimeout) {
                        clearTimeout(flushTimeout);
                        flushTimeout = null;
                    }

                    // Update the master interface
                    if ("master" in config.config)
                        master.configureMasterInterface();

                    break;

                case prot.info.startTime:
                    remoteBeginTime = msg.getFloat64(p.value, true);
                    break;

                case prot.info.recName:
                    recName = util.decodeText(msg.buffer.slice(p.value));
                    document.title = recName + " — Ennuicastr";
                    break;

                case prot.info.ice:
                    var iceServer = JSON.parse(util.decodeText(msg.buffer.slice(p.value)));
                    iceServers.push(iceServer);
                    break;
            }
            break;

        case prot.ids.sound:
            p = prot.parts.sound.sc;
            var time = msg.getFloat64(p.time, true);
            var status = msg.getUint8(p.status);
            var url = util.decodeText(msg.buffer.slice(p.url));
            audio.playStopSound(url, status, time);
            break;

        case prot.ids.user:
            p = prot.parts.user;
            var index = msg.getUint32(p.index, true);
            var status = msg.getUint32(p.status, true);
            var nick = util.decodeText(msg.buffer.slice(p.nick));

            // Add it to the UI
            if (status)
                ui.userListAdd(index, nick);
            else
                ui.userListRemove(index);
            break;

        case prot.ids.speech:
        {
            if (config.useRTC) {
                // Handled through RTC
                break;
            }
            p = prot.parts.speech;
            var indexStatus = msg.getUint32(p.indexStatus, true);
            let index = indexStatus>>>1;
            let status = (indexStatus&1);
            ui.userListUpdate(index, !!status);
            break;
        }

        case prot.ids.rtc:
            var p = prot.parts.rtc;
            var peer = msg.getUint32(p.peer, true);
            var type = msg.getUint32(p.type, true);
            var conn: RTCPeerConnection, outgoing: boolean;
            var outgoing: boolean;
            if (type & 0x80000000) {
                // For *their* outgoing connection
                conn = rtc.rtcConnections.peers[peer].incoming;
                outgoing = false;
            } else {
                conn = rtc.rtcConnections.peers[peer].outgoing;
                outgoing = true;
            }
            if (!conn)
                break;

            var value = JSON.parse(util.decodeText(msg.buffer.slice(p.value)));

            switch (type&0x7F) {
                case prot.rtc.candidate:
                    if (value && value.candidate)
                        conn.addIceCandidate(value);
                    break;

                case prot.rtc.offer:
                    conn.setRemoteDescription(value).then(function() {
                        return conn.createAnswer();

                    }).then(function(answer) {
                        return conn.setLocalDescription(answer);

                    }).then(function() {
                        rtc.rtcSignal(peer, outgoing, prot.rtc.answer, conn.localDescription);

                    }).catch(function(ex) {
                        log.pushStatus("rtc", "RTC connection failed!");

                    });
                    break;

                case prot.rtc.answer:
                    conn.setRemoteDescription(value).catch(function(ex) {
                        log.pushStatus("rtc", "RTC connection failed!");
                    });
                    break;
            }
            break;

        case prot.ids.text:
            var p = prot.parts.text;
            var text = util.decodeText(msg.buffer.slice(p.text));
            chat.recvChat(text);
            break;

        case prot.ids.admin:
            var p = prot.parts.admin;
            var acts = prot.flags.admin.actions;
            var action = msg.getUint32(p.action, true);
            if (action === acts.mute) {
                audio.toggleMute(false);
            } else if (action === acts.echoCancel) {
                if (!ui.ui.deviceList.ec.checked) {
                    ui.ui.deviceList.ec.ecAdmin = true;
                    ui.ui.deviceList.ec.checked = true;
                    ui.ui.deviceList.ec.onchange(null);
                }
            }
            break;
    }
}

// Message from the master socket
function masterSockMsg(ev: MessageEvent) {
    var msg = new DataView(ev.data);
    var cmd = msg.getUint32(0, true);
    var p;

    switch (cmd) {
        case prot.ids.info:
            p = prot.parts.info;
            var key = msg.getUint32(p.key, true);
            var val = 0;
            if (msg.byteLength >= p.length)
                val = msg.getUint32(p.value, true);
            switch (key) {
                case prot.info.creditCost:
                    // Informing us of the cost of credits
                    var v2 = msg.getUint32(p.value + 4, true);
                    ui.ui.masterUI.creditCost = {
                        currency: val,
                        credits: v2
                    };
                    break;

                case prot.info.creditRate:
                    // Informing us of the total cost and rate in credits
                    var v2 = msg.getUint32(p.value + 4, true);
                    ui.ui.masterUI.creditRate = [val, v2];
                    master.masterUpdateCreditCost();
                    break;

                case prot.info.sounds:
                    // Soundboard items
                    var valS = util.decodeText(msg.buffer.slice(p.value));
                    master.addSoundButtons(JSON.parse(valS));
                    break;
            }
            break;

        case prot.ids.user:
            p = prot.parts.user;
            var index = msg.getUint32(p.index, true);
            var status = msg.getUint32(p.status, true);
            var nick = util.decodeText(msg.buffer.slice(p.nick));

            // Add it to the UI
            var speech = ui.ui.masterUI.speech = ui.ui.masterUI.speech || [];
            while (speech.length <= index)
                speech.push(null);
            speech[index] = {
                nick: nick,
                online: !!status,
                speaking: false
            };

            master.updateMasterSpeech();
            break;

        case prot.ids.speech:
        {
            p = prot.parts.speech;
            let indexStatus = msg.getUint32(p.indexStatus, true);
            let index = indexStatus>>>1;
            let status = (indexStatus&1);
            if (!ui.ui.masterUI.speech[index]) return;
            ui.ui.masterUI.speech[index].speaking = !!status;
            master.updateMasterSpeech();
            break;
        }
    }
}

// Flush our buffers
function flushBuffers() {
    if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
    }

    if (!dataSock) return;

    if (dataSock.bufferedAmount)
        log.pushStatus("buffering", "Sending audio to server (" + util.bytesToRepr(dataSock.bufferedAmount) + ")...");
    else
        log.popStatus("buffering");

    flushTimeout = setTimeout(function() {
        flushTimeout = null;
        flushBuffers();
    }, 1000);
}

// Generic phone-home error handler
export function errorHandler(error: any) {
    var errBuf = util.encodeText(error + "\n\n" + navigator.userAgent);
    var out = new DataView(new ArrayBuffer(4 + errBuf.length));
    out.setUint32(0, prot.ids.error, true);
    new Uint8Array(out.buffer).set(errBuf, 4);
    dataSock.send(out.buffer);
}
