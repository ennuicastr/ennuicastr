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
import * as compression from "./compression";
import * as config from "./config";
import * as log from "./log";
import * as net from "./net";
import * as proc from "./proc";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import { dce } from "./util";
import * as video from "./video";
import * as videoRecord from "./video-record";

type ECRTCPeerConnection = RTCPeerConnection & {
    ecDataChannel?: RTCDataChannel,
    ecVideoRecord?: WritableStreamDefaultWriter,
    ecOnclose?: ()=>void
};

interface ECRPCPair {
    incoming: ECRTCPeerConnection;
    outgoing: ECRTCPeerConnection;
}

// Our RTC peer connections
export var rtcConnections = {
    peers: <Record<number, ECRPCPair>> {},
    videoRecHost: -1
};

// Called on network disconnection
export function disconnect() {
    for (var peer in rtcConnections.peers) {
        var poi = rtcConnections.peers[peer];
        poi.incoming.close();
        poi.outgoing.close();
    }
}

// Send an RTC signaling message
export function rtcSignal(peer: number, outgoing: boolean, type: number, value: unknown) {
    var buf = util.encodeText(JSON.stringify(value));
    var p = prot.parts.rtc;
    var out = new DataView(new ArrayBuffer(p.length + buf.length));
    out.setUint32(0, prot.ids.rtc, true);
    out.setUint32(p.peer, peer, true);
    out.setUint32(p.type, (outgoing?0x80000000:0)|type, true);
    new Uint8Array(out.buffer).set(buf, p.value);
    net.dataSock.send(out.buffer);
}

// Initialize a connection to an RTC peer
export function initRTC(peer: number) {
    if (peer in rtcConnections.peers) {
        // Just try reconnecting
        rtcConnections.peers[peer].outgoing.onnegotiationneeded(null);
        return;
    }

    // Otherwise, make the connections
    var conn = rtcConnections.peers[peer] = <ECRPCPair> {
        incoming: new RTCPeerConnection({iceServers: net.iceServers, iceTransportPolicy: "all"}),
        outgoing: new RTCPeerConnection({iceServers: net.iceServers, iceTransportPolicy: "all"})
    };

    var videoEl: HTMLVideoElement = null;

    conn.incoming.onicecandidate = function(c) {
        rtcSignal(peer, false, prot.rtc.candidate, c.candidate);
    };
    conn.outgoing.onicecandidate = function(c) {
        rtcSignal(peer, true, prot.rtc.candidate, c.candidate);
    };

    // Outgoing connection negotiation function
    conn.outgoing.onnegotiationneeded = function() {
        conn.outgoing.createOffer({voiceActivityDetection: true}).then(function(offer) {
            return conn.outgoing.setLocalDescription(offer);

        }).then(function() {
            rtcSignal(peer, true, prot.rtc.offer, conn.outgoing.localDescription);

        }).catch(function(ex) {
            rtcFail();

        });
    }

    // Called when we get a new track
    conn.incoming.ontrack = function(ev) {
        // If we haven't yet approved audio, then we're not ready for this track
        if (!audio.userMediaRTC) {
            audio.userMediaAvailableEvent.addEventListener("usermediartcready", function() {
                conn.incoming.ontrack(ev);
            }, {once: true});
            return;
        }

        // Get out the information
        var track = ev.track;
        var stream = ev.streams[0];
        var isVideo = (track.kind === "video");

        if (!stream) return;

        // Remove any existing tracks of the same kind
        stream.getTracks().forEach(function(otrack) {
            if (track !== otrack && track.kind === otrack.kind)
                stream.removeTrack(otrack);
        });

        // Get our video element (even if there is no video)
        ui.videoAdd(peer, null);
        videoEl = ui.ui.video.users[peer].video;
        videoEl.srcObject = stream;
        videoEl.play().catch(console.error);

        if (!isVideo) {
            // Audio streams go through a compressor
            compression.createCompressor(peer, audio.ac, stream);
        }
    };

    // Called when the ICE connection state changes
    conn.outgoing.oniceconnectionstatechange = function(ev) {
        switch (conn.outgoing.iceConnectionState) {
            case "failed":
                // report the failure
                rtcFail();
                break;

            case "closed":
                // attempt reconnection
                conn.outgoing.onnegotiationneeded(null);
                break;
        }
    };

    // Add each track to the connection
    function addTracks() {
        audio.userMediaRTC.getTracks().forEach(function(track) {
            conn.outgoing.addTrack(track, audio.userMediaRTC);
        });
    }
    if (audio.userMediaRTC)
        addTracks();

    // Add video tracks to the connection
    function addVideoTracks() {
        video.userMediaVideo.getTracks().forEach(function(track) {
            conn.outgoing.addTrack(track, audio.userMediaRTC);
        });
    }
    if (video.userMediaVideo)
        addVideoTracks();

    // Remove any inactive tracks from the connection
    function removeTracks() {
        // Figure out which tracks should stay
        var tracks: {[key: string]: boolean} = {};
        function listTracks(from: MediaStream) {
            from.getTracks().forEach(function(track) {
                tracks[track.id] = true;
            });
        }
        if (audio.userMediaRTC) listTracks(audio.userMediaRTC);
        if (video.userMediaVideo) listTracks(video.userMediaVideo);

        // Then remove any tracks that should go
        conn.outgoing.getSenders().forEach(function(sender) {
            var track = sender.track;
            if (!track) return;
            if (!tracks[track.id])
                conn.outgoing.removeTrack(sender);
        });
    }

    // If we switch UserMedia, we'll need to re-up
    var umae = audio.userMediaAvailableEvent;
    umae.addEventListener("usermediartcready", addTracks);
    umae.addEventListener("usermediavideoready", addVideoTracks);
    umae.addEventListener("usermediastopped", removeTracks);
    umae.addEventListener("usermediavideostopped", removeTracks);
    conn.outgoing.ecOnclose = function() {
        umae.removeEventListener("usermediartcready", addTracks);
        umae.removeEventListener("usermediavideoready", addVideoTracks);
        umae.removeEventListener("usermediastopped", removeTracks);
        umae.removeEventListener("usermediavideostopped", removeTracks);
    };

    // Make a data channel for speech status
    var chan = conn.outgoing.ecDataChannel = conn.outgoing.createDataChannel("ennuicastr");
    chan.binaryType = "arraybuffer";
    chan.onopen = function() {
        rtcSpeech(proc.vadOn, peer);
        if ("master" in config.config)
            rtcVideoRecSend(void 0, prot.videoRec.videoRecHost, ~~ui.ui.panels.master.acceptRemoteVideo.checked);
    };

    conn.incoming.ondatachannel = function(ev) {
        ev.channel.binaryType = "arraybuffer";
        ev.channel.onmessage = function(ev) {
            var msg = new DataView(ev.data);
            rtcMessage(peer, msg);
        };
    };
}

