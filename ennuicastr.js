/*
 * Copyright (c) 2018 Yahweasel
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

    // First check whether we're doing anything interesting at all
    var url = new URL(window.location);
    var params = new URLSearchParams(url.search);
    var id = params.get("id");
    var key = params.get("key");
    var port = params.get("port");
    var username = params.get("nm");
    if (id === null) {
        // Redirect to the homepage
        window.location = "/home/";
        return;
    }
    id = +id;
    if (key === null) {
        var div = dce("div");
        div.innerHTML = "Invalid key!";
        document.body.appendChild(div);
        return;
    }
    key = +key;
    if (port === null)
        port = 36678;
    port = +port;
    url.search = "?id=" + id;
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
        form.innerHTML =
            "<label for=\"nm\">Username: </label><input name=\"nm\" id=\"nm\" type=\"text\" /> " +
            "<input name=\"id\" type=\"hidden\" value=\"" + id + "\" />" +
            "<input name=\"key\" type=\"hidden\" value=\"" + key + "\" />" +
            "<input name=\"port\" type=\"hidden\" value=\"" + port + "\" />" +
            "<input type=\"submit\" value=\"Join\" />";

        form.onsubmit = function(ev) {
            // Try to do this in a new window
            var target = "?id=" + id + "&key=" + key + "&port=" + port + "&nm=" + encodeURIComponent(gebi("nm").value);
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
    var wsUrl = (url.protocol==="http:"?"ws":"wss") + "://" + url.hostname + ":" + port;

    // We have two connections to the server: One for pings, the other to send data
    var pingSock = null;
    var dataSock = null;

    // There are a lot of intermediate steps to getting audio from point A to point B
    var userMedia = null;
    var fileReader = null;
    var mediaRecorder = null;

    /* We use a two-level voice activity detector. The first is vad.js, an
     * FFT-based VAD. The second, here, is a voice-level based VAD with an
     * adaptive voice level based on the FFT VAD. */
    var fftVad = null;
    var fftVadOn = false;
    var fftVadOnChange = null;

    var lvlOnData = [];
    var lvlOffData = [];
    var lvlOnLevel = 1;
    var lvlOffLevel = 0;
    var lvlVadOn = false;

    var vadOn = false;

    // When we're not sending real data, we have to send a few (arbitrarily, 3) empty frames
    var sentZeroes = 999;

    // The data used by both the level-based VAD and display
    var waveData = [];
    var waveFFTVADs = [];
    var waveVADs = [];
    var waveVADColors = ["#aaa", "#073", "#0a3"];

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

    // The Opus packets to be handled
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
                nickBuf = new Uint8Array(nick.length);
                for (var ni = 0; ni < nick.length; ni++) {
                    var cc = nick.charCodeAt(ni);
                    if (cc > 127)
                        cc = 95;
                    nickBuf[ni] = cc;
                }
            }

            var out = new DataView(new ArrayBuffer(16 + nickBuf.length));
            out.setUint32(0, prot.ids.login, true);
            var p = prot.parts.login;
            out.setUint32(p.id, id, true);
            out.setUint32(p.key, key, true);
            out.setUint32(p.flags, 0, true);
            new Uint8Array(out.buffer).set(nickBuf, 16);
            pingSock.send(out.buffer);

            dataSock = new WebSocket(wsUrl);
            dataSock.binaryType = "arraybuffer";

            dataSock.addEventListener("open", function() {
                out.setUint32(p.flags, 1, true);
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
        log.innerText = "Disconnected!";

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

        if (fftVad) {
            // FIXME?
            fftVad = null;
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
        var msg = new DataView(new ArrayBuffer(12));
        msg.setUint32(0, prot.ids.ping, 4);
        msg.setFloat64(prot.parts.ping.clientTime, performance.now(), true);
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
                    var latency = pongs.reduce(function(a,b){return a+b})/10;
                    var remoteTime = msg.getFloat64(p.serverTime, true) + latency;
                    timeOffset = remoteTime - (recvd - startTime);
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
                sampleSize: {ideal: 24} // Higher bitrates are *like* automatic gain control
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
        log.innerText = "Capturing audio";

        var ac = new AudioContext();

        // Set up the VAD
        var mss = ac.createMediaStreamSource(userMedia);
        var vad = new VAD({
            source: mss,
            voice_start: fftVadStart,
            voice_stop: fftVadStop
        });

        // Create our own script processor for display
        createDisplay(userMedia, ac);

        // If the browser can't encode to Ogg Opus directly, we need a JS solution
        var useRecorder = false;
        if (typeof MediaRecorder === "undefined" ||
            !MediaRecorder.isTypeSupported("audio/ogg; codec=opus")) {
            useRecorder = true;
        }

        if (!useRecorder) {
            // We're ready to record, but need a file reader to transfer the data
            fileReader = new FileReader();
            fileReader.addEventListener("load", function(chunk) {
                data.push(chunk.target.result);
                blobs.shift();
                if (blobs.length)
                    fileReader.readAsArrayBuffer(blobs[0]);
                handleData();
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
                handleData();
            };
            startTime = performance.now();
            mediaRecorder.start();

        }
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
    function handleData() {
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
                var subHeader = new DataView(header.buffer.slice(0));
                var subGranulePos = granulePos -
                    (960 * packetEnds.length) +
                    (960 * (pi+1));
                granulePosSet(subHeader, subGranulePos);
                packets.push([subHeader, datas[pi]]);
            }
            packets.push([header, datas[packetEnds.length - 1]]);
        }

        handlePackets();
    }

    // Once we've parsed new packets, we can do something with them
    function handlePackets() {
        if (!packets.length || timeOffset === null) return;
        var curGranulePos = granulePosOf(packets[packets.length-1][0]);
        transmitting = true;

        if (!vadOn) {
            // Drop any sufficiently old packets
            var old = curGranulePos - 2*48000;
            while (granulePosOf(packets[0][0]) < old) {
                var packet = packets.shift();
                if (sentZeroes < 3) {
                    /* Send an empty packet in its stead (FIXME: We should have
                     * these prepared in advance) */
                    var header = packet[0];
                    var granulePos = Math.round(granulePosOf(header) + timeOffset*48);
                    if (granulePos < 0) continue;
                    var msg = new DataView(new ArrayBuffer(12 + zeroPacket.length));
                    msg.setUint32(0, prot.ids.data, true);
                    var p = prot.parts.data;
                    msg.setUint32(p.granulePos, granulePos & 0xFFFFFFFF, true);
                    msg.setUint16(p.granulePos + 4, (granulePos / 0x100000000) & 0xFFFF, true);
                    new Uint8Array(msg.buffer).set(zeroPacket, p.packet);
                    dataSock.send(msg.buffer);
                    sentZeroes++;
                }
            }

        } else {
            // VAD is on, so send packets
            packets.forEach(function (packet) {
                var header = packet[0];
                var data = packet[1];

                // Ignore header packets (start with "Opus")
                if (data.getUint32(0, true) === 0x7375704F)
                    return;

                var granulePos = Math.round(granulePosOf(header) + timeOffset*48);
                if (granulePos < 0)
                    return;

                // Build the message
                var msg = new DataView(new ArrayBuffer(12 + data.buffer.byteLength));
                msg.setUint32(0, prot.ids.data, true);
                var p = prot.parts.data;
                msg.setUint32(p.granulePos, granulePos & 0xFFFFFFFF, true);
                msg.setUint16(p.granulePos + 4, (granulePos / 0x100000000) & 0xFFFF, true);
                msg = new Uint8Array(msg.buffer);
                data = new Uint8Array(data.buffer);
                msg.set(data, p.packet);
                dataSock.send(msg.buffer);
            });

            sentZeroes = 0;
            packets = [];

        }
    }

    // VAD and display below

    // When talking starts, switch the FFT VAD on
    function fftVadStart() {
        fftVadOn = true;
        if (fftVadOnChange) fftVadOnChange();
    }

    // When talking stops, switch the FFT VAD off
    function fftVadStop() {
        fftVadOn = false;
        if (fftVadOnChange) fftVadOnChange();
    }

    // Create a wave display and VAD
    function createDisplay(userMedia, ac) {
        if (!ac.createScriptProcessor)
            createBasicVad();

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

        // And make the log display appropriate
        log.style.backgroundColor = "#ccc";
        log.style.color = "#333";
        log.style.position = "fixed";
        log.style.left = "0px";
        log.style.bottom = "0px";
        log.style.width = "100%";
        log.style.textAlign = "center";
        log.style.padding = "0.25em";

        // And set up the audio processor
        var mss = ac.createMediaStreamSource(userMedia);
        /* NOTE: We don't actually care about output, but Chrome won't run a
         * script processor with 0 outputs */
        var sp = ac.createScriptProcessor(1024, 1, 1);
        sp.connect(ac.destination);
        sp.onaudioprocess = function(ev) {
            // Find the max for this range
            var max = 0;
            var ib = ev.inputBuffer.getChannelData(0);
            for (var i = 0; i < ib.length; ib++) {
                var v = ib[i];
                if (v < 0) v = -v;
                if (v > max) max = v;
            }

            // Bump up surrounding ones to make the wave look nicer and to help the voice-based VAD not have weird transients
            if (waveData.length > 0) {
                var last = waveData.pop();
                if (last < max)
                    last = (last+max)/2;
                else
                    max = (last+max)/2;
                waveData.push(last);
            }

            waveData.push(max);
            waveFFTVADs.push(fftVadOn);
            if (fftVadOn || lvlVadOn)
                waveVADs.push(2);
            else if (vadOn)
                waveVADs.push(1);
            else
                waveVADs.push(0);
            updateWave(max);
        };
        mss.connect(sp);
    }

    // Update the wave display when we retroactively promote VAD data
    function updateWaveRetroactive() {
        // Magic number 93 is 2 seconds given our rates
        var i = Math.max(waveVADs.length - 93, 0);
        for (; i < waveVADs.length; i++)
            waveVADs[i] = waveVADs[i] ? waveVADs[i] : 1;
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
            waveFFTVADs.shift();
            waveVADs.shift();
        }
        while (waveData.length < dw) {
            waveData.unshift(0);
            waveFFTVADs.unshift(false);
            waveVADs.unshift(0);
        }

        // Figure out the height of the display
        var dh = Math.min(Math.max.apply(Math, waveData) * 1.5, 1);

        // Because of how the rounding works, we add one *before* the current one to our level-based VAD data
        if (waveFFTVADs[dw-1]) {
            lvlOnData.push(waveData[dw-1]);
            if (lvlOnData.length > 50)
                lvlOnData.shift();
        } else {
            lvlOffData.push(waveData[dw-1]);
            if (lvlOffData.length > 50)
                lvlOffData.shift();
        }
        updateLvlVad(value);

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
            ctx.fillStyle = (connected&&transmitting) ? waveVADColors[waveVADs[i]] : "#000";
            ctx.fillRect(p, h-d, sw, 2*d);
        }
        ctx.restore();
    }

    // Create a basic VAD, for when we can't combine the FFT and level-based VAD
    function createBasicVad() {
        var timeout = null;
        fftVadOnChange = function() {
            if (fftVadOn) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                vadOn = true;

            } else {
                if (!timeout) {
                    timeout = setTimeout(function() {
                        vadOn = false;
                        timeout = null;
                    }, 2000);
                }

            }
        };
    }

    function avg(arr) {
        return arr.reduce(function(a, b) { return a + b; }) / arr.length;
    }

    function stddev(arr, mean) {
        var diffs = arr.map(function(a) { return Math.pow(a - mean, 2); });
        return Math.sqrt(diffs.reduce(function(a, b) { return a + b; }) / diffs.length);
    }

    var vadTimeout = null;

    // Update the level-based VAD and joined VAD
    function updateLvlVad(value) {
        var onSD = 0, offSD = 0, dev;
        if (lvlOnData.length) {
            lvlOnLevel = avg(lvlOnData);
            onSD = stddev(lvlOnData, lvlOnLevel);
        }
        if (lvlOffData.length) {
            lvlOffLevel = avg(lvlOffData);
            offSD = stddev(lvlOffData, lvlOffLevel);
        }
        dev = Math.max(onSD, offSD);

        if (lvlOnLevel - lvlOffLevel <= 3*dev) {
            // Our level-based VAD cannot be trusted
            lvlVadOn = fftVadOn;

        } else if (value < lvlOffLevel) {
            lvlVadOn = false;

        } else if (value > (lvlOnLevel+lvlOffLevel)/2) {
            lvlVadOn = true;

        }

        if (fftVadOn || lvlVadOn) {
            // Turn the total VAD on
            if (!vadOn) {
                vadOn = true;
                updateWaveRetroactive();
                if (vadTimeout) {
                    clearTimeout(vadTimeout);
                    vadTimeout = null;
                }
            }

        } else {
            // If they both agree no voice, turn it off after two seconds
            if (!vadTimeout) {
                vadTimeout = setTimeout(function() {
                    vadOn = false;
                    vadTimeout = null;
                }, 2000);
            }

        }
    }
})();
