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
        if (!ac) {
            userMediaAvailableEvent.addEventListener("usermediaready", function() {
                conn.ontrack(ev);
            }, {once: true});
            return;
        }

        // Get out the information
        var track = ev.track;
        var stream = ev.streams[0];
        var isVideo = (track.kind === "video");
        mkUI(true);

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
        userMediaAvailableEvent.addEventListener("usermediaready", addTracks);
        userMediaAvailableEvent.addEventListener("usermediavideoready", addVideoTracks);
        userMediaAvailableEvent.addEventListener("usermediastopped", removeTracks);
        userMediaAvailableEvent.addEventListener("usermediavideostopped", removeTracks);

        conn.onsignalingstatechange = function() {
            if (conn.signalingState === "closed") {
                // Don't send any new events
                userMediaAvailableEvent.removeEventListener("usermediaready", addTracks);
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
        userMediaAvailableEvent.addEventListener("usermediaready", function() {
            playRTCEl(el);
        }, {once: true});
        return;
    }

    el.play().catch(function(ex) {
        pushStatus("rtc", "Failed to play remote audio!");
    });
}

// Receive a data channel message from an RTC peer
function rtcMessage(peer, msg) {
    if (msg.byteLength < 4) return;
    var cmd = msg.getUint32(0, true);

    switch (cmd) {
        case prot.ids.speech:
            // User speech status
            var p = prot.parts.speech;
            if (msg.byteLength < p.length) return;
            var status = !!msg.getUint32(p.indexStatus, true);
            updateSpeech(peer, status);
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

/* Create the RTC version of a UserMedia, which just has a slight delay to make
 * up for VAD */
function createUserMediaRTC() {
    var stream = ac.createMediaStreamSource(userMedia);
    var delay = ac.createDelay();
    delay.delayTime.value = 0.04;
    var dest = ac.createMediaStreamDestination();
    var output = dest.stream;

    // Store all the context in the output for later destruction
    output.ennuicastr = {
        stream: stream,
        delay: delay,
        dest: dest
    };

    // Connect it up
    stream.connect(delay);
    delay.connect(dest);
    return output;
}

// Destroy a UserMediaRTC
function destroyUserMediaRTC(userMediaRTC) {
    userMediaRTC.getTracks().forEach(function(track) { track.stop(); });
    var ec = userMediaRTC.ennuicastr;
    ec.stream.disconnect(ec.delay);
    ec.delay.disconnect(ec.dest);
}

// En/disable tracks for RTC transmission
function rtcVad(to) {
    userMediaRTC.getAudioTracks().forEach(function(track) {
        track.enabled = to;
    });
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
