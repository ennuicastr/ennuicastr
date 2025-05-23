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

import type * as LibAVT from "libav.js";

import type * as LibSpecBleachT from "@ennuicastr/libspecbleach.js";

import type * as WebRtcAec3T from "@ennuicastr/webrtcaec3.js";

declare let window: any;
const global: any = (() => {
    if (typeof globalThis !== "undefined")
        return globalThis;
    else if (typeof self !== "undefined")
        return self;
    else
        return window;
})();

const libavVersion = "5.4.6.1.1";
const libavPath = "../libav/libav-" + libavVersion + "-ennuicastr.js";

const webRtcAec3Version = "0.3.0";
const webRtcAec3Path = "../libs/webrtcaec3-" + webRtcAec3Version + ".js";

const webRtcVadPath = "../libs/webrtcvad.js";

const libspecbleachVersion = "0.1.7-js2";
const libspecbleachPath = "../libs/libspecbleach-" + libspecbleachVersion + ".js";

// SAB is unreliable on Safari
const canShared = typeof SharedArrayBuffer !== "undefined" &&
    (navigator.userAgent.indexOf("Safari") === -1 ||
     navigator.userAgent.indexOf("Chrome") !== -1);
const bufSz = 96000;

const voskModelVersion = "en-us-0.15";
const voskModelPath = "../libs/vosk-model-small-" + voskModelVersion + ".tar.gz";

// Number of milliseconds to run the VAD for before/after talking
const vadExtension = 2000;

// Similar, for RTC transmission
const rtcVadExtension = 1000;

// Code for an atomic waiter, which simply informs us whenever the write head changes
const waitWorkerCode = `
onmessage = function(ev) {
    var buf = ev.data;
    var prevVal = Atomics.load(buf, 0);
    while (Atomics.wait(buf, 0, prevVal)) {
        var ts = Date.now();
        var newVal = Atomics.load(buf, 0);
        if (prevVal !== newVal) {
            postMessage([ts, prevVal, newVal]);
            prevVal = newVal;
        }
    }
};
`;

// Handler for data from the capture
class InHandler {
    // If we're using shared buffers, these are set
    incoming: Float32Array[];
    incomingH: Int32Array;
    waitWorker: Worker;

    constructor(
        /**
         * Input port.
         */
        public port: MessagePort,

        /**
         * Function to call when data is received.
         */
        public ondata: (ts: number, data: Float32Array[]) => unknown
    ) {
        port.onmessage = this.onmessage.bind(this);
    }

    /**
     * Handler for captured data.
     */
    onmessage(ev: MessageEvent) {
        const msg = ev.data;

        if (msg.length) {
            // Raw data
            this.ondata(Date.now(), msg);

        } else if (msg.c === "buffers") {
            // Input buffers
            const incoming = this.incoming = msg.buffers;
            this.incomingH = msg.head;

            // Create a worker to inform us when we have incoming data
            const ww = this.waitWorker =
                new Worker("data:application/javascript," +
                    encodeURIComponent(waitWorkerCode));
            ww.onmessage = ev => {
                const [ts, start, end]: [number, number, number] = ev.data;

                // Make sure there's a memory fence in this thread
                Atomics.load(this.incomingH, 0);

                if (end < start) {
                    // We wrapped around. Make it one message.
                    const len = end - start + incoming[0].length;
                    const brk = incoming[0].length - start;
                    const buf: Float32Array[] = [];
                    for (let i = 0; i < incoming.length; i++) {
                        const sbuf = new Float32Array(len);
                        sbuf.set(incoming[i].subarray(start), 0);
                        sbuf.set(incoming[i].subarray(0, end), brk);
                        buf.push(sbuf);
                    }
                    this.ondata(ts, buf);

                } else {
                    // Simple case
                    this.ondata(ts, incoming.map(x => x.slice(start, end)));

                }
            };

            // Start it up
            ww.postMessage(this.incomingH);

            return;

        }
    }
}

/**
 * Output handler.
 */
class OutHandler {
    constructor(
        /**
         * The message port targeting this receiver.
         */
        public port: MessagePort,

        /**
         * Use shared buffers if possible.
         */
        public tryShared: boolean = true
    ) {
        this.outgoing = null;
        this.outgoingH = null;
    }

