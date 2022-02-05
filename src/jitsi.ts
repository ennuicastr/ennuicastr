/*
 * Copyright (c) 2018-2022 Yahweasel
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
import * as videoRecord from "./video-record";

import * as wsp from "web-streams-polyfill/ponyfill";

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

// If we're a video recording receiver, the buffer for each user
interface VideoRecIncoming {
    nextIdx: number;
    buf: {idx: number, buf: Uint8Array}[];
    notify: () => void;
    hardStop: boolean;
    softStop: boolean;
}

export class Jitsi extends comm.DataComms {
    // Jitsi features according to the server
    jitsiFeatures = {
        disableSimulcast: false,
        disableP2P: false
    };

    // The comm mode we were initialized with
    commModes: comm.CommModes;

    // Host which has indicated that it's willing to receive video recordings
    videoRecHost = -1;

    // Jitsi connection
    connection: any;

    // Jitsi "room"
    room: any;

    // Promises for adding and removing tracks to/from Jitsi
    jPromise: Promise<unknown> = Promise.all([]);

    // Jitsi tracks need a unique ID. Use this as a counter to generate them.
    jCounter = 0;

    // Jitsi outgoing audio track
    jAudio: any;

    // Jitsi outgoing video track
    jVideo: any;

    // Jitsi peers
    jitsiPeers: Record<number, JitsiPeer> = {};

    // Incoming video data
    videoRecIncoming: Record<number, VideoRecIncoming> = {};

    // Assert that a Jitsi peer exists
    assertJitsiPeer(id: number, jid: string) {
        if (this.jitsiPeers[id])
            return this.jitsiPeers[id];

        const ret = this.jitsiPeers[id] = {
            id: jid,
            audio: <any> null,
            video: <any> null,
            rtc: <RTCPeerConnection> null,
            data: <RTCDataChannel> null,
            signal: <(msg:any)=>unknown> null,
            rtcReady: false
        };

        // Once we know they exist, we start trying to connect via RTC as well
        this.startRTC(id, ret);

        return ret;
    }

    // Initialize the Jitsi subsystem
    override async init(opts: comm.CommModes) {
        // We initialize Jitsi once we know our own ID
        if (!net.selfId) {
            util.events.addEventListener("net.info." + prot.info.id, () => {
                this.init(opts);
            });
            return;
        }

        this.commModes = opts;
        const ret = this.initJitsi();

        // And reinitialize if Jitsi features change
        util.events.addEventListener("net.info." + prot.info.jitsi, (ev: CustomEvent) => {
            const msg = new Uint8Array(ev.detail.msg.buffer);
            const p = prot.parts.info;
            const jitsiStr = util.decodeText(msg.slice(p.value));
            const jitsiF: any = JSON.parse(jitsiStr);
            if (!!jitsiF.disableSimulcast !== this.jitsiFeatures.disableSimulcast ||
                !!jitsiF.disableP2P !== this.jitsiFeatures.disableP2P) {
                this.jitsiFeatures.disableSimulcast = !!jitsiF.disableSimulcast;
                this.jitsiFeatures.disableP2P = !!jitsiF.disableP2P;
                this.jPromise = this.jPromise.then(() => {
                    if (this.room)
                        this.initJitsi();
                });
            }
        });

        // Incoming CTCP messages
        util.events.addEventListener("net.dataSock." + prot.ids.ctcp, (ev: CustomEvent) => this.incomingCTCP(ev));

        // Disconnections
        util.events.addEventListener("net.info." + prot.info.peerLost, (ev: CustomEvent) => {
            if (config.useRTC)
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

       // Prepare to receive RTC negotiation messages
       util.events.addEventListener("net.dataSock." + prot.ids.rtc, (ev: CustomEvent) => {
           if (config.useRTC) {
               // Get out the important part
               const p = prot.parts.rtc;
               const peer = ev.detail.getUint32(p.peer, true);

               if (!(peer in this.jitsiPeers))
                   return;
               const j = this.jitsiPeers[peer];
               if (!j.signal)
                   return;

               try {
                   const tmsg = util.decodeText((new Uint8Array(ev.detail.buffer)).subarray(p.value));
                   const msg = JSON.parse(tmsg);
                   j.signal(msg);
               } catch (ex) {}
           }
       });
    }

    // Initialize the Jitsi connection
    initJitsi() {
        if (!audio.userMediaRTC) {
            // Wait until we have audio
            util.events.addEventListener("usermediartcready", () => this.initJitsi(), {once: true});
            return;
        }

        let timeout: number = null;
        this.jPromise = this.jPromise.then(() => {
            if (typeof JitsiMeetJS === "undefined")
                return util.loadLibrary("libs/jquery.min.js");

        }).then(() => {
            if (typeof JitsiMeetJS === "undefined")
                return util.loadLibrary("libs/lib-jitsi-meet.min.js");

        }).then(() => {
            // Get rid of any old Jitsi instance. First, clear tracks.
            for (const id of Object.keys(this.jitsiPeers)) {
                const inc: JitsiPeer = (<any> this.jitsiPeers)[id];
                if (inc.video)
                    this.jitsiTrackRemoved(inc.video);
                if (inc.audio)
                    this.jitsiTrackRemoved(inc.audio);
                if (!inc.rtcReady) {
                    try {
                        inc.rtc.close();
                    } catch (ex) {}
                    delete (<any> this.jitsiPeers)[id];
                }
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
            const initDict: any = {
                disableAudioLevels: true,
                disableSimulcast: this.jitsiFeatures.disableSimulcast
            };
            if (this.jitsiFeatures.disableSimulcast)
                initDict.preferredCodec = "h264";
            JitsiMeetJS.init(initDict);

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
                const roomNm = config.config.id.toString(36) + "_" + config.config.key.toString(36) +
                    (this.jitsiFeatures.disableSimulcast ? "_nosc" : "") +
                    (this.jitsiFeatures.disableP2P ? "_nop2p" : "");
                this.room = this.connection.initJitsiConference(roomNm, {
                    openBridgeChannel: true,
                    p2p: {
                        enabled: !this.jitsiFeatures.disableP2P
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
        return this.jPromise;
    }


    // Set our UserMediaRTC track
    jitsiSetUserMediaRTC(retries = 2) {
        if (!audio.userMediaRTC)
            return Promise.all([]);

        // If we already had one, remove it
        this.jitsiUnsetUserMediaRTC();

        // Then add the new one
        this.jPromise = this.jPromise.then(() => {
            // Make and add the new one
            this.jAudio = new JitsiMeetJS.JitsiLocalTrack({
                deviceId: audio.userMediaRTC.id,
                rtcId: audio.userMediaRTC.id + ":" + (this.jCounter++),
                mediaType: "audio",
                stream: audio.userMediaRTC,
                track: audio.userMediaRTC.getAudioTracks()[0]
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
    jitsiUnsetUserMediaRTC() {
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
    jitsiSetUserMediaVideo(retries = 2) {
        if (config.useRecordOnly) {
            // Don't transmit video when we're in record-only mode
            return;
        }
        if (!video.userMediaVideo)
            return;

        // If we already had one, remove it
        this.jitsiUnsetUserMediaVideo();

        // Then add the new one
        this.jPromise = this.jPromise.then(() => {
            this.jVideo = new JitsiMeetJS.JitsiLocalTrack({
                deviceId: video.userMediaVideo.id,
                rtcId: video.userMediaVideo.id + ":" + (this.jCounter++),
                mediaType: "video",
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
    jitsiUnsetUserMediaVideo() {
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
    getUserIdFromTrack(track: any) {
        return this.getUserIdFromJid(track.getParticipantId());
    }

    // Get an Ennuicastr user ID from a Jitsi ID
    getUserIdFromJid(jid: string) {
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
    jitsiTrackAdded(track: any) {
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

        // Hide the standin if applicable
        if (type === "video")
            ui.ui.video.users[id].standin.style.display = "none";

        // Create the compressor node
        if (type === "audio")
            outproc.createCompressor(id, audio.ac, stream, ui.ui.video.users[id].waveformWrapper);

        // If they're the major, ask for higher quality
        if (ui.ui.video.major === id)
            this.setMajor(id);
    }

    // Called when a remote track is removed
    jitsiTrackRemoved(track: any) {
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
        if (type === "video" && this.videoRecIncoming[id]) {
            const vr = this.videoRecIncoming[id];
            vr.hardStop = true;
            if (vr.notify)
                vr.notify();
            delete this.videoRecIncoming[id];
        }
        if (!inc.audio && !inc.video && !inc.rtcReady) {
            try {
                inc.rtc.close();
            } catch (ex) {}
            delete this.jitsiPeers[id];
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

    // Called when a user joins
    jitsiUserJoined(jid: string) {
        // Get the user
        const id = this.getUserIdFromJid(jid);
        if (!(id in this.jitsiPeers))
            this.assertJitsiPeer(id, jid);

        /* Initial "connection". Tell them our current speech status and if
         * we're the recording host. */
        this.speech(vad.vadOn, id);
        if ("master" in config.config) {
            this.videoRecSend(id, prot.videoRec.videoRecHost, ~~ui.ui.panels.master.acceptRemoteVideo.checked);
        }
    }

    // Incoming Jitsi end-to-end messages
    jitsiMessage(user: any, jmsg: any) {
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

        return this.peerMessage(peer, msg);
    }

    // Incoming CTCP messages
    incomingCTCP(ev: CustomEvent) {
        // Get out the important part
        const p = prot.parts.ctcp;
        const peer = ev.detail.getUint32(p.peer, true);
        const u8 = new Uint8Array(ev.detail.buffer);
        const msg = new DataView(u8.slice(p.msg).buffer);
        this.peerMessage(peer, msg);
    }

    // Incoming RTC or CTCP end-to-end messages
    peerMessage(peer: number, msg: DataView) {
        if (msg.byteLength < 4)
            return;
        const cmd = msg.getUint32(0, true);

        // Process the command
        switch (cmd) {
            case prot.ids.data:
                try {
                    const vr = this.videoRecIncoming[peer];
                    const idx = msg.getFloat64(4, true);
                    const buf = new Uint8Array(msg.buffer).subarray(12);
                    vr.buf.push({idx, buf});
                    if (vr.buf.length >= 1024) {
                        // Too much buffered data!
                        vr.hardStop = true;
                        delete this.videoRecIncoming[peer];
                    }
                    if (vr.notify)
                        vr.notify();
                } catch (ex) {}
                break;

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
                            this.videoRecHost = peer; // FIXME: Deal with disconnections
                        else if (this.videoRecHost === peer)
                            this.videoRecHost = -1;
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

                            // Make an incoming stream
                            const vri = this.videoRecIncoming[peer] = {
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
                            this.videoRecSend(peer, prot.videoRec.startVideoRecRes, 1);

                        } else {
                            this.videoRecSend(peer, prot.videoRec.startVideoRecRes, 0);

                        }
                        break;

                    case pv.startVideoRecRes:
                        // Only if we actually *wanted* them to accept video!
                        if (videoRecord.recordVideoRemoteOK && peer === this.videoRecHost)
                            videoRecord.recordVideoRemoteOK(peer);
                        break;

                    case pv.endVideoRec:
                        try {
                            // FIXME: Jitsi has no ordering guarantee, so this may be done at the wrong time!
                            const vr = this.videoRecIncoming[peer];
                            vr.softStop = true;
                            if (vr.notify)
                                vr.notify();
                            delete this.videoRecIncoming[peer];
                        } catch (ex) {}
                        break;
                }
                break;
            }
        }
    }

    // Send a Jitsi message with retries
    sendJitsiMsg(jid: string, msg: any, retries?: number) {
        if (typeof retries === "undefined")
            retries = 10;

        try {
            if (jid === null) {
                if (Object.keys(this.jitsiPeers).length > 0)
                    this.room.broadcastEndpointMessage(msg);
            } else {
                this.room.sendEndpointMessage(jid, msg);
            }
        } catch (ex) {
            if (retries) {
                setTimeout(() => {
                    this.sendJitsiMsg(jid, msg, retries-1);
                }, 1000);
            } else {
                // Reconnect
                this.initJitsi();
                throw ex;
            }
        }
    }

    // Send an Ennuicastr message over CTCP, Jitsi (broadcast only), or RTC
    sendMsg(msg: Uint8Array, peer?: number) {
        if (!this.room)
            return;

        // Get the target ID
        let inc: JitsiPeer = null;
        let jid: string = null;
        if (typeof peer !== "undefined") {
            if (!(peer in this.jitsiPeers))
                return;
            inc = this.jitsiPeers[peer];
            jid = inc.id;
        }

        // If we can, send it directly
        if (inc && inc.rtcReady) {
            inc.data.send(msg.buffer);
            return;
        }

        // Otherwise, we'll send it via CTCP or the bridge

        if (typeof peer !== "undefined") {
            const p = prot.parts.ctcp;
            const cmsg = new DataView(new ArrayBuffer(p.length + msg.length));
            cmsg.setUint32(0, prot.ids.ctcp, true);
            cmsg.setUint32(p.peer, peer, true);
            (new Uint8Array(cmsg.buffer)).set(msg, p.msg);
            net.dataSock.send(cmsg.buffer);

        } else {
            // Convert the message to a string (gross)
            const msga: string[] = [];
            for (let i = 0; i < msg.length; i++)
                msga.push(String.fromCharCode(msg[i]));
            const msgs = msga.join("");
            const msgj = {type: "ennuicastr", ec: msgs};

            // Send it to the peer or broadcast it to all peers
            this.sendJitsiMsg(jid, msgj);
        }
    }

    override getVideoRecHost() {
        return this.videoRecHost;
    }

    // Send a video recording subcommand to a peer
    override videoRecSend(peer: number, cmd: number, payloadData?: unknown): void {
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
        this.sendMsg(new Uint8Array(msg.buffer), peer);
    }

    // Close a given peer's RTC connection
    closeRTC(peer: number) {
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
    speech(status: boolean, peer?: number): void {
        if (!config.useRTC)
            return;

        // Build the message
        const p = prot.parts.speech;
        const msgv = new DataView(new ArrayBuffer(p.length));
        msgv.setUint32(0, prot.ids.speech, true);
        msgv.setUint32(p.indexStatus, status?1:0, true);
        const msg = new Uint8Array(msgv.buffer);

        // Send it
        this.sendMsg(msg, peer);
    }

    // Last sent caption
    lastCaption = "";

    // Send a caption over RTC
    caption(complete: boolean, text: string) {
        if (!config.useRTC)
            return;

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
        this.sendMsg(new Uint8Array(msg.buffer));
    }

    // Send a chunk of video data to a peer
    override videoDataSend(peer: number, idx: number, buf: Uint8Array): void {
        // Send 16k at a time
        for (let start = 0; start < buf.length; start += 16380) {
            const part = buf.subarray(start, start + 16380);
            const msg = new DataView(new ArrayBuffer(12 + part.length));
            msg.setUint32(0, prot.ids.data, true);
            msg.setFloat64(4, idx + start, true);
            new Uint8Array(msg.buffer).set(part, 12);
            this.sendMsg(new Uint8Array(msg.buffer), peer);
        }
    }

    // Set the "major" (primary speaker) for video quality
    setMajor(peer: number) {
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


    // Send an RTC negotiation message
    sendRTCNegotiation(peer: number, cont: any) {
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
    startRTC(id: number, j: JitsiPeer) {
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
                this.peerMessage(id, msg);
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

            if (this.jitsiPeers[id] === j && !j.audio && !j.video) {
                // There's nothing left
                delete this.jitsiPeers[id];
            }
        };

        onnegotiationneeded();
    }
}
