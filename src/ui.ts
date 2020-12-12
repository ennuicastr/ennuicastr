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

// extern
declare var Ennuiboard: any, webkitAudioContext: any;

import * as audio from "./audio";
import * as chat from "./chat";
import * as compression from "./compression";
import * as config from "./config";
import * as log from "./log";
import * as master from "./master";
import * as net from "./net";
import * as ptt from "./ptt";
import * as uiCode from "./uicode";
import { dce, gebi } from "./util";
import * as video from "./video";
import * as videoRecord from "./video-record";

// The entire user interface
export const ui = {
    // True if the user interface has been manually resized
    manualSize: false,

    // If we're currently resizing, the timeout before assuming we don't have the right
    resizing: <null|number> null,
    resized: false,

    /* During resizing, we cache the inner-outer height difference, because
     * some browsers mis-report it */
    outerInnerHeightDiff: 0,

    // The overall wrapper
    wrapper: <HTMLElement> null,

    // Colors defined in CSS
    colors: <Record<string, string>> {},

    // Video interface
    video: <{
        // Main wrapper
        wrapper: HTMLElement,

        // The window, if it's been popped out into a window
        window: WindowProxy,

        // Side wrapper
        sideWrapper: HTMLElement,

        // Side container
        side: HTMLElement,

        // Side fullscreen button
        sideFS: HTMLButtonElement,

        // Main video wrapper
        mainWrapper: HTMLElement,

        // Main video element 
        main: HTMLElement,

        // Main fullscreen button
        mainFS: HTMLButtonElement,

        // Video components for each user
        users: {
            // <video> element
            video: HTMLVideoElement,

            // Containing box
            box: HTMLElement,

            // Video standin
            standin: HTMLElement,

            // Name label
            name: HTMLElement,

            // Popout button
            popout: HTMLButtonElement
        }[],

        // Which user is selected?
        selected: number,

        // Which user is the current major?
        major: number,

        // Are we in gallery mode?
        gallery: boolean,

        // A global stylesheet to help gallery mode
        css: HTMLStyleElement
    }> null,

    // Chat interface
    chat: <{
        wrapper: HTMLElement,
        incoming: HTMLElement,
        outgoing: HTMLInputElement,
        outgoingB: HTMLButtonElement
    }> null,

    // Dock group
    dock: <HTMLElement> null,

    // Live waveform
    wave: <{
        wrapper: HTMLElement,
        canvas: HTMLCanvasElement,
        watcher: HTMLImageElement,
        rotate: boolean
    }> null,

    // Status
    log: <{
        wrapper: HTMLElement,
        log: HTMLElement
    }> null,

    // The persistent menu
    persistent: <{
        masterHider: HTMLElement,
        master: HTMLButtonElement,
        soundsHider: HTMLElement,
        sounds: HTMLButtonElement,
        main: HTMLButtonElement,
        chat: HTMLButtonElement,
        mute: HTMLButtonElement,
        videoPopout: HTMLButtonElement
    }> null,

    // The separator for panel layering
    layerSeparator: <HTMLElement> null,

    // The panels
    panels: {
        // Main (settings) menu
        main: <{
            wrapper: HTMLElement,
            inputB: HTMLButtonElement,
            outputB: HTMLButtonElement,
            videoB: HTMLButtonElement,
            videoRecordB: HTMLButtonElement,
            userListB: HTMLButtonElement
        }> null,

        // Master interface
        master: <{
            wrapper: HTMLElement,

            // Pause or resume
            pauseResumeB: HTMLButtonElement,

            // Start or stop
            startStopB: HTMLButtonElement,

            // Acknowledgement
            yesNo: HTMLElement,
            yesB: HTMLButtonElement,
            noB: HTMLButtonElement,

            // Invite
            inviteLink: HTMLInputElement,
            inviteCopyB: HTMLButtonElement,
            inviteFLACHider: HTMLElement,
            inviteFLAC: HTMLInputElement,
            inviteContinuousHider: HTMLElement,
            inviteContinuous: HTMLInputElement,

            // User administration button
            userAdminB: HTMLButtonElement,

            // Accept guest video recordings
            acceptRemoteVideo: HTMLInputElement,

            // Recording cost popout behavior
            recordingCostPopout: HTMLButtonElement,
            recordingCostPopoutWrapper: HTMLElement,
            recordingCostDock: HTMLElement,

            // Recording cost/rate
            recordingCost: HTMLInputElement,
            recordingRate: HTMLInputElement
        }> null,

        // User administration interface
        userAdmin: <{
            wrapper: HTMLElement,

            // Administration for *all* users
            allB: HTMLButtonElement,

            // Buttons for *each* user
            buttons: HTMLButtonElement[]
        }> null,

        // User administration for a particular user
        userAdminUser: <{
            wrapper: HTMLElement,

            // Which user are we administrating?
            user: number,

            // Box for this user's name
            name: HTMLElement,

            // Actions
            kick: HTMLButtonElement,
            mute: HTMLButtonElement,
            echo: HTMLButtonElement
        }> null,

        // Soundboard
        soundboard: <{
            wrapper: HTMLElement,

            // Popout button
            popout: HTMLButtonElement,

            // Popout-able wrapper
            popoutWrapper: HTMLElement,

            // Dock
            dock: HTMLElement,

            // Wrapper for the actual sounds
            soundsWrapper: HTMLElement,

            // And finally, the sounds
            sounds: Record<string, {
                b: HTMLButtonElement,
                i: HTMLElement,
                n: HTMLElement
            }>
        }> null,

        // Input device selection
        inputConfig: <{
            wrapper: HTMLElement,

            // Device selection
            device: HTMLSelectElement,

            // PTT button
            ptt: HTMLButtonElement,

            // Options
            noiserHider: HTMLElement,
            noiser: HTMLInputElement,
            echo: HTMLInputElement,
            agcHider: HTMLElement,
            agc: HTMLInputElement
        }> null,

        // Output device selection
        outputConfig: <{
            wrapper: HTMLElement,

            // Device selection
            deviceHider: HTMLElement,
            device: HTMLSelectElement,

            // Master volume
            volumeHider: HTMLElement,
            volume: HTMLInputElement,
            volumeStatus: HTMLElement,

            // SFX volume
            sfxVolumeHider: HTMLElement,
            sfxVolume: HTMLInputElement,
            sfxVolumeStatus: HTMLElement,

            // Options
            compressionHider: HTMLElement,
            compression: HTMLInputElement,
            muteInterface: HTMLInputElement
        }> null,

        // Video device
        videoConfig: <{
            wrapper: HTMLElement,

            // Device selection
            device: HTMLSelectElement,

            // Gallery mode
            gallery: HTMLInputElement,

            // Streamer mode
            streamerModeHider: HTMLElement,
            streamerMode: HTMLInputElement
        }> null,

        // Video recording
        videoRecord: <{
            wrapper: HTMLElement,

            // Options
            local: HTMLButtonElement,
            remote: HTMLButtonElement,
            both: HTMLButtonElement
        }> null,

        // User list
        userList: <{
            wrapper: HTMLElement,

            // Popout button
            popout: HTMLButtonElement,

            // Popout-able wrapper
            popoutWrapper: HTMLElement,

            // Dock
            dock: HTMLElement,

            // The actual user list
            userList: HTMLElement,

            // User list elements
            users: {
                wrapper: HTMLElement,
                name: HTMLElement,
                volume: HTMLInputElement,
                volumeStatus: HTMLElement
            }[]
        }> null
    },

    // Interface and soundboard sounds
    sounds: <{
        chimeUp: HTMLAudioElement,
        chimeDown: HTMLAudioElement,
        soundboard: Record<string, {
            el: HTMLAudioElement & {ecStartTime?: number}
        }>
    }> null,

    // Audio output, thru an HTMLAudioElement so it's switchable
    audioOutput: <HTMLAudioElement> null
};

