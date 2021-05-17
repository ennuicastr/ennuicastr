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
declare let JitsiMeetJS: any;

import * as audio from "./audio";
import * as config from "./config";
import * as net from "./net";
import * as outproc from "./outproc";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as vad from "./vad";
import * as video from "./video";
import * as videoRecord from "./video-record";

// Host which has indicated that it's willing to receive video recordings
export let videoRecHost = -1;

// Jitsi features according to the server
let jitsiFeatures: any = {
    disableSimulcast: false,
    disableP2P: false
};

// Jitsi connection
let connection: any;

// Jitsi "room"
let room: any;

// Promises for adding and removing tracks to/from Jitsi
let jPromise: Promise<unknown> = Promise.all([]);

// Jitsi tracks need a unique ID. Use this as a counter to generate them.
let jCounter = 0;

// Jitsi outgoing audio track
let jAudio: any;

// Jitsi outgoing video track
let jVideo: any;

// Jitsi peer information
interface JitsiPeer {
    id: string; // Jitsi ID
    audio: any;
    video: any;
    rtc: RTCPeerConnection;
    data: RTCDataChannel;
    signal: (msg:any)=>unknown;
    rtcReady: boolean;
}
let jitsiPeers: Record<number, JitsiPeer> = {};

// If we're a video recording receiver, the write stream for each user
interface VideoRecIncoming {
    nextIdx: number;
    buf: {idx: number, buf: Uint8Array}[];
    writer: WritableStreamDefaultWriter;
}
const videoRecIncoming: Record<number, VideoRecIncoming> = {};

// Assert that a Jitsi peer exists
function assertJitsiPeer(id: number, jid: string) {
    if (jitsiPeers[id])
        return jitsiPeers[id];

    const ret = jitsiPeers[id] = {
        id: jid,
        audio: null,
        video: null,
        rtc: null,
        data: null,
        signal: null,
        rtcReady: false
    };

    // Once we know they exist, we start trying to connect via RTC as well
    startRTC(id, ret);

    return ret;
}

// Initialize the Jitsi connection
function initJitsi() {
    if (!audio.userMediaRTC) {
        // Wait until we have audio
        util.events.addEventListener("usermediartcready", initJitsi, {once: true});
        return;
    }

    let timeout: number = null;
    jPromise = jPromise.then(() => {
        if (typeof JitsiMeetJS === "undefined")
            return util.loadLibrary("libs/jquery.min.js");

    }).then(() => {
        if (typeof JitsiMeetJS === "undefined")
            return util.loadLibrary("libs/lib-jitsi-meet.min.js?v=2");

    }).then(() => {
        // Get rid of any old Jitsi instance. First, clear tracks.
        for (const id of Object.keys(jitsiPeers)) {
            const inc = jitsiPeers[id];
            if (inc.video)
                jitsiTrackRemoved(inc.video);
            if (inc.audio)
                jitsiTrackRemoved(inc.audio);
            if (!inc.rtcReady) {
                try {
                    inc.rtc.close();
                } catch (ex) {}
                delete jitsiPeers[id];
            }
        }

        if (room) {
            room.removeEventListener(JitsiMeetJS.events.conference.CONFERENCE_LEFT, config.disconnect);
            return room.leave();
        }

    }).then(() => {
        room = null;
        if (connection) {
            connection.removeEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, config.disconnect);
            connection.disconnect();
            connection = null;

        }

        // Initialize Jitsi
        JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
        let initDict: any = {
            disableAudioLevels: true,
            disableSimulcast: jitsiFeatures.disableSimulcast
        };
        if (jitsiFeatures.disableSimulcast)
            initDict.preferredCodec = "h264";
        JitsiMeetJS.init(initDict);

        // Create our connection
        return new Promise(function(res, rej) {
            connection = new JitsiMeetJS.JitsiConnection(null, null, {
                hosts: {
                    domain: "jitsi.weca.st",
                    muc: "conference.jitsi.weca.st"
                },
                bosh: config.jitsiUrl,
                clientNode: "https://ennuicastr.com/"
            });

            connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, res);
            connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, rej);
            connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, config.disconnect);

            timeout = setTimeout(rej, 5000);
            connection.connect();
        });

    }).then(() => {
        clearTimeout(timeout);

        // Join the "room"
        return new Promise(function(res, rej) {
            const roomNm = config.config.id.toString(36) + "_" + config.config.key.toString(36) +
                (jitsiFeatures.disableSimulcast ? "_nosc" : "") +
                (jitsiFeatures.disableP2P ? "_nop2p" : "");
            room = connection.initJitsiConference(roomNm, {
                openBridgeChannel: true,
                p2p: {
                    enabled: !jitsiFeatures.disableP2P
                }
            });

            room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_JOINED, res);
            room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_LEFT, config.disconnect);
            room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_FAILED, rej);
            room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_ERROR, config.disconnect);
            room.addEventListener(JitsiMeetJS.events.conference.TRACK_ADDED, jitsiTrackAdded);
            room.addEventListener(JitsiMeetJS.events.conference.TRACK_REMOVED, jitsiTrackRemoved);
            room.addEventListener(JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED, jitsiMessage);

            // Add our local tracks
            util.events.addEventListener("usermediartcready", () => { jitsiSetUserMediaRTC(); });
            jitsiSetUserMediaRTC();
            util.events.addEventListener("usermediavideoready", () => { jitsiSetUserMediaVideo(); });
            jitsiSetUserMediaVideo();

            // And join
            timeout = setTimeout(rej, 5000);
            room.setDisplayName("" + net.selfId);
            room.join();
        });

    }).then(() => {
        clearTimeout(timeout);

    }).catch(net.promiseFail());
    return jPromise;
}


