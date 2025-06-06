/*
 * Copyright (c) 2020-2024 Yahweasel
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
 * Support for master (host) users.
 */

import * as barrierPromise from "./barrier-promise";
import * as comm from "./comm";
import * as config from "./config";
import * as fileStorage from "./file-storage";
import globalConfig from "../config/config.json";
import * as log from "./log";
import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import { dce } from "./util";

import * as nlf from "nonlocal-forage";
import type * as localforageT from "localforage";

declare let localforage: typeof localforageT;

// Credit information
const credits = {
    creditCost: <{currency: number, credits: number}> null,
    creditRate: <[number, number]> null
};

export const users = <{
    name: string,
    online: boolean,
    transmitting: boolean,
    fullAccess: any
}[]> [];

// Our mapping if sound IDs to sounds
const sounds = {
    url2sid: <Record<string, string>> {}
};

// Hide the master interface, for non-host users
export function hideMasterInterface(): void {
    document.body.setAttribute("data-ec3-host", "no");
    const mainMenu = ui.ui.mainMenu;
    const hostPanel = ui.ui.panels.host;
    for (const b of [mainMenu.host, mainMenu.userAdmin, mainMenu.sounds])
        b.style.display = "none";
    for (const b of (<HTMLElement[]> hostPanel.startB).concat(
        [hostPanel.stopHider]).concat(
        hostPanel.pauseB).concat(
        hostPanel.resumeB).concat(
        hostPanel.stopB).concat(
        [ui.ui.panels.invite.button]))
        b.style.display = "none";
}

