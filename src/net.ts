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

/* We have multiple connections to the server:
 * One for pings,
 * one to send data, and
 * if we're the master, one for master communication */
export let pingSock: ReconnectableWebSocket = null;
export let dataSock: ReconnectableWebSocket = null;
export let masterSock: ReconnectableWebSocket = null;

// Global connection state
export let connected = false;
export let transmitting = false;
export function setTransmitting(to: boolean): void { transmitting = to; }

// Our own ID
export let selfId = 0;

// The name of this recording, which may never be set
export let recName: null|string = null;

// We connect assuming our mode is not-yet-recording
export let mode = prot.mode.init;

// If we're using FLAC, we get the sample rate to send to the server
let flacInfoBuf: ArrayBuffer = null;

// ICE servers for RTC
export const iceServers = [
    {
        urls: "stun:stun.l.google.com:19302"
    }
];

// The remote start time, i.e., when recording began
export let remoteBeginTime: null|number = null;

// If we're flushing our buffers, this will be a timeout to re-check
let flushTimeout: null|number = null;

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
        this.keepaliveTimeout = setTimeout(() => {
            this.promise = this.promise.then(() => {
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                this.sock.onclose = function() {};
                this.sock.close();
                this.connect().catch(this.closeHandler);
            });
        }, duration);
    }
}

// Admins who are allowed access
interface AdminAccess {
    audio: boolean;
    video: boolean;
}
export const adminAccess: Record<number, AdminAccess> = {};

