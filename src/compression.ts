/*
 * Copyright (c) 2020 Yahweasel
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

/* NOTE: The functionality in this file relates to dynamic range compression,
 * NOT digital audio compression */

// extern
declare var webkitAudioContext: any;

/* For RTC, we apply compression. Those properties are here, along with a
 * callback for when they change. */
export var rtcCompression = {
    // Compressor stage (if used)
    compressor: {
        // Default settings suitable for most users

        // Anything below -40dB is almost certainly noise
        threshold: -40,

        // No need to knee in noise
        knee: 0,

        // Default to no compression
        ratio: 1,

        // Standard attack and release times
        attack: 0.1,
        release: 0.25
    },

    // General gain stage
    gain: {
        // Multiplier to the gain from below, our volume knob
        volume: 1,

        /* Direct gain to apply. Reset to null to force recalculation from
         * target. */
        gain: null,

        /* Target peak, based on compressor above. Reset gain to null to
         * recalculate. */
        target: -18
    },

    // Per-user gain stage
    perUserVol: {},

    // Our currently active compressors
    compressors: []
};

// Create a compressor and gain node
export function createCompressor(idx, ac, input) {
    // Destroy any previous compressor
    var cur = rtcCompression.compressors[idx];
    if (cur)
        destroyCompressor(idx);

    // Make sure we actually have gain calculated
    if (!rtcCompression.gain.gain)
        compressorCalculateGain();

    var ret = {
        ac: ac,
        inputStream: input,
        input: null,

        // Compressor node, only used for measurement
        compressor: null,

        // Null output for the compressor
        nullOutput: null,

        // Our current gain, constantly adjusted by the compressor
        compressedGain: 1,

        // Interval to apply gating
        interval: null,

        // Gain node
        gain: null
    };

    var c;

    // Create the input
    var i = ret.input = ac.createMediaStreamSource(input);

    /* Create our compressor. What we're actually building is more like a
     * limiter than a compressor, so we only use the compressor node to
     * generate the reduction value, and that feeds into gain. That way, we can
     * get the gain to a point where the user is audible, but we're not too
     * eager to increase it just because they're not talking. */
    var c = ret.compressor = ac.createDynamicsCompressor();
    for (var k in rtcCompression.compressor)
        c[k].value = rtcCompression.compressor[k];
    i.connect(c);

    if (typeof webkitAudioContext === "undefined") {
        // Non-Safari

        // And a null target for it
        var n = ret.nullOutput = ac.createMediaStreamDestination();
        c.connect(n);

        // Create the interval for compression
        ret.interval = setInterval(function() {
            if (!rtcCompression.gain.gain)
                return; // Wait for this to be calculated

            /* Here's the big idea: We have a fast reactor (the original
             * compressor) and a slow reactor (ret.compressedGain). We choose
             * whichever is less, i.e., whichever compresses more. The purpose
             * to doing that is so that brief spikes don't wildly alter the
             * gain, but consistent loudness does. */
            var chosenGain = 1;

            if (rtcCompression.compressor.ratio === 1) {
                // Compression is off
                ret.compressedGain = 1;

            } else {
                // Find a target compressed gain
                var target = Math.pow(10, c.reduction/10);

                /* If the target is (essentially) 1, then the audio is
                 * (essentially) silence. Don't learn the gain from silence! */
                if (target < 0.99) {
                    // This magic number is so that 90% change will be achieved after 10 seconds
                    ret.compressedGain = ((217*ret.compressedGain) + target) / 218;
                }

                // Choose whichever reduces more
                if (target < ret.compressedGain)
                    chosenGain = target;
                else
                    chosenGain = ret.compressedGain;

            }

            var gain = rtcCompression.gain.gain * chosenGain;
            // Don't increase by more than 20dB
            if (gain > 10)
                gain = 10;
            gain *= rtcCompression.gain.volume;
            if (idx in rtcCompression.perUserVol)
                gain *= rtcCompression.perUserVol[idx];

            // Now move the compression
            g.gain.setTargetAtTime(gain, 0, 0.003);
        }, 20);

    }
    // On Safari, DynamicsCompressorNode doesn't report its reduction, so we just have to trust it to do the right thing directly


    // Create our gain node
    var g = ret.gain = ac.createGain();
    if (typeof webkitAudioContext === "undefined") {
        g.gain.value = rtcCompression.gain.volume *
            ((idx in rtcCompression.perUserVol) ? rtcCompression.perUserVol[idx] : 1);
        i.connect(g);
    } else {
        g.gain.value = rtcCompression.gain.volume * rtcCompression.gain.gain * 0.01 *
            ((idx in rtcCompression.perUserVol) ? rtcCompression.perUserVol[idx] : 1);
        c.connect(g);
    }

    // Connect it to the destination
    g.connect(ac.destination);

    // And add it to the list
    var cs = rtcCompression.compressors;
    while (cs.length <= idx)
        cs.push(null);
    cs[idx] = ret;

    return ret;
}

// Destroy a compressor
export function destroyCompressor(idx) {
    var com = rtcCompression.compressors[idx];
    if (!com)
        return;
    rtcCompression.compressors[idx] = null;

    if (typeof webkitAudioContext === "undefined") {
        clearInterval(com.interval);

        // Disconnect the compression chain
        com.input.disconnect(com.compressor);
        com.compressor.disconnect(com.nullOutput);

        // And the gain chain
        com.input.disconnect(com.gain);
        com.gain.disconnect(com.ac.destination);

    } else {
        // Disconnect the whole chain
        com.input.disconnect(com.compressor);
        com.compressor.disconnect(com.gain);
        com.gain.disconnect(com.ac.destination);

    }
}

// Calculate our correct gain based on the compressor and gain values set
function compressorCalculateGain() {
    var c = rtcCompression.compressor;
    var g = rtcCompression.gain;

    /* The basic idea is that the compressor is going to reduce the dynamic
     * range from ((c.threshold+c.knee) to 0) to ((c.threshold+c.knee) to
     * (range/c.ratio)). That means that the highest volume is now, for
     * instance, -45dB with usual settings. We are then going to calculate the
     * gain to increase that to g.target. */
    var min = c.threshold + c.knee;
    var max = min - (min/c.ratio);
    var gain = Math.pow(10, (g.target - max) / 10);
    g.gain = gain;
}

/* If we've changed the targets (e.g. to turn off compression), reset all the
 * nodes */
export function compressorChanged() {
    var c = rtcCompression.compressor;
    var cs = rtcCompression.compressors;
    var g = rtcCompression.gain;
    var puv = rtcCompression.perUserVol;

    // Make sure we actually KNOW our target
    if (!g.gain)
        compressorCalculateGain();

    // Then apply it all
    for (var idx = 0; idx < cs.length; idx++) {
        var co = cs[idx];
        if (!co) return;
        for (var k in c)
            co.compressor[k].setTargetAtTime(c[k], 0, 0.03);

        if (typeof webkitAudioContext !== "undefined") {
            // Gain handled directly
            co.gain.gain.setTargetAtTime(g.volume * g.gain * 0.01 * ((idx in puv) ? puv[idx] : 1), 0, 0.03);
        }
    }
}