// Set up the master interface
export function createMasterInterface(): void {
    const inviteUI = ui.ui.panels.invite;
    const masterUI = ui.ui.panels.host;

    const mainMenu = ui.ui.mainMenu;

    document.body.setAttribute("data-ec3-host", "yes");

    // Assume no soundboard until told otherwise
    ui.ui.mainMenu.sounds.style.display = "none";

    // Invite options
    if ((config.config.format&prot.flags.dataTypeMask) === prot.flags.dataType.flac)
        inviteUI.flac.checked = true;
    else
        inviteUI.flacHider.style.display = "none";
    if (config.config.format & config.features.continuous)
        inviteUI.continuous.checked = true;
    else
        inviteUI.continuousHider.style.display = "none";
    inviteUI.flac.onchange = inviteUI.continuous.onchange = genInvite;
    inviteUI.copyB.onclick = copyInvite;
    genInvite();
    masterUI.inviteB.onclick = () =>
        ui.showPanel(inviteUI, inviteUI.copyB);

    // User admin
    updateMasterAdmin();
    ui.ui.panels.userAdmin.allB.onclick = function() { userAdmin(-1); };

    // Accept remote recordings
    masterUI.acceptRemoteVideo.checked =
        config.useVideoRec;
    masterUI.downloadVideoLive.checked = false;
    ui.saveConfigCheckbox(masterUI.acceptRemoteVideo,
        "master-video-record-host-" + config.useVideoRec,
        acceptRemoteVideoChange);
    ui.saveConfigCheckbox(masterUI.downloadVideoLive,
        "master-video-download-live2-" + config.useVideoRec);

    // Possibly cloud save
    masterUI.saveVideoInCloud.checked = false;
    ui.saveConfigCheckbox(
        masterUI.saveVideoInCloud,
        "master-video-save-in-cloud2-" + config.useVideoRec,
        async ev => {
            await initCloudStorage({ignoreCookieProvider: true}).transientActivation.promise;
            if (ui.needTransientActivation()) {
                ui.transientActivation(
                    "Log in",
                    '<i class="bx bx-log-in"></i> Log in',
                    {makeModal: true, force: true}
                );
            }
        }
    );

    // Possibly FSDH save
    masterUI.saveVideoInFSDH.checked = false;
    if (!("showDirectoryPicker" in window) || !nlf.fsdhLocalForage._support) {
        masterUI.saveVideoInFSDHHider.style.display = "none";
    } else {
        ui.saveConfigCheckbox(
            masterUI.saveVideoInFSDH,
            "master-video-save-in-fsdh2-" + config.useVideoRec,
            async ev => {
                await initFSDHStorage({ignoreCookieDir: true}).transientActivation.promise;
                if (ui.needTransientActivation()) {
                    ui.transientActivation(
                        "Choose directory",
                        '<i class="bx bx-folder-open"></i> Choose directory',
                        {force: true}
                    );
                }
            }
        );
    }

    // If we're accepting guest recording, we have to save it *somewhere*
    if (masterUI.acceptRemoteVideo.checked &&
        !masterUI.saveVideoInCloud.checked &&
        !masterUI.saveVideoInFSDH.checked &&
        !masterUI.downloadVideoLive.checked) {
        masterUI.saveVideoInCloud.checked = true;
    }

    // Put everything in the proper state
    configureMasterInterface();

    // Update the interface when our mode changes
    util.events.addEventListener("net.info." + prot.info.mode, function() {
        configureMasterInterface();
    });

    // We update the state of the sound button whenever a sound starts or stops
    util.events.addEventListener("audio.sound", function(ev: CustomEvent) {
        soundButtonUpdate(ev.detail.url, ev.detail.status, ev.detail.el);
    });

    // Messages from the master socket
    util.netEvent("master", "info", function(ev) {
        const msg: DataView = ev.detail;
        const p = prot.parts.info;
        const key = msg.getUint32(p.key, true);
        let val = 0;
        if (msg.byteLength >= p.length)
            val = msg.getUint32(p.value, true);
        switch (key) {
            case prot.info.creditCost:
            {
                // Informing us of the cost of credits
                const v2 = msg.getUint32(p.value + 4, true);
                credits.creditCost = {
                    currency: val,
                    credits: v2
                };
                break;
            }

            case prot.info.creditRate:
            {
                // Informing us of the total cost and rate in credits
                const v2 = msg.getUint32(p.value + 4, true);
                credits.creditRate = [val, v2];
                updateCreditCost();
                break;
            }

            case prot.info.sounds:
            {
                // Soundboard items
                const valS = util.decodeText(msg.buffer.slice(p.value));
                addSoundButtons(JSON.parse(valS));
                break;
            }

            case prot.info.allowAdmin:
            {
                // A user has allowed or disallowed us to administrate them
                if (msg.byteLength < p.length + 1) break;
                const allowed = !!msg.getUint8(p.length);
                let props = null;
                if (msg.byteLength > p.length + 1) {
                    try {
                        props = JSON.parse(util.decodeText(msg.buffer.slice(p.length + 1)));
                    } catch (ex) {}
                }
                allowAdmin(val, allowed, props);
                break;
            }

            case prot.info.adminState:
            {
                if (msg.byteLength <= p.length) break;
                let props = null;
                try {
                    props = JSON.parse(util.decodeText(msg.buffer.slice(p.length)));
                } catch (ex) {}
                if (!props || typeof props !== "object") break;
                updateAdmin(val, props);
                break;
            }
        }
    });

    util.netEvent("master", "user", function(ev) {
        const msg: DataView = ev.detail;
        const p = prot.parts.user;
        const index = msg.getUint32(p.index, true);
        const status = msg.getUint32(p.status, true);
        const nick = util.decodeText(msg.buffer.slice(p.nick));

        // Add it to the UI
        if (status) {
            ui.userListAdd(index, nick, true);

            while (users.length <= index)
                users.push(null);
            users[index] = {
                name: nick,
                online: true,
                transmitting: false,
                fullAccess: null
            };
            updateMasterAdmin();

        } else {
            ui.userListRemove(index, true);

            if (users[index]) {
                users[index].online = false;
                users[index].fullAccess = null;
                updateMasterAdmin();
            }

        }
    });

    util.netEvent("master", "speech", function(ev) {
        // Master "speech" is really data-receive
        const msg: DataView = ev.detail;
        const p = prot.parts.speech;
        const indexStatus = msg.getUint32(p.indexStatus, true);
        const index = indexStatus>>>1;
        const status = !!(indexStatus&1);
        ui.userListUpdate(index, status, true);
        if (users[index]) {
            users[index].transmitting = status;
            updateMasterAdmin();
        }
    });
}

// (Re)configure the master interface
function configureMasterInterface() {
    const masterUI = ui.ui.panels.host;

    for (const b of
         masterUI.startB
         .concat(masterUI.pauseB)
         .concat(masterUI.resumeB)
         .concat(masterUI.stopB))
        b.style.display = "none";
    masterUI.stopHider.style.display = "none";
    masterUI.sureHider.style.display = "none";

    // Start/stop button
    if (net.mode < prot.mode.rec) {
        for (const b of masterUI.startB) {
            b.style.display = "";
            b.disabled = false;
            b.onclick = startRecording;
        }

    } else if (net.mode === prot.mode.rec ||
               net.mode === prot.mode.paused) {
        for (const b of masterUI.stopB) {
            b.style.display = "";
            b.disabled = false;
            b.onclick = stopRecording;
        }
        masterUI.stopHider.style.display = "";
        if (net.mode === prot.mode.rec) {
            for (const b of masterUI.pauseB) {
                b.style.display = "";
                b.disabled = false;
                b.onclick = pauseRecording;
            }
        } else {
            for (const b of masterUI.resumeB) {
                b.style.display = "";
                b.disabled = false;
                b.onclick = resumeRecording;
            }
        }

    } else {
        if (net.mode === prot.mode.buffering)
            log.pushStatus("host-buffering", "Waiting for audio from clients...");
        else
            log.popStatus("host-buffering");

    }

    updateCreditCost();
}


