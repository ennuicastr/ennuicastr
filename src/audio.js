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

/* The starting point for enabling encoding. Get our microphone input. Returns
 * a promise that resolves when encoding is active. */
function getMic(deviceId) {
    if (!connected)
        return;

    pushStatus("getmic", "Asking for microphone permission...");
    popStatus("conn");

    // First get rid of any active sources
    if (userMedia) {
        userMedia.getTracks().forEach(function(track) { track.stop(); });
        userMedia = null;
        if (userMediaRTC) {
            // FIXME: Really need to properly destroy the whole chain
            userMediaRTC.getTracks().forEach(function(track) { track.stop(); });
            userMediaRTC = null;
        }
        userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediastopped", {}));
    }

    // Then request the new ones
    return navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: deviceId,
            autoGainControl: plzno,
            echoCancellation: plzno,
            noiseSuppression: plzno,
            sampleRate: {ideal: 48000},
            sampleSize: {ideal: 24}
        }
    }).then(function(userMediaIn) {
        userMedia = userMediaIn;
        return userMediaSet();
    }).catch(function(err) {
        disconnect();
        pushStatus("fail", "Cannot get microphone: " + err);
        popStatus("getmic");
    });
}

/* Called once we have mic access. Returns a promise that resolves once
 * encoding is active. */
function userMediaSet() {
    if (!connected)
        return;

    updateMuteButton();
    loadPTT();

    pushStatus("initenc", "Initializing encoder...");
    popStatus("getmic");

    // Get the sample rate from the user media
    var sampleRate = userMedia.getAudioTracks()[0].getSettings().sampleRate;

    // Check whether we should be using WebAssembly
    var wa = isWebAssemblySupported();

    // Create our AudioContext if needed
    if (!ac) {
        try {
            ac = new AudioContext({sampleRate: sampleRate});
        } catch (ex) {
            // Try Apple's, and if not that, nothing left to try, so crash
            ac = new webkitAudioContext({sampleRate: sampleRate});
        }
    }

    // Now UserMedia and AudioContext are ready
    userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediaready", {}));

    return Promise.all([]).then(function() {
        /* On Safari on mobile devices, AudioContexts start paused, and sometimes
         * need to be unpaused directly in an event handler. Check if it's paused,
         * and unpause it either out of or in a button handler. */

        if (ac.state !== "running") {
            // Try to just activate it
            return ac.resume();
        }

    }).then(function() {
        if (ac.state !== "running") {
            return new Promise(function(res, rej) {
                // This browser won't let us resume an AudioContext outside of an event handler
                var btn = dce("button");
                btn.classList.add("plain");
                btn.style.position = "absolute";
                btn.style.left = "1%";
                btn.style.top = "1%";
                btn.style.width = "98%";
                btn.style.height = "98%";
                btn.innerText = "Begin recording audio";
                document.body.appendChild(btn);

                btn.onclick = function() {
                    ac.resume().then(res).catch(res);
                    document.body.removeChild(btn);
                };
            });
        }

    }).then(function() {
        if (ac.state !== "running")
            pushStatus("audiocontext", "Cannot capture audio! State: " + ac.state);

        // Set up the VAD
        if (typeof WebRtcVad === "undefined") {
            WebRtcVad = {
                onRuntimeInitialized: localProcessing
            };
            loadLibrary("vad/vad" + (wa?".wasm":"") + ".js");
        }

        // Which solution we need depends on browser support
        useLibAV = false;
        useMkvDemux = false;
        if (useFlac || !Blob.prototype.arrayBuffer) {
            // Always need libav for this
            useLibAV = true;

        } else if (typeof MediaRecorder === "undefined") {
            // No built-in encoding
            useLibAV = true;

        } else {
            // We'll need resampling, but let's not trust the OS to do it
            if (sampleRate !== 48000) {
                useLibAV = true;

            } else if (!MediaRecorder.isTypeSupported("audio/ogg; codecs=opus")) {
                // We'll need at least demuxing
                /* FIXME: This seems to be causing memory issues on Chrome, so use
                 * libav */
                /*if (MediaRecorder.isTypeSupported("audio/webm; codecs=opus")) {
                    useMkvDemux = true;
                } else {*/
                    useLibAV = true;
                //}

            } else {
                // No extras needed, raw ogg/opus extracting
                useLibAV = true;

            }

        }

        // At this point, we want to start catching errors
        window.addEventListener("error", function(error) {
            errorHandler(error.error + "\n\n" + error.error.stack);
        });

        window.addEventListener("unhandledrejection", function(error) {
            error = error.reason;
            if (error instanceof Error) {
                errorHandler(error + "\n\n" + error.stack);
            } else {
                var msg;
                try {
                    msg = JSON.stringify(error);
                } catch (ex) {
                    msg = error+"";
                }
                msg += "\n\n" + new Error().stack;
                errorHandler(msg);
            }
        });

        // Load anything we need
        if (useLibAV) {
            return loadLibAV();
        } else if (useMkvDemux) {
            if (typeof mkvdemuxjs === "undefined")
                return loadLibrary("mkvdemux.min.js");
        } else {
            // Nothing to load!
        }
    }).then(encoderLoaded);
}

