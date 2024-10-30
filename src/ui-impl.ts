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
 * Implementation of the user interface.
 */

import * as audio from "./audio";
import * as chat from "./chat";
import * as config from "./config";
import * as log from "./log";
import * as master from "./master";
import * as net from "./net";
import * as outproc from "./outproc";
import * as proc from "./proc";
import * as ptt from "./ptt";
import * as uiFE from "./ui";
import { ui } from "./ui";
import * as uiCode from "./ui-code";
import * as util from "./util";
import { dce, gebi } from "./util";
import * as video from "./video";
import * as videoRecord from "./video-record";

import * as downloadStream from "@ennuicastr/dl-stream";
import { Ennuiboard } from "ennuiboard";
import NoSleep from "../node_modules/nosleep.js/dist/NoSleep.min.js";

// Certain options are only shown on mobile
const ua = navigator.userAgent.toLowerCase();
const mobile = (ua.indexOf("android") >= 0) ||
               (ua.indexOf("iphone") >= 0) ||
               (ua.indexOf("ipad") >= 0);

// The NoSleep interface
let noSleep: any = null;

// Make the UI
export function mkUI(): void {
    // Load in the UI
    document.body.style.margin =
        document.body.style.padding = "0";
    document.body.innerHTML = uiCode.code;

    // Make sure the download stream pinger is still going
    if (downloadStream.serviceWorkerPinger)
        document.body.appendChild(downloadStream.serviceWorkerPinger);

    // Get the colors
    const cs = getComputedStyle(document.documentElement);
    for (const nm of [
        "bg",
        "wave-too-soft", "wave-too-loud",
        "nopeak-1", "peak-1",
        "nopeak-2", "peak-2",
        "nopeak-3", "peak-3"
    ]) {
        ui.colors[nm] = cs.getPropertyValue("--" + nm);
    }
    document.body.style.backgroundColor = "var(--bg)";

    // Load the components
    ui.rows = {
        top: gebi("ec3-top-row"),
        main: gebi("ec3-main-row"),
        waveform: gebi("ec3-waveform-row")
    };
    loadVideo();
    loadChat();
    chat.mkChatBox();
    loadWave();
    loadLog();
    ui.layerSeparator = gebi("ec3-layer-separator");
    loadMainMenu();
    loadHostUI();
    loadUserAdmin();
    loadSoundboard();
    loadInputConfig();
    loadOutputConfig();
    loadVideoConfig();
    loadUserList();
    loadCloudStorage();
    loadHelp();
    loadInterfaceSounds();

    if ("master" in config.config)
        master.createMasterInterface();
    else
        master.hideMasterInterface();

    // Every close button works the same
    Array.prototype.slice.call(document.getElementsByClassName("close-button"), 0).forEach(function(x: HTMLElement) {
        x.onclick = function() { uiFE.showPanel(null); };
    });
    ui.layerSeparator.onclick = function() { uiFE.showPanel(null); };

    // Escape also closes
    window.addEventListener("keydown", function(ev) {
        if (ev.key === "Esc" || ev.key === "Escape")
            uiFE.showPanel(null);
        /*
        if (ev.key === "d") {
            let bad = new DataView(new ArrayBuffer(4));
            bad.setUint32(0, -1, true);
            net.dataSock.send(bad.buffer);
            net.pingSock.send(bad.buffer);
        }
        */
    });

    // If we're on mobile, now is the time to NoSleep
    if (mobile) {
        noSleep = new NoSleep();
        uiFE.onTransientActivation(async () => {
            noSleep.enable();
        });

    }
}

function loadVideo() {
    ui.video = {
        window: null,
        wrapper: gebi("ec3-video-wrapper"),
        sideOuter: gebi("ec3-side-video-wrappera"),
        side: gebi("ec3-side-video-wrapperb"),
        main: gebi("ec3-main-video-wrapper"),
        users: [],
        selected: -1,
        major: -1,
        mode: uiFE.ViewMode.Normal,
        css: dce("style")
    };
    const video = ui.video;

    video.css.type = "text/css";
    document.head.appendChild(video.css);
}

function loadChat() {
    ui.chat = {
        wrapper: gebi("ec3-chat-wrapper"),
        incoming: gebi("ec3-chat-incoming"),
        outgoing: gebi("ec3-chat-outgoing-txt"),
        outgoingB: gebi("ec3-chat-outgoing-btn")
    };
}