// Generic "send this mode change" function
function sendMode(mode: number) {
    const p = prot.parts.mode;
    const out = new DataView(new ArrayBuffer(p.length));
    out.setUint32(0, prot.ids.mode, true);
    out.setUint32(p.mode, mode, true);
    net.masterSock.send(out.buffer);
}

// Start the recording (start button clicked)
function startRecording() {
    for (const b of ui.ui.panels.host.startB)
        b.disabled = true;
    sendMode(prot.mode.rec);
}

// Pause the recording
function pauseRecording() {
    for (const b of ui.ui.panels.host.pauseB)
        b.disabled = true;
    sendMode(prot.mode.paused);
}

// Resume a paused recording
function resumeRecording() {
    for (const b of ui.ui.panels.host.resumeB)
        b.disabled = true;
    sendMode(prot.mode.rec);
}

// Stop the recording (stop button clicked)
function stopRecording() {
    const masterUI = ui.ui.panels.host;
    for (const b of masterUI.stopB)
        b.disabled = true;

    masterUI.sureHider.style.display = "";
    masterUI.stopYesB.onclick = stopRecordingYes;
    masterUI.stopYesB.focus();
    masterUI.stopNoB.onclick = stopRecordingNo;
    ui.showPanel(masterUI, masterUI.stopYesB);
}

function stopRecordingYes() {
    ui.ui.panels.host.sureHider.style.display = "none";

    // Send out the stop request
    sendMode(prot.mode.finished);
}

function stopRecordingNo() {
    // Never mind!
    configureMasterInterface();
}

// Generate the invite link
function genInvite() {
    // Generate the search string
    const f = (
        (ui.ui.panels.invite.continuous.checked?config.features.continuous:0) +
        ((config.config.format&config.features.rtc)?config.features.rtc:0) +
        (config.useRecordOnly?config.features.recordOnly:0) +
        (config.useVideoRec?config.features.videorec:0) +
        (config.useJitsi.audio?config.features.jitsiAudio:0) +
        (config.useRTEnnui.video?config.features.rtennuiVideo:0) +
        (config.useTranscription?config.features.transcription:0) +
        (config.useDualECDefault?0:config.features.nonDualEC) +
        (ui.ui.panels.invite.flac.checked?prot.flags.dataType.flac:0)
    );
    let sb = "?" + config.iconfig.id.toString(36) + "-" + config.iconfig.key.toString(36);
    if (config.iconfig.port)
        sb += "-p" + config.config.port.toString(36);
    if (f !== 0)
        sb += "-f" + f.toString(36);

    // Make the URL
    const url = new URL(
        globalConfig.invite
            ? globalConfig.invite
            : config.url.toString()
    );
    url.search = sb;
    ui.ui.panels.invite.link.value = url.toString();
}

// Copy the invite link
function copyInvite() {
    ui.ui.panels.invite.link.select();
    document.execCommand("copy");

    log.pushStatus("invite", "Copied invite link", {
        timeout: 3000
    });
}

// Update the credit cost/rate meter
function updateCreditCost() {
    const masterUI = ui.ui.panels.host;
    if (!credits.creditCost || !credits.creditRate)
        return;
    const cc = credits.creditCost;
    const cr = credits.creditRate;
    if (net.mode === prot.mode.rec)
        cr[0] += cr[1]; // Report the *next* minute so you're not surprised
    masterUI.recordingCost.value = creditsToDollars(cr[0], cc);
    masterUI.recordingRate.value = creditsToDollars(cr[1]*60, cc) + "/hour";
}

// Convert a number of credits to dollars and cents
function creditsToDollars(c: number, creditCost: {currency: number, credits: number}) {
    c = Math.ceil(c * creditCost.currency / creditCost.credits);

    // Trivial cases
    if (c === 0)
        return "-";
    else if (c < 100)
        return c + "¢";

    const d = Math.floor(c / 100);
    let ce = (c % 100)+"";
    if (ce === "0") {
        return "$" + d;
    } else {
        if (ce.length === 1) ce = "0" + ce;
        return "$" + d + "." + ce;
    }
}

