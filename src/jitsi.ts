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
declare var JitsiMeetJS: any;

import * as audio from "./audio";
import * as config from "./config";
import * as net from "./net";
import * as outproc from "./outproc";
import * as proc from "./proc";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as video from "./video";
import * as videoRecord from "./video-record";

// Host which has indicated that it's willing to receive video recordings
export let videoRecHost: number = -1;

// Jitsi connection
let connection: any;

// Jitsi "room"
let room: any;

// Promises for adding and removing tracks to/from Jitsi
let jPromise: Promise<unknown> = Promise.all([]);

// Jitsi tracks need a unique ID. Use this as a counter to generate them.
let jCounter: number = 0;

// Jitsi outgoing audio track
let jAudio: any;

// Jitsi outgoing video track
let jVideo: any;

// Incoming tracks by user
interface TrackPair {
    id: string; // Jitsi ID
    audio: any;
    video: any;
}
let incoming: Record<number, TrackPair> = {};

// If we're a video recording receiver, the write stream for each user
interface VideoRecIncoming {
    nextIdx: number;
    buf: {idx: number, buf: Uint8Array}[];
    writer: WritableStreamDefaultWriter;
}
let videoRecIncoming: Record<number, VideoRecIncoming> = {};

// Initialize the Jitsi connection
export function initJitsi() {
    let timeout: number = null;
    return Promise.all([]).then(() => {
        if (typeof JitsiMeetJS === "undefined")
            return util.loadLibrary("https://code.jquery.com/jquery-3.6.0.min.js");

    }).then(() => {
        if (typeof JitsiMeetJS === "undefined")
            return util.loadLibrary("lib-jitsi-meet.min.js");

    }).then(() => {
        JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
        JitsiMeetJS.init({
            disableAudioLevels: true
        });

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
            connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, net.disconnect);

            timeout = setTimeout(rej, 5000);
            connection.connect();
        });

    }).then(() => {
        clearTimeout(timeout);

        // Join the "room"
        return new Promise(function(res, rej) {
            room = connection.initJitsiConference(config.config.id.toString(36) + "_" + config.config.key.toString(36), {
                openBridgeChannel: true
            });

            room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_JOINED, res);
            room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_LEFT, net.disconnect);
            room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_FAILED, rej);
            room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_ERROR, net.disconnect);
            room.addEventListener(JitsiMeetJS.events.conference.TRACK_ADDED, jitsiTrackAdded);
            room.addEventListener(JitsiMeetJS.events.conference.TRACK_REMOVED, jitsiTrackRemoved);
            room.addEventListener(JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED, jitsiMessage);

            // Add our local tracks
            audio.userMediaAvailableEvent.addEventListener("usermediartcready", jitsiSetUserMediaRTC);
            jitsiSetUserMediaRTC();
            audio.userMediaAvailableEvent.addEventListener("usermediavideoready", jitsiSetUserMediaVideo);
            jitsiSetUserMediaVideo();

            // And join
            timeout = setTimeout(rej, 5000);
            room.setDisplayName("" + net.selfId);
            room.join();
        });

    }).then(() => {
        clearTimeout(timeout);

    }).catch(net.promiseFail());
}

// Set our UserMediaRTC track
function jitsiSetUserMediaRTC() {
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
        audio.userMediaAvailableEvent.addEventListener("usermediastopped", jitsiUnsetUserMediaRTC, {once: true});

    }).catch(net.promiseFail());

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
function jitsiSetUserMediaVideo() {
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
        audio.userMediaAvailableEvent.addEventListener("usermediavideostopped", jitsiUnsetUserMediaVideo, {once: true});

    }).catch(net.promiseFail());

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
    let jid: string = track.getParticipantId();
    let user: any = null;
    let parts: any[] = room.getParticipants();
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].getId() === jid) {
            user = parts[i];
            break;
        }
    }
    if (!user)
        return null;

    let id: number = +user.getDisplayName();
    if (Number.isNaN(id))
        return null;

    return id;
}

// Called when a remote track is added
function jitsiTrackAdded(track: any) {
    if (track.isLocal()) return;
    let stream: MediaStream = track.getOriginalStream();
    let type: string = track.getType();

    // Get the user
    let id = getUserId(track);
    if (!(id in incoming))
        incoming[id] = {id: null, audio: null, video: null};
    let inc = incoming[id];
    inc.id = track.getParticipantId();
    (<any> inc)[type] = track;

    // Make sure they have a video element
    ui.videoAdd(id, null);

    // Set this in the appropriate element
    let el: HTMLMediaElement = (<any> ui.ui.video.users[id])[type];
    el.srcObject = stream;
    el.play().catch(console.error);

    // Hide the standin if applicable
    if (type === "video")
        ui.ui.video.users[id].standin.style.display = "none";

    // Create the compressor node
    if (type === "audio")
        outproc.createCompressor(id, audio.ac, stream, ui.ui.video.users[id].waveformWrapper);

    // If they're the major, ask for higher quality
    if (ui.ui.video.major === id)
        room.selectParticipant(inc.id);
}

// Called when a remote track is removed
function jitsiTrackRemoved(track: any) {
    if (track.isLocal()) return;
    let stream: MediaStream = track.getOriginalStream();
    let type: string = track.getType();

    // Get the user
    let id = getUserId(track);
    if (!(id in incoming))
        return;
    let inc = incoming[id];

    // If this isn't even their current track, ignore it
    if ((<any> inc)[type] !== track)
        return;
    (<any> inc)[type] = null;
    if (!inc.audio && !inc.video)
        delete incoming[id];

    // Remove it from the UI
    if (ui.ui.video.users[id]) {
        let el: HTMLMediaElement = (<any> ui.ui.video.users[id])[type];
        el.srcObject = null;

        // Show the standin if applicable
        if (type === "video")
            ui.ui.video.users[id].standin.style.display = "";
    }

    // And destroy the compressor
    if (type === "audio")
        outproc.destroyCompressor(id);
}