// When did each user last speak, for video selection purposes
var lastSpeech: number[] = [];

// Certain options are only shown on mobile
const ua = navigator.userAgent.toLowerCase();
const mobile = (ua.indexOf("android") >= 0) ||
               (ua.indexOf("iphone") >= 0) ||
               (ua.indexOf("ipad") >= 0);

// Video standin's SVG code
const standinSVG = [
    '<svg viewBox="0 0 512 512" style="width:100%;height:100%"><g transform="translate(0,215)"><rect ry="128" rx="128" y="-215" x="0" height="512" width="512" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66518928px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 640 512" style="width:100%;height:100%"><g transform="translate(64,215)"><path transform="matrix(1.3149081,0,0,1.1060609,-80.616476,-4.348493)" d="m 256.00001,-190.45201 243.36301,176.81359 -92.95641,286.09039 -300.81323,-1e-5 -92.956399,-286.090393 z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 512 512" style="width:100%;height:100%"><g transform="translate(0,215)"><path transform="matrix(1.1552103,0,0,1.0004415,-39.733837,-24.463922)" d="m 256.00001,-190.45201 221.60466,127.943517 -10e-6,255.887023 -221.60467,127.94351 -221.604657,-127.94352 7e-6,-255.887025 z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66518928px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 576 512" style="width:100%;height:100%"><g transform="translate(32,215)"><path transform="matrix(1.1544409,0,0,1.0525596,-39.536869,-14.537931)" d="M 256.00001,-190.45201 456.06054,-94.107932 505.4714,122.37524 367.02521,295.98126 144.97478,295.98125 6.5285965,122.37523 55.939473,-94.107942 Z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 640 512" style="width:100%;height:100%"><g transform="translate(64,215)"><path transform="matrix(1.25,0,0,1,-64,0)" d="M 256.00001,-215.00002 437.01934,-140.01935 512,40.999988 437.01933,222.01932 255.99999,296.99998 74.980659,222.01931 0,40.999974 74.980669,-140.01936 Z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 576 512" style="width:100%;height:100%"><g transform="translate(32,215)"><path transform="matrix(1.1423549,0,0,1.0310912,-36.442856,6.6846075)" d="m 256.00001,-215.00002 164.55362,59.89263 87.55716,151.6534442 -30.40829,172.4539358 -134.14535,112.5613 -175.11431,0 L 34.297493,168.99997 3.8892164,-3.4539593 91.446377,-155.1074 Z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 544 512" style="width:100%;height:100%"><g transform="translate(16,215)"><path transform="matrix(1.1171786,0,0,1,-29.997722,0)" d="m 256.00001,-215.00002 150.47302,48.89165 92.99744,128.000007 0,158.216703 -92.99745,128 -150.47303,48.89164 -150.47302,-48.89165 -92.99744,-128.00001 4e-6,-158.216696 92.997446,-127.999994 z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>'
];

// Show the given panel, or none
export function showPanel(panelName: HTMLElement|string, autoFocusName: HTMLElement|string) {
    var panel: HTMLElement;
    var autoFocus: HTMLElement = null;
    if (typeof autoFocusName === "string")
        autoFocus = (<any> ui.panels)[<string> panelName][autoFocusName];
    else if (typeof autoFocus !== "undefined")
        autoFocus = autoFocusName;
    if (typeof panelName === "string")
        panel = (<any> ui.panels)[panelName].wrapper;
    else
        panel = panelName;

    // Hide all existing panels
    for (var o in ui.panels) {
        (<any> ui.panels)[o].wrapper.style.display = "none";
    }

    // Show this one
    if (panel) {
        ui.layerSeparator.style.display = "";
        panel.style.display = "block";
        document.body.setAttribute("data-interface", "none");

        if (autoFocus)
            autoFocus.focus();
        else
            (<HTMLElement> panel.childNodes[0]).focus();

    } else {
        ui.layerSeparator.style.display = "none";
        mouseenter();

        if (autoFocus)
            autoFocus.focus();

    }

    resizeUI();
}

// Configure a panel for popping in or out
function poppable(popout: HTMLElement, button: HTMLButtonElement,
                  panelButton: HTMLButtonElement, name: string,
                  panel: HTMLElement, dock: HTMLElement) {
    var cur = false;
    button.onclick = function() {
        cur = !cur;
        (cur?dock:panel).appendChild(popout);
        if (panelButton)
            panelButton.style.display = cur?"none":"";
        if (cur)
            showPanel(null, ui.persistent.main);
        else
            resizeUI();
        localStorage.setItem(name, cur?"1":"0");
    };

    var saved = localStorage.getItem(name);
    if (saved !== null && !!~~saved)
        button.onclick(null);
}

// Functionality for auto-hiding the persistent panel
var metimeout: null|number = null;
function mouseenter() {
    if (metimeout)
        clearTimeout(metimeout);
    document.body.setAttribute("data-interface", "show");
    metimeout = setTimeout(function() {
        if (document.body.getAttribute("data-interface") === "show")
            document.body.setAttribute("data-interface", "hide");
    }, 2000);
}

// Saveable config for a box with a string value
function saveConfigValue(sel: HTMLSelectElement, name: string, onchange?: (arg0:Event)=>void) {
    var cur = localStorage.getItem(name);
    if (cur !== null)
        sel.value = cur;
    sel.onchange = function(ev) {
        localStorage.setItem(name, sel.value);
        if (onchange)
            return onchange(ev);
    };
}

