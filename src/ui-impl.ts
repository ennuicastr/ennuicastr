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

// extern
declare let Ennuiboard: any, NoSleep: any;

import * as audio from "./audio";
import * as chat from "./chat";
import * as config from "./config";
import * as downloadStream from "./download-stream";
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

// Certain options are only shown on mobile
const ua = navigator.userAgent.toLowerCase();
const mobile = (ua.indexOf("android") >= 0) ||
               (ua.indexOf("iphone") >= 0) ||
               (ua.indexOf("ipad") >= 0);

// The NoSleep interface
let noSleep: any = null;

// Make the UI
export function mkUI(): Promise<unknown> {
    // Snag the original log before we overwrite it
    const log = gebi("log");

    // Load in the UI
    document.body.style.margin =
        document.body.style.padding = "0";
    document.body.innerHTML = uiCode.code;

    // Make sure the download stream pinger is still going
    if (downloadStream.serviceWorkerPinger)
        document.body.appendChild(downloadStream.serviceWorkerPinger);

    // Get the colors
    const cs = getComputedStyle(document.documentElement);
    [
        "bg", "bg-hover", "bg-off", "bg-plain", "bg-invite", "bg-status",
        "bg-wave", "fg", "fg-status", "border-plain", "link-color",
        "link-color-status", "wave-too-soft", "wave-too-loud",
        "user-list-silent", "user-list-speaking", "video-speaking-sel",
        "video-speaking", "video-silent-sel", "video-silent",
        "peak-1", "peak-2", "peak-3", "nopeak-1", "nopeak-2", "nopeak-3",
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
    loadDebug();
    loadInterfaceSounds();

    if ("master" in config.config)
        master.createMasterInterface();

    // Every close button works the same
    Array.prototype.slice.call(document.getElementsByClassName("close-button"), 0).forEach(function(x: HTMLElement) {
        x.onclick = function() { uiFE.showPanel(null, ui.persistent.main); };
    });
    ui.layerSeparator.onclick = function() { uiFE.showPanel(null, ui.persistent.main); };

    // Escape also closes
    window.addEventListener("keydown", function(ev) {
        if (ev.key === "Esc" || ev.key === "Escape")
            uiFE.showPanel(null, ui.persistent.main);
        /*
        if (ev.key === "d") {
            let bad = new DataView(new ArrayBuffer(4));
            bad.setUint32(0, -1, true);
            net.dataSock.send(bad.buffer);
            net.pingSock.send(bad.buffer);
        }
        */
    });

    // Poppable panels
    if ("master" in config.config) {
        const m = ui.panels.master;
        poppable(m.mainPopoutWrapper, m.mainPopout, null, "master-main-popout",
            m.mainPopoutDock, m.mainDock, {defaultOut: true});
        poppable(m.recordingCostPopoutWrapper, m.recordingCostPopout, null,
            "recording-cost-popout3", m.wrapper, m.recordingCostDock);
    }
    {
        const s = ui.panels.soundboard;
        poppable(s.popoutWrapper, s.popout, ui.persistent.sounds, "sounds-popout3", s.wrapper, s.dock);
    }
    {
        const u = ui.panels.userList;
        poppable(u.popoutWrapper, u.popout, ui.panels.main.userListB, "user-list-popout3", u.wrapper, u.dock);
    }

    // When we resize, re-flex
    window.addEventListener("resize", uiFE.onResize);
    uiFE.resizeUI();

    // If we're on mobile, now is the time to NoSleep
    if (mobile) {
        return Promise.all([]).then(function() {
            return util.loadLibrary("libs/NoSleep.min.js");

        }).then(function() {
            noSleep = new NoSleep();
            uiFE.showPanel(ui.panels.mobile, ui.panels.mobile.button, true);
            return new Promise((res) => {
                ui.panels.mobile.button.onclick = res;
            });

        }).then(function() {
            noSleep.enable();
            uiFE.unsetModal();
            uiFE.showPanel(null, ui.persistent.main);

        }).catch(net.promiseFail());

    } else {
        return Promise.all([]);

    }
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
        mode: uiFE.ViewMode.Normal,
        css: dce("style")
    };
    const video = ui.video;

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
    const wave = ui.wave = {
        wrapper: gebi("ecwaveform-wrapper"),
        watcher: gebi("ecwave-watcher")
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

function loadLog(logEl: HTMLElement) {
    const log = ui.log = {
        wrapper: gebi("ecstatus"),
        logWrapper: gebi("eclog"),
        log: logEl,
        timer: gebi("ectimer")
    };
    log.logWrapper.appendChild(log.log);
}

function loadMainMenu() {
    const p = ui.persistent = {
        master: gebi("ecmenu-master"),
        userAdmin: gebi("ecmenu-user-admin"),
        sounds: gebi("ecmenu-sounds"),
        masterSpacer: gebi("ecmenu-master-spacer"),
        mute: gebi("ecmenu-mute"),
        camera: gebi("ecmenu-camera"),
        shareScreen: gebi("ecmenu-share-screen"),
        main: gebi("ecmenu-main"),
        chat: gebi("ecmenu-chat"),
        videoPopout: gebi("ecmenu-video-popout")
    };

    ui.panels.mobile = {
        wrapper: gebi("ecmobile-join"),
        button: gebi("ecmobile-join-b")
    };

    const m = ui.panels.main = {
        wrapper: gebi("ecmenu"),
        modeHider: gebi("ecview-mode-hider"),
        modeS: gebi("ecview-mode"),
        captionHider: gebi("eccaption-hider"),
        captionC: gebi("eccaption"),
        inputB: gebi("ecmenu-input-devices"),
        outputB: gebi("ecmenu-output-devices"),
        videoB: gebi("ecmenu-video-devices"),
        userListB: gebi("ecmenu-user-list"),
        debug: gebi("ecmenu-debug")
    };

    function btn(b: HTMLButtonElement, p: string, a: string) {
        b.onclick = function() {
            uiFE.showPanel(p, a);
        };
    }

    p.mute.onclick = function() { audio.toggleMute(); };
    btn(p.master, "master", "startStopB");
    btn(p.userAdmin, "userAdmin", "allB");
    btn(p.sounds, "soundboard", null);
    btn(p.main, "main", "inputB");
    p.chat.onclick = function() {
        const chat = ui.chat.wrapper;
        if (chat.style.display === "none") {
            chat.style.display = "";
            ui.chat.outgoing.focus();
        } else {
            chat.style.display = "none";
        }
        uiFE.resizeUI();
    };
    btn(m.inputB, "inputConfig", null);
    btn(m.outputB, "outputConfig", null);
    if (!config.useRTC) m.outputB.style.display = "none";
    btn(m.videoB, "videoConfig", null);
    btn(m.userListB, "userList", null);
    if (!config.useRTC && !("master" in config.config))
        m.userListB.style.display = "none";
    btn(m.debug, "debug", null);
    if (!config.useDebug)
        m.debug.style.display = "none";

    // Auto-hide the persistent menu
    uiFE.mouseenter();
    document.body.addEventListener("mouseenter", uiFE.mouseenter);
    document.body.addEventListener("mousemove", uiFE.mouseenter);
    Array.prototype.slice.call(document.getElementsByClassName("interface"), 0).forEach(function(el: HTMLElement) {
        el.onfocus = uiFE.mouseenter;
    });

    // Support for popping out the entire video block
    let w: WindowProxy = null;
    function popoutOpen() {
        w = ui.video.window = window.open("", "", "width=1280,height=720,menubar=0,toolbar=0,location=0,personalbar=0,status=0");
        if (!w) return;

        w.document.title = "Video — " + document.title;

        // To make it flex properly, it needs the CSS
        const ssurl = new URL(<any> window.location);
        ssurl.search = "?v=6";
        // eslint-disable-next-line no-useless-escape
        ssurl.pathname = ssurl.pathname.replace(/\/[^\/]*$/, "/ennuicastr2.css");
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
        ui.wave.wrapper.style.flex = "auto";

        // Play them
        for (let vi = 0; vi < ui.video.users.length; vi++) {
            const v = ui.video.users[vi];
            if (!v) continue;
            v.video.play().catch(console.error);
        }

        setTimeout(function() {
            uiFE.updateVideoUI(0);
            uiFE.resizeUI();
        }, 0);
    }

    function popoutClose() {
        w = ui.video.window = null;
        document.head.appendChild(ui.video.css);
        ui.wrapper.insertBefore(ui.video.wrapper, ui.wrapper.childNodes[0]);
        ui.wave.wrapper.style.flex = "";

        // Play them
        for (let vi = 0; vi < ui.video.users.length; vi++) {
            const v = ui.video.users[vi];
            if (!v) continue;
            v.video.play().catch(console.error);
        }

        setTimeout(function() {
            uiFE.updateVideoUI(0);
            uiFE.resizeUI();
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
    ui.panels.master = {
        wrapper: gebi("ecmaster-interface"),
        mainPopout: gebi("ecmaster-main-popout"),
        mainPopoutWrapper: gebi("ecmaster-main-popout-wrapper"),
        mainPopoutDock: gebi("ecmaster-main-popout-dock"),
        mainDock: gebi("ecmaster-main-dock"),
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
        acceptRemoteVideo: gebi("ecmaster-video-record-host"),
        saveVideoInBrowser: gebi("ecmaster-video-save-in-browser"),
        downloadVideoLive: gebi("ecmaster-video-download-live"),
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
        echo: gebi("ecuser-admin-echo"),
        reqFull: gebi("ecuser-admin-request-full")
    };

    ui.panels.userAdminFull = {
        wrapper: gebi("ecuser-admin-interface-user-full"),
        user: -1,
        name: gebi("ecuser-admin-interface-user-full-name"),
        kick: gebi("ecuser-admin-full-kick"),
        mute: gebi("ecuser-admin-full-mute"),
        echo: gebi("ecuser-admin-full-echo"),
        audioInput: gebi("ecuser-admin-full-audio-dev"),
        videoHider: gebi("ecuser-admin-interface-user-full-video-hider"),
        videoInput: gebi("ecuser-admin-full-video-dev"),
        videoRes: gebi("ecuser-admin-full-video-res"),
        videoBR: gebi("ecuser-admin-full-video-record"),
        videoRec: gebi("ecuser-admin-full-video-record")
    };

    const req = ui.panels.userAdminReq = {
        wrapper: gebi("ecuser-admin-permission"),
        user: -1,
        name: gebi("ecuser-admin-permission-requester"),
        yes: gebi("ecuser-admin-permission-yes"),
        audio: gebi("ecuser-admin-permission-audio"),
        no: gebi("ecuser-admin-permission-no")
    };

    req.yes.onclick = function() {
        net.setAdminPerm(req.user, audio.deviceInfo, true, true);
        uiFE.showPanel(null, ui.persistent.main);
    };

    req.audio.onclick = function() {
        net.setAdminPerm(req.user, audio.deviceInfo, true, false);
        uiFE.showPanel(null, ui.persistent.main);
    };

    req.no.onclick = function() {
        net.setAdminPerm(req.user, audio.deviceInfo, false, false);
        uiFE.showPanel(null, ui.persistent.main);
    };
}

function loadSoundboard() {
    ui.panels.soundboard = {
        wrapper: gebi("ecsounds-wrapper"),
        popout: gebi("ecsounds-popout"),
        popoutWrapper: gebi("ecsounds-popout-wrapper"),
        dock: gebi("ecsounds-dock"),
        soundsWrapper: gebi("ecsounds"),
        sounds: {}
    };
}

function loadInputConfig() {
    const input = ui.panels.inputConfig = {
        wrapper: gebi("ecinput-device-wrapper"),
        device: gebi("ecinput-device-list"),
        ptt: gebi("ecpttb"),
        noiserHider: gebi("ecnoise-reduction-hider"),
        noiser: gebi("ecnoise-reduction"),
        echo: gebi("ececho-cancellation"),
        agcHider: gebi("ecagc-hider"),
        agc: gebi("ecagc")
    };

    if (!config.useRTC || config.useRecordOnly) {
        // Hide irrelevant options
        input.noiserHider.style.display = "none";
    }
}

function loadOutputConfig() {
    const output = ui.panels.outputConfig = {
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
    const vc = ui.panels.videoConfig = {
        wrapper: gebi("ecvideo-device-wrapper"),
        visible: false,
        onshow: <()=>void> null,
        onhide: <()=>void> null,
        preview: gebi("ecvideo-device-preview"),
        previewS: <MediaStream> null,
        previewV: <HTMLVideoElement> null,
        device: gebi("ecvideo-device-list"),
        shareB: gebi("ecvideo-share"),
        res: gebi("ecvideo-res"),
        outputHider: gebi("ecvideo-output-hider"),

        recording: {
            hider: gebi("ecvideo-record-hider"),
            record: gebi("ecvideo-record"),
            optHider: gebi("ecvideo-record-opt-hider"),
            remote: gebi("ecvideo-record-remote"),
            local: gebi("ecvideo-record-local"),
            manualBitrate: gebi("ecvideo-record-bitrate-sel"),
            bitrateHider: gebi("ecvideo-record-bitrate-hider"),
            bitrate: gebi("ecvideo-record-bitrate")
        },

        streamerModeHider: gebi("ecstreamer-mode-hider"),
        streamerMode: gebi("ecstreamer-mode")
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
        wrapper: gebi("ecuser-list-wrapper"),
        popout: gebi("ecuser-list-popout"),
        popoutWrapper: gebi("ecuser-list-popout-wrapper"),
        dock: gebi("ecuser-list-dock"),
        userList: gebi("ecuser-list"),
        users: []
    };
}

function loadDebug() {
    const debug = ui.panels.debug = {
        wrapper: gebi("ecdebug-wrapper"),
        input: gebi("ecdebug-input"),
        output: gebi("ecdebug-output")
    };

    const input = debug.input;
    const output = debug.output;

    input.value = "return ";

    input.onkeydown = function(ev: KeyboardEvent) {
        if (ev.key !== "Enter")
            return;

        try {
            const f = Function(
                "audio,config,log,master,net,util,video",
                input.value);
            const r = f(audio, config, log, master, net, util, video);

            let rs: string;
            try {
                rs = JSON.stringify(r);
            } catch (ex) {
                rs = "" + r;
            }

            output.innerText = rs;

        } catch (ex) {
            output.innerText = ex + "\n" + ex.stack;

        }
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
export function mkAudioUI(): string {
    const main = ui.panels.main,
        input = ui.panels.inputConfig,
        output = ui.panels.outputConfig,
        videoConfig = ui.panels.videoConfig;

    /********************
     * INPUT CONFIGURATION
     *******************/
    function inputChange() {
        uiFE.showPanel(null, ui.persistent.main);
        net.updateAdminPerm({audioDevice: input.device.value});
        audio.getMic(input.device.value);
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

    // Gamepad PTT configuration
    if (typeof Ennuiboard !== "undefined" && Ennuiboard.supported.gamepad)
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
        if (input.echo.checked) {
            log.pushStatus("echo-cancellation", "WARNING: Digital echo cancellation is usually effective in cancelling echo, but will SEVERELY impact the quality of your audio. If possible, find a way to reduce echo physically.");
            setTimeout(function() {
                log.popStatus("echo-cancellation");
            }, 10000);
        }
        uiFE.showPanel(null, ui.persistent.main);
        audio.setEchoCancel(input.echo.checked);
    });
    uiFE.saveConfigCheckbox(input.agc, "agc3", inputChange);


    /********************
     * OUTPUT CONFIGURATION
     *******************/

    // Add a pseudo-device so nothing is selected at first
    let opt = dce("option");
    opt.innerText = "-";
    opt.value = "-none";
    output.device.appendChild(opt);

    function outputChange() {
        if (output.device.value === "-none") return;
        uiFE.showPanel(null, ui.persistent.main);

        const v = output.device.value;

        // Set the main audio output
        if (ui.audioOutput) {
            try {
                (<any> ui.audioOutput).setSinkId(v).catch(console.error);
            } catch (ex) {}
        } else {
            // Just try again
            setTimeout(outputChange, 100);
            return;
        }

        // And all the sounds
        // FIXME: soundboard sounds
        try {
            (<any> ui.sounds.chimeUp).setSinkId(v).catch(console.error);
            (<any> ui.sounds.chimeDown).setSinkId(v).catch(console.error);
        } catch (ex) {}
    }

    // Fill it with the available devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
        let ctr = 1;
        devices.forEach(function(dev) {
            if (dev.kind !== "audiooutput") return;

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

    outproc.setGlobalGain((+output.volume.value) / 100);

    // SFX volume
    function sfxVolumeChange() {
        const vol = output.sfxVolume;
        output.sfxVolumeStatus.innerHTML = "&nbsp;" + vol.value + "%";

        const v = (+vol.value) / 100;

        for (const url in ui.sounds.soundboard) {
            const sound = ui.sounds.soundboard[url];
            sound.el.volume = v;
        }

        ui.sounds.chimeUp.volume = v;
        ui.sounds.chimeDown.volume = v;
    }

    uiFE.saveConfigSlider(output.sfxVolume, "volume-sfx3", sfxVolumeChange);
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
            shareB.innerHTML = '<i class="fas fa-video-slash"></i> Unshare your camera';
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
            shareB.innerHTML = '<i class="fas fa-video"></i> Share your camera';
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

    // View mode (FIXME: doesn't belong here)
    function viewModeChange(ev: Event) {
        // Set the view
        const mode = ui.video.mode = +main.modeS.value;
        const smode = ["normal", "small", "gallery", "studio"][mode] || "";
        document.body.setAttribute("data-view-mode", smode);

        // Reset UI elements
        ui.video.selected = ui.video.major = -1;
        ui.video.css.innerHTML = "";
        if (mode === uiFE.ViewMode.Small)
            ui.wrapper.insertBefore(ui.dock, ui.log.wrapper);
        else
            ui.wrapper.insertBefore(ui.dock, ui.wave.wrapper);
        if (ev)
            uiFE.showPanel(null, ui.persistent.main);

        // And update other components
        uiFE.updateVideoUI(0);
        outproc.setWaveviewing(mode === uiFE.ViewMode.Studio);
    }

    if (config.useRTC) {
        // Voice chat, so have different view modes
        if (config.useRecordOnly) {
            // Record only, so default to small or studio
            if ("master" in config.config) {
                main.modeS.value = "3"; // studio
            } else {
                main.modeS.value = "1"; // small
            }

            uiFE.saveConfigValue(main.modeS, "view-mode-record-only", viewModeChange);

        } else {
            // Default is normal
            uiFE.saveConfigValue(main.modeS, "view-mode", viewModeChange);

        }

        viewModeChange(null);

    } else {
        main.modeHider.style.display = "none";
        videoConfig.outputHider.style.display = "none";
        main.modeS.value = "" + uiFE.ViewMode.Small;
        viewModeChange(null);

    }

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
            log.pushStatus("chrome", "Browser chrome: " + (window.outerWidth-window.innerWidth) + "x" + (window.outerHeight-window.innerHeight));
            setTimeout(function() {
                log.popStatus("chrome");
            }, 10000);
        }

        if (ev)
            uiFE.showPanel(null, ui.persistent.main);
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

// Configure a panel for popping in or out
function poppable(popout: HTMLElement, button: HTMLButtonElement,
                  panelButton: HTMLButtonElement, name: string,
                  panel: HTMLElement, dock: HTMLElement, opts: any = {}) {
    let cur = false;
    button.onclick = function() {
        // Swap the state
        cur = !cur;

        // Set up ARIA
        if (cur) {
            popout.setAttribute("role", "dialog");
            popout.setAttribute("aria-label", popout.getAttribute("data-popout-label"));
        } else {
            popout.removeAttribute("role");
            popout.removeAttribute("aria-label");
        }

        // Put it either in the dock or the panel
        (cur?dock:panel).appendChild(popout);

        // Perhaps hide the panel button
        if (panelButton)
            panelButton.style.display = cur?"none":"";

        // UI
        if (cur)
            uiFE.showPanel(null, ui.persistent.main);
        else
            ui.persistent.main.focus();
        uiFE.resizeUI();

        // Remember the setting
        localStorage.setItem(name, cur?"1":"0");
    };

    const saved = localStorage.getItem(name);
    if ((saved !== null && !!~~saved) ||
        (saved === null && opts && opts.defaultOut))
        button.onclick(null);
}

// Update the mute button when the mute state changes
util.events.addEventListener("audio.mute", function() {
    const muteB = ui.persistent.mute;
    if (audio.userMedia.getAudioTracks()[0].enabled) {
        // It's unmuted
        muteB.innerHTML = '<i class="fas fa-microphone-alt" style="width: 1em;"></i><span class="menu-extra">Mute</span>';
        muteB.setAttribute("aria-label", "Mute");

    } else {
        // It's muted
        muteB.innerHTML = '<i class="fas fa-microphone-alt-slash" style="width: 1em;"></i><span class="menu-extra">Unmute</span>';
        muteB.setAttribute("aria-label", "Unmute");

    }
});
