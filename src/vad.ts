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
 * VAD constants and state per input.
 */

/**
 * A single VAD's state.
 */
export class VAD {
    /**
     * The raw VAD state, as reported by WebRTC VAD.
     */
    rawVadOn: boolean;

    /**
     * The recording VAD state, with buffering.
     */
    vadOn: boolean;

    /**
     * The RTC VAD state, with more urgent turn-on and less buffering.
     */
    rtcVadOn: boolean;

    constructor() {
        this.rawVadOn = this.vadOn = this.rtcVadOn = false;
    }
}

/**
 * All current VAD states.
 */
export const vads: VAD[] = [new VAD()];

/**
 * Number of milliseconds to run the VAD for before/after talking.
 */
export const vadExtension = 2000;