// Saveable configuration for a checkbox
export function saveConfigCheckbox(cb: HTMLInputElement, name: string, onchange?: (arg0:Event)=>void) {
    var cur = localStorage.getItem(name);
    if (cur !== null)
        cb.checked = !!~~cur;
    cb.onchange = function(ev) {
        localStorage.setItem(name, cb.checked?"1":"0");
        if (onchange)
            return onchange(ev);
    };
}

// Saveable configuration for a slider
function saveConfigSlider(sl: HTMLInputElement, name: string, onchange?: (arg0:Event)=>void) {
    var cur = localStorage.getItem(name);
    if (cur !== null)
        sl.value = ""+(+cur);
    sl.oninput = function(ev) {
        var ret;
        if (onchange)
            ret = onchange(ev);
        localStorage.setItem(name, ""+sl.value);
        return ret;
    };
}

// Make the UI
export function mkUI() {
    // Snag the original log before we overwrite it
    var log = gebi("log");

    // Load in the UI
    document.body.style.margin =
        document.body.style.padding = "0";
    document.body.innerHTML = uiCode.code;

    // Get the colors
    var cs = getComputedStyle(document.documentElement);
    [
        "bg", "bg-hover", "bg-off", "bg-plain", "bg-invite", "bg-status",
        "bg-wave", "fg", "fg-status", "border-plain", "link-color",
        "link-color-status", "wave-too-soft", "wave-too-loud",
        "user-list-silent", "user-list-speaking", "video-speaking-sel",
        "video-speaking", "video-silent-sel", "video-silent"
    ].forEach(function(nm) {
        ui.colors[nm] = cs.getPropertyValue("--" + nm);
    });
    document.body.style.backgroundColor = ui.colors["bg-plain"];

    // Load the components
    ui.wrapper = gebi("ecouter");
    loadVideo();
    loadChat();
    ui.dock = gebi("ecdock");
    chat.mkChatBox();
    loadWave();
    loadLog(log);
    ui.layerSeparator = gebi("eclayer-separator");
    loadMainMenu();
    loadMasterUI();
    loadUserAdmin();
    loadSoundboard();
    loadInputConfig();
    loadOutputConfig();
    loadVideoConfig();
    loadUserList();
    loadInterfaceSounds();

    if ("master" in config.config) {
        master.createMasterInterface();
        showPanel(ui.panels.master.wrapper, ui.panels.master.startStopB);
    }

    /* If we're not using RTC, we can disable the video display, and move the
     * dock so menus don't compete */
    if (!config.useRTC) {
        ui.video.sideWrapper.style.display =
            ui.video.mainWrapper.style.display = "none";
        ui.wrapper.insertBefore(ui.dock, ui.log.wrapper);
    }

    // Every close button works the same
    Array.prototype.slice.call(document.getElementsByClassName("close-button"), 0).forEach(function(x: HTMLElement) {
        x.onclick = function() { showPanel(null, ui.persistent.main); };
    });
    ui.layerSeparator.onclick = function() { showPanel(null, ui.persistent.main); };

    // Escape also closes
    window.addEventListener("keydown", function(ev) {
        if (ev.key === "Esc" || ev.key === "Escape")
            showPanel(null, ui.persistent.main);
    });

    // Poppable panels
    if ("master" in config.config) {
        let m = ui.panels.master;
        poppable(m.recordingCostPopoutWrapper, m.recordingCostPopout, null,
            "recording-cost-popout3", m.wrapper, m.recordingCostDock);
    }
    {
        let s = ui.panels.soundboard;
        poppable(s.popoutWrapper, s.popout, ui.persistent.sounds, "sounds-popout3", s.wrapper, s.dock);
    }
    {
        let u = ui.panels.userList;
        poppable(u.popoutWrapper, u.popout, ui.panels.main.userListB, "user-list-popout3", u.wrapper, u.dock);
    }

    // When we resize, re-flex
    window.addEventListener("resize", onResize);
    resizeUI();
}

function loadVideo() {
    ui.video = {
        wrapper: gebi("ecvideo-wrapper"),
        window: null,
        sideWrapper: gebi("ecvideo-side-wrapper"),
        side: gebi("ecvideo-side"),
        sideFS: gebi("ecvideo-wrapper-fs"),
        mainWrapper: gebi("ecvideo-main-wrapper"),
        main: gebi("ecvideo-main"),
        mainFS: gebi("ecvideo-main-fs"),
        users: [],
        selected: -1,
        major: -1,
        gallery: false,
        css: dce("style")
    };
    var video = ui.video;

    video.css.type = "text/css";
    document.head.appendChild(video.css);

    // A generic function to handle fullscreen buttons
    function fullscreen(el: HTMLElement, btn: HTMLButtonElement) {
        btn.innerHTML = '<i class="fas fa-expand"></i>';

        // Toggle based on what's fullscreen
        function toggleFullscreen() {
            if (document.fullscreenElement === el)
                document.exitFullscreen();
            else
                el.requestFullscreen();
        }
        btn.onclick = toggleFullscreen;

        document.addEventListener("fullscreenchange", function() {
            if (document.fullscreenElement === el)
                btn.innerHTML = '<i class="fas fa-compress"></i>';
            else
                btn.innerHTML = '<i class="fas fa-expand"></i>';
        });
    }

    fullscreen(video.wrapper, video.sideFS);
    fullscreen(video.mainWrapper, video.mainFS);
}

function loadChat() {
    ui.chat = {
        wrapper: gebi("ecchat-wrapper"),
        incoming: gebi("ecchat-incoming"),
        outgoing: gebi("ecchat-outgoing"),
        outgoingB: gebi("ecchat-outgoing-b")
    };
}

function loadWave() {
    var wave = ui.wave = {
        wrapper: gebi("ecwaveform-wrapper"),
        canvas: gebi("ecwaveform"),
        watcher: gebi("ecwave-watcher"),
        rotate: false
    };

    // Choose the watcher image's type based on support
    function usePng() {
        wave.watcher.src = "images/watcher.png";
    }
    if (!window.createImageBitmap || !window.fetch) {
        usePng();
    } else {
        var sample = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
        fetch(sample).then(function(res) {
            return res.blob();
        }).then(function(blob) {
            return createImageBitmap(blob)
        }).then(function() {
            wave.watcher.src = "images/watcher.webp";
        }).catch(usePng);
    }
}

function loadLog(logEl: HTMLElement) {
    var log = ui.log = {
        wrapper: gebi("eclog"),
        log: logEl
    };
    log.wrapper.appendChild(log.log);
}

