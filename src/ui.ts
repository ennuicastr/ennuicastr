/*
 * Copyright (c) 2018-2024 Yahweasel
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
 * API for the user interface.
 */

import * as barrierPromise from "./barrier-promise";
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
    wrapper: HTMLDialogElement,
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
    /* Is the size controlled by the user? */
    userSized: false,

    /* The last time we attempted a resize */
    autoResized: -1,

    /* The last height we attempted to set */
    lastHeight: -1,

    // Set by output processing to allow setting output volume
    outprocSetPerUserGain: <(target: number, gain: number)=>unknown> null,

    // Set by the master code to allow administration
    masterUserAdmin: <(target: number)=>unknown> null,

    // Colors defined in CSS
    colors: <Record<string, string>> {},

    // Main rows
    rows: <{
        top: HTMLElement,
        main: HTMLElement,
        waveform: HTMLElement
    }> null,

    // Video interface
    video: <{
        // The window, if it's been popped out into a window
        window: WindowProxy,

        // The main wrapper for all video
        wrapper: HTMLElement,

        // Side container
        sideOuter: HTMLElement,
        side: HTMLElement,

        // Main video element 
        main: HTMLElement,

        // Video components for each user
        users: {
            box: HTMLElement,
            videoContainer: HTMLElement,
            video: HTMLElement,
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

    // Live waveform
    wave: <{
        wrapper: HTMLElement,
        watcher: HTMLImageElement
    }> null,

    // Status
    log: <{
        wrapper: HTMLElement,
        spacer: HTMLElement,
        name: HTMLElement,
        timer: HTMLElement
    }> null,

    // The main menu
    mainMenu: <{
        showHide: HTMLButtonElement,
        fullscreen: HTMLButtonElement,
        wrapper: HTMLElement,
        host: HTMLButtonElement,
        userAdmin: HTMLButtonElement,
        sounds: HTMLButtonElement,
        mute: HTMLButtonElement,
        shareVideo: HTMLButtonElement,
        shareScreen: HTMLButtonElement,
        settings: HTMLButtonElement,
        chat: HTMLButtonElement,
        help: HTMLButtonElement,
        videoPopout: HTMLButtonElement
    }> null,

    // The separator for panel layering
    layerSeparator: <HTMLElement> null,

    // The panels
    panels: {
        // Transient activation panel
        transientActivation: <{
            wrapper: HTMLDialogElement,
            onhide?: ()=>void,
            label: HTMLElement,
            button: HTMLButtonElement
        }> null,

        // WebDAV login panel
        webdav: <{
            wrapper: HTMLDialogElement,
            onhide?: ()=>void,
            form: HTMLFormElement,
            username: HTMLInputElement,
            password: HTMLInputElement,
            url: HTMLInputElement,
            login: HTMLButtonElement
        }> null,

        // Settings menu
        settings: <{
            wrapper: HTMLDialogElement,
            viewModes: {
                normal: HTMLButtonElement,
                gallery: HTMLButtonElement,
                studio: HTMLButtonElement,
                small: HTMLButtonElement,
            },
            captionHider: HTMLElement,
            captionC: HTMLInputElement,
            inputB: HTMLButtonElement,
            outputB: HTMLButtonElement,
            videoB: HTMLButtonElement,
            userListB: HTMLButtonElement
        }> null,

        // Invite panel
        invite: <{
            // Button to show the invite panel
            button: HTMLButtonElement,

            wrapper: HTMLDialogElement,

            // Invite
            link: HTMLInputElement,
            copyB: HTMLButtonElement,
            flacHider: HTMLElement,
            flac: HTMLInputElement,
            continuousHider: HTMLElement,
            continuous: HTMLInputElement,
        }> null,

        // Host interface
        host: <{
            wrapper: HTMLDialogElement,

            // Start recording
            startB: HTMLButtonElement[],

            // Hider for the pause/stop interface
            stopHider: HTMLElement,

            // Pause recording
            pauseB: HTMLButtonElement[],

            // Resume from pause
            resumeB: HTMLButtonElement[],

            // Stop recording
            stopB: HTMLButtonElement[],

            // Hider for the "are you sure" interface"
            sureHider: HTMLElement,

            // Acknowledgement
            stopYesB: HTMLButtonElement,
            stopNoB: HTMLButtonElement,

            // Invite button
            inviteB: HTMLButtonElement,

            // Accept guest video recordings
            acceptRemoteVideo: HTMLInputElement,

            // Save video to cloud storage
            saveVideoInCloud: HTMLInputElement,
            saveVideoInCloudLbl: HTMLLabelElement,

            // Save video to FileSystemDirectoryHandle
            saveVideoInFSDHHider: HTMLElement,
            saveVideoInFSDH: HTMLInputElement,

            // Download the video live
            downloadVideoLive: HTMLInputElement,

            // Video storage status
            videoStatus: HTMLElement,

            // Recording cost/rate
            recordingCost: HTMLInputElement,
            recordingRate: HTMLInputElement
        }> null,

        // User administration interface
        userAdmin: <{
            wrapper: HTMLDialogElement,

            // Administration for *all* users
            allB: HTMLButtonElement,

            // Buttons for *each* user
            buttons: HTMLButtonElement[]
        }> null,

        // User administration for a particular user
        userAdminUser: <{
            wrapper: HTMLDialogElement,

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
            wrapper: HTMLDialogElement,

            // Which user are we administrating?
            user: number,

            // Box for this user's name
            name: HTMLElement,

            // Active elements
            kick: HTMLButtonElement,
            mute: HTMLInputElement,
            echo: HTMLInputElement,
            vadSensitivity: HTMLInputElement,
            vadSensitivityStatus: HTMLElement,
            vadNoiseGate: HTMLInputElement,
            vadNoiseGateStatus: HTMLElement,
            audioInput: HTMLSelectElement,
            videoHider: HTMLElement,
            videoInput: HTMLSelectElement,
            videoRes: HTMLSelectElement,
            videoBR: HTMLInputElement,
            videoRec: HTMLButtonElement
        }> null,

        // User administration request
        userAdminReq: <{
            wrapper: HTMLDialogElement,

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
            wrapper: HTMLDialogElement,

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
            wrapper: HTMLDialogElement,

            // Device selection
            device: HTMLSelectElement,

            // Channel selection
            channelHider: HTMLElement,
            channel: HTMLSelectElement,

            // PTT button
            ptt: HTMLButtonElement,

            // Options
            noiserHider: HTMLElement,
            noiser: HTMLInputElement,
            echo: HTMLInputElement,
            dualEC: HTMLInputElement,
            agcHider: HTMLElement,
            agc: HTMLInputElement,
            vadSensitivity: HTMLInputElement,
            vadSensitivityStatus: HTMLElement,
            vadNoiseGate: HTMLInputElement,
            vadNoiseGateStatus: HTMLElement
        }> null,

        // Output device selection
        outputConfig: <{
            wrapper: HTMLDialogElement,

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
            wrapper: HTMLDialogElement,

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
            wrapper: HTMLDialogElement,

            // The actual user list
            userList: HTMLElement,

            // User list elements
            users: {
                wrapper: HTMLElement,
                name: HTMLElement,
                connectionInfo: HTMLElement,
                volume: HTMLInputElement,
                volumeStatus: HTMLElement
            }[]
        }> null,

        // Cloud storage selection panel
        cloudStorage: <{
            wrapper: HTMLDialogElement,
            onhide?: ()=>void,
            desc: HTMLElement,
            googleDrive: HTMLButtonElement,
            dropbox: HTMLButtonElement,
            webdav: HTMLButtonElement,
            fsdh: HTMLButtonElement,
            cancel: HTMLButtonElement
        }> null,

        // Help screen
        help: <{
            wrapper: HTMLDialogElement
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
    '<svg viewBox="0 0 512 512" style="position:absolute;left:0;top:0;width:100%;height:100%"><g transform="translate(0,215)"><rect ry="128" rx="128" y="-215" x="0" height="512" width="512" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66518928px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 640 512" style="position:absolute;left:0;top:0;width:100%;height:100%"><g transform="translate(64,215)"><path transform="matrix(1.3149081,0,0,1.1060609,-80.616476,-4.348493)" d="m 256.00001,-190.45201 243.36301,176.81359 -92.95641,286.09039 -300.81323,-1e-5 -92.956399,-286.090393 z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 512 512" style="position:absolute;left:0;top:0;width:100%;height:100%"><g transform="translate(0,215)"><path transform="matrix(1.1552103,0,0,1.0004415,-39.733837,-24.463922)" d="m 256.00001,-190.45201 221.60466,127.943517 -10e-6,255.887023 -221.60467,127.94351 -221.604657,-127.94352 7e-6,-255.887025 z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66518928px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 576 512" style="position:absolute;left:0;top:0;width:100%;height:100%"><g transform="translate(32,215)"><path transform="matrix(1.1544409,0,0,1.0525596,-39.536869,-14.537931)" d="M 256.00001,-190.45201 456.06054,-94.107932 505.4714,122.37524 367.02521,295.98126 144.97478,295.98125 6.5285965,122.37523 55.939473,-94.107942 Z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 640 512" style="position:absolute;left:0;top:0;width:100%;height:100%"><g transform="translate(64,215)"><path transform="matrix(1.25,0,0,1,-64,0)" d="M 256.00001,-215.00002 437.01934,-140.01935 512,40.999988 437.01933,222.01932 255.99999,296.99998 74.980659,222.01931 0,40.999974 74.980669,-140.01936 Z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 576 512" style="position:absolute;left:0;top:0;width:100%;height:100%"><g transform="translate(32,215)"><path transform="matrix(1.1423549,0,0,1.0310912,-36.442856,6.6846075)" d="m 256.00001,-215.00002 164.55362,59.89263 87.55716,151.6534442 -30.40829,172.4539358 -134.14535,112.5613 -175.11431,0 L 34.297493,168.99997 3.8892164,-3.4539593 91.446377,-155.1074 Z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>',
    '<svg viewBox="0 0 544 512" style="position:absolute;left:0;top:0;width:100%;height:100%"><g transform="translate(16,215)"><path transform="matrix(1.1171786,0,0,1,-29.997722,0)" d="m 256.00001,-215.00002 150.47302,48.89165 92.99744,128.000007 0,158.216703 -92.99745,128 -150.47303,48.89164 -150.47302,-48.89165 -92.99744,-128.00001 4e-6,-158.216696 92.997446,-127.999994 z" style="opacity:0.5;fill:#ffffff" /><text style="font-size:298.66519165px;font-family:\'Noto Sans\',sans-serif;text-align:center;text-anchor:middle" y="149.86458" x="256">##</text></g></svg>'
];

/**
 * Show the requested panel by HTML element or name.
 * @param panel  Panel to show
 * @param autoFocus  Element to auto-focus on, or null for none
 * @param opts  Panel options
 * @param makeModal  Make the panel modal
 */
// Show the given panel, or none
export function showPanel(
    panel: Panel | null,
    autoFocus: HTMLElement | null = null,
    opts: {
        /** Make the panel modal */
        modal?: boolean
    } = {}
): void {
    if (panel === null && autoFocus === null)
        autoFocus = ui.mainMenu.settings;

    // Keep modal panels
    if (modal && panel !== modal)
        return;
    modal = opts.modal ? panel : null;

    // Hide all existing panels
    for (const o in ui.panels) {
        (<any> ui.panels)[o].wrapper.style.display = "none";
    }
    if (curPanel) {
        if (curPanel.onhide)
            curPanel.onhide();
        if (curPanel.wrapper.showModal)
            curPanel.wrapper.close();
        curPanel = null;
    }

    // Show this one
    if (panel) {
        ui.layerSeparator.style.display = "block";
        panel.wrapper.style.display = "block";

        if (panel.wrapper.showModal) {
            if (opts.modal)
                panel.wrapper.showModal();
            else
                panel.wrapper.show();
        }

        if (autoFocus)
            autoFocus.focus();
        else
            (<HTMLElement> panel.wrapper.childNodes[0]).focus();

        curPanel = panel;
        if (panel.onshow)
            panel.onshow();

        maybeResizeSoon();

    } else {
        ui.layerSeparator.style.display = "none";

        if (autoFocus)
            autoFocus.focus();

        maybeResizeSoon();

    }
}

// Unset the modal panel so it can be hidden
export function unsetModal(): void {
    modal = null;
}

// Callbacks to call upon transient activation
let transientActivationCbs: barrierPromise.BarrierPromise[] = [];

// Set to force the next transient activation
let transientActivationForce = false;

/**
 * Perform an action upon transient activation.
 * @param act  Action to perform upon transient activation
 */
export function onTransientActivation(act: ()=>Promise<unknown>) {
    const b = new barrierPromise.BarrierPromise();
    transientActivationCbs.push(b);
    return b.promise.then(act);
}

/**
 * Force the next transient activation.
 */
export function forceTransientActivation() {
    transientActivationForce = true;
}

/**
 * If transient activation is needed (the user must judge this themselves),
 * wait for transient activation. Otherwise, just perform this action eagerly.
 * @param transientActivationNeeded  True if transient activation is needed
 * @param act  Action to perform upon transient activation (or eagerly)
 */
export function maybeOnTransientActivation(
    transientActivationNeeded: boolean,
    act: ()=>Promise<unknown>
) {
    if (transientActivationNeeded)
        return onTransientActivation(act);
    else
        return act();
}

/**
 * Do we need transient activation?
 */
export function needTransientActivation() {
    return transientActivationCbs.length !== 0;
}

/**
 * Show the transient activation panel with the given button text, and wait for
 * transient activation.
 * @param lblHTML  Label text (HTML) to show
 * @param btnHTML  Button text (HTML) to show
 * @param opts  Other activation options
 */
export function transientActivation(
    lblHTML: string,
    btnHTML: string,
    opts: {
        makeModal?: boolean,
        force?: boolean
    } = {}
) {
    if (!opts.force &&
        !transientActivationForce &&
        (<any> navigator).userActivation &&
        (<any> navigator).userActivation.isActive) {
        return;
    }

    transientActivationForce = false;

    const taPanel = ui.panels.transientActivation;
    taPanel.label.innerHTML = lblHTML;
    taPanel.button.innerHTML = btnHTML;

    const cbs = transientActivationCbs;
    transientActivationCbs = [];

    const b = new barrierPromise.BarrierPromise();
    cbs.push(b);
    taPanel.button.onclick = () => {
        taPanel.onhide = null;
        unsetModal();
        showPanel(null);

        for (const cb of cbs)
            cb.res();
    };
    taPanel.onhide = () => {
        for (const cb of cbs)
            cb.rej("closed");
    };
    showPanel(taPanel, taPanel.button, {modal: opts.makeModal});

    return Promise.all(cbs.map(x => x.promise));
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
export function saveConfigSlider(
    sl: HTMLInputElement, name: string, onchange?: (arg0:Event)=>void,
    oninput?: (arg0:Event)=>void
): void {
    const cur = localStorage.getItem(name);
    if (cur !== null)
        sl.value = ""+(+cur);
    if (oninput)
        sl.oninput = oninput;
    sl.onchange = function(ev) {
        let ret;
        if (onchange)
            ret = onchange(ev);
        localStorage.setItem(name, ""+sl.value);
        return ret;
    };
}

// Saveable config for things that don't easily correspond to elements
export function saveConfigGeneric(name: string, init: (value:string)=>void) {
    const cur = localStorage.getItem(name);
    init(cur);
    return function(to: string) {
        localStorage.setItem(name, to);
    };
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
        connectionInfo: dce("div"),
        volume: dce("input"),
        volumeStatus: dce("div")
    };
    const nameWrapper = dce("div");
    const volumeWrapper = dce("div");

    /* Here's how it all lays out:
     *  <div wrapper bigrflex row>
     *      <div nameWrapper row>
     *          <div name>
     *          <div connectionInfo>
     *      </div>
     *      <div volumeWrapper rflex half>
     *          <input volume flex />
     *          <div status>status</div>
     *      </div>
     *  </div>
     */
    userList.userList.appendChild(user.wrapper);

    nameWrapper.classList.add("rflex");
    nameWrapper.classList.add("row");
    user.wrapper.appendChild(nameWrapper);

    Object.assign(user.name.style, {
        flex: "auto",
        padding: "0.1em",
        backgroundColor: "var(--user-list-silent)"
    });
    user.name.innerText = name;
    user.name.setAttribute("role", "note");
    user.name.setAttribute("aria-label", name + ": Not speaking");
    nameWrapper.appendChild(user.name);

    Object.assign(user.connectionInfo.style, {
        minWidth: "6em",
        textAlign: "right",
        padding: "0.1em",
        backgroundColor: "var(--user-list-conn-unreliable)"
    });
    user.connectionInfo.innerHTML = "&nbsp;";
    user.connectionInfo.setAttribute("role", "note");
    user.connectionInfo.setAttribute("aria-label", `${name}: No connection`);
    nameWrapper.appendChild(user.connectionInfo);

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
    userListAdd(val, config.username, "master" in config.config);
    const user = ui.panels.userList.users[val];
    user.connectionInfo.style.backgroundColor = "var(--user-list-conn-reliable)";
});


// Add a video element for this user, if they don't already have one
export function videoAdd(idx: number, name: string): void {
    if (ui.video.users[idx])
        return;
    while (ui.video.users.length <= idx)
        ui.video.users.push(null);

    const ctx = ui.video.users[idx] = {
        box: dce("div"),
        videoContainer: dce("div"),
        video: dce("video"),
        audio: dce("audio"),
        standin: dce("div"),
        name: dce("span"),
        caption: dce("div"),
        captions: <any[]> [],
        popout: <HTMLButtonElement> dce("button"),
        admin: <HTMLButtonElement> null,
        waveformWrapper: dce("div")
    };

    /* The outer box */
    const box = ctx.box;
    box.classList.add("ec3-video");
    box.style.border = "4px solid var(--video-silent)";

    // The container for the video element
    const videoContainer = ctx.videoContainer;
    videoContainer.classList.add("ec3-video-container");
    videoContainer.style.display = "none";
    box.appendChild(videoContainer);

    // The video element itself
    const video = ctx.video;
    video.classList.add("ec3-video-video");
    //video.classList.add("fauto");
    video.height = 0; // Use CSS for style
    video.muted = true; // Audio goes through a different system
    video.autoplay = true;
    videoContainer.appendChild(video);

    // The audio element, just used to make sure audio is actually playing
    const audio = ctx.audio;
    audio.muted = true;
    audio.autoplay = true;
    audio.style.display = "none";
    box.appendChild(audio);

    // When you click, they become the selected major
    videoContainer.onclick = function() {
        if (ui.video.selected === idx)
            ui.video.selected = -1;
        else
            ui.video.selected = idx;
        updateVideoUI(idx);
    };

    // The standin for when there is no video
    const standin = ctx.standin;
    standin.classList.add("ec3-video-standin");
    //standin.classList.add("fauto");
    box.appendChild(standin);
    standin.onclick = videoContainer.onclick;

    styleVideoEl(ctx, name);

    // Their personal label
    const nspan = ctx.name;
    nspan.classList.add("ec3-name-label");
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
    popout.classList.add("ec3-individual-popout-button", "round-button", "streamer-interface");
    popout.innerHTML = '<i class="bx bx-windows"></i>';
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

        const css = document.createElement("style");
        css.innerHTML =
            "body { margin: 0; }\n" +
            "body > video { width: 100%; height: 100%; }";
        w.document.head.appendChild(css);

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
        admin.classList.add("round-button");
        admin.classList.add("ec3-studio-admin-button");
        admin.innerHTML = '<i class="bx bx-user"></i>';
        admin.title = "Administrate " + name;
        admin.setAttribute("aria-label", "Administrate " + name);
        admin.onclick = function() {
            ui.masterUserAdmin(idx);
        };
        box.appendChild(admin);
    }

    // The waveform wrapper (only in studio mode)
    const waveformWrapper = ctx.waveformWrapper;
    waveformWrapper.classList.add("ec3-studio-video-waveform");
    box.appendChild(waveformWrapper);
}

// Style a video element given a user's name
function styleVideoEl(ctx: {video: HTMLElement, box: HTMLElement, standin: HTMLElement}, name: string) {
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
        ctx.box.style.backgroundColor = "#" + r + g + b;
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
        user.name.style.backgroundColor = "var(--user-list-" + (speaking?"speaking":"silent") + ")";
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
export function updateVideoUI(
    peer: number, speaking?: boolean, fromMaster?: boolean
): void {
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
                v.box.style.borderColor = "var(--video-speaking" + (selected?"-sel":"") + ")";
            else
                v.box.style.borderColor = "var(--video-silent" + (selected?"-sel":"") + ")";
        }

        // Box positioning
        if (ui.video.major === pi) continue;
        if (!u && v.box.parentNode) {
            v.box.parentNode.removeChild(v.box);
            moved++;
        } else if (u && v.box.parentNode !== ui.video.side) {
            ui.video.side.appendChild(v.box);
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
        ui.video.sideOuter.style.display = "";
        const side = ui.video.side;
        const total = side.childNodes.length;
        const useWindow = ui.video.window || window;
        let w = Math.round(Math.sqrt(
            (9 * useWindow.innerWidth * total) /
            (16 * side.offsetHeight)
        ));
        if (w < 1)
            w = 1;
        const ew = Math.max((100 / w) - 1, 1);
        const mw = 100 / w;
        ui.video.css.innerHTML = '[data-view-mode="gallery"] #ec3-side-video-wrapperb .ec3-video { flex: auto; width: ' + ew +  '%; max-width: ' + mw + '%; }';
    }

    // Remove anything left over highlighted
    ui.video.main.innerHTML = "";

    // And highlight it
    if (ui.video.major !== -1) {
        const v = ui.video.users[ui.video.major];
        ui.video.main.appendChild(v.box);
    }

    // Maybe get rid of the side view entirely
    if (!gallery && !studio && !ui.video.side.children.length) {
        ui.video.sideOuter.style.display = "none";
    } else {
        ui.video.sideOuter.style.display = "";
    }

    maybeResizeSoon();
}

window.addEventListener("resize", () => {
    if (performance.now() > ui.autoResized + 500) {
        // Manual resize
        ui.userSized = true;
    }

    updateVideoUI(0);
});

// Maybe resize the window
export function maybeResize() {
    ui.autoResized = performance.now();

    // Figure out the correct size
    let h = ui.rows.top.offsetHeight
          + ui.log.wrapper.offsetHeight;
    if (ui.mainMenu.wrapper.style.display !== "none")
        h += ui.mainMenu.wrapper.offsetHeight
    switch (ui.video.mode) {
        case ViewMode.Normal:
        case ViewMode.Gallery:
            // Fixed height plus status
            h = 600 + ui.log.spacer.offsetHeight;
            break;

        case ViewMode.Small:
            // Just big enough
            h += ui.rows.waveform.offsetHeight;
            break;

        case ViewMode.Studio:
            // Plus the studio stuff
            h += 2 + ui.video.side.scrollHeight;
            if (h > 800)
                h = 800;
            break;
    }

    let force = false;

    if (h < 600) {
        // In certain cases, demand a minimum height
        if (curPanel || ui.chat.wrapper.style.display !== "none") {
            h = 600;
            if (window.innerHeight < h)
                force = true;
        }
    }

    if (ui.userSized && !force)
        return;
    ui.userSized = false;

    if (h != ui.lastHeight) {
        ui.lastHeight = h;
        window.resizeTo(window.outerWidth,
            h + window.outerHeight - window.innerHeight);
        updateVideoUI(0);
    }
}

export function maybeResizeSoon() {
    setTimeout(maybeResize, 0);
    setTimeout(maybeResize, 100);
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
export function caption(
    peer: number, text: string, append: boolean, complete: boolean
): Promise<void> {
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


// Handle P2P connection events
function p2pEvent(event: string, ev: CustomEvent) {
    const msg = ev.detail;
    const user = ui.panels.userList.users[msg.peer];
    if (!user)
        return;

    let setColor = false;
    let setText = false;
    let color = "var(--user-list-conn-unreliable)";
    let text = "&nbsp;"

    switch (event) {
        case "connected":
            setColor = true;
            color = `var(--user-list-conn-${msg.reliability})`;
            break;

        case "disconnected":
            setColor = true;
            setText = true;
            break;

        case "latency":
            setText = true;
            text = `${Math.round(msg.latency)}ms`;
            break;
    }

    if (setColor)
        user.connectionInfo.style.backgroundColor = color;
    if (setText)
        user.connectionInfo.innerHTML = text;
}

util.events.addEventListener(
    "p2p.connected", (ev: CustomEvent) => p2pEvent("connected", ev)
);
util.events.addEventListener(
    "p2p.disconnected", (ev: CustomEvent) => p2pEvent("disconnected", ev)
);
util.events.addEventListener(
    "p2p.latency", (ev: CustomEvent) => p2pEvent("latency", ev)
);
