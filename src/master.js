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
    var wrapper = dce("div");
    mkUI().appendChild(wrapper);

    // We divide the master interface into to halves
    function halfSpan(on) {
        var hs = dce("span");
        hs.classList.add("halfspan");
        (on||wrapper).appendChild(hs);

        var ret = dce("div");
        ret.style.padding = "0.5em";
        hs.appendChild(ret);

        return ret;
    }

    var left = masterUI.left = halfSpan();
    var right = masterUI.right = halfSpan();

    // On the left, interface buttons
    var pauseResume = masterUI.pauseResumeB = dce("button");
    pauseResume.classList.add("row");
    left.appendChild(pauseResume);

    var startStop = masterUI.startStopB = dce("button");
    startStop.classList.add("row");
    left.appendChild(startStop);

    // When we stop recording, there's a yes-no selector
    var ssyn = masterUI.startStopYesNo = dce("div");
    ssyn.classList.add("row");
    ssyn.style.display = "none";
    var ssys = halfSpan(ssyn);
    var ssy = masterUI.startStopYesB = dce("button");
    ssy.style.width = "100%";
    ssy.innerText = "Yes";
    ssys.appendChild(ssy);
    var ssns = halfSpan(ssyn);
    var ssn = masterUI.startStopNoB = dce("button");
    ssn.style.width = "100%";
    ssn.innerText = "No";
    ssns.appendChild(ssn);
    left.appendChild(ssyn);

    // The invitation link
    var ibox = dce("div");
    ibox.classList.add("row");
    ibox.classList.add("invite");

    var ifbox = dce("div");
    ifbox.style.display = "flex";
    ifbox.style.alignItems = "center";

    var ill = dce("label");
    ill.htmlFor = "invite-link";
    ill.innerHTML = "&nbsp;Invite:&nbsp;";
    ifbox.appendChild(ill);

    var invite = masterUI.invite = dce("input");
    invite.style.flex = "auto";
    invite.style.minWidth = "1em";
    invite.type = "text";
    invite.readOnly = true;
    invite.id = "invite-link";
    ifbox.appendChild(invite);

    var ilc = masterUI.inviteCopy = dce("button");
    ilc.innerHTML = '<i class="fas fa-clipboard"></i>';
    ilc.onclick = masterCopyInvite;
    ifbox.appendChild(ilc);

    ibox.appendChild(ifbox);

    // And invite options
    var iob = dce("div");
    iob.classList.add("row");
    iob.style.textAlign = "right";

    var inviteFlac = masterUI.inviteFlac = dce("input");
    inviteFlac.type = "checkbox";
    inviteFlac.id = "invite-flac";
    var ifl = dce("label");
    ifl.htmlFor = "invite-flac";
    ifl.innerHTML = "FLAC&nbsp;&nbsp;";

    // FIXME: Better setup for this option
    if ((config.format&prot.flags.dataTypeMask) === prot.flags.dataType.flac) {
        inviteFlac.checked = true;
        iob.appendChild(inviteFlac);
        iob.appendChild(ifl);
    }
    inviteFlac.onchange = masterGenInvite;

    var inviteContinuous = masterUI.inviteContinuous = dce("input");
    inviteContinuous.type = "checkbox";
    inviteContinuous.id = "invite-continuous";
    var icl = dce("label");
    icl.htmlFor = "invite-continuous";
    icl.innerHTML = "Continuous&nbsp;";

    if (config.format & features.continuous) {
        inviteContinuous.checked = true;
        iob.appendChild(inviteContinuous);
        iob.appendChild(icl);
    }
    inviteContinuous.onchange = masterGenInvite;

    ibox.appendChild(iob);
    left.appendChild(ibox);

    masterGenInvite();

    // The total cost
    var cbox = dce("div");
    cbox.classList.add("row");
    cbox.style.display = "flex";
    cbox.style.alignItems = "center";

    var cl = dce("span");
    cl.innerHTML = "Recording cost:&nbsp;";
    cl.style.minWidth = "10em";
    cl.style.textAlign = "right";
    cbox.appendChild(cl);

    var recCost = masterUI.recCost = dce("input");
    recCost.style.flex = "auto";
    recCost.style.minWidth = "1em";
    recCost.type = "text";
    recCost.readOnly = true;
    cbox.appendChild(recCost);

    left.appendChild(cbox);

    // And current rate
    var rbox = dce("div");
    rbox.classList.add("row");
    rbox.style.display = "flex";
    rbox.style.alignItems = "center";

    var rl = dce("span");
    rl.innerHTML = "Current rate:&nbsp;";
    rl.style.minWidth = "10em";
    rl.style.textAlign = "right";
    rbox.appendChild(rl);

    var recRate = masterUI.recRate = dce("input");
    recRate.style.flex = "auto";
    recRate.style.minWidth = "1em";
    recRate.type = "text";
    recRate.readOnly = true;
    rbox.appendChild(recRate);

    left.appendChild(rbox);

    masterUpdateCreditCost();

    // The right side is for user status
    masterUI.userStatusB = right;

    configureMasterInterface();
    updateMasterSpeech();
}

