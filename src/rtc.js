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
    var el = null;

    conn.onicecandidate = function(c) {
        rtcSignal(peer, outgoing, prot.rtc.candidate, c.candidate);
    };

    // Called when we get a new track
    if (!outgoing)
    conn.ontrack = function(ev) {
        var track = ev.track;
        var stream = ev.streams[0];
        var isVideo = (track.kind === "video");
        mkUI(true);

        if (!stream) return;

        // Remove any existing tracks of the same kind
        stream.getTracks().forEach(function(otrack) {
            if (track !== otrack && track.kind === otrack.kind)
                stream.removeTrack(otrack);
        });

        // Prepare for tracks to end
        stream.onremovetrack = function() {
            el.srcObject = stream;
            el.play().catch(function(){});
            el = reassessRTCEl(peer, !!stream.getTracks().length, !!stream.getVideoTracks().length);
        };

        if (el) {
            // Reset the stream
            el.srcObject = stream;
            el.play().catch(function(){});

            // Remember if it's a video track
            if (isVideo && !ui.video.hasVideo[peer]) {
                ui.video.hasVideo[peer] = true;
                updateVideoUI(peer, false);
            }
            return;
        }

        // Create this element
        el = dce("video");
        el.height = 0; // Use CSS for sizing
        el.style.maxWidth = "100%";
        el.srcObject = stream;

        // Add it to the UI
        var els = ui.video.els;
        var hasVideo = ui.video.hasVideo;
        while (els.length <= peer) {
            els.push(null);
            hasVideo.push(false);
        }
        els[peer] = el;
        hasVideo[peer] = isVideo;
        updateVideoUI(peer, true);

        // Then play it
        el.play().then(function() {
        }).catch(function(ex) {
            pushStatus("rtc", "Failed to play remote audio!");
        });
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
        userMedia.getTracks().forEach(function(track) {
            conn.addTrack(track, userMedia);
        });
    }
    if (outgoing && userMedia)
        addTracks();

    // Add video tracks to the connection
    function addVideoTracks() {
        userMediaVideo.getTracks().forEach(function(track) {
            conn.addTrack(track, userMedia);
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
        if (userMedia) listTracks(userMedia);
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

    // Outgoing negotiation function
    function connect() {
        conn.createOffer().then(function(offer) {
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