// Connect to the server (our first step)
export function connect(): Promise<unknown> {
    const p = prot.parts.login;
    const f = prot.flags;
    const nickBuf = util.encodeText(config.username);

    // The connection message is largely the same for all, so start with a generic one
    const connMsg = new DataView(new ArrayBuffer(p.length + nickBuf.length));
    connMsg.setUint32(0, prot.ids.login, true);
    const flags = (config.useFlac?f.dataType.flac:0) | (config.useContinuous?f.features.continuous:0);
    connMsg.setUint32(p.id, config.config.id, true);
    connMsg.setUint32(p.key, config.config.key, true);
    new Uint8Array(connMsg.buffer).set(nickBuf, p.length);

    return Promise.all([]).then(() => {
        connected = true;
        log.pushStatus("conn", "Connecting...");

        // (1) The ping socket
        pingSock = new ReconnectableWebSocket(config.wsUrl(), config.disconnect, connecter);
        const out = new DataView(connMsg.buffer.slice(0));
        out.setUint32(p.flags, f.connectionType.ping | flags, true);

        function connecter(sock: WebSocket) {
            sock.send(out.buffer);
            sock.addEventListener("message", pingSockMsg);
            return Promise.all([]);
        }

        return pingSock.connect();

    }).then(() => {
        // (2) The data socket
        dataSock = new ReconnectableWebSocket(config.wsUrl(), config.disconnect, connecter);
        const out = new DataView(connMsg.buffer.slice(0));
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
            masterSock = new ReconnectableWebSocket(config.wsUrl(), config.disconnect, connecter);
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

// Ping the ping socket
export function ping(): void {
    const p = prot.parts.ping;
    const msg = new DataView(new ArrayBuffer(p.length));
    msg.setUint32(0, prot.ids.ping, true);
    msg.setFloat64(p.clientTime, performance.now(), true);
    pingSock.send(msg);
}

// Message from the ping socket
function pingSockMsg(ev: MessageEvent) {
    const msg = new DataView(ev.data);
    const cmd = msg.getUint32(0, true);

    pingSock.keepalive();

    switch (cmd) {
        case prot.ids.ack:
        {
            const ackd = msg.getUint32(prot.parts.ack.ackd, true);
            if (ackd === prot.ids.login) {
                // We're logged in, so start pinging
                ping();
            }
            break;
        }

        default:
            util.dispatchEvent("net.pingSock." + cmd, msg);
    }
}

// Message from the data socket
function dataSockMsg(ev: MessageEvent) {
    const msg = new DataView(ev.data);
    const cmd = msg.getUint32(0, true);

    dataSock.keepalive();

    switch (cmd) {
        case prot.ids.nack:
        {
            // Just tell the user
            const p = prot.parts.nack;
            const text = util.decodeText(msg.buffer.slice(p.msg));
            alert(text);
            log.pushStatus("nack", text);
            break;
        }

        case prot.ids.info:
        {
            const p = prot.parts.info;
            const key = msg.getUint32(p.key, true);
            let val = 0;
            if (msg.byteLength >= p.length)
                val = msg.getUint32(p.value, true);
            switch (key) {
                case prot.info.id:
                    // Our own ID
                    selfId = val;
                    break;

                case prot.info.mode:
                {
                    // Set the mode
                    mode = val;

                    // Make it visible in the waveform
                    const wvms = ((val === prot.mode.rec) ? "r" : "s") +
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
                }

                case prot.info.startTime:
                    remoteBeginTime = msg.getFloat64(p.value, true);
                    break;

                case prot.info.recName:
                    recName = util.decodeText(msg.buffer.slice(p.value));
                    document.title = recName + " — Ennuicastr";
                    break;

                case prot.info.ice:
                {
                    const iceServer = JSON.parse(util.decodeText(msg.buffer.slice(p.value)));
                    iceServers.push(iceServer);
                    break;
                }
            }

            // Let others use this info too
            util.dispatchEvent("net.info." + key, {val: val, msg: msg});
            break;
        }

        default:
            util.dispatchEvent("net.dataSock." + cmd, msg);
    }
}

// Message from the master socket
function masterSockMsg(ev: MessageEvent) {
    const msg = new DataView(ev.data);
    const cmd = msg.getUint32(0, true);

    masterSock.keepalive();

    // All of these are handled in the master module
    util.dispatchEvent("net.masterSock." + cmd, msg);
}

// Set our FLAC info
export function flacInfo(to: ArrayBuffer): void {
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

    const ba = bufferedAmount();
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
export function bufferedAmount(): number {
    return dataSock ? dataSock.sock.bufferedAmount : 0;
}

// Send to an admin that we accept or reject admin privileges
export function setAdminPerm(target: number, deviceInfo: (allowVideo: boolean)=>any, allowAudio: boolean, allowVideo: boolean): Promise<unknown> {
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

        const permBuf = util.encodeText(permMessage);
        const p = prot.parts.info;
        const out = new DataView(new ArrayBuffer(p.length + 1 + permBuf.length));
        out.setUint32(0, prot.ids.info, true);
        out.setUint32(p.key, prot.info.allowAdmin, true);
        out.setUint32(p.value, target, true);
        out.setUint8(p.length, allowAudio?1:0);
        new Uint8Array(out.buffer).set(permBuf, p.length + 1);
        dataSock.send(out.buffer);

    }).catch(promiseFail());
}

// Send a state update to any admins with permission
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function updateAdminPerm(val: any, video?: boolean): void {
    // Set up the message
    const permBuf = util.encodeText(JSON.stringify(val));
    const p = prot.parts.info;
    const out = new DataView(new ArrayBuffer(p.length + permBuf.length));
    out.setUint32(0, prot.ids.info, true);
    out.setUint32(p.key, prot.info.adminState, true);
    new Uint8Array(out.buffer).set(permBuf, p.length);

    // And send it
    for (const target in adminAccess) {
        const access = adminAccess[target];
        if (video && !access.video) continue;
        out.setUint32(p.value, +target, true);
        dataSock.send(out.buffer.slice(0));
    }
}

// Generic phone-home error handler
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function errorHandler(error: any): void {
    const errBuf = util.encodeText(error + "\n\n" + navigator.userAgent);
    const out = new DataView(new ArrayBuffer(4 + errBuf.length));
    out.setUint32(0, prot.ids.error, true);
    new Uint8Array(out.buffer).set(errBuf, 4);
    dataSock.send(out.buffer);
}

// Generic phone-home promise-fail handler
export function promiseFail(): (ex:any)=>void {
    const loc = (new Error().stack)+"";
    return function(ex: any) {
        errorHandler("Promise failure\n\n" + ex + "\n\n" + loc);
    };
}
