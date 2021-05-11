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

import * as config from "./config";
import * as log from "./log";
import { prot } from "./protocol";
import * as util from "./util";
import { dce } from "./util";

/* We have multiple connections to the server:
 * One for pings,
 * one to send data, and
 * if we're the master, one for master communication */
export var pingSock: ReconnectableWebSocket = null;
export var dataSock: ReconnectableWebSocket = null;
export var masterSock: ReconnectableWebSocket = null;

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

// If we're using FLAC, we get the sample rate to send to the server
var flacInfoBuf: ArrayBuffer = null;

// ICE servers for RTC
export var iceServers = [
    {
        urls: "stun:stun.l.google.com:19302"
    }
];

// The remote start time, i.e., when recording began
export var remoteBeginTime: null|number = null;

// If we're flushing our buffers, this will be a timeout to re-check
var flushTimeout: null|number = null;

// A WebSocket that can automatically reconnect if it's unexpectedly disconnected
class ReconnectableWebSocket {
    sock: WebSocket;
    url: string;
    connecter: (arg0:WebSocket)=>Promise<unknown>;
    closeHandler: (arg0:CloseEvent)=>unknown;
    promise: Promise<unknown>;
    keepaliveTimeout: null|number;

    constructor(url: string, closeHandler: (arg0:CloseEvent)=>unknown, connecter: (arg0:WebSocket)=>Promise<unknown>) {
        this.url = url;
        this.closeHandler = closeHandler;
        this.connecter = connecter;
        this.promise = Promise.all([]);
        this.keepaliveTimeout = null;
    }

    // Perform the initial connection
    connect() {
        let sock: WebSocket;
        let connectTimeout: null|number = null;
        this.promise = this.promise.then(() => {
            // Set up the web socket
            sock = this.sock = new WebSocket(this.url);
            sock.binaryType = "arraybuffer";
            sock.onerror = this.closeHandler;
            sock.onclose = this.closeHandler;

            return new Promise((res, rej) => {
                sock.onopen = () => {
                    this.connecter(sock).then(res).catch(rej);
                };

                connectTimeout = setTimeout(rej, 10000);
            });

        }).then(() => {
            clearTimeout(connectTimeout);

            // Now the connecter is done. Give it a second, then set up automatic reconnection.
            setTimeout(() => {
                if (sock !== this.sock) return;
                sock.onclose = () => {
                    this.connect().catch(this.closeHandler);
                };
            }, 1000);

        });
        return this.promise;
    }

    // Send data
    send(data: any) {
        this.promise = this.promise.then(() => {
            this.sock.send(data);
        });
        return this.promise;
    }

    // Close the connection
    close() {
        this.promise = this.promise.then(() => {
            this.sock.onclose = this.closeHandler;
            this.sock.close();
        });
        return this.promise;
    }

    // Mark the connection as alive and set a timeout
    keepalive(duration?: number) {
        duration = duration || 30000;
        if (this.keepaliveTimeout !== null)
            clearTimeout(this.keepaliveTimeout);
        let stack = new Error().stack;
        this.keepaliveTimeout = setTimeout(() => {
            this.promise = this.promise.then(() => {
                this.sock.close();
            });
        }, duration);
    }
}

// Admins who are allowed access
interface AdminAccess {
    audio: boolean;
    video: boolean;
};
export var adminAccess: Record<number, AdminAccess> = {};

