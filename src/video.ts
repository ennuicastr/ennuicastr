/*
 * Copyright (c) 2018-2021 Yahweasel
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
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";

// The video device being read
export let userMediaVideo: MediaStream = null;

// The ID of the device being read
export let userMediaVideoID: string = null;

// Input latency of the video, in ms
export let videoLatency = 0;

// Called when there's a network disconnection
function disconnect() {
    if (userMediaVideo) {
        userMediaVideo.getTracks().forEach(function(track) {
            track.stop();
        });
        userMediaVideo = null;
    }
}
util.events.addEventListener("net.disconnect", disconnect);

// Get a camera/video device
export function getVideo(id: string, res: number): Promise<MediaStream> {
    return Promise.all([]).then(function() {
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
            const opts = {
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

    });

}

// Share a camera/video device
export function shareVideo(id: string, res: number): Promise<unknown> {
    return Promise.all([]).then(() => {
        // If we already have a video device, stop it first
        if (userMediaVideo) {
            userMediaVideo.getTracks().forEach(function(track) {
                track.stop();
            });
            userMediaVideo = null;
            util.dispatchEvent("usermediavideostopped", {});
        }

        // Then get the new device
        return getVideo(id, res);
        
    }).then(userMediaIn => {
        userMediaVideo = userMediaIn;

        // Our own video UI
        ui.videoAdd(net.selfId, config.username);
        const v = ui.ui.video.users[net.selfId].video;
        const s = ui.ui.video.users[net.selfId].standin;

        if (userMediaVideo) {
            // Remember the ID
            userMediaVideoID = id;

            // Get latency
            videoLatency = userMediaVideo.getVideoTracks()[0].getSettings().latency * 1000;

            // Inform RTC
            util.dispatchEvent("usermediavideoready", {});

            // Update the display
            v.srcObject = userMediaVideo;
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            v.play().catch(function(){});
            s.style.display = "none";

            // And update any admins
            net.updateAdminPerm({videoDevice: userMediaVideoID}, true);

        } else {
            // No video :(
            userMediaVideoID = null;
            videoLatency = 0;
            v.srcObject = audio.userMedia;
            v.srcObject = null;
            s.style.display = "";
            net.updateAdminPerm({videoDevice: "-none"}, true);

        }

        updateVideoButtons();

        if (!config.useRTC) {
            // We only *show* video if we have it
            ui.ui.video.mainWrapper.style.display = userMediaVideo ? "" : "none";
            ui.updateVideoUI(net.selfId);
            ui.resizeUI();
        }

    }).catch(() => {
        log.pushStatus("video", "Failed to capture video!");
        setTimeout(function() {
            log.popStatus("video");
        }, 10000);
        updateVideoButtons();

    });

}

// Update the persistent video buttons based on the current video state
export function updateVideoButtons(): void {
    let per = ui.ui.persistent;
    let cam = per.camera;
    let scr = per.shareScreen;
    let videoConfig = ui.ui.panels.videoConfig;

    // By default: both are off and set to enable
    cam.setAttribute("aria-label", "Camera");
    cam.innerHTML = '<i class="fas fa-video-slash"></i><span class="menu-extra">Camera</span>';
    cam.onclick = function() {
        if (videoConfig.device.value !== "-none") {
            // We can share it directly
            shareVideo(videoConfig.device.value, +videoConfig.res.value);

        } else {
            // Need to ask how
            ui.showPanel(videoConfig, videoConfig.device);

        }
    };

    scr.setAttribute("aria-label", "Share your screen");
    scr.innerHTML = '<i class="fas fa-desktop" style="position: relative;"><i class="fas fa-slash" style="position: absolute; left: -0.1em;"></i></i><span class="menu-extra">Share your screen</span>';
    scr.onclick = function() {
        shareVideo("-screen", 0);
    };


    // Switch it based on our current mode
    if (userMediaVideoID === "-screen") {
        // We're in screen-share mode, so make it a disable button
        scr.setAttribute("aria-label", "Stop sharing your screen");
        scr.innerHTML = '<i class="fas fa-desktop"></i><span class="menu-extra">Stop sharing your screen</span>';
        scr.onclick = function() {
            shareVideo("-none", 0);
        };

    } else if (userMediaVideoID !== null) {
        // We're sharing the camera, so click it to stop
        cam.setAttribute("aria-label", "Disable camera");
        cam.innerHTML = '<i class="fas fa-video"></i><span class="menu-extra">Disable camera</span>';
        cam.onclick = function() {
            shareVideo("-none", 0);
        };

    }
}

// Video admin events
util.events.addEventListener("net.admin.video", function(ev: CustomEvent) {
    const action: number = ev.detail.action;
    const arg: string = ev.detail.arg;
    const acts = prot.flags.admin.actions;

    switch (action) {
        case acts.videoInput:
            // FIXME: Better way to do this setting
            ui.ui.panels.videoConfig.device.value = arg;
            net.updateAdminPerm({videoDevice: arg});
            shareVideo(arg, +ui.ui.panels.videoConfig.res.value);
            break;

        case acts.videoRes:
            // FIXME: Better way to do this setting
            ui.ui.panels.videoConfig.res.value = arg;
            net.updateAdminPerm({videoRes: +arg});
            shareVideo(ui.ui.panels.videoConfig.device.value, +arg);
            break;
    }
});