// Update the administrative interface for the master
export function updateMasterAdmin(): void {
    const userAdminP = ui.ui.panels.userAdmin;
    const bs = userAdminP.buttons;

    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        if (!u) continue;

        let b: HTMLButtonElement;
        if (!bs[i]) {
            // Create a button for this user
            b = bs[i] = dce("button");
            b.classList.add("pill-button");
            b.classList.add("row");
            b.innerText = u.name;
            b.onclick = (function(i) {
                return function() { userAdmin(i); }
            })(i);
            userAdminP.wrapper.appendChild(b);
        }
        b = bs[i];

        // Update it for their status
        if (u.online) {
            b.classList.remove("off");
            b.disabled = false;
        } else {
            b.classList.add("off");
            b.disabled = true;
        }
    }

    // FIXME: Update for user status
}

// Display the interface to perform administration on this user
export function userAdmin(target: number): void {
    const user = users[target] || null;
    const fullAccess = user ? user.fullAccess : null;
    const userAdminFull = ui.ui.panels.userAdminFull;
    const userAdminUser = fullAccess ? userAdminFull : ui.ui.panels.userAdminUser;
    const acts = prot.flags.admin.actions;
    userAdminUser.user = target;

    if (target >= 0) {
        userAdminUser.name.innerText = user ? user.name : "";
        userAdminUser.kick.style.display = "";
    } else {
        userAdminUser.name.innerHTML = '<i class="bx bx-group"></i> All users';
        userAdminUser.kick.style.display = "none";
    }

    // Actions
    userAdminUser.kick.onclick = function() { adminAction(target, acts.kick); };

    if (fullAccess) {
        // Mute
        userAdminFull.mute.onchange = function() {
            userAdminFull.mute.disabled = true;
            if (userAdminFull.mute.checked)
                adminAction(target, acts.mute);
            else
                adminAction(target, acts.unmute);
            fullAccess.mute = userAdminFull.mute.checked;
        };
        userAdminFull.mute.checked = fullAccess.mute;
        userAdminFull.mute.disabled = false;

        // Echo cancellation
        userAdminFull.echo.onchange = function() {
            userAdminFull.echo.disabled = true;
            if (userAdminFull.echo.checked)
                adminAction(target, acts.echoCancel);
            else
                adminAction(target, acts.unechoCancel);
            fullAccess.echo = userAdminFull.echo.checked;
        };
        userAdminFull.echo.checked = fullAccess.echo;
        userAdminFull.echo.disabled = false;

        // VAD sensitivity
        userAdminFull.vadSensitivity.onchange = function() {
            adminAction(target, acts.vadSensitivity, {
                arg: +userAdminFull.vadSensitivity.value
            });
            fullAccess.vadSensitivity = +userAdminFull.vadSensitivity.value;
        };
        userAdminFull.vadSensitivity.oninput = function() {
            userAdminFull.vadSensitivityStatus.innerHTML =
                "&nbsp;" + userAdminFull.vadSensitivity.value;
        };
        userAdminFull.vadSensitivity.value = fullAccess.vadSensitivity;
        userAdminFull.vadSensitivity.oninput(null);

        // VAD noise gate
        userAdminFull.vadNoiseGate.onchange = function() {
            adminAction(target, acts.vadNoiseGate, {
                arg: +userAdminFull.vadNoiseGate.value
            });
            fullAccess.vadNoiseGate = +userAdminFull.vadNoiseGate.value;
        };
        userAdminFull.vadNoiseGate.oninput = function() {
            userAdminFull.vadNoiseGateStatus.innerHTML =
                "&nbsp;" + userAdminFull.vadNoiseGate.value + "dB";
        };
        userAdminFull.vadNoiseGate.value = fullAccess.vadNoiseGate;
        userAdminFull.vadNoiseGate.oninput(null);
        userAdminFull.vadNoiseGate.className = "ecpeak-horizontal-" + target;


        // Audio input device
        const audioInput = userAdminFull.audioInput;
        audioInput.onchange = function() {
            audioInput.disabled = true;
            adminAction(target, acts.audioInput, {arg: audioInput.value});
        };
        audioInput.disabled = false;

        // Add the devices
        audioInput.innerHTML = "";
        try {
            for (const dev of fullAccess.audioDevices) {
                const el = dce("option");
                el.value = dev.id;
                el.innerText = dev.label;
                audioInput.appendChild(el);
            }
            audioInput.value = fullAccess.audioDevice;
        } catch (ex) {}


        // Shall we handle video at all?
        if (!fullAccess.videoDevices) {
            userAdminFull.videoHider.style.display = "none";

        } else {
            userAdminFull.videoHider.style.display = "";

            // Video input device
            const videoInput = userAdminFull.videoInput;
            videoInput.onchange = function() {
                videoInput.disabled = true;
                adminAction(target, acts.videoInput, {arg: videoInput.value});
            };
            videoInput.disabled = false;

            // Add the devices
            videoInput.innerHTML = "";
            const el = dce("option");
            el.value = "-none";
            el.innerText = "-";
            videoInput.appendChild(el);
            try {
                for (const dev of fullAccess.videoDevices) {
                    const el = dce("option");
                    el.value = dev.id;
                    el.innerText = dev.label;
                    videoInput.appendChild(el);
                }
                videoInput.value = fullAccess.videoDevice;
            } catch (ex) {}


            // Video resolution
            const videoRes = userAdminFull.videoRes;
            videoRes.onchange = function() {
                videoRes.disabled = true;
                adminAction(target, acts.videoRes, {arg: videoRes.value});
            };
            videoRes.value = fullAccess.videoRes;
            videoRes.disabled = false;

        }

    } else {
        userAdminUser.mute.onclick = function() { adminAction(target, prot.flags.admin.actions.mute); };
        userAdminUser.echo.onclick = function() { adminAction(target, prot.flags.admin.actions.echoCancel); };
        ui.ui.panels.userAdminUser.reqFull.onclick = function() {
            log.pushStatus("adminRequest", "Access requested...", {
                timeout: 3000
            });
            adminAction(target, prot.flags.admin.actions.request);
        };
    }
    ui.showPanel(userAdminUser);
}

