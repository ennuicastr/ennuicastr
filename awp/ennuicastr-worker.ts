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

declare var LibAV: any, NoiseRepellent: any, NoiseRepellentFactory: any, WebRtcVad: any, __filename: string;

// FIXME: More duplication
// Number of milliseconds to run the VAD for before/after talking
const vadExtension = 2000;

// Similar, for RTC transmission
const rtcVadExtension = 250;

onmessage = function(ev) {
    var msg = ev.data;
    switch (msg.c) {
        case "encoder":
            doEncoder(msg);
            break;

        case "filter":
            doFilter(msg);
            break;
    }
}

// Encode with libav
function doEncoder(msg) {
    var inPort: MessagePort = msg.port;
    var inSampleRate: number = msg.inSampleRate || 48000;
    var outSampleRate: number = msg.outSampleRate || 48000;
    var format: string = msg.format || "opus";
    var channelLayout: number = msg.channelLayout || 4;
    var channelCount: number = msg.channelCount || 1;
    var p: Promise<unknown> = Promise.all([]);
    var pts = 0;

    var libav: any;
    var encOptions: any = {
        sample_rate: outSampleRate,
        frame_size: outSampleRate * 20 / 1000,
        channel_layout: 4,
        channels: 1
    };

    var codec, c, frame, pkt;
    var filter_graph, buffersrc_ctx, buffersink_ctx;

    // Load libav
    LibAV = {nolibavworker: true, base: "../libav"};
    __filename = "../libav/libav-2.3.4.3.1-ennuicastr.js"; // To "trick" wasm loading
    importScripts(__filename);
    return LibAV.LibAV({noworker: true}).then(la => {
        libav = la;

        if (format === "flac") {
            encOptions.sample_fmt = libav.AV_SAMPLE_FMT_S32;
        } else {
            encOptions.sample_fmt = libav.AV_SAMPLE_FMT_FLT;
            encOptions.bit_rate = 128000;
        }

        // Create the encoder
        return libav.ff_init_encoder((format==="flac")?"flac":"libopus", encOptions, 1, outSampleRate);

    }).then(ret => {
        codec = ret[0];
        c = ret[1];
        frame = ret[2];
        pkt = ret[3];
        encOptions.frame_size = ret[4];

        // Create the filter
        return libav.ff_init_filter_graph("aresample", {
            sample_rate: inSampleRate,
            sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
            channels: channelCount,
            channel_layout: channelLayout
        }, {
            sample_rate: encOptions.sample_rate,
            sample_fmt: encOptions.sample_fmt,
            channel_layout: 4,
            frame_size: encOptions.frame_size
        });

    }).then(ret => {
        filter_graph = ret[0];
        buffersrc_ctx = ret[1];
        buffersink_ctx = ret[2];

        // Now we're prepared for input
        inPort.onmessage = onmessage;

    }).catch(console.error);

    function onmessage(ev: MessageEvent) {
        // Put it in libav format
        var msg = ev.data;
        var data = msg.d;
        if (data.length === 0 || data[0].length === 0) return;
        while (data.length < channelCount)
            data = data.concat(data);
        var frames = [{
            data: data,
            channels: channelCount,
            channel_layout: channelLayout,
            format: libav.AV_SAMPLE_FMT_FLTP,
            pts: pts,
            sample_rate: inSampleRate
        }];
        pts += data[0].length;

        p = p.then(() => {
            // Filter
            return libav.ff_filter_multi(buffersrc_ctx, buffersink_ctx, frame, frames);

        }).then(frames => {
            // Encode
            if (frames.length === 0)
                return [];
            return libav.ff_encode_multi(c, frame, pkt, frames);

        }).then(encPackets => {
            if (encPackets.length === 0)
                return;

            // They only need the raw data
            var packets = [];
            for (var pi = 0; pi < encPackets.length; pi++)
                packets.push(encPackets[pi].data);

            // Send the encoded packets to the *host*
            var end = Date.now();
            postMessage({c: "packets", t: end - msg.t, d: packets});

        }).catch(console.error);
    }
}

