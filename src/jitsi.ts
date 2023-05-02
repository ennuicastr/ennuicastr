/*
 * Copyright (c) 2018-2023 Yahweasel
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
 * Support for Jitsi Meet communications.
 */

// extern
declare let JitsiMeetJS: any;

import * as audio from "./audio";
import * as comm from "./comm";
import * as config from "./config";
import * as net from "./net";
import * as outproc from "./outproc";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as vad from "./vad";
import * as video from "./video";

import * as rtennui from "rtennui";

// Jitsi peer information
interface JitsiPeer {
    id: string; // Jitsi ID
    audio: any;
    video: any;
}

export class Jitsi implements comm.BroadcastComms {
    // The comm mode we were initialized with
    commModes: comm.CommModes;

    // Jitsi connection
    connection: any;

    // Jitsi "room"
    room: any;

    // Promises for adding and removing tracks to/from Jitsi
    jPromise: Promise<unknown> = Promise.all([]);

    // Jitsi tracks need a unique ID. Use this as a counter to generate them.
    jCounter = 0;

    // Playback-ified version of our output
    userMediaPlayback: rtennui.AudioPlayback;

    // MediaStream-ified version of our output
    userMediaRTC: MediaStream;

    // Jitsi outgoing audio track
    jAudio: any;

    // Jitsi outgoing video track
    jVideo: any;

    // Jitsi peers
    jitsiPeers: Record<number, JitsiPeer> = {};

    // Assert that a Jitsi peer exists
    assertJitsiPeer(id: number, jid: string): JitsiPeer {
        if (this.jitsiPeers[id])
            return this.jitsiPeers[id];

        const ret = this.jitsiPeers[id] = {
            id: jid,
            audio: <any> null,
            video: <any> null
        };

        return ret;
    }

    // Initialize the Jitsi subsystem
    async init(opts: comm.CommModes): Promise<void> {
        // We initialize Jitsi once we know our own ID
        if (!net.selfId) {
            util.events.addEventListener("net.info." + prot.info.id, () => {
                this.init(opts);
            });
            return;
        }

        // The way that VAD works with Jitsi is simply to mute the track
        if (opts.audio) {
            util.events.addEventListener("vad.rtc0", () => {
                // FIXME
                const a = this.userMediaRTC;
                if (!a)
                    return;
                const t = a.getAudioTracks()[0];
                if (!t)
                    return;
                t.enabled = vad.vads[0].rtcVadOn;
            });
        }

        this.commModes = opts;

        // Disconnections
        util.events.addEventListener("net.info." + prot.info.peerLost, (ev: CustomEvent) => {
            this.closeRTC(ev.detail.val);
        });

        // If we get a speech event from us, send it out
        util.events.addEventListener("ui.speech", (ev: CustomEvent) => {
            if (ev.detail.user === null)
                this.speech(ev.detail.status);
        });

        // Send captions when they're generated
        util.events.addEventListener("proc.caption", (ev: CustomEvent) => {
            this.caption(ev.detail.complete, ev.detail.result.text || ev.detail.result.partial);
        });

        // Major user
        util.events.addEventListener("ui.video.major", () => {
            this.setMajor(ui.ui.video.major);
        });

        this.initJitsi();
    }