ui.ui.masterUserAdmin = userAdmin;

// Add a soundboard button
function addSoundButton(sid: string, url: string, name: string) {
    const soundboard = ui.ui.panels.soundboard;

    if (sid in soundboard.sounds)
        return;
    sounds.url2sid[url] = sid;

    // Make the button
    const b = soundboard.sounds[sid] = {
        b: dce("button"),
        i: dce("i"),
        n: dce("span")
    };
    b.b.classList.add("pill-button");
    b.b.classList.add("nouppercase");
    b.b.id = "ec-sound-" + sid;
    b.i.classList.add("bx");
    b.i.classList.add("bx-play");
    b.b.appendChild(b.i);
    b.n.innerText = " " + name;
    b.b.appendChild(b.n);

    const spacer = dce("span");
    spacer.innerHTML = "&nbsp;";

    b.b.onclick = function() {
        let play = true;
        if (url in ui.ui.sounds.soundboard)
            play = ui.ui.sounds.soundboard[url].el.paused;
        playStopSound(b.b, sid, play);
    };

    soundboard.soundsWrapper.appendChild(b.b);
    soundboard.soundsWrapper.appendChild(spacer);
    ui.ui.mainMenu.sounds.style.display = "";
}

// Add many soundboard buttons
function addSoundButtons(arr: {i: string, u: string, n: string}[]) {
    arr.forEach(function(s) {
        addSoundButton(s.i, s.u, s.n);
    });
}

// Request a sound be played or stopped
function playStopSound(b: HTMLButtonElement, sid: string, play: boolean) {
    b.disabled = true;
    b.classList.add("off");
    const p = prot.parts.sound.cs;
    const sidBuf = util.encodeText(sid);
    const msg = new DataView(new ArrayBuffer(p.length + sidBuf.length));
    msg.setUint32(0, prot.ids.sound, true);
    msg.setUint8(p.status, play?1:0);
    new Uint8Array(msg.buffer).set(sidBuf, p.id);
    net.masterSock.send(msg);
}

// Update the state of a playback button
function soundButtonUpdate(url: string, play: unknown, el: HTMLAudioElement) {
    const soundboard = ui.ui.panels.soundboard;
    const sid = sounds.url2sid[url];
    if (!sid)
        return;
    const b = soundboard.sounds[sid];

    // Un-disable the button
    b.b.disabled = false;
    b.b.classList.remove("off");

    // And update the icon
    b.i.classList.remove("bx-play");
    b.i.classList.remove("bx-stop");
    b.i.classList.add(play?"bx-stop":"bx-play");

    if (play) {
        el.addEventListener("ended", function() {
            soundButtonUpdate(url, false, el);
        }, {once: true});
    }
}

