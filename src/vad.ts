/*
 * Copyright (c) 2018-2021 Yahweasel
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

// WebRTCVAD's raw output
export let rawVadOn = false;
export function setRawVadOn(to: boolean): void { rawVadOn = to; }

// Recording VAD after warmup and cooldown
export let vadOn = false;
export function setVadOn(to: boolean): void { vadOn = to; }

// RTC VAD after cooldown
export let rtcVadOn = false;
export function setRTCVadOn(to: boolean): void { rtcVadOn = to; }

// Number of milliseconds to run the VAD for before/after talking
export const vadExtension = 2000;
