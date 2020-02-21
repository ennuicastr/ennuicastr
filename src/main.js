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

// Connect to the server (our first step)
var connected = false;
var transmitting = false;
function connect() {
    // Our connection message, which is largely the same for all three
    var p, f, out, flags;

    // (1) The ping socket
    function connectPingSock() {
        connected = true;
        pushStatus("conn", "Connecting...");

        pingSock = new WebSocket(wsUrl);
        pingSock.binaryType = "arraybuffer";

        pingSock.addEventListener("open", function() {
            var nickBuf = encodeText(username);

            p = prot.parts.login;
            out = new DataView(new ArrayBuffer(p.length + nickBuf.length));
            out.setUint32(0, prot.ids.login, true);
            f = prot.flags;
            flags = (useFlac?f.dataType.flac:0) | (useContinuous?f.features.continuous:0);
            out.setUint32(p.id, config.id, true);
            out.setUint32(p.key, config.key, true);
            out.setUint32(p.flags, f.connectionType.ping | flags, true);
            new Uint8Array(out.buffer).set(nickBuf, 16);
            pingSock.send(out.buffer);

            connectDataSock();
        });

        pingSock.addEventListener("message", pingSockMsg);
        pingSock.addEventListener("error", disconnect);
        pingSock.addEventListener("close", disconnect);
    }
    connectPingSock();

    // (2) The data socket
    function connectDataSock() {
        dataSock = new WebSocket(wsUrl);
        dataSock.binaryType = "arraybuffer";

        dataSock.addEventListener("open", function() {
            out.setUint32(p.flags, f.connectionType.data | flags, true);
            dataSock.send(out.buffer);

            if ("master" in config)
                connectMasterSock();
            else
                getMic();
        });

        dataSock.addEventListener("message", dataSockMsg);
        dataSock.addEventListener("error", disconnect);
        dataSock.addEventListener("close", disconnect);
    }

    // (3) The master socket
    function connectMasterSock() {
        masterSock = new WebSocket(wsUrl);
        masterSock.binaryType = "arraybuffer";

        masterSock.addEventListener("open", function() {
            out.setUint32(p.key, config.master, true);
            out.setUint32(p.flags, f.connectionType.master | flags, true);
            masterSock.send(out.buffer);
            getMic();
        });

        masterSock.addEventListener("message", masterSockMsg);
        masterSock.addEventListener("error", disconnect);
        masterSock.addEventListener("close", disconnect);
    }
}
connect();

// Called to disconnect explicitly, or implicitly on error
function disconnect(ev) {
    if (!connected)
        return;
    connected = false;

    log.innerHTML = "";
    var sp = dce("span");
    sp.innerText = "Disconnected! ";
    log.appendChild(sp);
    var a = dce("a");
    var href = "?";
    for (var key in config)
        href += key[0] + "=" + config[key].toString(36) + "&";
    href += "nm=" + encodeURIComponent(username);
    a.href = href;
    a.innerText = "Attempt reconnection";
    log.appendChild(a);

    var target = null;
    if (ev && ev.target)
        target = ev.target;

    function close(sock) {
        if (sock && sock !== target)
            sock.close();
        return null;
    }
    pingSock = close(pingSock);
    dataSock = close(dataSock);
    masterSock = close(masterSock);

    if (ac) {
        try {
            ac.dispatchEvent(new CustomEvent("disconnected", {}));
        } catch (ex) {}
        ac.close();
        ac = null;
    }

    if (mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder = null;
    }

    fileReader = null;

    if (userMedia) {
        userMedia.getTracks().forEach(function (track) {
            track.stop();
        });
        userMedia = null;
    }
}

// Ping the ping socket
function ping() {
    var p = prot.parts.ping;
    var msg = new DataView(new ArrayBuffer(p.length));
    msg.setUint32(0, prot.ids.ping, 4);
    msg.setFloat64(p.clientTime, performance.now(), true);
    pingSock.send(msg);
}