// Admin actions
function adminAction(target: number, action: number, opts?: any) {
    // Optional argument
    opts = opts || {};
    const arg = opts.arg || null;
    let argBuf: Uint8Array = null;
    if (typeof arg === "string") {
        argBuf = util.encodeText(arg);
    } else if (typeof arg === "number") {
        argBuf = new Uint8Array(4);
        (new Int32Array(argBuf.buffer))[0] = arg;
    } else {
        argBuf = new Uint8Array(0);
    }

    // Admin command
    const p = prot.parts.admin;
    const out = new DataView(new ArrayBuffer(p.length + argBuf.length));
    out.setUint32(0, prot.ids.admin, true);
    out.setUint32(p.target, target, true);
    out.setUint32(p.action, action, true);
    (new Uint8Array(out.buffer)).set(argBuf, p.argument);
    net.masterSock.send(out.buffer);
}

// The change handler for accepting remote video
function acceptRemoteVideoChange() {
    const arv = ui.ui.panels.host.acceptRemoteVideo;
    localStorage.setItem("ecmaster-video-record-host", JSON.stringify(arv.checked));
    comm.comms.videoRec.videoRecSend(
        void 0, prot.videoRec.videoRecHost, ~~arv.checked);
}

// Allow or disallow admin access for this user
function allowAdmin(target: number, allowed: boolean, props: any) {
    if (!users[target]) return;
    const user = users[target];
    const name = user.name || "Anonymous";
    if (allowed) {
        user.fullAccess = props;
        log.pushStatus(
            "allowAdmin",
            "User " + util.escape(name) + " has allowed admin access.", {
            timeout: 5000
        });
    } else {
        user.fullAccess = null;
        log.pushStatus(
            "allowAdmin",
            "User " + util.escape(name) + " has disallowed admin access.", {
                timeout: 5000
        });
    }
}

// Update admin information for this user
function updateAdmin(target: number, props: any) {
    if (!users[target]) return;
    const user = users[target];
    if (!user.fullAccess) return;

    // Update the info in the structure
    [
        "audioDevices",
        "audioDevice",
        "videoDevices",
        "videoDevice",
        "videoRes",
        "videoRec",
        "mute",
        "echo"
    ].forEach(prop => {
        if (!(prop in props)) return;
        user.fullAccess[prop] = props[prop];
    });

    // And the UI
    const userAdminFull = ui.ui.panels.userAdminFull;
    if (userAdminFull.user === target) {
        if ("mute" in props) {
            userAdminFull.mute.checked = props.mute;
            userAdminFull.mute.disabled = false;
        }

        if ("echo" in props) {
            userAdminFull.echo.checked = props.echo;
            userAdminFull.echo.disabled = false;
        }

        if ("audioDevice" in props) {
            userAdminFull.audioInput.value = props.audioDevice;
            userAdminFull.audioInput.disabled = false;
        }

        if ("videoDevice" in props) {
            userAdminFull.videoInput.value = props.videoDevice;
            userAdminFull.videoInput.disabled = false;
        }

        if ("videoRes" in props) {
            userAdminFull.videoRes.value = props.videoRes;
            userAdminFull.videoRes.disabled = false;
        }

    }
}


/**
 * Initialize cloud storage based on the current state of the UI and cookies.
 * Returns a promise that is fulfilled when transient activation is needed (if
 * it is to be needed).
 * @param opts  Options to, e.g., ignore settings in the cookies
 */
