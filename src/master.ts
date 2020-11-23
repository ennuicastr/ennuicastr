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
import { prot } from "./net";
import * as rtc from "./rtc";
import * as ui from "./ui";
import * as util from "./util";
import { dce, gebi } from "./util";

// Set up the master interface
export function createMasterInterface() {
    var masterUI = ui.ui.masterUI;
    var right = masterUI.right = gebi("ecmaster-right");
    gebi("ecmenu-master-hider").style.display = "";

    // On the left, interface buttons
    var pauseResume = masterUI.pauseResumeB = gebi("ecmaster-pause-resume");
    var startStop = masterUI.startStopB = gebi("ecmaster-start-stop");

    // When we stop recording, there's a yes-no selector
    var ssyn = masterUI.startStopYesNo = gebi("ecmaster-yes-no");
    var ssy = masterUI.startStopYesB = gebi("ecmaster-yes");
    var ssn = masterUI.startStopNoB = gebi("ecmaster-no");

    // The option to accept or refuse remote video recordings
    var arv = masterUI.acceptRemoteVideo = gebi("ecmaster-video-record-host");
    if (typeof localStorage !== "undefined") {
        var val = localStorage.getItem("ecmaster-video-record-host");
        if (val)
            arv.checked = JSON.parse(val);
    }
    arv.onchange = masterAcceptRemoteVideoChange;

    // The invitation link
    var invite = masterUI.invite = gebi("ecmaster-invite-link");
    var ilc = masterUI.inviteCopy = gebi("ecmaster-invite-link-copy");
    ilc.onclick = masterCopyInvite;

    // And invite options
    var inviteFlac = masterUI.inviteFlac = gebi("ecmaster-invite-flac");

    // FIXME: Better setup for this option
    if ((config.config.format&prot.flags.dataTypeMask) === prot.flags.dataType.flac) {
        inviteFlac.checked = true;
    } else {
        gebi("ecmaster-invite-flac-wrapper").style.display = "none";
    }
    inviteFlac.onchange = masterGenInvite;

    var inviteContinuous = masterUI.inviteContinuous = gebi("ecmaster-invite-continuous");
    if (config.config.format & config.features.continuous) {
        inviteContinuous.checked = true;
    } else {
        gebi("ecmaster-invite-continuous-wrapper").style.display = "none";
    }
    inviteContinuous.onchange = masterGenInvite;

    masterGenInvite();

    // The total cost
    var recCost = masterUI.recCost = gebi("ecmaster-recording-cost");

    // And current rate
    var recRate = masterUI.recRate = gebi("ecmaster-recording-rate");

    masterUpdateCreditCost();

    // The right side is for user status
    masterUI.userStatusB = right;

    // Including global mute/echo-cancel
    var gabs = masterUI.globalAdminBs = {
        mute: gebi("ecmaster-mute-all"),
        echo: gebi("ecmaster-echo-all")
    };
    gabs.mute.onclick = function() {
        masterAdminAction(-1, prot.flags.admin.actions.mute);
    };
    gabs.echo.onclick = function() {
        masterAdminAction(-1, prot.flags.admin.actions.echoCancel);
    };

    // Separately, there's the sound list
    masterUI.sounds = {
        wrapper: gebi("ecsounds-wrapper"),
        bwrapper: gebi("ecmenu-sounds-hider"),
        buttons: {},
        url2sid: {}
    };

    configureMasterInterface();
    updateMasterSpeech();
}

// (Re)configure the master interface
export function configureMasterInterface() {
    var masterUI = ui.ui.masterUI;

    if (!ui.ui.wrapper || !masterUI.startStopB)
        return;

    ui.pinUI();
    // Except for the master panel itself
    ui.ui.panels.master.style.height = "";

    var pauseResume = masterUI.pauseResumeB;
    var startStop = masterUI.startStopB;
    masterUI.startStopYesNo.style.display = "none";

    // Start/stop button
    pauseResume.disabled = false;
    startStop.disabled = false;
    if (net.mode < prot.mode.rec) {
        pauseResume.style.display = "none";
        startStop.innerHTML = '<i class="fas fa-microphone-alt"></i> Start recording';
        startStop.onclick = masterStartRecording;

    } else if (net.mode === prot.mode.rec ||
               net.mode === prot.mode.paused) {
        pauseResume.style.display = "";
        if (net.mode === prot.mode.rec) {
            pauseResume.innerHTML = '<i class="fas fa-pause"></i> Pause recording';
            pauseResume.onclick = masterPauseRecording;
        } else {
            pauseResume.innerHTML = '<i class="far fa-pause-circle"></i> Resume recording';
            pauseResume.onclick = masterResumeRecording;
        }
        startStop.innerHTML = '<i class="fas fa-stop"></i> Stop recording';
        startStop.onclick = masterStopRecording;

    } else {
        pauseResume.style.display = "none";
        if (net.mode === prot.mode.buffering)
            startStop.innerText = "Waiting for audio from clients...";
        else
            startStop.innerHTML = '<i class="fas fa-check"></i> Recording finished';
        startStop.onclick = function() {};
        startStop.disabled = true;

    }

    masterUpdateCreditCost();
    ui.reflexUI();
}