// Load LibAV if it's not already loaded
function loadLibAV() {
    if (libav) {
        // Already loaded
        return Promise.all([]);
    }

    if (typeof LibAV === "undefined")
        LibAV = {};
    LibAV.base = "libav";

    return loadLibrary("libav/libav-" + libavVersion + "-webm-opus-flac.js").then(function() {
        return LibAV.LibAV();

    }).then(function(ret) {
        libav = ret;

    });
}

/* Called once the specialized encoder is loaded, if it's needed. Returns a
 * promise that resolves once encoding is active. */
function encoderLoaded() {
    if (!connected)
        return;

    pushStatus("startenc", "Starting encoder...");
    popStatus("initenc");

    if (useLibAV) {
        return libavStart();

    } else {
        // We'll use the built-in encoder
        var format = "ogg";
        var handler = handleOggData;
        if (useMkvDemux) {
            format = "webm";
            handler = handleMkvData;
            mkvDemuxer = new mkvdemuxjs.MkvDemux();
        }

        // We're ready to record, but need a handler for the Blob->ArrayBuffer conversion
        function postBlob(ab) {
            blobs.shift();
            if (blobs.length)
                blobs[0].arrayBuffer().then(postBlob);
            if (ab.byteLength !== 0) {
                data.push(ab);
                handler(performance.now());
            }
        }

        // MediaRecorder will do what we need
        mediaRecorder = new MediaRecorder(userMedia, {
            mimeType: "audio/" + format + "; codecs=opus",
            audioBitsPerSecond: 128000
        });
        mediaRecorder.addEventListener("dataavailable", function(chunk) {
            blobs.push(chunk.data);
            if (blobs.length === 1)
                chunk.data.arrayBuffer().then(postBlob);
        });
        startTime = performance.now();
        mediaRecorder.start(200);

        return Promise.all([]);

    }
}

