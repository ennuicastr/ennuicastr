/*
 * Copyright (c) 2018-2023 Yahweasel
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
 * Logging and status.
 */

import * as util from "./util";

export const log = util.gebi("log");

// Current status messages
const curStatus: {[key: string]: string} = {};

// "Log" is really status (whoops), and in order to control that we keep a status index
export function pushStatus(id: string, text: string): void {
    if (id in curStatus && curStatus[id] === text) return;
    curStatus[id] = text;
    updateStatus();
}

export function popStatus(id: string): void {
    if (!(id in curStatus)) return;
    delete curStatus[id];
    updateStatus();
}

function updateStatus() {
    let txt = "";
    for (const id in curStatus) {
        txt += curStatus[id] + "<br/>";
    }
    txt = txt.trim();
    if (txt === "")
        txt = "Recording";
    log.innerHTML = txt;

    util.dispatchEvent("ui.resize-needed");
}