// Message from the ping socket
function pingSockMsg(msg) {
    msg = new DataView(msg.data);
    var cmd = msg.getUint32(0, true);

    switch (cmd) {
        case prot.ids.ack:
            var ackd = msg.getUint32(prot.parts.ack.ackd, true);
            if (ackd === prot.ids.login) {
                // We're logged in, so start pinging
                ping();
            }
            break;

        // All we really care about
        case prot.ids.pong:
            var p = prot.parts.pong;
            var sent = msg.getFloat64(p.clientTime, true);
            var recvd = performance.now();
            pongs.push(recvd - sent);
            while (pongs.length > 5)
                pongs.shift();
            if (pongs.length < 5) {
                // Get more pongs now!
                setTimeout(ping, 150);
            } else {
                // Get more pongs... eventually
                setTimeout(ping, 10000);

                // And figure out our offset
                var latency = pongs.reduce(function(a,b){return a+b;})/10;
                var remoteTime = msg.getFloat64(p.serverTime, true) + latency;
                targetTimeOffset = remoteTime - recvd;
                if (timeOffset === null) timeOffset = targetTimeOffset;
            }
            break;
    }
}

// Message from the data socket
function dataSockMsg(msg) {
    msg = new DataView(msg.data);
    var cmd = msg.getUint32(0, true);

    switch (cmd) {
        case prot.ids.info:
            var p = prot.parts.info;
            var key = msg.getUint32(p.key, true);
            var val = msg.getUint32(p.value, true);
            switch (key) {
                case prot.info.peerInitial:
                case prot.info.peerContinuing:
                    // We may need to start an RTC connection
                    if (useRTC)
                        initRTC(val, (key === prot.info.peerContinuing));
                    break;

                case prot.info.mode:
                    // Set the mode
                    mode = val;

                    // Make it visible in the waveform
                    var wvms = ((val === prot.mode.rec) ? "r" : "s") +
                               (useContinuous ? "c" : "v");
                    waveVADColors = waveVADColorSets[wvms];

                    // Update the status
                    popStatus("mode");
                    if (mode === prot.mode.init)
                        pushStatus("mode", "Not yet recording");
                    else if (mode === prot.mode.finished)
                        pushStatus("mode", "Not recording");

                    // Update the master interface
                    if ("master" in config)
                        configureMasterInterface();

                    break;
            }
            break;

        case prot.ids.rtc:
            var p = prot.parts.rtc;
            var peer = msg.getUint32(p.peer, true);
            var conn = rtcConnections[peer];
            if (!conn)
                break;

            var type = msg.getUint32(p.type, true);
            var value = JSON.parse(decodeText(msg.buffer.slice(p.value)));

            switch (type) {
                case prot.rtc.candidate:
                    conn.addIceCandidate(value);
                    break;

                case prot.rtc.offer:
                    conn.setRemoteDescription(value).then(function() {
                        return conn.createAnswer();

                    }).then(function(answer) {
                        return conn.setLocalDescription(answer);

                    }).then(function() {
                        rtcSignal(peer, prot.rtc.answer, conn.localDescription);

                    }).catch(function(ex) {
                        pushStatus("rtc", "RTC connection failed!");

                    });
                    break;

                case prot.rtc.answer:
                    conn.setRemoteDescription(value).catch(function(ex) {
                        pushStatus("rtc", "RTC connection failed!");
                    });
                    break;
            }
            break;
    }
}

// Message from the master socket
function masterSockMsg(msg) {
    msg = new DataView(msg.data);
    var cmd = msg.getUint32(0, true);
    var p;

    switch (cmd) {
        case prot.ids.info:
            p = prot.parts.info;
            var key = msg.getUint32(p.key, true);
            var val = msg.getUint32(p.value, true);
            switch (key) {
                case prot.info.creditRate:
                    // Informing is of the credit rate
                    var v2 = msg.getUint32(p.value + 4, true);
                    masterUI.creditRate = [val, v2];
                    masterUpdateTimeLeft();
                    break;
            }
            break;

        case prot.ids.user:
            p = prot.parts.user;
            var index = msg.getUint32(p.index, true);
            var status = msg.getUint32(p.status, true);
            var nick = decodeText(msg.buffer.slice(p.nick));

            // Add it to the UI
            masterUI.speech = masterUI.speech || [];
            while (masterUI.speech.length <= index)
                masterUI.speech.push(null);
            masterUI.speech[index] = {
                nick: nick,
                online: !!status,
                speaking: false
            };

            updateMasterSpeech();
            break;

        case prot.ids.speech:
            p = prot.parts.speech;
            var indexStatus = msg.getUint32(p.indexStatus, true);
            var index = indexStatus>>>1;
            var status = (indexStatus&1);
            console.log("A");
            if (!masterUI.speech[index]) return;
            console.log("B");
            masterUI.speech[index].speaking = !!status;
            updateMasterSpeech();
            break;
    }
}