// Close an RTC connection when a peer disconnects
export function closeRTC(peer: number) {
    var conn = rtcConnections.peers[peer];
    if (!conn) return;
    delete rtcConnections.peers[peer];
    conn.incoming.close();
    if (conn.outgoing.ecOnclose)
        conn.outgoing.ecOnclose();
    conn.outgoing.close();
}

// Receive a data channel message from an RTC peer
function rtcMessage(peer: number, msg: DataView) {
    if (msg.byteLength < 4) return;
    var cmd = msg.getUint32(0, true);

    switch (cmd) {
        case prot.ids.data:
            try {
                rtcConnections.peers[peer].incoming.ecVideoRecord.write((new Uint8Array(msg.buffer)).subarray(4));
            } catch (ex) {}
            break;

        case prot.ids.speech:
            // User speech status
            var p = prot.parts.speech;
            if (msg.byteLength < p.length) return;
            var status = !!msg.getUint32(p.indexStatus, true);
            proc.updateSpeech(peer, status);
            break;

        case prot.ids.videoRec:
            // Video recording related messages
            var p = prot.parts.videoRec;
            var pv = prot.videoRec;
            if (msg.byteLength < p.length) return;
            var cmd = msg.getUint32(p.cmd, true);

            switch (cmd) {
                case pv.videoRecHost:
                    var accept = 0;
                    try {
                        accept = msg.getUint32(p.length, true);
                    } catch (ex) {}
                    if (accept)
                        rtcConnections.videoRecHost = peer; // FIXME: Deal with disconnections
                    else if (rtcConnections.videoRecHost === peer)
                        rtcConnections.videoRecHost = -1;
                    break;

                case pv.startVideoRecReq:
                    if ("master" in config.config &&
                        ui.ui.panels.master.acceptRemoteVideo.checked &&
                        rtcConnections.peers[peer]) {

                        // Check for options
                        var opts = {};
                        if (msg.byteLength > p.length) {
                            try {
                                opts = JSON.parse(util.decodeText(new Uint8Array(msg.buffer).subarray(p.length)));
                            } catch (ex) {}
                        }

                        videoRecord.recordVideoRemoteIncoming(peer, opts).then(function(fileWriter) {
                            rtcVideoRecSend(peer, prot.videoRec.startVideoRecRes, 1);
                            if (rtcConnections.peers[peer])
                                rtcConnections.peers[peer].incoming.ecVideoRecord = fileWriter;
                            else
                                fileWriter.close();
                        });

                    } else {
                        rtcVideoRecSend(peer, prot.videoRec.startVideoRecRes, 0);

                    }
                    break;

                case pv.startVideoRecRes:
                    // Only if we actually *wanted* them to accept video!
                    if (videoRecord.recordVideoRemoteOK && peer === rtcConnections.videoRecHost)
                        videoRecord.recordVideoRemoteOK(peer);
                    break;

                case pv.endVideoRec:
                    try {
                        rtcConnections.peers[peer].incoming.ecVideoRecord.close();
                        delete rtcConnections.peers[peer].incoming.ecVideoRecord;
                    } catch (ex) {}
                    break;
            }
            break;
    }
}