function loadMainMenu() {
    var p = ui.persistent = {
        masterHider: gebi("ecmenu-master-hider"),
        master: gebi("ecmenu-master"),
        soundsHider: gebi("ecmenu-sounds-hider"),
        sounds: gebi("ecmenu-sounds"),
        main: gebi("ecmenu-main"),
        chat: gebi("ecmenu-chat"),
        mute: gebi("ecmenu-mute"),
        videoPopout: gebi("ecmenu-video-popout")
    };

    var m = ui.panels.main = {
        wrapper: gebi("ecmenu"),
        inputB: gebi("ecmenu-input-devices"),
        outputB: gebi("ecmenu-output-devices"),
        videoB: gebi("ecmenu-video-devices"),
        videoRecordB: gebi("ecmenu-record"),
        userListB: gebi("ecmenu-user-list")
    };

    function btn(b: HTMLButtonElement, p: string, a: string) {
        b.onclick = function() {
            showPanel(p, a);
        };
    }

    btn(p.master, "master", "startStopB");
    btn(p.sounds, "soundboard", null);
    btn(p.main, "main", "inputB");
    p.chat.onclick = function() {
        var chat = ui.chat.wrapper;
        if (chat.style.display === "none") {
            chat.style.display = "";
            ui.chat.outgoing.focus();
        } else {
            chat.style.display = "none";
        }
        resizeUI();
    };
    p.mute.onclick = function() { audio.toggleMute(); };
    btn(m.inputB, "inputConfig", null);
    btn(m.outputB, "outputConfig", null);
    btn(m.videoB, "videoConfig", null);
    videoRecord.recordVideoButton();
    btn(m.userListB, "userList", null);

    // Auto-hide the persistent menu
    mouseenter();
    document.body.addEventListener("mouseenter", mouseenter);
    document.body.addEventListener("mousemove", mouseenter);

    // Support for popping out the entire video block
    var w: WindowProxy = null;
    function popoutOpen() {
        w = ui.video.window = window.open("", "", "width=1280,height=720,menubar=0,toolbar=0,location=0,personalbar=0,status=0");
        if (!w) return;

        w.document.title = "Video — " + document.title;

        // To make it flex properly, it needs the CSS
        var ssurl = new URL(<any> window.location);
        ssurl.search = "?v=6";
        ssurl.pathname = ssurl.pathname.replace(/\/[^\/]*$/, "/ennuicastr2.css");
        w.document.head.innerHTML = '<link href="' + (<any> ssurl) + '" rel="stylesheet" />';
        w.document.head.appendChild(ui.video.css);
        w.document.body.setAttribute("data-gallery", document.body.getAttribute("data-gallery"));

        // Add the video element
        Object.assign(w.document.body.style, {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            margin: "0"
        });
        w.document.body.appendChild(ui.video.wrapper);
        w.onunload = popoutClose;
        w.onresize = function() { updateVideoUI(0); }
        ui.wave.wrapper.style.flex = "auto";

        // Play them
        for (var vi = 0; vi < ui.video.users.length; vi++) {
            var v = ui.video.users[vi];
            if (!v) continue;
            v.video.play().catch(console.error);
        }

        setTimeout(function() {
            updateVideoUI(0);
            resizeUI();
        }, 0);
    }

    function popoutClose() {
        w = ui.video.window = null;
        document.head.appendChild(ui.video.css);
        ui.wrapper.insertBefore(ui.video.wrapper, ui.wrapper.childNodes[0]);
        ui.wave.wrapper.style.flex = "";

        // Play them
        for (var vi = 0; vi < ui.video.users.length; vi++) {
            var v = ui.video.users[vi];
            if (!v) continue;
            v.video.play().catch(console.error);
        }

        setTimeout(function() {
            updateVideoUI(0);
            resizeUI();
        }, 0);
    }

    p.videoPopout.onclick = function() {
        if (w)
            w.close();
        else
            popoutOpen();
    };
}

function loadMasterUI() {
    var m = ui.panels.master = {
        wrapper: gebi("ecmaster-interface"),
        pauseResumeB: gebi("ecmaster-pause-resume"),
        startStopB: gebi("ecmaster-start-stop"),
        yesNo: gebi("ecmaster-yes-no"),
        yesB: gebi("ecmaster-yes"),
        noB: gebi("ecmaster-no"),
        inviteLink: gebi("ecmaster-invite-link"),
        inviteCopyB: gebi("ecmaster-invite-link-copy"),
        inviteFLACHider: gebi("ecmaster-invite-flac-hider"),
        inviteFLAC: gebi("ecmaster-invite-flac"),
        inviteContinuousHider: gebi("ecmaster-invite-continuous-hider"),
        inviteContinuous: gebi("ecmaster-invite-continuous"),
        userAdminB: gebi("ecmaster-admin"),
        acceptRemoteVideo: gebi("ecmaster-video-record-host"),
        recordingCostPopout: gebi("ecmaster-recording-cost-popout"),
        recordingCostPopoutWrapper: gebi("ecmaster-recording-cost-popout-wrapper"),
        recordingCostDock: gebi("ecmaster-recording-cost-dock"),
        recordingCost: gebi("ecmaster-recording-cost"),
        recordingRate: gebi("ecmaster-recording-rate")
    };
}

function loadUserAdmin() {
    ui.panels.userAdmin = {
        wrapper: gebi("ecuser-admin-interface"),
        allB: gebi("ecuser-admin-all-b"),
        buttons: []
    };

    ui.panels.userAdminUser = {
        wrapper: gebi("ecuser-admin-interface-user"),
        user: -1,
        name: gebi("ecuser-admin-interface-user-name"),
        kick: gebi("ecuser-admin-kick"),
        mute: gebi("ecuser-admin-mute"),
        echo: gebi("ecuser-admin-echo")
    };
}

function loadSoundboard() {
    var s = ui.panels.soundboard = {
        wrapper: gebi("ecsounds-wrapper"),
        popout: gebi("ecsounds-popout"),
        popoutWrapper: gebi("ecsounds-popout-wrapper"),
        dock: gebi("ecsounds-dock"),
        soundsWrapper: gebi("ecsounds"),
        sounds: {}
    };
}

function loadInputConfig() {
    var input = ui.panels.inputConfig = {
        wrapper: gebi("ecinput-device-wrapper"),
        device: gebi("ecinput-device-list"),
        ptt: gebi("ecpttb"),
        noiserHider: gebi("ecnoise-reduction-hider"),
        noiser: gebi("ecnoise-reduction"),
        echo: gebi("ececho-cancellation"),
        agcHider: gebi("ecagc-hider"),
        agc: gebi("ecagc")
    };

    if (!config.useRTC) {
        // Hide irrelevant options
        input.noiserHider.style.display = "none";
    }
}