    /**
     * Send this data.
     * @param data  The data itself.
     */
    send(data: Float32Array[]) {
        const len = data[0].length;

        if (canShared && this.tryShared && !this.outgoing) {
            // Set up our shared memory buffer
            this.outgoing = [];
            for (let ci = 0; ci < data.length; ci++) {
                this.outgoing.push(
                    new Float32Array(
                        new SharedArrayBuffer(bufSz * 4)
                    )
                );
            }
            this.outgoingH = new Int32Array(new SharedArrayBuffer(4));

            // Tell them about the buffers
            this.port.postMessage({
                c: "buffers",
                buffers: this.outgoing,
                head: this.outgoingH
            });
        }

        if (canShared && this.tryShared) {
            // Write it into the buffer
            let writeHead = this.outgoingH[0];
            if (writeHead + len > bufSz) {
                // We wrap around
                const brk = bufSz - writeHead;
                for (let i = 0; i < this.outgoing.length; i++) {
                    this.outgoing[i].set(data[i%data.length].subarray(0, brk), writeHead);
                    this.outgoing[i].set(data[i%data.length].subarray(brk), 0);
                }
            } else {
                // Simple case
                for (let i = 0; i < this.outgoing.length; i++)
                    this.outgoing[i].set(data[i%data.length], writeHead);
            }
            writeHead = (writeHead + len) % bufSz;
            Atomics.store(this.outgoingH, 0, writeHead);

            // Notify the worker
            Atomics.notify(this.outgoingH, 0);

        } else {
            // Just send the data. Minimize allocation by sending plain.
            this.port.postMessage(data);

        }
    }

    /**
     * The outgoing data, if shared.
     */
    private outgoing: Float32Array[];

    /**
     * The write head, if shared.
     */
    private outgoingH: Int32Array;
}

// Our output handlers
const outHandlers: OutHandler[] = [];

// Our initial message tells us what kind of worker to be
onmessage = function(ev) {
    const msg = ev.data;
    switch (msg.c) {
        case "encoder":
            doEncoder(msg);
            break;

        case "filter":
            doFilter(msg);
            break;

        case "outproc":
            doOutproc(msg);
            break;

        case "out":
        {
            let tryShared = true;
            if (typeof msg.tryShared === "boolean")
                tryShared = msg.tryShared;
            outHandlers.push(new OutHandler(msg.p, tryShared));
            break;
        }
    }
}

