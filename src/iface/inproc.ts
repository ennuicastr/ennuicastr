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

export interface InProcOptsBasic {
    /**
     * Base URL from which to load any data.
     */
    baseURL: string;

    /**
     * Sample rate of the input device.
     */
    inSampleRate: number;

    /**
     * Sample rate of the render device (output for echo cancellation).
     */
    renderSampleRate: number;

    /**
     * Channel to input on.
     */
    channel?: number;

    /**
     * Use echo cancellation?
     */
    useEC: boolean;

    /**
     * Use noise reduction?
     */
    useNR: boolean;

    /**
     * Use transcription?
     */
    useTranscription: boolean;

    /**
     * Was data sent recently? (If false, input is muted)
     */
    sentRecently: boolean;

    vadSensitivity: number;
    vadNoiseGate: number;
}

export interface InProcOpts extends InProcOptsBasic {
    /**
     * Port on which to receive data.
     */
    input: MessagePort;

    /**
     * Port on which to read rendered output data, for echo cancellation.
     */
    renderInput: MessagePort;

    /**
     * Port on which to return audio data.
     */
    output: MessagePort;

    /**
     * Port on which to send echo-cancelled but otherwise unprocessed data, for
     * separate recording.
     */
    ecOutput?: MessagePort;

    /**
     * Port for reverse RPC requests.
     */
    reverse: MessagePort;
}

export interface TranscriptionResult {
    result: {
        conf?: number;
        start: number;
        end: number;
        word: string;
    }[];
    text?: string;
    partial?: string;
}

export interface InputProcessor {
    /**
     * Initialize this processor.
     */
    init(opts: InProcOpts): void;

    /**
     * Set a message port on which waveform data will be sent (maximums and
     * VAD).
     */
    setWaveformPort(port: MessagePort): void;

    /**
     * Set new input processing options.
     */
    setOpts(opts: Partial<InProcOptsBasic>): void;
}

export interface InputProcessorRev {
    /**
     * Send the current VAD state.
     */
    vadState(raw: boolean, rtc: boolean, merged: boolean): void;

    /**
     * Send the max value seen over a period.
     */
    max(v: number): void;

    /**
     * Send a transcription.
     */
    transcription(result: TranscriptionResult, complete: boolean): void;
}
