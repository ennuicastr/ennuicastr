/*
 * Copyright (c) 2018-2024 Yahweasel
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

/**
 * A status message.
 */
interface StatusMessage {
    /** 
     * The category of this status message. No two messages will have the same
     * status.
     */
    category: string,

    /**
     * The HTML element representing this status.
     */
    el: HTMLElement,

    /**
     * The time *in* to *show* this status message. Used to avoid spamming
     * status for things that are brief and often irrelevant.
     */
    timein: number | null,

    /**
     * The timeout to hide this status message. Will be unset for permanent (or
     * long-term) messages.
     */
    timeout: number | null
}

// Current status messages
const curStatus: Record<string, StatusMessage> = Object.create(null);

/**
 * Push this status message.
 */
export function pushStatus(
    id: string, html: string, options?: {
        timein?: number,
        timeout?: number
    }
): void {
    options = options || {};

    let status = curStatus[id];
    let add = false;

    /* Create a fresh status if we didn't already have one, or use the existing
     * one if it's already there */
    if (status) {
        if (status.timein) {
            clearTimeout(status.timein);
            status.timein = null;
            add = true;
        }
        if (status.timeout) {
            clearTimeout(status.timeout);
            status.timeout = null;
        }
    } else {
        curStatus[id] = status = {
            category: id,
            el: document.createElement("div"),
            timein: null,
            timeout: null
        };
        add = true;
    }

    if (options.timein && add) {
        // Don't add this yet.
        status.timein = setTimeout(() => {
            delete curStatus[id];
            delete options.timein;
            pushStatus(id, html, options);
        }, options.timein);
        return;
    }

    status.el.innerHTML = html;
    if (options.timeout) {
        status.timeout = setTimeout(() => {
            status.timeout = null;
            popStatus(id);
        }, options.timeout);
    }

    updateStatus(null, add ? status : null);
}

/**
 * Pop an existing status (if it's here)
 */
export function popStatus(id: string): void {
    const status = curStatus[id];
    if (!status) return;
    let remove = true;
    if (status.timein) {
        clearTimeout(status.timein);
        remove = false;
    }
    if (status.timeout)
        clearTimeout(status.timeout);
    delete curStatus[id];
    if (remove)
        updateStatus(status, null);
}

function updateStatus(remove: StatusMessage, add: StatusMessage) {
    const w = ui.ui.log.wrapper;
    if (!w)
        return;
    if (remove)
        w.removeChild(remove.el);
    if (add)
        w.appendChild(add.el);

    // The height only comes from permanent/long-term elements
    let height = 0;
    for (const id in curStatus) {
        const status = curStatus[id];
        if (!status.timeout)
            height += status.el.offsetHeight;
    }
    ui.ui.log.spacer.style.height = height + "px";

    ui.maybeResizeSoon();
}