// We initialize Jitsi once we know our own ID
if (config.useRTC) {
    util.events.addEventListener("net.info." + prot.info.id, function() {
        initJitsi();
    });
}

// And reinitialize if Jitsi features change
if (config.useRTC) {
    util.events.addEventListener("net.info." + prot.info.jitsi, function(ev: CustomEvent) {
        const msg = new Uint8Array(ev.detail.msg.buffer);
        const p = prot.parts.info;
        const jitsiStr = util.decodeText(msg.slice(p.value));
        const jitsiF: any = JSON.parse(jitsiStr);
        if (!!jitsiF.disableSimulcast !== jitsiFeatures.disableSimulcast ||
            !!jitsiF.disableP2P !== jitsiFeatures.disableP2P) {
            jitsiFeatures.disableSimulcast = !!jitsiF.disableSimulcast;
            jitsiFeatures.disableP2P = !!jitsiF.disableP2P;
            jPromise = jPromise.then(() => {
                if (room)
                    initJitsi();
            });
        }
    });
}


// Set our UserMediaRTC track
function jitsiSetUserMediaRTC(retries?: number) {
    if (typeof retries === "undefined")
        retries = 2;
    if (!audio.userMediaRTC)
        return Promise.all([]);

    // If we already had one, remove it
    jitsiUnsetUserMediaRTC();

    // Then add the new one
    jPromise = jPromise.then(() => {
        // Make and add the new one
        jAudio = new JitsiMeetJS.JitsiLocalTrack({
            deviceId: audio.userMediaRTC.id,
            rtcId: audio.userMediaRTC.id + ":" + (jCounter++),
            mediaType: "audio",
            stream: audio.userMediaRTC,
            track: audio.userMediaRTC.getAudioTracks()[0]
        });
        return room.addTrack(jAudio);

    }).then(() => {
        // And prepare to remove it
        util.events.addEventListener("usermediastopped", jitsiUnsetUserMediaRTC, {once: true});

    }).catch(() => {
        if (retries) {
            setTimeout(() => {
                jitsiSetUserMediaRTC(retries-1);
            }, 1000);
        } else {
            net.promiseFail();
        }
    });

    return jPromise;
}

