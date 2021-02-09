/*
 * Copyright (c) 2020 Yahweasel
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
import * as log from "./log";
import * as net from "./net";
import { prot } from "./protocol";
import * as rtc from "./rtc";
import * as ui from "./ui";
import * as util from "./util";
import { dce, gebi } from "./util";

// For direct manipulation by net
export const credits = {
    creditCost: <{currency: number, credits: number}> null,
    creditRate: <[number, number]> null
};

export const users = <{
    name: string,
    online: boolean,
    transmitting: boolean
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
    ui.saveConfigCheckbox(masterUI.acceptRemoteVideo, "master-video-record-host3", acceptRemoteVideoChange);

    // Put everything in the proper state
    configureMasterInterface();
}

// (Re)configure the master interface
export function configureMasterInterface() {
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
export function updateCreditCost() {
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
export function userAdmin(user: number) {
    var userAdminUser = ui.ui.panels.userAdminUser;

    if (user >= 0) {
        userAdminUser.name.innerText = users[user].name;
        userAdminUser.kick.style.display = "";
    } else {
        userAdminUser.name.innerHTML = '<i class="fas fa-users"></i> All users';
        userAdminUser.kick.style.display = "none";
    }

    userAdminUser.kick.onclick = function() { adminAction(user, prot.flags.admin.actions.kick); };
    userAdminUser.mute.onclick = function() { adminAction(user, prot.flags.admin.actions.mute); };
    userAdminUser.echo.onclick = function() { adminAction(user, prot.flags.admin.actions.echoCancel); };
    ui.showPanel(userAdminUser.wrapper, null);
}

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
export function addSoundButtons(arr: {i: string, u: string, n: string}[]) {
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
export function soundButtonUpdate(url: string, play: unknown, el: HTMLAudioElement) {
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

// Admin actions
function adminAction(target: number, action: number) {
    var p = prot.parts.admin;
    var out = new DataView(new ArrayBuffer(p.length));
    out.setUint32(0, prot.ids.admin, true);
    out.setUint32(p.target, target, true);
    out.setUint32(p.action, action, true);
    net.masterSock.send(out.buffer);
    ui.showPanel(null, ui.ui.persistent.main);
}

// The change handler for accepting remote video
function acceptRemoteVideoChange() {
    var arv = ui.ui.panels.master.acceptRemoteVideo;
    localStorage.setItem("ecmaster-video-record-host", JSON.stringify(arv.checked));
    rtc.rtcVideoRecSend(void 0, prot.videoRec.videoRecHost, ~~arv.checked);
}