function loadWave() {
    const wave = ui.wave = {
        wrapper: gebi("ec3-waveform-row"),
        watcher: gebi("ec3-waveform-watcher")
    };

    // Choose the watcher image's type based on support
    function usePng() {
        wave.watcher.src = "images/watcher.png";
    }
    if (!window.createImageBitmap || !window.fetch) {
        usePng();
    } else {
        const sample = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
        fetch(sample).then(function(res) {
            return res.blob();
        }).then(function(blob) {
            return createImageBitmap(blob)
        }).then(function() {
            wave.watcher.src = "images/watcher.webp";
        }).catch(usePng);
    }
}

function loadLog() {
    const log = ui.log = {
        wrapper: gebi("ec3-status"),
        spacer: gebi("ec3-status-spacer"),
        name: gebi("ec3-recording-title"),
        timer: gebi("ec3-recording-timer")
    };

    if (net.recName)
        log.name.innerText = net.recName;
    util.events.addEventListener("net.info.recName", function() {
        log.name.innerText = net.recName;
    });
}

function loadMainMenu() {
    const p = ui.mainMenu = {
        showHide: gebi("ec3-menu-button"),
        fullscreen: gebi("ec3-fs-button"),
        wrapper: gebi("ec3-main-menu-wrapper"),
        host: gebi("ec3-host-interface-button"),
        userAdmin: gebi("ec3-user-admin-button"),
        sounds: gebi("ec3-soundboard-button"),
        mute: gebi("ec3-mute-button"),
        shareVideo: gebi("ec3-video-share-button"),
        shareScreen: gebi("ec3-screen-share-button"),
        settings: gebi("ec3-settings-button"),
        chat: gebi("ec3-chat-button"),
        help: gebi("ec3-help-button"),
        videoPopout: gebi("ec3-streamer-popout-all-button")
    };

    ui.panels.transientActivation = {
        wrapper: gebi("ec3-transient-activation-panel"),
        label: gebi("ec3-transient-activation-panel-label"),
        button: gebi("ec3-transient-activation-btn")
    };

    ui.panels.webdav = {
        wrapper: gebi("ec3-webdav-panel"),
        form: gebi("ec3-webdav-form"),
        username: gebi("ec3-webdav-username"),
        password: gebi("ec3-webdav-password"),
        url: gebi("ec3-webdav-url"),
        login: gebi("ec3-webdav-login-btn")
    };

    const sets = ui.panels.settings = {
        wrapper: gebi("ec3-settings-panel"),
        viewModes: {
            normal: gebi("ec3-view-mode-normal-btn"),
            gallery: gebi("ec3-view-mode-gallery-btn"),
            studio: gebi("ec3-view-mode-studio-btn"),
            small: gebi("ec3-view-mode-small-btn")
        },
        captionHider: gebi("ec3-caption-hider"),
        captionC: gebi("ec3-caption-chk"),
        inputB: gebi("ec3-input-settings-button"),
        outputB: gebi("ec3-output-settings-button"),
        videoB: gebi("ec3-video-settings-button"),
        userListB: gebi("ec3-user-list-button")
    };

    let showHideSave: (value: string) => void = null;
    function menuShowHide(to?: boolean) {
        if (typeof to === "undefined")
            to = (p.wrapper.style.display === "none");
        p.wrapper.style.display = to ? "" : "none";
        if (showHideSave)
            showHideSave(to ? "1" : "0");
        p.showHide.setAttribute("aria-label", to ?
            "Hide main menu" : "Show main menu");
        uiFE.maybeResizeSoon();
    }

    showHideSave = uiFE.saveConfigGeneric(
        "ec3-show-main-menu", saved => {
        if (typeof saved === "string")
            menuShowHide(!!+saved);
    });

    p.showHide.onclick = () => menuShowHide();

    // A generic function to handle fullscreen buttons
    function fullscreen(el: HTMLElement, btn: HTMLButtonElement) {
        if (!el.requestFullscreen) {
            btn.style.display = "none";
            return;
        }

        btn.innerHTML = '<i class="bx bx-fullscreen"></i>';

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
                btn.innerHTML = '<i class="bx bx-exit-fullscreen"></i>';
            else
                btn.innerHTML = '<i class="bx bx-fullscreen"></i>';
        });
    }

    fullscreen(document.body, p.fullscreen);

    /* FIXME: user-specific fullscreen buttons
    fullscreen(video.wrapper, video.sideFS);
    fullscreen(video.mainWrapper, video.mainFS);
    */

    function btn(b: HTMLButtonElement, p: string, a: string) {
        b.onclick = function() {
            uiFE.showPanel(ui.panels[p], ui.panels[p][a]);
        };
    }

    p.mute.onclick = function() {
        let to: boolean = undefined;
        for (const input of audio.inputs) {
            if (input)
                to = input.toggleMute(to);
        }
    };
    btn(p.host, "host", "startStopB");
    btn(p.userAdmin, "userAdmin", "allB");
    btn(p.sounds, "soundboard", null);
    btn(p.settings, "settings", "inputB");
    p.chat.onclick = function() {
        const chat = ui.chat.wrapper;
        if (chat.style.display === "none") {
            chat.style.display = "";
            ui.chat.outgoing.focus();
        } else {
            chat.style.display = "none";
        }
        uiFE.maybeResizeSoon();
    };
    btn(p.help, "help", null);
    btn(sets.inputB, "inputConfig", null);
    btn(sets.outputB, "outputConfig", null);
    if (!config.useRTC) sets.outputB.style.display = "none";
    btn(sets.videoB, "videoConfig", null);
    btn(sets.userListB, "userList", null);
    if (!config.useRTC && !("master" in config.config))
        sets.userListB.style.display = "none";

    // Support for popping out the entire video block
    let w: WindowProxy = null;
    function popoutOpen() {
        w = ui.video.window = window.open("", "", "width=1280,height=720,menubar=0,toolbar=0,location=0,personalbar=0,status=0");
        if (!w) return;

        w.document.title = "Video — " + document.title;

        // To make it flex properly, it needs the CSS
        const ssurl = new URL(<any> window.location);
        ssurl.search = "?v=1";
        // eslint-disable-next-line no-useless-escape
        ssurl.pathname = ssurl.pathname.replace(/\/[^\/]*$/, "/ennuicastr3.css");
        w.document.head.innerHTML = '<link href="' + (<any> ssurl) + '" rel="stylesheet" />';
        w.document.head.appendChild(ui.video.css);
        w.document.body.setAttribute("data-view-mode", document.body.getAttribute("data-view-mode"));

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
        w.onresize = function() { uiFE.updateVideoUI(0); }

        // Play them
        for (let vi = 0; vi < ui.video.users.length; vi++) {
            const v = ui.video.users[vi];
            if (!v) continue;
            if (v.video && v.video.tagName === "VIDEO")
                (<HTMLVideoElement> v.video).play().catch(console.error);
        }

        setTimeout(function() {
            uiFE.updateVideoUI(0);
        }, 0);
    }

    function popoutClose() {
        w = ui.video.window = null;
        document.head.appendChild(ui.video.css);
        ui.rows.main.insertBefore(ui.video.wrapper, ui.chat.wrapper);

        // Play them
        for (let vi = 0; vi < ui.video.users.length; vi++) {
            const v = ui.video.users[vi];
            if (!v) continue;
            if (v.video && v.video.tagName === "VIDEO")
                (<HTMLVideoElement> v.video).play().catch(console.error);
        }

        setTimeout(function() {
            uiFE.updateVideoUI(0);
        }, 0);
    }

    p.videoPopout.onclick = function() {
        if (w)
            w.close();
        else
            popoutOpen();
    };
}

