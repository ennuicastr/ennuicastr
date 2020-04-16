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

// Create a compressor and gain node
function createCompressor(idx, ac, input) {
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
        input1: null,
        input2: null,

        // Compressor node, only used for measurement
        compressor: null,

        // Null output for the compressor
        nullOutput: null,

        // Our current gain, constantly adjusted by the compressor
        compressedGain: 1,

        // Interval to apply gating
        interval: null,

        // Currently gating?
        ducking: true,

        // Gain node
        gain: null
    };

    // Create our input
    var i = ret.input1 = ac.createMediaStreamSource(input);

    /* Create our compressor. What we're actually building is more like a
     * limiter than a compressor, so we only use the compressor node to
     * generate the reduction value, and that feeds into gain. That way, we can
     * get the gain to a point where the user is audible, but we're not too
     * eager to increase it just because they're not talking. */
    var c = ret.compressor = ac.createDynamicsCompressor();
    for (var k in rtcCompression.compressor)
        c[k].value = rtcCompression.compressor[k];
    i.connect(c);

    // And a null target for it
    var n = ret.nullOutput = ac.createMediaStreamDestination();
    c.connect(n);

    // Create the interval for 
    ret.interval = setInterval(function() {
        if (!rtcCompression.gain.gain)
            return; // Wait for this to be calculated

        if (rtcCompression.compressor.ratio === 1) {
            // Compression is off
            ret.compressedGain = 1;

        } else {
            // Find a target compressed gain
            var target = Math.pow(10, c.reduction/10);

            // Eagerly choose more reduction, so that the actual max is accounted for
            if (target < ret.compressedGain) {
                ret.compressedGain = target;
            } else {
                // But choose less reduction with glacial slowness
                // This magic number is so that 90% change will be achieved after a quarter of a second
                ret.compressedGain = ((5*ret.compressedGain) + target) / 6;
            }

        }

        var gain = rtcCompression.gain.volume * rtcCompression.gain.gain * ret.compressedGain;

        // Now move the compression
        g.gain.setTargetAtTime(gain, 0, 0.03);
    }, 20);

    // Create our second input
    i = ret.input2 = ac.createMediaStreamSource(input);

    // Create our gain node
    var g = ret.gain = ac.createGain();
    g.gain.value = rtcCompression.gain.volume;
    i.connect(g);

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
function destroyCompressor(idx) {
    var com = rtcCompression.compressors[idx];
    if (!com)
        return;
    rtcCompression.compressors[idx] = null;

    clearInterval(com.interval);

    // Disconnect the compression chain
    com.input1.disconnect(com.compressor);
    com.compressor.disconnect(com.nullOutput);

    // And the gain chain
    com.input2.disconnect(com.gain);
    com.gain.disconnect(com.ac.destination);
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
function compressorChanged() {
    var c = rtcCompression.compressor;
    var g = rtcCompression.gain;

    // Make sure we actually KNOW our target
    if (!g.gain)
        compressorCalculateGain();

    // Then apply it all
    rtcCompression.compressors.forEach(function(co) {
        if (!co) return;
        for (var k in c)
            co.compressor[k].setTargetAtTime(c[k], 0, 0.03);
    });
}