// Generic "send this mode change" function
function masterSendMode(mode) {
    var p = prot.parts.mode;
    var out = new DataView(new ArrayBuffer(p.length));
    out.setUint32(0, prot.ids.mode, true);
    out.setUint32(p.mode, mode, true);
    net.masterSock.send(out.buffer);
}

// Start the recording (start button clicked)
function masterStartRecording() {
    ui.ui.masterUI.startStopB.disabled = true;
    masterSendMode(prot.mode.rec);
}

// Pause the recording
function masterPauseRecording() {
    ui.ui.masterUI.pauseResumeB.disabled = true;
    masterSendMode(prot.mode.paused);
}

// Resume a paused recording
function masterResumeRecording() {
    ui.ui.masterUI.pauseResumeB.disabled = true;
    masterSendMode(prot.mode.rec);
}

// Stop the recording (stop button clicked)
function masterStopRecording() {
    var startStop = ui.ui.masterUI.startStopB;

    startStop.disabled = true;
    startStop.innerText = "Are you sure?";

    ui.ui.masterUI.startStopYesNo.style.display = "";
    ui.ui.masterUI.startStopYesB.onclick = masterStopRecordingYes;
    ui.ui.masterUI.startStopNoB.onclick = masterStopRecordingNo;

    ui.reflexUI();
}

function masterStopRecordingYes() {
    ui.ui.masterUI.startStopYesNo.style.display = "none";

    // Send out the stop request
    masterSendMode(prot.mode.finished);
    ui.reflexUI();
}

function masterStopRecordingNo() {
    // Never mind!
    configureMasterInterface();
}

// Generate the invite link
function masterGenInvite() {
    // Generate the search string
    var f = (
        (ui.ui.masterUI.inviteContinuous.checked?config.features.continuous:0) +
        ((config.config.format&config.features.rtc)?config.features.rtc:0) +
        (ui.ui.masterUI.inviteFlac.checked?prot.flags.dataType.flac:0)
    );
    var sb = "?" + config.config.id.toString(36) + "-" + config.config.key.toString(36);
    if (config.config.port !== 36678)
        sb += "-p" + config.config.port.toString(36);
    if (f !== 0)
        sb += "-f" + f.toString(36);

    // Make the URL
    var url = new URL(<any> config.url);
    url.search = sb;
    ui.ui.masterUI.invite.value = url.toString();
}

// Copy the invite link
function masterCopyInvite() {
    ui.ui.masterUI.invite.select();
    document.execCommand("copy");

    log.pushStatus("invite", "Copied invite link");
    setTimeout(function() {
        log.popStatus("invite");
    }, 3000);
}

// Update the credit cost/rate meter
export function masterUpdateCreditCost() {
    var masterUI = ui.ui.masterUI;
    if (!masterUI.recRate || !masterUI.creditCost || !masterUI.creditRate)
        return;
    var cc = masterUI.creditCost;
    var cr = masterUI.creditRate;
    if (net.mode === prot.mode.rec)
        cr[0] += cr[1]; // Report the *next* minute so you're not surprised
    masterUI.recCost.value = masterCreditsToDollars(cr[0], cc);
    masterUI.recRate.value = masterCreditsToDollars(cr[1]*60, cc) + "/hour";
}

// Convert a number of credits to dollars and cents
function masterCreditsToDollars(c, creditCost) {
    c = Math.ceil(c * creditCost.currency / creditCost.credits);

    // Trivial cases
    if (c === 0)
        return "-";
    else if (c < 100)
        return c + "¢";

    var d = Math.floor(c / 100);
    c = (c % 100)+"";
    if (c === "0") {
        return "$" + d;
    } else {
        if (c.length === 1) c = "0" + c;
        return "$" + d + "." + c;
    }
}