// Unset our UserMediaRTC track
function jitsiUnsetUserMediaRTC() {
    jPromise = jPromise.then(() => {
        if (!jAudio)
            return;
        return room.removeTrack(jAudio);

    }).then(() => {
        jAudio = null;

    }).catch(net.promiseFail());

    return jPromise;
}

// Set our UserMediaVideo track
function jitsiSetUserMediaVideo(retries?: number) {
    if (typeof retries === "undefined")
        retries = 2;
    if (!video.userMediaVideo)
        return;

    // If we already had one, remove it
    jitsiUnsetUserMediaVideo();

    // Then add the new one
    jPromise = jPromise.then(() => {
        jVideo = new JitsiMeetJS.JitsiLocalTrack({
            deviceId: video.userMediaVideo.id,
            rtcId: video.userMediaVideo.id + ":" + (jCounter++),
            mediaType: "video",
            stream: video.userMediaVideo,
            track: video.userMediaVideo.getVideoTracks()[0]
        });
        return room.addTrack(jVideo);

    }).then(() => {
        // And prepare to remove it
        util.events.addEventListener("usermediavideostopped", jitsiUnsetUserMediaVideo, {once: true});

    }).catch(() => {
        if (retries) {
            setTimeout(() => {
                jitsiSetUserMediaVideo(retries - 1);
            }, 1000);
        } else {
            net.promiseFail();
        }
    });

    return jPromise;
}

// Unset our UserMediaVideo track
function jitsiUnsetUserMediaVideo() {
    jPromise = jPromise.then(() => {
        if (!jVideo)
            return;
        return room.removeTrack(jVideo);

    }).then(() => {
        jVideo = null;

    }).catch(net.promiseFail());

    return jPromise;
}

// Get an Ennuicastr user ID from a Jitsi track
function getUserId(track: any) {
    const jid: string = track.getParticipantId();
    let user: any = null;
    const parts: any[] = room.getParticipants();
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].getId() === jid) {
            user = parts[i];
            break;
        }
    }
    if (!user)
        return null;

    const id: number = +user.getDisplayName();
    if (Number.isNaN(id))
        return null;

    return id;
}

// Called when a remote track is added
function jitsiTrackAdded(track: any) {
    if (track.isLocal()) return;
    const stream: MediaStream = track.getOriginalStream();
    const type: string = track.getType();

    // Get the user
    const id = getUserId(track);
    const jid = track.getParticipantId();
    if (!(id in jitsiPeers)) {
        assertJitsiPeer(id, jid);

        // Initial "connection". Tell them our current speech status.
        speech(vad.vadOn, id);

        // And if we're a master, tell them whether we accept remote video.
        if ("master" in config.config)
            videoRecSend(id, prot.videoRec.videoRecHost, ~~ui.ui.panels.master.acceptRemoteVideo.checked);
    }
    const inc = jitsiPeers[id];
    (<any> inc)[type] = track;

    // Make sure they have a video element
    ui.videoAdd(id, null);

    // Set this in the appropriate element
    const el: HTMLMediaElement = (<any> ui.ui.video.users[id])[type];
    el.srcObject = stream;
    if (el.paused)
        el.play().catch(net.promiseFail());

    // Hide the standin if applicable
    if (type === "video")
        ui.ui.video.users[id].standin.style.display = "none";

    // Create the compressor node
    if (type === "audio")
        outproc.createCompressor(id, audio.ac, stream, ui.ui.video.users[id].waveformWrapper);

    // If they're the major, ask for higher quality
    if (ui.ui.video.major === id)
        setMajor(id);
}

