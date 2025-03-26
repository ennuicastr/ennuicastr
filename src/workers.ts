/*
 * Copyright (c) 2018-2025 Yahweasel
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
 * Configuration of the various workers.
 */

const workerVer = "1";
export const encoderWorker = `libs/ec-encoder-worker.js?v=${workerVer}`;
export const inprocWorker = `libs/ec-inproc-worker.js?v=${workerVer}`;
export const outprocWorker = `libs/ec-outproc-worker.js?v=${workerVer}`;
export const waveformWorker = `libs/ec-waveform-worker.js?v=${workerVer}`;

export const allWorkers = [
    encoderWorker, inprocWorker, outprocWorker, waveformWorker
];