function loadHostUI() {
    ui.panels.invite = {
        button: gebi("ec3-invite-button"),
        wrapper: gebi("ec3-invite-panel"),
        link: gebi("ec3-invite-link-txt"),
        copyB: gebi("ec3-invite-link-copy-btn"),
        flacHider: gebi("ec3-invite-flac-hider"),
        flac: gebi("ec3-invite-flac-chk"),
        continuousHider: gebi("ec3-invite-continuous-hider"),
        continuous: gebi("ec3-invite-continuous-chk"),
    };

    ui.panels.invite.button.onclick = function() {
        uiFE.showPanel(ui.panels.invite, ui.panels.invite.copyB);
    };

    ui.panels.host = {
        wrapper: gebi("ec3-host-interface-panel"),
        startB: [
            gebi("ec3-start-recording-button"),
            gebi("ec3-start-recording-button2")
        ],
        stopHider: gebi("ec3-stop-recording-hider"),
        pauseB: [
            gebi("ec3-pause-recording-button"),
            gebi("ec3-pause-recording-button2")
        ],
        resumeB: [
            gebi("ec3-resume-recording-button"),
            gebi("ec3-resume-recording-button2")
        ],
        stopB: [
            gebi("ec3-stop-recording-button"),
            gebi("ec3-stop-recording-button2")
        ],
        sureHider: gebi("ec3-stop-sure-hider"),
        stopYesB: gebi("ec3-stop-yes-button"),
        stopNoB: gebi("ec3-stop-no-button"),
        inviteB: gebi("ec3-invite-button2"),
        acceptRemoteVideo: gebi("ec3-accept-guest-video-chk"),
        saveVideoInCloud: gebi("ec3-video-rec-save-in-cloud-chk"),
        saveVideoInCloudLbl: gebi("ec3-video-rec-save-in-cloud-lbl"),
        saveVideoInFSDHHider: gebi("ec3-video-rec-save-in-fsdh-hider"),
        saveVideoInFSDH: gebi("ec3-video-rec-save-in-fsdh-chk"),
        downloadVideoLive: gebi("ec3-video-rec-download-chk"),
        videoStatus: gebi("ec3-video-rec-status"),
        recordingCost: gebi("ec3-recording-cost-txt"),
        recordingRate: gebi("ec3-recording-rate-txt")
    };
}