export function initCloudStorage(opts: {
    /**
     * Ignore the saved provider and request it again.
     */
    ignoreCookieProvider?: boolean,

    /**
     * Show description (for initial dialog).
     */
    showDesc?: boolean,

    /**
     * Show the local directory option.
     */
    showFSDH?: boolean
} = {}): {
    transientActivation: barrierPromise.BarrierPromise,
    completion: barrierPromise.BarrierPromise
} {
    const ret = {
        transientActivation: new barrierPromise.BarrierPromise(),
        completion: new barrierPromise.BarrierPromise()
    };
    const masterUI = ui.ui.panels.host;

    // Perform the actual loading in the background
    go();
    return ret;

    async function go() {
        let webDAVInfo: {
            username: string, password: string, server: string
        } | null = null;

        // We change the label based on the actual usage
        masterUI.saveVideoInCloudLbl.innerHTML = "&nbsp;Save video recordings in cloud storage";

        if (!masterUI.saveVideoInCloud.checked) {
            fileStorage.clearRemoteFileStorage();
            localStorage.removeItem("master-video-save-in-cloud-provider");
            ret.transientActivation.res();
            ret.completion.res();
            return;
        }

        let provider = localStorage.getItem("master-video-save-in-cloud-provider");
        if (!provider || opts.ignoreCookieProvider) {
            const csPanel = ui.ui.panels.cloudStorage;
            csPanel.desc.style.display = opts.showDesc ? "" : "none";
            provider = await new Promise(res => {
                csPanel.googleDrive.onclick = () => res("googleDrive");
                csPanel.dropbox.onclick = () => res("dropbox");
                csPanel.webdav.onclick = () => res("webDAV");
                csPanel.fsdh.style.display = opts.showFSDH ? "" : "none";
                csPanel.fsdh.onclick = () => res("fsdh");
                csPanel.cancel.onclick = () => res("cancel");
                csPanel.onhide = () => res("cancel");
                ui.showPanel(csPanel);
            });
            ui.showPanel(null);

            // FSDH isn't handled here
            if (provider === "fsdh") {
                provider = "cancel";
                masterUI.saveVideoInFSDH.checked = true;
                localStorage.setItem("master-video-save-in-fsdh-" + config.useVideoRec, "1");
            }

            // For WebDAV, we still need to get a username and password
            if (provider === "webDAV") {
                const wdp = ui.ui.panels.webdav;
                wdp.username.value =
                    wdp.password.value =
                    wdp.url.value = "";
                await new Promise<void>(res => {
                    wdp.form.onsubmit = wdp.login.onclick = (ev: Event) => {
                        if (wdp.username.value && wdp.password.value &&
                            wdp.url.value) {
                            webDAVInfo = {
                                username: wdp.username.value,
                                password: wdp.password.value,
                                server: wdp.url.value
                            };
                            res();
                        }
                        ev.preventDefault();
                        ev.stopPropagation();
                    };
                    wdp.onhide = res;
                    ui.showPanel(wdp, wdp.username);
                });
                ui.showPanel(null);

                if (webDAVInfo) {
                    localStorage.setItem("webdav-username", webDAVInfo.username);
                    localStorage.setItem("webdav-password", webDAVInfo.password);
                    localStorage.setItem("webdav-server", webDAVInfo.server);
                } else {
                    provider = "cancel";
                }
            }

            if (provider === "cancel") {
                localStorage.removeItem("master-video-save-in-cloud-provider");
                masterUI.saveVideoInCloud.checked = false;
                localStorage.setItem("master-video-save-in-cloud-" + config.useVideoRec, "0");
                fileStorage.clearRemoteFileStorage();
                ret.transientActivation.res();
                ret.completion.res();
                return;
            }
            localStorage.setItem("master-video-save-in-cloud-provider", provider);
        }

        // Handle WebDAV info
        if (provider === "webDAV" && !webDAVInfo) {
            webDAVInfo = {
                username: localStorage.getItem("webdav-username"),
                password: localStorage.getItem("webdav-password"),
                server: localStorage.getItem("webdav-server")
            };
        }

        let longName = provider;
        switch (provider) {
            case "googleDrive": longName = "Google Drive"; break;
            case "dropbox": longName = "Dropbox"; break;
            case "webDAV": longName = "ownCloud"; break;
        }

        try {
            const rfs = await fileStorage.getRemoteFileStorage({
                provider: <any> provider,
                webDAVInfo: webDAVInfo || void 0,
                transientActivation: async () => {
                    const p = ui.onTransientActivation(async () => {});
                    ui.forceTransientActivation();
                    ret.transientActivation.res();
                    await p;
                },
                lateTransientActivation: async () => {
                    await ui.transientActivation(
                        "Cloud login",
                        '<i class="bx bx-log-in"></i> Log in to continue using cloud storage',
                        {
                            makeModal: true,
                            force: true
                        }
                    );
                },
                cancellable: async () => {
                    await ui.transientActivation(
                        "Cancel cloud login",
                        '<i class="bx bx-log-out"></i> Cancel cloud login',
                        {
                            makeModal: true,
                            force: true
                        }
                    );
                },
                hideCancellable: () => {
                    ui.unsetModal();
                    ui.showPanel(null);
                },
                forcePrompt: !!opts.ignoreCookieProvider
            });
            masterUI.saveVideoInCloudLbl.innerHTML =
                `&nbsp;Save video recordings in ${longName}`;
            ret.transientActivation.res();
            ret.completion.res();
            rfs.clearExpired();

        } catch (ex) {
            log.pushStatus(
                "file-storage",
                "Failed to log in to cloud storage. Files will not be stored in the cloud!",
                {
                    timeout: 10000
                }
            );
            localStorage.removeItem("master-video-save-in-cloud-provider");
            masterUI.saveVideoInCloud.checked = false;
            localStorage.setItem(`master-video-save-in-cloud-${config.useVideoRec}`, "0");
            ret.transientActivation.res();
            ret.completion.res();

        }
    }
}

