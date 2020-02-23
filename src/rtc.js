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
        userMediaAvailableEvent.addEventListener("ready", function() {
            initRTC(peer, start);
        });
        return;
    }

    if (rtcConnections[peer])
        rtcConnections[peer].close();

    var conn = rtcConnections[peer] = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ],
        iceTransportPolicy: "all"
    });
    var audioEl = null;

    conn.onicecandidate = function(c) {
        rtcSignal(peer, prot.rtc.candidate, c.candidate);
    };

    conn.ontrack = function(ev) {
        if (audioEl)
            return;

        audioEl = document.createElement("audio");
        document.body.appendChild(audioEl);
        audioEl.style.position = "absolute";
        audioEl.style.left = audioEl.style.top = "0px";
        audioEl.srcObject = ev.streams[0];
        audioEl.play().then(function() {
        }).catch(function(ex) {
            pushStatus("rtc", "Failed to play remote audio!");
        });
    };

    userMediaRTC.getTracks().forEach(function(track) {
        conn.addTrack(track, userMediaRTC);
    });

    if (start) {
        conn.createOffer().then(function(offer) {
            return conn.setLocalDescription(offer);

        }).then(function() {
            rtcSignal(peer, prot.rtc.offer, conn.localDescription);

        }).catch(function(ex) {
            pushStatus("rtc", "RTC connection failed!");

        });
    }
}
