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

// Send an RTC signaling message
function rtcSignal(peer, outgoing, type, value) {
    var buf = encodeText(JSON.stringify(value));
    var p = prot.parts.rtc;
    var out = new DataView(new ArrayBuffer(p.length + buf.length));
    out.setUint32(0, prot.ids.rtc, true);
    out.setUint32(p.peer, peer, true);
    out.setUint32(p.type, (outgoing?0x80000000:0)|type, true);
    new Uint8Array(out.buffer).set(buf, p.value);
    dataSock.send(out.buffer);
}

// Initialize a connection to an RTC peer
function initRTC(peer, outgoing) {
    // Which set are we in?
    var group;
    if (outgoing)
        group = rtcConnections.outgoing;
    else
        group = rtcConnections.incoming;

    if (group[peer])
        group[peer].close();

    var conn = group[peer] = new RTCPeerConnection({
        iceServers: iceServers,
        iceTransportPolicy: "all"
    });
    var videoEl = null, compressor = null;

    conn.onicecandidate = function(c) {
        rtcSignal(peer, outgoing, prot.rtc.candidate, c.candidate);
    };

    // Called when we get a new track
    if (!outgoing)
    conn.ontrack = function(ev) {
        // If we haven't yet approved audio, then we're not ready for this track
        if (!userMediaRTC) {
            userMediaAvailableEvent.addEventListener("usermediartcready", function() {
                conn.ontrack(ev);
            }, {once: true});
            return;
        }

        // Get out the information
        var track = ev.track;
        var stream = ev.streams[0];
        var isVideo = (track.kind === "video");

        if (!stream) return;

        // Check for a new stream
        if (compressor && compressor.inputStream !== stream) {
            // New stream for this user
            destroyCompressor(peer);
            compressor = null;
        }

        // Make the compressor
        if (!compressor)
            compressor = createCompressor(peer, ac, stream);

        // Remove any existing tracks of the same kind
        stream.getTracks().forEach(function(otrack) {
            if (track !== otrack && track.kind === otrack.kind)
                stream.removeTrack(otrack);
        });

        // Prepare for tracks to end
        stream.onremovetrack = function() {
            videoEl.srcObject = stream;
            playRTCEl(videoEl);
            videoEl = reassessRTCEl(peer, !!stream.getTracks().length, !!stream.getVideoTracks().length);
        };

        if (videoEl) {
            // Reset the stream
            videoEl.srcObject = stream;
            playRTCEl(videoEl);

            // Remember if it's a video track
            if (isVideo && !ui.video.hasVideo[peer]) {
                ui.video.hasVideo[peer] = true;
                updateVideoUI(peer, false);
            }
            return;
        }

        /* We have a separate video and audio element so that the audio can
         * reliably go through AudioContext while the video is used directly. */

        // Create the video element
        videoEl = dce("video");
        videoEl.height = 0; // Use CSS for sizing
        videoEl.muted = true; // In the audio element
        videoEl.style.maxWidth = "100%";
        videoEl.srcObject = stream;

        // Add it to the UI
        var els = ui.video.els;
        var hasVideo = ui.video.hasVideo;
        while (els.length <= peer) {
            els.push(null);
            hasVideo.push(false);
        }
        els[peer] = videoEl;
        hasVideo[peer] = isVideo;
        updateVideoUI(peer, true);

        // Then play it
        playRTCEl(videoEl);
    };

    conn.oniceconnectionstatechange = function(ev) {
        switch (conn.iceConnectionState) {
            case "failed":
                // report the failure
                rtcFail();
                break;

            case "closed":
                // attempt reconnection
                initRTC(peer, outgoing);
                break;
        }
    };

    // Add each track to the connection
    function addTracks() {
        userMediaRTC.getTracks().forEach(function(track) {
            conn.addTrack(track, userMediaRTC);
        });
    }
    if (outgoing && userMediaRTC)
        addTracks();

    // Add video tracks to the connection
    function addVideoTracks() {
        userMediaVideo.getTracks().forEach(function(track) {
            conn.addTrack(track, userMediaRTC);
        });
    }
    if (outgoing && userMediaVideo)
        addVideoTracks();

    // Remove any inactive tracks from the connection
    function removeTracks() {
        // Figure out which tracks should stay
        var tracks = {};
        function listTracks(from) {
            from.getTracks().forEach(function(track) {
                tracks[track.id] = true;
            });
        }
        if (userMediaRTC) listTracks(userMediaRTC);
        if (userMediaVideo) listTracks(userMediaVideo);

        // Then remove any tracks that should go
        conn.getSenders().forEach(function(sender) {
            var track = sender.track;
            if (!track) return;
            if (!tracks[track.id])
                conn.removeTrack(sender);
        });
    }

    // If we switch UserMedia, we'll need to re-up
    if (outgoing) {
        userMediaAvailableEvent.addEventListener("usermediartcready", addTracks);
        userMediaAvailableEvent.addEventListener("usermediavideoready", addVideoTracks);
        userMediaAvailableEvent.addEventListener("usermediastopped", removeTracks);
        userMediaAvailableEvent.addEventListener("usermediavideostopped", removeTracks);

        conn.onsignalingstatechange = function() {
            if (conn.signalingState === "closed") {
                // Don't send any new events
                userMediaAvailableEvent.removeEventListener("usermediartcready", addTracks);
                userMediaAvailableEvent.removeEventListener("usermediavideoready", addVideoTracks);
                userMediaAvailableEvent.removeEventListener("usermediastopped", removeTracks);
                userMediaAvailableEvent.removeEventListener("usermediavideostopped", removeTracks);
            }
        };
    }

    // Make a data channel for speech status
    if (outgoing) {
        var chan = conn.ecDataChannel = conn.createDataChannel("ennuicastr");
        chan.binaryType = "arraybuffer";
        chan.onopen = function() {
            rtcSpeech(vadOn, peer);
            if ("master" in config)
                rtcVideoRecSend(void 0, prot.videoRec.videoRecHost, ~~ui.masterUI.acceptRemoteVideo.checked);
        };

    } else {
        conn.ondatachannel = function(ev) {
            ev.channel.binaryType = "arraybuffer";
            ev.channel.onmessage = function(msg) {
                msg = new DataView(msg.data);
                rtcMessage(peer, msg);
            };
        };
    }

    // Outgoing negotiation function
    function connect() {
        conn.createOffer({voiceActivityDetection: true}).then(function(offer) {
            return conn.setLocalDescription(offer);

        }).then(function() {
            rtcSignal(peer, outgoing, prot.rtc.offer, conn.localDescription);

        }).catch(function(ex) {
            rtcFail();

        });
    }

    conn.onnegotiationneeded = connect;
}