// Update the speech interface for the master
export function updateMasterSpeech() {
    var masterUI = ui.ui.masterUI;

    if (!masterUI.speech || !masterUI.userStatusB) return;

    // First make sure we have a div for each user
    masterUI.speechB = masterUI.speechB || [];
    while (masterUI.speechB.length < masterUI.speech.length)
        masterUI.speechB.push(null);

    for (var i = 0; i < masterUI.speech.length; i++) {
        if (masterUI.speech[i] && !masterUI.speechB[i]) {
            var nick = masterUI.speech[i].nick;

            var div = dce("div");
            div.classList.add("rflex");
            div.style.paddingLeft = "0.25em";
            masterUI.userStatusB.appendChild(div);

            // Status display
            var span = masterUI.speechB[i] = dce("span");
            span.style.flex = "auto";
            span.style.minWidth = "10em";
            span.style.height = span.style.lineHeight = "2em";
            span.style.padding = "0 0.25em 0 0.25em";
            span.style.verticalAlign = "middle";
            span.setAttribute("role", "status");
            span.setAttribute("aria-live", "polite");
            span.ecConnected = true; // So that we can adjust the aria-live setting usefully
            span.innerText = nick;
            div.appendChild(span);

            // Admin buttons
            let mkButton = function(i, act, txt, lbl) {
                var b = dce("button");
                b.id = "ecmaster-" + act + "-" + nick;
                b.title = txt + " " + nick;
                b.setAttribute("aria-label", txt + " " + nick);
                b.innerHTML = '<i class="fas fa-' + lbl + '"></i>';
                b.onclick = function() {
                    masterAdminAction(i, prot.flags.admin.actions[act]);
                };
                div.appendChild(b);
                return b;
            }
            mkButton(i, "kick", "Kick", "user-slash");
            mkButton(i, "mute", "Mute", "microphone-alt-slash");
            mkButton(i, "echoCancel", "Force echo cancellation on", "").innerHTML = masterUI.globalAdminBs.echo.innerHTML;
        }
    }

    // Then update them all based on status
    for (var i = 0; i < masterUI.speech.length; i++) {
        var status = masterUI.speech[i];
        if (!status) continue;
        var div = masterUI.speechB[i];

        var color, aria;
        if (!status.online) {
            color = "#333";
            aria = "Disconnected";
        } else if (status.speaking) {
            color = "#2b552b";
            aria = "Receiving";
        } else {
            color = "#000";
            aria = "Not receiving";
        }
        div.style.backgroundColor = color;

        // Speak the status only if online has changed
        if (div.ecConnected !== status.online) {
            div.ecConnected = status.online;
            div.setAttribute("aria-live", "polite");
            if (status.online)
                aria = "Connected";
        } else {
            div.setAttribute("aria-live", "off");
        }
        div.setAttribute("aria-label", status.nick + ": " + aria);
    }
}

// Add a soundboard button
function addSoundButton(sid, url, name) {
    var masterUI = ui.ui.masterUI;

    if (sid in masterUI.sounds.buttons)
        return;
    masterUI.sounds.url2sid[url] = sid;

    // Make the button
    var b: any = masterUI.sounds.buttons[sid] = {
        b: dce("button")
    };
    b.b.classList.add("nouppercase");
    b.b.id = "ec-sound-" + sid;
    b.i = dce("i");
    b.i.classList.add("fas");
    b.i.classList.add("fa-play");
    b.b.appendChild(b.i);
    b.n = dce("span");
    b.n.innerText = " " + name;
    b.b.appendChild(b.n);

    var spacer = dce("span");
    spacer.innerHTML = "&nbsp;";

    b.b.onclick = function() {
        var play = true;
        if (url in ui.ui.sounds)
            play = ui.ui.sounds[url].el.paused;
        masterPlayStopSound(b.b, sid, play);
    };

    masterUI.sounds.wrapper.appendChild(b.b);
    masterUI.sounds.wrapper.appendChild(spacer);
    masterUI.sounds.bwrapper.style.display = "";
}

// Add many soundboard buttons
export function addSoundButtons(arr) {
    arr.forEach(function(s) {
        addSoundButton(s.i, s.u, s.n);
    });
}

// Request a sound be played or stopped
function masterPlayStopSound(b, sid, play) {
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
export function masterSoundButtonUpdate(url, play, el) {
    var masterUI = ui.ui.masterUI;
    var sid = masterUI.sounds.url2sid[url];
    if (!sid)
        return;
    var b = masterUI.sounds.buttons[sid];

    // Un-disable the button
    b.b.disabled = false;
    b.b.classList.remove("off");

    // And update the icon
    b.i.classList.remove("fa-play");
    b.i.classList.remove("fa-stop");
    b.i.classList.add(play?"fa-stop":"fa-play");

    if (play) {
        el.addEventListener("ended", function() {
            masterSoundButtonUpdate(url, false, el);
        }, {once: true});
    }
}

// Admin actions
function masterAdminAction(target, action) {
    var p = prot.parts.admin;
    var out = new DataView(new ArrayBuffer(p.length));
    out.setUint32(0, prot.ids.admin, true);
    out.setUint32(p.target, target, true);
    out.setUint32(p.action, action, true);
    net.masterSock.send(out.buffer);
}

// The change handler for accepting remote video
function masterAcceptRemoteVideoChange() {
    var arv = ui.ui.masterUI.acceptRemoteVideo;
    if (typeof localStorage !== "undefined")
        localStorage.setItem("ecmaster-video-record-host", JSON.stringify(arv.checked));
    rtc.rtcVideoRecSend(void 0, prot.videoRec.videoRecHost, ~~arv.checked);
}
