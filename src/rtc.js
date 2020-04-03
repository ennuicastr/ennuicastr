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
function rtcSignal(peer, type, value) {
    var buf = encodeText(JSON.stringify(value));
    var p = prot.parts.rtc;
    var out = new DataView(new ArrayBuffer(p.length + buf.length));
    out.setUint32(0, prot.ids.rtc, true);
    out.setUint32(p.peer, peer, true);
    out.setUint32(p.type, type, true);
    new Uint8Array(out.buffer).set(buf, p.value);
    dataSock.send(out.buffer);
}

// Initialize a connection to an RTC peer
function initRTC(peer, start) {
    if (!userMediaRTC) {
        // We need userMediaRTC to even start this process
        userMediaAvailableEvent.addEventListener("usermediaready", function() {
            initRTC(peer, start);
        }, {once: true});
        return;
    }

    if (rtcConnections[peer])
        rtcConnections[peer].close();

    var conn = rtcConnections[peer] = new RTCPeerConnection({
        iceServers: iceServers,
        iceTransportPolicy: "all"
    });
    var el = null;

    conn.onicecandidate = function(c) {
        rtcSignal(peer, prot.rtc.candidate, c.candidate);
    };

    conn.ontrack = function(ev) {
        var isVideo = (ev.track.kind === "video");
        mkUI();

        if (el) {
            // Remember if it's a video track
            if (isVideo && !ui.video.hasVideo[peer]) {
                ui.video.hasVideo[peer] = true;
                updateVideoUI(peer);
            }
            return;
        }

        // Create this element
        var stream = ev.streams[0];
        el = dce("video");
        el.height = 0; // Use CSS for sizing
        el.style.maxWidth = "100%";
        el.srcObject = ev.streams[0];

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

        // Prepare for its destruction
        stream.onremovetrack = function() {
            var hasTracks = (stream.getTracks().length !== 0);
            var hasVideo = (stream.getVideoTracks().length !== 0);
            reassessRTCEl(peer, hasTracks, hasVideo);
        };
    };

    conn.oniceconnectionstatechange = function(ev) {
        switch (conn.iceConnectionState) {
            case "failed":
                // report the failure
                rtcFail();
                break;

            case "closed":
                // attempt reconnection
                if (start)
                    connect();
                break;
        }
    };

    // Add each track to the connection
    function addTracks() {
        userMediaRTC.getTracks().forEach(function(track) {
            conn.addTrack(track, userMediaRTC);
        });
    }
    addTracks();

    // Add video tracks to the connection
    function addVideoTracks() {
        userMediaVideo.getTracks().forEach(function(track) {
            console.log(track);
            conn.addTrack(track, userMediaRTC);
        });
    }
    if (userMediaVideo)
        addVideoTracks();

    // If we switch UserMedia, we'll need to re-up
    userMediaAvailableEvent.addEventListener("usermediaready", addTracks);
    userMediaAvailableEvent.addEventListener("usermediavideoready", addVideoTracks);

    // Initial connection function
    function connect() {
        conn.createOffer().then(function(offer) {
            return conn.setLocalDescription(offer);

        }).then(function() {
            rtcSignal(peer, prot.rtc.offer, conn.localDescription);

        }).catch(function(ex) {
            rtcFail();

        });
    }

    // We do the initial connection if we start
    if (start) {
        connect();
    }
}

// Close an RTC connection when a peer disconnects
function closeRTC(peer) {
    var conn = rtcConnections[peer];
    if (!conn)
        return;
    conn.close();
    reassessRTCEl(peer, false, false);
}

// Reassess the properties of the RTC element for this peer
function reassessRTCEl(peer, hasTracks, hasVideo) {
    var el = ui.video.els[peer];
    if (!el)
        return;

    if (!hasTracks) {
        // Destroy it
        el.pause();
        try {
            el.parentNode.removeChild(el);
        } catch (ex) {}
        ui.video.els[peer] = null;
    }
    ui.video.hasVideo[peer] = hasVideo;
    updateVideoUI(peer);
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
