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
declare var Ennuiboard: any;

import * as audio from "./audio";
import * as chat from "./chat";
import * as compression from "./compression";
import * as config from "./config";
import * as master from "./master";
import * as net from "./net";
import * as ptt from "./ptt";
import * as uiCode from "./uicode";
import { dce, gebi } from "./util";
import * as video from "./video";
import * as videoRecord from "./video-record";

// The entire user interface
export const ui = {
    // The overall wrapper
    wrapper: <HTMLElement> null,

    // Video interface
    video: <{
        // Main wrapper
        wrapper: HTMLElement,

        // Side wrapper
        side: HTMLElement,

        // Side fullscreen button
        sideFS: HTMLButtonElement,

        // Main wrapper
        main: HTMLElement,

        // Main fullscreen button
        mainFS: HTMLButtonElement,

        // Video components for each user
        users: {
            video: HTMLVideoElement,
            box: HTMLElement,
            name: HTMLElement
        }[],

        // Which user is selected?
        selected: number,

        // Which user is the current major?
        major: number
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
        mute: HTMLButtonElement
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
            device: HTMLSelectElement
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

// Show the given panel, or none
export function showPanel(panelName: HTMLElement|string) {
    var panel: HTMLElement;
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

    } else {
        ui.layerSeparator.style.display = "none";
        mouseenter();

    }
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
            showPanel(null);
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
        localStorage.setItem(name, ""+sl.value);
        if (onchange)
            return onchange(ev);
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

    // Load the components
    ui.wrapper = gebi("ecouter");
    loadVideo();
    loadChat();
    chat.mkChatBox();
    loadWave();
    loadLog(log);
    ui.layerSeparator = gebi("eclayer-separator");
    loadMainMenu();
    loadMasterUI();
    loadUserAdmin();
    loadSoundboard();
    if ("master" in config.config)
        master.createMasterInterface();
    loadInputConfig();
    loadOutputConfig();
    loadVideoConfig();
    loadUserList();
    loadInterfaceSounds();

    // Every close button works the same
    Array.prototype.slice.call(document.getElementsByClassName("close-button"), 0).forEach(function(x: HTMLElement) {
        x.onclick = function() { showPanel(null); };
    });
    ui.layerSeparator.onclick = function() { showPanel(null); };

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
    window.addEventListener("resize", function() {
        setTimeout(reflexUI, 100);
    });
    resizeUI();
}

function loadVideo() {
    ui.video = {
        wrapper: gebi("ecvideo-wrapper"),
        side: gebi("ecvideo-side"),
        sideFS: gebi("ecvideo-wrapper-fs"),
        main: gebi("ecvideo-main"),
        mainFS: gebi("ecvideo-main-fs"),
        users: [],
        selected: -1,
        major: -1
    };
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
    ui.wave = {
        wrapper: gebi("ecwaveform-wrapper"),
        canvas: gebi("ecwaveform"),
        watcher: gebi("ecwave-watcher"),
        rotate: false
    };
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
        mute: gebi("ecmenu-mute")
    };

    var m = ui.panels.main = {
        wrapper: gebi("ecmenu"),
        inputB: gebi("ecmenu-input-devices"),
        outputB: gebi("ecmenu-output-devices"),
        videoB: gebi("ecmenu-video-devices"),
        videoRecordB: gebi("ecmenu-record"),
        userListB: gebi("ecmenu-user-list")
    };

    function btn(b: HTMLButtonElement, p: string) {
        b.onclick = function() {
            showPanel(p);
        };
    }

    btn(p.master, "master");
    btn(p.sounds, "soundboard");
    btn(p.main, "main");
    p.chat.onclick = function() {
        var chat = ui.chat.wrapper;
        chat.style.display = (chat.style.display === "none") ? "" : "none";
    };
    p.mute.onclick = function() { audio.toggleMute(); };
    btn(m.inputB, "inputConfig");
    btn(m.outputB, "outputConfig");
    btn(m.videoB, "videoConfig");
    videoRecord.recordVideoButton();
    btn(m.userListB, "userList");

    // Auto-hide the persistent menu
    mouseenter();
    document.body.addEventListener("mouseenter", mouseenter);
    document.body.addEventListener("mousemove", mouseenter);
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
    ui.panels.inputConfig = {
        wrapper: gebi("ecinput-device-wrapper"),
        device: gebi("ecinput-device-list"),
        ptt: gebi("ecpttb"),
        noiser: gebi("ecnoise-reduction"),
        echo: gebi("ececho-cancellation"),
        agcHider: gebi("ecagc-hider"),
        agc: gebi("ecagc")
    };
}

function loadOutputConfig() {
    ui.panels.outputConfig = {
        wrapper: gebi("ecoutput-device-wrapper"),
        deviceHider: gebi("ecoutput-device-list-hider"),
        device: gebi("ecoutput-device-list"),
        volume: gebi("ecoutput-volume"),
        volumeStatus: gebi("ecoutput-volume-status"),
        sfxVolumeHider: gebi("ecsfx-volume-hider"),
        sfxVolume: gebi("ecsfx-volume"),
        sfxVolumeStatus: gebi("ecsfx-volume-status"),
        compressionHider: gebi("ecdynamic-range-compression-hider"),
        compression: gebi("ecdynamic-range-compression"),
        muteInterface: gebi("ecmute-interface-sounds")
    };
}

function loadVideoConfig() {
    ui.panels.videoConfig = {
        wrapper: gebi("ecvideo-device-wrapper"),
        device: gebi("ecvideo-device-list")
    };

    ui.panels.videoRecord = {
        wrapper: gebi("ecvideo-record-wrapper"),
        local: gebi("ecvideo-record-local"),
        remote: gebi("ecvideo-record-remote"),
        both: gebi("ecvideo-record-both")
    };
}

