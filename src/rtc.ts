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
import { prot } from "./net";
import * as proc from "./proc";
import * as ui from "./ui";
import * as util from "./util";
import { dce } from "./util";
import * as video from "./video";
import * as videoRecord from "./video-record";

type ECRTCPeerConnection = RTCPeerConnection & {
    ecDataChannel: RTCDataChannel,
    ecVideoRecord: WritableStreamDefaultWriter
};

// Our RTC peer connections
export var rtcConnections = {
    outgoing: <{[key: string]: ECRTCPeerConnection}> {},
    incoming: <{[key: string]: ECRTCPeerConnection}> {},
    videoRecHost: -1
};

// Called on network disconnection
export function disconnect() {
    for (var id in rtcConnections.outgoing) {
        try {
            rtcConnections.outgoing[id].close();
        } catch (ex) {}
    }
    for (var id in rtcConnections.incoming) {
        try {
            rtcConnections.incoming[id].close();
        } catch (ex) {}
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
export function initRTC(peer: number, outgoing: boolean) {
    // Which set are we in?
    var group;
    if (outgoing)
        group = rtcConnections.outgoing;
    else
        group = rtcConnections.incoming;

    if (group[peer])
        group[peer].close();

    var conn = group[peer] = <ECRTCPeerConnection> new RTCPeerConnection({
        iceServers: net.iceServers,
        iceTransportPolicy: "all"
    });
    var videoEl: HTMLVideoElement = null, compressor: compression.Compressor = null;

    conn.onicecandidate = function(c) {
        rtcSignal(peer, outgoing, prot.rtc.candidate, c.candidate);
    };

    // Called when we get a new track
    if (!outgoing)
    conn.ontrack = function(ev) {
        // If we haven't yet approved audio, then we're not ready for this track
        if (!audio.userMediaRTC) {
            audio.userMediaAvailableEvent.addEventListener("usermediartcready", function() {
                conn.ontrack(ev);
            }, {once: true});
            return;
        }

        // Get out the information
        var track = ev.track;
        var stream = ev.streams[0];
        var isVideo = (track.kind === "video");

        if (!stream) return;

        // Check for a new stream
        if (compressor && compressor.inputStream !== stream) {
            // New stream for this user
            compression.destroyCompressor(peer);
            compressor = null;
        }

        // Make the compressor
        if (!compressor)
            compressor = compression.createCompressor(peer, audio.ac, stream);

        // Remove any existing tracks of the same kind
        stream.getTracks().forEach(function(otrack) {
            if (track !== otrack && track.kind === otrack.kind)
                stream.removeTrack(otrack);
        });

        // Prepare for tracks to end
        stream.onremovetrack = function() {
            videoEl.srcObject = stream;
            playRTCEl(videoEl);
            videoEl = reassessRTCEl(peer, !!stream.getTracks().length, !!stream.getVideoTracks().length);
        };

        if (videoEl) {
            // Reset the stream
            videoEl.srcObject = stream;
            playRTCEl(videoEl);

            // Remember if it's a video track
            if (isVideo && !ui.ui.video.hasVideo[peer]) {
                ui.ui.video.hasVideo[peer] = true;
                ui.updateVideoUI(peer, false);
            }
            return;
        }

        /* We have a separate video and audio element so that the audio can
         * reliably go through AudioContext while the video is used directly. */

        // Create the video element
        videoEl = dce("video");
        videoEl.height = 0; // Use CSS for sizing
        videoEl.muted = true; // In the audio element
        videoEl.style.maxWidth = "100%";
        videoEl.srcObject = stream;

        // Add it to the UI
        var els = ui.ui.video.els;
        var hasVideo = ui.ui.video.hasVideo;
        while (els.length <= peer) {
            els.push(null);
            hasVideo.push(false);
        }
        els[peer] = videoEl;
        hasVideo[peer] = isVideo;
        ui.updateVideoUI(peer, true);

        // Then play it
        playRTCEl(videoEl);
    };

    conn.oniceconnectionstatechange = function(ev) {
        switch (conn.iceConnectionState) {
            case "failed":
                // report the failure
                rtcFail();
                break;

            case "closed":
                // attempt reconnection
                initRTC(peer, outgoing);
                break;
        }
    };

    // Add each track to the connection
    function addTracks() {
        audio.userMediaRTC.getTracks().forEach(function(track) {
            conn.addTrack(track, audio.userMediaRTC);
        });
    }
    if (outgoing && audio.userMediaRTC)
        addTracks();

    // Add video tracks to the connection
    function addVideoTracks() {
        video.userMediaVideo.getTracks().forEach(function(track) {
            conn.addTrack(track, audio.userMediaRTC);
        });
    }
    if (outgoing && video.userMediaVideo)
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
        conn.getSenders().forEach(function(sender) {
            var track = sender.track;
            if (!track) return;
            if (!tracks[track.id])
                conn.removeTrack(sender);
        });
    }

    // If we switch UserMedia, we'll need to re-up
    if (outgoing) {
        audio.userMediaAvailableEvent.addEventListener("usermediartcready", addTracks);
        audio.userMediaAvailableEvent.addEventListener("usermediavideoready", addVideoTracks);
        audio.userMediaAvailableEvent.addEventListener("usermediastopped", removeTracks);
        audio.userMediaAvailableEvent.addEventListener("usermediavideostopped", removeTracks);

        conn.onsignalingstatechange = function() {
            if (conn.signalingState === "closed") {
                // Don't send any new events
                audio.userMediaAvailableEvent.removeEventListener("usermediartcready", addTracks);
                audio.userMediaAvailableEvent.removeEventListener("usermediavideoready", addVideoTracks);
                audio.userMediaAvailableEvent.removeEventListener("usermediastopped", removeTracks);
                audio.userMediaAvailableEvent.removeEventListener("usermediavideostopped", removeTracks);
            }
        };
    }

    // Make a data channel for speech status
    if (outgoing) {
        var chan = conn.ecDataChannel = conn.createDataChannel("ennuicastr");
        chan.binaryType = "arraybuffer";
        chan.onopen = function() {
            rtcSpeech(proc.vadOn, peer);
            if ("master" in config.config)
                rtcVideoRecSend(void 0, prot.videoRec.videoRecHost, ~~ui.ui.masterUI.acceptRemoteVideo.checked);
        };

    } else {
        conn.ondatachannel = function(ev) {
            ev.channel.binaryType = "arraybuffer";
            ev.channel.onmessage = function(ev) {
                var msg = new DataView(ev.data);
                rtcMessage(peer, msg);
            };
        };
    }

    // Outgoing negotiation function
    function connect() {
        conn.createOffer({voiceActivityDetection: true}).then(function(offer) {
            return conn.setLocalDescription(offer);

        }).then(function() {
            rtcSignal(peer, outgoing, prot.rtc.offer, conn.localDescription);

        }).catch(function(ex) {
            rtcFail();

        });
    }

    conn.onnegotiationneeded = connect;
}

// Close an RTC connection when a peer disconnects
export function closeRTC(peer: number) {
    ["outgoing", "incoming"].forEach(function(group) {
        var conn: RTCPeerConnection = (<any> rtcConnections)[group][peer];
        if (!conn)
            return;
        conn.close();
    });
    reassessRTCEl(peer, false, false);
}

// Reassess the properties of the RTC element for this peer
function reassessRTCEl(peer: number, hasTracks: boolean, hasVideo: boolean) {
    var el = ui.ui.video.els[peer];
    if (!el)
        return null;

    if (!hasTracks) {
        // Destroy it
        el.pause();
        try {
            el.parentNode.removeChild(el);
        } catch (ex) {}
        el = ui.ui.video.els[peer] = null;
    }
    ui.ui.video.hasVideo[peer] = hasVideo;
    ui.updateVideoUI(peer, false);
    return el;
}

// Play an element used by RTC, once that's possible
function playRTCEl(el: HTMLVideoElement) {
    if (!audio.userMediaRTC) {
        /* Although our own UserMedia isn't technically needed to play, it's
         * needed to *auto*play on many platforms, so wait for it. */
        audio.userMediaAvailableEvent.addEventListener("usermediartcready", function() {
            playRTCEl(el);
        }, {once: true});
        return;
    }

    el.play();
}

// Receive a data channel message from an RTC peer
function rtcMessage(peer: number, msg: DataView) {
    if (msg.byteLength < 4) return;
    var cmd = msg.getUint32(0, true);
    console.log("Command " + cmd.toString(16) + " from " + peer);

    switch (cmd) {
        case prot.ids.data:
            console.error("Received " + (msg.byteLength-4));
            try {
                rtcConnections.incoming[peer].ecVideoRecord.write((new Uint8Array(msg.buffer)).subarray(4));
            } catch (ex) {
                console.error(ex);
            }
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
                        ui.ui.masterUI.acceptRemoteVideo.checked &&
                        rtcConnections.incoming[peer]) {

                        videoRecord.recordVideoRemoteIncoming(peer).then(function(fileWriter) {
                            rtcVideoRecSend(peer, prot.videoRec.startVideoRecRes, 1);
                            if (rtcConnections.incoming[peer])
                                rtcConnections.incoming[peer].ecVideoRecord = fileWriter;
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
                        rtcConnections.incoming[peer].ecVideoRecord.close();
                        delete rtcConnections.incoming[peer].ecVideoRecord;
                    } catch (ex) {
                        console.error(ex);
                    }
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
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
        } catch (ex) {}
        return;
    }

    // Send it everywhere
    for (let peer in rtcConnections.outgoing) {
        try {
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
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
        payload = util.encodeText(JSON.stringify(payload));

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
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
        } catch (ex) {}
        return;
    }

    for (let peer in rtcConnections.outgoing) {
        try {
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
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
        console.error("Actually sending " + msg.byteLength);

        try {
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
        } catch (ex) {
            console.error(ex);
        }
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