// Start the libav encoder
function libavStart() {
    // We need to choose our target sample rate based on the input sample rate and format
    sampleRate = 48000;
    if (useFlac && ac.sampleRate === 44100)
        sampleRate = 44100;

    // Figure out if we need a custom AudioContext, due to sample rate differences
    var umSampleRate = userMedia.getAudioTracks()[0].getSettings().sampleRate;
    var needCustomAC = (umSampleRate !== ac.sampleRate) && (typeof AudioContext !== "undefined");

    // The server needs to be informed of FLAC's sample rate
    if (useFlac) {
        var p = prot.parts.info;
        var info = new DataView(new ArrayBuffer(p.length));
        info.setUint32(0, prot.ids.info, true);
        info.setUint32(p.key, prot.info.sampleRate, true);
        info.setUint32(p.value, sampleRate, true);
        dataSock.send(info.buffer);
    }

    // Set our zero packet as appropriate
    if (useFlac) {
        switch (sampleRate) {
            case 44100:
                zeroPacket = new Uint8Array([0xFF, 0xF8, 0x79, 0x0C, 0x00, 0x03, 0x71, 0x56, 0x00, 0x00, 0x00, 0x00, 0x63, 0xC5]);
                break;
            default:
                zeroPacket = new Uint8Array([0xFF, 0xF8, 0x7A, 0x0C, 0x00, 0x03, 0xBF, 0x94, 0x00, 0x00, 0x00, 0x00, 0xB1, 0xCA]);
        }
    }

    // Figure out our channel layout based on the number of channels
    var channelLayout = 4;
    var channelCount = ~~(userMedia.getAudioTracks()[0].getSettings().channelCount);
    switch (channelCount) {
        case 0:
        case 1:
            channelCount = 1;
            channelLayout = 4; // Mono
            break;
        case 2:
            channelLayout = 3; // Stereo
            break;
        default:
            // Just give a vaguely-sensible value
            channelLayout = Math.pow(2, channelCount) - 1;
    }

    // Determine our encoder options
    var encOptions = {
        sample_rate: sampleRate,
        frame_size: sampleRate * 20 / 1000,
        channel_layout: 4,
        channels: 1
    };
    if (useFlac) {
        encOptions.sample_fmt = libav.AV_SAMPLE_FMT_S32;
    } else {
        encOptions.sample_fmt = libav.AV_SAMPLE_FMT_FLT;
        encOptions.bit_rate = 128000;
    }

    // Make our custom AudioContext if needed
    var libavAC = needCustomAC ? new AudioContext({sampleRate: umSampleRate}) : ac;

    // Begin initializing the encoder
    libavEncoder = {ac: libavAC, input_channel_layout: channelLayout};
    return libav.ff_init_encoder(useFlac?"flac":"libopus", encOptions, 1, sampleRate).then(function(ret) {

        libavEncoder.codec = ret[0];
        libavEncoder.c = ret[1];
        libavEncoder.frame = ret[2];
        libavEncoder.pkt = ret[3];
        libavEncoder.frame_size = ret[4];

        // Now make the filter
        return libav.ff_init_filter_graph("aresample", {
            sample_rate: libavAC.sampleRate,
            sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
            channel_layout: channelLayout
        }, {
            sample_rate: encOptions.sample_rate,
            sample_fmt: encOptions.sample_fmt,
            channel_layout: 4,
            frame_size: libavEncoder.frame_size
        });

    }).then(function(ret) {
        libavEncoder.filter_graph = ret[0];
        libavEncoder.buffersrc_ctx = ret[1];
        libavEncoder.buffersink_ctx = ret[2];

        // We're ready to go!
        if (!startTime)
            startTime = performance.now();
        libavEncoder.p = Promise.all([]);

        // Start processing in the background
        libavProcess();

    }).catch(function(ex) {
        pushStatus("libaverr", "Encoding error: " + ex);
        errorHandler(ex);

        // This is sufficiently catastrophic that we should disconnect if it happens
        disconnect();

    });
}

// libav's actual per-chunk processing
function libavProcess() {
    var enc = libavEncoder;
    var pts = 0;
    var inSampleRate = enc.ac.sampleRate;

    // Keep track of how much data we've received to see if it's too little
    var dataReceived = 0;
    var pktCounter = [];
    var tooLittle = inSampleRate * 0.9;

    // And if our latency is too high
    enc.latency = 0;
    enc.latencyDump = false;

    // Start reading the input
    var sp = createScriptProcessor(enc.ac, userMedia, 16384 /* Max: Latency doesn't actually matter in this context */).scriptProcessor;

    // Don't try to process that last sip of data after termination
    var dead = false;

    sp.onaudioprocess = function(ev) {
        if (dead)
            return;

        // Determine the data timing
        var now = performance.now();
        var channelCount = ev.inputBuffer.numberOfChannels;
        var ib = new Array(channelCount);
        for (var ci = 0; ci < channelCount; ci++)
            ib[ci] = ev.inputBuffer.getChannelData(ci);
        var pktLen = (ib[0].length * 48000 / inSampleRate);
        var pktTime = Math.round(
            (now - startTime) * 48 -
            pktLen
        );

        // Count it
        var ctrStart = now - 1000;
        pktCounter.push([now, ib[0].length]);
        dataReceived += ib[0].length;
        if (pktCounter[0][0] < ctrStart) {
            while (pktCounter[0][0] < ctrStart) {
                dataReceived -= pktCounter[0][1];
                pktCounter.shift();
            }
            if (dataReceived < tooLittle) {
                pushStatus("toolittle", "Encoding is overloaded, incomplete audio data!");
            } else {
                popStatus("toolittle");
            }
        }

        // Check for latency
        if (enc.latency > 1000) {
            // Maybe report it
            if (enc.latency > 2000)
                pushStatus("latency", "Encoding is buffering. " + Math.ceil(enc.latency/1000) + " seconds of audio buffered.");

            // Choose whether to dump audio
            if (!enc.latencyDump)
                enc.latencyDump = (enc.latency > 1500);

            if (!vadOn && enc.latencyDump) {
                // VAD is off, so lose some data to try to eliminate latency
                enc.latency -= (pktLen/48);

                // Don't let the display get independently concerned about this
                lastSentTime = now;
                return;
            }
        } else {
            if (enc.latencyDump)
                enc.latencyDump = false;
            popStatus("latency");
        }

        // Put it in libav's format
        var frames = [{
            data: ib,
            channel_layout: libavEncoder.input_channel_layout,
            format: libav.AV_SAMPLE_FMT_FLTP,
            pts: pts,
            sample_rate: inSampleRate
        }];
        pts += ib[0].length;

        // Wait for any previous filtering
        enc.p = enc.p.then(function() {

            // Filter
            return libav.ff_filter_multi(enc.buffersrc_ctx, enc.buffersink_ctx, enc.frame, frames);

        }).then(function(frames) {
            // Encode
            return libav.ff_encode_multi(enc.c, enc.frame, enc.pkt, frames);

        }).then(function(encPackets) {
            // Now write these packets out
            for (var pi = 0; pi < encPackets.length; pi++) {
                packets.push([pktTime, new DataView(encPackets[pi].data.buffer)])
                pktTime += 960; // 20ms
            }
            handlePackets();

            // Look for latency problems
            enc.latency = performance.now() - now;

        }).catch(function(ex) {
            pushStatus("libaverr", "Encoding error: " + ex);
            errorHandler(ex);

            // This is sufficiently catastrophic that we should disconnect if it happens
            disconnect();

        });
    }

    // Terminate the recording
    function terminate() {
        if (dead)
            return;
        dead = true;

        // Terminate our custom AC if needed
        if (enc.ac !== ac)
            enc.ac.close();

        // Close the encoder
        enc.p = enc.p.then(function() {
            return libav.avfilter_graph_free_js(enc.filter_graph);

        }).then(function() {
            return libav.ff_free_encoder(enc.c, enc.frame, enc.pkt);

        });
    }

    // Catch when our UserMedia ends and stop (FIXME: race condition before reloading?)
    userMediaAvailableEvent.addEventListener("usermediastopped", terminate, {once: true});
    ac.addEventListener("disconnected", terminate);
    enc.ac.addEventListener("disconnected", terminate);
}