function loadOutputConfig() {
    var output = ui.panels.outputConfig = {
        wrapper: gebi("ecoutput-device-wrapper"),
        deviceHider: gebi("ecoutput-device-list-hider"),
        device: gebi("ecoutput-device-list"),
        volumeHider: gebi("ecoutput-volume-hider"),
        volume: gebi("ecoutput-volume"),
        volumeStatus: gebi("ecoutput-volume-status"),
        sfxVolumeHider: gebi("ecsfx-volume-hider"),
        sfxVolume: gebi("ecsfx-volume"),
        sfxVolumeStatus: gebi("ecsfx-volume-status"),
        compressionHider: gebi("ecdynamic-range-compression-hider"),
        compression: gebi("ecdynamic-range-compression"),
        muteInterface: gebi("ecmute-interface-sounds")
    };

    if (!config.useRTC) {
        // Hide irrelevant parts
        output.volumeHider.style.display =
            output.compressionHider.style.display = "none";
    }
}

function loadVideoConfig() {
    ui.panels.videoConfig = {
        wrapper: gebi("ecvideo-device-wrapper"),
        device: gebi("ecvideo-device-list"),
        gallery: gebi("ecgallery-mode"),
        streamerModeHider: gebi("ecstreamer-mode-hider"),
        streamerMode: gebi("ecstreamer-mode")
    };

    ui.panels.videoRecord = {
        wrapper: gebi("ecvideo-record-wrapper"),
        local: gebi("ecvideo-record-local"),
        remote: gebi("ecvideo-record-remote"),
        both: gebi("ecvideo-record-both")
    };
}

function loadUserList() {
    ui.panels.userList = {
        wrapper: gebi("ecuser-list-wrapper"),
        popout: gebi("ecuser-list-popout"),
        popoutWrapper: gebi("ecuser-list-popout-wrapper"),
        dock: gebi("ecuser-list-dock"),
        userList: gebi("ecuser-list"),
        users: []
    };
}

function loadInterfaceSounds() {
    ui.sounds = {
        chimeUp: gebi("ecaudio-chime-up"),
        chimeDown: gebi("ecaudio-chime-down"),
        soundboard: {}
    };
}

// Load elements which require audio first
export function mkAudioUI() {
    var input = ui.panels.inputConfig,
        output = ui.panels.outputConfig,
        videoConfig = ui.panels.videoConfig;

    /********************
     * INPUT CONFIGURATION
     *******************/
    function inputChange() {
        showPanel(null, ui.persistent.main);
        audio.getMic(input.device.value);
    }

    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "audioinput") return;

            // Create an option for this
            var opt = dce("option");
            var label = dev.label || ("Mic " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            input.device.appendChild(opt);
        });

        saveConfigValue(input.device, "input-device3", inputChange);

    }).catch(function() {}); // Nothing really to do here

    // Gamepad PTT configuration
    if (typeof Ennuiboard !== "undefined" && Ennuiboard.supported.gamepad)
        input.ptt.onclick = ptt.userConfigurePTT;
    else
        input.ptt.style.display = "none";

    saveConfigCheckbox(input.noiser, "noise-reduction3", inputChange);
    if (mobile) {
        input.echo.checked = true;
        input.agcHider.style.display = "";
        input.agc.checked = true;
    }
    saveConfigCheckbox(input.echo, "echo-cancellation3", function() {
        if (input.echo.checked) {
            log.pushStatus("echo-cancellation", "WARNING: Digital echo cancellation is usually effective in cancelling echo, but will SEVERELY impact the quality of your audio. If possible, find a way to reduce echo physically.");
            setTimeout(function() {
                log.popStatus("echo-cancellation");
            }, 10000);
        }
        inputChange();
    });
    saveConfigCheckbox(input.agc, "agc3", inputChange);


    /********************
     * OUTPUT CONFIGURATION
     *******************/

    // Add a pseudo-device so nothing is selected at first
    var opt = dce("option");
    opt.innerText = "-";
    opt.value = "-none";
    output.device.appendChild(opt);

    function outputChange() {
        if (output.device.value === "-none") return;
        showPanel(null, ui.persistent.main);

        var v = output.device.value;

        // Set the main audio output
        if (ui.audioOutput) {
            (<any> ui.audioOutput).setSinkId(v).catch(console.error);
        } else {
            // Just try again
            setTimeout(outputChange, 100);
            return;
        }

        // And all the sounds
        // FIXME: soundboard sounds
        (<any> ui.sounds.chimeUp).setSinkId(v).catch(console.error);
        (<any> ui.sounds.chimeDown).setSinkId(v).catch(console.error);
    }

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "audiooutput") return;

            // Create an option for this
            var opt = dce("option");
            var label = dev.label || ("Output " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            output.device.appendChild(opt);
        });

        saveConfigValue(output.device, "output-device3", outputChange);

    }).catch(function() {}); // Nothing really to do here

    // Volume
    saveConfigSlider(output.volume, "volume-master3");

    // But, separate save for snapping
    function volumeChange() {
        var vol = output.volume;

        // Snap to x00%
        for (var i = 100; i <= 300; i += 100)
            if (+vol.value >= i - 10 && +vol.value <= i + 10)
                vol.value = <any> i;

        // Remember preferences
        localStorage.setItem("volume-master3", ""+vol.value);

        // Show the status
        output.volumeStatus.innerHTML = "&nbsp;" + vol.value + "%";

        // Set it
        compression.setGlobalGain((+vol.value) / 100);
    }
    output.volume.oninput = volumeChange;

    compression.setGlobalGain((+output.volume.value) / 100);

    // SFX volume
    function sfxVolumeChange() {
        var vol = output.sfxVolume;
        output.sfxVolumeStatus.innerHTML = "&nbsp;" + vol.value + "%";

        var v = (+vol.value) / 100;

        // FIXME: Set it on soundboard sounds

        ui.sounds.chimeUp.volume = v;
        ui.sounds.chimeDown.volume = v;
    }

    saveConfigSlider(output.sfxVolume, "volume-sfx3", sfxVolumeChange);
    sfxVolumeChange();

    // Dynamic range compression
    function drcChange() {
        var c = output.compression.checked;
        compression.setCompressing(c);

        if (c) {
            // Set the volume to 100% so it doesn't explode your ears
            output.volume.value = <any> 100;
        } else {
            // Set the volume to 200% so it's audible
            output.volume.value = <any> 200;
        }
        volumeChange();
    }

    // Default for DRC depends on support
    if (!compression.supported) {
        output.compressionHider.style.display = "none";
        output.compression.checked = false;
        if (localStorage.getItem("volume-master3") === null)
            drcChange();
    }
    saveConfigCheckbox(output.compression, "dynamic-range-compression3", drcChange);
    compression.setCompressing(output.compression.checked);

    // Interface sounds is just a checkbox we check before making sounds
    saveConfigCheckbox(output.muteInterface, "mute-interface3");


    /********************
     * VIDEO CONFIGURATION
     *******************/

    // When it's changed, start video
    videoConfig.device.onchange = function() {
        showPanel(null, ui.persistent.main);
        video.getCamera(videoConfig.device.value);
    };

    // Add a pseudo-device so nothing is selected at first
    var opt = dce("option");
    opt.innerText = "None";
    opt.value = "-none";
    videoConfig.device.appendChild(opt);

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "videoinput") return;

            // Create an option for this
            var opt = dce("option");
            var label = dev.label || ("Camera " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            videoConfig.device.appendChild(opt);
        });

        // Add a special pseudo-device for screen capture
        var opt = dce("option");
        opt.innerText = "Capture screen";
        opt.value = "-screen";
        videoConfig.device.appendChild(opt);

    }).catch(function() {}); // Nothing really to do here

    // Gallery mode
    function galleryChange(ev: Event) {
        var g = videoConfig.gallery;
        document.body.setAttribute("data-gallery", g.checked?"on":"off");
        ui.video.gallery = g.checked;
        ui.video.selected = ui.video.major = -1;
        if (!g.checked)
            ui.video.css.innerHTML = "";
        if (ev)
            showPanel(null, ui.persistent.main);
        updateVideoUI(0);
    }

    saveConfigCheckbox(videoConfig.gallery, "gallery-mode3", galleryChange);
    galleryChange(null);

    // Streamer mode
    function streamerModeChange(ev: Event) {
        var s = videoConfig.streamerMode.checked;
        document.body.setAttribute("data-streamer-interface", s?"show":"hide");
        if (s) {
            // Tell them how much browser chrome they need to compete with
            log.pushStatus("chrome", "Browser chrome: " + (window.outerWidth-window.innerWidth) + "x" + (window.outerHeight-window.innerHeight));
            setTimeout(function() {
                log.popStatus("chrome");
            }, 10000);
        }

        if (ev)
            showPanel(null, ui.persistent.main);
    }
    if (mobile) {
        videoConfig.streamerModeHider.style.display = "none";
    } else {
        saveConfigCheckbox(videoConfig.streamerMode, "streamer-mode3", streamerModeChange);
        streamerModeChange(null);
    }

    // Return which input device should be used
    return localStorage.getItem("input-device3");
}

