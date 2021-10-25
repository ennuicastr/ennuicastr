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

import * as config from "./config";
import * as net from "./net";
import { prot } from "./protocol";
import * as util from "./util";
import { dce } from "./util";

// Interface modes
export enum ViewMode {
    Normal = 0,
    Small,
    Gallery,
    Studio
}

// A panel needs at least a showable wrapper
interface Panel {
    wrapper: HTMLElement;
    onshow?: ()=>void;
    onhide?: ()=>void;
}

// The currently visible panel
let curPanel: Panel = null;

/* A panel can be modal, in which case showPanel(null) won't hide it. Actually
 * only used for the mobile forced-click to disable sleep. */
let modal: Panel = null;

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

    // Set by output processing to allow setting output volume
    outprocSetPerUserGain: <(target: number, gain: number)=>unknown> null,

    // Set by the master code to allow administration
    masterUserAdmin: <(target: number)=>unknown> null,

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
            /* The arrangement goes like this
             * <div box-a rflex>
             *   <div box-b>
             *     <video element />
             *     <standin element />
             *     <name label />
             *     <captions />
             *     <popout button />
             *   </div>
             *   <admin button />
             *   <div flexible waveformWrapper>
             *     <waveform canvas />
             *   </div>
             * </div>
             */

            boxA: HTMLElement,
            boxB: HTMLElement,
            video: HTMLVideoElement,
            audio: HTMLAudioElement,
            standin: HTMLElement,
            name: HTMLElement,
            caption: HTMLElement,
            captions: {
                div: HTMLElement,
                span: HTMLElement,
                complete: boolean,
                timeout: number
            }[],
            popout: HTMLButtonElement,
            admin: HTMLButtonElement,
            waveformWrapper: HTMLElement
        }[],

        // Which user is selected?
        selected: number,

        // Which user is the current major?
        major: number,

        // Which interface mode are we in?
        mode: ViewMode,

        // A global stylesheet to help mode changes
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
        watcher: HTMLImageElement
    }> null,

    // Status
    log: <{
        wrapper: HTMLElement,
        logWrapper: HTMLElement,
        log: HTMLElement,
        timer: HTMLElement
    }> null,

    // The persistent menu
    persistent: <{
        master: HTMLButtonElement,
        userAdmin: HTMLButtonElement,
        sounds: HTMLButtonElement,
        masterSpacer: HTMLElement,
        mute: HTMLButtonElement,
        camera: HTMLButtonElement,
        shareScreen: HTMLButtonElement,
        main: HTMLButtonElement,
        chat: HTMLButtonElement,
        videoPopout: HTMLButtonElement
    }> null,

    // The separator for panel layering
    layerSeparator: <HTMLElement> null,

    // The panels
    panels: {
        // Mobile join menu
        mobile: <{
            wrapper: HTMLElement,
            button: HTMLButtonElement
        }> null,

        // Main (settings) menu
        main: <{
            wrapper: HTMLElement,
            modeHider: HTMLElement,
            modeS: HTMLSelectElement,
            captionHider: HTMLElement,
            captionC: HTMLInputElement,
            inputB: HTMLButtonElement,
            outputB: HTMLButtonElement,
            videoB: HTMLButtonElement,
            userListB: HTMLButtonElement,
            debug: HTMLButtonElement
        }> null,

        // Master interface
        master: <{
            wrapper: HTMLElement,

            // Main popout behavior
            mainPopout: HTMLButtonElement,
            mainPopoutWrapper: HTMLElement,
            mainPopoutDock: HTMLElement,
            mainDock: HTMLElement,

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
            echo: HTMLButtonElement,
            reqFull: HTMLButtonElement
        }> null,

        // User administration for a particular user, full interface
        userAdminFull: <{
            wrapper: HTMLElement,

            // Which user are we administrating?
            user: number,

            // Box for this user's name
            name: HTMLElement,

            // Active elements
            kick: HTMLButtonElement,
            mute: HTMLInputElement,
            echo: HTMLInputElement,
            audioInput: HTMLSelectElement,
            videoHider: HTMLElement,
            videoInput: HTMLSelectElement,
            videoRes: HTMLSelectElement,
            videoBR: HTMLInputElement,
            videoRec: HTMLButtonElement
        }> null,

        // User administration request
        userAdminReq: <{
            wrapper: HTMLElement,

            // Which user is requesting access?
            user: number,

            // Box for the user's name
            name: HTMLElement,

            // Response options
            yes: HTMLButtonElement,
            audio: HTMLButtonElement,
            no: HTMLButtonElement
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

            // Currently visible?
            visible: boolean;

            // The video config panel needs onshow/onhide for the preview
            onshow: ()=>void;
            onhide: ()=>void;

            // Preview pane
            preview: HTMLElement,

            // Preview MediaStream, if one is on right now
            previewS: MediaStream,

            // Preview video, if one is on right now
            previewV: HTMLVideoElement,

            // Device selection
            device: HTMLSelectElement,

            // Share/unshare button
            shareB: HTMLButtonElement,

            // Resolution selection
            res: HTMLSelectElement,

            // Hider for output options
            outputHider: HTMLElement,

            // Recording-related options
            recording: {
                // Hider for recording options if unsupported
                hider: HTMLElement,

                // Do or do not record
                record: HTMLInputElement,

                // Hider for specific recording options
                optHider: HTMLElement,

                // Send to host?
                remote: HTMLInputElement,

                // Save locally?
                local: HTMLInputElement,

                // Manual bitrate?
                manualBitrate: HTMLInputElement,

                // Hider for manual bitrate option
                bitrateHider: HTMLInputElement,

                // Manual bitrate selection
                bitrate: HTMLInputElement
            },

            // Streamer mode
            streamerModeHider: HTMLElement,
            streamerMode: HTMLInputElement
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
        }> null,

        // Debugging
        debug: <{
            wrapper: HTMLElement,
            input: HTMLInputElement,
            output: HTMLElement
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
const lastSpeech: number[] = [];

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
export function showPanel(panelName: Panel|string, autoFocusName: HTMLElement|string, makeModal?: boolean): void {
    let panel: Panel;
    let autoFocus: HTMLElement = null;
    if (typeof autoFocusName === "string")
        autoFocus = (<any> ui.panels)[<string> panelName][autoFocusName];
    else if (typeof autoFocus !== "undefined")
        autoFocus = autoFocusName;
    if (typeof panelName === "string")
        panel = (<any> ui.panels)[panelName];
    else
        panel = panelName;

    // Keep modal panels
    if (modal && panel !== modal)
        return;
    modal = makeModal ? panel : null;

    // Hide all existing panels
    for (const o in ui.panels) {
        (<any> ui.panels)[o].wrapper.style.display = "none";
    }
    if (curPanel) {
        if (curPanel.onhide)
            curPanel.onhide();
        curPanel = null;
    }

    // Show this one
    if (panel) {
        ui.layerSeparator.style.display = "";
        panel.wrapper.style.display = "block";
        document.body.setAttribute("data-interface", "none");

        if (autoFocus)
            autoFocus.focus();
        else
            (<HTMLElement> panel.wrapper.childNodes[0]).focus();

        curPanel = panel;
        if (panel.onshow)
            panel.onshow();

    } else {
        ui.layerSeparator.style.display = "none";
        mouseenter();

        if (autoFocus)
            autoFocus.focus();

    }

    resizeUI();
}

// Unset the modal panel so it can be hidden
export function unsetModal(): void {
    modal = null;
}

// Functionality for auto-hiding the persistent panel
let metimeout: null|number = null;
export function mouseenter(): void {
    if (metimeout)
        clearTimeout(metimeout);
    document.body.setAttribute("data-interface", "show");
    metimeout = setTimeout(function() {
        if (document.body.getAttribute("data-interface") === "show")
            document.body.setAttribute("data-interface", "hide");
    }, 2000);
}

// Saveable config for a box with a string value
export function saveConfigValue(sel: HTMLSelectElement|HTMLInputElement, name: string, onchange?: (arg0:Event)=>void): void {
    const cur = localStorage.getItem(name);
    if (cur !== null)
        sel.value = cur;
    sel.onchange = function(ev) {
        localStorage.setItem(name, sel.value);
        if (onchange)
            return onchange(ev);
    };
}

// Saveable configuration for a checkbox
export function saveConfigCheckbox(cb: HTMLInputElement, name: string, onchange?: (arg0:Event)=>void): void {
    const cur = localStorage.getItem(name);
    if (cur !== null)
        cb.checked = !!~~cur;
    cb.onchange = function(ev) {
        localStorage.setItem(name, cb.checked?"1":"0");
        if (onchange)
            return onchange(ev);
    };
}

// Saveable configuration for a slider
export function saveConfigSlider(sl: HTMLInputElement, name: string, onchange?: (arg0:Event)=>void): void {
    const cur = localStorage.getItem(name);
    if (cur !== null)
        sl.value = ""+(+cur);
    sl.onchange = function(ev) {
        let ret;
        if (onchange)
            ret = onchange(ev);
        localStorage.setItem(name, ""+sl.value);
        return ret;
    };
}

// Resize the UI to fit visible components
export function resizeUI(second?: boolean): void {
    /* Since elements sometimes take an event loop to actually assert their
     * sizes, resizeUI automatically runs itself twice */
    if (!second)
        setTimeout(function() { resizeUI(true); }, 0);

    // In the small UI, some elements are irrelevant
    if (ui.video.mode === ViewMode.Small && ui.chat.wrapper.style.display === "none") {
        //if (ui.chat.wrapper.style.display === "none" && ui.video.mainWrapper.style.display === "none") {
        ui.video.wrapper.style.display = "none";
        ui.wave.wrapper.style.flex = "auto";
    } else {
        ui.video.wrapper.style.display = "";
        ui.wave.wrapper.style.flex = "";
    }

    // Figure out the ideal size for the UI based on what's visible
    let idealSize = 0;

    // First, the standard elements
    for (let ci = 0; ci < ui.wrapper.childNodes.length; ci++) {
        const c = <HTMLElement> ui.wrapper.childNodes[ci];
        if (c.style.display === "none")
            continue;
        if (c === ui.video.wrapper) {
            if (ui.video.mode === ViewMode.Studio) {
                // Doesn't flex
                let vsize = ui.video.side.childNodes.length * 96;
                if (vsize > 240)
                    vsize = 240;
                idealSize += vsize;
            } else {
                idealSize += 240;
            }
        } else if (c === ui.wave.wrapper && ui.video.mode !== ViewMode.Studio) {
            idealSize += 100;
        } else {
            idealSize += c.offsetHeight;
        }
    }

    // Then, any visible panel
    for (const pn in ui.panels) {
        const panel: HTMLElement = (<any> ui.panels)[pn].wrapper;
        if (panel.style.display === "block")
            idealSize = Math.max(idealSize, panel.scrollHeight + 60);
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

// Resize when requested
util.events.addEventListener("ui.resize-needed", function() { resizeUI(); });

// React to the UI resizing
export function onResize(): void {
    ui.resized = true;
    ui.manualSize = !ui.resizing;

    // Some browsers need a real height to flex properly
    ui.wrapper.style.height = window.innerHeight + "px";

    // If we're in gallery mode, we may need to change the arrangement
    if (ui.video.mode === ViewMode.Gallery)
        updateVideoUI(0);
}

// Add a user to the user list
export function userListAdd(idx: number, name: string, fromMaster: boolean): void {
    if (("master" in config.config) !== fromMaster)
        return;

    // First to the normal user list
    const userList = ui.panels.userList;
    while (userList.users.length <= idx)
        userList.users.push(null);

    let user = userList.users[idx];
    if (user) {
        // Just update their name
        if (name) {
            user.name.innerText = name;
            user.name.setAttribute("aria-label", name + ": Not speaking");
            ui.video.users[idx].name.innerText = name;
            styleVideoEl(ui.video.users[idx], name);
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
    const volumeWrapper = dce("div");

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
    let mousing = false;
    function volChange() {
        const vol = user.volume;

        // Snap to x00%
        if (mousing) {
            for (let i = 100; i <= 300; i += 100)
                if (+vol.value >= i - 10 && +vol.value <= i + 10)
                    vol.value = ""+i;
        }

        // Show the status
        user.volumeStatus.innerHTML = "&nbsp;" + vol.value + "%";

        // Set it
        ui.outprocSetPerUserGain(idx, (+vol.value) / 100);
    }

    user.volume.onmousedown = function() { mousing = true; };
    user.volume.onmouseup = function() { mousing = false; };

    saveConfigSlider(user.volume, "user-volume3-" + name, volChange);
    volChange();

    // Give them a user element
    videoAdd(idx, name);
    updateVideoUI(idx, false, fromMaster);

    // Chime
    if (!ui.panels.outputConfig.muteInterface.checked)
        ui.sounds.chimeUp.play().catch(console.error);
}

// Cogito ergo sum
util.events.addEventListener("net.info." + prot.info.id, function(ev: CustomEvent) {
    const val: number = ev.detail.val;
    userListAdd(val, config.username, false);
});


// Add a video element for this user, if they don't already have one
export function videoAdd(idx: number, name: string): void {
    if (ui.video.users[idx])
        return;
    while (ui.video.users.length <= idx)
        ui.video.users.push(null);

    const ctx = ui.video.users[idx] = {
        boxA: dce("div"),
        boxB: dce("div"),
        video: dce("video"),
        audio: dce("audio"),
        standin: dce("div"),
        name: dce("span"),
        caption: dce("div"),
        captions: [],
        popout: dce("button"),
        admin: <HTMLButtonElement> null,
        waveformWrapper: dce("div")
    };

    /* The outer box */
    const boxA = ctx.boxA;
    boxA.classList.add("ecvideo-a");

    /* The inner box */
    const box = ctx.boxB;
    box.classList.add("ecvideo");
    box.style.border = "4px solid " + ui.colors["video-silent"];
    boxA.appendChild(box);

    // The video element itself
    const video = ctx.video;
    video.height = 0; // Use CSS for style
    video.muted = true; // Audio goes through a different system
    video.autoplay = true;
    Object.assign(video.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%"
    });
    box.appendChild(video);

    // The audio element, just used to make sure audio is actually playing
    const audio = ctx.audio;
    audio.muted = true;
    audio.autoplay = true;
    audio.style.display = "none";
    box.appendChild(audio);

    // When you click, they become the selected major
    video.onclick = function() {
        if (ui.video.selected === idx)
            ui.video.selected = -1;
        else
            ui.video.selected = idx;
        updateVideoUI(idx);
    };

    // The standin for when there is no video
    const standin = ctx.standin;
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
    const nspan = ctx.name;
    nspan.classList.add("namelabel");
    nspan.innerText = name || "";
    nspan.setAttribute("role", "note");
    nspan.setAttribute("aria-label", nspan.innerText + ": Not speaking");
    box.appendChild(nspan);

    // Box for captions
    const caption = ctx.caption;
    caption.classList.add("caption");
    box.appendChild(caption);

    // And popout button
    const popout = ctx.popout;
    popout.classList.add("pobutton", "tbutton", "interface", "streamer-interface");
    popout.innerHTML = '<i class="fa fa-window-restore"></i>';
    popout.title = "Pop out";
    popout.setAttribute("aria-label", "Pop out");
    box.appendChild(popout);

    let w: WindowProxy = null;

    function popoutOpen() {
        let width = 800, height = 450;
        if (video.srcObject) {
            const vt = video.srcObject.getVideoTracks();
            if (vt && vt.length) {
                const s = vt[0].getSettings();
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

    // The admin button
    if ("master" in config.config) {
        const admin = ctx.admin = dce("button");
        admin.classList.add("ecstudio-admin-button");
        admin.innerHTML = '<i class="fas fa-user-cog"></i>';
        admin.title = "Administrate " + name;
        admin.setAttribute("aria-label", "Administrate " + name);
        admin.style.height = "100%";
        admin.onclick = function() {
            ui.masterUserAdmin(idx);
        };
        boxA.appendChild(admin);
    }

    // The waveform wrapper (only in studio mode)
    const waveformWrapper = ctx.waveformWrapper;
    waveformWrapper.classList.add("ecvideo-waveform");
    boxA.appendChild(waveformWrapper);
}

// Style a video element given a user's name
function styleVideoEl(ctx: {video: HTMLVideoElement, boxA: HTMLElement, standin: HTMLElement}, name: string) {
    if (!name) return;
    let x = parseInt(btoa(unescape(encodeURIComponent(name.slice(-6)))).replace(/[^A-Za-z0-9]/g, ""), 36);
    const r = x % 4;
    x = Math.floor(x / 4);
    const g = x % 4;
    x = Math.floor(x / 4);
    const b = x % 4;
    x = Math.floor(x / 4);
    const s = x % standinSVG.length;
    ctx.video.style.backgroundColor =
        ctx.boxA.style.backgroundColor = "#" + r + g + b;
    ctx.standin.innerHTML = standinSVG[s].replace("##", genStandinName(name || ""));
}

// Remove a user from the user list
export function userListRemove(idx: number, fromMaster: boolean): void {
    if (("master" in config.config) !== fromMaster)
        return;
    const user = ui.panels.userList.users[idx];
    if (!user) return;
    user.wrapper.parentNode.removeChild(user.wrapper);
    ui.panels.userList.users[idx] = null;

    updateVideoUI(idx, false, fromMaster);

    // Chime
    if (!ui.panels.outputConfig.muteInterface.checked)
        ui.sounds.chimeDown.play().catch(console.error);
}


// Add or remove users based on net commands
util.netEvent("data", "user", function(ev) {
    const msg: DataView = ev.detail;
    const p = prot.parts.user;
    const index = msg.getUint32(p.index, true);
    const status = msg.getUint32(p.status, true);
    const nick = util.decodeText(msg.buffer.slice(p.nick));

    // Add it to the UI
    if (status)
        userListAdd(index, nick, false);
    else
        userListRemove(index, false);
});


// Update the speaking status of an element in the user list
export function userListUpdate(idx: number, speaking: boolean, fromMaster: boolean): void {
    // The user list style follows the live info so it's somewhere
    if (!fromMaster) {
        const user = ui.panels.userList.users[idx];
        if (!user) return;
        user.name.style.backgroundColor = ui.colors["user-list-" + (speaking?"speaking":"silent")];
        user.name.setAttribute("aria-label", user.name.innerText + ": " + (speaking?"Speaking":"Not speaking"));
    }

    // But the rest follows the master (if we are one)
    if (("master" in config.config) !== fromMaster)
        return;

    updateVideoUI(idx, speaking, fromMaster);
}

// Update the user list when we get speech info
util.events.addEventListener("ui.speech", function(ev: CustomEvent) {
    let user = ev.detail.user;
    const status = ev.detail.status;
    if (user === null)
        user = net.selfId;
    userListUpdate(user, status, false);
});

// If we're *not* using RTC, then speech status comes from the data socket
util.netEvent("data", "speech", function(ev) {
    if (!config.useRTC) {
        const msg: DataView = ev.detail;
        const p = prot.parts.speech;
        const indexStatus = msg.getUint32(p.indexStatus, true);
        const index = indexStatus>>>1;
        const status = (indexStatus&1);
        userListUpdate(index, !!status, false);
    }
});

// Update the video UI based on new information about this peer
export function updateVideoUI(peer: number, speaking?: boolean, fromMaster?: boolean): void {
    const ctx = ui.video.users[peer];
    const users = ui.panels.userList.users;
    const user = users[peer];
    const prevMajor = ui.video.major;
    const gallery = (ui.video.mode === ViewMode.Gallery);
    const studio = (ui.video.mode === ViewMode.Studio);

    // Update their speech
    while (lastSpeech.length <= peer)
        lastSpeech.push(null);
    if (typeof fromMaster !== "undefined") {
        if (speaking)
            lastSpeech[peer] = performance.now();
        else
            lastSpeech[peer] = null;

        let sw = "";
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

    if (!gallery && !studio) {
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
            let earliest = -1;
            for (let pi = 1; pi < users.length; pi++) {
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
            for (let pi = users.length - 1; pi >= 0; pi--) {
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

    // Tell RTC about our major
    util.dispatchEvent("ui.video.major");

    // First rearrange them all in the side box
    let moved = 0;
    for (let pi = 0; pi < users.length; pi++) {
        const v = ui.video.users[pi];
        const u = users[pi];
        if (!v) continue;

        // Speech status
        if (u) {
            const selected = (ui.video.selected === pi);
            if (lastSpeech[pi] !== null)
                v.boxB.style.borderColor = ui.colors["video-speaking" + (selected?"-sel":"")];
            else
                v.boxB.style.borderColor = ui.colors["video-silent" + (selected?"-sel":"")];
        }

        // Box positioning
        if (ui.video.major === pi) continue;
        if (!u && v.boxA.parentNode) {
            v.boxA.parentNode.removeChild(v.boxA);
            moved++;
        } else if (u && v.boxA.parentNode !== ui.video.side) {
            ui.video.side.appendChild(v.boxA);
            moved++;
        }
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
        const side = ui.video.side;
        const total = side.childNodes.length;
        let w = Math.round(Math.sqrt((9 * side.offsetWidth * total) / (16 * side.offsetHeight)));
        if (w < 1)
            w = 1;
        const ew = Math.max((100 / w) - 1, 1);
        const mw = 100 / w;
        ui.video.css.innerHTML = '[data-view-mode="gallery"] #ecvideo-side .ecvideo-a { flex: auto; width: ' + ew +  '%; max-width: ' + mw + '%; }';
    }

    // Studio sizing
    if (studio && moved)
        resizeUI();

    if (ui.video.major === prevMajor) {
        // No need to change the major
        return;
    }

    // Remove anything left over highlighted
    ui.video.main.innerHTML = "";

    // And highlight it
    if (ui.video.major !== -1) {
        const v = ui.video.users[ui.video.major];
        ui.video.main.appendChild(v.boxA);
    }
}

// Generate a standin abbreviated name given a full name
function genStandinName(name: string) {
    name = name.replace(/[&<>]/g, "");

    if (name.length <= 2)
        return name;

    const out = name[0];
    name = name.slice(1);

    // Ideal: Last capital character
    let re: RegExp;
    try {
        re = RegExp("\\p{Lu}", "gu");
    } catch (ex) {
        re = RegExp("[A-Z]", "g");
    }
    const uc = name.match(re);
    if (uc)
        return out + uc[uc.length-1];

    // Otherwise: Just the next character
    return out + name[0];
}

// Receive caption information for a user
export function caption(peer: number, text: string, append: boolean, complete: boolean) {
    const ctx = ui.video.users[peer];
    if (!ctx) return;

    // Look for a previous partial
    let caption: {
        div: HTMLElement,
        span: HTMLElement,
        complete: boolean,
        timeout: number
    } = null;
    if (ctx.captions.length) {
        caption = ctx.captions[ctx.captions.length - 1];
        if (caption.complete)
            caption = null;
    }
    if (caption)
        clearTimeout(caption.timeout);

    // Otherwise, make a new caption
    if (!caption) {
        caption = {
            div: dce("div"),
            span: dce("span"),
            complete: complete,
            timeout: null
        };
        ctx.caption.appendChild(caption.div);
        caption.div.appendChild(caption.span);
        ctx.captions.push(caption);
    }

    // Set its content
    if (append)
        caption.span.innerText += text;
    else
        caption.span.innerText = text;
    caption.complete = complete;

    // And timeout
    caption.timeout = setTimeout(function() {
        for (let i = 0; i < ctx.captions.length; i++) {
            const other = ctx.captions[i];
            if (caption === other) {
                ctx.captions.splice(i, 1);
                break;
            }
        }
        ctx.caption.removeChild(caption.div);
    }, 3000);
}
