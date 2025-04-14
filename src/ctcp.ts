/*
 * Copyright (c) 2018-2025 Yahweasel
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
 * Support for CTCP+RTC data communications.
 */

import * as comm from "./comm";
import * as config from "./config";
import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as videoRecord from "./video-record";

import * as wsp from "web-streams-polyfill/ponyfill";

// Peer information
interface Peer {
    rtc: RTCPeerConnection;
    data: RTCDataChannel;
    queue: ArrayBuffer[];
    signal: (msg:any)=>unknown;
    rtcReady: boolean;
}

// If we're a video recording receiver, the buffer for each user
interface VideoRecIncoming {
    nextIdx: number;
    buf: {idx: number, buf: Uint8Array}[];
    notify: () => void;
    hardStop: boolean;
    softStop: boolean;
}

/* Keep a record of continuing users from before CTCP was initialized, to
 * assert them */
let initialUsers: number[] = [];
function addInitialUser(ev: CustomEvent) {
    initialUsers.push(ev.detail.val);
}
util.events.addEventListener("net.info." + prot.info.peerContinuing, addInitialUser);

/**
 * CTCP-based communications.
 */
export class CTCP implements
    comm.CTCPComms, comm.BroadcastComms, comm.VideoRecComms
{
    // Host which has indicated that it's willing to receive video recordings
    videoRecHost = -1;

    // Peers
    peers: Record<number, Peer> = {};

    // Incoming video data
    videoRecIncoming: Record<number, VideoRecIncoming> = {};

    // Assert that a peer exists
    assertPeer(id: number): Peer {
        if (this.peers[id])
            return this.peers[id];

        const ret = this.peers[id] = {
            rtc: <RTCPeerConnection> null,
            data: <RTCDataChannel> null,
            queue: <ArrayBuffer[]> [],
            signal: <(msg:any)=>unknown> null,
            rtcReady: false
        };

        if ("master" in config.config) {
            this.videoRecSend(
                id, prot.videoRec.videoRecHost,
                ~~ui.ui.panels.host.acceptRemoteVideo.checked
            );
        }

        this.startRTC(id, ret);

        return ret;
    }

    // Initialize the CTCP/RTC subsystem
    async init(opts: comm.CommModes): Promise<void> {
        // We initialize CTCP once we know our own ID
        if (!net.selfId) {
            util.events.addEventListener("net.info." + prot.info.id, () => {
                this.init(opts);
            });
            return;
        }

        // Incoming CTCP messages
        util.netEvent("data", "ctcp", (ev: CustomEvent) => this.incomingCTCP(ev));

        // Connections
        util.events.addEventListener("net.info." + prot.info.peerInitial, (ev: CustomEvent) => {
            this.assertPeer(ev.detail.val);
        });
        util.events.addEventListener("net.info." + prot.info.peerContinuing, (ev: CustomEvent) => {
            this.assertPeer(ev.detail.val);
        });
        for (const peer of initialUsers)
            this.assertPeer(peer);
        initialUsers = [];
        util.events.removeEventListener("net.info." + prot.info.peerContinuing, addInitialUser);

        // Disconnections
        util.events.addEventListener("net.info." + prot.info.peerLost, (ev: CustomEvent) => {
            if (this.videoRecHost === ev.detail.val) {
                this.videoRecHost = -1;
                videoRecord.onVideoRecHostChange();
            }
            this.closeRTC(ev.detail.val);
        });

        // Prepare to receive RTC negotiation messages
        util.netEvent("data", "rtc", (ev: CustomEvent) => {
            // Get out the important part
            const p = prot.parts.rtc;
            const peer = ev.detail.getUint32(p.peer, true);

            if (!(peer in this.peers))
                return;
            const j = this.peers[peer];
            if (!j.signal)
                return;

            try {
                const tmsg = util.decodeText((new Uint8Array(ev.detail.buffer)).subarray(p.value));
                const msg = JSON.parse(tmsg);
                j.signal(msg);
            } catch (ex) {}
        });

        // Include our buffered data
        const origBufferedAmount = net.bufferedAmount;
        net.setBufferedAmount(() => {
            let buffered = origBufferedAmount();

            // Buffered to another client
            for (const id in this.peers) {
                const peer = this.peers[id];
                try {
                    buffered = Math.max(buffered, peer.data.bufferedAmount);
                } catch (ex) {}
            }

            return buffered;
        });

        // Send captions when they're generated
        util.events.addEventListener("inproc.caption", (ev: CustomEvent) => {
            this.caption(
                !!ev.detail.text,
                ev.detail.text || ev.detail.partial
            );
        });
    }

    // Incoming CTCP messages from the server
    incomingCTCP(ev: CustomEvent): void {
        // Get out the important part
        const p = prot.parts.ctcp;
        const peer = ev.detail.getUint32(p.peer, true);
        const u8 = new Uint8Array(ev.detail.buffer);
        const msg = new DataView(u8.slice(p.msg).buffer);
        if (msg.byteLength < 4)
            return;
        const cmd = msg.getUint32(0, true);
        util.dispatchEvent("net.ctcpSock." + cmd, {peer, msg});
    }

    // Send an Ennuicastr message over CTCP or RTC
    async send(peer: number, msg: Uint8Array): Promise<void> {
        // Get the target ID
        let inc: Peer = null;
        if (!(peer in this.peers))
            return;
        inc = this.peers[peer];

        // If we can, send it directly
        if (inc.rtcReady) {
            if (inc.queue.length || inc.data.bufferedAmount) {
                // Queue it
                inc.queue.push(msg.buffer);
            } else {
                // Send it immediately
                inc.data.send(msg.buffer);
            }
            return;
        }

        // Otherwise, we'll send it via CTCP
        const p = prot.parts.ctcp;
        const cmsg = new DataView(new ArrayBuffer(p.length + msg.length));
        cmsg.setUint32(0, prot.ids.ctcp, true);
        cmsg.setUint32(p.peer, peer, true);
        (new Uint8Array(cmsg.buffer)).set(msg, p.msg);
        net.dataSock.send(cmsg.buffer);
    }

    // Broadcast a message (by simply sending it individually to everyone)
    async broadcast(msg: Uint8Array) {
        let ps: Promise<unknown>[] = [];

        // FIXME: This is the only place to get the user IDs
        for (let i = 0; i < ui.ui.video.users.length; i++) {
            if (!ui.ui.video.users[i])
                continue;
            ps.push(this.send(i, msg));
        }
        await Promise.all(ps);
    }

    getVideoRecHost(): number {
        return this.videoRecHost;
    }

    // Send a video recording subcommand to a peer
    videoRecSend(peer: number, cmd: number, payloadData?: unknown): void {
        // Build the payload
        let payload: Uint8Array;
        if (typeof payloadData === "number") {
            payload = new Uint8Array(4);
            const dv = new DataView(payload.buffer);
            dv.setUint32(0, payloadData, true);

        } else if (typeof payloadData === "object") {
            payload = util.encodeText(JSON.stringify(payloadData));

        } else {
            payload = new Uint8Array(0);

        }

        // Build the message
        const p = prot.parts.videoRec;
        const msg = new DataView(new ArrayBuffer(p.length + payload.length));
        msg.setUint32(0, prot.ids.videoRec, true);
        msg.setUint32(p.cmd, cmd, true);
        new Uint8Array(msg.buffer).set(new Uint8Array(payload.buffer), p.length);

        // And send it
        this.send(peer, new Uint8Array(msg.buffer));
    }

    // Close a given peer's RTC connection
    closeRTC(peer: number): void {
        if (!(peer in this.peers))
            return;
        const inc = this.peers[peer];
        try {
            inc.rtc.close();
        } catch (ex) {}
        delete this.peers[peer];
    }

    // Send a chunk of video data to a peer
    videoDataSend(peer: number, idx: number, buf: Uint8Array): void {
        // Send 16k at a time
        for (let start = 0; start < buf.length; start += 16380) {
            const part = buf.subarray(start, start + 16380);
            const msg = new DataView(new ArrayBuffer(12 + part.length));
            msg.setUint32(0, prot.ids.data, true);
            msg.setFloat64(4, idx + start, true);
            new Uint8Array(msg.buffer).set(part, 12);
            this.send(peer, new Uint8Array(msg.buffer));
        }
    }

    // Send an RTC negotiation message
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    sendRTCNegotiation(peer: number, cont: any): void {
        const p = prot.parts.rtc;
        const contU8 = util.encodeText(JSON.stringify(cont));
        const msg = new DataView(new ArrayBuffer(p.length + contU8.length));
        msg.setUint32(0, prot.ids.rtc, true);
        msg.setUint32(p.peer, peer, true);
        (new Uint8Array(msg.buffer)).set(contU8, p.value);
        net.dataSock.send(msg.buffer);
    }

    /* The RTC side: using Ennuicastr as a bridge, try to establish a direct
     * (RTC) connection for data */
    startRTC(id: number, j: Peer): void {
        // Perfect negotiation pattern
        const polite = (net.selfId > id);

        // Create our peer connection
        j.rtc = new RTCPeerConnection({
            iceServers: net.iceServers
        });

        // Incoming data channels
        j.rtc.ondatachannel = (ev: RTCDataChannelEvent) => {
            const data = ev.channel;
            data.binaryType = "arraybuffer";
            data.onmessage = (ev: MessageEvent) => {
                const msg = new DataView(ev.data);
                if (msg.byteLength < 4)
                    return;
                const cmd = msg.getUint32(0, true);
                util.dispatchEvent("net.ctcpSock." + cmd, {peer: id, msg});
            };
        };

        // Negotiation
        const onnegotiationneeded = () => {
            j.rtc.createOffer().then(offer => {
                return j.rtc.setLocalDescription(offer);
            }).then(() => {
                // Tell them our local description
                this.sendRTCNegotiation(id, {desc: j.rtc.localDescription});
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            }).catch(()=>{});
        }
        j.rtc.onnegotiationneeded = onnegotiationneeded;

        // ICE candidates
        j.rtc.onicecandidate = (ev: RTCPeerConnectionIceEvent) => {
            this.sendRTCNegotiation(id, {cand: ev.candidate});
        };

        // Incoming signals
        j.signal = (msg: any) => {
            if (msg.desc) {
                // An offer or answer
                const desc = msg.desc;
                let rollbackLocal = false;
                if (desc.type === "offer" && j.rtc.signalingState !== "stable") {
                    if (!polite)
                        return;
                    rollbackLocal = true;
                }

                return Promise.all([]).then(() => {
                    // Maybe rollback local
                    if (rollbackLocal)
                        return j.rtc.setLocalDescription({type: "rollback"});

                }).then(() => {
                    // Set the remote description
                    return j.rtc.setRemoteDescription(desc);

                }).then(() => {
                    if (desc.type === "offer") {
                        // And create our answer
                        return j.rtc.createAnswer().then(answer => {
                            return j.rtc.setLocalDescription(answer);
                        }).then(() => {
                            this.sendRTCNegotiation(id, {desc: j.rtc.localDescription});
                        });
                    }

                }).catch(console.error);

            } else if (msg.cand) {
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                j.rtc.addIceCandidate(msg.cand).catch(()=>{});

            }
        };

        // Create our data channel
        j.data = j.rtc.createDataChannel("ennuicastr");
        j.data.onopen = () => {
            j.rtcReady = true;
        };
        j.data.onclose = j.data.onerror = () => {
            j.rtcReady = false;

            if (this.peers[id] === j) {
                // There's nothing left
                delete this.peers[id];
            }
        };

        // Prepare for queueing
        j.queue = [];
        j.data.onbufferedamountlow = function() {
            if (j.queue.length)
                j.data.send(j.queue.shift());
        };

        onnegotiationneeded();
    }

    lastCaption = "";

    // Send a caption over CTCP
    caption(complete: boolean, text: string): void {
        // Maybe it's an append
        let append = false;
        if (this.lastCaption &&
            text.slice(0, this.lastCaption.length) === this.lastCaption) {
            append = true;
            const newText = text.slice(this.lastCaption.length);
            this.lastCaption = text;
            text = newText;
        } else {
            this.lastCaption = complete ? "" : text;
        }

        if (text === "")
            return;

        // Build the message
        const textBuf = util.encodeText(text);
        const p = prot.parts.caption.cc;
        const msg = new DataView(new ArrayBuffer(p.length + textBuf.length));
        msg.setUint32(0, prot.ids.caption, true);
        msg.setUint8(p.append, +append);
        msg.setUint8(p.complete, +complete);
        (new Uint8Array(msg.buffer)).set(textBuf, p.text);
        this.broadcast(new Uint8Array(msg.buffer));
    }

}