function loadUserAdmin() {
    ui.panels.userAdmin = {
        wrapper: gebi("ec3-user-admin-list-panel"),
        allB: gebi("ec3-user-admin-all-button"),
        buttons: []
    };

    ui.panels.userAdminUser = {
        wrapper: gebi("ec3-user-admin-user-panel"),
        user: -1,
        name: gebi("ec3-user-admin-user-name-lbl"),
        kick: gebi("ec3-user-admin-kick-button"),
        mute: gebi("ec3-user-admin-mute-button"),
        echo: gebi("ec3-user-admin-echo-button"),
        reqFull: gebi("ec3-user-admin-request-full-button")
    };

    ui.panels.userAdminFull = {
        wrapper: gebi("ec3-user-admin-user-full-panel"),
        user: -1,
        name: gebi("ec3-user-admin-user-full-name-lbl"),
        kick: gebi("ec3-user-admin-full-kick-button"),
        mute: gebi("ec3-user-admin-full-mute-chk"),
        echo: gebi("ec3-user-admin-full-echo-chk"),
        vadSensitivity: gebi("ec3-user-admin-full-vad-sensitivity-rng"),
        vadSensitivityStatus: gebi("ec3-user-admin-full-vad-sensitivity-status"),
        vadNoiseGate: gebi("ec3-user-admin-full-vad-noise-gate-rng"),
        vadNoiseGateStatus: gebi("ec3-user-admin-full-vad-noise-gate-status"),
        audioInput: gebi("ec3-user-admin-full-audio-dev-sel"),
        videoHider: gebi("ec3-user-admin-full-video-hider"),
        videoInput: gebi("ec3-user-admin-full-video-dev-sel"),
        videoRes: gebi("ec3-user-admin-full-video-res-sel"),
        videoBR: gebi("ec3-user-admin-full-bitrate-inp"),
        videoRec: gebi("ec3-user-admin-full-video-record-button")
    };

    const req = ui.panels.userAdminReq = {
        wrapper: gebi("ec3-user-admin-permission-panel"),
        user: -1,
        name: gebi("ec3-user-admin-permission-requester"),
        yes: gebi("ec3-user-admin-permission-yes-button"),
        audio: gebi("ec3-user-admin-permission-audio-button"),
        no: gebi("ec3-user-admin-permission-no-button")
    };

    req.yes.onclick = function() {
        net.setAdminPerm(req.user, audio.deviceInfo, true, true);
        uiFE.showPanel(null);
    };

    req.audio.onclick = function() {
        net.setAdminPerm(req.user, audio.deviceInfo, true, false);
        uiFE.showPanel(null);
    };

    req.no.onclick = function() {
        net.setAdminPerm(req.user, audio.deviceInfo, false, false);
        uiFE.showPanel(null);
    };
}

function loadSoundboard() {
    ui.panels.soundboard = {
        wrapper: gebi("ec3-soundboard-panel"),
        soundsWrapper: gebi("ec3-sounds"),
        sounds: {}
    };
}

function loadInputConfig() {
    const input = ui.panels.inputConfig = {
        wrapper: gebi("ec3-input-settings-panel"),
        device: gebi("ec3-input-device-sel"),
        channelHider: gebi("ec3-input-channel-hider"),
        channel: gebi("ec3-input-channel-sel"),
        ptt: gebi("ec3-ptt-btn"),
        noiserHider: gebi("ec3-noise-reduction-hider"),
        noiser: gebi("ec3-noise-reduction-chk"),
        echo: gebi("ec3-echo-cancellation-chk"),
        dualEC: gebi("ec3-dual-ec-chk"),
        agcHider: gebi("ec3-agc-hider"),
        agc: gebi("ec3-agc-chk"),
        vadSensitivity: gebi("ec3-vad-sensitivity-rng"),
        vadSensitivityStatus: gebi("ec3-vad-sensitivity-status"),
        vadNoiseGate: gebi("ec3-vad-noise-gate-rng"),
        vadNoiseGateStatus: gebi("ec3-vad-noise-gate-status")
    };

    if (!config.useRTC || config.useRecordOnly) {
        // Hide irrelevant options
        input.noiserHider.style.display = "none";
    }
}

