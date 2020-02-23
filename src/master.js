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
    document.body.style.margin = "0";
    document.body.style.padding = "0";

    /* Our overall wrapper makes sure the master interface is below the
     * recording interface */
    var wrapper = masterUI.wrapper = dce("div");
    wrapper.style.margin = "160px 0 3em 0";
    document.body.appendChild(wrapper);

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

    // The credit rate (time left)
    var cbox = dce("div");
    cbox.classList.add("row");
    cbox.style.display = "flex";
    cbox.style.alignItems = "center";

    var cl = dce("span");
    cl.innerHTML = "Recording time left:&nbsp;";
    cbox.appendChild(cl);

    var timeLeft = masterUI.timeLeft = dce("input");
    timeLeft.style.flex = "auto";
    timeLeft.style.minWidth = "1em";
    timeLeft.type = "text";
    timeLeft.readOnly = true;
    cbox.appendChild(timeLeft);
    masterUpdateTimeLeft();

    left.appendChild(cbox);

    // The right side is for user status
    masterUI.userStatusB = right;

    configureMasterInterface();
    updateMasterSpeech();
}

// (Re)configure the master interface
function configureMasterInterface() {
    if (!masterUI.startStopB)
        return;

    var startStop = masterUI.startStopB;
    masterUI.startStopYesNo.style.display = "none";

    // Start/stop button
    startStop.disabled = false;
    if (mode < prot.mode.rec) {
        startStop.innerText = "Start recording";
        startStop.onclick = masterStartRecording;

    } else if (mode === prot.mode.rec) {
        startStop.innerText = "Stop recording";
        startStop.onclick = masterStopRecording;

    } else {
        startStop.innerText = "Recording stopped";
        startStop.onclick = function() {};
        startStop.disabled = true;

    }

    masterUpdateTimeLeft();
}

// Start the recording (start button clicked)
function masterStartRecording() {
    masterUI.startStopB.disabled = true;

    var p = prot.parts.mode;
    var out = new DataView(new ArrayBuffer(p.length));
    out.setUint32(0, prot.ids.mode, true);
    out.setUint32(p.mode, prot.mode.rec, true);
    masterSock.send(out.buffer);
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
    var p = prot.parts.mode;
    var out = new DataView(new ArrayBuffer(p.length));
    out.setUint32(0, prot.ids.mode, true);
    out.setUint32(p.mode, prot.mode.finished, true);
    masterSock.send(out.buffer);
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
    var sb = "?" + config.id.toString(36) + "-" + config.key.toString(36) + "-p" + config.port.toString(36);
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

// Update the time left indicator
function masterUpdateTimeLeft() {
    if (!masterUI.timeLeft)
        return;
    var tl = masterUI.timeLeft;
    var cr = masterUI.creditRate;

    // If it's free, it's free!
    if (!cr || cr[0] === 0) {
        tl.value = "-";
        return;
    }

    // Otherwise, calculate the time left
    var mleft = Math.floor(cr[1] / cr[0]);
    if (mleft < 0) mleft = 0;
    var h = Math.floor(mleft / 60) + "";
    var m = (mleft%60) + "";
    if (m.length<2) m = "0" + m;
    tl.value = h + ":" + m;
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