// Whether using Ennuicastr CTCP or some other CTCP, prepare for events
util.netEvent("ctcp", "data", (ev: CustomEvent) => {
    const ctcp = <CTCP> comm.comms.videoRec;
    if (!ctcp) return;
    const peer: number = ev.detail.peer;
    const msg: DataView = ev.detail.msg;

    try {
        const vr = ctcp.videoRecIncoming[peer];
        const idx = msg.getFloat64(4, true);
        const buf = new Uint8Array(msg.buffer).subarray(12);
        vr.buf.push({idx, buf});
        if (vr.buf.length >= 1024) {
            // Too much buffered data!
            vr.hardStop = true;
            delete ctcp.videoRecIncoming[peer];
        }
        if (vr.notify)
            vr.notify();
    } catch (ex) {}
});

util.netEvent("ctcp", "videoRec", (ev: CustomEvent) => {
    const ctcp = <CTCP> comm.comms.videoRec;
    if (!ctcp) return;
    const peer: number = ev.detail.peer;
    const msg: DataView = ev.detail.msg;

    // Video recording sub-message
    const p = prot.parts.videoRec;
    const pv = prot.videoRec;
    if (msg.byteLength < p.length) return;
    const cmd = msg.getUint32(p.cmd, true);

    switch (cmd) {
        case pv.videoRecHost:
        {
            let accept = 0;
            try {
                accept = msg.getUint32(p.length, true);
            } catch (ex) {}
            if (accept) {
                ctcp.videoRecHost = peer;
                videoRecord.onVideoRecHostChange();
            } else if (ctcp.videoRecHost === peer) {
                ctcp.videoRecHost = -1;
                videoRecord.onVideoRecHostChange();
            }
            break;
        }

        case pv.startVideoRecReq:
            if ("master" in config.config &&
                ui.ui.panels.host.acceptRemoteVideo.checked) {

                // Check for options
                let opts = {};
                if (msg.byteLength > p.length) {
                    try {
                        opts = JSON.parse(util.decodeText(new Uint8Array(msg.buffer).subarray(p.length)));
                    } catch (ex) {}
                }

                // Make an incoming stream
                const vri = ctcp.videoRecIncoming[peer] = {
                    nextIdx: 0,
                    buf: <{idx: number, buf: Uint8Array}[]> [],
                    notify: <()=>void> null,
                    hardStop: false,
                    softStop: false
                };

                const stream = <ReadableStream<Uint8Array>> <unknown>
                    new wsp.ReadableStream({
                    async pull(controller) {
                        // eslint-disable-next-line no-constant-condition
                        while (true) {
                            if (vri.hardStop) {
                                controller.close();
                                break;
                            }

                            // Look for the right one
                            let found = false;
                            for (let i = 0; i < vri.buf.length; i++) {
                                const buf = vri.buf[i];
                                if (buf.idx === vri.nextIdx) {
                                    found = true;
                                    vri.buf.splice(i, 1);
                                    if (buf.buf) {
                                        controller.enqueue(buf.buf);
                                        vri.nextIdx += buf.buf.length;
                                    } else {
                                        controller.close();
                                    }
                                    break;
                                }
                            }

                            if (found)
                                break;
                            if (!found && vri.softStop) {
                                controller.close();
                                break;
                            }

                            // Didn't find it, so wait to receive it
                            await new Promise<void>(res => vri.notify = res);
                            vri.notify = null;
                        }
                    }
                });

                // Now handle it
                videoRecord.recordVideoRemoteIncoming(peer, stream, opts);
                ctcp.videoRecSend(peer, prot.videoRec.startVideoRecRes, 1);

            } else {
                ctcp.videoRecSend(peer, prot.videoRec.startVideoRecRes, 0);

            }
            break;

        case pv.startVideoRecRes:
            // Only if we actually *wanted* them to accept video!
            if (videoRecord.recordVideoRemoteOK && peer === ctcp.videoRecHost)
                videoRecord.recordVideoRemoteOK(peer);
            break;

        case pv.endVideoRec:
            try {
                const vr = ctcp.videoRecIncoming[peer];
                vr.softStop = true;
                if (vr.notify)
                    vr.notify();
                delete ctcp.videoRecIncoming[peer];
            } catch (ex) {}
            break;
    }
});
