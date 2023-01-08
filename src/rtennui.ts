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
 * Support for RTEnnui communications.
 */

import * as audio from "./audio";
import * as avloader from "./avloader";
import * as capture from "./capture";
import * as comm from "./comm";
import * as config from "./config";
import * as net from "./net";
import * as outproc from "./outproc";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as vad from "./vad";

import * as rtennui from "rtennui";
import * as wcp from "libavjs-webcodecs-polyfill";

// Make our polyfill the global one
declare let LibAVWebCodecs: typeof wcp;
// eslint-disable-next-line @typescript-eslint/no-unused-vars, prefer-const
LibAVWebCodecs = wcp;

// Has the RTEnnui library been initialized?
let inited = false;

/**
 * Our own custom playback class that can perform our output processing.
 */
class OutProcAudioPlayback extends rtennui.AudioPlayback {
    constructor(public ac: AudioContext) {
        super();
        const worker = this.worker = new Worker(capture.workerPath);
        this.port = null;
    }

    override play(data: Float32Array[]): void {
        if (!this.port) {
            // Init the worker
            const mc = new MessageChannel();
            this.port = mc.port1;
            this.worker.postMessage({
                c: "outproc",
                inSampleRate: this.ac.sampleRate,
                port: mc.port2
            }, [mc.port2]);
        }
        this.port.postMessage(data);
    }

    override pipeFrom(port: MessagePort): void {
        this.worker.postMessage({
            c: "outproc",
            inSampleRate: this.ac.sampleRate,
            port
        }, [port]);
    }

    override channels(): number {
        // FIXME
        return 1;
    }

    override close(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    /**
     * The worker this data is being redirected to.
     */
    worker: Worker;

    /**
     * The port to communicate with the worker. Initialized on the first
     * message, if needed.
     */
    port: MessagePort;
}

export class RTEnnui implements comm.Comms {
    // Communication modes
    commModes: comm.CommModes;

    // RTEnnui connection
    connection: rtennui.Connection = null;

    // RTEnnui audio capture for our current audio device
    cap: rtennui.AudioCapture = null;

    // Map of RTEnnui IDs to our own peer IDs
    idMap: Record<number, number> = null;

    // The shared node, if there is one
    shared: AudioNode = null;

    // A timer used to turn off the VAD, to avoid short hiccups
    vadOffTimer: number | null = null;

    // Initialize the RTEnnui connection
    async init(opts: comm.CommModes): Promise<void> {
        // We initialize RTEnnui once we know our own ID
        if (!net.selfId) {
            util.events.addEventListener("net.info." + prot.info.id, () => {
                this.init(opts);
            }, {once: true});
            return;
        }

        // The way VAD works with RTEnnui is muting the capture device
        util.events.addEventListener("vad.rtc", () => {
            if (!this.cap)
                return;
            if (vad.vads[0].rtcVadOn) {
                this.cap.setVADState("yes");
                if (this.vadOffTimer) {
                    clearTimeout(this.vadOffTimer);
                    this.vadOffTimer = null;
                }

            } else {
                if (!this.vadOffTimer) {
                    this.vadOffTimer = setTimeout(() => {
                        this.cap.setVADState("no");
                        this.vadOffTimer = null;
                    }, 200);
                }

            }
        });

        this.commModes = opts;
        await this.initRTEnnui();
    }