// Incoming end-to-end messages
function jitsiMessage(user: any, jmsg: any) {
    if (jmsg.type !== "ennuicastr")
        return;

    if (typeof jmsg.ec !== "string")
        return;

    // Get the peer number
    let jid: string = user.getId();
    let peer = +user.getDisplayName();
    if (Number.isNaN(peer))
        return;
    if (!(peer in incoming))
        incoming[peer] = {id: jid, audio: null, video: null};

    // Turn it back into raw data
    let ec = jmsg.ec;
    let buf = new Uint8Array(ec.length);
    for (let i = 0; i < buf.length; i++)
        buf[i] = ec.charCodeAt(i);
    let msg = new DataView(buf.buffer);

    // Then process it
    if (msg.byteLength < 4)
        return;
    let cmd = msg.getUint32(0, true);

    switch (cmd) {
        case prot.ids.data:
            try {
                let vr = videoRecIncoming[peer];
                let idx = msg.getFloat64(4, true);
                let buf = new Uint8Array(msg.buffer).subarray(12);
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
                            let part = vr.buf[i];
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
            let p = prot.parts.speech;
            if (msg.byteLength < p.length) return;
            let status = !!msg.getUint32(p.indexStatus, true);
            proc.updateSpeech(peer, status);
            break;
        }

        case prot.ids.videoRec:
        {
            // Video recording sub-message
            let p = prot.parts.videoRec;
            let pv = prot.videoRec;
            if (msg.byteLength < p.length) return;
            let cmd = msg.getUint32(p.cmd, true);

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

// Send an Ennuicastr message over Jitsi
function sendMsg(msg: Uint8Array, peer?: number) {
    if (!room)
        return;

    // Get the target ID
    let jid: string = null;
    if (typeof peer !== "undefined") {
        if (!(peer in incoming))
            return;
        jid = incoming[peer].id;
    }

    // Convert the message to a string (gross)
    let msga: string[] = [];
    for (let i = 0; i < msg.length; i++)
        msga.push(String.fromCharCode(msg[i]));
    let msgs = msga.join("");
    let msgj = {type: "ennuicastr", ec: msgs};

    // Send it to the peer or broadcast it to all peers
    if (jid === null) {
        if (Object.keys(incoming).length > 0)
            room.broadcastEndpointMessage(msgj);
    } else {
        room.sendEndpointMessage(jid, msgj);
    }
}

// Send a video recording subcommand to a peer
export function videoRecSend(peer: number, cmd: number, payloadData?: unknown) {
    if (!config.useRTC)
        return;

    // Build the payload
    let payload: Uint8Array;
    if (typeof payloadData === "number") {
        payload = new Uint8Array(4);
        let dv = new DataView(payload.buffer);
        dv.setUint32(0, payloadData, true);

    } else if (typeof payloadData === "object") {
        payload = util.encodeText(JSON.stringify(payloadData));

    } else {
        payload = new Uint8Array(0);

    }

    // Build the message
    let p = prot.parts.videoRec;
    let msg = new DataView(new ArrayBuffer(p.length + payload.length));
    msg.setUint32(0, prot.ids.videoRec, true);
    msg.setUint32(p.cmd, cmd, true);
    new Uint8Array(msg.buffer).set(new Uint8Array(payload.buffer), p.length);

    // And send it
    sendMsg(new Uint8Array(msg.buffer), peer);
}

// Catastrophic disconnection
export function disconnect() {
    if (!room)
        return Promise.all([]);

    let ret = room.leave();
    room = null;
    return ret;
}

// Close a given peer's RTC connection
export function closeRTC(peer: number) {
    // Even if they're still on RTC, this should be considered catastrophic
    if (!(peer in incoming))
        return;
    let inc = incoming[peer];
    if (inc.video)
        jitsiTrackRemoved(inc.video);
    if (inc.audio)
        jitsiTrackRemoved(inc.audio);
    delete incoming[peer];
}

// Send a speech message over RTC
export function speech(status: boolean, peer?: number) {
    if (!config.useRTC)
        return;

    // Build the message
    let p = prot.parts.speech;
    let msgv = new DataView(new ArrayBuffer(p.length));
    msgv.setUint32(0, prot.ids.speech, true);
    msgv.setUint32(p.indexStatus, status?1:0, true);
    let msg = new Uint8Array(msgv.buffer);

    // Send it
    sendMsg(msg, peer);
}

// Send a chunk of video data to a peer
export function videoDataSend(peer: number, idx: number, buf: Uint8Array) {
    // Send 16k at a time
    for (let start = 0; start < buf.length; start += 16380) {
        let part = buf.subarray(start, start + 16380);
        let msg = new DataView(new ArrayBuffer(12 + part.length));
        msg.setUint32(0, prot.ids.data, true);
        msg.setFloat64(4, idx + start, true);
        new Uint8Array(msg.buffer).set(part, 12);
        sendMsg(new Uint8Array(msg.buffer), peer);
    }
}

// Set the "major" (primary speaker) for video quality
export function setMajor(peer: number) {
    if (!(peer in incoming) || !room)
        return;
    let jid = incoming[peer].id;
    room.selectParticipant(jid);
}