// Set the output audio context
export function setOutputAudioContext(ac: AudioContext & {ecDestination?: MediaStreamAudioDestinationNode}) {
    if (!ac.ecDestination) {
        // Make its destination node
        ac.ecDestination = ac.createMediaStreamDestination();
    }

    if (!audio.userMediaRTC) {
        // We may not yet be allowed to play sound, so wait
        audio.userMediaAvailableEvent.addEventListener("usermediartcready", function() {
            setOutputAudioContext(ac);
        }, {once: true});
        return;
    }

    if (!ui.audioOutput) {
        // Create the output audio device
        var a = ui.audioOutput = dce("audio");
        a.style.display = "none";
        document.body.appendChild(a);
    }

    ui.audioOutput.srcObject = ac.ecDestination.stream;
    ui.audioOutput.play().catch(console.error);
}

// Update the mute button
export function updateMuteButton() {
    if (!audio.userMedia) return;
    var muteB = ui.persistent.mute;
    if (audio.userMedia.getAudioTracks()[0].enabled) {
        // It's unmuted
        muteB.innerHTML = '<i class="fas fa-volume-up"></i>';
        muteB.setAttribute("aria-label", "Mute");

    } else {
        // It's muted
        muteB.innerHTML = '<i class="fas fa-volume-mute"></i>';
        muteB.setAttribute("aria-label", "Unmute");

    }
}

// Resize the UI to fit visible components
export function resizeUI(second?: boolean) {
    /* Since elements sometimes take an event loop to actually assert their
     * sizes, resizeUI automatically runs itself twice */
    if (!second)
        setTimeout(function() { resizeUI(true); }, 0);

    // If we're not doing RTC, some elements are irrelevant
    if (!config.useRTC) {
        if (ui.chat.wrapper.style.display === "none") {
            ui.video.wrapper.style.display = "none";
            ui.wave.wrapper.style.flex = "auto";
        } else {
            ui.video.wrapper.style.display = "";
            ui.wave.wrapper.style.flex = "";
        }
    }

    // Figure out the ideal size for the UI based on what's visible
    var idealSize = 0;

    // First, the standard elements
    for (var ci = 0; ci < ui.wrapper.childNodes.length; ci++) {
        var c = <HTMLElement> ui.wrapper.childNodes[ci];
        if (c.style.display === "none")
            continue;
        if (c === ui.video.wrapper)
            idealSize += 240;
        else if (c === ui.wave.wrapper)
            idealSize += 100;
        else
            idealSize += c.offsetHeight;
    }

    // Then, any visible panel
    for (var pn in ui.panels) {
        var panel: HTMLElement = (<any> ui.panels)[pn].wrapper;
        if (panel.style.display === "block")
            idealSize = Math.max(idealSize, panel.scrollHeight + 40);
    }

    // Don't do anything if the size is already right
    if (window.innerHeight === idealSize)
        return;

    // Don't try to seize control
    if (ui.manualSize && window.innerHeight >= idealSize)
        return;

    // Adjust to outer size
    if (!ui.resizing)
        ui.outerInnerHeightDiff = window.outerHeight - window.innerHeight;

    // Otherwise, try to resize
    if (ui.resizing)
        clearTimeout(ui.resizing);
    ui.resized = false;
    ui.resizing = setTimeout(function() {
        ui.resizing = null;
        if (!ui.resized)
            onResize();
    }, 500);
    window.resizeTo(window.outerWidth, ui.outerInnerHeightDiff + idealSize);
}

// React to the UI resizing
function onResize() {
    ui.resized = true;
    ui.manualSize = !ui.resizing;

    // Some browsers need a real height to flex properly
    ui.wrapper.style.height = window.innerHeight + "px";

    // If we're in gallery mode, we may need to change the arrangement
    if (ui.video.gallery)
        updateVideoUI(0);
}

