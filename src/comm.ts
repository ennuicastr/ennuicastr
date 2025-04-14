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
 * Abstract communication classes.
 */

/**
 * Modes to be used by this communication module.
 */
export interface CommModes {
    video?: boolean;
    audio?: boolean;
    broadcast?: boolean;
    data?: boolean;
}

/**
 * Any form of communication system.
 */
export interface Comms {
    /**
     * Communication systems need asynchronous initialization, so do that here.
     */
    init(opts: CommModes): Promise<void>;
}

/**
 * CTCP communications.
 */
export interface CTCPComms extends Comms {
    /**
     * Send this message.
     */
    send(peer: number, msg: any): Promise<void>;
}

/**
 * Broadcast communications.
 */
export interface BroadcastComms extends Comms {
    /**
     * Broadcast this message.
     */
    broadcast(msg: any): Promise<void>;
}

/**
 * Video data (video recording) communications.
 */
export interface VideoRecComms extends Comms {
    /**
     * Get the current video recording host.
     */
    getVideoRecHost(): number;

    /**
     * Send a video recording subcommand to a peer.
     */
    videoRecSend(
        peer: number, cmd: number, payloadData?: unknown
    ): void;

    /**
     * Send a chunk of video data to a peer.
     */
    videoDataSend(peer: number, idx: number, buf: Uint8Array): void;
}

/**
 * Current implementation of each communications protocol.
 */
export const comms = {
    video: <Comms> null,
    audio: <Comms> null,
    ctcp: <CTCPComms> null,
    broadcast: <BroadcastComms> null,
    videoRec: <VideoRecComms> null
};
