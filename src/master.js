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

// Set up the master interface
function createMasterInterface() {
    var masterUI = ui.masterUI;
    var right = masterUI.right = gebi("ecmaster-right");
    gebi("ecmenu-master-hider").style.display = "";

    // On the left, interface buttons
    var pauseResume = masterUI.pauseResumeB = gebi("ecmaster-pause-resume");
    var startStop = masterUI.startStopB = gebi("ecmaster-start-stop");

    // When we stop recording, there's a yes-no selector
    var ssyn = masterUI.startStopYesNo = gebi("ecmaster-yes-no");
    var ssy = masterUI.startStopYesB = gebi("ecmaster-yes");
    var ssn = masterUI.startStopNoB = gebi("ecmaster-no");

    // The invitation link
    var invite = masterUI.invite = gebi("ecmaster-invite-link");
    var ilc = masterUI.inviteCopy = gebi("ecmaster-invite-link-copy");
    ilc.onclick = masterCopyInvite;

    // And invite options
    var inviteFlac = masterUI.inviteFlac = gebi("ecmaster-invite-flac");

    // FIXME: Better setup for this option
    if ((config.format&prot.flags.dataTypeMask) === prot.flags.dataType.flac) {
        inviteFlac.checked = true;
    } else {
        gebi("ecmaster-invite-flac-wrapper").style.display = "none";
    }
    inviteFlac.onchange = masterGenInvite;

    var inviteContinuous = masterUI.inviteContinuous = gebi("ecmaster-invite-continuous");
    if (config.format & features.continuous) {
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

    // And separately, there's the sound list
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
function configureMasterInterface() {
    var masterUI = ui.masterUI;

    if (!ui.wrapper || !masterUI.startStopB)
        return;

    pinUI();
    // Except for the master panel itself
    ui.panels.master.style.height = "";

    var pauseResume = masterUI.pauseResumeB;
    var startStop = masterUI.startStopB;
    masterUI.startStopYesNo.style.display = "none";

    // Start/stop button
    pauseResume.disabled = false;
    startStop.disabled = false;
    if (mode < prot.mode.rec) {
        pauseResume.style.display = "none";
        startStop.innerHTML = '<i class="fas fa-microphone-alt"></i> Start recording';
        startStop.onclick = masterStartRecording;

    } else if (mode === prot.mode.rec ||
               mode === prot.mode.paused) {
        pauseResume.style.display = "";
        if (mode === prot.mode.rec) {
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
        if (mode === prot.mode.buffering)
            startStop.innerText = "Waiting for audio from clients...";
        else
            startStop.innerHTML = '<i class="fas fa-check"></i> Recording finished';
        startStop.onclick = function() {};
        startStop.disabled = true;

    }

    masterUpdateCreditCost();
    reflexUI();
}

// Generic "send this mode change" function
function masterSendMode(mode) {
    var p = prot.parts.mode;
    var out = new DataView(new ArrayBuffer(p.length));
    out.setUint32(0, prot.ids.mode, true);
    out.setUint32(p.mode, mode, true);
    masterSock.send(out.buffer);
}

// Start the recording (start button clicked)
function masterStartRecording() {
    ui.masterUI.startStopB.disabled = true;
    masterSendMode(prot.mode.rec);
}

// Pause the recording
function masterPauseRecording() {
    ui.masterUI.pauseResumeB.disabled = true;
    masterSendMode(prot.mode.paused);
}

// Resume a paused recording
function masterResumeRecording() {
    ui.masterUI.pauseResumeB.disabled = true;
    masterSendMode(prot.mode.rec);
}

// Stop the recording (stop button clicked)
function masterStopRecording() {
    var startStop = ui.masterUI.startStopB;

    startStop.disabled = true;
    startStop.innerText = "Are you sure?";

    ui.masterUI.startStopYesNo.style.display = "";
    ui.masterUI.startStopYesB.onclick = masterStopRecordingYes;
    ui.masterUI.startStopNoB.onclick = masterStopRecordingNo;

    reflexUI();
}

function masterStopRecordingYes() {
    ui.masterUI.startStopYesNo.style.display = "none";

    // Send out the stop request
    masterSendMode(prot.mode.finished);
    reflexUI();
}

function masterStopRecordingNo() {
    // Never mind!
    configureMasterInterface();
}

// Generate the invite link
function masterGenInvite() {
    // Generate the search string
    var f = (
        (ui.masterUI.inviteContinuous.checked?features.continuous:0) +
        ((config.format&features.rtc)?features.rtc:0) +
        (ui.masterUI.inviteFlac.checked?prot.flags.dataType.flac:0)
    );
    var sb = "?" + config.id.toString(36) + "-" + config.key.toString(36);
    if (config.port !== 36678)
        sb += "-p" + config.port.toString(36);
    if (f !== 0)
        sb += "-f" + f.toString(36);

    // Make the URL
    url.search = sb;
    ui.masterUI.invite.value = url.toString();
}

// Copy the invite link
function masterCopyInvite() {
    ui.masterUI.invite.select();
    document.execCommand("copy");

    pushStatus("invite", "Copied invite link");
    setTimeout(function() {
        popStatus("invite");
    }, 3000);
}

// Update the credit cost/rate meter
function masterUpdateCreditCost() {
    var masterUI = ui.masterUI;
    if (!masterUI.recRate || !masterUI.creditCost || !masterUI.creditRate)
        return;
    var cc = masterUI.creditCost;
    var cr = masterUI.creditRate;
    if (mode === prot.mode.rec)
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
function updateMasterSpeech() {
    var masterUI = ui.masterUI;

    if (!masterUI.speech || !masterUI.userStatusB) return;

    // First make sure we have a div for each user
    masterUI.speechB = masterUI.speechB || [];
    while (masterUI.speechB.length < masterUI.speech.length)
        masterUI.speechB.push(null);

    for (var i = 0; i < masterUI.speech.length; i++) {
        if (masterUI.speech[i] && !masterUI.speechB[i]) {
            var div = masterUI.speechB[i] = dce("div");
            div.style.paddingLeft = "0.25em";
            div.setAttribute("role", "status");
            div.setAttribute("aria-live", "polite");
            div.ecConnected = true; // So that we can adjust the aria-live setting usefully
            div.innerText = masterUI.speech[i].nick;
            masterUI.userStatusB.appendChild(div);
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
    var masterUI = ui.masterUI;

    if (sid in masterUI.sounds.buttons)
        return;
    masterUI.sounds.url2sid[url] = sid;

    // Make the button
    var b = masterUI.sounds.buttons[sid] = {
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
        if (url in ui.sounds)
            play = ui.sounds[url].el.paused;
        masterPlayStopSound(b.b, sid, play);
    };

    masterUI.sounds.wrapper.appendChild(b.b);
    masterUI.sounds.wrapper.appendChild(spacer);
    masterUI.sounds.bwrapper.style.display = "";
}

// Add many soundboard buttons
function addSoundButtons(arr) {
    arr.forEach(function(s) {
        addSoundButton(s.i, s.u, s.n);
    });
}

// Request a sound be played or stopped
function masterPlayStopSound(b, sid, play) {
    b.disabled = true;
    b.classList.add("off");
    var p = prot.parts.sound.cs;
    var sidBuf = encodeText(sid);
    var msg = new DataView(new ArrayBuffer(p.length + sidBuf.length));
    msg.setUint32(0, prot.ids.sound, true);
    msg.setUint8(p.status, play?1:0, true);
    new Uint8Array(msg.buffer).set(sidBuf, p.id);
    masterSock.send(msg);
}

// Update the state of a playback button
function masterSoundButtonUpdate(url, play, el) {
    var masterUI = ui.masterUI;
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