// (Re)configure the master interface
function configureMasterInterface() {
    if (!masterUI.startStopB)
        return;

    var pauseResume = masterUI.pauseResumeB;
    var startStop = masterUI.startStopB;
    masterUI.startStopYesNo.style.display = "none";

    // Start/stop button
    pauseResume.disabled = false;
    startStop.disabled = false;
    if (mode < prot.mode.rec) {
        pauseResume.style.display = "none";
        startStop.innerText = "Start recording";
        startStop.onclick = masterStartRecording;

    } else if (mode === prot.mode.rec ||
               mode === prot.mode.paused) {
        pauseResume.style.display = "";
        if (mode === prot.mode.rec) {
            pauseResume.innerText = "Pause recording";
            pauseResume.onclick = masterPauseRecording;
        } else {
            pauseResume.innerText = "Resume recording";
            pauseResume.onclick = masterResumeRecording;
        }
        startStop.innerText = "Stop recording";
        startStop.onclick = masterStopRecording;

    } else {
        pauseResume.style.display = "none";
        if (mode === prot.mode.buffering)
            startStop.innerText = "Waiting for audio from clients...";
        else
            startStop.innerText = "Recording stopped";
        startStop.onclick = function() {};
        startStop.disabled = true;

    }

    masterUpdateCreditCost();
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
    masterUI.startStopB.disabled = true;
    masterSendMode(prot.mode.rec);
}

// Pause the recording
function masterPauseRecording() {
    masterUI.pauseResumeB.disabled = true;
    masterSendMode(prot.mode.paused);
}

// Resume a paused recording
function masterResumeRecording() {
    masterUI.pauseResumeB.disabled = true;
    masterSendMode(prot.mode.rec);
}

// Stop the recording (stop button clicked)
function masterStopRecording() {
    var startStop = masterUI.startStopB;

    startStop.disabled = true;
    startStop.innerText = "Are you sure?";

    masterUI.startStopYesNo.style.display = "";
    masterUI.startStopYesB.onclick = masterStopRecordingYes;
    masterUI.startStopNoB.onclick = masterStopRecordingNo;
}

function masterStopRecordingYes() {
    masterUI.startStopYesNo.style.display = "none";

    // Send out the stop request
    masterSendMode(prot.mode.finished);
}

function masterStopRecordingNo() {
    // Never mind!
    configureMasterInterface();
}

// Generate the invite link
function masterGenInvite() {
    // Generate the search string
    var f = (
        (masterUI.inviteContinuous.checked?features.continuous:0) +
        ((config.format&features.rtc)?features.rtc:0) +
        (masterUI.inviteFlac.checked?prot.flags.dataType.flac:0)
    );
    var sb = "?" + config.id.toString(36) + "-" + config.key.toString(36);
    if (config.port !== 36678)
        sb += "-p" + config.port.toString(36);
    if (f !== 0)
        sb += "-f" + f.toString(36);

    // Make the URL
    url.search = sb;
    masterUI.invite.value = url.toString();
}

// Copy the invite link
function masterCopyInvite() {
    masterUI.invite.select();
    document.execCommand("copy");

    pushStatus("invite", "Copied invite link");
    setTimeout(function() {
        popStatus("invite");
    }, 3000);
}

// Update the credit cost/rate meter
function masterUpdateCreditCost() {
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
    if (!masterUI.speech || !masterUI.userStatusB) return;

    // First make sure we have a div for each user
    masterUI.speechB = masterUI.speechB || [];
    while (masterUI.speechB.length < masterUI.speech.length)
        masterUI.speechB.push(null);

    for (var i = 0; i < masterUI.speech.length; i++) {
        if (masterUI.speech[i] && !masterUI.speechB[i]) {
            var div = masterUI.speechB[i] = dce("div");
            div.innerText = masterUI.speech[i].nick;
            masterUI.userStatusB.appendChild(div);
        }
    }

    // Then update them all based on status
    for (var i = 0; i < masterUI.speech.length; i++) {
        var status = masterUI.speech[i];
        if (!status) continue;
        var div = masterUI.speechB[i];

        var color;
        if (!status.online)
            color = "#333";
        else if (status.speaking)
            color = "#050";
        else
            color = "#000";
        div.style.backgroundColor = color;
    }
}