// Get our microphone input
function getMic() {
    if (!connected)
        return;

    pushStatus("getmic", "Asking for microphone permission...");
    popStatus("conn");

    navigator.mediaDevices.getUserMedia({
        audio: {
            autoGainControl: plzno,
            echoCancellation: plzno,
            noiseSuppression: plzno,
            sampleRate: {ideal: 48000},
            sampleSize: {ideal: 24}
        }
    }).then(function(userMediaIn) {
        userMedia = userMediaIn;
        if (useRTC) {
            return navigator.mediaDevices.getUserMedia({
                audio: {
                    autoGainControl: plzyes,
                    echoCancellation: plzyes,
                    noiseSuppression: plzyes
                }
            });
        }
    }).then(function(userMediaIn) {
        if (useRTC)
            userMediaRTC = userMediaIn;
        userMediaSet();
    }).catch(function(err) {
        disconnect();
        pushStatus("fail", "Cannot get microphone: " + err);
        popStatus("getmic");
    });
}

// Called once we have mic access
function userMediaSet() {
    if (!connected)
        return;

    pushStatus("initenc", "Initializing encoder...");
    popStatus("getmic");

    userMediaAvailableEvent.dispatchEvent(new CustomEvent("ready", {}));

    // Check whether we should be using WebAssembly
    var wa = isWebAssemblySupported();

    ac = new AudioContext();

    // Set up the VAD
    WebRtcVad = {
        onRuntimeInitialized: localProcessing
    };
    var scr = dce("script");
    scr.async = true;
    scr.src = "vad/vad" + (wa?".wasm":"") + ".js";
    document.body.appendChild(scr);

    // Set up the master interface
    if ("master" in config)
        createMasterInterface();

    // If the browser can't encode to Ogg Opus directly, we need a JS solution
    useOpusRecorder = false;
    if (typeof MediaRecorder === "undefined" ||
        !MediaRecorder.isTypeSupported("audio/ogg; codec=opus")) {
        useOpusRecorder = true;
    }

    // At this point, we want to start catching errors
    window.addEventListener("error", function(error) {
        var errBuf = encodeText(error.error + "\n\n" + error.error.stack);
        var out = new DataView(new ArrayBuffer(4 + errBuf.length));
        out.setUint32(0, prot.ids.error, true);
        new Uint8Array(out.buffer).set(errBuf, 4);
        dataSock.send(out.buffer);
    });

    if (useFlac) {

        // Jump through its asynchronous hoops
        var scr = dce("script");
        scr.addEventListener("load", function() {
            if (!Flac.isReady())
                Flac.onready = encoderLoaded;
            else
                encoderLoaded();
        });
        scr.src = "libflac/libflac.min" + (wa?".wasm":"") + ".js";
        scr.async = true;
        document.body.appendChild(scr);

    } else if (useOpusRecorder) {
        // We need to load it first
        var scr = dce("script");
        scr.addEventListener("load", encoderLoaded);
        scr.src = "recorder/recorder.min.js";
        scr.async = true;
        document.body.appendChild(scr);

    } else {
        encoderLoaded();

    }
}

// Called once the encoder is loaded
function encoderLoaded() {
    if (!connected)
        return;

    pushStatus("startenc", "Starting encoder...");
    popStatus("initenc");

    if (useFlac) {
        flacStart();

    } else if (!useOpusRecorder) {
        // We're ready to record, but need a file reader to transfer the data
        fileReader = new FileReader();
        fileReader.addEventListener("load", function(chunk) {
            data.push(chunk.target.result);
            blobs.shift();
            if (blobs.length)
                fileReader.readAsArrayBuffer(blobs[0]);
            handleData(performance.now());
        });

        // MediaRecorder will do what we need
        mediaRecorder = new MediaRecorder(userMedia, {
            mimeType: "audio/ogg; codec=opus",
            audioBitsPerSecond: 128000
        });
        mediaRecorder.addEventListener("dataavailable", function(chunk) {
            blobs.push(chunk.data);
            if (blobs.length === 1)
                fileReader.readAsArrayBuffer(chunk.data);
        });
        startTime = performance.now();
        mediaRecorder.start(200);

    } else if (!Recorder.isRecordingSupported()) {
        // We're screwed!
        disconnect();
        pushStatus("unsupported", "Sorry, but your browser doesn't support recording :(");
        popStatus("startenc");

    } else {
        // We need a JS recorder to get it in the format we want
        mediaRecorder = new Recorder({
            encoderPath: "recorder/encoderWorker.min.js",
            numberOfChannels: 1,
            encoderBitRate: 128000,
            encoderSampleRate: 48000,
            maxBuffersPerPage: 1,
            streamPages: true
        });
        mediaRecorder.ondataavailable = function(chunk) {
            data.push(chunk.buffer);
            handleData(performance.now());
        };
        startTime = performance.now();
        mediaRecorder.start(ac.createMediaStreamSource(userMedia));

    }
}

