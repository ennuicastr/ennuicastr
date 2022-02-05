/*
 * Copyright (c) 2018-2022 Yahweasel
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
 * Abstract communication classes.
 */

/**
 * Modes to be used by this communication module.
 */
export interface CommModes {
    video?: boolean;
    audio?: boolean;
    data?: boolean;
}

/**
 * Any form of communication system.
 */
export abstract class Comms {
    /**
     * Communication systems need asynchronous initialization, so do that here.
     */
    abstract init(opts: CommModes): Promise<void>;
}

/**
 * Data communications.
 */
export abstract class DataComms extends Comms {
    /**
     * Get the current video recording host.
     */
    abstract getVideoRecHost(): number;

    /**
     * Send a video recording subcommand to a peer.
     */
    abstract videoRecSend(
        peer: number, cmd: number, payloadData?: unknown
    ): void;

    /**
     * Send a chunk of video data to a peer.
     */
    abstract videoDataSend(peer: number, idx: number, buf: Uint8Array): void;
}

/**
 * Current implementation of each communications protocol.
 */
export const comms = {
    video: <Comms> null,
    audio: <Comms> null,
    data: <DataComms> null
};