// Shift a chunk of blob from MediaRecorder
function shift(amt) {
    if (data.length === 0) return null;
    var chunk = data.shift();
    if (chunk.byteLength <= amt) return new DataView(chunk);

    // Shift off the portion they asked for
    var ret = chunk.slice(0, amt);
    chunk = chunk.slice(amt);
    data.unshift(chunk);
    return new DataView(ret);
}

// Unshift one or more chunks of blob from MediaRecorder
function unshift() {
    for (var i = arguments.length - 1; i >= 0; i--)
        data.unshift(arguments[i].buffer);
}

// Get the granule position from an Ogg header
function granulePosOf(header) {
    var granulePos =
        (header.getUint16(10, true) * 0x100000000) +
        (header.getUint32(6, true));
    return granulePos;
}

// Set the granule position in a header
function granulePosSet(header, to) {
    header.setUint16(10, (to / 0x100000000) & 0xFFFF, true);
    header.setUint32(6, to & 0xFFFFFFFF, true);
}

// "Demux" a single Opus frame that might be in multiple parts into multiple frames
function opusDemux(opusFrame) {
    var toc = opusFrame.getUint8(0);
    var ct = (toc & 0x3);
    toc &= 0xfc;
    if (ct === 0) {
        // No demuxing needed!
        return null;
    }
    opusFrame = new Uint8Array(opusFrame.buffer);

    // Reader for frame length coding
    var p = 1;
    function getFrameLen() {
        var len = opusFrame[p++];
        if (len >= 252) {
            // 2-byte length
            len += opusFrame[p++]*4;
        }
        return len;
    }

    // Switch on the style of multi-frame
    switch (ct) {
        case 1:
            // Two equal-sized frames
            var len = (opusFrame.byteLength - 1) / 2;
            var ret = [
                new Uint8Array(len + 1),
                new Uint8Array(len + 1)
            ];
            ret[0][0] = toc;
            ret[0].set(opusFrame.slice(1, 1+len), 1);
            ret[0] = new DataView(ret[0].buffer);
            ret[1][0] = toc;
            ret[1].set(opusFrame.slice(1+len), 1);
            ret[1] = new DataView(ret[1].buffer);
            return ret;

        case 2:
            // Two variable-sized frames
            var len = getFrameLen();
            var len2 = opusFrame.length - len - p;
            var ret = [
                new Uint8Array(len + 1),
                new Uint8Array(len2 + 1)
            ];
            ret[0][0] = toc;
            ret[0].set(opusFrame.slice(p, p+len), 1);
            ret[0] = new DataView(ret[0].buffer);
            ret[1][0] = toc;
            ret[1].set(opusFrame.slice(p+len), 1);
            ret[1] = new DataView(ret[1].buffer);
            return ret;

        case 3:
            // Variable-number variable-sized frames
            var frameCtB = opusFrame[p++];
            var frameCt = frameCtB & 0x3f;
            var padding = 0;
            if (frameCtB & 0x40) {
                // There's padding. Skip the count.
                while (true) {
                    var pa = opusFrame[p++];
                    if (pa === 0xFF) {
                        padding += 0xFE;
                    } else {
                        padding += pa;
                        break;
                    }
                }
            }

            // Get the sizes of each
            var sizes = [];
            if (frameCtB & 0x80) {
                // Variable-sized
                var tot = 0;
                for (var i = 0; i < frameCt - 1; i++) {
                    var len = getFrameLen();
                    tot += len;
                    sizes.push(len);
                }
                // The last one is whatever's left
                sizes.push(opusFrame.length - padding - p - tot);
            } else {
                // Constant-sized
                // FIXME
                var len = Math.floor((opusFrame.length - padding - p) / frameCt);
                for (var i = 0; i < frameCt; i++)
                    sizes.push(len);
            }

            // Now make the output
            var ret = [];
            for (var i = 0; i < frameCt; i++) {
                var len = sizes[i];
                var part = new Uint8Array(len + 1);
                part[0] = toc;
                part.set(opusFrame.slice(p, p+len), 1);
                p += len;
                ret.push(new DataView(part.buffer));
            }
            return ret;
    }
}