// FLAC support code
function flacStart() {
    // Opus always resamples, but we need to keep our rate for FLAC
    sampleRate = ac.sampleRate;
    var p = prot.parts.info;
    var info = new DataView(new ArrayBuffer(p.length));
    info.setUint32(0, prot.ids.info, true);
    info.setUint32(p.key, prot.info.sampleRate, true);
    info.setUint32(p.value, sampleRate, true);
    dataSock.send(info.buffer);

    // Our zero packet is also different, of course
    switch (sampleRate) {
        case 44100:
            zeroPacket = new Uint8Array([0xFF, 0xF8, 0x79, 0x0C, 0x00, 0x03, 0x71, 0x56, 0x00, 0x00, 0x00, 0x00, 0x63, 0xC5]);
            break;
        default:
            zeroPacket = new Uint8Array([0xFF, 0xF8, 0x7A, 0x0C, 0x00, 0x03, 0xBF, 0x94, 0x00, 0x00, 0x00, 0x00, 0xB1, 0xCA]);
    }

    // Initialize our FLAC encoder
    flacEncoder = Flac.create_libflac_encoder(sampleRate, 1, 24, 5, 0, false, sampleRate * 20 / 1000);
    if (flacEncoder === 0) {
        pushStatus("flacfail", "Failed to initialize FLAC encoder!");
        popStatus("startenc");
        return;
    }

    startTime = performance.now();

    var encoderStatus = Flac.init_encoder_stream(flacEncoder, flacChunk);
    if (encoderStatus !== 0) {
        pushStatus("flacfail", "Failed to initialize FLAC encode stream! (" + encoderStatus + " " + Flac.FLAC__stream_encoder_get_state() + ")");
        popStatus("startenc");
        return;
    }

    function flacChunk(data, bytes, samples, currentFrame) {
        if (samples === 0) {
            // This is metadata. Ignore it.
            return;
        }

        // Just make a packet directly
        packets.push([(performance.now() - startTime) * 48, new DataView(data.buffer)]);
        handlePackets();
    }

    // Now start reading the input
    var mss = ac.createMediaStreamSource(userMedia);
    /* NOTE: We don't actually care about output, but Chrome won't run a
     * script processor with 0 outputs */
    var sp = ac.createScriptProcessor(1024, 1, 1);
    sp.connect(ac.destination);
    sp.onaudioprocess = function(ev) {
        var ib = ev.inputBuffer.getChannelData(0);

        // Convert it to FLAC's format
        var oba = new Uint32Array(ib.length);
        var ob = new DataView(oba.buffer);
        for (var i = 0; i < ib.length; i++)
            ob.setInt32(i * 4, ib[i]*0x7FFFFF, true);

        var ret = Flac.FLAC__stream_encoder_process_interleaved(flacEncoder, oba, ib.length);
        if (!ret)
            pushStatus("flacerr", "FLAC error " + Flac.FLAC__stream_encoder_get_state(flacEncoder));
    };
    mss.connect(sp);

    ac.addEventListener("disconnected", function() {
        Flac.FLAC__stream_encoder_finish(flacEncoder);
        Flac.FLAC__stream_encoder_delete(flacEncoder);
        mss.disconnect(sp);
        sp.disconnect(ac.destination);
    });
}

// Shift a chunk of blob
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

// Unshift one or more chunks of blob
function unshift() {
    for (var i = arguments.length - 1; i >= 0; i--)
        data.unshift(arguments[i].buffer);
}

// Get the granule position from a header
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

// Handle input data, splitting Ogg packets so we can fine-tune the granule position
function handleData(endTime) {
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
        // Don't send data unless we're recording
        while (packets.length)
            packets.pop();
        return;
    }

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
