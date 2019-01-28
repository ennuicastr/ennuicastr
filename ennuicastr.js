/*
 * Copyright (c) 2018-2019 Yahweasel
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
 * EnnuiCastr: Multi-user synchronized recording via the web
 *
 * This is the main entry point for the client.
 */

(function() {
    var dce = document.createElement.bind(document);
    var gebi = document.getElementById.bind(document);
    var log = gebi("log");
    var plzno = {ideal: false};
    var prot = EnnuiCastrProtocol;
    var zeroPacket = new Uint8Array([0xF8, 0xFF, 0xFE]);

    // Read in our configuration
    var url = new URL(window.location);
    var params = new URLSearchParams(url.search);
    var config = {
        id: params.get("i"),
        key: params.get("k"),
        format: params.get("f"),
        port: params.get("p")
    };
    var selector = params.get("s");
    var monitor = params.get("mon");
    var username = params.get("nm");
    if (config.id === null) {
        // Redirect to the homepage
        window.location = "/home/";
        return;
    }
    config.id = Number.parseInt(config.id, 36);
    if (config.key === null) {
        var div = dce("div");
        div.innerHTML = "Invalid key!";
        document.body.appendChild(div);
        return;
    }
    config.key = Number.parseInt(config.key, 36);
    if (config.port === null)
        config.port = 36678;
    else
        config.port = Number.parseInt(config.port, 36);
    if (config.format === null)
        config.format = 0;
    config.format = Number.parseInt(config.format, 36);

    // If we're using the selector, just do that
    if (selector) {
        var div = dce("div");
        div.innerText = "Client links:";
        document.body.appendChild(div);

        var sb = "?i=" + config.id.toString(36) + "&k=" + config.key.toString(36) + "&p=" + config.port.toString(36);

        for (var opt = 0; opt <= config.format; opt++) {
            if ((opt&config.format)!==opt) continue;

            div = dce("div");
            var a = dce("a");
            if (opt === 0)
                url.search = sb;
            else
                url.search = sb + "&f=" + opt.toString(36);
            a.href = url.toString();

            a.innerText = (((opt&prot.flags.dataTypeMask)===prot.flags.dataType.flac) ? "FLAC" : "Opus") +
                ((opt&1)?" continuous":"");

            div.appendChild(a);
            document.body.appendChild(div);
        }

        return;
    }

    // If we're looking for the monitor, just do that
    if (monitor) {
        var scr = dce("script");
        scr.src = "ennuicastr-monitor.js?v=1";
        scr.async = true;
        document.body.appendChild(scr);
        return;
    }

    url.search = "?i=" + config.id.toString(36);
    window.history.pushState({}, "EnnuiCastr", url.toString());

    // Next, check if we have a username
    if (username === null || username === "") {
        // Just ask for a username
        var div = dce("div");
        var span = dce("span");
        span.innerHTML = "You have been invited to join a recording on EnnuiCastr. Please enter a username.<br/><br/>";
        div.appendChild(span);
        var form = dce("form");
        form.action = "?";
        form.method = "GET";
        var html =
            "<label for=\"nm\">Username: </label><input name=\"nm\" id=\"nm\" type=\"text\" /> ";
        for (var key in config)
            html += "<input name=\"" + key[0] + "\" type=\"hidden\" value=\"" + config[key].toString(36) + "\" />";
        html += "<input type=\"submit\" value=\"Join\" />";
        form.innerHTML = html;

        form.onsubmit = function(ev) {
            // Try to do this in a new window
            var target = "?";
            for (var key in config)
                target += key[0] + "=" + config[key].toString(36) + "&";
            target += "nm=" + encodeURIComponent(gebi("nm").value);
            if (window.open(target, "", "width=640,height=160,menubar=0,toolbar=0,location=0,personalbar=0,status=0") === null) {
                // Just use the regular submit
                return true;
            }

            div.innerHTML = "Connecting in a new window. You may now close this tab.";

            ev.preventDefault();
            return false;
        };

        div.appendChild(form);
        document.body.appendChild(div);
        return;
    }

    // The remainder is actual EnnuiCastr

    // Find the websock URL
    var wsUrl = (url.protocol==="http:"?"ws":"wss") + "://" + url.hostname + ":" + config.port;

    // We have two connections to the server: One for pings, the other to send data
    var pingSock = null;
    var dataSock = null;

    // There are a lot of intermediate steps to getting audio from point A to point B
    var userMedia = null; // The microphone input
    var fileReader = null; // Used to transfer Opus data from the built-in encoder
    var mediaRecorder = null; // Either the built-in media recorder or opus-recorder
    var ac = null; // The audio context for our scritps
    var flacEncoder = null; // If using FLAC

    // Our input sample rate
    var sampleRate = 48000;

    // Which technology to use. If both false, we'll use built-in Opus.
    var useOpusRecorder = false;
    var useFlac = ((config.format&prot.flags.dataTypeMask) === prot.flags.dataType.flac);
    var useContinuous = !!(config.format&1);

    // WebRTCVAD's raw output
    var rawVadOn = false;

    // VAD output after our cooldown
    var vadOn = false;

    // Number of milliseconds to run the VAD for before/after talking
    var vadExtension = 2000;

    // When we're not sending real data, we have to send a few (arbitrarily, 3) empty frames
    var sentZeroes = 999;

    /* To help with editing by sending a clean silence sample, we send the
     * first few (arbitrarily, 8) seconds of VAD-off silence */
    var sendSilence = 400;

    // The data used by both the level-based VAD and display
    var waveData = [];
    var waveVADs = [];
    var waveVADColors = ["#000", "#aaa", "#073", "#0a3"];
    if (useContinuous) waveVADColors[1] = waveVADColors[2];

    // The display canvas and data
    var waveCanvas = null;
    var waveWatcher = null;
    var waveRotate = false;

    // Our start time is in local ticks, and our offset is updated every so often
    var startTime = 0;
    var timeOffset = null;

    // The delays on the pongs we've received back
    var pongs = [];

    // The current blobs waiting to be read
    var blobs = [];

    // The current ArrayBuffers of data to be handled
    var data = [];

    // The Opus or FLAC packets to be handled. Format: [granulePos, data]
    var packets = [];

    // Connect to the server (our first step)
    var connected = false;
    var transmitting = false;
    function connect() {
        connected = true;
        log.innerText = "Connecting...";

        pingSock = new WebSocket(wsUrl);
        pingSock.binaryType = "arraybuffer";

        pingSock.addEventListener("open", function() {
            var nickBuf;
            if (window.TextEncoder) {
                nickBuf = new TextEncoder().encode(username);
            } else {
                // I don't care to do this right, ASCII only
                nickBuf = new Uint8Array(username.length);
                for (var ni = 0; ni < username.length; ni++) {
                    var cc = username.charCodeAt(ni);
                    if (cc > 127)
                        cc = 95;
                    nickBuf[ni] = cc;
                }
            }

            var p = prot.parts.login;
            var out = new DataView(new ArrayBuffer(p.length + nickBuf.length));
            out.setUint32(0, prot.ids.login, true);
            var f = prot.flags;
            var flags = (useFlac?f.dataType.flac:0) | (useContinuous?f.features.continuous:0);
            out.setUint32(p.id, config.id, true);
            out.setUint32(p.key, config.key, true);
            out.setUint32(p.flags, f.connectionType.ping | flags, true);
            new Uint8Array(out.buffer).set(nickBuf, 16);
            pingSock.send(out.buffer);

            dataSock = new WebSocket(wsUrl);
            dataSock.binaryType = "arraybuffer";

            dataSock.addEventListener("open", function() {
                out.setUint32(p.flags, f.connectionType.data | flags, true);
                dataSock.send(out.buffer);
                getMic();
            });

            dataSock.addEventListener("message", dataSockMsg);
            dataSock.addEventListener("error", disconnect);
            dataSock.addEventListener("close", disconnect);
        });

        pingSock.addEventListener("message", pingSockMsg);
        pingSock.addEventListener("error", disconnect);
        pingSock.addEventListener("close", disconnect);
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
                    timeOffset = remoteTime - recvd;
                }
                break;
        }
    }

    // Message from the data socket
    function dataSockMsg(msg) {
        console.log(msg.data.toString());
    }

    // Get our microphone input
    function getMic() {
        log.innerText = "Asking for microphone permission...";

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
            userMediaSet();
        }).catch(function(err) {
            disconnect();
            log.innerText = "Cannot get microphone: " + err;
        });
    }

    // Called once we have mic access
    function userMediaSet() {
        log.innerText = "Initializing encoder";

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

        // If the browser can't encode to Ogg Opus directly, we need a JS solution
        useOpusRecorder = false;
        if (typeof MediaRecorder === "undefined" ||
            !MediaRecorder.isTypeSupported("audio/ogg; codec=opus")) {
            useOpusRecorder = true;
        }

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
        log.innerText = "Capturing audio";

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
            log.innerText = "Sorry, but your browser doesn't support recording :(";

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
            log.innerText = "Failed to initialize FLAC encoder!";
            return;
        }

        startTime = performance.now();

        var encoderStatus = Flac.init_encoder_stream(flacEncoder, flacChunk);
        if (encoderStatus !== 0) {
            log.innerText = "Failed to initialize FLAC encode stream! (" + encoderStatus + " " + Flac.FLAC__stream_encoder_get_state() + ")";
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
                log.innerText = "FLAC error " + Flac.FLAC__stream_encoder_get_state(flacEncoder);
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

        if (!vadOn) {
            // Drop any sufficiently old packets, or send them marked as silence in continuous mode
            var old = curGranulePos - vadExtension*48;
            while (packets[0][0] < old) {
                var packet = packets.shift();
                var inGranulePos = packet[0];
                var granulePos = Math.round(inGranulePos + timeOffset*48 + startTime*48);
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
                var inGranulePos = packet[0];
                var data = packet[1];

                // Ignore header packets (start with "Opus")
                if (data.getUint32(0, true) === 0x7375704F)
                    return;

                var granulePos = Math.round(inGranulePos + timeOffset*48 + startTime*48);
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


    // VAD and display below

    // Create a VAD and wave display
    function localProcessing() {
        // First the WebRTC VAD steps
        var m = WebRtcVad;

        var handle = m.Create();
        if (handle === 0) {
            log.innerText = "Failed to create VAD.";
            throw new Error();
        }
        if (m.Init(handle) < 0) {
            log.innerText = "Failed to initialize VAD.";
            throw new Error();
        }

        var bufSz = 480;
        var dataPtr = m.malloc(bufSz * 2);
        var buf = new Int16Array(m.heap.buffer, dataPtr, bufSz * 2);
        var bi = 0;
        var timeout = null;

        m.set_mode(2);


        // Now the display steps

        // Create a canvas for it
        var wc = dce("canvas");
        wc.width = window.innerWidth;
        wc.height = window.innerHeight;
        wc.style.position = "fixed";
        wc.style.left = "0px";
        wc.style.top = "0px";
        wc.style.width = "100%";
        wc.style.height = "100%";
        waveCanvas = wc;
        document.body.appendChild(wc);

        // Now the background is nothing, so should just be grey
        document.body.style.backgroundColor = "#111";

        // Create our watcher image
        var img = dce("img");
        img.style.display = "none";
        img.style.position = "fixed";
        img.style.left = "0px";
        img.style.top = "0px";
        img.style.height = "0px"; // Changed automatically when data arrives
        waveWatcher = img;
        document.body.appendChild(img);

        // And choose its type based on support
        function usePng() {
            img.src = "images/watcher.png";
            img.style.display = "";
        }
        if (!window.createImageBitmap || !window.fetch) {
            usePng();
        } else {
            var sample = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
            fetch(sample).then(function(res) {
                return res.blob();
            }).then(function(blob) {
                return createImageBitmap(blob)
            }).then(function() {
                img.src = "images/watcher.webp";
                img.style.display = "";
            }).catch(usePng);
        }

        // Make the log display appropriate
        log.classList.add("status");

        // Set up the audio processor for both VAD and display
        var mss = ac.createMediaStreamSource(userMedia);
        /* NOTE: We don't actually care about output, but Chrome won't run a
         * script processor with 0 outputs */
        var sp = ac.createScriptProcessor(1024, 1, 1);
        sp.connect(ac.destination);
        sp.onaudioprocess = function(ev) {
            var ib = ev.inputBuffer.getChannelData(0);

            // VAD
            var vadSet = rawVadOn;
            for (var i = 0; i < ib.length; i += 3) {
                buf[bi++] = ib[i] * 0x7FFF;

                if (bi == bufSz) {
                    // We have a complete packet
                    vadSet = !!m.Process(handle, 16000, dataPtr, bufSz);
                    bi = 0;
                }
            }

            if (vadSet) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (!rawVadOn) {
                    // We flipped on
                    if (!vadOn)
                        updateWaveRetroactive();
                    rawVadOn = vadOn = true;
                }
            } else if (!vadSet && rawVadOn) {
                // We flipped off
                rawVadOn = false;
                if (!timeout) {
                    timeout = setTimeout(function() {
                        vadOn = false;
                        timeout = null;
                    }, vadExtension);
                }
            }


            // And display

            // Find the max for this range
            var max = 0;
            var ib = ev.inputBuffer.getChannelData(0);
            for (var i = 0; i < ib.length; ib++) {
                var v = ib[i];
                if (v < 0) v = -v;
                if (v > max) max = v;
            }

            // Bump up surrounding ones to make the wave look nicer
            if (waveData.length > 0) {
                var last = waveData.pop();
                if (last < max)
                    last = (last+max)/2;
                else
                    max = (last+max)/2;
                waveData.push(last);
            }

            waveData.push(max);
            if (!transmitting)
                waveVADs.push(0);
            else if (rawVadOn)
                waveVADs.push(3);
            else if (vadOn)
                waveVADs.push(2);
            else
                waveVADs.push(1);
            updateWave(max);
        };
        mss.connect(sp);

        ac.addEventListener("disconnected", function() {
            updateWave(1);
            mss.disconnect(sp);
            sp.disconnect(ac.destination);
        });
    }

    // Update the wave display when we retroactively promote VAD data
    function updateWaveRetroactive() {
        var timeout = Math.ceil(sampleRate*vadExtension/1024000);
        var i = Math.max(waveVADs.length - timeout, 0);
        for (; i < waveVADs.length; i++)
            waveVADs[i] = (waveVADs[i] === 1) ? 2 : waveVADs[i];
    }

    // Update the wave display
    function updateWave(value) {
        // Start from the window size
        var w = window.innerWidth;
        var h = window.innerHeight - log.offsetHeight;

        // Rotate if our view is vertical
        if (h > w) {
            if (!waveRotate) {
                waveWatcher.style.visibility = "hidden";
                waveRotate = true;
            }
        } else {
            if (waveRotate) {
                waveWatcher.style.visibility = "";
                waveRotate = false;
            }
            if (h > w/2) h = Math.ceil(w/2);
        }

        // Make sure the canvases are correct
        if (+waveCanvas.width !== w)
            waveCanvas.width = w;
        if (+waveCanvas.height !== h)
            waveCanvas.height = h;
        if (waveCanvas.style.height !== h+"px")
            waveCanvas.style.height = h+"px";
        if (waveWatcher.style.height !== h+"px")
            waveWatcher.style.height = h+"px";

        if (waveRotate) {
            var tmp = w;
            w = h;
            h = tmp;
        }

        // Half the wave height is a more useful value
        h = Math.floor(h/2);

        // Figure out the width of each sample
        var sw = Math.max(Math.floor(w/468), 1);
        var dw = Math.ceil(w/sw);

        // Make sure we have an appropriate amount of data
        while (waveData.length > dw) {
            waveData.shift();
            waveVADs.shift();
        }
        while (waveData.length < dw) {
            waveData.unshift(0);
            waveVADs.unshift(0);
        }

        // Figure out the height of the display
        var dh = Math.min(Math.max.apply(Math, waveData) * 1.5, 1);

        // And draw it
        var ctx = waveCanvas.getContext("2d");
        var i, p;
        ctx.save();
        if (waveRotate) {
            ctx.rotate(Math.PI/2);
            ctx.translate(0, -2*h);
        }
        ctx.fillStyle = "#033";
        ctx.fillRect(0, 0, w, h*2);
        for (i = 0, p = 0; i < dw; i++, p += sw) {
            var d = Math.max(Math.log((waveData[i] / dh) * 54.598150033) / 4, 0) * h;
            if (d === 0) d = 1;
            ctx.fillStyle = (connected&&transmitting&&timeOffset) ? waveVADColors[waveVADs[i]] : "#000";
            ctx.fillRect(p, h-d, sw, 2*d);
        }
        ctx.restore();
    }

    function isWebAssemblySupported() {
        try {
            if (typeof WebAssembly === "object" &&
                typeof WebAssembly.instantiate === "function") {
                var module = new WebAssembly.Module(
                    new Uint8Array([0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
                if (module instanceof WebAssembly.Module)
                    return new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
            }
        } catch (e) {
        }
        return false;
    }
})();
