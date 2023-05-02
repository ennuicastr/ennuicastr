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
import * as ui from "./ui";

// Current status messages
const curStatus: Record<string, HTMLElement> = Object.create(null);

// "Log" is really status (whoops), and in order to control that we keep a status index
export function pushStatus(id: string, html: string): void {
    if (id in curStatus && curStatus[id].innerHTML === html) return;
    const oldEl = curStatus[id];
    const el = curStatus[id] = document.createElement("div");
    el.innerHTML = html;
    updateStatus(oldEl, el);
}

export function popStatus(id: string): void {
    if (!(id in curStatus)) return;
    const el = curStatus[id];
    delete curStatus[id];
    updateStatus(el, null);
}

function updateStatus(remove, add) {
    const w = ui.ui.log.wrapper;
    if (!w)
        return;
    if (remove)
        w.removeChild(remove);
    if (add)
        w.appendChild(add);
    ui.maybeResizeSoon();
}