// Close an RTC connection when a peer disconnects
function closeRTC(peer) {
    ["outgoing", "incoming"].forEach(function(group) {
        var conn = rtcConnections[group][peer];
        if (!conn)
            return;
        conn.close();
    });
    reassessRTCEl(peer, false, false);
}

// Reassess the properties of the RTC element for this peer
function reassessRTCEl(peer, hasTracks, hasVideo) {
    var el = ui.video.els[peer];
    if (!el)
        return null;

    if (!hasTracks) {
        // Destroy it
        el.pause();
        try {
            el.parentNode.removeChild(el);
        } catch (ex) {}
        el = ui.video.els[peer] = null;
    }
    ui.video.hasVideo[peer] = hasVideo;
    updateVideoUI(peer, false);
    return el;
}

// Play an element used by RTC, once that's possible
function playRTCEl(el) {
    if (!userMediaRTC) {
        /* Although our own UserMedia isn't technically needed to play, it's
         * needed to *auto*play on many platforms, so wait for it. */
        userMediaAvailableEvent.addEventListener("usermediartcready", function() {
            playRTCEl(el);
        }, {once: true});
        return;
    }

    el.play();
}

// Receive a data channel message from an RTC peer
function rtcMessage(peer, msg) {
    if (msg.byteLength < 4) return;
    var cmd = msg.getUint32(0, true);
    console.log("Command " + cmd.toString(16) + " from " + peer);

    switch (cmd) {
        case prot.ids.data:
            console.error("Received " + (msg.byteLength-4));
            try {
                rtcConnections.incoming[peer].ecVideoRecord.write((new Uint8Array(msg.buffer)).subarray(4));
            } catch (ex) {
                console.error(ex);
            }
            break;

        case prot.ids.speech:
            // User speech status
            var p = prot.parts.speech;
            if (msg.byteLength < p.length) return;
            var status = !!msg.getUint32(p.indexStatus, true);
            updateSpeech(peer, status);
            break;

        case prot.ids.videoRec:
            // Video recording related messages
            var p = prot.parts.videoRec;
            var pv = prot.videoRec;
            if (msg.byteLength < p.length) return;
            var cmd = msg.getUint32(p.cmd, true);

            switch (cmd) {
                case pv.videoRecHost:
                    var accept = 0;
                    try {
                        accept = msg.getUint32(p.length, true);
                    } catch (ex) {}
                    if (accept)
                        rtcConnections.videoRecHost = peer; // FIXME: Deal with disconnections
                    else if (rtcConnections.videoRecHost === peer)
                        rtcConnections.videoRecHost = -1;
                    break;

                case pv.startVideoRecReq:
                    if ("master" in config &&
                        ui.masterUI.acceptRemoteVideo.checked &&
                        rtcConnections.incoming[peer]) {

                        recordVideoRemoteIncoming(peer).then(function(fileWriter) {
                            rtcVideoRecSend(peer, prot.videoRec.startVideoRecRes, 1);
                            if (rtcConnections.incoming[peer])
                                rtcConnections.incoming[peer].ecVideoRecord = fileWriter;
                            else
                                fileWriter.close();
                        });

                    } else {
                        rtcVideoRecSend(peer, prot.videoRec.startVideoRecRes, 0);

                    }
                    break;

                case pv.startVideoRecRes:
                    // Only if we actually *wanted* them to accept video!
                    if (recordVideoRemoteOK && peer === rtcConnections.videoRecHost)
                        recordVideoRemoteOK(peer);
                    break;

                case pv.endVideoRec:
                    try {
                        rtcConnections.incoming[peer].ecVideoRecord.close();
                        delete rtcConnections.incoming[peer].ecVideoRecord;
                    } catch (ex) {
                        console.error(ex);
                    }
                    break;
            }
            break;
    }
}