// Connect to the server (our first step)
export function connect() {
    let p = prot.parts.login;
    let f = prot.flags;
    let nickBuf = util.encodeText(config.username);

    // The connection message is largely the same for all, so start with a generic one
    let connMsg = new DataView(new ArrayBuffer(p.length + nickBuf.length));
    connMsg.setUint32(0, prot.ids.login, true);
    let flags = (config.useFlac?f.dataType.flac:0) | (config.useContinuous?f.features.continuous:0);
    connMsg.setUint32(p.id, config.config.id, true);
    connMsg.setUint32(p.key, config.config.key, true);
    new Uint8Array(connMsg.buffer).set(nickBuf, p.length);

    return Promise.all([]).then(() => {
        connected = true;
        log.pushStatus("conn", "Connecting...");

        // (1) The ping socket
        pingSock = new ReconnectableWebSocket(config.wsUrl, disconnect, connecter);
        let out = new DataView(connMsg.buffer.slice(0));
        out.setUint32(p.flags, f.connectionType.ping | flags, true);

        function connecter(sock: WebSocket) {
            sock.send(out.buffer);
            sock.addEventListener("message", pingSockMsg);
            return Promise.all([]);
        }

        return pingSock.connect();

    }).then(() => {
        // (2) The data socket
        dataSock = new ReconnectableWebSocket(config.wsUrl, disconnect, connecter);
        let out = new DataView(connMsg.buffer.slice(0));
        out.setUint32(p.flags, f.connectionType.data | flags, true);

        function connecter(sock: WebSocket) {
            sock.send(out.buffer);
            if (flacInfoBuf)
                sock.send(flacInfoBuf);
            sock.addEventListener("message", dataSockMsg);
            return Promise.all([]);
        }

        return dataSock.connect();

    }).then(function() {
        // (3) The master socket
        let out: DataView;
        if ("master" in config.config) {
            masterSock = new ReconnectableWebSocket(config.wsUrl, disconnect, connecter);
            out = new DataView(connMsg.buffer.slice(0));
            out.setUint32(p.key, config.config.master, true);
            out.setUint32(p.flags, f.connectionType.master | flags, true);

            return masterSock.connect();

        }

        function connecter(sock: WebSocket) {
            sock.send(out.buffer);
            sock.addEventListener("message", masterSockMsg);
            return Promise.all([]);
        }
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

    function close(sock: ReconnectableWebSocket): ReconnectableWebSocket {
        if (sock && sock !== target)
            sock.close();
        return null;
    }
    pingSock = close(pingSock);
    dataSock = close(dataSock);
    masterSock = close(masterSock);

    util.dispatchEvent("net.disconnect", {});
}

// Ping the ping socket
export function ping() {
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

    pingSock.keepalive();

    switch (cmd) {
        case prot.ids.ack:
            var ackd = msg.getUint32(prot.parts.ack.ackd, true);
            if (ackd === prot.ids.login) {
                // We're logged in, so start pinging
                ping();
            }
            break;

        default:
            util.dispatchEvent("net.pingSock." + cmd, msg);
    }
}

// Message from the data socket
function dataSockMsg(ev: MessageEvent) {
    var msg = new DataView(ev.data);
    var cmd = msg.getUint32(0, true);

    dataSock.keepalive();

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

            // Let others use this info too
            util.dispatchEvent("net.info." + key, {val: val, msg: msg});
            break;

        default:
            util.dispatchEvent("net.dataSock." + cmd, msg);
    }
}

// Message from the master socket
function masterSockMsg(ev: MessageEvent) {
    var msg = new DataView(ev.data);
    var cmd = msg.getUint32(0, true);

    masterSock.keepalive();

    // All of these are handled in the master module
    util.dispatchEvent("net.masterSock." + cmd, msg);
}

// Set our FLAC info
export function flacInfo(to: ArrayBuffer) {
    flacInfoBuf = to;
    dataSock.send(to);
}

// Flush our buffers
function flushBuffers() {
    if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
    }

    if (!dataSock) return;

    let ba = bufferedAmount();
    if (ba)
        log.pushStatus("buffering", "Sending audio to server (" + util.bytesToRepr(ba) + ")...");
    else
        log.popStatus("buffering");

    flushTimeout = setTimeout(function() {
        flushTimeout = null;
        flushBuffers();
    }, 1000);
}

// If our data socket is connected, the buffered amount
export function bufferedAmount() {
    return dataSock ? dataSock.sock.bufferedAmount : 0;
}

// Send to an admin that we accept or reject admin privileges
export function setAdminPerm(target: number, deviceInfo: (allowVideo: boolean)=>any, allowAudio: boolean, allowVideo: boolean) {
    // Set it
    if (allowAudio)
        adminAccess[target] = {audio: true, video: allowVideo};
    else
        delete adminAccess[target];

    // And send it
    let permMessage;
    return Promise.all([]).then(() => {
        if (allowAudio)
            return deviceInfo(allowVideo);
        else
            return null;

    }).then(ret => {
        if (ret)
            permMessage = JSON.stringify(ret);
        else
            permMessage = "";

        let permBuf = util.encodeText(permMessage);
        let p = prot.parts.info;
        let out = new DataView(new ArrayBuffer(p.length + 1 + permBuf.length));
        out.setUint32(0, prot.ids.info, true);
        out.setUint32(p.key, prot.info.allowAdmin, true);
        out.setUint32(p.value, target, true);
        out.setUint8(p.length, allowAudio?1:0);
        new Uint8Array(out.buffer).set(permBuf, p.length + 1);
        dataSock.send(out.buffer);

    }).catch(promiseFail());
}

// Send a state update to any admins with permission
export function updateAdminPerm(val: any, video?: boolean) {
    // Set up the message
    let permBuf = util.encodeText(JSON.stringify(val));
    let p = prot.parts.info;
    let out = new DataView(new ArrayBuffer(p.length + permBuf.length));
    out.setUint32(0, prot.ids.info, true);
    out.setUint32(p.key, prot.info.adminState, true);
    new Uint8Array(out.buffer).set(permBuf, p.length);

    // And send it
    for (let target in adminAccess) {
        let access = adminAccess[target];
        if (video && !access.video) continue;
        out.setUint32(p.value, +target, true);
        dataSock.send(out.buffer.slice(0));
    }
}

// Generic phone-home error handler
export function errorHandler(error: any) {
    var errBuf = util.encodeText(error + "\n\n" + navigator.userAgent);
    var out = new DataView(new ArrayBuffer(4 + errBuf.length));
    out.setUint32(0, prot.ids.error, true);
    new Uint8Array(out.buffer).set(errBuf, 4);
    dataSock.send(out.buffer);
}

// Generic phone-home promise-fail handler
export function promiseFail() {
    const loc = (new Error().stack)+"";
    return function(ex: any) {
        errorHandler("Promise failure\n\n" + ex + "\n\n" + loc);
    };
}