function loadOutputConfig() {
    const output = ui.panels.outputConfig = {
        wrapper: gebi("ec3-output-settings-panel"),
        deviceHider: gebi("ec3-output-device-list-hider"),
        device: gebi("ec3-output-device-sel"),
        volumeHider: gebi("ec3-output-volume-hider"),
        volume: gebi("ec3-output-volume-rng"),
        volumeStatus: gebi("ec3-output-volume-status"),
        sfxVolumeHider: gebi("ec3-sfx-volume-hider"),
        sfxVolume: gebi("ec3-sfx-volume-rng"),
        sfxVolumeStatus: gebi("ec3-sfx-volume-status"),
        compressionHider: gebi("ec3-dynamic-range-compression-hider"),
        compression: gebi("ec3-dynamic-range-compression-chk"),
        muteInterface: gebi("ec3-mute-interface-sounds-chk")
    };

    if (!config.useRTC) {
        // Hide irrelevant parts
        output.volumeHider.style.display =
            output.compressionHider.style.display = "none";
    }
}

function loadVideoConfig() {
    const vc = ui.panels.videoConfig = {
        wrapper: gebi("ec3-video-settings-panel"),
        visible: false,
        onshow: <()=>void> null,
        onhide: <()=>void> null,
        preview: gebi("ec3-video-preview"),
        previewS: <MediaStream> null,
        previewV: <HTMLVideoElement> null,
        device: gebi("ec3-video-device-sel"),
        shareB: gebi("ec3-video-share-btn"),
        res: gebi("ec3-video-res-sel"),

        recording: {
            hider: gebi("ec3-video-record-hider"),
            record: gebi("ec3-video-record-chk"),
            optHider: gebi("ec3-video-record-opt-hider"),
            remote: gebi("ec3-video-record-remote-chk"),
            local: gebi("ec3-video-record-local-chk"),
            manualBitrate: gebi("ec3-video-record-bitrate-chk"),
            bitrateHider: gebi("ec3-video-record-bitrate-hider"),
            bitrate: gebi("ec3-video-record-bitrate-txt")
        },

        streamerModeHider: gebi("ec3-streamer-mode-hider"),
        streamerMode: gebi("ec3-streamer-mode-chk")
    };

    const bitrate = vc.recording.bitrate;
    bitrate.oninput = function() {
        // eslint-disable-next-line no-useless-escape
        const f = bitrate.value.replace(/[^0-9\.]/g, "");
        if (bitrate.value !== f)
            bitrate.value = f;
    };

    videoRecord.loadVideoRecordPanel();
}

function loadUserList() {
    ui.panels.userList = {
        wrapper: gebi("ec3-user-list-panel"),
        userList: gebi("ec3-user-list"),
        users: []
    };
}

function loadCloudStorage() {
    ui.panels.cloudStorage = {
        wrapper: gebi("ec3-cloud-storage-sel-panel"),
        desc: gebi("ec3-cloud-storage-desc"),
        googleDrive: gebi("ec3-google-drive-btn"),
        dropbox: gebi("ec3-dropbox-btn"),
        webdav: gebi("ec3-cloud-webdav-btn"),
        fsdh: gebi("ec3-cloud-storage-fsdh-btn"),
        cancel: gebi("ec3-cloud-storage-cancel-btn")
    };
}

function loadHelp() {
    ui.panels.help = {
        wrapper: gebi("ec3-help-panel")
    };
}

function loadInterfaceSounds() {
    ui.sounds = {
        chimeUp: gebi("ec3-chime-up-snd"),
        chimeDown: gebi("ec3-chime-down-snd"),
        soundboard: {}
    };
}

