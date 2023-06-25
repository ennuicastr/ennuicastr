/*
 * Copyright (c) 2018-2023 Yahweasel
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

/*
 * This file is part of Ennuicastr.
 *
 * Video capture and communication.
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

// The type of the video ("camera" or "desktop")
export let userMediaVideoType: string = null;

// The ID of the device being read
export let userMediaVideoID: string = null;

// Input latency of the video, in ms
export let videoLatency = 0;

// Get a camera/video device
export function getVideo(id: string, res: number): Promise<MediaStream> {
    return Promise.all([]).then(function() {
        // Now request the new one
        if (id === "-screen") {
            // Special pseudo-device: Grab the screen
            return (<any> navigator.mediaDevices).getDisplayMedia({
                video: {
                    cursor: {ideal: "motion"}
                }
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
                height: <any> {ideal: res, max: res}
            };
            if (res === 0)
                opts.height = {ideal: 17280};
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
            userMediaVideoType = null;
            util.dispatchEvent("usermediavideostopped", {});
        }

        // Then get the new device
        return getVideo(id, res);
        
    }).then(userMediaIn => {
        userMediaVideo = userMediaIn;
        if (userMediaIn) {
            if (id === "-screen")
                userMediaVideoType = "desktop";
            else
                userMediaVideoType = "camera";
        } else {
            userMediaVideoType = null;
        }

        // Our own video UI
        ui.videoAdd(net.selfId, config.username);
        const v = ui.ui.video.users[net.selfId].video;
        const s = ui.ui.video.users[net.selfId].standin;

        if (userMediaVideo) {
            // Remember the ID
            userMediaVideoID = id;

            // Get latency
            videoLatency = ((<any> userMediaVideo.getVideoTracks()[0].getSettings()).latency * 1000) || 0;

            // Inform RTC
            util.dispatchEvent("usermediavideoready", {});

            // Update the display
            v.srcObject = userMediaVideo;
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            v.play().catch(function(){});
            s.style.display = "none";
            v.style.display = "";

            // And update any admins
            net.updateAdminPerm({videoDevice: userMediaVideoID}, true);

        } else {
            // No video :(
            userMediaVideoID = null;
            videoLatency = 0;
            v.srcObject = audio.inputs[0].userMedia;
            v.srcObject = null;
            s.style.display = "";
            v.style.display = "none";
            net.updateAdminPerm({videoDevice: "-none"}, true);

        }

        updateVideoButtons();

        /* FIXME?
        if (!config.useRTC) {
            // We only *show* video if we have it
            ui.ui.video.mainWrapper.style.display = userMediaVideo ? "" : "none";
            ui.updateVideoUI(net.selfId);
            ui.resizeUI();
        }
        */

    }).catch(() => {
        log.pushStatus("video", "Failed to capture video!", {
            timeout: 10000
        });
        updateVideoButtons();

    });

}

// Update the persistent video buttons based on the current video state
export function updateVideoButtons(): void {
    const per = ui.ui.mainMenu;
    const cam = per.shareVideo;
    const scr = per.shareScreen;
    const videoConfig = ui.ui.panels.videoConfig;

    // By default: both are off and set to enable
    cam.setAttribute("aria-label", "Camera");
    cam.innerHTML = '<i class="bx bx-video-off"></i><span class="menu-button-lbox"><span class="menu-button-label">Share<br/>Camera</span></span>';
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
    scr.innerHTML = '<i class="bx bx-window-close"></i><span class="menu-button-lbox"><span class="menu-button-label">Share<br/>Screen</span></span>';
    scr.onclick = function() {
        shareVideo("-screen", 0);
    };
    if (!(<any> navigator.mediaDevices).getDisplayMedia) {
        scr.style.display = "none";
    }


    // Switch it based on our current mode
    if (userMediaVideoID === "-screen") {
        // We're in screen-share mode, so make it a disable button
        scr.setAttribute("aria-label", "Stop sharing your screen");
        scr.innerHTML = '<i class="bx bx-window"></i><span class="menu-button-lbox"><span class="menu-button-label">Unshare<br/>Screen</span></span>';
        scr.onclick = function() {
            shareVideo("-none", 0);
        };

    } else if (userMediaVideoID !== null) {
        // We're sharing the camera, so click it to stop
        cam.setAttribute("aria-label", "Stop sharing your camera");
        cam.innerHTML = '<i class="bx bx-video"></i><span class="menu-button-lbox"><span class="menu-button-label">Unshare<br/>Camera</span></span>';
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