// Handle input Ogg data, splitting Ogg packets so we can fine-tune the granule position
function handleOggData(endTime) {
    var splitPackets = [];

    // First split the data into separate packets
    while (true) {
        // An Ogg header is 26 bytes
        var header = shift(26);
        if (!header || header.byteLength != 26) break;

        // Make sure this IS a header
        if (header.getUint32(0, true) !== 0x5367674F ||
            header.getUint8(4) !== 0) {
            // Catastrophe!
            break;
        }

        // Get our granule position now so we can adjust it if necessary
        var granulePos = granulePosOf(header);

        // The next byte tells us how many page segments to expect
        var pageSegmentsB = shift(1);
        if (!pageSegmentsB) {
            unshift(header);
            break;
        }
        var pageSegments = pageSegmentsB.getUint8(0);
        var segmentTableRaw = shift(pageSegments);
        if (!segmentTableRaw) {
            unshift(header, pageSegmentsB);
            break;
        }

        // Divide the segments into packets
        var segmentTable = [];
        var packetEnds = [];
        for (var i = 0; i < pageSegments; i++) {
            var segment = segmentTableRaw.getUint8(i);
            segmentTable.push(segment);
            if (segment < 255 || i === pageSegments - 1)
                packetEnds.push(i);
        }

        // Get out the packet data
        var i = 0;
        var datas = [];
        for (var pi = 0; pi < packetEnds.length; pi++) {
            var packetEnd = packetEnds[pi];
            var dataSize = 0;
            for (; i <= packetEnd; i++)
                dataSize += segmentTable[i];
            var data = shift(dataSize);
            if (!data) {
                unshift(header, pageSegmentsB, segmentTableRaw);
                unshift.call(datas);
                return;
            }
            datas.push(data);
        }

        // Then create an Ogg packet for each
        for (var pi = 0; pi < packetEnds.length - 1; pi++) {
            var subGranulePos = granulePos -
                (960 * packetEnds.length) +
                (960 * (pi+1));
            splitPackets.push([subGranulePos, datas[pi]]);
        }
        splitPackets.push([granulePos, datas[packetEnds.length - 1]]);
    }

    if (splitPackets.length === 0) return;

    // Now adjust the time
    var outEndGranule = (endTime - startTime) * 48;
    var inEndGranule = splitPackets[splitPackets.length-1][0];
    while (splitPackets.length) {
        var packet = splitPackets.shift();
        packet[0] = packet[0] - inEndGranule + outEndGranule;
        packets.push(packet);
    }

    handlePackets();
}