// Add a user to the user list
export function userListAdd(idx: number, name: string, fromMaster: boolean) {
    if (("master" in config.config) !== fromMaster)
        return;

    // First to the normal user list
    var userList = ui.panels.userList;
    while (userList.users.length <= idx)
        userList.users.push(null);

    var user = userList.users[idx];
    if (user) {
        // Just update their name
        if (name) {
            user.name.innerText = name;
            user.name.setAttribute("aria-label", name + ": Not speaking");
            ui.video.users[idx].name.innerText = name;
            styleVideoEl(ui.video.users[idx], name);
        }
        if (fromMaster) {
            master.users[idx].online = true;
            master.updateMasterAdmin();
        }
        return;
    }

    // Create the user list entry for this user
    user = userList.users[idx] = {
        wrapper: dce("div"),
        name: dce("div"),
        volume: dce("input"),
        volumeStatus: dce("div")
    };
    var volumeWrapper = dce("div");

    /* Here's how it all lays out:
     *  <div wrapper bigrflex row>
     *      <div name half>name</div>
     *      <div volumeWrapper rflex half>
     *          <input volume flex />
     *          <div status>status</div>
     *      </div>
     *  </div>
     */
    user.wrapper.classList.add("bigrflex", "row");
    userList.userList.appendChild(user.wrapper);

    user.name.classList.add("half");
    user.name.style.backgroundColor = ui.colors["user-list-silent"];
    user.name.innerText = name;
    user.name.setAttribute("role", "note");
    user.name.setAttribute("aria-label", name + ": Not speaking");
    user.wrapper.appendChild(user.name);

    volumeWrapper.classList.add("rflex", "half");
    user.wrapper.appendChild(volumeWrapper);

    user.volume.style.flex = "auto";
    user.volume.style.width = "6em";
    Object.assign(user.volume, {
        type: "range",
        min: 0,
        max: 400,
        value: 100
    });
    user.volume.setAttribute("aria-label", "Volume for " + name);
    volumeWrapper.appendChild(user.volume);

    user.volumeStatus.innerHTML = "&nbsp;100%";
    volumeWrapper.appendChild(user.volumeStatus);

    // When we change the volume, pass that to the compressors
    var mousing = false;
    function volChange(ev: InputEvent) {
        var vol = user.volume;

        // Snap to x00%
        if (mousing) {
            for (var i = 100; i <= 300; i += 100)
                if (+vol.value >= i - 10 && +vol.value <= i + 10)
                    vol.value = ""+i;
        }

        // Show the status
        user.volumeStatus.innerHTML = "&nbsp;" + vol.value + "%";

        // Set it
        compression.setPerUserGain(idx, (+vol.value) / 100);
    }

    user.volume.onmousedown = function() { mousing = true; };
    user.volume.onmouseup = function() { mousing = false; };

    saveConfigSlider(user.volume, "user-volume3-" + name, volChange);
    volChange(null);

    // Give them a user element
    videoAdd(idx, name);
    updateVideoUI(idx, false, fromMaster);

    // Chime
    if (!ui.panels.outputConfig.muteInterface.checked)
        ui.sounds.chimeUp.play().catch(console.error);


    // And the master user list
    if (fromMaster) {
        while (master.users.length <= idx)
            master.users.push(null);
        master.users[idx] = {
            name: name,
            online: true,
            transmitting: false
        };
        master.updateMasterAdmin();
    }
}

// Add a video element for this user, if they don't already have one
export function videoAdd(idx: number, name: string) {
    if (ui.video.users[idx])
        return;
    while (ui.video.users.length <= idx)
        ui.video.users.push(null);

    var ctx = ui.video.users[idx] = {
        video: dce("video"),
        box: dce("div"),
        standin: dce("div"),
        name: dce("span"),
        popout: dce("button")
    };

    /* A videobox ix flexible for centering, and contains a video element and a
     * name label */
    var box = ctx.box;
    box.classList.add("ecvideo");
    Object.assign(box.style, {
        position: "relative",
        boxSizing: "border-box",
        border: "4px solid " + ui.colors["video-silent"]
    });

    var video = ctx.video;
    video.height = 0; // Use CSS for style
    video.muted = true; // Audio goes through a different system
    Object.assign(video.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%"
    });
    box.appendChild(video);

    // When you click, they become the selected major
    video.onclick = function() {
        if (ui.video.selected === idx)
            ui.video.selected = -1;
        else
            ui.video.selected = idx;
        updateVideoUI(idx);
    };

    // The standin for when there is no video
    var standin = ctx.standin;
    Object.assign(standin.style, {
        position: "absolute",
        left: "8px",
        top: "8px",
        right: "8px",
        bottom: "8px",
        cursor: "default"
    });
    box.appendChild(standin);
    standin.onclick = video.onclick;

    styleVideoEl(ctx, name);

    // Their personal label
    var nspan = ctx.name;
    nspan.classList.add("namelabel");
    nspan.innerText = name || "";
    nspan.setAttribute("role", "note");
    nspan.setAttribute("aria-label", nspan.innerText + ": Not speaking");
    box.appendChild(nspan);

    // And popout button
    var popout = ctx.popout;
    popout.classList.add("pobutton", "tbutton", "interface", "streamer-interface");
    popout.innerHTML = '<i class="fa fa-window-restore"></i>';
    popout.title = "Pop out";
    popout.setAttribute("aria-label", "Pop out");
    box.appendChild(popout);

    var w: WindowProxy = null;

    function popoutOpen() {
        var width = 800, height = 450;
        if (video.srcObject) {
            let vt = video.srcObject.getVideoTracks();
            if (vt && vt.length) {
                let s = vt[0].getSettings();
                width = s.width;
                height = s.height;
            }
        }

        w = window.open("", "", "width=" + width + ",height=" + height + ",menubar=0,toolbar=0,location=0,personalbar=0,status=0");
        if (!w) return;

        w.document.title = nspan.innerText;
        w.document.body.appendChild(video);
        w.onunload = popoutClose;
        video.play().catch(console.error);
    }

    function popoutClose() {
        w = null;
        box.insertBefore(video, box.childNodes[0]);
        video.play().catch(console.error);
    }

    popout.onclick = function() {
        if (w)
            w.close();
        else
            popoutOpen();
    };
}

// Style a video element given a user's name
function styleVideoEl(ctx: {video: HTMLVideoElement, box: HTMLElement, standin: HTMLElement}, name: string) {
    if (!name) return;
    var x = parseInt(btoa(unescape(encodeURIComponent(name.slice(-6)))).replace(/[^A-Za-z0-9]/g, ""), 36);
    var r = x % 4;
    x = Math.floor(x / 4);
    var g = x % 4;
    x = Math.floor(x / 4);
    var b = x % 4;
    x = Math.floor(x / 4);
    var s = x % standinSVG.length;
    ctx.video.style.backgroundColor =
        ctx.box.style.backgroundColor = "#" + r + g + b;
    ctx.standin.innerHTML = standinSVG[s].replace("##", genStandinName(name || ""));
}