// Called when a remote track is removed
function jitsiTrackRemoved(track: any) {
    if (track.isLocal()) return;
    const type: string = track.getType();

    // Get the user
    const id = getUserId(track);
    if (!(id in jitsiPeers))
        return;
    const inc = jitsiPeers[id];

    // If this isn't even their current track, ignore it
    if ((<any> inc)[type] !== track)
        return;
    (<any> inc)[type] = null;
    if (type === "video" && videoRecIncoming[id]) {
        videoRecIncoming[id].writer.close();
        delete videoRecIncoming[id];
    }
    if (!inc.audio && !inc.video && !inc.rtcReady) {
        try {
            inc.rtc.close();
        } catch (ex) {}
        delete jitsiPeers[id];
    }

    // Remove it from the UI
    if (ui.ui.video.users[id]) {
        const el: HTMLMediaElement = (<any> ui.ui.video.users[id])[type];
        el.srcObject = null;

        // Show the standin if applicable
        if (type === "video")
            ui.ui.video.users[id].standin.style.display = "";
    }

    // And destroy the compressor
    if (type === "audio")
        outproc.destroyCompressor(id);
}

// Incoming Jitsi end-to-end messages
function jitsiMessage(user: any, jmsg: any) {
    if (jmsg.type !== "ennuicastr" && jmsg.type !== "ennuicastr-rtc")
        return;

    // Get the peer number
    const jid: string = user.getId();
    const peer = +user.getDisplayName();
    if (Number.isNaN(peer))
        return;
    const inc = assertJitsiPeer(peer, jid);

    if (jmsg.type === "ennuicastr-rtc") {
        // Just send it along
        if (inc.signal)
            inc.signal(jmsg);
        return;
    }

    if (typeof jmsg.ec !== "string")
        return;

    // Turn it back into raw data
    const ec = jmsg.ec;
    const buf = new Uint8Array(ec.length);
    for (let i = 0; i < buf.length; i++)
        buf[i] = ec.charCodeAt(i);
    const msg = new DataView(buf.buffer);

    return peerMessage(peer, msg);
}


// Incoming RTC or Jitsi end-to-end messages
function peerMessage(peer: number, msg: DataView) {
    if (msg.byteLength < 4)
        return;
    const cmd = msg.getUint32(0, true);

    // Process the command
    switch (cmd) {
        case prot.ids.data:
            try {
                const vr = videoRecIncoming[peer];
                const idx = msg.getFloat64(4, true);
                const buf = new Uint8Array(msg.buffer).subarray(12);
                if (idx !== vr.nextIdx) {
                    // Data out of order. Push it for later.
                    vr.buf.push({idx: idx, buf: buf});
                    if (vr.buf.length >= 1024) {
                        // Too much! FIXME: Error reporting
                        vr.writer.close();
                        delete videoRecIncoming[peer];
                    }

                } else {
                    // This is our expected data
                    vr.writer.write(buf);
                    vr.nextIdx += buf.length;

                    // Perhaps write out more
                    while (vr.buf.length) {
                        let cont = false;
                        for (let i = 0; i < vr.buf.length; i++) {
                            const part = vr.buf[i];
                            if (part.idx === vr.nextIdx) {
                                vr.writer.write(part.buf);
                                vr.nextIdx += part.buf.length;
                                vr.buf.splice(i, 1);
                                cont = true;
                                break;
                            }
                        }
                        if (!cont) break;
                    }

                }
            } catch (ex) {}
            break;

        case prot.ids.speech:
        {
            // Speech status
            const p = prot.parts.speech;
            if (msg.byteLength < p.length) return;
            const status = !!msg.getUint32(p.indexStatus, true);
            util.dispatchEvent("ui.speech", {user: peer, status: status});
            break;
        }

        case prot.ids.videoRec:
        {
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
                    if (accept)
                        videoRecHost = peer; // FIXME: Deal with disconnections
                    else if (videoRecHost === peer)
                        videoRecHost = -1;
                    break;
                }

                case pv.startVideoRecReq:
                    if ("master" in config.config &&
                        ui.ui.panels.master.acceptRemoteVideo.checked) {

                        // Check for options
                        let opts = {};
                        if (msg.byteLength > p.length) {
                            try {
                                opts = JSON.parse(util.decodeText(new Uint8Array(msg.buffer).subarray(p.length)));
                            } catch (ex) {}
                        }

                        videoRecord.recordVideoRemoteIncoming(peer, opts).then(function(fileWriter) {
                            videoRecSend(peer, prot.videoRec.startVideoRecRes, 1);
                            videoRecIncoming[peer] = {
                                nextIdx: 0,
                                buf: [],
                                writer: fileWriter
                            };
                        }).catch(net.promiseFail());

                    } else {
                        videoRecSend(peer, prot.videoRec.startVideoRecRes, 0);

                    }
                    break;

                case pv.startVideoRecRes:
                    // Only if we actually *wanted* them to accept video!
                    if (videoRecord.recordVideoRemoteOK && peer === videoRecHost)
                        videoRecord.recordVideoRemoteOK(peer);
                    break;

                case pv.endVideoRec:
                    try {
                        // FIXME: Jitsi has no ordering guarantee, so this may be done at the wrong time!
                        videoRecIncoming[peer].writer.close();
                        delete videoRecIncoming[peer];
                    } catch (ex) {}
                    break;
            }
            break;
        }
    }
}