// Send a speech message to every RTC peer, or a specific peer
function rtcSpeech(status, peer) {
    if (!useRTC) return;

    // Build the message
    var p = prot.parts.speech;
    var msg = new DataView(new ArrayBuffer(p.length));
    msg.setUint32(0, prot.ids.speech, true);
    msg.setUint32(p.indexStatus, status?1:0, true);
    msg = msg.buffer;

    // Maybe just send it to the specified peer
    if (typeof peer !== "undefined") {
        try {
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
        } catch (ex) {}
        return;
    }

    // Send it everywhere
    for (peer in rtcConnections.outgoing) {
        try {
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
        } catch (ex) {}
    }
}

// Send an RTC video recording message
function rtcVideoRecSend(peer, cmd, payloadData) {
    if (!useRTC) return;

    // Build the payload
    var payload;
    if (typeof payloadData === "number") {
        payload = new DataView(new ArrayBuffer(4));
        payload.setUint32(0, payloadData, true);

    } else if (typeof payloadData === "object") {
        payload = encodeText(JSON.stringify(payload));

    } else {
        payload = new Uint8Array(0);

    }

    // Build the message
    var p = prot.parts.videoRec;
    var msg = new DataView(new ArrayBuffer(p.length + payload.byteLength));
    msg.setUint32(0, prot.ids.videoRec, true);
    msg.setUint32(p.cmd, cmd, true);
    new Uint8Array(msg.buffer).set(new Uint8Array(payload.buffer), p.length);

    // And send it
    if (typeof peer !== "undefined") {
        try {
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
        } catch (ex) {}
        return;
    }

    for (peer in rtcConnections.outgoing) {
        try {
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
        } catch (ex) {}
    }
}

// Send data to an RTC peer
function rtcDataSend(peer, buf) {
    var p = prot.parts.data;

    // Send 16k at a time
    for (var start = 0; start < buf.length; start += 16380) {
        var part = buf.subarray(start, start + 16380);
        var msg = new DataView(new ArrayBuffer(4 + part.length));
        msg.setUint32(0, prot.ids.data, true);
        new Uint8Array(msg.buffer).set(part, 4);
        console.error("Actually sending " + msg.byteLength);

        try {
            rtcConnections.outgoing[peer].ecDataChannel.send(msg);
        } catch (ex) {
            console.error(ex);
        }
    }
}

// Create the RTC version of UserMedia, with noise suppression
function createUserMediaRTC() {
    if (typeof webkitAudioContext !== "undefined") {
        // Safari gets angry if you ask for the same device twice
        return new Promise(function(res) {
            res(userMedia.clone());
        });
    }

    /* Here's the big idea: We want a specialized version of our usermedia with
     * two changed properties:
     * (1) Noise suppression ON, and
     * (2) A brief delay, to react properly to the VAD.
     *
     * We do this by requesting a new UserMedia, then feeding it through
     * AudioContext's DelayNode.
     */
    var deviceId = userMedia.getTracks()[0].getSettings().deviceId;
    console.log("Device ID: " + deviceId);

    return navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: deviceId,
            autoGainControl: plzno,
            echoCancellation: plzno,
            noiseSuppression: plzyes
        }

    }).then(function(um) {
        // Make sure it actually gave us what we asked for
        if (um.getTracks()[0].getSettings().deviceId !== deviceId) {
            // Thanks for the lie!
            um.getTracks().forEach(function(track) { track.stop(); });
            um = userMedia.clone();
        }

        // Make the delay components
        var stream = ac.createMediaStreamSource(um);
        var delay = ac.createDelay();
        delay.delayTime.value = 0.04;
        var dest = ac.createMediaStreamDestination();
        var output = dest.stream;

        // Store all the context in the output for later destruction
        output.ennuicastr = {
            userMedia: um,
            stream: stream,
            delay: delay,
            dest: dest
        };

        // Connect it up
        stream.connect(delay);
        delay.connect(dest);
        return output;

    });
}

// Destroy a UserMediaRTC
function destroyUserMediaRTC(userMediaRTC) {
    userMediaRTC.getTracks().forEach(function(track) { track.stop(); });
    var ec = userMediaRTC.ennuicastr;
    ec.userMedia.getTracks().forEach(function(track) { track.stop(); });
    ec.stream.disconnect(ec.delay);
    ec.delay.disconnect(ec.dest);
}

// Notify of a failed RTC connection
function rtcFail() {
    if (rtcFailTimeout)
        clearTimeout(rtcFailTimeout);
    pushStatus("rtc", "RTC connection failed!");
    rtcFailTimeout = setTimeout(function() {
        rtcFailTimeout = null;
        popStatus("rtc");
    }, 10000);
}
var rtcFailTimeout = null;
