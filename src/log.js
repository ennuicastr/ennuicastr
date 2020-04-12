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

// "Log" is really status (whoops), and in order to control that we keep a status index
var curStatus = {};
function pushStatus(id, text) {
    if (id in curStatus && curStatus[id] === text) return;
    curStatus[id] = text;
    updateStatus();
}

function popStatus(id) {
    if (!(id in curStatus)) return;
    delete curStatus[id];
    updateStatus();
}

function updateStatus() {
    var txt = "";
    for (var id in curStatus) {
        txt += curStatus[id] + "\n";
    }
    txt = txt.trim();
    if (txt === "")
        txt = "Capturing audio";
    log.innerText = txt;
}
