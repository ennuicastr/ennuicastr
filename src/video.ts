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
import * as util from "./util";

// The video device being read
export var userMediaVideo: MediaStream = null;

// Input latency of the video, in ms
export var videoLatency = 0;

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
export function getCamera(id: string, res: number) {
    return Promise.all([]).then(function() {
        // If we already have a video device, stop it first
        if (userMediaVideo) {
            userMediaVideo.getTracks().forEach(function(track) {
                track.stop();
            });
            userMediaVideo = null;
            util.dispatchEvent("usermediavideostopped", {});
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
            // Try max res, then ideal res
            let opts = {
                deviceId: id,
                aspectRatio: {ideal: 16/9},
                facingMode: {ideal: "user"},
                frameRate: {ideal: 30},
                height: <any> {max: res}
            };
            if (res === 0)
                delete opts.height;
            return navigator.mediaDevices.getUserMedia({video: opts}).then(function(ret) {
                if (ret) {
                    return ret;
                } else {
                    opts.height = {ideal: res};
                    return navigator.mediaDevices.getUserMedia({video: opts});
                }
            });
        }

    }).then(function(userMediaIn) {
        userMediaVideo = userMediaIn;
        var inl: number;
        if (userMediaVideo)
            inl = userMediaVideo.getVideoTracks()[0].getSettings().latency;
        else
            inl = 0;
        if (inl)
            videoLatency = inl * 1000;
        else
            videoLatency = 0;

        ui.videoAdd(net.selfId, config.username);
        var v = ui.ui.video.users[net.selfId].video;
        var s = ui.ui.video.users[net.selfId].standin;
        if (userMediaVideo) {
            // Inform RTC
            util.dispatchEvent("usermediavideoready", {});

            // And update the display
            v.srcObject = userMediaVideo;
            v.play().catch(function(){});
            s.style.display = "none";

        } else {
            // No video :(
            v.srcObject = audio.userMedia;
            v.srcObject = null;
            s.style.display = "";

        }

        if (!config.useRTC) {
            // We only *show* video if we have it
            ui.ui.video.mainWrapper.style.display = userMediaVideo ? "" : "none";
            ui.updateVideoUI(net.selfId);
            ui.resizeUI();
        }

    }).catch(function(err) {
        log.pushStatus("video", "Failed to capture video!");
        setTimeout(function() {
            log.popStatus("video");
        }, 10000);

    });

}