// Encode with libav
function doEncoder(msg: any) {
    const inPort: MessagePort = msg.port;
    const inSampleRate: number = msg.inSampleRate || 48000;
    const outSampleRate: number = msg.outSampleRate || 48000;
    const format: string = msg.format || "opus";

    let channel: number = (typeof msg.channel === "number") ? msg.channel : -1;
    let outputChannelLayout: number = (typeof msg.outputChannelLayout === "number") ? msg.outputChannelLayout : 4;

    // Run once for each requested track
    const tracks: number[] = msg.backChannelTracks || [];
    encoderTrack(inPort, 0);
    for (let bci = 0; bci < tracks.length; bci++)
        encoderTrack(msg.backChannels[bci], tracks[bci]);

    async function encoderTrack(port: MessagePort, trackNo: number) {
        let p: Promise<unknown> = Promise.all([]);
        let pts = 0;
        let seq = 0;

        let libav: LibAVT.LibAV;

        let c: number, frame: number, pkt: number;
        let channelCount = -1;
        let channelLayout = 0;
        let filterGraph = 0;
        let buffersrc_ctx = 0, buffersink_ctx = 0;

        // Load libav
        global.LibAV = <any> {nolibavworker: true, base: "../libav"};
        global.__filename = libavPath; // To "trick" wasm loading
        importScripts(global.__filename);

        libav = await global.LibAV.LibAV({noworker: true});

        const encOptions: LibAVT.AVCodecContextProps = {
            sample_rate: outSampleRate,
            frame_size: outSampleRate * 20 / 1000,
            channel_layout: outputChannelLayout,
            sample_fmt: libav.AV_SAMPLE_FMT_FLT
        };

        if (format === "flac") {
            encOptions.sample_fmt = libav.AV_SAMPLE_FMT_S32;
        } else {
            encOptions.bit_rate = 128000;
        }

        // Create the encoder
        [, c, frame, pkt, encOptions.frame_size] = await libav.ff_init_encoder(
            (format==="flac")?"flac":"libopus", <any> {
                ctx: encOptions,
                time_base: [1, outSampleRate]
            });

        // Now we're prepared for input
        new InHandler(port, ondata);

        function ondata(ts: number, data: Float32Array[]) {
            if (channelCount !== data.length) {
                // Reinitialize with the correct channel count
                if (filterGraph) {
                    libav.avfilter_graph_free_js(filterGraph);
                    filterGraph = 0;
                }

                channelCount = data.length;
                channelLayout = 4;
                if (channelCount > 1)
                    channelLayout = Math.pow(2, channelCount) - 1;

                // Create the filter in the background
                (async () => {
                    [filterGraph, buffersrc_ctx, buffersink_ctx] =
                        await libav.ff_init_filter_graph("anull", {
                            sample_rate: inSampleRate,
                            sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
                            channel_layout: channelLayout
                        }, {
                            sample_rate: encOptions.sample_rate,
                            sample_fmt: encOptions.sample_fmt,
                            channel_layout: outputChannelLayout,
                            frame_size: encOptions.frame_size
                        });
                })();
            }

            if (!filterGraph) {
                // Filter graph not yet initialized
                return;
            }

            // Put it in libav format
            if (channel >= 0 && data.length > channel)
                data = [data[channel]];
            while (data.length < channelCount)
                data = data.concat(data);
            const frames = [{
                data: data,
                channels: channelCount,
                channel_layout: channelLayout,
                format: libav.AV_SAMPLE_FMT_FLTP,
                pts: pts,
                sample_rate: inSampleRate
            }];
            pts += data[0].length;

            p = p.then(async () => {
                // Filter
                const filterFrames = await libav.ff_filter_multi(
                    buffersrc_ctx, buffersink_ctx, frame, frames
                );
                if (filterFrames.length === 0)
                    return;

                // Encode
                const encPackets = await libav.ff_encode_multi(
                    c, frame, pkt, filterFrames
                );
                if (encPackets.length === 0)
                    return;

                // They only need the raw data
                const packets: Uint8Array[] = [];
                for (let pi = 0; pi < encPackets.length; pi++)
                    packets.push(encPackets[pi].data);

                // Send the encoded packets to the *host*
                postMessage({
                    c: "packets",
                    t: Date.now() - ts,
                    ts: ts,
                    s: seq,
                    track: trackNo,
                    d: packets
                });
                seq += packets.length;

            }).catch(console.error);
        }
    }
}