// Remove a user from the user list
export function userListRemove(idx: number, fromMaster: boolean) {
    if (("master" in config.config) !== fromMaster)
        return;
    var user = ui.panels.userList.users[idx];
    if (!user) return;
    user.wrapper.parentNode.removeChild(user.wrapper);
    ui.panels.userList.users[idx] = null;

    updateVideoUI(idx, false, fromMaster);

    if (fromMaster) {
        master.users[idx].online = false;
        master.updateMasterAdmin();
    }

    // Chime
    if (!ui.panels.outputConfig.muteInterface.checked)
        ui.sounds.chimeDown.play().catch(console.error);
}

// Update the speaking status of an element in the user list
export function userListUpdate(idx: number, speaking: boolean, fromMaster: boolean) {
    // The user list style follows the live info so it's somewhere
    if (!fromMaster) {
        var user = ui.panels.userList.users[idx];
        if (!user) return;
        user.name.style.backgroundColor = ui.colors["user-list-" + (speaking?"speaking":"silent")];
        user.name.setAttribute("aria-label", user.name.innerText + ": " + (speaking?"Speaking":"Not speaking"));
    }

    // But the rest follows the master (if we are one)
    if (("master" in config.config) !== fromMaster)
        return;

    updateVideoUI(idx, speaking, fromMaster);

    if (fromMaster) {
        master.users[idx].transmitting = speaking;
        master.updateMasterAdmin();
    }
}

// Update the video UI based on new information about this peer
export function updateVideoUI(peer: number, speaking?: boolean, fromMaster?: boolean) {
    var ctx = ui.video.users[peer];
    var users = ui.panels.userList.users;
    var user = users[peer];
    var pi, prevMajor = ui.video.major;
    var gallery = ui.video.gallery;

    // Update their speech
    while (lastSpeech.length <= peer)
        lastSpeech.push(null);
    if (typeof fromMaster !== "undefined") {
        if (speaking)
            lastSpeech[peer] = performance.now();
        else
            lastSpeech[peer] = null;

        var sw = "";
        if (fromMaster) {
            if (speaking)
                sw = "Transmitting";
            else
                sw = "Not transmitting";
        } else {
            if (speaking)
                sw = "Speaking";
            else
                sw = "Not speaking";
        }
        ctx.name.setAttribute("aria-label", ctx.name.innerText + ": " + sw);
    }

    if (!ui.video.gallery) {
        // Choose a major

        // Don't let them be the major if they're gone
        if (!user) {
            // If this was the major, it won't do
            if (ui.video.major === peer)
                ui.video.major = -1;
            if (ui.video.selected === peer)
                ui.video.selected = -1;
        }

        // Perhaps there's already something selected
        if (ui.video.selected !== -1) {
            ui.video.major = ui.video.selected;

        } else if (ui.video.major === net.selfId ||
                   lastSpeech[ui.video.major] === null) {
            // Otherwise, choose a major based on speech
            var earliest = -1;
            for (pi = 1; pi < users.length; pi++) {
                if (users[pi] && ui.video.users[pi] && pi !== net.selfId && lastSpeech[pi] !== null &&
                    (earliest === -1 || lastSpeech[pi] < lastSpeech[earliest]))
                    earliest = pi;
            }
            if (earliest !== -1)
                ui.video.major = earliest;
        }

        if (user) {
            // If we currently have no major, this'll do
            if (ui.video.major === -1 && peer !== net.selfId)
                ui.video.major = peer;
        }

        // If we still have no major, just choose one
        if (ui.video.major === -1) {
            for (pi = users.length - 1; pi >= 0; pi--) {
                if (users[pi] && ui.video.users[pi]) {
                    ui.video.major = pi;
                    break;
                }
            }
        }

    } else {
        // No major
        ui.video.selected = ui.video.major = -1;

    }

    // First rearrange them all in the side box
    var active = 0;
    for (pi = 0; pi < users.length; pi++) {
        let v = ui.video.users[pi];
        let u = users[pi];
        if (!v) continue;

        // Speech status
        if (u) {
            active++;

            var selected = (ui.video.selected === pi);
            if (lastSpeech[pi] !== null)
                v.box.style.borderColor = ui.colors["video-speaking" + (selected?"-sel":"")];
            else
                v.box.style.borderColor = ui.colors["video-silent" + (selected?"-sel":"")];
        }

        // Box positioning
        if (ui.video.major === pi) continue;
        if (!u && v.box.parentNode)
            v.box.parentNode.removeChild(v.box);
        else if (u && v.box.parentNode !== ui.video.side)
            ui.video.side.appendChild(v.box);
    }

    // Gallery sizing
    if (gallery) {
        /* Optimize for individual videos to be as close to 16/9 as possible:
         * 16/9 = (deviceWidth*h) / (deviceHeight*w), w*h=elementCount
         * 16/9 = (deviceWidth*h) / (deviceHeight*w), h=elementCount/w
         * 16/9 = (deviceWidth*elementCount) / (deviceHeight*w*w)
         * 9/16 = (deviceHeight*w*w) / (deviceWidth*elementCount)
         * (9 * deviceWidth * elementCount) / 16 = (deviceHeight*w*w)
         * (9 * deviceWidth * elementCount) / (16 * deviceHeight) = w*w
         * w = sqrt((9 * deviceWidth * elementCount) / (16 * deviceHeight))
         */
        let side = ui.video.side;
        let total = side.childNodes.length;
        let w = Math.round(Math.sqrt((9 * side.offsetWidth * total) / (16 * side.offsetHeight)));
        if (w < 1)
            w = 1;
        let ew = Math.max((100 / w) - 1, 1);
        let mw = 100 / w;
        ui.video.css.innerHTML = '[data-gallery="on"] #ecvideo-side .ecvideo { flex: auto; width: ' + ew +  '%; max-width: ' + mw + '%; }';
    }

    if (ui.video.major === prevMajor) {
        // No need to change the major
        return;
    }

    // Remove anything left over highlighted
    ui.video.main.innerHTML = "";

    // And highlight it
    if (ui.video.major !== -1) {
        let v = ui.video.users[ui.video.major];
        ui.video.main.appendChild(v.box);
    }
}

// Generate a standin abbreviated name given a full name
function genStandinName(name: string) {
    name = name.replace(/[&<>]/g, "");

    if (name.length <= 2)
        return name;

    var out = name[0];
    name = name.slice(1);

    // Ideal: Last capital character
    var uc = name.match(/\p{Lu}/gu);
    if (uc)
        return out + uc[uc.length-1];

    // Otherwise: Just the next character
    return out + name[0];
}