    // Initialize the Jitsi connection
    async initJitsi(): Promise<void> {
        if (!audio.inputs[0].userMediaCapture) {
            // Wait until we have audio
            util.events.addEventListener("usermediartcready", () => this.initJitsi(), {once: true});
            return;
        }

        let timeout: number = null;
        this.jPromise = this.jPromise.then(() => {
            if (typeof JitsiMeetJS === "undefined")
                return util.loadLibrary({
                    file: "libs/jquery.min.js",
                    name: "live chat"
                });

        }).then(() => {
            if (typeof JitsiMeetJS === "undefined")
                return util.loadLibrary({
                    file: "libs/lib-jitsi-meet.7421.js",
                    name: "live chat"
                });

        }).then(() => {
            // Get rid of any old Jitsi instance. First, clear tracks.
            for (const id of Object.keys(this.jitsiPeers)) {
                const inc: JitsiPeer = (<any> this.jitsiPeers)[id];
                if (inc.video)
                    this.jitsiTrackRemoved(inc.video);
                if (inc.audio)
                    this.jitsiTrackRemoved(inc.audio);
                delete (<any> this.jitsiPeers)[id];
            }

            if (this.room) {
                this.room.removeEventListener(JitsiMeetJS.events.conference.CONFERENCE_LEFT, config.disconnect);
                return this.room.leave();
            }

        }).then(() => {
            this.room = null;
            if (this.connection) {
                this.connection.removeEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, config.disconnect);
                this.connection.disconnect();
                this.connection = null;

            }

            // Initialize Jitsi
            JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
            JitsiMeetJS.init();

            // Create our connection
            return new Promise((res, rej) => {
                this.connection = new JitsiMeetJS.JitsiConnection(null, null, {
                    hosts: {
                        domain: "jitsi." + config.url.host,
                        muc: "conference.jitsi." + config.url.host
                    },
                    serviceUrl: config.jitsiUrl,
                    clientNode: "https://ennuicastr.com/"
                });

                this.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, res);
                this.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, () => { rej(new Error("Connection failed")); });
                this.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, config.disconnect);

                timeout = setTimeout(() => { rej(new Error("Connection timeout")); }, 30000);
                this.connection.connect();
            });

        }).then(() => {
            clearTimeout(timeout);

            // Join the "room"
            return new Promise((res, rej) => {
                const roomNm = config.config.id.toString(36) + "_" + config.config.key.toString(36);
                this.room = this.connection.initJitsiConference(roomNm, {
                    openBridgeChannel: true,
                    p2p: {
                        enabled: false
                    }
                });

                this.room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_JOINED, res);
                this.room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_LEFT, config.disconnect);
                this.room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_FAILED, () => { rej(new Error("Conference failed")); });
                this.room.addEventListener(JitsiMeetJS.events.conference.CONFERENCE_ERROR, config.disconnect);
                this.room.addEventListener(JitsiMeetJS.events.conference.TRACK_ADDED, track => this.jitsiTrackAdded(track));
                this.room.addEventListener(JitsiMeetJS.events.conference.TRACK_REMOVED, track => this.jitsiTrackRemoved(track));
                this.room.addEventListener(JitsiMeetJS.events.conference.USER_JOINED, user => this.jitsiUserJoined(user));
                //this.room.addEventListener(JitsiMeetJS.events.conference.USER_LEFT, jitsiUserLeft);
                this.room.addEventListener(JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED, (user, msg) => this.jitsiMessage(user, msg));

                // Add our local tracks
                if (this.commModes.audio) {
                    util.events.addEventListener("usermediartcready", () => { this.jitsiSetUserMediaRTC(); });
                    this.jitsiSetUserMediaRTC();
                }
                if (this.commModes.video) {
                    util.events.addEventListener("usermediavideoready", () => { this.jitsiSetUserMediaVideo(); });
                    this.jitsiSetUserMediaVideo();
                }

                // And join
                timeout = setTimeout(() => { rej(new Error("Conference timeout")); }, 30000);
                this.room.setDisplayName("" + net.selfId);
                this.room.join();
            });

        }).then(() => {
            clearTimeout(timeout);

        }).catch(ex => {
            this.initJitsi();
            throw ex;

        }).catch(net.promiseFail());
        await this.jPromise;
    }


    // Set our UserMediaRTC track
    async jitsiSetUserMediaRTC(retries = 2): Promise<unknown> {
        if (!audio.inputs[0].userMediaCapture)
            return;

        // If we already had one, remove it
        this.jitsiUnsetUserMediaRTC();

        // Get a playback from it
        const playback = this.userMediaPlayback =
            await rtennui.createAudioPlayback(audio.ac);
        let node = playback.unsharedNode() || playback.sharedNode();
        node.disconnect();
        audio.inputs[0].userMediaCapture.pipe(playback);

        // Turn it into a MediaStream
        const msd = audio.ac.createMediaStreamDestination();
        node.connect(msd);
        const rtc = this.userMediaRTC = msd.stream;

        // Set up the VAD
        {
            const track = rtc.getAudioTracks()[0];
            if (track)
                track.enabled = vad.vads[0].rtcVadOn;
        }

        // Then add the new one
        this.jPromise = this.jPromise.then(() => {
            // Make and add the new one
            this.jAudio = new JitsiMeetJS.JitsiLocalTrack({
                deviceId: rtc.id,
                rtcId: rtc.id + ":" + (this.jCounter++),
                mediaType: "audio",
                stream: rtc,
                track: rtc.getAudioTracks()[0]
            });
            return this.room.addTrack(this.jAudio);

        }).then(() => {
            // And prepare to remove it
            util.events.addEventListener("usermediastopped", () => this.jitsiUnsetUserMediaRTC(), {once: true});

        }).catch(() => {
            if (retries) {
                setTimeout(() => {
                    this.jitsiSetUserMediaRTC(retries-1);
                }, 1000);
            } else {
                net.promiseFail();
            }
        });

        return this.jPromise;
    }

    // Unset our UserMediaRTC track
    jitsiUnsetUserMediaRTC(): Promise<unknown> {
        if (this.userMediaPlayback)
            this.userMediaPlayback.close();
        this.userMediaPlayback = this.userMediaRTC = null;

        this.jPromise = this.jPromise.then(() => {
            if (!this.jAudio)
                return;
            return this.room.removeTrack(this.jAudio);

        }).then(() => {
            this.jAudio = null;

        }).catch(ex => {
            // Reconnect
            this.initJitsi();
            throw ex;

        }).catch(net.promiseFail());

        return this.jPromise;
    }

    // Set our UserMediaVideo track
    jitsiSetUserMediaVideo(retries = 2): Promise<unknown> {
        if (config.useRecordOnly) {
            // Don't transmit video when we're in record-only mode
            return Promise.all([]);
        }
        if (!video.userMediaVideo)
            return Promise.all([]);

        // If we already had one, remove it
        this.jitsiUnsetUserMediaVideo();

        // Then add the new one
        this.jPromise = this.jPromise.then(() => {
            this.jVideo = new JitsiMeetJS.JitsiLocalTrack({
                deviceId: video.userMediaVideo.id,
                rtcId: video.userMediaVideo.id + ":" + (this.jCounter++),
                mediaType: "video",
                videoType: video.userMediaVideoType,
                stream: video.userMediaVideo,
                track: video.userMediaVideo.getVideoTracks()[0]
            });
            return this.room.addTrack(this.jVideo);

        }).then(() => {
            // And prepare to remove it
            util.events.addEventListener("usermediavideostopped", () => this.jitsiUnsetUserMediaVideo(), {once: true});

        }).catch(() => {
            if (retries) {
                setTimeout(() => {
                    this.jitsiSetUserMediaVideo(retries - 1);
                }, 1000);
            } else {
                net.promiseFail();
            }
        });

        return this.jPromise;
    }

    // Unset our UserMediaVideo track
    jitsiUnsetUserMediaVideo(): Promise<unknown> {
        this.jPromise = this.jPromise.then(() => {
            if (!this.jVideo)
                return;
            return this.room.removeTrack(this.jVideo);

        }).then(() => {
            this.jVideo = null;

        }).catch(net.promiseFail());

        return this.jPromise;
    }

    // Get an Ennuicastr user ID from a Jitsi track
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    getUserIdFromTrack(track: any): number {
        return this.getUserIdFromJid(track.getParticipantId());
    }

    // Get an Ennuicastr user ID from a Jitsi ID
    getUserIdFromJid(jid: string): number {
        let user: any = null;
        const parts: any[] = this.room.getParticipants();
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
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    jitsiTrackAdded(track: any): void {
        if (track.isLocal()) return;
        const stream: MediaStream = track.getOriginalStream();
        const type: string = track.getType();

        // Get the user
        const id = this.getUserIdFromTrack(track);
        const jid = track.getParticipantId();
        if (!(id in this.jitsiPeers))
            this.assertJitsiPeer(id, jid);

        const inc = this.jitsiPeers[id];
        (<any> inc)[type] = track;

        // Make sure they have a video element
        ui.videoAdd(id, null);

        // Set this in the appropriate element
        const el: HTMLMediaElement = (<any> ui.ui.video.users[id])[type];
        el.srcObject = stream;
        if (el.paused)
            el.play().catch(net.promiseFail());

        if (type === "video") {
            // Hide the standin
            ui.ui.video.users[id].standin.style.display = "none";
            ui.ui.video.users[id].video.style.display = "";

            // Prepare for it to end (which shouldn't have to be here...)
            const t = stream.getVideoTracks()[0];
            if (t) {
                t.addEventListener("ended", () => this.jitsiTrackRemoved(track));
            }
        }

        // Create the compressor node
        if (type === "audio") {
            if (outproc.supported) {
                outproc.createCompressor(
                    id, audio.ac, stream,
                    ui.ui.video.users[id].waveformWrapper
                );
            } else {
                const mss = audio.ac.createMediaStreamSource(stream);
                mss.connect((<any> audio.ac).ecDestination);
            }
        }

        // If they're the major, ask for higher quality
        if (ui.ui.video.major === id)
            this.setMajor(id);
    }

    // Called when a remote track is removed
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    jitsiTrackRemoved(track: any): void {
        if (track.isLocal()) return;
        const type: string = track.getType();

        // Get the user
        const id = this.getUserIdFromTrack(track);
        if (!(id in this.jitsiPeers))
            return;
        const inc = this.jitsiPeers[id];

        // If this isn't even their current track, ignore it
        if ((<any> inc)[type] !== track)
            return;
        (<any> inc)[type] = null;
        if (!inc.audio && !inc.video)
            delete this.jitsiPeers[id];

        // Remove it from the UI
        if (ui.ui.video.users[id]) {
            const el: HTMLMediaElement = (<any> ui.ui.video.users[id])[type];
            el.srcObject = null;

            // Show the standin if applicable
            if (type === "video") {
                ui.ui.video.users[id].standin.style.display = "";
                ui.ui.video.users[id].video.style.display = "none";
            }
        }

        // And destroy the compressor
        if (type === "audio")
            outproc.destroyCompressor(id);
    }

    // Called when a user joins
    jitsiUserJoined(jid: string): void {
        // Get the user
        const id = this.getUserIdFromJid(jid);
        if (!(id in this.jitsiPeers))
            this.assertJitsiPeer(id, jid);

        // Initial "connection". Tell them our current speech status.
        this.speech(vad.vads[0].vadOn);
    }

    // Incoming Jitsi end-to-end messages
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    jitsiMessage(user: any, jmsg: any): void {
        if (jmsg.type !== "ennuicastr")
            return;

        // Get the peer number
        const jid: string = user.getId();
        const peer = +user.getDisplayName();
        if (Number.isNaN(peer))
            return;
        this.assertJitsiPeer(peer, jid);

        if (typeof jmsg.ec !== "string")
            return;

        // Turn it back into raw data
        const ec = jmsg.ec;
        const buf = new Uint8Array(ec.length);
        for (let i = 0; i < buf.length; i++)
            buf[i] = ec.charCodeAt(i);
        const msg = new DataView(buf.buffer);

        this.peerMessage(peer, msg);
    }

    // Incoming broadcast messages
    peerMessage(peer: number, msg: DataView): void {
        if (msg.byteLength < 4)
            return;
        const cmd = msg.getUint32(0, true);

        // Process the command
        switch (cmd) {
            case prot.ids.caption:
            {
                // Incoming caption
                const p = prot.parts.caption.cc;
                if (msg.byteLength < p.length) return;
                const append = !!msg.getUint8(p.append);
                const complete = !!msg.getUint8(p.complete);
                try {
                    const text = util.decodeText(new Uint8Array(msg.buffer).subarray(p.text));
                    ui.caption(peer, text, append, complete);
                } catch (ex) {}
                break;
            }

            case prot.ids.speech:
            {
                // Speech status
                const p = prot.parts.speech;
                if (msg.byteLength < p.length) return;
                const status = !!msg.getUint32(p.indexStatus, true);
                util.dispatchEvent("ui.speech", {user: peer, status: status});
                break;
            }
        }
    }

    // Send a Jitsi message with retries
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    sendJitsiMsg(msg: any, retries?: number): void {
        if (typeof retries === "undefined")
            retries = 10;

        try {
            if (Object.keys(this.jitsiPeers).length > 0)
                this.room.broadcastEndpointMessage(msg);
        } catch (ex) {
            if (retries) {
                setTimeout(() => {
                    this.sendJitsiMsg(msg, retries-1);
                }, 1000);
            } else {
                // Reconnect
                this.initJitsi();
                throw ex;
            }
        }
    }

    // Send an Ennuicastr broadcast message over Jitsi
    broadcast(msg: Uint8Array): void {
        if (!this.room)
            return;

        // Convert the message to a string (gross)
        const msga: string[] = [];
        for (let i = 0; i < msg.length; i++)
            msga.push(String.fromCharCode(msg[i]));
        const msgs = msga.join("");
        const msgj = {type: "ennuicastr", ec: msgs};

        // Broadcast it
        this.sendJitsiMsg(msgj);
    }

    // Close a given peer's RTC connection
    closeRTC(peer: number): void {
        // Even if they're still on RTC, this should be considered catastrophic
        if (!(peer in this.jitsiPeers))
            return;
        const inc = this.jitsiPeers[peer];
        if (inc.video)
            this.jitsiTrackRemoved(inc.video);
        if (inc.audio)
            this.jitsiTrackRemoved(inc.audio);
        delete this.jitsiPeers[peer];
    }

    // Send a speech message over RTC
    speech(status: boolean): void {
        // Build the message
        const p = prot.parts.speech;
        const msgv = new DataView(new ArrayBuffer(p.length));
        msgv.setUint32(0, prot.ids.speech, true);
        msgv.setUint32(p.indexStatus, status?1:0, true);
        const msg = new Uint8Array(msgv.buffer);

        // Send it
        this.broadcast(msg);
    }

    // Last sent caption
    lastCaption = "";

    // Send a caption over RTC
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

    // Set the "major" (primary speaker) for video quality
    setMajor(peer: number): void {
        if (!(peer in this.jitsiPeers) || !this.room)
            return;
        const jid = this.jitsiPeers[peer].id;

        if (peer < 0) {
            // No primary = everyone is primary!
            this.room.setReceiverConstraints({
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
            this.room.setReceiverConstraints({
                lastN: 64,
                selectedEndpoints: [jid],
                onStageEndpoints: [jid],
                defaultConstraints: { maxHeight: 360 },
                constraints: constraints
            });

        }
    }
}
