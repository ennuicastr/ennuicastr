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

// The main entry point
function main() {
    return Promise.all([]).then(function() {
        mkUI();
        return connect();
    }).then(function() {
        return getMic();
    }).catch(function(ex) {
        pushStatus("error", ex + "\n\n" + ex.stack);
    });
}
main();

// Get a camera/video device
function getCamera(id) {
    return Promise.all([]).then(function() {
        // If we already have a video device, stop it first
        if (userMediaVideo) {
            userMediaVideo.getTracks().forEach(function(track) {
                track.stop();
            });
            userMediaVideo = null;
            userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediavideostopped", {}));
        }

        // Now request the new one
        if (id === "-screen") {
            // Special pseudo-device: Grab the screen
            return navigator.mediaDevices.getDisplayMedia({
                video: true
            });

        } else if (id === "-none") {
            // Special pseudo-device: No
            return null;

        } else {
            return navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: id,
                    aspectRatio: {ideal: 16/9},
                    facingMode: {ideal: "user"},
                    frameRate: {ideal: 30},
                    height: {ideal: 720}
                }
            });
        }

    }).then(function(userMediaIn) {
        userMediaVideo = userMediaIn;
        if (userMediaVideo) {
            // Inform RTC
            userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediavideoready", {}));

            // And update the display
            ui.video.self.srcObject = userMediaVideo;
            ui.video.self.play().catch(function(){});
            ui.video.hasVideo[0] = true;

        } else {
            // No video :(
            ui.video.self.srcObject = null;
            ui.video.hasVideo[0] = false;

        }
        updateVideoUI(0, false);

    }).catch(function(err) {
        pushStatus("video", "Failed to capture video!");
        setTimeout(function() {
            popStatus("video");
        }, 10000);

    });

}

// Set the output device
function setOutputDevice(deviceId) {
    // Set it as the default
    outputDeviceId = deviceId;

    // Set it on all currently active outputs
    var p = Promise.all([]);
    ui.video.els.forEach(function(el) {
        if (!el) return;
        p = p.then(function() {
            return el.setSinkId(deviceId);
        });
    });
}

// Update speech info everywhere that needs it. peer===null is self
function updateSpeech(peer, status) {
    // In video, to avoid races, peer 0 is us, not selfId
    var vpeer = peer;

    if (peer === null) {
        // Set the VAD
        vadOn = status;

        // Send the update to all RTC peers
        rtcSpeech(status);
        peer = selfId;
        vpeer = 0;
    }

    // Update the user list
    userListUpdate(peer, status);

    // Update video speech info
    if (!ui.video) return;
    if (status)
        ui.video.speech[vpeer] = performance.now();
    else
        delete ui.video.speech[vpeer];
    updateVideoUI(vpeer, false);
}

// Generic phone-home error handler
function errorHandler(error) {
    var errBuf = encodeText(error + "\n\n" + navigator.userAgent);
    var out = new DataView(new ArrayBuffer(4 + errBuf.length));
    out.setUint32(0, prot.ids.error, true);
    new Uint8Array(out.buffer).set(errBuf, 4);
    dataSock.send(out.buffer);
}

// Generic library loader
function loadLibrary(name) {
    return new Promise(function(res, rej) {
        var scr = dce("script");
        scr.addEventListener("load", res);
        scr.addEventListener("error", rej);
        scr.src = name;
        scr.async = true;
        document.body.appendChild(scr);
    });
}


// If we're buffering, warn before closing
window.onbeforeunload = function() {
    if (mode === prot.mode.buffering && dataSock.bufferedAmount)
        return "Data is still buffering to the server!";
}