// Send a Jitsi message with retries
function sendJitsiMsg(jid: string, msg: any, retries?: number) {
    if (typeof retries === "undefined")
        retries = 10;

    try {
        if (jid === null) {
            if (Object.keys(jitsiPeers).length > 0)
                room.broadcastEndpointMessage(msg);
        } else {
            room.sendEndpointMessage(jid, msg);
        }
    } catch (ex) {
        if (retries) {
            setTimeout(() => {
                sendJitsiMsg(jid, msg, retries-1);
            }, 1000);
        } else {
            throw ex;
        }
    }
}

// Send an Ennuicastr message over Jitsi or RTC
function sendMsg(msg: Uint8Array, peer?: number) {
    if (!room)
        return;

    // Get the target ID
    let inc: JitsiPeer = null;
    let jid: string = null;
    if (typeof peer !== "undefined") {
        if (!(peer in jitsiPeers))
            return;
        inc = jitsiPeers[peer];
        jid = inc.id;
    }

    // If we can, send it directly
    if (inc && inc.rtcReady) {
        inc.data.send(msg.buffer);
        return;
    }

    // Otherwise, we'll send it via the bridge

    // Convert the message to a string (gross)
    const msga: string[] = [];
    for (let i = 0; i < msg.length; i++)
        msga.push(String.fromCharCode(msg[i]));
    const msgs = msga.join("");
    const msgj = {type: "ennuicastr", ec: msgs};

    // Send it to the peer or broadcast it to all peers
    sendJitsiMsg(jid, msg);
}

// Send a video recording subcommand to a peer
export function videoRecSend(peer: number, cmd: number, payloadData?: unknown): void {
    if (!config.useRTC)
        return;

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
    sendMsg(new Uint8Array(msg.buffer), peer);
}

// Catastrophic disconnection
function disconnect() {
    if (!room)
        return Promise.all([]);

    const ret = room.leave();
    room = null;
    return ret;
}

// Close a given peer's RTC connection
function closeRTC(peer: number) {
    // Even if they're still on RTC, this should be considered catastrophic
    if (!(peer in jitsiPeers))
        return;
    const inc = jitsiPeers[peer];
    if (inc.video)
        jitsiTrackRemoved(inc.video);
    if (inc.audio)
        jitsiTrackRemoved(inc.audio);
    delete jitsiPeers[peer];
}

if (config.useRTC) {
    util.events.addEventListener("net.info." + prot.info.peerLost, function(ev: CustomEvent) {
        closeRTC(ev.detail.val);
    });
}