// Do a live filter
function doFilter(msg) {
    // FIXME: Massive duplication

    // Get out our info
    let inPort: MessagePort = msg.port;
    let sampleRate: number = msg.sampleRate;
    let useNR: boolean = msg.useNR;
    let sentRecently: boolean = msg.sentRecently;

    // Let them update it
    onmessage = function(ev) {
        let msg = ev.data;
        if (msg.c !== "state") return;
        useNR = msg.useNR;
        sentRecently = msg.sentRecently;
    };

    // State for transfer to the host
    let rawVadOn: boolean = false;
    let rtcVadOn: boolean = false;
    let vadOn: boolean = false;
    let max: number = 0; 
    let maxCtr: number = 0;

    // Libraries
    let m: any = null;
    let nr: any = null;
    let handle: any = null;
    const bufSz = 640 /* 20ms at 32000Hz */;
    let dataPtr: number = null;
    let buf: Int16Array = null;
    let bi: number = 0;
    let timeout: null|number = null, rtcTimeout: null|number = null;
    let step = sampleRate / 32000;

    /* WebRTC VAD is pretty finicky, so also keep track of volume as a
     * secondary gate */
    let triggerVadCeil = 0, triggerVadFloor = 0;
    let curVadVolume = 0;
    let lastVolume = 0, curVolume = 0;
    let vi = 0;

    // Load everything
    Promise.all([]).then(function() {
        // Load the VAD
        __filename = "../vad/vad-m.wasm.js";
        importScripts(__filename);
        return WebRtcVad();

    }).then(function(ret: any) {
        m = ret;

        // Create our WebRTC vad
        handle = m.Create();
        if (handle === 0) {
            postMessage({c: "log", i: "failvad", m: "Failed to create VAD."});
            throw new Error();
        }
        if (m.Init(handle) < 0) {
            postMessage({c: "log", i: "failvad", m: "Failed to initialize VAD."});
            throw new Error();
        }

        dataPtr = m.malloc(bufSz * 2);
        buf = new Int16Array(m.heap.buffer, dataPtr, bufSz * 2);
        m.set_mode(3);

        // And load noise-repellent
        __filename = "../noise-repellent/noise-repellent-m.wasm.js";
        importScripts(__filename);
        NoiseRepellent = {NoiseRepellentFactory: NoiseRepellentFactory};
        __filename = "../noise-repellent/noise-repellent-m.js";
        importScripts(__filename);
        return NoiseRepellent.NoiseRepellent(sampleRate);

    }).then(function(ret: any) {
        nr = ret;
        nr.set(NoiseRepellent.N_ADAPTIVE, 1);
        nr.set(NoiseRepellent.AMOUNT, 20);
        nr.set(NoiseRepellent.WHITENING, 50);

        // Now we're ready to receive messages
        inPort.onmessage = onInMessage;

    }).catch(console.error);

    function onInMessage(ev: MessageEvent) {
        let msg = ev.data;
        let data = msg.d;
        if (data.length === 0 || data[0].length === 0) return;

        // Merge together the channels
        let ib = data[0];
        let cc = data.length;
        if (cc !== 1) {
            ib = ib.slice(0);

            // Mix it
            for (let i = 1; i < cc; i++) {
                let ibc = data[i];
                for (let j = 0; j < ib.length; j++)
                    ib[j] += ibc[j];
            }

            // Then temper it
            for (let i = 0; i < ib.length; i++)
                ib[i] /= cc;
        }


        // Perform noise reduction and output
        let nrbuf = ib;
        if (nr) {
            let ob = ib;
            nrbuf = nr.run(ib);
            if (useNR)
                ob = nrbuf;
            let od = [];
            if (!sentRecently) {
                ob = ob.slice(0);
                ob.fill(0);
            }
            while (od.length < data.length)
                od.push(ob.slice(0));
            inPort.postMessage({c: "data", d: od});
        }


        // Transfer data for the VAD
        let vadSet = rawVadOn;
        for (let i = 0; i < ib.length; i += step) {
            let v = nrbuf[~~i];
            let a = Math.abs(v);
            curVolume += a;
            curVadVolume += a;

            buf[bi++] = v * 0x7FFF;
            if (++vi >= 1024) {
                lastVolume = curVolume;
                curVolume = 0;
                vi = 0;
            }

            if (bi == bufSz) {
                // We have a complete packet
                vadSet = !!m.Process(handle, 32000, dataPtr, bufSz);
                bi = 0;

                if (vadSet) {
                    // Adjust the trigger value quickly up or slowly down
                    let triggerTarget = curVadVolume/bufSz;
                    if (triggerTarget > triggerVadCeil) {
                        triggerVadCeil = triggerTarget;
                    } else {
                        triggerVadCeil = (
                            triggerVadCeil * 1023 +
                            triggerTarget
                        ) / 1024;
                    }
                } else {
                    let triggerTarget = curVadVolume/bufSz*2;
                    triggerVadFloor = (
                        triggerVadFloor * 511 +
                        triggerTarget
                    ) / 512;
                }
                curVadVolume = 0;
            }
        }

        // Gate the VAD by volume
        if (vadSet) {
            let relVolume = lastVolume/ib.length;
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
    }
}