// Do a live filter
async function doFilter(msg: any) {
    let inHandler: InHandler;
    let renderHandler: InHandler;

    // Get out our info
    const inPort: MessagePort = msg.port;
    const renderPort: MessagePort = msg.backChannels[0];
    const sampleRate: number = msg.inSampleRate;
    const renderSampleRate: number = msg.renderSampleRate;
    let useEC: boolean = msg.useEC;
    let useNR: boolean = msg.useNR;
    let sentRecently: boolean = msg.sentRecently;
    let lastVadSensitivity: number = msg.vadSensitivity;
    let vadSensitivity: number = msg.vadSensitivity;
    let vadNoiseGate: number = msg.vadNoiseGate;
    let vadNoiseGateLvl = Math.pow(10, vadNoiseGate / 20);
    const useTranscription: boolean = msg.useTranscription;
    let channel: number = (typeof msg.channel === "number") ? msg.channel : -1;

    // Let them update it
    addEventListener("message", ev => {
        const msg = ev.data;
        if (msg.c === "state") {
            useEC = msg.useEC;
            useNR = msg.useNR;
            sentRecently = msg.sentRecently;
            vadSensitivity = msg.vadSensitivity;
            vadNoiseGate = msg.vadNoiseGate;
            vadNoiseGateLvl = Math.pow(10, vadNoiseGate / 20);

        } else if (msg.c === "ecdata") {
            // A port to shuttle echo-cancelled data
            aec3OutHandler = new OutHandler(msg.port, true);

        }
    });

    // State for transfer to the host
    let rawVadLvl = 0;
    let rawVadOn = false;
    let rtcVadOn = false;
    let vadOn = false;
    let max = 0;
    let maxCtr = 0;

    // Libraries
    let vad: any = null;
    let vadHandleLo: number = null, vadHandleHi: number = null;
    let vadDataPtr: number = null;
    const vadBufSz = 640 /* 20ms at 32000Hz */;
    let vadBuf: Int16Array = null;
    let bi = 0;
    let AEC3: WebRtcAec3T.WebRtcAec3 = null,
        aec3: WebRtcAec3T.AEC3 = null,
        aec3Opts: WebRtcAec3T.AEC3ProcessOpts = null;
    const aec3AnalyzeOpts = {sampleRateIn: renderSampleRate};
    let aec3Output: Float32Array;
    let aec3OutHandler: OutHandler = null;
    let SpecBleach: LibSpecBleachT.LibSpecBleach = null,
        specBleach: LibSpecBleachT.LibSpecBleachOO = null;
    let specBleachBufSize: number = 0;
    let nroutput: Float32Array;
    let timeout: null|number = null, rtcTimeout: null|number = null;
    const step = sampleRate / 32000;

    const vosk = {
        model: <any> null,
        recognizer: <any> null,
        inSamples: 0,
        inTime: 0,
        outTime: 0
    };

    /* WebRTC VAD is pretty finicky, so also keep track of volume as a
     * secondary gate */
    let triggerVadCeil = 0, triggerVadFloor = 0;
    let curVadVolume = 0, curVadPeak = 0;
    let lastVolume = 0, lastPeak = 0;

    // Load the VAD
    global.__filename = webRtcVadPath;
    importScripts(global.__filename);
    vad = await global.WebRtcVad();

    // Create our WebRTC vad
    function mkVad(lvl) {
        let vadHandle: number = vad.Create();
        if (vadHandle === 0) {
            postMessage({c: "log", i: "failvad", m: "Failed to create VAD."});
            throw new Error();
        }
        if (vad.Init(vadHandle) < 0) {
            postMessage({c: "log", i: "failvad", m: "Failed to initialize VAD."});
            throw new Error();
        }
        vad.set_mode(vadHandle, lvl);
        return vadHandle;
    }
    vadHandleLo = mkVad(vadSensitivity);
    lastVadSensitivity = vadSensitivity;
    vadHandleHi = mkVad(3);

    vadDataPtr = vad.malloc(vadBufSz * 2);
    vadBuf = new Int16Array(vad.HEAPU8.buffer, vadDataPtr, vadBufSz * 2);

    // Load echo cancellation
    global.__filename = webRtcAec3Path;
    importScripts(global.__filename);
    AEC3 = await global.WebRtcAec3();

    // And load libspecbleach
    global.LibSpecBleach = <any> {base: "../libs"};
    global.__filename = libspecbleachPath;
    importScripts(global.__filename);
    SpecBleach = await global.LibSpecBleach.LibSpecBleach();

    // Possibly load Vosk
    if (useTranscription) {
        global.__filename = "../libs/vosk.js?v=3";
        importScripts(global.__filename);
    }

    // If we loaded Vosk, it can finish loading in the background
    if (useTranscription)
        loadVosk();

    // Now we're ready to receive messages
    inHandler = new InHandler(inPort, ondata);
    renderHandler = new InHandler(renderPort, onRenderData);

    // Load the Vosk model in the background
    async function loadVosk() {
        const model = await global.Vosk.createModel(voskModelPath);

        vosk.model = model;
        vosk.recognizer = new vosk.model.KaldiRecognizer(sampleRate);
        vosk.recognizer.setWords(true);

        vosk.recognizer.on("partialresult", msg => {
            voskResult(msg, false);
        });
        vosk.recognizer.on("result", msg => {
            voskResult(msg, true);
        });
    }

    // Called when we receive real data
    function ondata(ts: number, data: Float32Array[]) {
        // Merge together the channels
        let ib: Float32Array;
        if (channel >= 0 && data.length > channel) {
            // Just one channel
            ib = data[channel];

        } else {
            // Possibly multiple channels
            ib = data[0];
            const cc = data.length;
            if (cc !== 1) {
                // Mix it
                for (let i = 1; i < cc; i++) {
                    const ibc = data[i];
                    for (let j = 0; j < ib.length; j++)
                        ib[j] += ibc[j];
                }

                // Then temper it
                for (let i = 0; i < ib.length; i++)
                    ib[i] /= cc;
            }

        }


        // Perform echo cancellation
        let ecbuf = ib;
        if (AEC3 && !aec3) {
            aec3 = new AEC3.AEC3(48000, 1, 1);
            aec3Opts = {
                sampleRateIn: sampleRate,
                sampleRateOut: sampleRate
            };
        }
        if (aec3) {
            const aec3In = [ib];
            const sz = aec3.processSize(aec3In, aec3Opts);
            if (sz && (!aec3Output || aec3Output.length !== sz))
                aec3Output = new Float32Array(sz);
            aec3.process([aec3Output], aec3In, aec3Opts);
            if (sz)
                ecbuf = aec3Output;
            else
                ecbuf = new Float32Array(0);
        }

        // Output the echo cancel on its own port
        if (aec3OutHandler)
            aec3OutHandler.send([ecbuf]);

        let nrin = ecbuf;
        if (!useEC && useNR) {
            /* If we're actually using the noise-reduced output but not using
             * the echo-cancelled output, we can't use the echo cancellation as
             * input, or we'd need to noise-reduce in a separate step. */
            nrin = ib;
        }

        // Choose an appropriate buffer size for noise reduction
        if (!specBleachBufSize ||
            nrin.length % specBleachBufSize !== 0) {
            if (aec3 && nrin === ecbuf) {
                specBleachBufSize = ~~(sampleRate / 100);
                if (nrin.length &&
                    nrin.length % specBleachBufSize !== 0)
                    specBleachBufSize = nrin.length;
            } else {
                specBleachBufSize = nrin.length;
            }
        }

        // Perform noise reduction
        let nrbuf = nrin;
        if (SpecBleach &&
            (!specBleach ||
             specBleach.input_buffer.length !== specBleachBufSize)) {
            // NR instance is out of date or nonexistent, make a new one
            if (specBleach)
                specBleach.free();
            specBleach = new SpecBleach.SpecBleach({
                adaptive: true,
                block_size: specBleachBufSize,
                sample_rate: sampleRate,
                reduction_amount: 20,
                whitening_factor: 50
            });
        }
        if (specBleach) {
            if (!nroutput || nroutput.length < nrin.length)
                nroutput = new Float32Array(nrin.length);
            for (let i = 0; i < nrin.length; i += specBleachBufSize) {
                specBleach.process(
                    nrin.subarray(i, i + specBleachBufSize),
                    nroutput.subarray(i, i + specBleachBufSize)
                );
            }
            nrbuf = nroutput.subarray(0, nrin.length);
        }

        // Transfer data for the VAD
        let vadLvl = rawVadLvl;
        let vadSet = rawVadOn;
        for (let i = 0; i < nrbuf.length; i += step) {
            const v = nrbuf[~~i];
            const a = Math.abs(v);
            curVadVolume += a;
            if (a > curVadPeak)
                curVadPeak = a;

            vadBuf[bi++] = v * 0x7FFF;

            if (bi == vadBufSz) {
                // Make sure our VAD sensitivity is right
                if (lastVadSensitivity !== vadSensitivity) {
                    vad.set_mode(vadHandleLo, vadSensitivity);
                    lastVadSensitivity = vadSensitivity;
                }

                // We have a complete packet
                rawVadLvl = vadLvl =
                    vad.Process(vadHandleLo, 32000, vadDataPtr, vadBufSz) +
                    vad.Process(vadHandleHi, 32000, vadDataPtr, vadBufSz);
                vadSet = !!vadLvl;
                bi = 0;

                if (vadLvl === 2) {
                    // Adjust the trigger value quickly up or slowly down
                    const triggerTarget = curVadVolume/vadBufSz;
                    if (triggerTarget > triggerVadCeil) {
                        triggerVadCeil = triggerTarget;
                    } else {
                        triggerVadCeil = (
                            triggerVadCeil * 1023 +
                            triggerTarget
                        ) / 1024;
                    }
                } else if (vadLvl === 0) {
                    // Adjust the floor
                    const triggerTarget = curVadVolume/vadBufSz*2;
                    triggerVadFloor = (
                        triggerVadFloor * 511 +
                        triggerTarget
                    ) / 512;
                }
                lastVolume = curVadVolume;
                curVadVolume = 0;
                lastPeak = curVadPeak;
                curVadPeak = 0;
            }
        }

        // Gate the VAD by volume if it's not confident
        if (vadSet && (vadLvl < 2 || vadSensitivity >= 3)) {
            const relVolume = lastVolume/vadBufSz;
            vadSet = false;
            // We must be over the floor...
            if (relVolume >= triggerVadFloor) {
                // And at least 1/32nd way to the ceiling
                if (triggerVadCeil < triggerVadFloor*2 ||
                    relVolume - triggerVadFloor >= (triggerVadCeil - triggerVadFloor) / 32) {
                    vadSet = true;
                }
            }
        }

        // Apply the noise get if applicable
        if (vadSet && vadNoiseGate > -100) {
            if (lastPeak < vadNoiseGateLvl)
                vadSet = false;
        }

        // Possibly swap the VAD mode
        if (vadSet) {
            // Switch on the transmission VAD
            if (!rtcVadOn) {
                rtcVadOn = true;
            } else if (rtcTimeout) {
                clearTimeout(rtcTimeout);
                rtcTimeout = null;
            }

            // And the recording VAD
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            if (!rawVadOn) {
                // We flipped on
                rawVadOn = true;
                vadOn = true;
                curVadVolume = 0;
            }

        } else {
            if (rtcVadOn) {
                // Flip off after a second
                if (!rtcTimeout) {
                    rtcTimeout = setTimeout(function() {
                        rtcTimeout = null;
                        rtcVadOn = false;
                    }, rtcVadExtension);
                }
            }

            if (rawVadOn) {
                // Flip off after a while
                rawVadOn = false;
                if (!timeout) {
                    timeout = setTimeout(function() {
                        timeout = null;
                        vadOn = false;
                    }, vadExtension);
                }
            }
        }


        // Find the max for this input
        for (let i = 0; i < ib.length; i++) {
            let v = ib[i];
            if (v < 0) v = -v;
            if (v > max) max = v;
            if (++maxCtr >= 1024) {
                // Send a max count
                postMessage({c: "max", m: max});
                max = maxCtr = 0;
            }
        }

        // And send everything to the host
        postMessage({
            c: "state",
            rawVadOn: rawVadOn,
            rtcVadOn: rtcVadOn,
            vadOn: vadOn
        });

        {
            let ob = ib;
            if (useNR)
                ob = nrbuf;
            else if (useEC)
                ob = ecbuf;
            if (ob.length) {
                const od = [];
                if (!sentRecently) {
                    ob = ob.slice(0);
                    ob.fill(0);
                }
                while (od.length < data.length)
                    od.push(ob.slice(0));
                for (const outHandler of outHandlers)
                    outHandler.send(od);
            }
        }

        // Perform transcription
        if (useTranscription && vosk.recognizer) {
            vosk.inSamples += ib.length;
            vosk.inTime = vosk.inSamples / sampleRate;
            vosk.outTime = ts / 1000;
            vosk.recognizer.acceptWaveformFloat(ib, sampleRate);
        }
    }

    // Called when we receive render (output) data, for echo cancellation
    function onRenderData(ts: number, data: Float32Array[]) {
        if (aec3)
            aec3.analyze(data, aec3AnalyzeOpts);
    }

    // Handle a vosk result
    function voskResult(msg: any, complete: boolean) {
        // Ignore empty results
        const result = msg.result;
        if (complete && result.text === "")
            return;
        if (!complete && result.partial === "")
            return;

        if (result.result) {
            const offset = vosk.outTime - vosk.inTime;
            for (let i = 0; i < result.result.length; i++) {
                const word = result.result[i];
                word.start += offset;
                word.end += offset;
            }
        }

        // Send it to the host
        postMessage({
            c: "vosk",
            result: result,
            complete: complete
        });
    }
}

