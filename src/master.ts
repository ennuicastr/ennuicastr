/*
 * Copyright (c) 2020, 2021 Yahweasel
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
import * as jitsi from "./jitsi";
import * as log from "./log";
import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import { dce, gebi } from "./util";

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

// Set up the master interface
export function createMasterInterface() {
    var masterUI = ui.ui.panels.master;

    // Show the button
    ui.ui.persistent.masterHider.style.display = "";

    // Invite options
    if ((config.config.format&prot.flags.dataTypeMask) === prot.flags.dataType.flac)
        masterUI.inviteFLAC.checked = true;
    else
        masterUI.inviteFLACHider.style.display = "none";
    if (config.config.format & config.features.continuous)
        masterUI.inviteContinuous.checked = true;
    else
        masterUI.inviteContinuousHider.style.display = "none";
    masterUI.inviteFLAC.onchange = masterUI.inviteContinuous.onchange = genInvite;
    masterUI.inviteCopyB.onclick = copyInvite;
    genInvite();

    // User admin
    masterUI.userAdminB.onclick = function() { ui.showPanel("userAdmin", "allB"); };
    updateMasterAdmin();
    ui.ui.panels.userAdmin.allB.onclick = function() { userAdmin(-1); };

    // Accept remote recordings
    masterUI.acceptRemoteVideo.checked = config.useVideoRec;
    ui.saveConfigCheckbox(masterUI.acceptRemoteVideo, "master-video-record-host-" + config.useVideoRec, acceptRemoteVideoChange);

    // Put everything in the proper state
    configureMasterInterface();
}

// (Re)configure the master interface
function configureMasterInterface() {
    var masterUI = ui.ui.panels.master;

    var pauseResume = masterUI.pauseResumeB;
    var startStop = masterUI.startStopB;
    masterUI.yesNo.style.display = "none";

    // Start/stop button
    pauseResume.disabled = false;
    startStop.disabled = false;
    if (net.mode < prot.mode.rec) {
        pauseResume.style.display = "none";
        startStop.innerHTML = '<i class="fas fa-microphone-alt"></i> Start recording';
        startStop.onclick = startRecording;

    } else if (net.mode === prot.mode.rec ||
               net.mode === prot.mode.paused) {
        pauseResume.style.display = "";
        if (net.mode === prot.mode.rec) {
            pauseResume.innerHTML = '<i class="fas fa-pause"></i> Pause recording';
            pauseResume.onclick = pauseRecording;
        } else {
            pauseResume.innerHTML = '<i class="far fa-pause-circle"></i> Resume recording';
            pauseResume.onclick = resumeRecording;
        }
        startStop.innerHTML = '<i class="fas fa-stop"></i> Stop recording';
        startStop.onclick = stopRecording;

    } else {
        pauseResume.style.display = "none";
        if (net.mode === prot.mode.buffering)
            startStop.innerText = "Waiting for audio from clients...";
        else
            startStop.innerHTML = '<i class="fas fa-check"></i> Recording finished';
        startStop.onclick = function() {};
        startStop.disabled = true;

    }

    updateCreditCost();
    ui.resizeUI();
}

// Update the interface when our mode changes
if ("master" in config.config) {
    util.events.addEventListener("net.info." + prot.info.mode, function() {
        // Update the master interface
        configureMasterInterface();
    });
}


// Generic "send this mode change" function
function sendMode(mode: number) {
    var p = prot.parts.mode;
    var out = new DataView(new ArrayBuffer(p.length));
    out.setUint32(0, prot.ids.mode, true);
    out.setUint32(p.mode, mode, true);
    net.masterSock.send(out.buffer);
}

// Start the recording (start button clicked)
function startRecording() {
    ui.ui.panels.master.startStopB.disabled = true;
    sendMode(prot.mode.rec);
}

// Pause the recording
function pauseRecording() {
    ui.ui.panels.master.pauseResumeB.disabled = true;
    sendMode(prot.mode.paused);
}

// Resume a paused recording
function resumeRecording() {
    ui.ui.panels.master.pauseResumeB.disabled = true;
    sendMode(prot.mode.rec);
}

// Stop the recording (stop button clicked)
function stopRecording() {
    var startStop = ui.ui.panels.master.startStopB;

    startStop.disabled = true;
    startStop.innerText = "Are you sure?";

    ui.ui.panels.master.yesNo.style.display = "";
    ui.ui.panels.master.yesB.onclick = stopRecordingYes;
    ui.ui.panels.master.yesB.focus();
    ui.ui.panels.master.noB.onclick = stopRecordingNo;

    ui.resizeUI();
}

function stopRecordingYes() {
    ui.ui.panels.master.yesNo.style.display = "none";

    // Send out the stop request
    sendMode(prot.mode.finished);
    ui.resizeUI();
}

function stopRecordingNo() {
    // Never mind!
    configureMasterInterface();
}

// Generate the invite link
function genInvite() {
    // Generate the search string
    var f = (
        (ui.ui.panels.master.inviteContinuous.checked?config.features.continuous:0) +
        ((config.config.format&config.features.rtc)?config.features.rtc:0) +
        (ui.ui.panels.master.inviteFLAC.checked?prot.flags.dataType.flac:0)
    );
    var sb = "?" + config.config.id.toString(36) + "-" + config.config.key.toString(36);
    if (config.config.port !== 36678)
        sb += "-p" + config.config.port.toString(36);
    if (f !== 0)
        sb += "-f" + f.toString(36);

    // Make the URL
    var url = new URL(<any> config.url);
    url.search = sb;
    ui.ui.panels.master.inviteLink.value = url.toString();
}

// Copy the invite link
function copyInvite() {
    ui.ui.panels.master.inviteLink.select();
    document.execCommand("copy");

    log.pushStatus("invite", "Copied invite link");
    setTimeout(function() {
        log.popStatus("invite");
    }, 3000);
}

// Update the credit cost/rate meter
function updateCreditCost() {
    var masterUI = ui.ui.panels.master;
    if (!credits.creditCost || !credits.creditRate)
        return;
    var cc = credits.creditCost;
    var cr = credits.creditRate;
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

    var d = Math.floor(c / 100);
    var ce = (c % 100)+"";
    if (ce === "0") {
        return "$" + d;
    } else {
        if (ce.length === 1) ce = "0" + ce;
        return "$" + d + "." + ce;
    }
}

// Update the administrative interface for the master
export function updateMasterAdmin() {
    var userAdminP = ui.ui.panels.userAdmin;
    var bs = userAdminP.buttons;

    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (!u) continue;

        var b: HTMLButtonElement;
        if (!bs[i]) {
            // Create a button for this user
            b = bs[i] = dce("button");
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
export function userAdmin(target: number) {
    let user = users[target] || null;
    let fullAccess = user ? user.fullAccess : null;
    let userAdminFull = ui.ui.panels.userAdminFull;
    let userAdminUser = fullAccess ? userAdminFull : ui.ui.panels.userAdminUser;
    let acts = prot.flags.admin.actions;
    userAdminUser.user = target;

    if (target >= 0) {
        userAdminUser.name.innerText = user ? user.name : "";
        userAdminUser.kick.style.display = "";
    } else {
        userAdminUser.name.innerHTML = '<i class="fas fa-users"></i> All users';
        userAdminUser.kick.style.display = "none";
    }

    // Actions
    userAdminUser.kick.onclick = function() { adminAction(target, acts.kick); };

    if (fullAccess) {
        // Mute
        userAdminFull.mute.onchange = function() {
            userAdminFull.mute.disabled = true;
            if (userAdminFull.mute.checked)
                adminAction(target, acts.mute, {nohide: true});
            else
                adminAction(target, acts.unmute, {nohide: true});
        };
        userAdminFull.mute.checked = fullAccess.mute;
        userAdminFull.mute.disabled = false;

        // Echo cancellation
        userAdminFull.echo.onchange = function() {
            userAdminFull.echo.disabled = true;
            if (userAdminFull.echo.checked)
                adminAction(target, acts.echoCancel, {nohide: true});
            else
                adminAction(target, acts.unechoCancel, {nohide: true});
        };
        userAdminFull.echo.checked = fullAccess.mute;
        userAdminFull.echo.disabled = false;


        // Audio input device
        let audioInput = userAdminFull.audioInput;
        audioInput.onchange = function() {
            audioInput.disabled = true;
            adminAction(target, acts.audioInput, {nohide: true, arg: audioInput.value});
        };
        audioInput.disabled = false;

        // Add the devices
        audioInput.innerHTML = "";
        try {
            for (let dev of fullAccess.audioDevices) {
                let el = dce("option");
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
            let videoInput = userAdminFull.videoInput;
            videoInput.onchange = function() {
                videoInput.disabled = true;
                adminAction(target, acts.videoInput, {nohide: true, arg: videoInput.value});
            };
            videoInput.disabled = false;

            // Add the devices
            videoInput.innerHTML = "";
            let el = dce("option");
            el.value = "-none";
            el.innerText = "-";
            videoInput.appendChild(el);
            try {
                for (let dev of fullAccess.videoDevices) {
                    let el = dce("option");
                    el.value = dev.id;
                    el.innerText = dev.label;
                    videoInput.appendChild(el);
                }
                videoInput.value = fullAccess.videoDevice;
            } catch (ex) {}


            // Video resolution
            let videoRes = userAdminFull.videoRes;
            videoRes.onchange = function() {
                videoRes.disabled = true;
                adminAction(target, acts.videoRes, {nohide: true, arg: videoRes.value});
            };
            videoRes.value = fullAccess.videoRes;
            videoRes.disabled = false;

        }

    } else {
        userAdminUser.mute.onclick = function() { adminAction(target, prot.flags.admin.actions.mute); };
        userAdminUser.echo.onclick = function() { adminAction(target, prot.flags.admin.actions.echoCancel); };
        ui.ui.panels.userAdminUser.reqFull.onclick = function() {
            log.pushStatus("adminRequest", "Access requested...");
            setTimeout(function() {
                log.popStatus("adminRequest");
            }, 3000);
            adminAction(target, prot.flags.admin.actions.request);
            ui.showPanel(null, ui.ui.persistent.main);
        };
    }
    ui.showPanel(userAdminUser.wrapper, null);
}

ui.ui.masterUserAdmin = userAdmin;

// Add a soundboard button
function addSoundButton(sid: string, url: string, name: string) {
    var soundboard = ui.ui.panels.soundboard;

    if (sid in soundboard.sounds)
        return;
    sounds.url2sid[url] = sid;

    // Make the button
    var b = soundboard.sounds[sid] = {
        b: dce("button"),
        i: dce("i"),
        n: dce("span")
    };
    b.b.classList.add("nouppercase");
    b.b.id = "ec-sound-" + sid;
    b.i.classList.add("fas");
    b.i.classList.add("fa-play");
    b.b.appendChild(b.i);
    b.n.innerText = " " + name;
    b.b.appendChild(b.n);

    var spacer = dce("span");
    spacer.innerHTML = "&nbsp;";

    b.b.onclick = function() {
        var play = true;
        if (url in ui.ui.sounds.soundboard)
            play = ui.ui.sounds.soundboard[url].el.paused;
        playStopSound(b.b, sid, play);
    };

    soundboard.soundsWrapper.appendChild(b.b);
    soundboard.soundsWrapper.appendChild(spacer);
    ui.ui.persistent.soundsHider.style.display = "";
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
    var p = prot.parts.sound.cs;
    var sidBuf = util.encodeText(sid);
    var msg = new DataView(new ArrayBuffer(p.length + sidBuf.length));
    msg.setUint32(0, prot.ids.sound, true);
    msg.setUint8(p.status, play?1:0);
    new Uint8Array(msg.buffer).set(sidBuf, p.id);
    net.masterSock.send(msg);
}

// Update the state of a playback button
function soundButtonUpdate(url: string, play: unknown, el: HTMLAudioElement) {
    var soundboard = ui.ui.panels.soundboard;
    var sid = sounds.url2sid[url];
    if (!sid)
        return;
    var b = soundboard.sounds[sid];

    // Un-disable the button
    b.b.disabled = false;
    b.b.classList.remove("off");

    // And update the icon
    b.i.classList.remove("fa-play");
    b.i.classList.remove("fa-stop");
    b.i.classList.add(play?"fa-stop":"fa-play");

    if (play) {
        el.addEventListener("ended", function() {
            soundButtonUpdate(url, false, el);
        }, {once: true});
    }
}

// We update the state of the button whenever a sound starts or stops
if ("master" in config.config) {
    util.events.addEventListener("audio.sound", function(ev: CustomEvent) {
        soundButtonUpdate(ev.detail.url, ev.detail.status, ev.detail.el);
    });
}

// Admin actions
function adminAction(target: number, action: number, opts?: any) {
    // Optional argument
    let arg = (opts ? opts.arg : "") || "";
    let argBuf = util.encodeText(arg);

    // Admin command
    var p = prot.parts.admin;
    var out = new DataView(new ArrayBuffer(p.length + argBuf.length));
    out.setUint32(0, prot.ids.admin, true);
    out.setUint32(p.target, target, true);
    out.setUint32(p.action, action, true);
    (new Uint8Array(out.buffer)).set(argBuf, p.argument);
    net.masterSock.send(out.buffer);

    // Hide the admin action window
    if (!opts || !opts.nohide)
        ui.showPanel(null, ui.ui.persistent.main);
}

// The change handler for accepting remote video
function acceptRemoteVideoChange() {
    var arv = ui.ui.panels.master.acceptRemoteVideo;
    localStorage.setItem("ecmaster-video-record-host", JSON.stringify(arv.checked));
    jitsi.videoRecSend(void 0, prot.videoRec.videoRecHost, ~~arv.checked);
}

// Allow or disallow admin access for this user
function allowAdmin(target: number, allowed: boolean, props: any) {
    if (!users[target]) return;
    let user = users[target];
    let name = user.name || "Anonymous";
    if (allowed) {
        user.fullAccess = props;
        log.pushStatus("allowAdmin", "User " + name + " has allowed admin access.");
    } else {
        user.fullAccess = null;
        log.pushStatus("allowAdmin", "User " + name + " has disallowed admin access.");
    }
    setTimeout(function() {
        log.popStatus("allowAdmin");
    }, 5000);
}

// Update admin information for this user
function updateAdmin(target: number, props: any) {
    if (!users[target]) return;
    let user = users[target];
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
    let userAdminFull = ui.ui.panels.userAdminFull;
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

// Messages from the master socket
if ("master" in config.config) {
    util.netEvent("master", "info", function(ev) {
        let msg: DataView = ev.detail;
        let p = prot.parts.info;
        let key = msg.getUint32(p.key, true);
        let val = 0;
        if (msg.byteLength >= p.length)
            val = msg.getUint32(p.value, true);
        switch (key) {
            case prot.info.creditCost:
                // Informing us of the cost of credits
                var v2 = msg.getUint32(p.value + 4, true);
                credits.creditCost = {
                    currency: val,
                    credits: v2
                };
                break;

            case prot.info.creditRate:
                // Informing us of the total cost and rate in credits
                var v2 = msg.getUint32(p.value + 4, true);
                credits.creditRate = [val, v2];
                updateCreditCost();
                break;

            case prot.info.sounds:
                // Soundboard items
                var valS = util.decodeText(msg.buffer.slice(p.value));
                addSoundButtons(JSON.parse(valS));
                break;

            case prot.info.allowAdmin:
            {
                // A user has allowed or disallowed us to administrate them
                if (msg.byteLength < p.length + 1) break;
                let allowed = !!msg.getUint8(p.length);
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
        let msg: DataView = ev.detail;
        let p = prot.parts.user;
        let index = msg.getUint32(p.index, true);
        let status = msg.getUint32(p.status, true);
        let nick = util.decodeText(msg.buffer.slice(p.nick));

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
        let msg: DataView = ev.detail;
        let p = prot.parts.speech;
        let indexStatus = msg.getUint32(p.indexStatus, true);
        let index = indexStatus>>>1;
        let status = !!(indexStatus&1);
        ui.userListUpdate(index, status, true);
        if (users[index]) {
            users[index].transmitting = status;
            updateMasterAdmin();
        }
    });
}