function loadUserList() {
    var u = ui.panels.userList = {
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
        showPanel(null);
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
    saveConfigCheckbox(input.echo, "echo-cancellation3", inputChange);
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
        showPanel(null);

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
        showPanel(null);
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
export function resizeUI() {
    // FIXME
    setTimeout(reflexUI, 100);
}

// Re-flex the flexbox UI to the window
function reflexUI() {
    //ui.wrapper.style.height = window.innerHeight + "px";
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
            styleVideoEl(ui.video.users[idx].video, name);
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
    user.name.style.backgroundColor = "#000";
    user.name.innerText = name;
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
    function volChange() {
        var vol = user.volume;

        // Snap to x00%
        for (var i = 100; i <= 300; i += 100)
            if (+vol.value >= i - 10 && +vol.value <= i + 10)
                vol.value = ""+i;

        // Show the status
        user.volumeStatus.innerHTML = "&nbsp;" + vol.value + "%";

        // Set it
        compression.setPerUserGain(idx, (+vol.value) / 100);
    }

    saveConfigSlider(user.volume, "user-volume3-" + name, volChange);
    volChange();

    // And give them a user element
    videoAdd(idx, name);
    updateVideoUI(idx, false);


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
        name: dce("span")
    };

    /* A videobox ix flexible for centering, and contains a video element and a
     * name label */
    var box = ctx.box;
    box.classList.add("ecvideo");
    Object.assign(box.style, {
        position: "relative",
        boxSizing: "border-box",
        border: "4px solid #000",
        display: "flex",
        flexDirection: "column",
        flex: "auto"
    });

    var video = ctx.video;
    video.height = 0; // Use CSS for style
    video.style.flex = "auto";
    Object.assign(video.style, {
        backgroundColor: "#000", // FIXME
        flex: "auto"
    });
    box.appendChild(video);

    styleVideoEl(video, name);

    // When you click, they become the selected major
    video.onclick = function() {
        if (ui.video.selected === idx)
            ui.video.selected = -1;
        else
            ui.video.selected = idx;
        // updateVideoUI(idx); FIXME
    };

    // And add their personal label
    var nspan = ctx.name;
    nspan.classList.add("namelabel");
    nspan.innerText = name || "";
    box.appendChild(nspan);
}

// Style a video element given a user's name
function styleVideoEl(el: HTMLVideoElement, name: string) {
    if (!name) return;
    var x = parseInt(btoa(unescape(encodeURIComponent(name))).replace(/[^A-Za-z0-9]/g, ""), 36);
    var r = x % 4;
    x = ~~(x / 4);
    var g = x % 4;
    x = ~~(x / 4);
    var b = x % 4;
    el.style.backgroundColor = "#" + r + g + b;
}

// Remove a user from the user list
export function userListRemove(idx: number, fromMaster: boolean) {
    if (("master" in config.config) !== fromMaster)
        return;
    var user = ui.panels.userList.users[idx];
    if (!user) return;
    user.wrapper.parentNode.removeChild(user.wrapper);
    ui.panels.userList.users[idx] = null;
    if (fromMaster) {
        master.users[idx].online = false;
        master.updateMasterAdmin();
    }

    updateVideoUI(idx, false);
}

// Update the speaking status of an element in the user list
export function userListUpdate(idx: number, speaking: boolean, fromMaster: boolean) {
    if (("master" in config.config) !== fromMaster)
        return;

    var user = ui.panels.userList.users[idx];
    if (!user) return;
    user.name.style.backgroundColor = speaking?"#2b552b":"#000";
    user.name.setAttribute("aria-label", user.name.innerText + ": " + (speaking?"Speaking":"Not speaking"));

    updateVideoUI(idx, speaking);

    if (fromMaster) {
        master.users[idx].transmitting = speaking;
        master.updateMasterAdmin();
    }
}

// Update the video UI based on new information about this peer
export function updateVideoUI(peer: number, speaking: boolean) {
    var ctx = ui.video.users[peer];
    var users = ui.panels.userList.users;
    var user = users[peer];
    var pi, prevMajor = ui.video.major;

    // Update their speech
    while (lastSpeech.length <= peer)
        lastSpeech.push(null);
    if (speaking)
        lastSpeech[peer] = performance.now();
    else
        lastSpeech[peer] = null;

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

    // First rearrange them all in the side box
    for (pi = 0; pi < users.length; pi++) {
        let v = ui.video.users[pi];
        if (!v || !users[pi]) continue;

        var selected = (ui.video.selected === pi);
        if (lastSpeech[pi] !== null)
            v.box.style.borderColor = selected?"#090":"#5e8f52";
        else
            v.box.style.borderColor = selected?"#999":"#000";

        if (ui.video.major === pi) continue;
        if (v.box.parentNode !== ui.video.side)
            ui.video.side.appendChild(v.box);
    }

    if (ui.video.major === prevMajor) {
        // No need to change the major
        resizeUI();
        return;
    }

    // Remove anything left over highlighted
    ui.video.main.innerHTML = "";

    // And highlight it
    if (ui.video.major !== -1) {
        let v = ui.video.users[ui.video.major];
        ui.video.main.appendChild(v.box);
    }

    resizeUI();
}

`
import * as audio from "./audio";
import * as chat from "./chat";
import * as compression from "./compression";
import * as config from "./config";
import * as log from "./log";
import * as master from "./master";
import * as proc from "./proc";
import * as ptt from "./ptt";
import { dce, gebi } from "./util";
import * as uiCode from "./uicode";
import * as video from "./video";
import * as videoRecord from "./video-record";

// The entire user interface
export const ui = {
    // Has the user taken control of the window size?
    manualSize: false,

    // What is our desired automatic size?
    autoSize: 0,

    /* What is the difference between outerHeight and innerHeight? Cached
     * because some browsers (Chrome) get very confused about it mid-resizing */
    outerInnerHeightDiff: 0,

    // Are we currently resizing (timeout)?
    resizing: <null|number> null,

    // The code for the entire UI
    code: uiCode.code,

    // The audio element used to actually play back sound
    audioOutput: <HTMLAudioElement> null,

    // The outermost wrapper
    wrapper: <HTMLElement> null,

    // All of our panels
    panels: <{
        [index: string]: HTMLElement
    }> {},

    // The element to auto-focus when a panel is activated
    panelAutos: <{
        [index: string]: HTMLElement
    }> {},

    // The video properties
    video: <{
        // Wrapper for all video elements
        wrapper: HTMLElement,

        // Video elements
        els: HTMLVideoElement[],

        // Boxes to contain video elements
        boxes: HTMLElement[],

        // Whether each user has incoming video
        hasVideo: boolean[],

        // Is video even wanted?
        wanted: boolean,

        // Who's the current major (main video view)
        major: number,

        // Who's been selected
        selected: number,

        // Our own video box
        self: HTMLVideoElement,

        // The main video box
        main: HTMLElement,

        // Main fullscreen button
        mainFullscreen: HTMLButtonElement,

        // The "side" video box (everybody else)
        side: HTMLElement,

        // Full fullscreen button
        wrapperFullscreen: HTMLButtonElement,

        /* For video selection and speech display, *when* the user last spoke
         * (performance.now()) */
        speech: number[]
    }> null,

    // The display canvas and data
    waveWrapper: <HTMLElement> null,
    waveCanvas: <HTMLCanvasElement> null,
    waveWatcher: <HTMLImageElement> null,
    waveRotate: false,

    // The menu
    menu: <{
        // Wrapper for the whole menu
        wrapper: HTMLElement
    }> null,

    // The mute button
    muteB: <HTMLButtonElement> null,

    // The user list and voice status
    userList: {
        // Main wrapper for the userlist
        wrapper: <HTMLElement> null,

        // Userlist button (hidden if it's not public)
        button: <HTMLButtonElement> null,

        // Individual user wrappers
        userWrappers: <HTMLElement[]> [],

        // Individual user labels
        userLabels: <HTMLElement[]> [],

        names: <{
            [index: string]: string
        }> {}
    },

    // The wrapper for the device selector
    deviceList: <{
        // Selector for input devices
        select: HTMLSelectElement,

        // Wrapper for options
        optionsWrapper: HTMLElement,

        // Push-to-talk button
        pttb: HTMLButtonElement,

        // Noise reduction
        noiser: HTMLInputElement,

        /* Echo cancellation checkbox, with information on whether this was
         * administrative override */
        ec: HTMLInputElement & {ecAdmin?: boolean},

        // Hider for AGC, since it's only on mobile
        agcHider: HTMLElement,

        // Automatic gain control
        agc: HTMLInputElement
    }> null,

    // The wrapper for the output control panel
    outputControlPanel: <{
        // Wrapper for the selector
        selectWrapper: HTMLElement,

        // Selector
        select: HTMLSelectElement,

        // Output volume
        volume: HTMLInputElement,

        // Status of volume
        volumeStatus: HTMLSpanElement,

        // Compression option
        compression: HTMLInputElement,

        // Hider for compression option
        compressionHider: HTMLElement,

        // Sound FX volume
        sfxVolume: HTMLInputElement,

        // Sound FX volume status
        sfxVolumeStatus: HTMLSpanElement,

        // Wrapper to hide/show sound FX volume
        sfxVolumeHider: HTMLElement
    }> null,

    // The wrapper for the video device selector, if applicable
    videoDeviceList: <{
        // Selector
        select: HTMLSelectElement
    }> null,

    // If we've received chat, the box for that
    chatBox: <{
        // Incoming chat
        incoming: HTMLElement,

        // Outgoing chat
        outgoing: HTMLInputElement
    }> null,

    // Spacer that comes before the log (except when it doesn't)
    spacer: <HTMLElement> null,

    // The log element
    log: <HTMLElement> null,

    // Push-to-talk settings
    ptt: {
        enabled: false,
        hotkey: <null|string> null,
        muted: false
    },

    // If we're in master mode, master UI elements
    masterUI: <{
        // Pause/resume button
        pauseResumeB: HTMLButtonElement,

        // Start/stop button
        startStopB: HTMLButtonElement,

        // Wrapper for yes/no
        startStopYesNo: HTMLElement,

        // Yes button
        startStopYesB: HTMLButtonElement,

        // No button
        startStopNoB: HTMLButtonElement,

        // Invite link box
        invite: HTMLInputElement,

        // Invite copy button
        inviteCopy: HTMLButtonElement,

        // Invite option: FLAC
        inviteFlac: HTMLInputElement,

        // Invite option: Continuous
        inviteContinuous: HTMLInputElement,

        // Recording cost
        recCost: HTMLInputElement,

        // Recording rate
        recRate: HTMLInputElement,

        // Not actually part of the UI, but used by the UI to display recording rate
        creditCost: {
            currency: number,
            credits: number
        },
        creditRate: [number, number],

        // The right hand side is the user status box (users and user admin actions)
        userStatusB: HTMLElement,

        // Checkbox: Do we accept remote video?
        acceptRemoteVideo: HTMLInputElement,

        // Global administrative buttons
        globalAdminBs: {
            mute: HTMLButtonElement,
            echo: HTMLButtonElement
        },

        // "Speech" (really, data receive) info
        speech: {
            nick: string,
            online: boolean,
            speaking: boolean
        }[],

        // Speech boxes
        speechB: (HTMLElement & {ecConnected?: boolean})[],

        // Soundboard
        sounds: {
            wrapper: HTMLElement,

            // Hider for the button
            bwrapper: HTMLElement,

            buttons: {[index: string]: {
                b: HTMLButtonElement,
                i: HTMLElement, // start/stop label
                n: HTMLElement // label
            }},

            // Mapping of URLs to SIDs
            url2sid: {[index: string]: string}
        }
    }> {},

    // Sound elements
    sounds: <{
        [index: string]: {
            el: HTMLAudioElement & {ecStartTime?: number}
        }
    }> {},

    // Button to record video. Here because video-record needs it
    recordVideoButton: <HTMLButtonElement> null
};

// Certain options are only shown on mobile
const ua = navigator.userAgent.toLowerCase();
const mobile = (ua.indexOf("android") >= 0) ||
               (ua.indexOf("iphone") >= 0) ||
               (ua.indexOf("ipad") >= 0);

// Make the overall UI
export function mkUI() {
    document.body.style.margin =
        document.body.style.padding = "0";
    document.body.innerHTML = ui.code;

    // If there was a pre-loaded display, such as a privacy policy, remove it
    var preecStyle = dce("style");
    preecStyle.innerHTML = "#pre-ec { display: none; }";
    document.head.appendChild(preecStyle);

    // When we resize, we need to flex the UI
    var wrapper = ui.wrapper = gebi("ecouter");
    wrapper.style.minHeight = window.innerHeight + "px";
    var resizeTimer: null|number = null;
    window.addEventListener("resize", function() {
        if (!ui.resizing)
            ui.manualSize = true;
        if (resizeTimer)
            clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            resizeTimer = null;
            wrapper.style.minHeight = window.innerHeight + "px";
            checkMaximized();
            if (ui.manualSize)
                resizeUI();
            else
                reflexUI();
        }, 100);
    });

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

        // But hide it when the mouse isn't in the right place
        var timeout: null|number = null;
        el.style.cursor = "none";
        btn.style.display = "none";
        function mouseenter() {
            if (timeout)
                clearTimeout(timeout);
            btn.style.display = "";
            el.style.cursor = "";
            timeout = setTimeout(function() {
                btn.style.display = "none";
                el.style.cursor = "none";
                timeout = null;
            }, 5000);
        }
        el.addEventListener("mouseenter", mouseenter);
        el.addEventListener("mousemove", mouseenter);
    }

    // The video has several elements
    ui.video = {
        wrapper: gebi("ecvideo-wrapper"),
        els: [],
        boxes: [],
        hasVideo: [],
        wanted: false,
        speech: <any> {},
        major: -1,
        selected: -1,
        self: null,
        main: null,
        mainFullscreen: null,
        side: null,
        wrapperFullscreen: null
    };

    // A wrapper for *all* video
    ui.video.wrapper.style.display = "none";

    // A wrapper for the main video (if visible)
    ui.video.main = gebi("ecvideo-main");
    ui.video.mainFullscreen = gebi("ecvideo-main-fs");
    fullscreen(ui.video.main, ui.video.mainFullscreen);

    // A wrapper for side video
    ui.video.side = gebi("ecvideo-side");
    ui.video.wrapperFullscreen = gebi("ecvideo-wrapper-fs");
    fullscreen(ui.video.wrapper, ui.video.wrapperFullscreen);

    // And for our own video
    var selfVideo = ui.video.self = dce("video");
    ui.video.els.push(selfVideo);
    ui.video.hasVideo.push(false);

    // The watcher image
    var img = ui.waveWatcher = gebi("ecwave-watcher");

    // And choose its type based on support
    function usePng() {
        img.src = "images/watcher.png";
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
            img.src = "images/watcher.webp";
        }).catch(usePng);
    }

    // The canvas for the waveform
    ui.waveWrapper = gebi("ecwaveform-wrapper");
    ui.waveCanvas = gebi("ecwaveform");

    // The menu
    ui.menu = {
        wrapper: gebi("ecmenu")
    };

    // Spacer
    ui.spacer = gebi("ecprelog-spacer");

    // Move the status box
    var eclog = ui.log = gebi("eclog");
    eclog.innerHTML = "";
    eclog.appendChild(log.log);

    // Load all the panels
    function panel(nm: string, auto?: string) {
        var p = ui.panels[nm] = gebi("ec" + nm + "-wrapper");
        p.style.display = "none";

        if (auto)
            ui.panelAutos[nm] = gebi("ec" + auto);
    }
    panel("master", "master-invite-link-copy");
    panel("user-list");
    panel("sounds");
    panel("video-record");
    panel("input-device", "input-device-list");
    panel("output-device", "output-device-list");
    panel("video-device", "video-device-list");
    panel("chat", "chat-outgoing");

    // Set up the menu
    createMenu();

    // Set up the video UI
    updateVideoUI(0);

    // The chat box
    chat.createChatBox();

    // The user list sub"menu"
    createUserList();

    // The device list submenu
    createDeviceList();

    // The output and video device list submenu
    if (config.useRTC) {
        createOutputControlPanel();
        createVideoDeviceList();
    }

    // Set up the master interface
    if ("master" in config.config) {
        master.createMasterInterface();
        ui.panels.master.style.display = "";
    }

    checkMaximized();
}

var maximized = false;

// Rearrange the UI based on whether we're maximized or not
function checkMaximized() {
    if (!ui.wrapper) return;

    var nowMax = (window.outerWidth >= window.screen.availWidth * 0.9) &&
                 (window.outerHeight >= window.screen.availHeight * 0.9);

    if (nowMax !== maximized) {
        maximized = nowMax;

        // Change the layout
        if (maximized) {
            // Waveform at the bottom, menu above that, chat after video, then spacer
            ui.wrapper.insertBefore(ui.waveWrapper, ui.log);
            ui.wrapper.insertBefore(ui.menu.wrapper, ui.waveWrapper);
            ui.wrapper.insertBefore(ui.spacer, ui.video.wrapper.nextSibling);
            ui.wrapper.insertBefore(ui.panels.chat, ui.spacer);

        } else {
            // Waveform after video, menu after that, chat at the bottom
            ui.wrapper.insertBefore(ui.menu.wrapper, ui.video.wrapper.nextSibling);
            ui.wrapper.insertBefore(ui.waveWrapper, ui.menu.wrapper);
            ui.wrapper.insertBefore(ui.spacer, ui.log);
            ui.wrapper.insertBefore(ui.panels.chat, ui.spacer);

        }
        document.documentElement.setAttribute("data-panel-alignment", maximized?"bottom":"");

    }
}

// Figure out our ideal size and resize to it
export function resizeUI() {
    // Choose whether the video should be visible
    if ((config.useRTC && maximized && ui.panels.chat.style.display === "none") ||
        ui.video.wanted)
        ui.video.wrapper.style.display = "";
    else
        ui.video.wrapper.style.display = "none";

    // If we're maximized or manually resized, we don't get to choose a size
    if ((ui.manualSize && window.innerHeight >= 320) || maximized)
        return reflexUI();
    ui.manualSize = false;

    // Go through the elements to get the ideal height
    var idealHeight = 0;
    Array.prototype.slice.call(ui.wrapper.children, 0).forEach(function(el: HTMLElement) {
        if (el.style.display === "none") return;
        // Special cases for elements that flex large
        if (el === ui.video.wrapper)
            idealHeight += 320;
        else if (el === ui.panels.chat)
            idealHeight += 320;
        else if (el === ui.waveWrapper)
            idealHeight += 160;
        else
            idealHeight += el.offsetHeight;
    });

    // But, don't maximize
    var maxHeight = Math.floor(window.screen.availHeight * 0.9) - 1;
    if (idealHeight > maxHeight)
        idealHeight = maxHeight;

    // Now, resize to it
    ui.autoSize = idealHeight;
    if (ui.resizing)
        clearTimeout(ui.resizing);
    else
        ui.outerInnerHeightDiff = window.outerHeight - window.innerHeight;
    ui.resizing = setTimeout(reflexUI, 200);
    document.documentElement.style.overflow = "hidden";
    window.resizeTo(window.outerWidth, ui.outerInnerHeightDiff + idealHeight + 1);
}

// Re-flex the UI based on the actual height of all the elements
function reflexUI() {
    if (ui.resizing) {
        clearTimeout(ui.resizing);
        ui.resizing = null;
    }

    // First, find how much height we have leftover for flexible elements
    var flexible: any = {};
    var heightForFlexible = window.innerHeight;
    Array.prototype.slice.call(ui.wrapper.children, 0).forEach(function(el: HTMLElement) {
        if (el.style.display === "none") return;

        if (el === ui.video.wrapper)
            flexible.video = true;
        else if (el === ui.panels.chat)
            flexible.chat = true;
        else if (el === ui.waveWrapper)
            flexible.wave = true;
        else
            heightForFlexible -= el.offsetHeight;
    });

    // Now, distribute the remaining height among visible flexible elements
    function assignHeight(to: HTMLElement, amt: number) {
        to.style.height = amt + "px";
        to.style.flex = "";
        heightForFlexible -= amt;
    }

    // First fix the smaller elements
    if (flexible.chat && flexible.video) {
        // Assign some remaining space for video, 320+320+160 is large space, 200+320+40 is small space
        assignHeight(ui.video.wrapper, (heightForFlexible < 800) ? 200 : 320);
    }
    if (flexible.chat || flexible.video) {
        // Assign some remaining space for the waveform, 320+160 is large space, 320+40 is small space
        assignHeight(ui.waveWrapper, (heightForFlexible < 480) ? 40 : 160);
    }

    // Then assign the rest to the larger element
    if (flexible.chat)
        assignHeight(ui.panels.chat, Math.max(heightForFlexible, 320));
    else if (flexible.video)
        assignHeight(ui.video.wrapper, Math.max(heightForFlexible, 320));
    else
        assignHeight(ui.waveWrapper, Math.max(heightForFlexible, 160));

    document.documentElement.style.overflow = "";
}

// Update the video UI based on new information about this peer
export function updateVideoUI(peer: number) {
    var el = ui.video.els[peer], box = ui.video.boxes[peer];
    var pi, prevMajor = ui.video.major;
    var name = null;
    if (peer === 0)
        name = config.username;
    else if (ui.userList.names[peer])
        name = ui.userList.names[peer];

    function rbg() {
        return Math.round(Math.random()*0x4);
    }

    if (el && !box) {
        // Totally new peer, set up their videobox
        box = dce("div");
        box.style.position = "relative";
        box.style.display = "flex";
        box.style.flexDirection = "column";
        box.style.flex = "auto";
        box.style.boxSizing = "border-box";
        box.style.border = "4px solid #000";
        while (ui.video.boxes.length <= peer)
            ui.video.boxes.push(null);
        ui.video.boxes[peer] = box;

        el.height = 0; // Use CSS for style
        el.style.backgroundColor = "#" + rbg() + rbg() + rbg();
        el.style.flex = "auto";
        box.appendChild(el);

        // When you click, they become the selected major
        el.onclick = function() {
            if (ui.video.selected === peer)
                ui.video.selected = -1;
            else
                ui.video.selected = peer;
            updateVideoUI(peer);
        };

        // And add their personal label
        if (name) {
            var nspan = dce("span");
            nspan.classList.add("namelabel");
            nspan.innerText = name;
            box.appendChild(nspan);
        }

    } else if (!el) {
        // The user is totally gone
        if (box) {
            try {
                box.parentNode.removeChild(box);
            } catch (ex) {}
        }
        box = ui.video.boxes[peer] = null;

    }

    /* We'll only display the video at all if *somebody* has video or we're
     * maximized and have nothing else to take the space */
    var hasVideo = false;
    for (pi = 0; pi < ui.video.hasVideo.length; pi++) {
        if (ui.video.hasVideo[pi]) {
            hasVideo = true;
            break;
        }
    }

    ui.video.wanted = hasVideo;

    if (!maximized && !hasVideo) {
        // Not wanted, so default to off
        ui.video.wrapper.style.display = "none";

    } else {
        // Displaying video
        ui.video.wrapper.style.display = "flex";

    }

    // Don't let them be the major if they're gone
    if (!el) {
        // If this was the major, it won't do
        if (ui.video.major === peer)
            ui.video.major = -1;
        if (ui.video.selected === peer)
            ui.video.selected = -1;
    }

    // Perhaps there's already something selected
    if (ui.video.selected !== -1) {
        ui.video.major = ui.video.selected;

    } else if (ui.video.major === 0 ||
               !(ui.video.major in ui.video.speech)) {
        // Otherwise, choose a major based on speech
        var speech = ui.video.speech;
        var earliest = 0;
        for (pi = 1; pi < ui.video.els.length; pi++) {
            if (pi in speech && ui.video.els[pi] && (earliest === 0 || speech[pi] < speech[earliest]))
                earliest = pi;
        }
        if (earliest !== 0)
            ui.video.major = earliest;
    }

    if (el) {
        // If we currently have no major, this'll do
        if (ui.video.major === -1 && peer !== 0)
            ui.video.major = peer;
    }

    // If we still have no major, just choose one
    if (ui.video.major === -1) {
        for (pi = ui.video.els.length - 1; pi >= 0; pi--) {
            if (ui.video.els[pi]) {
                ui.video.major = pi;
                break;
            }
        }
    }

    // First rearrange them all in the side box
    for (pi = 0; pi < ui.video.els.length; pi++) {
        box = ui.video.boxes[pi];
        if (!box) continue;

        var selected = (ui.video.selected === pi);
        if (pi in ui.video.speech)
            box.style.borderColor = selected?"#090":"#5e8f52";
        else
            box.style.borderColor = selected?"#999":"#000";

        if (ui.video.major === pi) continue;
        if (box.parentNode !== ui.video.side) {
            ui.video.side.appendChild(box);
            box.style.maxWidth = "214px";
            box.style.height = "100%";
        }
    }

    if (ui.video.major === prevMajor) {
        // No need to change the major
        resizeUI();
        return;
    }

    // Remove anything left over highlighted
    ui.video.main.innerHTML = "";

    // And highlight it
    if (ui.video.major !== -1) {
        box = ui.video.boxes[ui.video.major];
        ui.video.main.appendChild(box);
        ui.video.main.appendChild(ui.video.mainFullscreen);
        box.style.maxWidth = "100%";
        box.style.height = "";
    }

    resizeUI();
}

// Toggle the visibility of a panel
export function togglePanel(panel: string, to?: boolean) {
    var el = ui.panels[panel];
    if (typeof to === "undefined")
        to = (el.style.display === "none");

    // Only show one panel at a time (except chat)
    if (to) {
        Object.keys(ui.panels).forEach(function(nm) {
            if (nm !== "chat" && nm !== panel)
                ui.panels[nm].style.display = "none";
        });
    }

    // Then switch the desired one
    el.style.display = to?"":"none";
    if (to && ui.panelAutos[panel])
        ui.panelAutos[panel].focus();
    resizeUI();
}

// Create the menu
function createMenu() {
    // Most buttons open or close a panel
    function toggleBtn(btnId: string, panel: string) {
        var btn = gebi("ecmenu-" + btnId);
        btn.onclick = function() {
            togglePanel(panel);
        };
    }

    toggleBtn("master", "master");
    toggleBtn("chat", "chat");
    toggleBtn("users", "user-list");
    toggleBtn("sounds", "sounds");
    toggleBtn("input-devices", "input-device");
    toggleBtn("output-devices", "output-device");
    toggleBtn("camera-devices", "video-device");

    // The user list button only becomes visible if we actually have a user list, so we need to keep track of it
    ui.userList.button = gebi("ecmenu-users-hider");

    // Hide irrelevant buttons
    if (!config.useRTC) {
        ["output-devices", "camera-devices", "record"].forEach(function(btn) {
            gebi("ecmenu-" + btn).style.display = "none";
        });
    }

    // Mute has its own action
    var mute = ui.muteB = gebi("ecmenu-mute");
    mute.onclick = function() { audio.toggleMute(); }

    // Video recording has its own action
    var rec = gebi("ecmenu-record");
    ui.recordVideoButton = rec;
    videoRecord.recordVideoButton();
}

// Update the mute button
export function updateMuteButton() {
    if (!audio.userMedia) return;
    if (audio.userMedia.getAudioTracks()[0].enabled) {
        // It's unmuted
        ui.muteB.innerHTML = '<i class="fas fa-volume-up"></i>';
        ui.muteB.setAttribute("aria-label", "Mute");

    } else {
        // It's muted
        ui.muteB.innerHTML = '<i class="fas fa-volume-mute"></i>';
        ui.muteB.setAttribute("aria-label", "Unmute");

    }
}

// Create the user list sub"menu"
function createUserList() {
    // All we care about is the left and right halves
    ui.userList.wrapper = gebi("ecuser-list-wrapper");
}

// Add a user to the user list
export function userListAdd(idx: number, name: string) {
    ui.userList.names[idx] = name;
    ui.userList.button.style.display = "";

    // Create the surrounding wrapper
    var wrappers = ui.userList.userWrappers;
    var els = ui.userList.userLabels;
    while (wrappers.length <= idx) {
        wrappers.push(null);
        els.push(null);
    }
    var el = els[idx];

    if (el) {
        // Just update the name
        el.innerText = name;
        el.setAttribute("aria-label", name + ": Not speaking");
        return;

    }

    /* It goes like this:
     * <span wrapper><span halfspan-left><label></span><span halfspan-right><volume></span>
     */
    var wrapper = wrappers[idx] = dce("div");
    ui.userList.wrapper.appendChild(wrapper);

    var left = dce("span");
    left.classList.add("halfspan");
    left.classList.add("halfspan-left");
    wrapper.appendChild(left);

    el = els[idx] = dce("div");
    el.style.paddingLeft = "0.25em";
    el.style.backgroundColor = "#000";
    el.innerText = name;
    el.setAttribute("aria-label", name + ": Not speaking");
    left.appendChild(el);

    var right = dce("span");
    right.classList.add("halfspan");
    right.classList.add("halfspan-right");
    wrapper.appendChild(right);

    // Volume control
    var voldiv = dce("div");
    voldiv.classList.add("rflex");
    right.appendChild(voldiv);

    var vol = dce("input");
    vol.type = "range";
    vol.min = 0;
    vol.max = 400;
    vol.value = 100;
    vol.style.flex = "auto";
    vol.style.minWidth = "5em";
    vol.setAttribute("aria-label", "Volume for " + name);
    voldiv.appendChild(vol);

    var volStatus = dce("span");
    volStatus.innerHTML = "&nbsp;100%";
    voldiv.appendChild(volStatus);

    // When we change the volume, pass that to the compressors
    vol.oninput = function() {
        // Snap to x00%
        for (var i = 100; i <= 300; i += 100)
            if (vol.value >= i - 10 && vol.value <= i + 10)
                vol.value = i;

        // Remember preferences
        localStorage.setItem("volume-user-" + name, vol.value);

        // Show the status
        volStatus.innerHTML = "&nbsp;" + vol.value + "%";

        // Set it
        compression.setPerUserGain(idx, vol.value / 100);
    };

    // Get the saved value
    var def = localStorage.getItem("volume-user-" + name);
    if (def) {
        vol.value = +def;
        vol.oninput();
    }

}

// Remove a user from the user list
export function userListRemove(idx: number) {
    var wrapper = ui.userList.userWrappers[idx];
    if (!wrapper) return;
    ui.userList.userWrappers[idx] =
        ui.userList.userLabels[idx] = null;

    wrapper.parentNode.removeChild(wrapper);
}

// Update the speaking status of an element in the user list
export function userListUpdate(idx: number, speaking: boolean) {
    var el = ui.userList.userLabels[idx];
    if (!el) return;

    el.style.backgroundColor = speaking?"#2b552b":"#000";
    el.setAttribute("aria-label", el.innerText + ": " + (speaking?"Speaking":"Not speaking"));
}

// Create the (input) device list submenu
function createDeviceList() {
    ui.deviceList = {
        select: gebi("ecinput-device-list"),
        pttb: gebi("ecpttb"),
        optionsWrapper: gebi("ecinput-options-wrapper"),
        noiser: gebi("ecnoise-reduction"),
        ec: gebi("ececho-cancellation"),
        agcHider: gebi("ecagc-hider"),
        agc: gebi("ecagc")
    };

    // Remember echo cancellation and AGC early so that the first user media setup knows it
    var ecDef = localStorage.getItem("echo-cancellation2");
    if (ecDef)
        ui.deviceList.ec.checked = !!~~ecDef;
    else if (mobile)
        ui.deviceList.ec.checked = true;
    var agcDef = localStorage.getItem("agc");
    if (agcDef)
        ui.deviceList.agc.checked = !!~~agcDef;
    else if (mobile)
        ui.deviceList.agc.checked = true;

    if (!audio.userMedia) {
        // Wait until we can know what device we selected
        audio.userMediaAvailableEvent.addEventListener("usermediaready", createDeviceList, {once: true});
        return;
    }

    var sel = ui.deviceList.select;
    var selected: null|string = null;
    try {
        selected = audio.userMedia.getTracks()[0].getSettings().deviceId;
    } catch (ex) {}

    // When it's changed, reselect the mic
    sel.onchange = function() {
        togglePanel("input-device", false);
        audio.getMic(sel.value);
    };

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "audioinput") return;

            // Create an option for this
            var opt = dce("option");
            var label = dev.label || ("Mic " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            if (dev.deviceId === selected)
                opt.selected = true;
            sel.appendChild(opt);
        });

    }).catch(function() {}); // Nothing really to do here

    // Gamepad PTT configuration
    var pttb = ui.deviceList.pttb;
    if (typeof Ennuiboard !== "undefined" && Ennuiboard.supported.gamepad) {
        pttb.style.display = "";
        pttb.onclick = ptt.userConfigurePTT;
    }

    // The selector for noise reduction
    var noiser = ui.deviceList.noiser;
    noiser.onchange = function() {
        localStorage.setItem("noise-reduction", noiser.checked?"1":"0");
        proc.setUseNR(noiser.checked);
    };
    var noiserDef = localStorage.getItem("noise-reduction");
    if (noiserDef)
        noiser.checked = !!~~noiserDef;
    noiser.onchange(null);

    // For echo cancellation, which resets the mic
    var ec = ui.deviceList.ec;
    ec.onchange = function() {
        if (ec.ecAdmin) {
            // Don't record an admin-enforced change
            ec.ecAdmin = false;

        } else {
            localStorage.setItem("echo-cancellation2", ec.checked?"1":"0");

            if (ec.checked) {
                log.pushStatus("echo-cancellation", "WARNING: Digital echo cancellation is usually effective in cancelling echo, but will SEVERELY impact the quality of your audio. If possible, find a way to reduce echo physically.");
                setTimeout(function() {
                    log.popStatus("echo-cancellation");
                }, 10000);
            }

        }

        togglePanel("input-device", false);
        audio.getMic(sel.value);
    };

    // And for AGC, which also resets the mic
    if (mobile)
        ui.deviceList.agcHider.style.display = "";
    var agc = ui.deviceList.agc;
    agc.onchange = function() {
        localStorage.setItem("agc", agc.checked?"1":"0");
        togglePanel("input-device", false);
        audio.getMic(sel.value);
    };

    if (!config.useRTC)
        ui.deviceList.optionsWrapper.style.display = "none";
}

// Create the video device list submenu
function createVideoDeviceList() {
    if (!audio.userMedia) {
        // Wait until we can know full names
        audio.userMediaAvailableEvent.addEventListener("usermediaready", createVideoDeviceList, {once: true});
        return;
    }

    ui.videoDeviceList = {
        select: gebi("ecvideo-device-list")
    };

    var sel = ui.videoDeviceList.select;

    // When it's changed, start video
    sel.onchange = function() {
        togglePanel("video-device", false);
        video.getCamera(sel.value);
    };

    // Add a pseudo-device so nothing is selected at first
    var opt = dce("option");
    opt.innerText = "None";
    opt.value = "-none";
    sel.appendChild(opt);

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
            sel.appendChild(opt);
        });

        // Add a special pseudo-device for screen capture
        var opt = dce("option");
        opt.innerText = "Capture screen";
        opt.value = "-screen";
        sel.appendChild(opt);

    }).catch(function() {}); // Nothing really to do here
}

// Create the output device list submenu
function createOutputControlPanel() {
    if (!audio.userMedia) {
        // Wait until we can know full names
        audio.userMediaAvailableEvent.addEventListener("usermediaready", createOutputControlPanel, {once: true});
        return;
    }

    ui.outputControlPanel = {
        selectWrapper: gebi("ecoutput-device-list-wrapper"),
        select: gebi("ecoutput-device-list"),
        volume: gebi("ecoutput-volume"),
        volumeStatus: gebi("ecoutput-volume-status"),
        sfxVolume: gebi("ecsfx-volume"),
        sfxVolumeStatus: gebi("ecsfx-volume-status"),
        sfxVolumeHider: gebi("ecsfx-volume-hider"),
        compressionHider: gebi("ecdynamic-range-compression-hider"),
        compression: gebi("ecdynamic-range-compression")
    };


    /*****
     * 1: Output device list
     *****/

    var sel = ui.outputControlPanel.select;

    // When it's changed, set output
    sel.onchange = function() {
        if (sel.value === "-none") return;
        togglePanel("output-device", false);
        if (ui.audioOutput) {
            (<any> ui.audioOutput).setSinkId(sel.value).catch(console.error);
        } else {
            // Just try again
            setTimeout(sel.onchange, 100);
        }
    };

    // Add a pseudo-device so nothing is selected at first
    var opt = dce("option");
    opt.innerText = "-";
    opt.value = "-none";
    sel.appendChild(opt);

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var ctr = 1, hadOutputs = false;
        devices.forEach(function(dev) {
            if (dev.kind !== "audiooutput") return;
            hadOutputs = true;

            // Create an option for this
            var opt = dce("option");
            var label = dev.label || ("Output " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            sel.appendChild(opt);
        });

    }).catch(function() {}); // Nothing really to do here

    /*****
     * 2: Master volume
     *****/
    var vol = ui.outputControlPanel.volume;
    var volStatus = ui.outputControlPanel.volumeStatus;

    // When we change the volume, pass that to the compressors
    vol.oninput = function() {
        // Snap to x00%
        for (var i = 100; i <= 300; i += 100)
            if (+vol.value >= i - 10 && +vol.value <= i + 10)
                vol.value = <any> i;

        // Remember preferences
        localStorage.setItem("volume-master", vol.value);

        // Show the status
        volStatus.innerHTML = "&nbsp;" + vol.value + "%";

        // Set it
        compression.setGlobalGain((+vol.value) / 100);
    };

    // Get the saved value
    var def = localStorage.getItem("volume-master");
    if (def)
        vol.value = <any> +def;
    vol.oninput(null);

    /*****
     * 3: SFX volume
     *****/
    var sfxVol = ui.outputControlPanel.sfxVolume;
    var sfxVolStatus = ui.outputControlPanel.sfxVolumeStatus;

    // When we change the volume, pass that to sfx
    sfxVol.oninput = function() {
        // Remember preferences
        if (typeof localStorage !== "undefined")
            localStorage.setItem("sfx-volume", sfxVol.value);

        // Show the status
        sfxVolStatus.innerHTML = "&nbsp;" + sfxVol.value + "%";

        // Set it
        for (var url in ui.sounds) {
            var sound = ui.sounds[url];
            sound.el.volume = (+sfxVol.value) / 100;
        }
    };

    // Get the saved value
    if (typeof localStorage !== "undefined") {
        var def = localStorage.getItem("sfx-volume");
        if (def)
            sfxVol.value = <any> +def;
    }
    sfxVol.oninput(null);

    /*****
     * 4: Dynamic range compression (volume leveling)
     *****/
    var compCBHider = ui.outputControlPanel.compressionHider;
    var compCB = ui.outputControlPanel.compression;

    // Swap on or off compression
    compCB.onchange = function() {
        compression.setCompressing(compCB.checked);

        if (compCB.checked) {
            // Set the volume to 100% so it doesn't explode your ears
            vol.value = <any> 100;
        } else {
            // Set the volume to 200% so it's audible
            vol.value = <any> 200;
        }
        vol.oninput(null);

        // Remember the default
        localStorage.setItem("dynamic-range-compression2", compCB.checked?"1":"0");
    };

    // Get the saved default
    var def = localStorage.getItem("dynamic-range-compression2");
    if (def !== null) {
        compCB.checked = !!~~def;
        compression.setCompressing(compCB.checked);
    } else {
        compCB.checked = compression.supported;
        compCB.onchange(null);
    }

    if (!compression.supported)
        compCBHider.style.display = "none";

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
`;