// Handle input Matroska (WebM) data
function handleMkvData(endTime) {
    // Pass the data to mkvdemuxjs
    while (data.length)
        mkvDemuxer.push(data.shift());

    // Demux it
    var frames = [];
    var el;
    while ((el = mkvDemuxer.demux()) !== null) {
        if (el.frames)
            frames = frames.concat(el.frames);
    }
    if (frames.length === 0) return;

    // Adjust the times and move them
    var outEndGranule = (endTime - startTime) * 48;
    var inEndGranule = frames[frames.length-1].timestamp * 48000;
    var last = 0;
    while (frames.length) {
        var packet = frames.shift();
        var ts = packet.timestamp * 48000 - inEndGranule + outEndGranule;
        var pData = new DataView(packet.data);

        // Split it if necessary
        var multi = opusDemux(pData);
        if (multi !== null) {
            // It was a multi-part packet, so split it up
            ts -= 960 * (multi.length - 1); // 20ms per packet
            while (multi.length) {
                packet = multi.shift();
                packets.push([ts, packet]);
                ts += 960; // 20ms
            }
        } else {
            // Just one!
            packets.push([ts, pData]);
        }
    }

    handlePackets();
}

/* All of the above is to convert raw audio data into Opus or FLAC packets.
 * Below, we can actually do something with those packets. */

// Once we've parsed new packets, we can do something with them
function handlePackets() {
    if (!packets.length || timeOffset === null) return;

    var curGranulePos = packets[packets.length-1][0];
    transmitting = true;

    // We have *something* to handle
    lastSentTime = performance.now();
    popStatus("startenc");

    // Don't actually *send* anything if we're not recording
    if (mode !== prot.mode.rec) {
        while (packets.length)
            packets.pop();
        return;
    }

    // Warn if we're buffering
    if (dataSock.bufferedAmount > 1024*1024)
        pushStatus("buffering", bytesToRepr(dataSock.bufferedAmount) + " audio data buffered");
    else
        popStatus("buffering");

    if (!vadOn) {
        // Drop any sufficiently old packets, or send them marked as silence in continuous mode
        var old = curGranulePos - vadExtension*48;
        while (packets[0][0] < old) {
            var packet = packets.shift();
            var granulePos = adjustTime(packet);
            if (granulePos < 0)
                continue;
            if (useContinuous || sendSilence > 0) {
                /* Send it in VAD-off mode */
                sendPacket(granulePos, packet[1], 0);
                sendSilence--;

            } else if (sentZeroes < 3) {
                /* Send an empty packet in its stead (FIXME: We should have
                 * these prepared in advance) */
                if (granulePos < 0) continue;
                sendPacket(granulePos, zeroPacket, 0);
                sentZeroes++;
            }
        }

    } else {
        var vadVal = (rawVadOn?2:1);

        // VAD is on, so send packets
        packets.forEach(function (packet) {
            var data = packet[1];

            // Ignore header packets (start with "Opus")
            if (data.byteLength >= 4 && data.getUint32(0, true) === 0x7375704F)
                return;

            var granulePos = adjustTime(packet);
            if (granulePos < 0)
                return;

            sendPacket(granulePos, data, vadVal);
        });

        sentZeroes = 0;
        packets = [];

    }
}

// Send an audio packet
function sendPacket(granulePos, data, vadVal) {
    var p = prot.parts.data;
    var msg = new DataView(new ArrayBuffer(p.length + (useContinuous?1:0) + data.buffer.byteLength));
    msg.setUint32(0, prot.ids.data, true);
    msg.setUint32(p.granulePos, granulePos & 0xFFFFFFFF, true);
    msg.setUint16(p.granulePos + 4, (granulePos / 0x100000000) & 0xFFFF, true);
    if (useContinuous)
        msg.setUint8(p.packet, vadVal);
    msg = new Uint8Array(msg.buffer);
    data = new Uint8Array(data.buffer);
    msg.set(data, p.packet + (useContinuous?1:0));
    dataSock.send(msg.buffer);
}

// Adjust the time for a packet, and adjust the time-adjustment parameters
function adjustTime(packet) {
    // Adjust our offsets
    if (targetTimeOffset > timeOffset) {
        if (targetTimeOffset > timeOffset + timeOffsetAdjPerFrame)
            timeOffset += timeOffsetAdjPerFrame;
        else
            timeOffset = targetTimeOffset;
    } else if (targetTimeOffset < timeOffset) {
        if (targetTimeOffset < timeOffset - timeOffsetAdjPerFrame)
            timeOffset -= timeOffsetAdjPerFrame;
        else
            timeOffset = targetTimeOffset;
    }

    // And adjust the time
    return Math.round(packet[0] + timeOffset*48 + startTime*48);
}

// Toggle the mute state of the input audio
function toggleMute(to) {
    if (!userMedia) return;
    var track = userMedia.getAudioTracks()[0];
    if (typeof to === "undefined")
        to = !track.enabled;
    track.enabled = to;
    updateMuteButton();
}