    // Initialize RTEnnui
    async initRTEnnui(): Promise<void> {
        if (!audio.inputs[0].userMediaCapture) {
            // Wait until we have audio
            util.events.addEventListener("usermediartcready", () => this.initRTEnnui(), {once: true});
            return;
        }

        if (!inited) {
            await avloader.loadLibAV();
            await wcp.load();
            await rtennui.load();
            inited = true;
        }

        // Destroy any old connection
        if (this.connection)
            this.connection.disconnect();

        // Create our connection
        const c = this.connection =
            new rtennui.Connection(audio.ac, {
                createAudioPlayback: async (ac) => new OutProcAudioPlayback(ac)
            });
        this.idMap = Object.create(null);

        // Prepare for events
        c.on("disconnected", ev => {
            if (c !== this.connection)
                return;

            // This is catastrophic!
            config.disconnect();
        });

        c.on("peer-joined", ev => {
            if (c !== this.connection)
                return;
            this.idMap[ev.id] = ev.info.uid;
        });

        c.on("peer-left", ev => {
            if (c !== this.connection)
                return;
            delete this.idMap[ev.id];
        });

        c.on("track-started-audio", ev => {
            if (c !== this.connection)
                return;
            if (!(ev.peer in this.idMap))
                return;

            this.rteTrackStarted(this.idMap[ev.peer], ev.playback);
        });

        c.on("track-ended-audio", ev => {
            if (c !== this.connection)
                return;
            if (!(ev.peer in this.idMap))
                return;

            this.rteTrackEnded(this.idMap[ev.peer]);
        });

        c.on("*", ev => {
            let str: string;
            try {
                str = JSON.stringify(ev);
            } catch (ex) {
                str = "" + ev;
            }
            console.log(str);
        });

        // Connect
        const connected = await new Promise<boolean>((res) => {
            let timeout = setTimeout(() => {
                timeout = null;
                res(false);
            }, 30000);

            c.connect(config.rtennuiUrl, {
                id: config.config.id,
                key: config.config.key,
                uid: net.selfId
            }).then(ret => {
                if (timeout) {
                    clearTimeout(timeout);
                    res(ret);
                } else {
                    if (ret)
                        c.disconnect();
                    res(false);
                }
            });
        });
        if (!connected) {
            this.connection = null;
            return;
        }

        // And add our track
        if (this.commModes.audio) {
            this.rteAddAudioTrack();
            util.events.addEventListener("usermediartcready", () => this.rteAddAudioTrack());
        }
    }

    // Called to add our audio track
    async rteAddAudioTrack(): Promise<void> {
        if (this.cap) {
            // End the old capture
            this.cap.close();
            await this.connection.removeAudioTrack(this.cap);
        }

        this.cap = audio.inputs[0].userMediaCapture.capture;
        this.connection.addAudioTrack(this.cap /*, {frameSize: 5000}*/);
        /* NOTE: Due to a bug somewhere in RTEnnui or LibAV.js, setting the
         * frame size above doesn't actually work. */

        // Set the VAD state
        this.cap.setVADState(vad.vads[0].rtcVadOn ? "yes" : "no");
    }

    // Called when a remote track is added
    rteTrackStarted(id: number, playback: rtennui.AudioPlayback): void {
        // Make sure they have a video element
        ui.videoAdd(id, null);

        if (!(playback instanceof OutProcAudioPlayback)) {
            // This should never happen!
            // FIXME
            console.error("Incorrect node!");
            let node = playback.unsharedNode();

            if (node) {
                // Set this in the appropriate element
                const el: HTMLMediaElement = <any> ui.ui.video.users[id].audio;
                const msd = audio.ac.createMediaStreamDestination();
                node.connect(msd);
                el.srcObject = msd.stream;
                if (el.paused)
                    el.play().catch(net.promiseFail());

                /*
                // Hide the standin if applicable
                if (type === "video")
                    ui.ui.video.users[id].standin.style.display = "none";
                */

                // Create the compressor node
                outproc.createCompressor(id, audio.ac, msd.stream,
                    ui.ui.video.users[id].waveformWrapper);

            } else if (!this.shared) {
                // Shared node, just let it go
                this.shared = playback.sharedNode();

            }

        } else {
            const oppb = <OutProcAudioPlayback> playback;

            // Create the compressor node
            outproc.createCompressor(id, audio.ac, oppb.worker,
                ui.ui.video.users[id].waveformWrapper);

        }
    }

    // Called when a remote track is removed
    rteTrackEnded(id: number): void {
        // FIXME: If this isn't even their current track, ignore it

        // Remove it from the UI
        if (ui.ui.video.users[id]) {
            const el: HTMLMediaElement = ui.ui.video.users[id].audio;
            el.srcObject = null;

            /*
            // Show the standin if applicable
            if (type === "video")
                ui.ui.video.users[id].standin.style.display = "";
            */
        }

        // And destroy the compressor
        outproc.destroyCompressor(id);
    }
}