/**
 * Initialize FSDH (local directory) storage based on the current state of the
 * UI and cookies. Returns a promise that is fulfilled when transient
 * activation is needed (if it is to be needed).
 * @param opts  Options to, e.g., ignore settings in the cookies
 */
export function initFSDHStorage(opts: {
    /**
     * Ignore the saved directory and request it again.
     */
    ignoreCookieDir?: boolean
} = {}): {
    transientActivation: barrierPromise.BarrierPromise,
    completion: barrierPromise.BarrierPromise
} {
    const ret = {
        transientActivation: new barrierPromise.BarrierPromise(),
        completion: new barrierPromise.BarrierPromise()
    };

    go();
    return ret;

    async function go() {
        const masterUI = ui.ui.panels.host;

        // Load localforage
        await fileStorage.getLocalFileStorage();

        // Get somewhere to store the directory
        let dirStorage: typeof localforageT | null = null;
        try {
            dirStorage = await localforage.createInstance({
                driver: localforage.INDEXEDDB,
                name: "ennuicastr-fsdh-memory"
            });
            await dirStorage.ready();
            if (dirStorage.driver() !== localforage.INDEXEDDB)
                dirStorage = null;
        } catch (ex) {}

        // Unload if asked for
        if (!masterUI.saveVideoInFSDH.checked) {
            fileStorage.clearFSDHFileStorage();
            if (dirStorage)
                await dirStorage.removeItem("fsdh-dir");
            ret.transientActivation.res();
            ret.completion.res();
            return;
        }

        let dir: FileSystemDirectoryHandle | null = null;

        if (dirStorage && !opts.ignoreCookieDir)
            dir = await dirStorage.getItem("fsdh-dir");

        try {

            // Check if we have permission
            if (dir) {
                if (await (<any> dir).queryPermission({mode: "readwrite"}) !== "granted") {
                    {
                        const p = ui.onTransientActivation(async () => {});
                        ui.onTransientActivation(() => ret.completion.promise);
                        ret.transientActivation.res();
                        await p;
                    }
                    if (await (<any> dir).requestPermission({mode: "readwrite"}) !== "granted")
                        throw new Error();
                }
            }

            // Open a new directory
            if (!dir || opts.ignoreCookieDir) {
                // Start with generic transient activation
                {
                    const p = ui.onTransientActivation(async () => {});
                    ui.onTransientActivation(() => ret.completion.promise);
                    ui.forceTransientActivation();
                    ret.transientActivation.res();
                    await p;
                }
                while (!dir) {
                    // Request it
                    try {
                        dir = await (<any> window).showDirectoryPicker({
                            mode: "readwrite",
                            startIn: "documents"
                        });
                    } catch (ex) {
                        // Request refused
                        masterUI.saveVideoInFSDH.checked = false;
                        localStorage.setItem("master-video-save-in-fsdh-" + config.useVideoRec, "0");
                        log.pushStatus(
                            "fsdh",
                            "Failed to open local directory for storage!",
                            {timeout: 3000}
                        );
                        ret.completion.res();
                        return;
                    }

                    // Check that it's fresh and/or valid
                    let fresh = true;
                    let valid = false;
                    const it: AsyncIterator<string> = (<any> dir).keys();
                    while (true) {
                        const file = await it.next();
                        if (file.done) break;
                        fresh = false;
                        if (file.value === ".enncuicastr-storage")
                            valid = true;
                    }
                    if (fresh) {
                        // Put a marker so we know in the future that it's valid
                        await dir.getFileHandle(".enncuicastr-storage", {create: true});
                    } else if (!valid) {
                        // Retry
                        dir = null;
                        await ui.transientActivation(
                            "Choose directory",
                            '<i class="bx bx-folder-open"></i> Choose a new directory',
                            {makeModal: true, force: true}
                        );
                    }
                }

                if (dirStorage)
                    await dirStorage.setItem("fsdh-dir", dir);
            }

        } catch (ex) {
            console.error(ex);
            masterUI.saveVideoInFSDH.checked = false;
            localStorage.setItem("master-video-save-in-fsdh-" + config.useVideoRec, "0");
            fileStorage.clearFSDHFileStorage();
            log.pushStatus(
                "fsdh",
                "Failed to open local directory for storage!",
                {timeout: 10000}
            );
            ret.transientActivation.res();
            ret.completion.res();
            return;
        }

        // Initialize it
        const dfs = await fileStorage.getFSDHFileStorage(dir);
        ret.transientActivation.res();
        ret.completion.res();
        dfs.clearExpired();
    }
}