// Send a speech message over RTC
export function speech(status: boolean, peer?: number): void {
    if (!config.useRTC)
        return;

    // Build the message
    const p = prot.parts.speech;
    const msgv = new DataView(new ArrayBuffer(p.length));
    msgv.setUint32(0, prot.ids.speech, true);
    msgv.setUint32(p.indexStatus, status?1:0, true);
    const msg = new Uint8Array(msgv.buffer);

    // Send it
    sendMsg(msg, peer);
}

// If we get a speech event from us, send it out
util.events.addEventListener("ui.speech", function(ev: CustomEvent) {
    if (ev.detail.user === null)
        speech(ev.detail.status);
});

// Send a chunk of video data to a peer
export function videoDataSend(peer: number, idx: number, buf: Uint8Array): void {
    // Send 16k at a time
    for (let start = 0; start < buf.length; start += 16380) {
        const part = buf.subarray(start, start + 16380);
        const msg = new DataView(new ArrayBuffer(12 + part.length));
        msg.setUint32(0, prot.ids.data, true);
        msg.setFloat64(4, idx + start, true);
        new Uint8Array(msg.buffer).set(part, 12);
        sendMsg(new Uint8Array(msg.buffer), peer);
    }
}

// Set the "major" (primary speaker) for video quality
function setMajor(peer: number) {
    if (!(peer in jitsiPeers) || !room)
        return;
    const jid = jitsiPeers[peer].id;

    if (peer < 0) {
        // No primary = everyone is primary!
        room.setReceiverConstraints({
            lastN: 64,
            selectedEndpoints: [],
            onStageEndpoints: [],
            defaultConstraints: { maxHeight: 1080 },
            constraints: {}
        });

    } else {
        // Set this individual as preferred
        const constraints: any = {};
        constraints[jid] = { maxHeight: 1080 };
        room.setReceiverConstraints({
            lastN: 64,
            selectedEndpoints: [jid],
            onStageEndpoints: [jid],
            defaultConstraints: { maxHeight: 360 },
            constraints: constraints
        });

    }
}

util.events.addEventListener("ui.video.major", function() {
    setMajor(ui.ui.video.major);
});


/* The RTC side: using Jitsi as a bridge, try to establish a direct (RTC)
 * connection for data */
function startRTC(id: number, j: JitsiPeer) {
    // Perfect negotiation pattern
    const polite = (net.selfId > id);

    // Create our peer connection
    j.rtc = new RTCPeerConnection({
        iceServers: net.iceServers
    });

    // Incoming data channels
    j.rtc.ondatachannel = function(ev: RTCDataChannelEvent) {
        const data = ev.channel;
        data.binaryType = "arraybuffer";
        data.onmessage = function(ev: MessageEvent) {
            const msg = new DataView(ev.data);
            peerMessage(id, msg);
        };
    };

    // Negotiation
    j.rtc.onnegotiationneeded = onnegotiationneeded;
    function onnegotiationneeded() {
        j.rtc.createOffer().then(offer => {
            return j.rtc.setLocalDescription(offer);
        }).then(() => {
            // Tell them our local description
            if (room)
                sendJitsiMsg(j.id, {type: "ennuicastr-rtc", desc: j.rtc.localDescription});
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        }).catch(()=>{});
    }

    // ICE candidates
    j.rtc.onicecandidate = function(ev: RTCPeerConnectionIceEvent) {
        if (room)
            sendJitsiMsg(j.id, {type: "ennuicastr-rtc", cand: ev.candidate});
    };

    // Incoming signals
    j.signal = function(msg: any) {
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
                        if (room)
                            sendJitsiMsg(j.id, {type: "ennuicastr-rtc", desc: j.rtc.localDescription });
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
    j.data.onopen = function() {
        j.rtcReady = true;
    };
    j.data.onclose = j.data.onerror = function() {
        j.rtcReady = false;

        if (jitsiPeers[id] === j && !j.audio && !j.video) {
            // There's nothing left
            delete jitsiPeers[id];
        }
    };

    onnegotiationneeded();
}