/**
 * Do output processing. Output processing involves looking for maximums (for
 * waveview), dynamic compression, and final gain.
 */
function doOutproc(msg: any) {
    let inHandler: InHandler;
    let doMax = false;
    let doCompress = false;
    let gain = 1;

    let max = 0, maxCtr = 0;
    const bufferMax = 8;
    let sentMax = 0;

    // Handle max/compress results ASAP
    addEventListener("message", ev => {
        const msg = ev.data;
        if (msg.c === "max")
            doMax = !!msg.a;
        else if (msg.c === "dynaudnorm")
            doCompress = !!msg.a;
        else if (msg.c === "gain")
            gain = msg.g;
    });

    // Tell the parent that outproc is ready for commands
    postMessage({c: "outproc-ready"});

    // Get out our info
    const inPort: MessagePort = msg.port;
    const sampleRate: number = msg.inSampleRate;

    let la: LibAVT.LibAV, frame: number, pts = 0;
    let buffersrc_ctx = 0, buffersink_ctx = 0;

    // Load libav in the background
    (async () => {
        global.LibAV = <any> {nolibavworker: true, base: "../libav"};
        global.__filename = libavPath; // To "trick" wasm loading
        importScripts(global.__filename);

        la = await global.LibAV.LibAV({noworker: true});
        frame = await la.av_frame_alloc();

        const ret =
            await la.ff_init_filter_graph("dynaudnorm=f=10:g=3", {
                sample_rate: sampleRate,
                sample_fmt: la.AV_SAMPLE_FMT_FLT,
                channel_layout: 4
            }, {
                sample_rate: sampleRate,
                sample_fmt: la.AV_SAMPLE_FMT_FLT,
                channel_layout: 4,
                frame_size: 128
            });

        buffersrc_ctx = ret[1];
        buffersink_ctx = ret[2];
    })();

    // Prepare to send the max even if we don't have data
    setInterval(() => {
        if (sentMax >= 0) {
            sentMax--;
            return;
        } else if (sentMax === 0) {
            // Now send the maxes, but really, send the whole buffer we missed
            for (let i = 1; i < bufferMax; i++)
                postMessage({c: "max", m: 0});
            sentMax--;
        }
        postMessage({c: "max", m: 0});
    }, 1024000 / sampleRate);

    // Now we're ready for input
    inHandler = new InHandler(inPort, ondata);

    async function ondata(ts: number, data: Float32Array[]) {
        // Handle input
        const ib = data[0];
        let ob = [data];

        if (doMax) {
            // Find the max
            for (let i = 0; i < ib.length; i++) {
                let v = ib[i];
                if (v < 0) v = -v;
                if (v > max) max = v;
                if (++maxCtr >= 1024) {
                    // Send a max count
                    postMessage({c: "max", m: max});
                    sentMax = bufferMax;
                    max = maxCtr = 0;
                }
            }
        }

        if (doCompress && buffersink_ctx) {
            // Run it through the compressor
            const inFrames: LibAVT.Frame[] = [{
                data: <any> ib,
                channels: 1,
                channel_layout: 4,
                format: la.AV_SAMPLE_FMT_FLT,
                pts: pts,
                sample_rate: sampleRate
            }];
            pts += ib.length;

            const frames = await la.ff_filter_multi(
                buffersrc_ctx, buffersink_ctx, frame, inFrames, false);

            ob = [];
            for (let fi = 0; fi < frames.length; fi++) {
                const frame = [<any> frames[fi].data];
                while (frame.length < data.length)
                    frame.push(frame[0]);
                ob.push(frame);
            }
        }

        if (gain !== 1) {
            // Apply gain
            for (const frame of ob) {
                for (const channel of frame) {
                    for (let i = 0; i < channel.length; i++)
                        channel[i] *= gain;
                }
            }
        }

        // Send it out
        for (const outHandler of outHandlers) {
            for (const frame of ob)
                outHandler.send(frame);
        }
    }
}