// Send a speech message to every RTC peer, or a specific peer
export function rtcSpeech(status: boolean, peer?: number) {
    if (!config.useRTC) return;

    // Build the message
    var p = prot.parts.speech;
    var msgv = new DataView(new ArrayBuffer(p.length));
    msgv.setUint32(0, prot.ids.speech, true);
    msgv.setUint32(p.indexStatus, status?1:0, true);
    var msg = msgv.buffer;

    // Maybe just send it to the specified peer
    if (typeof peer !== "undefined") {
        try {
            rtcConnections.peers[peer].outgoing.ecDataChannel.send(msg);
        } catch (ex) {}
        return;
    }

    // Send it everywhere
    for (let peer in rtcConnections.peers) {
        try {
            rtcConnections.peers[peer].outgoing.ecDataChannel.send(msg);
        } catch (ex) {}
    }
}

// Send an RTC video recording message
export function rtcVideoRecSend(peer: number, cmd: number, payloadData?: unknown) {
    if (!config.useRTC) return;

    // Build the payload
    var payload;
    if (typeof payloadData === "number") {
        payload = new DataView(new ArrayBuffer(4));
        payload.setUint32(0, payloadData, true);

    } else if (typeof payloadData === "object") {
        payload = util.encodeText(JSON.stringify(payloadData));

    } else {
        payload = new Uint8Array(0);

    }

    // Build the message
    var p = prot.parts.videoRec;
    var msg = new DataView(new ArrayBuffer(p.length + payload.byteLength));
    msg.setUint32(0, prot.ids.videoRec, true);
    msg.setUint32(p.cmd, cmd, true);
    new Uint8Array(msg.buffer).set(new Uint8Array(payload.buffer), p.length);

    // And send it
    if (typeof peer !== "undefined") {
        try {
            rtcConnections.peers[peer].outgoing.ecDataChannel.send(msg);
        } catch (ex) {}
        return;
    }

    for (let peer in rtcConnections.peers) {
        try {
            rtcConnections.peers[peer].outgoing.ecDataChannel.send(msg);
        } catch (ex) {}
    }
}

// Send data to an RTC peer
export function rtcDataSend(peer: number, buf: Uint8Array) {
    var p = prot.parts.data;

    // Send 16k at a time
    for (var start = 0; start < buf.length; start += 16380) {
        var part = buf.subarray(start, start + 16380);
        var msg = new DataView(new ArrayBuffer(4 + part.length));
        msg.setUint32(0, prot.ids.data, true);
        new Uint8Array(msg.buffer).set(part, 4);

        try {
            rtcConnections.peers[peer].outgoing.ecDataChannel.send(msg);
        } catch (ex) {}
    }
}

// Notify of a failed RTC connection
function rtcFail() {
    if (rtcFailTimeout)
        clearTimeout(rtcFailTimeout);
    log.pushStatus("rtc", "RTC connection failed!");
    rtcFailTimeout = setTimeout(function() {
        rtcFailTimeout = null;
        log.popStatus("rtc");
    }, 10000);
}
var rtcFailTimeout: null|number = null;
