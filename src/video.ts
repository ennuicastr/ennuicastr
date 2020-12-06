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

import * as audio from "./audio";
import * as config from "./config";
import * as log from "./log";
import * as net from "./net";
import * as ui from "./ui";

// The video device being read
export var userMediaVideo: MediaStream = null;

// Called when there's a network disconnection
export function disconnect() {
    if (userMediaVideo) {
        userMediaVideo.getTracks().forEach(function(track) {
            track.stop();
        });
        userMediaVideo = null;
    }
}

// Get a camera/video device
export function getCamera(id: string) {
    return Promise.all([]).then(function() {
        // If we already have a video device, stop it first
        if (userMediaVideo) {
            userMediaVideo.getTracks().forEach(function(track) {
                track.stop();
            });
            userMediaVideo = null;
            audio.userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediavideostopped", {}));
        }

        // Now request the new one
        if (id === "-screen") {
            // Special pseudo-device: Grab the screen
            return (<any> navigator.mediaDevices).getDisplayMedia({
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
        ui.videoAdd(net.selfId, config.username);
        var v = ui.ui.video.users[net.selfId].video;
        if (userMediaVideo) {
            // Inform RTC
            audio.userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediavideoready", {}));

            // And update the display
            v.srcObject = userMediaVideo;
            v.play().catch(function(){});

        } else {
            // No video :(
            v.srcObject = null;

        }

    }).catch(function(err) {
        log.pushStatus("video", "Failed to capture video!");
        setTimeout(function() {
            log.popStatus("video");
        }, 10000);

    });

}
