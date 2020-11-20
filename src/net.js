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
function connect() {
    // Our connection message, which is largely the same for all three
    var p, f, out, flags;

    return Promise.all([]).then(function() {
        // (1) The ping socket
        connected = true;
        pushStatus("conn", "Connecting...");

        return new Promise(function(res, rej) {
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

                res();
            });

            pingSock.addEventListener("message", pingSockMsg);
            pingSock.addEventListener("error", disconnect);
            pingSock.addEventListener("close", disconnect);
        });

    }).then(function() {
        // (2) The data socket
        return new Promise(function(res, rej) {
            dataSock = new WebSocket(wsUrl);
            dataSock.binaryType = "arraybuffer";

            dataSock.addEventListener("open", function() {
                out.setUint32(p.flags, f.connectionType.data | flags, true);
                dataSock.send(out.buffer);

                res();
            });

            dataSock.addEventListener("message", dataSockMsg);
            dataSock.addEventListener("error", disconnect);
            dataSock.addEventListener("close", disconnect);
        });

    }).then(function() {
        // (3) The master socket
        if ("master" in config) return new Promise(function(res, rej) {
            masterSock = new WebSocket(wsUrl);
            masterSock.binaryType = "arraybuffer";

            masterSock.addEventListener("open", function() {
                out.setUint32(p.key, config.master, true);
                out.setUint32(p.flags, f.connectionType.master | flags, true);
                masterSock.send(out.buffer);

                res();
            });

            masterSock.addEventListener("message", masterSockMsg);
            masterSock.addEventListener("error", disconnect);
            masterSock.addEventListener("close", disconnect);
        });

    });
}

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

    if (userMediaVideo) {
        userMediaVideo.getTracks().forEach(function(track) {
            track.stop();
        });
        userMediaVideo = null;
    }

    for (var id in rtcConnections.outgoing) {
        try {
            rtcConnections.outgoing[id].close();
        } catch (ex) {}
    }
    for (var id in rtcConnections.incoming) {
        try {
            rtcConnections.incoming[id].close();
        } catch (ex) {}
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
        case prot.ids.nack:
            // Just tell the user
            var p = prot.parts.nack;
            var text = decodeText(msg.buffer.slice(p.msg));
            alert(text);
            pushStatus("nack", text);
            break;

        case prot.ids.info:
            var p = prot.parts.info;
            var key = msg.getUint32(p.key, true);
            var val = 0;
            if (msg.byteLength >= p.length)
                val = msg.getUint32(p.value, true);
            switch (key) {
                case prot.info.id:
                    // Our own ID
                    selfId = val;
                    break;

                case prot.info.peerInitial:
                case prot.info.peerContinuing:
                    // We may need to start an RTC connection
                    if (useRTC) {
                        initRTC(val, false);
                        initRTC(val, true);
                    }
                    break;

                case prot.info.peerLost:
                    if (useRTC)
                        closeRTC(val);
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
                    if (mode < prot.mode.rec)
                        pushStatus("mode", "Not yet recording");
                    else if (mode === prot.mode.paused)
                        pushStatus("mode", "Recording paused");
                    else if (mode > prot.mode.rec)
                        pushStatus("mode", "Not recording");

                    // Mention flushing buffers if we are
                    if (mode === prot.mode.buffering) {
                        flushBuffers();
                    } else if (flushTimeout) {
                        clearTimeout(flushTimeout);
                        flushTimeout = null;
                    }

                    // Update the master interface
                    if ("master" in config)
                        configureMasterInterface();

                    break;

                case prot.info.startTime:
                    remoteBeginTime = msg.getFloat64(p.value, true);
                    break;

                case prot.info.recName:
                    recName = decodeText(msg.buffer.slice(p.value));
                    document.title = recName + " — Ennuicastr";
                    break;

                case prot.info.ice:
                    var iceServer = JSON.parse(decodeText(msg.buffer.slice(p.value)));
                    iceServers.push(iceServer);
                    break;
            }
            break;

        case prot.ids.sound:
            p = prot.parts.sound.sc;
            var status = msg.getUint8(p.status);
            var url = decodeText(msg.buffer.slice(p.url));
            playStopSound(url, status);
            break;

        case prot.ids.user:
            p = prot.parts.user;
            var index = msg.getUint32(p.index, true);
            var status = msg.getUint32(p.status, true);
            var nick = decodeText(msg.buffer.slice(p.nick));

            // Add it to the UI
            if (status)
                userListAdd(index, nick);
            else
                userListRemove(index, nick);
            break;

        case prot.ids.speech:
            if (useRTC) {
                // Handled through RTC
                break;
            }
            p = prot.parts.speech;
            var indexStatus = msg.getUint32(p.indexStatus, true);
            var index = indexStatus>>>1;
            var status = (indexStatus&1);
            userListUpdate(index, !!status);
            break;

        case prot.ids.rtc:
            var p = prot.parts.rtc;
            var peer = msg.getUint32(p.peer, true);
            var type = msg.getUint32(p.type, true);
            var conn, outgoing;
            if (type & 0x80000000) {
                // For *their* outgoing connection
                conn = rtcConnections.incoming[peer];
                outgoing = false;
            } else {
                conn = rtcConnections.outgoing[peer];
                outgoing = true;
            }
            if (!conn)
                break;

            var value = JSON.parse(decodeText(msg.buffer.slice(p.value)));

            switch (type&0x7F) {
                case prot.rtc.candidate:
                    if (value && value.candidate)
                        conn.addIceCandidate(value);
                    break;

                case prot.rtc.offer:
                    conn.setRemoteDescription(value).then(function() {
                        return conn.createAnswer();

                    }).then(function(answer) {
                        return conn.setLocalDescription(answer);

                    }).then(function() {
                        rtcSignal(peer, outgoing, prot.rtc.answer, conn.localDescription);

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

        case prot.ids.text:
            var p = prot.parts.text;
            var text = decodeText(msg.buffer.slice(p.text));
            recvChat(text);
            break;

        case prot.ids.admin:
            var p = prot.parts.admin;
            var acts = prot.flags.admin.actions;
            var action = msg.getUint32(p.action, true);
            if (action === acts.mute) {
                toggleMute(false);
            } else if (action === acts.echoCancel) {
                if (!ui.deviceList.ec.checked) {
                    ui.deviceList.ec.ecAdmin = true;
                    ui.deviceList.ec.checked = true;
                    ui.deviceList.ec.onchange();
                }
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
            var val = 0;
            if (msg.byteLength >= p.length)
                val = msg.getUint32(p.value, true);
            switch (key) {
                case prot.info.creditCost:
                    // Informing us of the cost of credits
                    var v2 = msg.getUint32(p.value + 4, true);
                    ui.masterUI.creditCost = {
                        currency: val,
                        credits: v2
                    };
                    break;

                case prot.info.creditRate:
                    // Informing us of the total cost and rate in credits
                    var v2 = msg.getUint32(p.value + 4, true);
                    ui.masterUI.creditRate = [val, v2];
                    masterUpdateCreditCost();
                    break;

                case prot.info.sounds:
                    // Soundboard items
                    val = decodeText(msg.buffer.slice(p.value));
                    addSoundButtons(JSON.parse(val));
                    break;
            }
            break;

        case prot.ids.user:
            p = prot.parts.user;
            var index = msg.getUint32(p.index, true);
            var status = msg.getUint32(p.status, true);
            var nick = decodeText(msg.buffer.slice(p.nick));

            // Add it to the UI
            var speech = ui.masterUI.speech = ui.masterUI.speech || [];
            while (speech.length <= index)
                speech.push(null);
            speech[index] = {
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
            if (!ui.masterUI.speech[index]) return;
            ui.masterUI.speech[index].speaking = !!status;
            updateMasterSpeech();
            break;
    }
}

// Flush our buffers
function flushBuffers() {
    if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
    }

    if (!dataSock) return;

    if (dataSock.bufferedAmount)
        pushStatus("buffering", "Sending audio to server (" + bytesToRepr(dataSock.bufferedAmount) + ")...");
    else
        popStatus("buffering");

    flushTimeout = setTimeout(function() {
        flushTimeout = null;
        flushBuffers();
    }, 1000);
}