// Load elements which require audio first
export function mkAudioUI(): string {
    const main = ui.panels.settings,
        input = ui.panels.inputConfig,
        output = ui.panels.outputConfig,
        videoConfig = ui.panels.videoConfig;

    /********************
     * INPUT CONFIGURATION
     *******************/
    function inputChange() {
        // FIXME
        audio.inputs[0].setInputDevice(input.device.value);
    }

    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        let ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "audioinput") return;

            // Create an option for this
            const opt = dce("option");
            const label = dev.label || ("Mic " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            input.device.appendChild(opt);
        });

        uiFE.saveConfigValue(input.device, "input-device3", inputChange);

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    }).catch(function() {}); // Nothing really to do here

    function channelChange() {
        audio.inputs[0].setInputChannel(+input.channel.value);
    }
    input.channel.onchange = channelChange;

    // Gamepad PTT configuration
    if (Ennuiboard.supported.gamepad)
        input.ptt.onclick = ptt.userConfigurePTT;
    else
        input.ptt.style.display = "none";

    function noiserChange() {
        proc.setUseNR(input.noiser.checked);
    }

    uiFE.saveConfigCheckbox(input.noiser, "noise-reduction3", noiserChange);
    noiserChange();

    if (mobile) {
        input.echo.checked = true;
        input.agcHider.style.display = "";
        input.agc.checked = true;
    }
    uiFE.saveConfigCheckbox(input.echo, "echo-cancellation3", function() {
        audio.setUseEC(input.echo.checked);
    });
    input.dualEC.checked = config.useDualECDefault;
    uiFE.saveConfigCheckbox(input.dualEC, `dual-ec-${config.useDualECDefault}-3`, () => {
        audio.setDualEC(input.dualEC.checked);
    });
    uiFE.saveConfigCheckbox(input.agc, "agc3", inputChange);

    function vadSensitivityChange() {
        proc.setVadSensitivity(4 - (+input.vadSensitivity.value));
    }
    function vadSensitivityInput() {
        input.vadSensitivityStatus.innerHTML =
            "&nbsp;" + input.vadSensitivity.value;
    }
    uiFE.saveConfigSlider(input.vadSensitivity, "vad-sensitivity",
        vadSensitivityChange, vadSensitivityInput);
    vadSensitivityInput();
    vadSensitivityChange();

    function vadNoiseGateChange() {
        proc.setVadNoiseGate(+input.vadNoiseGate.value);
    }
    function vadNoiseGateInput() {
        input.vadNoiseGateStatus.innerHTML =
            "&nbsp;" + input.vadNoiseGate.value + "dB";
    }
    uiFE.saveConfigSlider(input.vadNoiseGate, "vad-noise-gate",
        vadNoiseGateChange, vadNoiseGateInput);
    vadNoiseGateInput();
    vadNoiseGateChange();


    /********************
     * OUTPUT CONFIGURATION
     *******************/

    // Add a pseudo-device for the default
    let opt = dce("option");
    opt.innerText = "Default";
    opt.value = "-default";
    output.device.appendChild(opt);

    function outputChange() {
        let v = output.device.value;
        if (v === "-default")
            v = "";

        // Set the main audio output
        if (ui.audioOutput) {
            try {
                (<any> ui.audioOutput).setSinkId(v).catch(console.error);
            } catch (ex) {}
        } else {
            // Just try again once ui.audioOutput is available
            setTimeout(outputChange, 100);
            return;
        }

        // Set the AudioContext audio output
        if (audio.ac) {
            try {
                (<any> audio.ac).setSinkId(v).catch(console.error);
            } catch (ex) {}
        } else {
            setTimeout(outputChange, 100);
            return;
        }

        // And all the sounds
        try {
            (<any> ui.sounds.chimeUp).setSinkId(v).catch(console.error);
            (<any> ui.sounds.chimeDown).setSinkId(v).catch(console.error);
            for (const url in ui.sounds.soundboard) {
                const sound = ui.sounds.soundboard[url];
                (<any> sound.el).setSinkId(v).catch(console.error);
            }
        } catch (ex) {}
    }

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        let ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "audiooutput") return;
            if (dev.label === "Default" || dev.deviceId === "default") return;

            // Create an option for this
            const opt = dce("option");
            const label = dev.label || ("Output " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            output.device.appendChild(opt);
        });

        uiFE.saveConfigValue(output.device, "output-device3", outputChange);

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    }).catch(function() {}); // Nothing really to do here

    // Volume
    uiFE.saveConfigSlider(output.volume, config.useRecordOnly ? "volume-master-record-only" : "volume-master3");
    if (config.useRecordOnly) {
        output.volume.value = "0";
        output.volumeStatus.innerHTML = "&nbsp;0%";
    }

    // But, separate save for snapping
    function volumeChange() {
        const vol = output.volume;

        // Snap to x00%
        for (let i = 100; i <= 300; i += 100)
            if (+vol.value >= i - 10 && +vol.value <= i + 10)
                vol.value = <any> i;

        // Remember preferences
        localStorage.setItem(config.useRecordOnly ? "volume-master-record-only" : "volume-master3", ""+vol.value);

        // Show the status
        output.volumeStatus.innerHTML = "&nbsp;" + vol.value + "%";

        // Set it
        outproc.setGlobalGain((+vol.value) / 100);
    }
    output.volume.oninput = volumeChange;

    output.volumeStatus.innerHTML = "&nbsp;" + output.volume.value + "%";
    outproc.setGlobalGain((+output.volume.value) / 100);

    // SFX volume
    function sfxVolumeChange() {
        const vol = output.sfxVolume;

        const v = (+vol.value) / 100;

        for (const url in ui.sounds.soundboard) {
            const sound = ui.sounds.soundboard[url];
            sound.el.volume = v;
        }

        ui.sounds.chimeUp.volume = v;
        ui.sounds.chimeDown.volume = v;
    }
    function sfxVolumeInput() {
        output.sfxVolumeStatus.innerHTML =
            "&nbsp;" + output.sfxVolume.value + "%";
    }

    uiFE.saveConfigSlider(output.sfxVolume, "volume-sfx3", sfxVolumeChange,
        sfxVolumeInput);
    sfxVolumeInput();
    sfxVolumeChange();

    // Dynamic range compression
    function drcChange() {
        const c = output.compression.checked;
        outproc.setCompressing(c);

        if (!config.useRecordOnly) {
            if (c) {
                // Set the volume to 100% so it doesn't explode your ears
                output.volume.value = <any> 100;
            } else {
                // Set the volume to 200% so it's audible
                output.volume.value = <any> 200;
            }
        }
        volumeChange();
    }

    // Default for DRC depends on support
    if (!outproc.supported) {
        output.compressionHider.style.display = "none";
        output.compression.checked = false;
        if (localStorage.getItem("volume-master3") === null)
            drcChange();
    }
    uiFE.saveConfigCheckbox(output.compression, "dynamic-range-compression4", drcChange);
    outproc.setCompressing(output.compression.checked);

    // Interface sounds is just a checkbox we check before making sounds
    uiFE.saveConfigCheckbox(output.muteInterface, "mute-interface3");


    /********************
     * VIDEO CONFIGURATION
     *******************/

    // When we change settings, change the preview and button
    function updateVideo() {
        // Remove any existing preview
        if (videoConfig.previewS) {
            videoConfig.previewS.getTracks().forEach(track => { track.stop(); });
            videoConfig.previewS = null;
        }
        if (videoConfig.previewV) {
            videoConfig.previewV.pause();
            videoConfig.previewV = null;
            videoConfig.preview.innerHTML = "";
        }

        const dev = videoConfig.device.value;
        const shareB = videoConfig.shareB;

        // Change the button meaning
        shareB.classList.remove("off");
        shareB.disabled = false;
        if (video.userMediaVideoID === dev || dev === "-none") {
            // Click this to *un*share
            shareB.innerHTML = '<i class="bx bx-video-off"></i> Unshare camera';
            shareB.onclick = function() {
                shareB.classList.add("off");
                shareB.disabled = true;
                video.shareVideo("-none", 0).then(updateVideo);
            };

            // But, meaningless if we're already not sharing anything
            if (video.userMediaVideoID === null) {
                shareB.classList.add("off");
                shareB.disabled = true;
            }

        } else {
            // Click this to share
            shareB.innerHTML = '<i class="bx bx-video"></i> Share camera';
            shareB.onclick = function() {
                shareB.classList.add("off");
                shareB.disabled = true;

                // Stop the current video in case access is exclusive
                if (videoConfig.previewS) {
                    videoConfig.previewS.getTracks().forEach(track => { track.stop(); });
                    videoConfig.previewS = null;
                }

                // Then load it
                video.shareVideo(videoConfig.device.value, +videoConfig.res.value).then(updateVideo);
            };

        }

        if (!videoConfig.visible)
            return;

        // Change the preview
        Promise.all([]).then(() => {
            if (video.userMediaVideoID === dev)
                return video.userMediaVideo;

            return video.getVideo(dev, +videoConfig.res.value);

        }).then(um => {
            if (um) {
                if (um !== video.userMediaVideo)
                    videoConfig.previewS = um;
                const v = videoConfig.previewV = dce("video");
                v.style.width = videoConfig.preview.offsetWidth + "px";
                v.style.height = "100%";
                videoConfig.preview.appendChild(v);
                v.srcObject = um;
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                v.play().catch(()=>{});
            }
        });
    }

    videoConfig.onshow = function() {
        videoConfig.visible = true;
        updateVideo();
    };
    videoConfig.onhide = function() {
        videoConfig.visible = false;
        updateVideo();
    };

    // Add a pseudo-device so nothing is selected at first
    opt = dce("option");
    opt.innerText = "None";
    opt.value = "-none";
    videoConfig.device.appendChild(opt);

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        let ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "videoinput") return;

            // Create an option for this
            const opt = dce("option");
            const label = dev.label || ("Camera " + ctr++);
            opt.innerText = label;
            opt.value = dev.deviceId;
            videoConfig.device.appendChild(opt);
        });

        // Now that it's filled, we can load the value
        uiFE.saveConfigValue(videoConfig.device, "video-device", updateVideo);

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    }).catch(function() {}); // Nothing really to do here

    // Resolution selector
    function resChange() {
        net.updateAdminPerm({videoRes: +videoConfig.res.value}, true);
        if (video.userMediaVideoID && video.userMediaVideoID !== "-screen")
            video.shareVideo(video.userMediaVideoID, +videoConfig.res.value);
    }
    uiFE.saveConfigValue(videoConfig.res, "video-res2", resChange);

    // Persistent video buttons
    video.updateVideoButtons();

    // View mode
    let viewModeSave: (value: string) => void = null;
    function viewModeChange(mode: number) {
        // Save it
        if (viewModeSave)
            viewModeSave("" + mode);

        // Retake control of sizing if applicable
        switch ("" + ui.video.mode + mode) {
            case "01":
            case "03":
            case "10":
            case "12":
            case "21":
            case "23":
            case "30":
            case "32":
                /* Moving from a fixed-size mode to a variable-sized mode or
                 * vice-versa, so retake control of sizing */
                ui.userSized = false;
        }

        // Set the view
        ui.video.mode = mode;
        const smode = ["normal", "small", "gallery", "studio"][mode] || "";
        document.body.setAttribute("data-view-mode", smode);
        if (ui.video.window)
            ui.video.window.document.body.setAttribute("data-view-mode", smode);

        // Retake control of sizing if the mode is appropriate for it
        ui.userSized = false;

        // Reset UI elements
        ui.video.selected = ui.video.major = -1;
        ui.video.css.innerHTML = "";
        /* FIXME?
        if (mode === uiFE.ViewMode.Small)
            ui.wrapper.insertBefore(ui.dock, ui.log.wrapper);
        else
            ui.wrapper.insertBefore(ui.dock, ui.wave.wrapper);
        */

        // And update other components
        uiFE.updateVideoUI(0);
        outproc.setWaveviewing(mode === uiFE.ViewMode.Studio);
    }

    let defaultViewMode = 0; // normal
    let viewModeSetting = "view-mode";
    if (config.useRTC) {
        // Voice chat, so have different view modes
        if (config.useRecordOnly) {
            // Record only, so default to small or studio
            if ("master" in config.config) {
                defaultViewMode = 3; // studio
            } else {
                defaultViewMode = 1; // small
            }

            viewModeSetting = "view-mode-record-only";

        }

    } else {
        defaultViewMode = 1; // small
        viewModeSetting = "view-mode-nortc";

    }

    viewModeSave = uiFE.saveConfigGeneric(viewModeSetting, saved => {
        if (typeof saved === "string")
            defaultViewMode = +saved;
    });
    viewModeChange(defaultViewMode);

    main.viewModes.normal.onclick = () => viewModeChange(0);
    main.viewModes.small.onclick = () => viewModeChange(1);
    main.viewModes.gallery.onclick = () => viewModeChange(2);
    main.viewModes.studio.onclick = () => viewModeChange(3);

    function showCaptionChange() {
        document.body.setAttribute("data-captions", main.captionC.checked ? "show" : "hide");
    }

    if (config.useTranscription) {
        uiFE.saveConfigCheckbox(main.captionC, "show-captions", showCaptionChange);
        showCaptionChange();

    } else {
        main.captionHider.style.display = "none";

    }

    // Streamer mode
    function streamerModeChange(ev: Event) {
        const s = videoConfig.streamerMode.checked;
        document.body.setAttribute("data-streamer-interface", s?"show":"hide");
        if (s) {
            // Tell them how much browser chrome they need to compete with
            log.pushStatus(
                "chrome",
                "Browser chrome: " + (window.outerWidth-window.innerWidth) + "x" + (window.outerHeight-window.innerHeight), {
                timeout: 10000
            });
        }
    }
    if (mobile) {
        videoConfig.streamerModeHider.style.display = "none";
    } else {
        uiFE.saveConfigCheckbox(videoConfig.streamerMode, "streamer-mode3", streamerModeChange);
        streamerModeChange(null);
    }

    // Return which input device should be used
    return localStorage.getItem("input-device3");
}

// Update the mute button when the mute state changes
util.events.addEventListener("audio.mute", function() {
    const muteB = ui.mainMenu.mute;
    if (audio.inputs[0].userMedia.getAudioTracks()[0].enabled) {
        // It's unmuted
        muteB.innerHTML = '<i class="bx bx-microphone"></i><span class="menu-button-lbox"><span class="menu-button-label">Mute</span></span>';
        muteB.setAttribute("aria-label", "Mute");

    } else {
        // It's muted
        muteB.innerHTML = '<i class="bx bx-microphone-off"></i><span class="menu-button-lbox"><span class="menu-button-label">Unmute</span></span>';
        muteB.setAttribute("aria-label", "Unmute");

    }
});
